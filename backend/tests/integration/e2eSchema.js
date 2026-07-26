/**
 * ============================================================
 * File: e2eSchema.js
 * Module: Offline-sync engine — cross-node E2E helpers
 *
 * The E2E proof needs a SECOND isolated schema to stand in for the central
 * hub's database (the branch keeps using winstore_test). This mirrors
 * testdb.js but for winstore_test_hub: a plain URL for migrations and a
 * search_path-pinned URL for the hub app instance.
 * ============================================================
 */

const HUB_SCHEMA = "winstore_test_hub";

const baseUrl = () => {
    const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
    if (!url) {
        throw new Error("Neither TEST_DATABASE_URL nor DATABASE_URL is set — cannot locate a test database.");
    }
    // Strip any search_path options a caller may already have pinned, so this
    // returns the bare server URL regardless of who set it.
    const u = new URL(url);
    u.search = "";
    return u.toString();
};

const hubSchemaUrl = () => {
    const u = new URL(baseUrl());
    u.search = `options=${encodeURIComponent(`-c search_path=${HUB_SCHEMA},public`)}`;
    return u.toString();
};

module.exports = { HUB_SCHEMA, baseUrl, hubSchemaUrl };
