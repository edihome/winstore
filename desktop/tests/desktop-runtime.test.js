const test = require("node:test");
const assert = require("node:assert/strict");
const { createDesktopRuntime } = require("../src/desktop-runtime");

test("client success and network failure cannot import local services or stop the host", async () => {
    for (const unavailable of [false, true]) {
        const connection = { origin: "https://192.168.1.10:51124" };
        let probes = 0;
        const runtime = createDesktopRuntime({ loadHostServices: () => assert.fail("client must never load local services"),
            verifyConnection: async (actual) => { assert.equal(actual, connection); probes++; if (unavailable) throw new Error("Host unavailable"); } });
        if (unavailable) await assert.rejects(runtime.start({ role: "client", connection }), /Host unavailable/);
        else await runtime.start({ role: "client", connection });
        await runtime.stop(); assert.equal(probes, 1);
    }
});
test("host starts database then migrations/backend, and drains sharing before shutdown", async () => {
    const calls = [];
    const runtime = createDesktopRuntime({ loadHostServices: () => ({
        postgres: { start: async () => calls.push("database"), stop: async () => calls.push("stop-database") },
        migrate: { run: async () => calls.push("migrate") },
        backend: { start: (mode) => calls.push(mode), waitUntilHealthy: async () => calls.push("healthy"), stop: async () => calls.push("stop-backend") },
    }), verifyConnection: () => assert.fail("host does not probe another store") });
    await runtime.start({ role: "host", mode: "branch" });
    runtime.setSharing({ stop: async () => { calls.push("drain-sharing"); await Promise.resolve(); calls.push("sharing-stopped"); } });
    await runtime.stop();
    assert.deepEqual(calls, ["database", "migrate", "branch", "healthy", "drain-sharing", "sharing-stopped", "stop-backend", "stop-database"]);
});
test("migration failure prevents backend startup and keeps the database available for orderly cleanup", async () => {
    const calls = [];
    const runtime = createDesktopRuntime({ loadHostServices: () => ({
        postgres: { start: async () => calls.push("database"), stop: async () => calls.push("stop-database") },
        migrate: { run: async () => { throw new Error("Migration failed"); } },
        backend: { start: () => assert.fail("must not start before successful migrations"), stop: async () => calls.push("stop-backend") },
    }) });
    await assert.rejects(runtime.start({ role: "host", mode: "standalone" }), /Migration failed/); await runtime.stop();
    assert.deepEqual(calls, ["database", "stop-backend", "stop-database"]);
});
test("failed gateway drain or backend stop cannot stop PostgreSQL while requests may still be active", async () => {
    for (const failedStage of ["gateway", "backend"]) {
        const calls = [];
        const runtime = createDesktopRuntime({ loadHostServices: () => ({
            postgres: { start: async () => {}, stop: async () => calls.push("stop-database") }, migrate: { run: async () => {} },
            backend: { start: () => {}, waitUntilHealthy: async () => {}, stop: async () => { calls.push("stop-backend"); if (failedStage === "backend") throw new Error("Shutdown failed"); } },
        }) });
        await runtime.start({ role: "host", mode: "standalone" });
        runtime.setSharing({ stop: async () => { calls.push("stop-gateway"); if (failedStage === "gateway") throw new Error("Shutdown failed"); } });
        await assert.rejects(runtime.stop(), /Shutdown failed/); assert.equal(calls.includes("stop-database"), false);
        if (failedStage === "gateway") assert.equal(calls.includes("stop-backend"), false);
    }
});
test("unsupported role fails before loading business services", async () => {
    const runtime = createDesktopRuntime({ loadHostServices: () => assert.fail("invalid role must not load services") });
    await assert.rejects(runtime.start({ role: "other" }), /valid computer role/); await runtime.stop();
});

test("quit during database initialization waits for startup before stopping any owned service", async () => {
    const calls = [];
    let finishDatabase;
    const databaseReady = new Promise((resolve) => { finishDatabase = resolve; });
    const runtime = createDesktopRuntime({ loadHostServices: () => ({
        postgres: { start: async () => { calls.push("database-starting"); await databaseReady; calls.push("database-ready"); }, stop: async () => calls.push("stop-database") },
        migrate: { run: async () => calls.push("migrate") },
        backend: { start: () => calls.push("backend"), waitUntilHealthy: async () => calls.push("healthy"), stop: async () => calls.push("stop-backend") },
    }) });
    const started = runtime.start({ role: "host", mode: "standalone" });
    const stopped = runtime.stop();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, ["database-starting"], "shutdown must not race initialization");
    finishDatabase();
    await started;
    await stopped;
    assert.deepEqual(calls, ["database-starting", "database-ready", "stop-backend", "stop-database"], "a requested shutdown cancels the remaining startup stages");
});
