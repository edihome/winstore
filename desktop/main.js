/**
 * ============================================================
 * File: main.js
 * Module: Winstore Desktop (Electron main process)
 *
 * Orchestrates a local, self-contained Winstore:
 *   1. start the bundled PostgreSQL,
 *   2. run the backend's migrations,
 *   3. spawn the backend (production mode → serves API + built app on loopback),
 *   4. open a window to it.
 * On quit it shuts the backend and Postgres down cleanly. Everything it runs is
 * the UNMODIFIED backend/frontend from the sibling folders.
 * ============================================================
 */

const path = require("node:path");
const { app, BrowserWindow, dialog } = require("electron");

const postgres = require("./src/postgres");
const migrate = require("./src/migrate");
const backend = require("./src/backend");
const { BACKEND_URL } = require("./src/config");

let mainWindow = null;
let loadingWindow = null;
let shuttingDown = false;

// embedded-postgres (a pre-release) can emit a stray unhandled rejection from
// its own internals; log it but never let it crash the app. Real startup
// failures are surfaced via the try/catch below, not here.
process.on("unhandledRejection", (reason) => {
    // eslint-disable-next-line no-console
    console.warn("[winstore] unhandled rejection:", (reason && reason.message) || reason);
});

const openLoading = () => {
    loadingWindow = new BrowserWindow({
        width: 460,
        height: 300,
        frame: false,
        resizable: false,
        center: true,
        webPreferences: { contextIsolation: true },
    });
    loadingWindow.loadFile(path.join(__dirname, "loading.html"));
};

const openMain = () => {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 840,
        minWidth: 900,
        minHeight: 600,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    mainWindow.once("ready-to-show", () => {
        if (loadingWindow) {
            loadingWindow.close();
            loadingWindow = null;
        }
        mainWindow.show();
    });
    mainWindow.loadURL(BACKEND_URL);
};

const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    backend.stop();
    await postgres.stop();
};

app.whenReady().then(async () => {
    openLoading();
    try {
        await postgres.start();
        await migrate.run();
        backend.start();
        await backend.waitUntilHealthy();
        openMain();
    } catch (error) {
        dialog.showErrorBox("Winstore couldn't start", String((error && error.message) || error));
        await shutdown();
        app.exit(1);
    }
});

// Stop the child services before the app actually quits.
app.on("before-quit", (event) => {
    if (shuttingDown) return;
    event.preventDefault();
    shutdown().finally(() => app.exit(0));
});

app.on("window-all-closed", () => {
    app.quit(); // triggers before-quit → shutdown
});

app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && !shuttingDown) {
        openMain();
    }
});
