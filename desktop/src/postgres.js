/**
 * ============================================================
 * File: src/postgres.js
 * Module: Winstore Desktop
 *
 * Manages the BUNDLED PostgreSQL instance (via embedded-postgres): initialise
 * the data dir on first run, start it on loopback, ensure a UTF-8 winstore
 * database exists, and stop it cleanly on quit. The data dir lives under
 * userData, so uninstalling the app never touches the business's data.
 *
 * NOTE: the database is created explicitly as UTF-8 (from template0). On
 * Windows the cluster's default encoding is WIN1252, which can't store
 * characters like ₦ — so we must NOT rely on embedded-postgres.createDatabase()
 * (it inherits that default). We create it ourselves with a pg client.
 * ============================================================
 */

const { Client } = require("pg");
const { pgDataDir, PG_PORT, DB_NAME, DB_USER, DB_PASSWORD } = require("./config");

const { createPostgresManager } = require("./postgres-lifecycle");

module.exports = createPostgresManager({
    config: { pgDataDir, PG_PORT, DB_NAME, DB_USER, DB_PASSWORD },
    Client,
    // embedded-postgres is ESM-only; Electron's main process is CommonJS.
    loadEmbeddedPostgres: () => import("embedded-postgres"),
});
