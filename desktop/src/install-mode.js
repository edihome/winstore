const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const net = require("node:net");

const CONFIG_FILE = "desktop-config.json";
const MODES = new Set(["standalone", "branch"]);

const validateMode = (mode) => {
    if (!MODES.has(mode)) throw new Error("Choose a valid desktop mode: standalone or branch.");
    return mode;
};

const hostConfig = (mode) => ({ version: 2, role: "host", mode: validateMode(mode), sharingEnabled: false, autoStart: false });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validStoreName = (name) => typeof name === "string" && Boolean(name.trim()) && name.length <= 200 && !/[\u0000-\u001f\u007f]/.test(name);
const privateAddress = (address) => {
    if (typeof address !== "string" || net.isIP(address) !== 4) return false;
    const [first, second] = address.split(".").map(Number);
    return first === 10 || (first === 192 && second === 168) || (first === 172 && second >= 16 && second <= 31);
};

const validateDesktopConfig = (config) => {
    if (!config || typeof config !== "object" || Array.isArray(config) || config.version !== 2) {
        throw new Error("Choose valid desktop settings with version 2.");
    }
    if (config.role === "host") {
        validateMode(config.mode);
        if (typeof config.sharingEnabled !== "boolean" || typeof config.autoStart !== "boolean"
            || Object.keys(config).some((key) => !["version", "role", "mode", "sharingEnabled", "autoStart", "storeName", "organizationId", "sharingAddress"].includes(key))) {
            throw new Error("The host settings must specify sharing and automatic startup.");
        }
        if (config.storeName !== undefined && !validStoreName(config.storeName)) throw new Error("The store name is invalid.");
        if (config.organizationId !== undefined && (typeof config.organizationId !== "string" || !UUID.test(config.organizationId))) throw new Error("The store organization identity is invalid.");
        if (config.sharingAddress !== undefined && !privateAddress(config.sharingAddress)) throw new Error("Choose a private IPv4 address on the store network.");
        return { version: 2, role: "host", mode: config.mode, sharingEnabled: config.sharingEnabled, autoStart: config.autoStart,
            ...(config.storeName !== undefined ? { storeName: config.storeName } : {}),
            ...(config.organizationId !== undefined ? { organizationId: config.organizationId } : {}),
            ...(config.sharingAddress !== undefined ? { sharingAddress: config.sharingAddress } : {}),
        };
    }
    if (config.role !== "client" || Object.keys(config).some((key) => !["version", "role", "connection"].includes(key))) {
        throw new Error("Choose a valid device role: host or client.");
    }
    const connection = config.connection;
    if (!connection || typeof connection !== "object" || Array.isArray(connection)
        || Object.keys(connection).some((key) => !["origin", "fingerprint", "hostId", "storeName"].includes(key))) {
        throw new Error("The client settings must include a verified store connection.");
    }
    let origin;
    try { origin = new URL(connection.origin); } catch { throw new Error("The store address is invalid."); }
    if (typeof connection.origin !== "string" || origin.protocol !== "https:" || origin.username || origin.password
        || origin.origin !== connection.origin || origin.pathname !== "/" || origin.search || origin.hash) {
        throw new Error("The store address must be an HTTPS origin without a path or credentials.");
    }
    if (!privateAddress(origin.hostname)) throw new Error("The store address must use a private IPv4 address on the store network.");
    if (typeof connection.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(connection.fingerprint)) {
        throw new Error("The store certificate fingerprint is invalid.");
    }
    if (typeof connection.hostId !== "string" || !UUID.test(connection.hostId)) {
        throw new Error("The store host identity is invalid.");
    }
    if (connection.storeName !== undefined && !validStoreName(connection.storeName)) {
        throw new Error("The store name is invalid.");
    }
    return { version: 2, role: "client", connection: {
        origin: connection.origin, fingerprint: connection.fingerprint, hostId: connection.hostId,
        ...(connection.storeName !== undefined ? { storeName: connection.storeName } : {}),
    } };
};

const readConfigFile = async (configFile) => {
    let contents;
    try {
        contents = await fs.readFile(configFile, "utf8");
    } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
    }
    let config;
    try {
        config = JSON.parse(contents);
    } catch {
        throw new Error(`The desktop settings file ${configFile} is invalid. Restore it from a backup before restarting Winstore.`);
    }
    try {
        if (config?.version === 1 && MODES.has(config.mode)
            && Object.keys(config).every((key) => ["version", "mode"].includes(key))) {
            return { config: hostConfig(config.mode), legacy: true };
        }
        return { config: validateDesktopConfig(config), legacy: false };
    } catch {
        throw new Error(`The desktop settings file ${configFile} has an unsupported version or mode. Restore it from a backup before restarting Winstore.`);
    }
};

const readDesktopConfig = async (userData) => (await readConfigFile(path.join(userData, CONFIG_FILE)))?.config || null;

// Flush a complete file before publishing it. Initial creation uses a hard link
// so a simultaneous setup cannot replace another device choice.
const writeConfig = async (userData, config, { exclusive = false } = {}) => {
    const configFile = path.join(userData, CONFIG_FILE);
    await fs.mkdir(userData, { recursive: true });
    const temporary = path.join(userData, `.desktop-config-${crypto.randomUUID()}.tmp`);
    try {
        const handle = await fs.open(temporary, "wx", 0o600);
        try {
            await handle.writeFile(`${JSON.stringify(config, null, 2)}\n`);
            await handle.sync();
        } finally { await handle.close(); }
        if (exclusive) await fs.link(temporary, configFile);
        else await fs.rename(temporary, configFile);
    } finally { await fs.rm(temporary, { force: true }); }
};

const hasExistingData = async (userData, pgDataDir) => {
    try {
        if ((await fs.readdir(pgDataDir)).length > 0) return true;
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }
    try {
        await fs.lstat(path.join(userData, "jwt-secret"));
        return true;
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
        return false;
    }
};

const saveDesktopConfig = async (userData, config) => {
    const validated = validateDesktopConfig(config);
    if (validated.role === "client" && await hasExistingData(userData, path.join(userData, "pgdata"))) {
        throw new Error("This device contains an existing Winstore installation. Its data was left unchanged. Use a fresh installation to connect as a client.");
    }
    await writeConfig(userData, validated);
    return validated;
};

// Existing business data always keeps its own local host. A role choice never
// enrolls, migrates, or deletes business data.
const resolveDesktopConfig = async ({ userData, pgDataDir = path.join(userData, "pgdata"), chooseConfig }) => {
    const configFile = path.join(userData, CONFIG_FILE);
    const saved = await readConfigFile(configFile);
    if (saved) {
        if (saved.config.role === "client" && await hasExistingData(userData, pgDataDir)) {
            throw new Error("This device contains an existing Winstore installation. Its data was left unchanged. Use a fresh installation to connect as a client.");
        }
        if (saved.legacy) await writeConfig(userData, saved.config);
        return saved.config;
    }

    const config = (await hasExistingData(userData, pgDataDir)) ? hostConfig("standalone") : await chooseConfig();
    if (config === null) return null;
    const validated = validateDesktopConfig(config);
    // Recheck after the dialog: newly appearing business files must not become
    // a client or be enrolled into another organization.
    if ((validated.role === "client" || validated.mode === "branch") && await hasExistingData(userData, pgDataDir)) {
        throw new Error("This device now contains an existing Winstore installation. Its data was left unchanged. Restart Winstore to continue with that installation.");
    }
    try {
        await writeConfig(userData, validated, { exclusive: true });
    } catch (error) {
        if (error.code !== "EEXIST") throw error;
        // A second startup can win creation, but must not overwrite the choice.
        const winner = await readDesktopConfig(userData);
        if (JSON.stringify(winner) !== JSON.stringify(validated)) throw new Error("The desktop mode was already configured differently. Restart Winstore to use its saved settings.");
    }
    return validated;
};

// Kept for component smoke tests and callers that only need the business mode.
const resolveInstallMode = async ({ chooseMode, ...options }) => {
    const config = await resolveDesktopConfig({ ...options, chooseConfig: async () => {
        const mode = await chooseMode();
        return mode === null ? null : hostConfig(mode);
    } });
    if (config === null) return null;
    if (config.role !== "host") throw new Error("This client does not run a local business database.");
    return config.mode;
};

module.exports = { CONFIG_FILE, resolveDesktopConfig, readDesktopConfig, saveDesktopConfig, validateDesktopConfig, resolveInstallMode, validateMode };
