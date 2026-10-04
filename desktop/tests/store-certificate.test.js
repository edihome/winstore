const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { IDENTITY_FILE, generateIdentity, loadStoreIdentity, checkCertificateDates } = require("../src/store-certificate");

const temporaryStore = async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "winstore-cert-test-"));
    t.after(async () => {
        assert.equal(path.dirname(directory), os.tmpdir());
        await fs.rm(directory, { recursive: true, force: true });
    });
    return directory;
};

test("the host identity and certificate survive a restart without regeneration", async (t) => {
    const directory = await temporaryStore(t);
    const first = await loadStoreIdentity(directory);
    const second = await loadStoreIdentity(directory, { generate: () => { throw new Error("must not generate"); } });
    assert.equal(second.hostId, first.hostId);
    assert.equal(second.fingerprint, first.fingerprint);
    assert.match(first.fingerprint, /^[0-9a-f]{64}$/);
    assert.equal(new crypto.X509Certificate(first.cert).ca, false);
    assert.deepEqual((await fs.readdir(directory)), [IDENTITY_FILE]);
});

test("corrupt saved certificates abort without replacing the host identity", async (t) => {
    const directory = await temporaryStore(t);
    const original = "{broken certificate data";
    await fs.writeFile(path.join(directory, IDENTITY_FILE), original);
    await assert.rejects(loadStoreIdentity(directory), /left unchanged/);
    assert.equal(await fs.readFile(path.join(directory, IDENTITY_FILE), "utf8"), original);
});

test("mismatched keys are rejected and certificate dates are checked", async (t) => {
    const directory = await temporaryStore(t);
    const identity = await generateIdentity();
    const alternate = await generateIdentity();
    identity.key = alternate.key;
    await fs.writeFile(path.join(directory, IDENTITY_FILE), JSON.stringify(identity));
    await assert.rejects(loadStoreIdentity(directory), /do not match/);
    const certificate = new crypto.X509Certificate(alternate.cert);
    assert.throws(() => checkCertificateDates(certificate, Date.parse(certificate.validTo) + 1), /validity period/);
    assert.throws(() => checkCertificateDates(certificate, Date.parse(certificate.validFrom) - 1), /validity period/);
});

test("concurrent first starts converge on one fully written identity", async (t) => {
    const directory = await temporaryStore(t);
    const identities = await Promise.all([loadStoreIdentity(directory), loadStoreIdentity(directory)]);
    assert.equal(identities[0].hostId, identities[1].hostId);
    assert.equal(identities[0].fingerprint, identities[1].fingerprint);
    assert.deepEqual(await fs.readdir(directory), [IDENTITY_FILE]);
});
