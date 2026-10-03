const fs = require("node:fs/promises");
const path = require("node:path");

const CONFIG_FILE = "desktop-config.json";
const MODES = new Set(["standalone", "branch"]);

const validateMode = (mode) => {
    if (!MODES.has(mode)) throw new Error("Choose a valid desktop mode: standalone or branch.");
    return mode;
};

const readMode = async (configFile) => {
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
    if (!config || config.version !== 1 || !MODES.has(config.mode)) {
        throw new Error(`The desktop settings file ${configFile} has an unsupported version or mode. Restore it from a backup before restarting Winstore.`);
    }
    return config.mode;
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

// Settings are created once. In particular, an existing standalone business is
// never offered enrollment into a different organization during an upgrade.
const resolveInstallMode = async ({ userData, pgDataDir, chooseMode }) => {
    const configFile = path.join(userData, CONFIG_FILE);
    const savedMode = await readMode(configFile);
    if (savedMode) return savedMode;

    const mode = (await hasExistingData(userData, pgDataDir)) ? "standalone" : await chooseMode();
    if (mode === null) return null;
    validateMode(mode);
    // The setup choice may have been open for a while. Never choose branch
    // mode if business files appeared meanwhile in this previously new dir.
    if (mode === "branch" && await hasExistingData(userData, pgDataDir)) {
        throw new Error("This device now contains an existing Winstore installation. Its data was left unchanged. Restart Winstore to continue with that installation.");
    }
    await fs.mkdir(userData, { recursive: true });
    try {
        await fs.writeFile(configFile, `${JSON.stringify({ version: 1, mode }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    } catch (error) {
        if (error.code !== "EEXIST") throw error;
        // A second startup can win creation, but must not overwrite the choice.
        const winner = await readMode(configFile);
        if (winner !== mode) throw new Error("The desktop mode was already configured differently. Restart Winstore to use its saved settings.");
    }
    return mode;
};

module.exports = { CONFIG_FILE, resolveInstallMode, validateMode };
