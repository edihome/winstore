/**
 * ============================================================
 * File: testdb.js
 * Module: Integration Tests
 *
 * Description:
 * Single source of truth for how the integration tests reach an isolated
 * database. Tests never touch real data: the whole app is redirected onto
 * a dedicated "winstore_test" schema by pinning the connection's
 * search_path to it. Because the app's SQL is unqualified, that one knob
 * moves every query onto the test tables — no code changes, no separate
 * database, and no CREATE DATABASE privilege required.
 *
 * See scripts/setup-test-db.js (creates + migrates the schema) and
 * tests/integration/helpers.js (boots the app against it).
 * ============================================================
 */

const TEST_SCHEMA = "winstore_test";

const requireDatabaseUrl = () => {
    const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
    if (!url) {
        throw new Error("Neither TEST_DATABASE_URL nor DATABASE_URL is set — cannot locate a test database.");
    }
    return url;
};

/**
 * Plain connection string for the server hosting the test schema.
 * Migrations connect with this plus an explicit --schema flag.
 *
 * @returns {string} PostgreSQL connection string.
 */
const testDatabaseUrl = () => requireDatabaseUrl();

/**
 * The connection string the APP pool uses at test time: same server, but
 * with its search_path pinned to the isolated test schema (falling back to
 * public for shared objects like extensions and gen_random_uuid), so every
 * unqualified query the app runs lands on the test tables.
 *
 * @returns {string} PostgreSQL connection string with a pinned search_path.
 */
const appDatabaseUrl = () => {
    const url = new URL(requireDatabaseUrl());
    // encodeURIComponent (not URLSearchParams) so the space becomes %20, not
    // "+": libpq reads the value literally and "+" would not mean a space.
    url.search = `options=${encodeURIComponent(`-c search_path=${TEST_SCHEMA},public`)}`;
    return url.toString();
};

module.exports = { TEST_SCHEMA, testDatabaseUrl, appDatabaseUrl };
