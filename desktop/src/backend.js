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
let ready = false;
let startupFailure = null;

const start = (mode) => {
    if (proc) throw new Error("The local Winstore service is already running.");
    ready = false;
    startupFailure = null;
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
        stdio: ["ignore", "pipe", "pipe"],
    });
    const child = proc;
    let output = "";
    child.stdout.on("data", (chunk) => {
        output = (output + chunk.toString()).slice(-4096);
        if (proc === child && output.includes(`Server running on port ${BACKEND_PORT}`)) ready = true;
        process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.once("error", (error) => { if (proc === child) startupFailure = error; });
    child.on("exit", (code, signal) => {
        // eslint-disable-next-line no-console
        console.log(`[winstore] backend exited (code=${code} signal=${signal})`);
        if (proc === child) { proc = null; ready = false; }
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
const waitUntilHealthy = (timeoutMs = 90000) =>
    new Promise((resolve, reject) => {
        const deadline = Date.now() + timeoutMs;
        const watched = proc;
        const attempt = () => {
            if (startupFailure) return reject(startupFailure);
            if (!watched || proc !== watched || watched.exitCode !== null) return reject(new Error("The local Winstore service stopped during startup. Check that its port is available."));
            // A different process on this port must never count as our server.
            if (!ready) return retry();
            const req = http.get(`${BACKEND_URL}/api/v1/health`, (res) => {
                res.resume();
                if (startupFailure) return reject(startupFailure);
                if (proc !== watched || watched.exitCode !== null || !ready) return reject(new Error("The local Winstore service stopped during startup."));
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
