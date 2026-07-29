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

// embedded-postgres is ESM-only, so it's loaded with a dynamic import() from
// this CommonJS module (works in Electron's main process / Node).
let instance = null;
let EmbeddedPostgres = null;

const adminClient = () =>
    new Client({ host: "127.0.0.1", port: PG_PORT, user: DB_USER, password: DB_PASSWORD, database: "postgres" });

// Create the winstore database as UTF-8, or recreate it if a previous run made
// it in the wrong encoding (safe: at that point it only holds a failed, empty
// migration attempt — never real data).
const ensureUtf8Database = async () => {
    const client = adminClient();
    await client.connect();
    try {
        const { rows } = await client.query("SELECT pg_encoding_to_char(encoding) AS enc FROM pg_database WHERE datname = $1", [DB_NAME]);
        const createUtf8 = () =>
            client.query(`CREATE DATABASE ${DB_NAME} WITH ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`);

        if (rows.length === 0) {
            await createUtf8();
        } else if (rows[0].enc !== "UTF8") {
            await client.query(`DROP DATABASE ${DB_NAME}`);
            await createUtf8();
        }
    } finally {
        await client.end();
    }
};

const start = async () => {
    if (!EmbeddedPostgres) {
        ({ default: EmbeddedPostgres } = await import("embedded-postgres"));
    }
    instance = new EmbeddedPostgres({
        databaseDir: pgDataDir,
        user: DB_USER,
        password: DB_PASSWORD,
        port: PG_PORT,
        // Bind to loopback only — never expose the DB on the network.
        postgresFlags: ["-c", "listen_addresses=127.0.0.1"],
        persistent: true,
    });

    // initialise() runs initdb only when the data dir is empty (first launch).
    await instance.initialise();
    await instance.start();
    await ensureUtf8Database();
};

const stop = async () => {
    if (!instance) return;
    try {
        await instance.stop();
    } catch {
        /* best effort on shutdown */
    }
    instance = null;
};

module.exports = { start, stop };
