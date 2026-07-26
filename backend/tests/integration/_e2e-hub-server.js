/**
 * ============================================================
 * File: _e2e-hub-server.js
 * Module: Offline-sync engine — cross-node E2E (hub side)
 *
 * Boots the REAL app as the HUB node against an isolated second schema
 * (winstore_test_hub) on a fixed port, so the branch-side smoke can drive a
 * genuine two-instance reconcile over HTTP. Spawned by sync-e2e.smoke.js;
 * prints "HUB_READY <port>" once listening and shuts down on SIGTERM.
 * ============================================================
 */

require("dotenv").config({ quiet: true });
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "integration-test-secret";
process.env.SYNC_ENABLED = "true";
process.env.SYNC_NODE_KIND = "hub";

const { hubSchemaUrl } = require("./e2eSchema");
process.env.DATABASE_URL = hubSchemaUrl();

const app = require("../../src/app");
const pool = require("../../src/config/db");

const port = Number(process.env.E2E_HUB_PORT) || 5091;
const server = app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`HUB_READY ${port}`);
});

const shutdown = async () => {
    try {
        await new Promise((r) => server.close(r));
        await pool.end();
    } catch {
        /* best effort */
    }
    process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
