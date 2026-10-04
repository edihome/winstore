const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const vm = require("node:vm");
const { buildBackendEnvironment } = require("../src/backend-environment");
const { stopChild } = require("../src/stop-child");

const port = 51123;
const origin = `http://127.0.0.1:${port}`;
const loadBackend = async ({ killError } = {}) => {
    const children = [], requests = [], timers = [], output = [], errors = [];
    let now = 0, secrets = 0;
    const modules = {
        "node:child_process": { spawn: (executable, args, options) => {
            const child = new EventEmitter();
            child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
            child.exitCode = null; child.signalCode = null;
            child.kill = (signal) => { child.signals.push(signal); if (killError) throw killError; };
            child.signals = [];
            child.finish = (code = 0) => { child.exitCode = code; child.emit("exit", code, null); };
            children.push({ executable, args, options, child });
            return child;
        } },
        "node:http": { get: (url, callback) => {
            const request = new EventEmitter();
            request.setTimeout = (milliseconds, handler) => { request.timeout = { milliseconds, handler }; };
            request.destroy = () => request.emit("error", new Error("Request timed out"));
            request.respond = (statusCode) => { request.resumed = false; callback({ statusCode, resume: () => { request.resumed = true; } }); };
            request.url = url; requests.push(request); return request;
        } },
        "./paths": { serverEntry: "unused-server.js", backendDir: "unused-backend", frontendDist: "unused-frontend" },
        "./config": { DATABASE_URL: "postgresql://local-test", BACKEND_PORT: port, BACKEND_URL: origin, getJwtSecret: () => { secrets++; return "x".repeat(48); } },
        "./backend-environment": { buildBackendEnvironment }, "./stop-child": { stopChild },
    };
    const context = {
        module: { exports: {} }, require: (id) => { assert.ok(modules[id], `unexpected import ${id}`); return modules[id]; },
        process: { execPath: "unused-electron", env: { HOST: "0.0.0.0", DATABASE_URL: "postgresql://untrusted", SYNC_HUB_URL: "https://untrusted.example" },
            stdout: { write: (chunk) => output.push(chunk.toString()) }, stderr: { write: (chunk) => errors.push(chunk.toString()) } },
        console: { log() {} }, Date: { now: () => now },
        setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
    };
    const entry = path.resolve(__dirname, "../src/backend.js");
    vm.runInNewContext(await fs.readFile(entry, "utf8"), context, { filename: entry });
    return { backend: context.module.exports, children, requests, output, errors, secretCount: () => secrets,
        tick: () => { const timer = timers.shift(); assert.ok(timer, "expected a scheduled startup retry"); now += timer.delay; timer.callback(); },
    };
};

test("importing the backend wrapper starts no child and creates no JWT secret", async () => {
    const fixture = await loadBackend();
    assert.equal(fixture.children.length, 0);
    assert.equal(fixture.secretCount(), 0);
    await fixture.backend.stop();
});

test("the owned backend is started with trusted loopback settings and its own Electron runtime", async () => {
    const fixture = await loadBackend();
    fixture.backend.start("branch");
    const launched = fixture.children[0];
    assert.equal(launched.executable, "unused-electron");
    assert.equal(launched.args[0], "unused-server.js");
    assert.equal(launched.options.env.HOST, "127.0.0.1");
    assert.equal(launched.options.env.DATABASE_URL, "postgresql://local-test");
    assert.equal(launched.options.env.PORT, String(port));
    assert.equal(launched.options.env.ELECTRON_RUN_AS_NODE, "1");
    assert.equal(launched.options.env.SYNC_HUB_URL, "");
    assert.equal(launched.options.env.SYNC_ENABLED, "true");
    assert.equal(fixture.secretCount(), 1);
    launched.child.finish();
});

test("an unrelated HTTP server cannot satisfy startup before the owned child's listen message", async () => {
    const fixture = await loadBackend();
    const child = fixture.backend.start("standalone");
    const healthy = fixture.backend.waitUntilHealthy(1000);
    const failed = assert.rejects(healthy, /did not start in time/);
    fixture.tick(); fixture.tick(); fixture.tick();
    await failed;
    assert.equal(fixture.requests.length, 0, "existing 200 responses must never be probed as ownership proof");
    child.finish();
});

test("split listen output enables the exact loopback health probe and keeps child logs visible", async () => {
    const fixture = await loadBackend();
    const child = fixture.backend.start("standalone");
    const healthy = fixture.backend.waitUntilHealthy();
    child.stdout.emit("data", Buffer.from("Server running on port "));
    fixture.tick();
    assert.equal(fixture.requests.length, 0);
    child.stderr.emit("data", Buffer.from("backend diagnostic"));
    child.stdout.emit("data", Buffer.from(String(port) + "\n"));
    fixture.tick();
    const request = fixture.requests[0];
    assert.equal(request.url, origin + "/api/v1/health");
    assert.equal(request.timeout.milliseconds, 2000);
    request.respond(200); await healthy;
    assert.equal(request.resumed, true);
    assert.equal(fixture.output.join(""), `Server running on port ${port}\n`);
    assert.equal(fixture.errors.join(""), "backend diagnostic");
    child.finish();
});

test("a listen message for another port cannot enable health probing", async () => {
    const fixture = await loadBackend();
    const child = fixture.backend.start("standalone");
    const healthy = fixture.backend.waitUntilHealthy();
    const failed = assert.rejects(healthy, /stopped during startup/);
    child.stdout.emit("data", Buffer.from("Server running on port 5000\n"));
    fixture.tick(); assert.equal(fixture.requests.length, 0);
    child.finish(1); fixture.tick(); await failed;
});

test("owned child exit and spawn error reject startup without accepting another process's health", async () => {
    for (const errored of [false, true]) {
        const fixture = await loadBackend();
        const child = fixture.backend.start("standalone");
        const healthy = fixture.backend.waitUntilHealthy();
        const failure = errored ? new Error("Cannot launch child") : undefined;
        const failed = assert.rejects(healthy, errored ? /Cannot launch child/ : /stopped during startup/);
        if (errored) child.emit("error", failure); else child.finish(1);
        fixture.tick(); await failed;
        assert.equal(fixture.requests.length, 0);
        if (errored) child.finish(1);
    }
});

test("non-200 health and network errors retry only while the owned backend remains alive", async () => {
    const fixture = await loadBackend();
    const child = fixture.backend.start("standalone");
    child.stdout.emit("data", Buffer.from(`Server running on port ${port}\n`));
    const healthy = fixture.backend.waitUntilHealthy();
    fixture.requests[0].respond(503); fixture.tick();
    fixture.requests[1].emit("error", new Error("Connection refused")); fixture.tick();
    fixture.requests[2].respond(200); await healthy;
    assert.equal(fixture.requests.length, 3);
    child.finish();
});

test("a pending 200 health response cannot make an exited or errored child healthy", async () => {
    for (const errored of [false, true]) {
        const fixture = await loadBackend();
        const child = fixture.backend.start("standalone");
        child.stdout.emit("data", Buffer.from(`Server running on port ${port}\n`));
        const healthy = fixture.backend.waitUntilHealthy();
        const rejected = assert.rejects(healthy, errored ? /Owned child failed/ : /stopped during startup/);
        if (errored) child.emit("error", new Error("Owned child failed")); else child.finish(1);
        fixture.requests[0].respond(200);
        await rejected;
        if (errored) child.finish(1);
    }
});

test("an earlier startup waiter cannot attach itself to a replacement child", async () => {
    const fixture = await loadBackend();
    const oldChild = fixture.backend.start("standalone");
    const healthy = fixture.backend.waitUntilHealthy();
    const rejected = assert.rejects(healthy, /stopped during startup/);
    oldChild.finish(1);
    const replacement = fixture.backend.start("standalone");
    replacement.stdout.emit("data", Buffer.from(`Server running on port ${port}\n`));
    fixture.tick();
    if (fixture.requests[0]) fixture.requests[0].respond(200);
    await rejected;
    replacement.finish();
});

test("late stdout from an exited child cannot establish readiness for its replacement", async () => {
    const fixture = await loadBackend();
    const oldChild = fixture.backend.start("standalone");
    oldChild.finish();
    const replacement = fixture.backend.start("standalone");
    oldChild.stdout.emit("data", Buffer.from(`Server running on port ${port}\n`));
    const healthy = fixture.backend.waitUntilHealthy();
    const rejected = assert.rejects(healthy, /stopped during startup/);
    const probesBeforeOwnedListen = fixture.requests.length;
    replacement.finish(1);
    if (fixture.requests[0]) fixture.requests[0].respond(503);
    fixture.tick();
    await rejected;
    assert.equal(probesBeforeOwnedListen, 0, "only the currently owned child can announce readiness");
});

test("stop remains pending until the owned child exits and replacement startup is blocked meanwhile", async () => {
    const fixture = await loadBackend();
    const child = fixture.backend.start("standalone");
    let stopped = false;
    const stopping = fixture.backend.stop().then(() => { stopped = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(stopped, false);
    assert.deepEqual(child.signals, ["SIGTERM"]);
    assert.throws(() => fixture.backend.start("standalone"), /already running/);
    child.finish(); await stopping;
    assert.equal(stopped, true);
    const next = fixture.backend.start("standalone");
    assert.notEqual(next, child);
    next.finish();
});

test("failed signaling rejects stop and retains ownership instead of claiming the child stopped", async () => {
    const fixture = await loadBackend({ killError: new Error("Cannot stop owned child") });
    const child = fixture.backend.start("standalone");
    await assert.rejects(fixture.backend.stop(), /Cannot stop owned child/);
    assert.throws(() => fixture.backend.start("standalone"), /already running/);
    child.finish();
});
