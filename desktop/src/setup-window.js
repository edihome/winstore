// This file also acts as the isolated preload for the local connection form.
// The renderer receives only submit/cancel methods, never a general IPC bridge.
if (process.type === "renderer") {
    const { contextBridge, ipcRenderer } = require("electron");
    contextBridge.exposeInMainWorld("storeConnectionSetup", {
        verify: (input) => new Promise((resolve) => {
            ipcRenderer.once("winstore:setup:result", (_event, result) => resolve(result));
            ipcRenderer.send("winstore:setup:submit", input);
        }),
        cancel: () => ipcRenderer.send("winstore:setup:cancel"),
    });
} else {
    const path = require("node:path");
    const { validateDesktopConfig } = require("./install-mode");

    const requestConnection = ({ BrowserWindow, ipcMain, dialog, verifyConnection, parent }) => new Promise((resolve, reject) => {
        if (typeof verifyConnection !== "function") { reject(new Error("Store connection verification is unavailable.")); return; }
        const window = new BrowserWindow({
            width: 520,
            height: 460,
            resizable: false,
            ...(parent ? { parent, modal: true } : {}),
            title: "Connect to your store",
            webPreferences: { preload: __filename, contextIsolation: true, nodeIntegration: false, sandbox: true },
        });
        let settled = false;
        let verifying = false;
        const belongsToWindow = (event) => event.sender === window.webContents
            && (!event.senderFrame || event.senderFrame === window.webContents.mainFrame);
        const finish = (connection) => {
            if (settled) return;
            settled = true;
            ipcMain.removeListener("winstore:setup:submit", onSubmit);
            ipcMain.removeListener("winstore:setup:cancel", onCancel);
            resolve(connection);
            if (!window.isDestroyed()) window.close();
        };
        const reply = (result) => {
            if (!settled && !window.isDestroyed()) window.webContents.send("winstore:setup:result", result);
        };
        const onCancel = (event) => { if (belongsToWindow(event)) finish(null); };
        const onSubmit = async (event, input) => {
            if (!belongsToWindow(event) || settled || verifying) return;
            verifying = true;
            try {
                if (typeof input !== "string" || !input.trim() || input.length > 16384) throw new Error("Paste the connection code from the host computer.");
                const connection = validateDesktopConfig({ version: 2, role: "client", connection: await verifyConnection(input.trim()) }).connection;
                if (settled || window.isDestroyed()) return;
                const { response } = await dialog.showMessageBox(window, {
                    type: "question",
                    title: "Confirm your store",
                    message: `Connect to ${connection.storeName || "this store"}?`,
                    detail: "Check that this is the store shown on the host computer. Your tills will share its sales and stock.",
                    buttons: ["Connect", "Cancel"],
                    defaultId: 0,
                    cancelId: 1,
                    noLink: true,
                });
                if (response === 0) finish(connection);
                else reply({ ok: false, message: "Connection cancelled. Check the host code and try again." });
            } catch (error) {
                reply({ ok: false, message: error.message || "The store could not be reached. Check the code and try again." });
            } finally { verifying = false; }
        };
        ipcMain.on("winstore:setup:submit", onSubmit);
        ipcMain.on("winstore:setup:cancel", onCancel);
        window.once("closed", () => finish(null));
        window.webContents.on("will-navigate", (event) => event.preventDefault());
        window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        window.loadFile(path.join(__dirname, "../setup.html")).catch((error) => {
            if (settled) return;
            dialog.showErrorBox("Store setup could not open", error.message);
            finish(null);
        });
    });

    module.exports = { requestConnection };
}
