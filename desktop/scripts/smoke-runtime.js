/**
 * Real desktop component smoke test, without an Electron window or app data.
 * Creates only new .smoke-* directories inside desktop/, uses temporary ports,
 * and removes those directories only after every owned process has stopped.
 */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { Client } = require("pg");
const { createPostgresManager } = require("../src/postgres-lifecycle");
const { resolveInstallMode } = require("../src/install-mode");
const { buildBackendEnvironment } = require("../src/backend-environment");

const desktopDir = path.resolve(__dirname, "..");
const backendDir = path.resolve(desktopDir, "../backend");
const frontendDist = path.resolve(desktopDir, "../frontend/dist");
const electron = require("electron"); // Resolves an executable; does not load a GUI.
const children = new Set();
const clusters = [];
let tempDir;
let postgresLogs = "";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const timed = async (promise, ms, label) => {
    let timer;
    try {
        return await Promise.race([promise, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms.`)), ms);
        })]);
    } finally { clearTimeout(timer); }
};

const freePort = () => new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
        const port = server.address().port;
        server.close((error) => error ? reject(error) : resolve(port));
    });
});

const startProcess = (args, env) => {
    const child = spawn(electron, args, { cwd: backendDir, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    children.add(child);
    const service = { child, ended: false, error: null, log: "", stdout: "" };
    const capture = (chunk) => { service.log = (service.log + chunk.toString()).slice(-16000); };
    child.stdout.on("data", (chunk) => { service.stdout += chunk.toString(); capture(chunk); });
    child.stderr.on("data", capture);
    child.once("error", (error) => { service.error = error; });
    service.closed = new Promise((resolve) => child.once("close", (code, signal) => {
        service.ended = true;
        children.delete(child);
        resolve({ code, signal });
    }));
    return service;
};

const stopProcess = async (service) => {
    if (service.ended) return;
    service.child.kill();
    await timed(service.closed, 12000, "Child shutdown");
};

const command = async (args, env, label) => {
    const service = startProcess(args, env);
    try {
        const { code } = await timed(service.closed, 60000, label);
        if (service.error || code !== 0) throw new Error(`${label} failed: ${service.error?.message || `exit ${code}`}\n${service.log}`);
        return service.stdout;
    } finally { await stopProcess(service); }
};

const waitForHealth = async (service, base) => {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
        if (service.ended) throw new Error(`Backend exited during startup: ${service.error?.message || ""}\n${service.log}`);
        try {
            const response = await fetch(`${base}/api/v1/health`, { signal: AbortSignal.timeout(1500) });
            if (response.status === 200) { await response.text(); return; }
            await response.text();
        } catch { /* starting up */ }
        await delay(150);
    }
    throw new Error(`Backend health check timed out.\n${service.log}`);
};

const portIsOpen = (port) => new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.setTimeout(1000);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => { socket.destroy(); resolve(false); });
    socket.once("timeout", () => { socket.destroy(); resolve(true); });
});

const createHarness = async (name, mode) => {
    const userData = path.join(tempDir, name);
    const pgDataDir = path.join(userData, "pgdata");
    assert.equal(await resolveInstallMode({ userData, pgDataDir, chooseMode: async () => mode }), mode);
    const pgPort = await freePort();
    let apiPort = await freePort();
    while (apiPort === pgPort) apiPort = await freePort();
    const password = crypto.randomBytes(24).toString("hex");
    const config = { pgDataDir, PG_PORT: pgPort, DB_NAME: "winstore", DB_USER: "winstore", DB_PASSWORD: password };
    const databaseUrl = `postgresql://winstore:${password}@127.0.0.1:${pgPort}/winstore`;
    const jwtSecret = crypto.randomBytes(48).toString("base64url");
    await fs.writeFile(path.join(userData, "jwt-secret"), jwtSecret, { mode: 0o600 });
    const env = buildBackendEnvironment({ mode, inheritedEnv: process.env, databaseUrl, port: apiPort, jwtSecret, frontendDist });
    const postgres = createPostgresManager({
        config,
        Client,
        loadEmbeddedPostgres: async () => {
            const { default: EmbeddedPostgres } = await import("embedded-postgres");
            return { default: class extends EmbeddedPostgres {
                constructor(options) {
                    const capture = (message) => { postgresLogs = (postgresLogs + String(message)).slice(-16000); };
                    super({ ...options, onLog: capture, onError: capture });
                }
            } };
        },
    });
    const cluster = { postgres, pgPort };
    clusters.push(cluster);
    let service = null;
    const base = `http://127.0.0.1:${apiPort}`;
    const start = async () => {
        await timed(postgres.start(), 30000, `${name} PostgreSQL startup`);
        await command([path.join(backendDir, "node_modules/node-pg-migrate/bin/node-pg-migrate.js"), "up", "-m", path.join(backendDir, "database/migrations"), "--no-check-order"], env, `${name} migrations`);
        service = startProcess([path.join(backendDir, "src/server.js")], env);
        await waitForHealth(service, base);
    };
    const stop = async () => {
        if (service) { await stopProcess(service); service = null; }
        await timed(postgres.stop(), 12000, `${name} PostgreSQL shutdown`);
        assert.equal(await portIsOpen(pgPort), false, "owned PostgreSQL must stop before restart or cleanup");
    };
    const api = async (route, { method = "GET", body, token, expected = 200 } = {}) => {
        const response = await fetch(`${base}/api/v1${route}`, {
            method,
            headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(15000),
        });
        const result = await response.json();
        assert.equal(response.status, expected, `${method} ${route}: ${result.message}`);
        return result.data;
    };
    const query = async (sql) => {
        const client = new Client({ connectionString: databaseUrl });
        await client.connect();
        try { return await client.query(sql); } finally { await client.end(); }
    };
    return { userData, pgDataDir, base, start, stop, api, query };
};

const cleanup = async () => {
    for (const child of [...children]) {
        child.kill();
        await timed(new Promise((resolve) => child.exitCode !== null ? resolve() : child.once("close", resolve)), 12000, "Cleanup child shutdown");
    }
    for (const { postgres, pgPort } of clusters) {
        await timed(postgres.stop(), 12000, "Cleanup PostgreSQL shutdown");
        if (await portIsOpen(pgPort)) throw new Error(`Owned PostgreSQL port ${pgPort} is still open; temporary files were retained.`);
    }
    if (tempDir) {
        // This is a freshly created, direct child of the checked desktop root.
        // Never recurse into an existing, calculated, or Electron user-data dir.
        assert.equal(path.dirname(path.resolve(tempDir)), desktopDir);
        assert.ok(path.basename(tempDir).startsWith(".smoke-"));
        assert.equal((await fs.lstat(tempDir)).isSymbolicLink(), false);
        await fs.rm(tempDir, { recursive: true, force: true });
    }
};

process.on("exit", () => { for (const child of children) child.kill(); });

const main = async () => {
    await fs.access(path.join(frontendDist, "index.html"));
    tempDir = await fs.mkdtemp(path.join(desktopDir, ".smoke-"));
    console.log("Desktop smoke: isolated workspace data; real bundled PostgreSQL; Electron Node runtime; no GUI.");
    const versions = JSON.parse(await command(["-e", "process.stdout.write(JSON.stringify(process.versions))"], { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, "Electron Node runtime"));
    console.log(`Runtime: Electron ${versions.electron}, Node ${versions.node}.`);

    const standalone = await createHarness("standalone", "standalone");
    await standalone.start();
    const server = (await standalone.query("SHOW server_version_num")).rows[0].server_version_num;
    assert.match(server, /^17/);
    assert.equal((await standalone.query("SHOW server_encoding")).rows[0].server_encoding, "UTF8");
    const migrationCount = (await standalone.query("SELECT COUNT(*) AS count FROM pgmigrations")).rows[0].count;
    assert.ok(Number(migrationCount) > 0);
    const html = await (await fetch(standalone.base, { signal: AbortSignal.timeout(5000) })).text();
    assert.match(html, /id="root"/);
    assert.equal((await standalone.api("/sync/link-status")).branchInstall, false);

    const credentials = { email: `desktop-smoke-${crypto.randomUUID()}@example.test`, password: crypto.randomBytes(16).toString("hex") };
    const account = await standalone.api("/auth/register", { method: "POST", expected: 201, body: {
        ...credentials, firstName: "Desktop", lastName: "Smoke", organizationName: "Isolated Desktop Smoke", branchName: "Smoke HQ",
    } });
    const login = await standalone.api("/auth/login", { method: "POST", body: credentials });
    const budget = await standalone.api("/budgets", { method: "POST", expected: 201, token: login.token, body: { name: "Persisted smoke budget", amount: "123.45" } });
    assert.equal(budget.amount, 123.45);
    const marker = await fs.readFile(path.join(standalone.pgDataDir, "PG_VERSION"), "utf8");
    console.log(`Standalone: ${migrationCount} migrations, built frontend, registration, login, and 123.45 budget passed.`);

    await standalone.stop();
    assert.equal(await resolveInstallMode({ userData: standalone.userData, pgDataDir: standalone.pgDataDir, chooseMode: () => assert.fail("restart must reuse saved mode") }), "standalone");
    await standalone.start();
    const restarted = await standalone.api("/auth/login", { method: "POST", body: credentials });
    assert.equal(restarted.user.id, account.user.id);
    assert.equal(restarted.user.organizationId, account.organization.id);
    const profile = await standalone.api("/auth/me", { token: restarted.token });
    assert.equal(profile.organization.id, account.organization.id);
    const budgets = await standalone.api("/budgets", { token: restarted.token });
    assert.equal(budgets.find((item) => item.id === budget.id)?.amount, 123.45);
    assert.equal((await standalone.query("SELECT COUNT(*) AS count FROM pgmigrations")).rows[0].count, migrationCount);
    assert.equal(await fs.readFile(path.join(standalone.pgDataDir, "PG_VERSION"), "utf8"), marker);
    console.log("Restart: persisted business, credentials, budget, cluster marker, and idempotent migrations passed.");
    await standalone.stop();

    const branch = await createHarness("branch", "branch");
    await branch.start();
    assert.deepEqual(await branch.api("/sync/link-status"), { branchInstall: true, linked: false });
    assert.equal((await branch.query("SELECT COUNT(*) AS count FROM organizations")).rows[0].count, "0");
    await branch.stop();
    console.log("Fresh branch: enrollment enabled with no existing business data. No head office contacted.");
};

(async () => {
    try {
        await main();
    } catch (error) {
        console.error(error.stack || error);
        if (postgresLogs) console.error(postgresLogs);
        process.exitCode = 1;
    } finally {
        try {
            await cleanup();
            console.log("Smoke cleanup: owned processes stopped and isolated workspace data removed.");
        } catch (error) {
            console.error(`Smoke cleanup failed: ${error.message}. Inspect ${tempDir || "the temporary workspace"}.`);
            process.exitCode = 1;
        }
    }
    // embedded-postgres installs async exit hooks; pass the result explicitly
    // so a smoke failure cannot be reported as a successful shell exit.
    process.exit(process.exitCode || 0);
})();
