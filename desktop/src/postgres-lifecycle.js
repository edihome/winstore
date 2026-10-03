const fs = require("node:fs/promises");
const path = require("node:path");

// Keep this in sync with the PostgreSQL major version bundled by the desktop.
const PG_MAJOR_VERSION = "17";

const needsInitialisation = async (pgDataDir) => {
    try {
        const version = (await fs.readFile(path.join(pgDataDir, "PG_VERSION"), "utf8")).trim();
        if (version !== PG_MAJOR_VERSION) {
            throw new Error(`The local PostgreSQL cluster at ${pgDataDir} has version ${version || "unknown"}; this app requires ${PG_MAJOR_VERSION}. Existing data was left unchanged. Restore or upgrade the cluster before restarting Winstore.`);
        }
        return false;
    } catch (error) {
        // Only a missing version marker permits checking for a first-run dir.
        // Permission/read failures must never be mistaken for an empty cluster.
        if (error.code !== "ENOENT") throw error;
    }

    try {
        const entries = await fs.readdir(pgDataDir);
        if (entries.length > 0) {
            throw new Error(`The local database directory ${pgDataDir} is not empty but has no PG_VERSION. Existing files were left unchanged. Recover the cluster before restarting Winstore.`);
        }
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }
    return true;
};

// The loader and pg client are injected so lifecycle tests never start real
// PostgreSQL or read Electron's user-data directory.
const createPostgresManager = ({ config, Client, loadEmbeddedPostgres }) => {
    const { pgDataDir, PG_PORT, DB_NAME, DB_USER, DB_PASSWORD } = config;
    let instance = null;
    let EmbeddedPostgres = null;

    const ensureUtf8Database = async () => {
        const client = new Client({ host: "127.0.0.1", port: PG_PORT, user: DB_USER, password: DB_PASSWORD, database: "postgres" });
        await client.connect();
        try {
            const { rows } = await client.query("SELECT pg_encoding_to_char(encoding) AS enc FROM pg_database WHERE datname = $1", [DB_NAME]);
            if (rows.length === 0) {
                const quotedName = `"${DB_NAME.replace(/"/g, '""')}"`;
                await client.query(`CREATE DATABASE ${quotedName} WITH ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`);
            } else if (rows[0].enc !== "UTF8") {
                throw new Error(`The local database ${DB_NAME} uses ${rows[0].enc} instead of UTF8. Existing data was left unchanged. Back up and migrate the database to UTF8 before restarting Winstore.`);
            }
        } finally {
            await client.end();
        }
    };

    const start = async () => {
        const initialise = await needsInitialisation(pgDataDir);
        if (!EmbeddedPostgres) {
            ({ default: EmbeddedPostgres } = await loadEmbeddedPostgres());
        }
        instance = new EmbeddedPostgres({
            databaseDir: pgDataDir,
            user: DB_USER,
            password: DB_PASSWORD,
            port: PG_PORT,
            postgresFlags: ["-c", "listen_addresses=127.0.0.1"],
            persistent: true,
        });

        // embedded-postgres always runs initdb from initialise(); only call it
        // for a missing or empty cluster, never for a persisted installation.
        if (initialise) await instance.initialise();
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

    return { start, stop };
};

module.exports = { createPostgresManager };
