const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

// A local electronDist can contain Chromium's diagnostic log. Remove only that
// output-root file; never traverse or delete files from the installed runtime.
const afterPack = async ({ appOutDir }) => {
    const outputDir = await fs.realpath(appOutDir);
    const debugLog = path.join(outputDir, "debug.log");
    assert.equal(path.dirname(debugLog), outputDir);
    try {
        await fs.unlink(debugLog);
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }
};

module.exports = afterPack;

if (require.main === module) {
    afterPack({ appOutDir: process.argv[2] || path.resolve(__dirname, "../dist/win-unpacked") })
        .catch((error) => { console.error(error.message); process.exitCode = 1; });
}
