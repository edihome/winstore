const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { requestConnection } = require("../src/setup-window");

const connection = { origin: "https://192.168.1.20:51124", fingerprint: "b".repeat(64), hostId: "5dd320e1-c1dd-4ac0-96dd-d1a9551a9563", storeName: "High Street" };
const flush = () => new Promise((resolve) => setImmediate(resolve));
const harness = (verifyConnection, responses = [0]) => {
    const ipcMain = new EventEmitter();
    let window;
    const confirmations = [];
    class Window extends EventEmitter {
        constructor(options) {
            super();
            this.options = options;
            this.destroyed = false;
            this.webContents = new EventEmitter();
            this.webContents.mainFrame = {};
            this.messages = [];
            this.webContents.send = (channel, result) => this.messages.push([channel, result]);
            this.webContents.setWindowOpenHandler = (handler) => { this.openHandler = handler; };
            window = this;
        }
        isDestroyed() { return this.destroyed; }
        close() { if (!this.destroyed) { this.destroyed = true; this.emit("closed"); } }
        loadFile(file) { this.loadedFile = file; return Promise.resolve(); }
    }
    const result = requestConnection({ BrowserWindow: Window, ipcMain, verifyConnection, dialog: {
        showMessageBox: async (parent, options) => { assert.equal(parent, window); confirmations.push(options); return { response: responses.shift() }; },
        showErrorBox: () => assert.fail("local form should load"),
    } });
    const sender = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
    return { window, ipcMain, result, confirmations,
        submit: (input = "store code", event = sender) => ipcMain.emit("winstore:setup:submit", event, input),
        cancel: (event = sender) => ipcMain.emit("winstore:setup:cancel", event),
    };
};

test("setup accepts only its own main frame and confirms the verified store before returning a connection", async () => {
    let probes = 0;
    const ui = harness(async () => { probes++; return connection; });
    assert.equal(ui.window.options.webPreferences.nodeIntegration, false);
    assert.equal(ui.window.options.webPreferences.contextIsolation, true);
    assert.equal(ui.window.options.webPreferences.sandbox, true);
    ui.submit("other window", { sender: {}, senderFrame: {} });
    ui.submit("child frame", { sender: ui.window.webContents, senderFrame: {} });
    ui.cancel({ sender: {}, senderFrame: {} });
    await flush();
    assert.equal(probes, 0);
    assert.equal(ui.window.isDestroyed(), false);
    ui.submit();
    assert.deepEqual(await ui.result, connection);
    assert.equal(probes, 1);
    assert.match(ui.confirmations[0].message, /High Street/);
    assert.equal(ui.window.isDestroyed(), true);
    assert.equal(ui.ipcMain.listenerCount("winstore:setup:submit"), 0);
    assert.equal(ui.ipcMain.listenerCount("winstore:setup:cancel"), 0);
});

test("failed verification and declined confirmation allow another code without saving a connection", async () => {
    let probes = 0;
    const ui = harness(async () => { if (++probes === 1) throw new Error("Host is unavailable"); return connection; }, [1, 0]);
    ui.submit();
    await flush();
    assert.deepEqual(ui.window.messages[0], ["winstore:setup:result", { ok: false, message: "Host is unavailable" }]);
    assert.equal(ui.confirmations.length, 0);
    ui.submit();
    await flush();
    assert.equal(ui.window.isDestroyed(), false);
    assert.match(ui.window.messages[1][1].message, /cancelled/);
    ui.submit();
    assert.deepEqual(await ui.result, connection);
    assert.equal(probes, 3);
    assert.equal(ui.confirmations.length, 2);
});

test("cancelling during a probe returns null and ignores its eventual result", async () => {
    let complete;
    const pending = new Promise((resolve) => { complete = resolve; });
    const ui = harness(() => pending);
    ui.submit();
    ui.cancel();
    assert.equal(await ui.result, null);
    complete(connection);
    await flush();
    assert.equal(ui.confirmations.length, 0);
    assert.deepEqual(ui.window.messages, []);
    assert.equal(ui.ipcMain.listenerCount("winstore:setup:submit"), 0);
});

test("invalid verified identity stays on the local form and cannot open another origin", async () => {
    const ui = harness(async () => ({ ...connection, fingerprint: "wrong certificate" }));
    ui.submit();
    await flush();
    assert.equal(ui.confirmations.length, 0);
    assert.match(ui.window.messages[0][1].message, /fingerprint/);
    let prevented = false;
    ui.window.webContents.emit("will-navigate", { preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    assert.deepEqual(ui.window.openHandler(), { action: "deny" });
    ui.cancel();
    assert.equal(await ui.result, null);
});
