/**
 * ============================================================
 * File: stock.test.js
 * Module: Integration Tests — inventory movements
 *
 * Description:
 * End-to-end coverage of stock movements and cross-branch transfers:
 * aggregate quantity updates, the no-negative-stock guard, atomic transfer
 * between branches, its insufficient-stock guard, and expiry-batch carry.
 * ============================================================
 */

require("./helpers"); // MUST be first — points the app at the test schema.
const assert = require("node:assert/strict");
const { api, registerOwner, itDb, useIntegrationDb } = require("./helpers");

useIntegrationDb();

const makeProduct = async (owner, { openingStock = 0 } = {}) => {
    const res = await api("POST", "/products", {
        token: owner.token,
        body: {
            name: "Tablet",
            sku: `SKU-${Math.random().toString(36).slice(2, 8)}`,
            price: 500,
            branchId: owner.user.branchId,
            openingStock,
        },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.data;
};

const move = (owner, body) => api("POST", "/stock-movements", { token: owner.token, body });

const qtyAt = async (owner, branchId, productId) => {
    const res = await api("GET", `/inventory?branchId=${branchId}&productId=${productId}`, { token: owner.token });
    const rows = res.body.data || [];
    const row = rows.find((r) => r.productId === productId) || rows[0];
    return row ? Number(row.quantity) : 0;
};

const secondBranch = async (owner) => {
    const res = await api("POST", "/branches", {
        token: owner.token,
        body: { name: "Branch B", code: `B-${Math.random().toString(36).slice(2, 7)}` },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.data.id;
};

itDb("stock-in increases and stock-out decreases the branch aggregate", async () => {
    const owner = await registerOwner();
    const product = await makeProduct(owner, { openingStock: 0 });

    assert.equal((await move(owner, { branchId: owner.user.branchId, productId: product.id, movementType: "in", quantity: 20 })).status, 201);
    assert.equal((await move(owner, { branchId: owner.user.branchId, productId: product.id, movementType: "out", quantity: 5 })).status, 201);

    assert.equal(await qtyAt(owner, owner.user.branchId, product.id), 15);
});

itDb("a stock-out cannot drive inventory below zero", async () => {
    const owner = await registerOwner();
    const product = await makeProduct(owner, { openingStock: 3 });

    const res = await move(owner, { branchId: owner.user.branchId, productId: product.id, movementType: "out", quantity: 10 });

    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(await qtyAt(owner, owner.user.branchId, product.id), 3, "stock unchanged");
});

itDb("a transfer moves quantity between branches atomically", async () => {
    const owner = await registerOwner();
    const branchA = owner.user.branchId;
    const branchB = await secondBranch(owner);
    const product = await makeProduct(owner, { openingStock: 100 });

    const res = await api("POST", "/stock-movements/transfer", {
        token: owner.token,
        body: { productId: product.id, fromBranchId: branchA, toBranchId: branchB, quantity: 30 },
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.fromQuantityAfter, 70);
    assert.equal(res.body.data.toQuantityAfter, 30);
    assert.equal(await qtyAt(owner, branchA, product.id), 70);
    assert.equal(await qtyAt(owner, branchB, product.id), 30);
});

itDb("a transfer is rejected when the source lacks the stock, leaving both branches untouched", async () => {
    const owner = await registerOwner();
    const branchA = owner.user.branchId;
    const branchB = await secondBranch(owner);
    const product = await makeProduct(owner, { openingStock: 10 });

    const res = await api("POST", "/stock-movements/transfer", {
        token: owner.token,
        body: { productId: product.id, fromBranchId: branchA, toBranchId: branchB, quantity: 999 },
    });

    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(await qtyAt(owner, branchA, product.id), 10);
    assert.equal(await qtyAt(owner, branchB, product.id), 0);
});

itDb("a transfer carries expiry batches to the destination branch", async () => {
    const owner = await registerOwner();
    const branchA = owner.user.branchId;
    const branchB = await secondBranch(owner);
    const product = await makeProduct(owner, { openingStock: 0 });

    // Receive a tracked batch at A with a known expiry, then transfer some of it.
    await move(owner, {
        branchId: branchA,
        productId: product.id,
        movementType: "in",
        quantity: 40,
        expiryDate: "2027-01-31",
    });
    const sourceExpiry = (await api("GET", `/inventory/batches?branchId=${branchA}&productId=${product.id}`, {
        token: owner.token,
    })).body.data.find((b) => b.expiryDate).expiryDate;

    const res = await api("POST", "/stock-movements/transfer", {
        token: owner.token,
        body: { productId: product.id, fromBranchId: branchA, toBranchId: branchB, quantity: 15 },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));

    const batches = (await api("GET", `/inventory/batches?branchId=${branchB}&productId=${product.id}`, {
        token: owner.token,
    })).body.data;
    const carried = batches.find((b) => Number(b.quantity) === 15 && b.expiryDate);
    assert.ok(carried, `destination should have a 15-unit batch with an expiry: ${JSON.stringify(batches)}`);
    // Compare against the source's own value (not a hardcoded string) so the
    // assertion tests the invariant — expiry carried faithfully — rather than
    // date-string timezone formatting.
    assert.equal(carried.expiryDate, sourceExpiry, "destination batch carries the source's expiry");
});
