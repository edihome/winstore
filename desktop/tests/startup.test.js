const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");

// Run main-process orchestration with simulated services and windows only.
// Nothing imports Electron, starts a process, or reads a user-data directory.
const runStartup = async (mode, setupError, { activateBeforeReady = false, quitAfterStart = false, stopError } = {}) => {
    const calls = [];
    const handlers = {};
    let startup;
    let resolveExit;
    const exited = new Promise((resolve) => { resolveExit = resolve; });
    const app = {
        whenReady: () => ({ then: (handler) => { startup = handler(); } }),
        on: (event, handler) => { handlers[event] = handler; },
        exit: (code) => { calls.push(["exit", code]); resolveExit(); },
    };
    class BrowserWindow {
        static getAllWindows() { return []; }
        constructor() { calls.push(["window"]); }
        loadFile() {}
        loadURL() {}
        once() {}
    }
    const modules = {
        "node:path": path,
        electron: { app, BrowserWindow, dialog: { showErrorBox: (_title, message) => calls.push(["error", message]) } },
        "./src/postgres": { start: async () => calls.push(["postgres"]), stop: async () => calls.push(["stop-postgres"]) },
        "./src/migrate": { run: async () => calls.push(["migrate"]) },
        "./src/backend": {
            start: (selected) => calls.push(["backend", selected]),
            waitUntilHealthy: async () => calls.push(["healthy"]),
            stop: async () => {
                calls.push(["stop-backend"]);
                await Promise.resolve();
                if (stopError) throw stopError;
                calls.push(["stopped-backend"]);
            },
        },
        "./src/setup": { setup: async () => { calls.push(["setup"]); if (setupError) throw setupError; return mode; } },
        "./src/config": { BACKEND_URL: "http://test.invalid", userData: "unused-test-data", pgDataDir: "unused-test-cluster" },
    };
    const entry = path.resolve(__dirname, "../main.js");
    vm.runInNewContext(await fs.readFile(entry, "utf8"), {
        require: (id) => { assert.ok(modules[id], `unexpected main-process import ${id}`); return modules[id]; },
        __dirname: path.dirname(entry),
        process: { on: () => {} },
        console,
    }, { filename: entry });
    if (activateBeforeReady) handlers.activate();
    await startup;
    if (quitAfterStart) {
        handlers["before-quit"]({ preventDefault: () => calls.push(["prevent-quit"]) });
        await exited;
    }
    return calls;
};

test("startup cancellation exits before database, migrations, backend, or windows", async () => {
    assert.deepEqual(await runStartup(null), [["setup"], ["exit", 0]]);
});

test("branch startup passes the saved mode to the backend after migrations", async () => {
    assert.deepEqual(await runStartup("branch"), [
        ["setup"], ["window"], ["postgres"], ["migrate"], ["backend", "branch"], ["healthy"], ["window"],
    ]);
});

test("invalid setup aborts without starting or migrating business data", async () => {
    assert.deepEqual(await runStartup(undefined, new Error("invalid saved settings")), [
        ["setup"], ["error", "invalid saved settings"], ["stop-backend"], ["stopped-backend"], ["stop-postgres"], ["exit", 1],
    ]);
});

test("quit waits for backend shutdown before stopping PostgreSQL", async () => {
    assert.deepEqual(await runStartup("standalone", undefined, { quitAfterStart: true }), [
        ["setup"], ["window"], ["postgres"], ["migrate"], ["backend", "standalone"], ["healthy"], ["window"],
        ["prevent-quit"], ["stop-backend"], ["stopped-backend"], ["stop-postgres"], ["exit", 0],
    ]);
});

test("a backend shutdown failure preserves the database service and reports failure", async () => {
    const calls = await runStartup("standalone", undefined, { quitAfterStart: true, stopError: new Error("backend did not exit") });
    assert.deepEqual(calls.slice(-4), [["prevent-quit"], ["stop-backend"], ["error", "backend did not exit"], ["exit", 1]]);
    assert.equal(calls.some(([name]) => name === "stop-postgres"), false);
});

test("activation during setup cannot open the app before the backend is ready", async () => {
    assert.deepEqual(await runStartup("branch", undefined, { activateBeforeReady: true }), [
        ["setup"], ["window"], ["postgres"], ["migrate"], ["backend", "branch"], ["healthy"], ["window"],
    ]);
});
