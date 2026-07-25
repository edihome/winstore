/**
 * ============================================================
 * File: rls.test.js
 * Module: Integration Tests — tenant isolation at the database
 *
 * Description:
 * Proves that Row Level Security isolates organizations at the DATABASE,
 * independently of any application WHERE clause. Each test deliberately
 * issues UNFILTERED SQL (no "WHERE organization_id = …") on a connection
 * carrying a given tenant context, and asserts the database itself returns
 * or touches only that tenant's rows — the guarantee that a future forgotten
 * filter can never leak across tenants.
 * ============================================================
 */

require("./helpers"); // MUST be first — points the app at the test schema.
const assert = require("node:assert/strict");
const { api, registerOwner, itDb, useIntegrationDb, pool } = require("./helpers");

useIntegrationDb();

// Run raw SQL on a connection pinned to a tenant context, exactly as the app
// sets per request — but the SQL here omits any org filter on purpose.
const asOrg = async (orgId, sql, params = []) => {
    const client = await pool.pool.connect();
    try {
        await client.query("SELECT set_config('app.current_org', $1, false)", [orgId || ""]);
        return await client.query(sql, params);
    } finally {
        await client.query("SELECT set_config('app.current_org', '', false)").catch(() => {});
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

itDb("an unfiltered query returns only the current org's rows", async () => {
    const a = await registerOwner();
    const b = await registerOwner();
    await makeCustomer(a, "Alice of A");
    await makeCustomer(b, "Bob of B");

    const seenByA = await asOrg(a.user.organizationId, "SELECT name FROM customers");
    const seenByB = await asOrg(b.user.organizationId, "SELECT name FROM customers");

    assert.deepEqual(
        seenByA.rows.map((r) => r.name),
        ["Alice of A"]
    );
    assert.deepEqual(
        seenByB.rows.map((r) => r.name),
        ["Bob of B"]
    );
});

itDb("with no tenant context set, an unfiltered query returns nothing (safe default)", async () => {
    const a = await registerOwner();
    await makeCustomer(a, "Alice of A");

    const none = await asOrg(null, "SELECT name FROM customers");
    assert.equal(none.rows.length, 0, "no context must mean no rows, never another tenant's data");
});

itDb("one org cannot read or update another org's row even by primary key", async () => {
    const a = await registerOwner();
    const b = await registerOwner();
    const bCustomer = await makeCustomer(b, "Bob of B");

    // Org A, addressing org B's row directly by id (no org filter):
    const readByA = await asOrg(a.user.organizationId, "SELECT name FROM customers WHERE id = $1", [bCustomer.id]);
    assert.equal(readByA.rows.length, 0, "org A must not see org B's row");

    const updateByA = await asOrg(a.user.organizationId, "UPDATE customers SET name = 'hacked' WHERE id = $1", [
        bCustomer.id,
    ]);
    assert.equal(updateByA.rowCount, 0, "org A must not be able to update org B's row");

    // B's row is untouched.
    const still = await asOrg(b.user.organizationId, "SELECT name FROM customers WHERE id = $1", [bCustomer.id]);
    assert.equal(still.rows[0].name, "Bob of B");
});
