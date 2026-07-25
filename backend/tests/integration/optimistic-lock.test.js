/**
 * ============================================================
 * File: optimistic-lock.test.js
 * Module: Integration Tests — concurrent edits
 *
 * Description:
 * Proves optimistic concurrency control: when two people edit the same
 * record, the second save is rejected with 409 instead of silently
 * overwriting the first ("last write wins"). Also proves it's backward
 * compatible — a save that omits the version still succeeds.
 * ============================================================
 */

require("./helpers"); // MUST be first — points the app at the test schema.
const assert = require("node:assert/strict");
const { api, registerOwner, createStaff, itDb, useIntegrationDb } = require("./helpers");

useIntegrationDb();

const makeProduct = async (owner) => {
    const res = await api("POST", "/products", {
        token: owner.token,
        body: { name: "Panadol", sku: `PAN-${Math.random().toString(36).slice(2, 8)}`, price: 500 },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.data;
};

itDb("a stale edit is rejected with 409 instead of overwriting a newer one", async () => {
    const owner = await registerOwner();
    const product = await makeProduct(owner);

    // Two people load the same product: both hold version v1.
    const v1 = product.version;
    assert.ok(v1, "the API exposes a version token");

    // Ada saves a price change first — succeeds, bumping the version.
    const ada = await api("PATCH", `/products/${product.id}`, {
        token: owner.token,
        body: { price: 550, expectedVersion: v1 },
    });
    assert.equal(ada.status, 200, JSON.stringify(ada.body));
    assert.notEqual(ada.body.data.version, v1, "the version moves on after a save");
    assert.equal(ada.body.data.price, 550);

    // Bimpe, still holding v1, tries to save — must be refused, not clobber Ada.
    const bimpe = await api("PATCH", `/products/${product.id}`, {
        token: owner.token,
        body: { cost: 300, expectedVersion: v1 },
    });
    assert.equal(bimpe.status, 409, JSON.stringify(bimpe.body));

    // Ada's price change is intact.
    const after = (await api("GET", "/products", { token: owner.token })).body.data.find((p) => p.id === product.id);
    assert.equal(after.price, 550, "the first save survives");
    assert.equal(after.cost, 0, "the stale save did not apply");
});

itDb("re-fetching the current version lets the second edit go through", async () => {
    const owner = await registerOwner();
    const product = await makeProduct(owner);

    const first = await api("PATCH", `/products/${product.id}`, {
        token: owner.token,
        body: { price: 550, expectedVersion: product.version },
    });
    assert.equal(first.status, 200);

    // Reload to get the fresh version, then edit — succeeds.
    const second = await api("PATCH", `/products/${product.id}`, {
        token: owner.token,
        body: { cost: 300, expectedVersion: first.body.data.version },
    });
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(second.body.data.cost, 300);
});

itDb("staff records are guarded too (the transactional update path)", async () => {
    const owner = await registerOwner();
    const staff = await createStaff(owner, { resources: [] });

    const loaded = (await api("GET", "/users", { token: owner.token })).body.data.find((u) => u.id === staff.user.id);
    const v1 = loaded.version;
    assert.ok(v1, "staff rows expose a version");

    const first = await api("PATCH", `/users/${staff.user.id}`, {
        token: owner.token,
        body: { firstName: "Renamed", expectedVersion: v1 },
    });
    assert.equal(first.status, 200, JSON.stringify(first.body));

    // A second edit still holding v1 must be refused, not silently applied.
    const stale = await api("PATCH", `/users/${staff.user.id}`, {
        token: owner.token,
        body: { lastName: "TooLate", expectedVersion: v1 },
    });
    assert.equal(stale.status, 409, JSON.stringify(stale.body));

    // The rejected edit left no trace (transaction rolled back).
    const finalRow = (await api("GET", "/users", { token: owner.token })).body.data.find((u) => u.id === staff.user.id);
    assert.equal(finalRow.firstName, "Renamed");
    assert.equal(finalRow.lastName, "Member", "the stale lastName change did not apply");
});

itDb("an update that omits the version still works (backward compatible)", async () => {
    const owner = await registerOwner();
    const product = await makeProduct(owner);

    const res = await api("PATCH", `/products/${product.id}`, {
        token: owner.token,
        body: { price: 999 }, // no expectedVersion
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.price, 999);
});
