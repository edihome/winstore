/**
 * ============================================================
 * File: src/migrate.js
 * Module: Winstore Desktop
 *
 * Brings the bundled database up to the latest schema by running the backend's
 * OWN migrations with the backend's OWN node-pg-migrate — no copy, no fork.
 * Runs under Electron's bundled Node (ELECTRON_RUN_AS_NODE), so there's no
 * dependency on a system Node install.
 * ============================================================
 */

const { spawn } = require("node:child_process");
const { migrateBin, migrationsDir, backendDir } = require("./paths");
const { DATABASE_URL } = require("./config");

const run = () =>
    new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [migrateBin, "up", "-m", migrationsDir, "--no-check-order"], {
            cwd: backendDir,
            env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", DATABASE_URL },
            stdio: "inherit",
        });
        child.on("error", reject);
        child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`Database migration failed (exit ${code}).`))));
    });

module.exports = { run };
