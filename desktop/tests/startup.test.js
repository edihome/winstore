const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { EventEmitter } = require("node:events");
const vm = require("node:vm");
const { createDesktopRuntime } = require("../src/desktop-runtime");
const { createLazyStoreNetwork } = require("../src/lazy-store-network");

const backendUrl = "http://127.0.0.1:51123";
const host = () => ({ version: 2, role: "host", mode: "branch", sharingEnabled: false, autoStart: false });
const client = () => ({ version: 2, role: "client", connection: { origin: "https://192.168.1.20:51124", fingerprint: "a".repeat(64), hostId: "d7c9b6a4-695a-4d56-a5c4-a8bfb7751f35", storeName: "High Street" } });

// Execute only main.js in a VM. Inject every Electron, OS, network and local
// service dependency: no actual processes or user-data files are accessed.
const runStartup = async (config, options = {}) => {
    const calls = [], imports = [], windows = [], timers = [], intervals = [];
    const ipcHandlers = new Map();
    let startup, resolveExit;
    let verifyError = options.verifyError;
    let sharingEnabled = !!options.sharingEnabled;
    let remainingLoadFailures = options.loadFailures || 0;
    const exited = new Promise((resolve) => { resolveExit = resolve; });
    const app = new EventEmitter();
    app.requestSingleInstanceLock = () => { calls.push(["lock"]); return options.hasLock !== false; };
    app.whenReady = () => ({ then: (handler) => { startup = handler(); return startup; } });
    app.exit = (code) => { calls.push(["exit", code]); resolveExit(); };
    app.getVersion = () => "1.0.0";
    app.isPackaged = true;
    app.setLoginItemSettings = (settings) => calls.push(["login-item", settings.openAtLogin]);
    app.getLoginItemSettings = () => ({ openAtLogin: true });
    app.quit = () => { calls.push(["quit"]); app.emit("before-quit", { preventDefault: () => calls.push(["prevent-quit"]) }); };
    class Window extends EventEmitter {
        constructor(settings) {
            super();
            this.settings = settings;
            this.kind = settings.width === 1280 ? "main" : settings.width === 620 ? "reconnect" : "loading";
            this.destroyed = false;
            this.url = "";
            this.webContents = new EventEmitter();
            this.webContents.mainFrame = {};
            Object.defineProperty(this.webContents.mainFrame, "url", { get: () => this.url });
            this.webContents.getURL = () => this.url;
            this.webContents.setWindowOpenHandler = (handler) => { this.openHandler = handler; };
            windows.push(this);
            calls.push(["window", this.kind]);
        }
        loadFile(file, details) {
            this.file = file;
            const target = pathToFileURL(file);
            if (details?.query) for (const [key, value] of Object.entries(details.query)) target.searchParams.set(key, value);
            this.url = target.href;
            calls.push(["load-file", this.kind]);
            return Promise.resolve();
        }
        async loadURL(url) {
            this.url = url;
            calls.push(["load-url", url]);
            if (remainingLoadFailures-- > 0) throw new Error("Host page could not load");
        }
        show() { calls.push(["show", this.kind]); }
        hide() { calls.push(["hide", this.kind]); }
        focus() { calls.push(["focus", this.kind]); }
        isMinimized() { return false; }
        restore() { calls.push(["restore", this.kind]); }
        isDestroyed() { return this.destroyed; }
        close() {
            let prevented = false;
            this.emit("close", { preventDefault: () => { prevented = true; } });
            if (!prevented) this.destroy();
            return prevented;
        }
        destroy() { if (!this.destroyed) { this.destroyed = true; this.emit("closed"); } }
    }
    class Tray extends EventEmitter {
        setContextMenu(menu) { this.menu = menu; }
        setToolTip(text) { calls.push(["tray-tip", text]); }
        destroy() { calls.push(["destroy-tray"]); }
    }
    const localServices = {
        "./src/postgres": { start: async () => { calls.push(["postgres"]); if (options.databaseBarrier) await options.databaseBarrier; }, stop: async () => calls.push(["stop-postgres"]) },
        "./src/migrate": { run: async () => calls.push(["migrate"]) },
        "./src/backend": {
            start: (mode) => calls.push(["backend", mode]),
            waitUntilHealthy: async () => calls.push(["healthy"]),
            stop: async () => { calls.push(["stop-backend"]); await Promise.resolve(); if (options.backendStopError) throw options.backendStopError; calls.push(["stopped-backend"]); },
        },
    };
    const verifyConnection = async (connection) => { calls.push(["verify", connection.origin]); if (options.verifyBarrier) await options.verifyBarrier; if (verifyError) throw verifyError; return connection; };
    const sharing = {
        getStatus: () => ({ role: "host", enabled: sharingEnabled, autoStart: false }),
        resume: async () => calls.push(["resume-sharing"]),
        stop: async () => { calls.push(["stop-gateway"]); await Promise.resolve(); if (options.gatewayStopError) throw options.gatewayStopError; },
        enable: async () => { sharingEnabled = true; calls.push(["enable-sharing"]); return sharing.getStatus(); },
        disable: async () => { sharingEnabled = false; calls.push(["disable-sharing"]); return sharing.getStatus(); },
        getConnectionCode: async () => "verified-code", setAutoStart: async () => sharing.getStatus(),
    };
    const modules = {
        "node:path": path, "node:url": { pathToFileURL },
        electron: {
            app, BrowserWindow: Window, Tray, Menu: { buildFromTemplate: (menu) => menu }, nativeImage: { createFromPath: () => ({ resize: () => ({}) }) },
            ipcMain: { handle: (name, handler) => ipcHandlers.set(name, handler) },
            session: { fromPartition: (partition) => { calls.push(["session", partition]); return {}; } },
            powerSaveBlocker: { start: () => { calls.push(["block-sleep"]); return 7; }, stop: () => calls.push(["allow-sleep"]) },
            dialog: { showErrorBox: (_title, message) => calls.push(["error", message]), showMessageBox: async () => ({ response: 1 }) },
        },
        "./src/config": { BACKEND_URL: backendUrl, userData: "unused-user-data", pgDataDir: "unused-pg-data" },
        "./src/setup": { setup: async () => { calls.push(["setup"]); if (options.setupBarrier) await options.setupBarrier; if (options.setupError) throw options.setupError; return config; } },
        "./src/install-mode": { saveDesktopConfig: async (_directory, next) => calls.push(["save-config", next]) },
        "./src/setup-window": { requestConnection: async () => options.nextConnection || null },
        "./src/store-network": { verifyConnection, createStoreNetwork: async () => { calls.push(["create-network"]); return {}; } },
        "./src/firewall": { enablePrivateFirewall: async () => calls.push(["firewall"]) },
        "./src/sharing-controller": { createSharingController: () => sharing },
        "./src/window-security": { configureStoreSession: (_session, connection) => calls.push(["pin-session", connection.origin]), restrictWindow: () => {} },
        "./src/desktop-runtime": { createDesktopRuntime }, ...localServices,
        "./src/lazy-store-network": { createLazyStoreNetwork },
    };
    const entry = path.resolve(__dirname, "../main.js");
    vm.runInNewContext(await fs.readFile(entry, "utf8"), {
        require: (id) => { imports.push(id); assert.ok(modules[id], `unexpected import ${id}`); return modules[id]; },
        __dirname: path.dirname(entry), process: { on: () => {}, argv: options.background ? ["--winstore-background"] : [], execPath: "unused-electron", platform: "win32" },
        console, URL, setTimeout: (callback) => { timers.push(callback); return timers.length; },
        setInterval: (callback, delay) => { const interval = { callback, delay }; intervals.push(interval); return interval; },
        clearInterval: (interval) => { if (interval) interval.cleared = true; },
    }, { filename: entry });
    if (options.activateBeforeReady) app.emit("activate");
    if (options.releaseSetup) options.releaseSetup();
    if (options.quitDuringStartup) {
        await new Promise((resolve) => setImmediate(resolve));
        app.emit("before-quit", { preventDefault() {} });
        options.releaseDatabase?.();
        options.releaseVerify?.();
    }
    await startup;
    await new Promise((resolve) => setImmediate(resolve));
    return {
        app, calls, imports, windows, intervals, exited,
        main: () => windows.findLast((window) => window.kind === "main" && !window.isDestroyed()),
        reconnectWindow: () => windows.findLast((window) => window.kind === "reconnect" && !window.isDestroyed()),
        setVerifyError: (error) => { verifyError = error; },
        flushTimers: () => { for (const callback of timers.splice(0)) callback(); },
        invoke: (name, window, ...args) => ipcHandlers.get("winstore:" + name)({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, ...args),
        rawInvoke: (name, event, ...args) => ipcHandlers.get("winstore:" + name)(event, ...args),
    };
};
const names = (calls) => calls.map(([name]) => name);
const assertNoLocalServices = (ui) => {
    assert.equal(ui.imports.some((name) => ["./src/postgres", "./src/migrate", "./src/backend"].includes(name)), false);
    assert.equal(names(ui.calls).some((name) => ["postgres", "migrate", "backend", "create-network"].includes(name)), false);
};

test("a second instance exits before setup, windows or local service imports", async () => {
    const ui = await runStartup(host(), { hasLock: false });
    assert.deepEqual(ui.calls, [["lock"], ["exit", 0]]);
    assertNoLocalServices(ui);
});
test("cancelling or failing role setup never starts local services", async () => {
    for (const options of [{}, { setupError: new Error("Invalid saved settings") }]) {
        const ui = await runStartup(null, options);
        assertNoLocalServices(ui); assert.equal(ui.windows.length, 0);
        assert.deepEqual(ui.calls.at(-1), ["exit", options.setupError ? 1 : 0]);
    }
});
test("host setup completes before PostgreSQL, migrations and branch backend startup", async () => {
    let release;
    const setupBarrier = new Promise((resolve) => { release = resolve; });
    const ui = await runStartup(host(), { setupBarrier, releaseSetup: release, activateBeforeReady: true });
    const steps = names(ui.calls);
    assert.ok(steps.indexOf("setup") < steps.indexOf("postgres"));
    assert.ok(steps.indexOf("postgres") < steps.indexOf("migrate"));
    assert.ok(steps.indexOf("migrate") < steps.indexOf("backend"));
    assert.ok(steps.indexOf("healthy") < steps.indexOf("resume-sharing"));
    assert.equal(steps.includes("create-network"), false, "LAN identity is not created before sharing is enabled");
    assert.deepEqual(ui.calls.find(([name]) => name === "backend"), ["backend", "branch"]);
    assert.equal(ui.windows.filter((window) => window.kind === "main").length, 1);
});
for (const unavailable of [false, true]) {
    test(`client ${unavailable ? "with an unavailable host" : "connected to its host"} never imports or starts local business services`, async () => {
        const ui = await runStartup(client(), { verifyError: unavailable ? new Error("Host unavailable") : undefined });
        assertNoLocalServices(ui);
        assert.equal(!!ui.main(), !unavailable); assert.equal(!!ui.reconnectWindow(), unavailable);
        if (!unavailable) assert.deepEqual(ui.calls.find(([name]) => name === "load-url"), ["load-url", client().connection.origin]);
        ui.app.emit("before-quit", { preventDefault() {} }); await ui.exited;
        assertNoLocalServices(ui); assert.equal(ui.intervals[0].cleared, true);
    });
}
test("a sharing host hides its window and keeps gateway/backend/database running", async () => {
    const ui = await runStartup(host(), { sharingEnabled: true });
    const main = ui.main(); main.emit("ready-to-show");
    assert.equal(main.close(), true); assert.equal(main.isDestroyed(), false);
    ui.app.emit("window-all-closed");
    assert.ok(ui.calls.some(([name]) => name === "hide"));
    assert.equal(names(ui.calls).some((name) => ["quit", "stop-gateway", "stop-backend", "stop-postgres"].includes(name)), false);
    ui.app.emit("before-quit", { preventDefault() {} }); await ui.exited;
});
test("quit waits for gateway then backend before PostgreSQL, and duplicate quit events do not stop twice", async () => {
    const ui = await runStartup(host(), { sharingEnabled: true });
    ui.app.emit("before-quit", { preventDefault() {} }); ui.app.emit("before-quit", { preventDefault() {} }); await ui.exited;
    const steps = names(ui.calls);
    assert.ok(steps.indexOf("stop-gateway") < steps.indexOf("stop-backend"));
    assert.ok(steps.indexOf("stopped-backend") < steps.indexOf("stop-postgres"));
    assert.ok(steps.indexOf("stop-postgres") < steps.indexOf("exit"));
    assert.equal(steps.filter((name) => name === "stop-gateway").length, 1);
});
test("backend shutdown failure keeps PostgreSQL intact and reports a failing exit", async () => {
    const ui = await runStartup(host(), { backendStopError: new Error("Backend did not stop") });
    ui.app.emit("before-quit", { preventDefault() {} }); await ui.exited;
    assert.equal(names(ui.calls).includes("stop-postgres"), false);
    assert.ok(ui.calls.some(([name, message]) => name === "error" && message === "Backend did not stop"));
    assert.deepEqual(ui.calls.at(-1), ["exit", 1]);
});
test("sharing IPC rejects other windows, subframes and foreign origins", async () => {
    const ui = await runStartup(host()); const main = ui.main();
    for (const event of [{ sender: { mainFrame: {} }, senderFrame: {} }, { sender: main.webContents, senderFrame: { url: backendUrl } }]) {
        await assert.rejects(ui.rawInvoke("sharing-enable", event, "owner-token"), /cannot manage/);
    }
    main.url = "https://foreign.example"; await assert.rejects(ui.invoke("sharing-enable", main, "owner-token"), /cannot manage/);
    main.url = backendUrl; assert.equal((await ui.invoke("sharing-enable", main, "owner-token")).enabled, true);
    assert.equal(names(ui.calls).filter((name) => name === "enable-sharing").length, 1);
    ui.app.emit("before-quit", { preventDefault() {} }); await ui.exited;
});
test("unavailable client retries only from its own reconnect page and opens the pinned store when it returns", async () => {
    const ui = await runStartup(client(), { verifyError: new Error("Host unavailable") }); const reconnect = ui.reconnectWindow();
    reconnect.url = pathToFileURL(path.resolve(__dirname, "../setup.html")).href;
    await assert.rejects(ui.invoke("reconnect", reconnect), /cannot manage/);
    reconnect.url = pathToFileURL(path.resolve(__dirname, "../reconnect.html")).href + "?message=offline";
    await assert.rejects(ui.invoke("reconnect", reconnect), /Host unavailable/); assert.equal(!!ui.main(), false);
    ui.setVerifyError(undefined); await ui.invoke("reconnect", reconnect); ui.flushTimers();
    assert.ok(ui.main()); assert.equal(reconnect.isDestroyed(), true); assertNoLocalServices(ui);
    assert.ok(ui.calls.some(([name, origin]) => name === "pin-session" && origin === client().connection.origin));
    ui.app.emit("before-quit", { preventDefault() {} }); await ui.exited;
});
test("failed initial client page load shows reconnect and retry reloads the unloaded main window", async () => {
    const ui = await runStartup(client(), { loadFailures: 1 }); const main = ui.main(), reconnect = ui.reconnectWindow();
    assert.ok(main && reconnect); await ui.invoke("reconnect", reconnect); ui.flushTimers();
    assert.equal(ui.main(), main); assert.equal(names(ui.calls).filter((name) => name === "load-url").length, 2); assertNoLocalServices(ui);
    ui.app.emit("before-quit", { preventDefault() {} }); await ui.exited;
});
test("main-frame connection errors show reconnect while subresource or cancelled loads do not", async () => {
    const ui = await runStartup(client()); const main = ui.main();
    main.webContents.emit("did-fail-load", {}, -105, "Subresource unavailable", "", false);
    main.webContents.emit("did-fail-load", {}, -3, "Cancelled", "", true); assert.equal(ui.reconnectWindow(), undefined);
    main.webContents.emit("did-fail-load", {}, -105, "Host unavailable", "", true); assert.ok(ui.reconnectWindow()); assertNoLocalServices(ui);
    ui.app.emit("before-quit", { preventDefault() {} }); await ui.exited;
});

test("quit during PostgreSQL startup cannot later open the business window or resume store sharing", async () => {
    let releaseDatabase;
    const databaseBarrier = new Promise((resolve) => { releaseDatabase = resolve; });
    const ui = await runStartup(host(), { databaseBarrier, releaseDatabase, quitDuringStartup: true, sharingEnabled: true });
    await ui.exited;
    assert.equal(ui.windows.some((window) => window.kind === "main"), false);
    assert.equal(names(ui.calls).includes("resume-sharing"), false);
    assert.equal(names(ui.calls).includes("backend"), false);
    assert.equal(names(ui.calls).includes("stop-postgres"), true);
});

test("quit during a client probe never reopens a business/reconnect window or starts monitoring afterward", async () => {
    for (const unavailable of [false, true]) {
        let releaseVerify;
        const verifyBarrier = new Promise((resolve) => { releaseVerify = resolve; });
        const ui = await runStartup(client(), { verifyBarrier, releaseVerify, quitDuringStartup: true, verifyError: unavailable ? new Error("Host unavailable") : undefined });
        await ui.exited;
        assert.equal(ui.windows.some((window) => window.kind === "main" || window.kind === "reconnect"), false);
        assert.equal(ui.intervals.length, 0);
        assertNoLocalServices(ui);
    }
});

test("a connected client's valid frame can read status but cannot manage the host's sharing", async () => {
    const ui = await runStartup(client());
    const main = ui.main();
    const status = await ui.invoke("sharing-status", main);
    assert.equal(status.role, "client");
    assert.equal(status.address, client().connection.origin);
    await assert.rejects(ui.invoke("sharing-enable", main, "owner-token"), /main store PC/);
    await assert.rejects(ui.invoke("connection-code", main, "owner-token"), /main store PC/);
    assertNoLocalServices(ui);
    ui.app.emit("before-quit", { preventDefault() {} });
    await ui.exited;
});
