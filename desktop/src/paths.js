/**
 * ============================================================
 * File: src/paths.js
 * Module: Winstore Desktop
 *
 * Resolves where the EXISTING backend + built frontend live, in both dev (the
 * sibling repo folders) and a packaged build (copied under resources/ by
 * electron-builder's extraResources). Nothing here writes to those trees — the
 * desktop app only reads them.
 * ============================================================
 */

const path = require("node:path");
const { app } = require("electron");

// dev  → repo root is two levels up from desktop/src
// prod → everything bundled lives under process.resourcesPath
const base = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "..", "..");

const backendDir = path.join(base, "backend");
const frontendDist = path.join(base, "frontend", "dist");

module.exports = {
    backendDir,
    frontendDist,
    serverEntry: path.join(backendDir, "src", "server.js"),
    migrationsDir: path.join(backendDir, "database", "migrations"),
    migrateBin: path.join(backendDir, "node_modules", "node-pg-migrate", "bin", "node-pg-migrate.js"),
};
