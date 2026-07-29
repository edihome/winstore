/**
 * ============================================================
 * File: pending-sales.test.js
 * Module: Integration Tests — held / parked sales
 *
 * A cart can be held, listed, resumed (its snapshot round-trips), and removed;
 * holding an empty cart is refused.
 * ============================================================
 */

require("./helpers");
const assert = require("node:assert/strict");
const { api, registerOwner, createStaff, itDb, useIntegrationDb } = require("./helpers");

useIntegrationDb();

const cart = [{ key: "p1", itemType: "product", label: "Tablet", unitPrice: 500, quantity: 2, productId: "11111111-1111-1111-1111-111111111111" }];

itDb("hold a cart, list it, resume its snapshot, then remove it", async () => {
    const owner = await registerOwner();
    const branchId = owner.user.branchId;

    const held = await api("POST", "/pending-sales", { token: owner.token, body: { branchId, label: "Ada", itemCount: 2, total: 1000, cart } });
    assert.equal(held.status, 201, JSON.stringify(held.body));
    const id = held.body.data.id;

    const list = await api("GET", `/pending-sales?branchId=${branchId}`, { token: owner.token });
    assert.equal(list.status, 200);
    const row = list.body.data.find((h) => h.id === id);
    assert.ok(row, "held sale is listed");
    assert.equal(row.item_count, 2);
    assert.equal(Number(row.total), 1000);
    assert.equal(row.label, "Ada");
    assert.deepEqual(row.cart, cart, "the cart snapshot round-trips for resume");

    const del = await api("DELETE", `/pending-sales/${id}`, { token: owner.token });
    assert.equal(del.status, 200);
    const after = await api("GET", `/pending-sales?branchId=${branchId}`, { token: owner.token });
    assert.ok(!after.body.data.some((h) => h.id === id), "gone after removal");
});

itDb("holding an empty cart is refused", async () => {
    const owner = await registerOwner();
    const res = await api("POST", "/pending-sales", { token: owner.token, body: { branchId: owner.user.branchId, cart: [] } });
    assert.equal(res.status, 400, JSON.stringify(res.body));
});

itDb("held sales are private to the user who held them", async () => {
    const owner = await registerOwner();
    const staff = await createStaff(owner, { resources: ["sales"] });
    const branchId = owner.user.branchId;

    const held = await api("POST", "/pending-sales", { token: owner.token, body: { branchId, label: "Owner's", itemCount: 1, total: 500, cart } });
    const id = held.body.data.id;

    // The other user doesn't see it…
    const staffList = await api("GET", `/pending-sales?branchId=${branchId}`, { token: staff.token });
    assert.ok(!staffList.body.data.some((h) => h.id === id), "another user can't see it");
    // …and can't delete it (scoped to created_by).
    assert.equal((await api("DELETE", `/pending-sales/${id}`, { token: staff.token })).status, 404, "another user can't remove it");
    // The owner still sees it.
    const ownerList = await api("GET", `/pending-sales?branchId=${branchId}`, { token: owner.token });
    assert.ok(ownerList.body.data.some((h) => h.id === id), "the owner sees their own");
});
