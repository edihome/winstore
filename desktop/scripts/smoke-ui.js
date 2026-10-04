// Run real Electron windows against a temporary TLS gateway and built frontend.
// The windows stay hidden; this never opens an installed business or firewall.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const desktopDir = path.resolve(__dirname, "..");

const runElectron = async () => {
    const http = require("node:http");
    const { app, BrowserWindow, ipcMain, session, nativeImage } = require("electron");
    const { createStoreNetwork, discoverPrivateAddresses, verifyConnection } = require("../src/store-network");
    const { configureStoreSession, restrictWindow } = require("../src/window-security");
    const { requestConnection } = require("../src/setup-window");
    const tempDir = process.argv[process.argv.indexOf("--smoke-data") + 1];
    assert.equal(path.dirname(path.resolve(tempDir)), desktopDir);
    assert.ok(path.basename(tempDir).startsWith(".ui-smoke-"));
    app.setPath("userData", tempDir);
    app.disableHardwareAcceleration();
    app.on("window-all-closed", () => {});
    const hiddenWindows = [];
    class HiddenWindow extends BrowserWindow {
        constructor(options) {
            super({ ...options, show: false, webPreferences: { ...options.webPreferences, offscreen: true, backgroundThrottling: false } });
            this.webContents.on("paint", (_event, _rect, image) => { this.lastPaint = image; });
            hiddenWindows.push(this);
        }
    }
    let backend, network;
    const captures = path.join(desktopDir, "dist", "verification");
    const frontend = path.resolve(desktopDir, "../frontend/dist");
    const waitFor = async (work, label) => {
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) { if (await work()) return; await new Promise((resolve) => setTimeout(resolve, 100)); }
        throw new Error(label + " did not become ready.");
    };
    const capture = async (window, name) => {
        window.webContents.startPainting();
        await window.webContents.executeJavaScript("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))");
        window.lastPaint = undefined;
        window.webContents.invalidate();
        await waitFor(() => Boolean(window.lastPaint && !window.lastPaint.isEmpty()), "Offscreen rendering");
        await fs.writeFile(path.join(captures, name), window.lastPaint.toPNG());
    };
    try {
        await app.whenReady();
        await fs.mkdir(captures, { recursive: true });
        backend = http.createServer(async (req, res) => {
            if (req.url === "/api/v1/health") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ success: true, version: "1.0.0" })); return; }
            try {
                const pathname = new URL(req.url, "http://test.invalid").pathname;
                const file = pathname.startsWith("/assets/") ? path.resolve(frontend, "." + pathname) : path.join(frontend, "index.html");
                assert.ok(file.startsWith(frontend + path.sep));
                res.setHeader("Content-Type", ({ ".js": "application/javascript", ".css": "text/css", ".png": "image/png" })[path.extname(file)] || "text/html");
                res.end(await fs.readFile(file));
            } catch { res.statusCode = 404; res.end("Not found"); }
        });
        await new Promise((resolve) => backend.listen(0, "127.0.0.1", resolve));
        const address = discoverPrivateAddresses()[0];
        if (!address) throw new Error("Connect this machine to a private IPv4 network for the real UI check.");
        network = await createStoreNetwork({ userData: tempDir, backendUrl: "http://127.0.0.1:" + backend.address().port, port: 0, allowLoopback: true });
        await network.start({ address, storeName: "Desktop UI verification" });
        const connection = await verifyConnection(network.getConnectionCode());
        const pairing = requestConnection({ BrowserWindow: HiddenWindow, ipcMain, verifyConnection, dialog: {
            showErrorBox: (_title, message) => { throw new Error(message); },
            showMessageBox: async (_window, options) => { assert.match(options.message, /Desktop UI verification/); return { response: 0 }; },
        } });
        const form = hiddenWindows.at(-1);
        assert.ok(form);
        form.hide();
        await waitFor(() => form.webContents.executeJavaScript("Boolean(document.getElementById('connection-code') && window.storeConnectionSetup)"), "Connection form");
        await capture(form, "connect-store.png");
        await form.webContents.executeJavaScript("document.getElementById('connection-code').value=" + JSON.stringify(network.getConnectionCode()) + ";document.getElementById('connection-form').requestSubmit()");
        const saved = await pairing;
        assert.equal(saved.hostId, connection.hostId);
        assert.equal(saved.fingerprint, connection.fingerprint);
        const storeSession = session.fromPartition("persist:ui-smoke");
        configureStoreSession(storeSession, connection);
        ipcMain.handle("winstore:sharing-status", () => ({ role: "client", enabled: false, address: connection.origin, storeName: connection.storeName }));
        const window = new HiddenWindow({ show: false, width: 1280, height: 840, webPreferences: {
            preload: path.join(desktopDir, "preload.js"), partition: "persist:ui-smoke", sandbox: true, contextIsolation: true, nodeIntegration: false,
            additionalArguments: ["--winstore-role=client"],
        } });
        restrictWindow(window, [connection.origin]);
        await window.loadURL(connection.origin + "/login");
        await waitFor(() => window.webContents.executeJavaScript("Boolean(document.querySelector('input[type=password]'))"), "Client sign-in");
        const state = await window.webContents.executeJavaScript("({role:window.winstoreDesktop.role,hasNode:typeof require!=='undefined',signup:[...document.querySelectorAll('button')].some(b=>/create account/i.test(b.textContent)),branchSetup:document.body.textContent.includes('Branch setup code')})");
        assert.equal(state.role, "client"); assert.equal(state.hasNode, false); assert.equal(state.signup, false); assert.equal(state.branchSetup, false);
        await capture(window, "client-login.png");
        await assert.rejects(window.loadFile(path.join(desktopDir, "reconnect.html")), /ERR_BLOCKED_BY_CLIENT/);
        // The paired network session deliberately refuses file: navigation.
        // Open the local recovery UI in its own isolated default session.
        window.destroy();
    } finally {
        for (const window of require("electron").BrowserWindow.getAllWindows()) window.destroy();
        await network?.stop();
        if (backend) await new Promise((resolve) => { backend.close(resolve); backend.closeAllConnections?.(); });
    }
    const recovery = new HiddenWindow({ show: false, width: 620, height: 440, webPreferences: { preload: path.join(desktopDir, "preload.js"), sandbox: true, contextIsolation: true, nodeIntegration: false, additionalArguments: ["--winstore-role=client"] } });
    await recovery.loadFile(path.join(desktopDir, "reconnect.html"), { query: { message: "Main store PC is unavailable." } });
    assert.match(await recovery.webContents.executeJavaScript("document.body.textContent"), /check Sales after reconnecting/);
    await capture(recovery, "reconnect.png");
    recovery.destroy();
    const icon = nativeImage.createFromPath(path.join(desktopDir, "icon.png")).resize({ width: 16, height: 16 });
    assert.equal(icon.isEmpty(), false, "host tray icon must be usable");
    console.log("UI SMOKE PASSED: real Electron pairing form, TLS-pinned React sign-in, client isolation, recovery screen and tray icon.");
    app.exit(0);
};

if (process.versions.electron) {
    runElectron().catch((error) => { console.error(error.stack); require("electron").app.exit(1); });
} else {
    (async () => {
        const { spawn } = require("node:child_process");
        const tempDir = await fs.mkdtemp(path.join(desktopDir, ".ui-smoke-"));
        try {
            const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
            const child = spawn(require("electron"), [__filename, "--smoke-data", tempDir], { cwd: desktopDir, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
            const timeout = setTimeout(() => child.kill(), 120000);
            child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
            const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
            clearTimeout(timeout);
            assert.equal(code, 0, "Electron UI smoke must complete successfully");
        } finally {
            assert.equal(path.dirname(path.resolve(tempDir)), desktopDir);
            assert.ok(path.basename(tempDir).startsWith(".ui-smoke-"));
            assert.equal((await fs.lstat(tempDir)).isSymbolicLink(), false);
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    })().catch((error) => { console.error(error.stack); process.exitCode = 1; });
}
