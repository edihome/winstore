/**
 * ============================================================
 * File: src/config.js
 * Module: Winstore Desktop
 *
 * Per-install runtime config: local ports, the embedded Postgres data dir, and
 * a JWT secret generated ONCE and stored in the OS user-data dir. All state
 * (database + secret) lives under app.getPath("userData"), never in the repo.
 * ============================================================
 */

const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { app } = require("electron");

const userData = app.getPath("userData");

// Loopback-only. Fixed ports keep it simple for a single desktop instance; if
// they're ever taken, change them here (or add port discovery).
const PG_PORT = 54329;
const BACKEND_PORT = 51123;

const DB_NAME = "winstore";
const DB_USER = "winstore";
const DB_PASSWORD = "winstore-local"; // local-only; the DB listens on 127.0.0.1 only

const DATABASE_URL = `postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${PG_PORT}/${DB_NAME}`;
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;

// One stable JWT secret per install (32+ bytes → passes the backend's prod
// strong-secret check). Generated on first run, then reused.
const secretFile = path.join(userData, "jwt-secret");
const getJwtSecret = () => {
    try {
        const existing = fs.readFileSync(secretFile, "utf8").trim();
        if (existing.length >= 32) return existing;
    } catch {
        /* not created yet */
    }
    const secret = crypto.randomBytes(48).toString("base64url");
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(secretFile, secret, { mode: 0o600 });
    return secret;
};

module.exports = {
    userData,
    pgDataDir: path.join(userData, "pgdata"),
    PG_PORT,
    BACKEND_PORT,
    DB_NAME,
    DB_USER,
    DB_PASSWORD,
    DATABASE_URL,
    BACKEND_URL,
    getJwtSecret,
};
