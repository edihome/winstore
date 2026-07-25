/**
 * ============================================================
 * File: setup-test-db.js
 * Module: Scripts
 *
 * Description:
 * One-time (idempotent) setup for the integration test database.
 * Integration tests run the real app against an ISOLATED schema so they
 * never touch development or production data. Using a separate schema
 * (rather than a separate database) means the ordinary app database user
 * can set it up — no CREATE DATABASE / superuser rights required.
 *
 * This script creates the "winstore_test" schema (if missing) and brings
 * it up to the latest migration, reusing the very same node-pg-migrate
 * binary the app's `npm run migrate` uses. The app's own queries are
 * unqualified, so at test time a search_path pointing at this schema is
 * all it takes to redirect the entire app onto the isolated tables (see
 * tests/integration/helpers.js).
 *
 * Pass "reset" to drop and rebuild the schema from scratch:
 *   node scripts/setup-test-db.js reset
 *
 * Usage:  npm run test:setup
 * ============================================================
 */

require("dotenv").config({ quiet: true });
const path = require("path");
const { spawnSync } = require("child_process");
const { Client } = require("pg");
const { TEST_SCHEMA, testDatabaseUrl } = require("../tests/integration/testdb");

/**
 * Ensure the isolated test schema exists (dropping it first when resetting).
 * Creating it up front — rather than leaving it to the migrator — matters:
 * the schema MUST exist before migrations run, so that unqualified
 * CREATE TABLEs land in it (their first search_path schema) instead of
 * falling through to real data in public.
 *
 * @param {boolean} reset Whether to drop the schema first.
 * @returns {Promise<void>}
 */
const ensureSchema = async (reset) => {
    const client = new Client({ connectionString: testDatabaseUrl() });
    await client.connect();
    try {
        if (reset) {
            await client.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
            console.log(`Dropped schema "${TEST_SCHEMA}".`);
        }
        await client.query(`CREATE SCHEMA IF NOT EXISTS ${TEST_SCHEMA}`);
    } finally {
        await client.end();
    }
};

/**
 * Bring the test schema up to the latest migration.
 *
 * @returns {void}
 */
const runMigrations = () => {
    const bin = path.join(__dirname, "..", "node_modules", "node-pg-migrate", "bin", "node-pg-migrate.js");
    // Two schemas on the path: the test schema FIRST (so unqualified
    // CREATE TABLEs land there) and public SECOND (so shared functions like
    // uuid_generate_v4, installed there, still resolve). The migrations
    // bookkeeping table is pinned to the test schema so it stays isolated too.
    const result = spawnSync(
        process.execPath,
        [
            bin,
            "up",
            "-m",
            "database/migrations",
            "--no-check-order",
            "--schema",
            TEST_SCHEMA,
            "--schema",
            "public",
            "--migrations-schema",
            TEST_SCHEMA,
        ],
        {
            cwd: path.join(__dirname, ".."),
            env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
            stdio: "inherit",
        }
    );
    if (result.status !== 0) {
        process.exit(result.status || 1);
    }
};

(async () => {
    await ensureSchema(process.argv.includes("reset"));
    runMigrations();
    console.log(`Integration test schema "${TEST_SCHEMA}" is ready.`);
})().catch((err) => {
    console.error(`Failed to set up the test database: ${err.message}`);
    process.exit(1);
});
