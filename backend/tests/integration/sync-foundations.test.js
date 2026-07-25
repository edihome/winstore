/**
 * ============================================================
 * File: sync-foundations.test.js
 * Module: Integration Tests — offline-sync engine (Phase 0)
 *
 * Description:
 * Proves the dormant change-capture foundations: with capture OFF (the
 * default everywhere) writes produce nothing; with capture ON a connection's
 * inserts/updates/deletes are logged to the outbox with the right op, node,
 * org, and row snapshot; the outbox is tenant-isolated; and each org gets one
 * idempotent self node. The rest of the suite staying green proves the
 * trigger is truly a no-op when off.
 * ============================================================
 */

require("./helpers"); // MUST be first — points the app at the test schema.
const assert = require("node:assert/strict");
const { api, registerOwner, itDb, useIntegrationDb, pool } = require("./helpers");
const { getSelfNodeId } = require("../../src/core/sync/sync.repository");

useIntegrationDb();

// Run raw SQL on a connection pinned to an org, optionally with capture on —
// exactly the GUCs the Phase 1 worker will set. Always resets on release so a
// pooled connection never leaks "capture on" back to the app.
const asNode = async (orgId, { capture = false, nodeId = null } = {}, fn) => {
    const client = await pool.pool.connect();
    try {
        await client.query("SELECT set_config('app.current_org', $1, false)", [orgId || ""]);
        if (capture) await client.query("SELECT set_config('app.sync_capture', 'on', false)");
        if (nodeId) await client.query("SELECT set_config('app.current_node', $1, false)", [nodeId]);
        return await fn(client);
    } finally {
        for (const g of ["app.current_org", "app.sync_capture", "app.current_node"]) {
            await client.query("SELECT set_config($1, '', false)", [g]).catch(() => {});
        }
        client.release();
    }
};

const makeCustomer = async (owner, name) => {
    const res = await api("POST", "/customers", {
        token: owner.token,
        body: { name, phone: "08000000000", email: `c-${Math.random().toString(36).slice(2, 9)}@test.local` },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.data;
};

const outboxCount = (orgId) =>
    asNode(orgId, {}, (client) => client.query("SELECT COUNT(*)::int AS n FROM sync_outbox")).then((r) => r.rows[0].n);

itDb("with capture off (the default), writes produce no outbox rows", async () => {
    const owner = await registerOwner();
    const customer = await makeCustomer(owner, "Ada");
    await asNode(owner.user.organizationId, { capture: false }, (client) =>
        client.query("UPDATE customers SET phone = '08111111111' WHERE id = $1", [customer.id])
    );
    assert.equal(await outboxCount(owner.user.organizationId), 0, "dormant — nothing captured");
});

itDb("with capture on, an update is logged with op, node, org, and row snapshot", async () => {
    const owner = await registerOwner();
    const org = owner.user.organizationId;
    const customer = await makeCustomer(owner, "Bola");
    const nodeId = await asNode(org, {}, (client) => getSelfNodeId(org, client));

    await asNode(org, { capture: true, nodeId }, (client) =>
        client.query("UPDATE customers SET phone = '08999999999' WHERE id = $1", [customer.id])
    );

    const rows = (
        await asNode(org, {}, (client) =>
            client.query("SELECT table_name, row_id, op, node_id, organization_id, row_data FROM sync_outbox ORDER BY seq")
        )
    ).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].table_name, "customers");
    assert.equal(rows[0].row_id, customer.id);
    assert.equal(rows[0].op, "U");
    assert.equal(rows[0].node_id, nodeId, "stamped with the writing node");
    assert.equal(rows[0].organization_id, org);
    assert.equal(rows[0].row_data.phone, "08999999999", "captured the row snapshot");
});

itDb("a delete is captured as op D (a shippable fact — no tombstone column needed)", async () => {
    const owner = await registerOwner();
    const org = owner.user.organizationId;
    const category = (await api("POST", "/categories", { token: owner.token, body: { name: "Temp" } })).body.data;

    await asNode(org, { capture: true }, (client) => client.query("DELETE FROM categories WHERE id = $1", [category.id]));

    const rows = (
        await asNode(org, {}, (client) =>
            client.query("SELECT op, row_id FROM sync_outbox WHERE table_name = 'categories'")
        )
    ).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].op, "D");
    assert.equal(rows[0].row_id, category.id);
});

itDb("the change log is tenant-isolated (RLS)", async () => {
    const a = await registerOwner();
    const b = await registerOwner();
    const custA = await makeCustomer(a, "A cust");
    await asNode(a.user.organizationId, { capture: true }, (client) =>
        client.query("UPDATE customers SET phone = '07000000000' WHERE id = $1", [custA.id])
    );

    assert.ok((await outboxCount(a.user.organizationId)) >= 1, "A logged its own change");
    assert.equal(await outboxCount(b.user.organizationId), 0, "B cannot see A's change log");
});

itDb("each org gets one idempotent self node", async () => {
    const owner = await registerOwner();
    const org = owner.user.organizationId;
    const id1 = await asNode(org, {}, (client) => getSelfNodeId(org, client));
    const id2 = await asNode(org, {}, (client) => getSelfNodeId(org, client));
    assert.equal(id1, id2, "the same self node every time");
});
