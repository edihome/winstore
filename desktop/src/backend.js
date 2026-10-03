/**
 * ============================================================
 * File: src/backend.js
 * Module: Winstore Desktop
 *
 * Runs the EXISTING backend (../backend/src/server.js) as a child process,
 * unchanged. It's started in production mode with FRONTEND_DIST set, so the
 * backend serves the built React app AND the API on one loopback origin — which
 * is exactly what the desktop window then loads. Uses Electron's bundled Node
 * (ELECTRON_RUN_AS_NODE), so no system Node is required.
 * ============================================================
 */

const { spawn } = require("node:child_process");
const http = require("node:http");
const { serverEntry, backendDir, frontendDist } = require("./paths");
const { DATABASE_URL, BACKEND_PORT, BACKEND_URL, getJwtSecret } = require("./config");
const { buildBackendEnvironment } = require("./backend-environment");
const { stopChild } = require("./stop-child");

let proc = null;

const start = (mode) => {
    if (proc) throw new Error("The local Winstore service is already running.");
    proc = spawn(process.execPath, [serverEntry], {
        cwd: backendDir,
        env: buildBackendEnvironment({
            mode,
            inheritedEnv: process.env,
            databaseUrl: DATABASE_URL,
            port: BACKEND_PORT,
            jwtSecret: getJwtSecret(),
            frontendDist,
        }),
        stdio: "inherit",
    });
    const child = proc;
    child.on("exit", (code, signal) => {
        // eslint-disable-next-line no-console
        console.log(`[winstore] backend exited (code=${code} signal=${signal})`);
        if (proc === child) proc = null;
    });
    return proc;
};

const stop = async () => {
    const child = proc;
    await stopChild(child);
    if (proc === child) proc = null;
};

// Poll the backend's own health endpoint until it's serving, so we don't open
// the window before the app is ready.
const waitUntilHealthy = (timeoutMs = 30000) =>
    new Promise((resolve, reject) => {
        const deadline = Date.now() + timeoutMs;
        const attempt = () => {
            const req = http.get(`${BACKEND_URL}/api/v1/health`, (res) => {
                res.resume();
                if (res.statusCode === 200) return resolve();
                retry();
            });
            req.on("error", retry);
            req.setTimeout(2000, () => req.destroy());
        };
        const retry = () => {
            if (Date.now() > deadline) return reject(new Error("The Winstore service did not start in time."));
            setTimeout(attempt, 400);
        };
        attempt();
    });

module.exports = { start, stop, waitUntilHealthy };
