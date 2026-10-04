const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, dialog, ipcMain, session, Tray, Menu, nativeImage, powerSaveBlocker } = require("electron");
const { BACKEND_URL, userData, pgDataDir } = require("./src/config");
const { setup } = require("./src/setup");
const { saveDesktopConfig } = require("./src/install-mode");
const { requestConnection } = require("./src/setup-window");
const { createStoreNetwork, verifyConnection } = require("./src/store-network");
const { enablePrivateFirewall } = require("./src/firewall");
const { createSharingController } = require("./src/sharing-controller");
const { configureStoreSession, restrictWindow } = require("./src/window-security");
const { createDesktopRuntime } = require("./src/desktop-runtime");
const { createLazyStoreNetwork } = require("./src/lazy-store-network");
let config, sharing, runtime, mainWindow, loadingWindow, connectionWindow, tray, monitor;
let sleepBlocker = null;
let quitting = false;
let shutdownRequested = false;
let connecting = false;
let ready = false;
let mainLoaded = false;
const reconnectFile = path.join(__dirname, "reconnect.html");
process.on("unhandledRejection", (reason) => console.warn("[winstore]", reason?.message || reason));
const windowOptions = (role) => ({
    preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true,
    additionalArguments: ["--winstore-role=" + role, "--winstore-version=" + app.getVersion()],
});
const closeLoading = () => { if (loadingWindow && !loadingWindow.isDestroyed()) loadingWindow.close(); loadingWindow = null; };
const showMain = () => {
    if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
};
const syncHostBackground = () => {
    const hosting = sharing?.getStatus().enabled;
    if (hosting && sleepBlocker === null) sleepBlocker = powerSaveBlocker.start("prevent-app-suspension");
    if (!hosting && sleepBlocker !== null) { powerSaveBlocker.stop(sleepBlocker); sleepBlocker = null; }
    if (tray) tray.setToolTip(hosting ? "Winstore serving this store" : "Winstore");
};
const showConnection = (error) => {
    if (quitting) return;
    if (connectionWindow && !connectionWindow.isDestroyed()) { connectionWindow.show(); return; }
    connectionWindow = new BrowserWindow({ width: 620, height: 440, resizable: false,
        ...(mainWindow ? { parent: mainWindow, modal: true } : {}), webPreferences: windowOptions("client") });
    closeLoading();
    connectionWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    connectionWindow.webContents.on("will-navigate", (event) => event.preventDefault());
    connectionWindow.on("closed", () => { connectionWindow = null; });
    connectionWindow.loadFile(reconnectFile, { query: { message: String(error?.message || "The main store PC is unavailable.").slice(0, 600) } });
};
const openMain = () => {
    if (quitting) return;
    if (mainWindow && !mainWindow.isDestroyed()) { showMain(); return; }
    const target = config.role === "client" ? config.connection.origin : BACKEND_URL;
    const preferences = windowOptions(config.role);
    if (config.role === "client") {
        const partition = "persist:store-" + config.connection.hostId + "-" + config.connection.fingerprint;
        configureStoreSession(session.fromPartition(partition), config.connection);
        preferences.partition = partition;
    }
    mainWindow = new BrowserWindow({ width: 1280, height: 840, minWidth: 900, minHeight: 600, show: false, webPreferences: preferences });
    mainLoaded = false;
    const window = mainWindow;
    restrictWindow(window, [target]);
    window.webContents.on("did-finish-load", () => { mainLoaded = true; });
    window.once("ready-to-show", () => {
        closeLoading();
        if (!process.argv.includes("--winstore-background") || !sharing?.getStatus().enabled) window.show();
    });
    window.on("close", (event) => {
        if (!quitting && config.role === "host" && sharing?.getStatus().enabled) { event.preventDefault(); window.hide(); }
    });
    window.on("closed", () => { if (mainWindow === window) mainWindow = null; });
    window.webContents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
        if (config.role === "client" && isMainFrame && code !== -3) showConnection(new Error(description));
    });
    window.loadURL(target).catch((error) => { if (config.role === "client") showConnection(error); });
};
const chooseConnection = () => requestConnection({ BrowserWindow, ipcMain, dialog, verifyConnection, parent: connectionWindow || mainWindow || undefined });
const reconnect = async () => {
    if (config.role !== "client") throw new Error("This PC hosts the store.");
    if (connecting) throw new Error("A connection check is already running.");
    connecting = true;
    try {
        await verifyConnection(config.connection);
        if (mainWindow && !mainLoaded) await mainWindow.loadURL(config.connection.origin);
        else openMain();
        setTimeout(() => { if (connectionWindow && !connectionWindow.isDestroyed()) connectionWindow.close(); showMain(); }, 100);
    } finally { connecting = false; }
};
const changeConnection = async () => {
    if (config.role !== "client") throw new Error("Change the store connection on a connected checkout PC.");
    if (connecting) throw new Error("A connection check is already running.");
    connecting = true;
    try {
        const connection = await chooseConnection();
        if (!connection) return;
        const next = { version: 2, role: "client", connection };
        await saveDesktopConfig(userData, next);
        config = next;
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
        mainWindow = null;
        openMain();
        setTimeout(() => { if (connectionWindow && !connectionWindow.isDestroyed()) connectionWindow.close(); }, 100);
    } finally { connecting = false; }
};
const trustedSender = (event, allowReconnect = false) => {
    const contents = event.sender;
    if (event.senderFrame !== contents.mainFrame) return false;
    if (allowReconnect && connectionWindow && contents === connectionWindow.webContents) {
        try { const url = new URL(contents.getURL()); url.search = ""; return url.href === pathToFileURL(reconnectFile).href; } catch { return false; }
    }
    if (!mainWindow || contents !== mainWindow.webContents) return false;
    try { return new URL(event.senderFrame.url).origin === (config.role === "client" ? config.connection.origin : BACKEND_URL); } catch { return false; }
};
const registerIpc = () => {
    const handle = (name, handler, allowReconnect = false) => ipcMain.handle("winstore:" + name, async (event, ...args) => {
        if (!trustedSender(event, allowReconnect)) throw new Error("This window cannot manage the store connection.");
        return handler(...args);
    });
    const host = () => { if (!sharing) throw new Error("Manage sharing on the main store PC."); return sharing; };
    handle("sharing-status", () => sharing?.getStatus() || { role: "client", enabled: false, address: config.connection.origin, storeName: config.connection.storeName, autoStart: false }, true);
    handle("sharing-enable", async (token, address) => { const result = await host().enable(token, address); syncHostBackground(); return result; });
    handle("sharing-disable", async (token) => { const result = await host().disable(token); syncHostBackground(); return result; });
    handle("connection-code", (token) => host().getConnectionCode(token));
    handle("auto-start", (token, enabled) => host().setAutoStart(token, enabled));
    handle("reconnect", reconnect, true);
    handle("change-connection", changeConnection, true);
};
const stop = async (code = 0) => {
    if (shutdownRequested) return;
    shutdownRequested = true;
    quitting = true;
    clearInterval(monitor);
    try { await runtime?.stop(); } catch (error) { dialog.showErrorBox("Winstore couldn't close", error.message); code = 1; }
    if (sleepBlocker !== null) powerSaveBlocker.stop(sleepBlocker);
    tray?.destroy();
    app.exit(code);
};
const quitFromTray = async () => {
    if (sharing?.getStatus().enabled) {
        const { response } = await dialog.showMessageBox({ type: "warning", title: "Stop store server?", message: "Connected tills will lose access until Winstore starts again.", buttons: ["Keep running", "Stop store server"], defaultId: 0, cancelId: 0 });
        if (response !== 1) return;
    }
    await stop();
};
const makeTray = () => {
    const icon = nativeImage.createFromPath(path.join(__dirname, "icon.png")).resize({ width: 16, height: 16 });
    tray = new Tray(icon);
    tray.setContextMenu(Menu.buildFromTemplate([{ label: "Open Winstore", click: () => { openMain(); showMain(); } }, { type: "separator" }, { label: "Quit Winstore", click: quitFromTray }]));
    tray.on("double-click", showMain);
    syncHostBackground();
};
if (!app.requestSingleInstanceLock()) app.exit(0);
else {
    app.on("second-instance", () => { if (connectionWindow) connectionWindow.show(); else showMain(); });
    app.whenReady().then(async () => {
        try {
            config = await setup({ userData, pgDataDir, dialog, chooseConnection });
            if (!config) { app.exit(0); return; }
            registerIpc();
            loadingWindow = new BrowserWindow({ width: 460, height: 300, frame: false, resizable: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
            loadingWindow.loadFile(path.join(__dirname, "loading.html"));
            runtime = createDesktopRuntime({
                loadHostServices: () => ({ postgres: require("./src/postgres"), migrate: require("./src/migrate"), backend: require("./src/backend") }),
                verifyConnection,
            });
            if (config.role === "client") {
                ready = true;
                try { await runtime.start(config); if (!quitting) openMain(); } catch (error) { if (!quitting) showConnection(error); }
                if (quitting) return;
                monitor = setInterval(async () => {
                    if (connecting || connectionWindow || quitting) return;
                    const checking = config.connection;
                    try { await verifyConnection(checking); }
                    catch (error) { if (!connecting && !quitting && config.connection === checking) showConnection(error); }
                }, 10000);
                return;
            }
            await runtime.start(config);
            if (quitting) return;
            const network = createLazyStoreNetwork(() => createStoreNetwork({ userData, backendUrl: BACKEND_URL }));
            sharing = createSharingController({ config, backendUrl: BACKEND_URL, network,
                saveConfig: (next) => saveDesktopConfig(userData, next),
                configureFirewall: (address) => enablePrivateFirewall({ executablePath: process.execPath, port: 51124, address }),
                setLoginItem: (enabled) => {
                    if (!app.isPackaged || process.platform !== "win32") throw new Error("Startup at sign-in is available in the installed Windows application.");
                    app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args: ["--winstore-background"] });
                    if (app.getLoginItemSettings({ path: process.execPath, args: ["--winstore-background"] }).openAtLogin !== enabled) throw new Error("Windows did not save the startup setting.");
                },
            });
            runtime.setSharing(sharing);
            await sharing.resume();
            if (quitting) return;
            makeTray();
            ready = true;
            openMain();
        } catch (error) { dialog.showErrorBox("Winstore couldn't start", String(error?.message || error)); await stop(1); }
    });
    app.on("before-quit", (event) => { if (!quitting) { event.preventDefault(); stop(); } });
    app.on("window-all-closed", () => { if (ready && !quitting && !connecting && !(config?.role === "host" && sharing?.getStatus().enabled)) app.quit(); });
    app.on("activate", () => { if (ready && !quitting) openMain(); });
}
