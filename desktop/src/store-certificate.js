const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const tls = require("node:tls");

const IDENTITY_FILE = "store-identity.json";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const certificateFingerprint = (certificate) => {
    const cert = certificate instanceof crypto.X509Certificate ? certificate : new crypto.X509Certificate(certificate);
    return crypto.createHash("sha256").update(cert.raw).digest("hex");
};

const checkCertificateDates = (certificate, now = Date.now()) => {
    const x509 = certificate instanceof crypto.X509Certificate ? certificate : new crypto.X509Certificate(certificate);
    if (now < Date.parse(x509.validFrom) || now > Date.parse(x509.validTo)) {
        throw new Error("The store certificate is outside its validity period. Check the computer's date or renew the store certificate and reconnect the tills.");
    }
    return x509;
};

const validateIdentity = (identity) => {
    if (!identity || identity.version !== 1 || !UUID.test(identity.hostId) ||
        typeof identity.key !== "string" || typeof identity.cert !== "string") {
        throw new Error("The saved store identity has an unsupported format.");
    }
    const cert = checkCertificateDates(identity.cert);
    const key = crypto.createPrivateKey(identity.key);
    if (!cert.checkPrivateKey(key)) throw new Error("The saved store certificate and private key do not match.");
    tls.createSecureContext({ key: identity.key, cert: identity.cert, minVersion: "TLSv1.2" });
    return { ...identity, fingerprint: certificateFingerprint(cert) };
};

const generateIdentity = async () => {
    const selfsigned = require("selfsigned");
    const hostId = crypto.randomUUID();
    const notBeforeDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const notAfterDate = new Date();
    notAfterDate.setFullYear(notAfterDate.getFullYear() + 10);
    const pems = await selfsigned.generate([{ name: "commonName", value: `Winstore Store ${hostId}` }], {
        keySize: 2048,
        algorithm: "sha256",
        notBeforeDate,
        notAfterDate,
        extensions: [
            { name: "basicConstraints", cA: false, critical: true },
            { name: "keyUsage", digitalSignature: true, keyEncipherment: true, critical: true },
            { name: "extKeyUsage", serverAuth: true },
            { name: "subjectAltName", altNames: [{ type: 2, value: "winstore-store.local" }] },
        ],
    });
    return { version: 1, hostId, key: pems.private, cert: pems.cert };
};

// One file keeps the identity and certificate together. A hard link publishes
// a fully flushed new file without replacing a concurrent startup's identity.
const loadStoreIdentity = async (userData, { generate = generateIdentity } = {}) => {
    const identityFile = path.join(userData, IDENTITY_FILE);
    const read = async () => {
        let text;
        try {
            text = await fs.readFile(identityFile, "utf8");
        } catch (error) {
            if (error.code === "ENOENT") return null;
            throw error;
        }
        try {
            return validateIdentity(JSON.parse(text));
        } catch (error) {
            throw new Error(`The saved store identity at ${identityFile} could not be used: ${error.message} Restore it from a backup; it was left unchanged.`);
        }
    };
    const saved = await read();
    if (saved) return saved;
    const generated = await generate();
    validateIdentity(generated);
    await fs.mkdir(userData, { recursive: true });
    const temporaryFile = path.join(userData, `.store-identity-${crypto.randomUUID()}.tmp`);
    try {
        const handle = await fs.open(temporaryFile, "wx", 0o600);
        try {
            await handle.writeFile(`${JSON.stringify(generated, null, 2)}\n`, "utf8");
            await handle.sync();
        } finally {
            await handle.close();
        }
        try {
            await fs.link(temporaryFile, identityFile);
        } catch (error) {
            if (error.code !== "EEXIST") throw error;
        }
        const winner = await read();
        if (!winner) throw new Error("The new store identity disappeared before it could be used.");
        return winner;
    } finally {
        await fs.unlink(temporaryFile).catch((error) => { if (error.code !== "ENOENT") throw error; });
    }
};

module.exports = { IDENTITY_FILE, loadStoreIdentity, generateIdentity, certificateFingerprint, checkCertificateDates };
