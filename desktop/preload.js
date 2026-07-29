/**
 * ============================================================
 * File: preload.js
 * Module: Winstore Desktop
 *
 * Minimal, context-isolated bridge. The app is the normal Winstore web app
 * loaded from the local backend, so it needs nothing special from Electron —
 * we expose only a version string for an "About" display.
 * ============================================================
 */

const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("winstoreDesktop", {
    isDesktop: true,
    version: process.env.npm_package_version || "1.0.0",
});
