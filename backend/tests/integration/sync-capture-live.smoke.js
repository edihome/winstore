/**
 * ============================================================
 * File: sync-capture-live.smoke.js
 * Module: Offline-sync engine — live capture smoke (Phase 1)
 *
 * Not part of `npm test`: change-capture is gated by SYNC_ENABLED, which
 * orgContext reads once at module load, so it can only be exercised by a
 * process booted with it on. Run explicitly:
 *
 *   SYNC_ENABLED=true node tests/integration/sync-capture-live.smoke.js
 *
 * It proves the wiring the dormant suite can't: with sync enabled, a real
 * authenticated write flows through orgContext → the capture trigger →
 * sync_outbox, stamped with this install's node id; and applying a peer's
 * change does NOT echo back into the outbox.
 * ============================================================
 */

require("dotenv").config({ quiet: true });
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "integration-test-secret";
process.env.SYNC_ENABLED = "true"; // the whole point of this smoke

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { TEST_SCHEMA, appDatabaseUrl } = require("./testdb");
process.env.DATABASE_URL = appDatabaseUrl();

const app = require("../../src/app");
const pool = require("../../src/config/db");

let server;
let base;

const api = async (method, path, { token, body } = {}) => {
    const res = await fetch(`${base}${path}`, {
        method,
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    const parsed = await res.json().catch(() => ({}));
    return { status: res.status, body: parsed };
};

const { invalidateOrgSync } = require("../../src/middlewares/orgContext");

const outboxCount = async (org, rowId) =>
    pool.runPrivileged(async () => {
        const r = await pool.query(
            `SELECT COUNT(*)::int AS n, MAX(node_id::text) AS node FROM "${TEST_SCHEMA}".sync_outbox WHERE organization_id = $1 AND row_id = $2`,
            [org, rowId]
        );
        return r.rows[0];
    });

// Stand in for enrollment: flip the org's opt-in flag and clear the in-process
// cache so the next request re-reads it.
const enableOfflineForOrg = async (org) => {
    await pool.runPrivileged(async () => {
        await pool.query(`UPDATE "${TEST_SCHEMA}".organizations SET sync_enabled = true WHERE id = $1`, [org]);
    });
    invalidateOrgSync(org);
};

const createCustomer = (token, name) =>
    api("POST", "/customers", { token, body: { name, email: `c-${Math.random().toString(36).slice(2, 9)}@test.local`, phone: "08000000000" } });

const run = async () => {
    await new Promise((r) => (server = app.listen(0, r)));
    base = `http://127.0.0.1:${server.address().port}/api/v1`;

    const email = `sync-${Date.now().toString(36)}@test.local`;
    await api("POST", "/auth/register", { body: { firstName: "S", lastName: "O", email, password: "password123", organizationName: `Org ${email}` } });
    const login = await api("POST", "/auth/login", { body: { email, password: "password123" } });
    const token = login.body.data.token;
    const org = login.body.data.user.organizationId;

    // 0) GUARDRAIL: even with SYNC_ENABLED on, a NOT-yet-enrolled org captures
    //    nothing — the SaaS protection. (This is the whole point of §02.)
    const before = await createCustomer(token, "Pre-enroll Cust");
    assert.equal(before.status, 201, `create customer: ${JSON.stringify(before.body)}`);
    const beforeCap = await outboxCount(org, before.body.data.id);
    assert.equal(beforeCap.n, 0, "a non-offline org captures nothing even under SYNC_ENABLED");
    console.log("✔ guardrail: non-offline org is not captured");

    // Enroll the org (flip the per-org flag), then capture engages.
    await enableOfflineForOrg(org);

    // 1) A real write is now captured, stamped with this install's node id.
    const created = await createCustomer(token, "Captured Cust");
    assert.equal(created.status, 201, `create customer: ${JSON.stringify(created.body)}`);
    const custId = created.body.data.id;
    const cap = await outboxCount(org, custId);
    assert.ok(cap.n >= 1, "the write was captured into sync_outbox once enrolled");
    assert.ok(cap.node, "the captured change carries a node id");
    console.log(`✔ live capture: customer write logged (${cap.n} row, node ${cap.node.slice(0, 8)}…)`);

    // 2) status reflects enabled + a pending backlog.
    const status = await api("GET", "/sync/status", { token });
    assert.equal(status.body.data.enabled, true, "status.enabled true under SYNC_ENABLED");
    assert.equal(status.body.data.orgEnabled, true, "status.orgEnabled true once enrolled");
    assert.ok(status.body.data.pending >= 1, "pending backlog counted");
    console.log(`✔ status: enabled=true, orgEnabled=true, pending=${status.body.data.pending}`);

    // 3) Echo suppression: applying a peer's change must NOT re-log it.
    const peerId = crypto.randomUUID();
    const peerRow = { id: peerId, organization_id: org, name: "From Peer", email: `peer-${Date.now().toString(36)}@test.local`, phone: "0801", status: "active", credit_limit: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    const applied = await api("POST", "/sync/apply", { token, body: { changes: [{ table_name: "customers", op: "I", row_data: peerRow, seq: 1 }] } });
    assert.equal(applied.status, 200, `apply: ${JSON.stringify(applied.body)}`);
    const echo = await outboxCount(org, peerId);
    assert.equal(echo.n, 0, "applied peer change did NOT echo into the outbox");
    console.log("✔ echo suppression: applied change not re-captured");

    console.log("\nALL LIVE CAPTURE CHECKS PASSED");
};

run()
    .then(async () => {
        await new Promise((r) => server.close(r));
        await pool.end();
        process.exit(0);
    })
    .catch(async (err) => {
        console.error("SMOKE FAILED:", err.message);
        try {
            if (server) await new Promise((r) => server.close(r));
            await pool.end();
        } catch {}
        process.exit(1);
    });
