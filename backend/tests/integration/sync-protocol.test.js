/**
 * ============================================================
 * File: sync-protocol.test.js
 * Module: Integration Tests — offline-sync engine (Phase 1)
 *
 * Description:
 * Proves the sync HTTP protocol: applying a peer's batch is idempotent and
 * handles insert/update/delete; a batch can never cross tenants (RLS);
 * pulling returns this org's change log after a watermark; and status
 * reports the outbox depth. (Echo-suppression when capture is live is proven
 * by the live smoke, which boots with SYNC_ENABLED.)
 * ============================================================
 */

require("./helpers"); // MUST be first — points the app at the test schema.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { api, registerOwner, itDb, useIntegrationDb, pool } = require("./helpers");

useIntegrationDb();

const asOrg = async (orgId, fn) => {
    const client = await pool.pool.connect();
    try {
        await client.query("SELECT set_config('app.current_org', $1, false)", [orgId || ""]);
        return await fn(client);
    } finally {
        await client.query("SELECT set_config('app.current_org', '', false)").catch(() => {});
        client.release();
    }
};

// A full customers row snapshot, as the capture trigger would record it.
const customerRow = (orgId, over = {}) => ({
    id: over.id || crypto.randomUUID(),
    organization_id: orgId,
    name: over.name || "Synced Cust",
    email: over.email || `s-${Math.random().toString(36).slice(2, 9)}@test.local`,
    phone: over.phone || "08000000000",
    status: "active",
    credit_limit: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
});

const findCustomer = async (owner, id) =>
    (await api("GET", "/customers", { token: owner.token })).body.data.find((c) => c.id === id);

itDb("apply inserts a row and is idempotent", async () => {
    const owner = await registerOwner();
    const row = customerRow(owner.user.organizationId, { name: "From Branch" });
    const change = { table_name: "customers", op: "I", row_data: row, seq: 1 };

    const first = await api("POST", "/sync/apply", { token: owner.token, body: { changes: [change] } });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.data.applied, 1);

    await api("POST", "/sync/apply", { token: owner.token, body: { changes: [change] } }); // again

    const all = (await api("GET", "/customers", { token: owner.token })).body.data.filter((c) => c.id === row.id);
    assert.equal(all.length, 1, "applied once, not duplicated");
    assert.equal(all[0].name, "From Branch");
});

itDb("apply handles update then delete", async () => {
    const owner = await registerOwner();
    const org = owner.user.organizationId;
    const row = customerRow(org, { name: "Ada" });
    await api("POST", "/sync/apply", { token: owner.token, body: { changes: [{ table_name: "customers", op: "I", row_data: row, seq: 1 }] } });

    await api("POST", "/sync/apply", {
        token: owner.token,
        body: { changes: [{ table_name: "customers", op: "U", row_data: { ...row, phone: "08111111111" }, seq: 2 }] },
    });
    assert.equal((await findCustomer(owner, row.id)).phone, "08111111111", "update applied");

    await api("POST", "/sync/apply", {
        token: owner.token,
        body: { changes: [{ table_name: "customers", op: "D", row_id: row.id, seq: 3 }] },
    });
    assert.equal(await findCustomer(owner, row.id), undefined, "delete applied");
});

itDb("apply cannot write another tenant's row (RLS)", async () => {
    const a = await registerOwner();
    const b = await registerOwner();
    // Org A tries to apply a row stamped for org B.
    const foreign = customerRow(b.user.organizationId, { name: "Hacked" });
    const res = await api("POST", "/sync/apply", { token: a.token, body: { changes: [{ table_name: "customers", op: "I", row_data: foreign, seq: 1 }] } });
    // Resilient apply quarantines the row (RLS blocks the write) and logs it,
    // rather than failing the batch — but the security property is the same:
    // the foreign row is NOT written.
    assert.equal(res.body.data.applied, 0, "nothing applied");
    assert.equal(res.body.data.failed, 1, "the cross-tenant row was quarantined");
    assert.equal(await findCustomer(b, foreign.id), undefined, "B never received it");
});

itDb("a poison row is quarantined without blocking the rest of the batch", async () => {
    const owner = await registerOwner();
    const org = owner.user.organizationId;
    const good = customerRow(org, { name: "Good" });
    const bad = { ...customerRow(org, { name: "Bad" }), email: null }; // customers.email is NOT NULL

    const res = await api("POST", "/sync/apply", {
        token: owner.token,
        body: { changes: [{ table_name: "customers", op: "I", row_data: good, seq: 1 }, { table_name: "customers", op: "I", row_data: bad, seq: 2 }] },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.applied, 1, "the good row applied");
    assert.equal(res.body.data.failed, 1, "the poison row was quarantined, not fatal");

    const customers = (await api("GET", "/customers", { token: owner.token })).body.data;
    assert.ok(customers.some((c) => c.id === good.id), "good row present");
    assert.ok(!customers.some((c) => c.id === bad.id), "poison row absent");
});

itDb("changes returns this org's log after a watermark", async () => {
    const owner = await registerOwner();
    const org = owner.user.organizationId;
    // Seed two outbox rows directly (as the capture trigger would).
    await asOrg(org, (client) =>
        client.query(
            `INSERT INTO sync_outbox (organization_id, table_name, row_id, op, row_data)
             VALUES ($1,'customers',$2,'I','{}'::jsonb), ($1,'customers',$3,'I','{}'::jsonb)`,
            [org, crypto.randomUUID(), crypto.randomUUID()]
        )
    );

    const all = await api("GET", "/sync/changes?since=0", { token: owner.token });
    assert.equal(all.body.data.length, 2, "everything since 0");
    const lastSeq = all.body.data[all.body.data.length - 1].seq;
    const after = await api("GET", `/sync/changes?since=${lastSeq}`, { token: owner.token });
    assert.equal(after.body.data.length, 0, "nothing after the newest seq");
});

itDb("status reports outbox depth and that sync is off by default", async () => {
    const owner = await registerOwner();
    const org = owner.user.organizationId;
    await asOrg(org, (client) =>
        client.query(`INSERT INTO sync_outbox (organization_id, table_name, row_id, op, row_data) VALUES ($1,'customers',$2,'I','{}'::jsonb)`, [org, crypto.randomUUID()])
    );
    const res = await api("GET", "/sync/status", { token: owner.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.enabled, false);
    assert.equal(res.body.data.hubConfigured, false);
    assert.ok(res.body.data.pending >= 1);
});
