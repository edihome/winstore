const { contextBridge, ipcRenderer } = require("electron");
const argument = (name) => process.argv.find((item) => item.startsWith("--" + name + "="))?.split("=")[1];
contextBridge.exposeInMainWorld("winstoreDesktop", Object.freeze({
    isDesktop: true,
    version: argument("winstore-version") || "1.0.0",
    role: argument("winstore-role") || "host",
    getSharingStatus: () => ipcRenderer.invoke("winstore:sharing-status"),
    enableSharing: (token, address) => ipcRenderer.invoke("winstore:sharing-enable", token, address),
    disableSharing: (token) => ipcRenderer.invoke("winstore:sharing-disable", token),
    getConnectionCode: (token) => ipcRenderer.invoke("winstore:connection-code", token),
    setAutoStart: (token, enabled) => ipcRenderer.invoke("winstore:auto-start", token, enabled),
    reconnect: () => ipcRenderer.invoke("winstore:reconnect"),
    changeConnection: () => ipcRenderer.invoke("winstore:change-connection"),
}));
