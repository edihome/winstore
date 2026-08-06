/**
 * ============================================================
 * File: product-pricing.test.js
 * Module: Integration Tests — product pricing rules
 *
 * Description:
 * A product may never be priced below what it cost to buy. The unit tests
 * cover the create payload; these cover the case the validator alone
 * cannot see — a PARTIAL edit, where only one of the two prices is sent
 * and the rule has to be judged against the value already stored.
 * ============================================================
 */

require("./helpers"); // MUST be first — points the app at the test schema.
const assert = require("node:assert/strict");
const { api, registerOwner, itDb, useIntegrationDb } = require("./helpers");

useIntegrationDb();

const makeProduct = async (owner, body = {}) => {
    const res = await api("POST", "/products", {
        token: owner.token,
        body: {
            name: "Widget",
            sku: `SKU-${Math.random().toString(36).slice(2, 8)}`,
            price: 1500,
            cost: 1000,
            branchId: owner.user.branchId,
            ...body,
        },
    });
    return res;
};

itDb("a product cannot be created priced below its cost", async () => {
    const owner = await registerOwner();

    const res = await makeProduct(owner, { price: 800, cost: 1000 });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(res.body.message, /selling price/i);

    // Selling at cost is allowed — it's a clearance price, not an error.
    const atCost = await makeProduct(owner, { price: 1000, cost: 1000 });
    assert.equal(atCost.status, 201, JSON.stringify(atCost.body));
});

itDb("an edit cannot drop the price below the stored cost", async () => {
    const owner = await registerOwner();
    const created = await makeProduct(owner);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const product = created.body.data;

    // Only the price is sent — the cost it must clear is the one on the row.
    const res = await api("PATCH", `/products/${product.id}`, {
        token: owner.token,
        body: { price: 900 },
    });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(res.body.message, /selling price/i);

    // The stored row is untouched by the refused edit.
    const after = await api("GET", `/products?search=${product.sku}`, { token: owner.token });
    const row = (after.body.data || []).find((p) => p.id === product.id);
    assert.equal(Number(row.price), 1500);
});

itDb("an edit cannot raise the cost above the stored price", async () => {
    const owner = await registerOwner();
    const created = await makeProduct(owner);
    const product = created.body.data;

    const res = await api("PATCH", `/products/${product.id}`, {
        token: owner.token,
        body: { cost: 2000 },
    });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(res.body.message, /selling price/i);

    // Raising both together, keeping price >= cost, is fine.
    const ok = await api("PATCH", `/products/${product.id}`, {
        token: owner.token,
        body: { price: 2500, cost: 2000 },
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
});
