/**
 * ============================================================
 * File: stock-shipments.test.js
 * Module: Integration Tests — cross-branch shipments (async two-step transfer)
 *
 * Ship deducts the source now and creates an in_transit record; receive lands
 * the stock at the destination and completes it; a shipment can't be received
 * twice; cancel returns the stock to the source; and a short shipment is
 * refused.
 * ============================================================
 */

require("./helpers");
const assert = require("node:assert/strict");
const { api, registerOwner, itDb, useIntegrationDb } = require("./helpers");

useIntegrationDb();

const makeProduct = async (owner, openingStock = 0) => {
    const res = await api("POST", "/products", {
        token: owner.token,
        body: { name: "Tablet", sku: `SKU-${Math.random().toString(36).slice(2, 8)}`, price: 500, branchId: owner.user.branchId, openingStock },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.data;
};

const secondBranch = async (owner) => {
    const res = await api("POST", "/branches", { token: owner.token, body: { name: "Branch B", code: `B-${Math.random().toString(36).slice(2, 7)}` } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.data.id;
};

const qtyAt = async (owner, branchId, productId) => {
    const res = await api("GET", `/inventory?branchId=${branchId}&productId=${productId}`, { token: owner.token });
    const row = (res.body.data || []).find((r) => r.productId === productId);
    return row ? Number(row.quantity) : 0;
};

const ship = (owner, body) => api("POST", "/shipments", { token: owner.token, body });

itDb("ship deducts the source and creates an in_transit shipment", async () => {
    const owner = await registerOwner();
    const from = owner.user.branchId;
    const to = await secondBranch(owner);
    const product = await makeProduct(owner, 30);

    const res = await ship(owner, { productId: product.id, fromBranchId: from, toBranchId: to, quantity: 12 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.status, "in_transit");
    assert.equal(await qtyAt(owner, from, product.id), 18, "source deducted immediately");
    assert.equal(await qtyAt(owner, to, product.id), 0, "destination unchanged until received");
});

itDb("receive lands the stock at the destination and completes the shipment", async () => {
    const owner = await registerOwner();
    const from = owner.user.branchId;
    const to = await secondBranch(owner);
    const product = await makeProduct(owner, 30);
    const shipment = (await ship(owner, { productId: product.id, fromBranchId: from, toBranchId: to, quantity: 12 })).body.data;

    const recv = await api("POST", `/shipments/${shipment.id}/receive`, { token: owner.token });
    assert.equal(recv.status, 200, JSON.stringify(recv.body));
    assert.equal(recv.body.data.status, "received");
    assert.equal(await qtyAt(owner, to, product.id), 12, "destination credited");
    assert.equal(await qtyAt(owner, from, product.id), 18, "source stays deducted");

    // Receiving again is refused.
    const again = await api("POST", `/shipments/${shipment.id}/receive`, { token: owner.token });
    assert.equal(again.status, 400, "cannot receive twice");
});

itDb("cancel returns the stock to the source", async () => {
    const owner = await registerOwner();
    const from = owner.user.branchId;
    const to = await secondBranch(owner);
    const product = await makeProduct(owner, 30);
    const shipment = (await ship(owner, { productId: product.id, fromBranchId: from, toBranchId: to, quantity: 12 })).body.data;
    assert.equal(await qtyAt(owner, from, product.id), 18);

    const cancel = await api("POST", `/shipments/${shipment.id}/cancel`, { token: owner.token });
    assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
    assert.equal(cancel.body.data.status, "cancelled");
    assert.equal(await qtyAt(owner, from, product.id), 30, "source restored");
    assert.equal(await qtyAt(owner, to, product.id), 0, "destination never credited");

    // A cancelled shipment can't be received.
    assert.equal((await api("POST", `/shipments/${shipment.id}/receive`, { token: owner.token })).status, 400);
});

itDb("a shipment larger than available stock is refused", async () => {
    const owner = await registerOwner();
    const from = owner.user.branchId;
    const to = await secondBranch(owner);
    const product = await makeProduct(owner, 5);

    const res = await ship(owner, { productId: product.id, fromBranchId: from, toBranchId: to, quantity: 10 });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(await qtyAt(owner, from, product.id), 5, "stock untouched on a rejected shipment");
});

itDb("incoming shipments are listable by status", async () => {
    const owner = await registerOwner();
    const from = owner.user.branchId;
    const to = await secondBranch(owner);
    const product = await makeProduct(owner, 30);
    await ship(owner, { productId: product.id, fromBranchId: from, toBranchId: to, quantity: 4 });

    const list = await api("GET", "/shipments?status=in_transit", { token: owner.token });
    assert.equal(list.status, 200);
    assert.equal(list.body.data.length, 1);
    assert.equal(list.body.data[0].product_name, product.name || "Tablet");
    assert.equal(list.body.data[0].to_branch_name, "Branch B");
});
