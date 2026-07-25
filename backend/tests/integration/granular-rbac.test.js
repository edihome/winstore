/**
 * ============================================================
 * File: granular-rbac.test.js
 * Module: Integration Tests — fine-grained (per-action) permissions
 *
 * Description:
 * Proves custom roles can grant individual actions (View/Create/Edit/Delete)
 * per module and that they're enforced, that "manage" still grants everything
 * (backward compatible), and that the special actions — Sales Refund and
 * Stock Adjustment — are gated on their own permission. Uses `products` and
 * `stock_movements` (not baseline-managed) so the grants are meaningful.
 * ============================================================
 */

require("./helpers"); // MUST be first — points the app at the test schema.
const assert = require("node:assert/strict");
const { api, registerOwner, createStaff, itDb, useIntegrationDb } = require("./helpers");

useIntegrationDb();

const newProduct = (token, extra = {}) =>
    api("POST", "/products", { token, body: { name: "P", sku: `P-${Math.random().toString(36).slice(2, 9)}`, price: 100, ...extra } });

itDb("a View-only grant can read but not create", async () => {
    const owner = await registerOwner();
    const staff = await createStaff(owner, { permissions: ["products:view"] });

    assert.equal((await api("GET", "/products", { token: staff.token })).status, 200, "view can list");
    assert.equal((await newProduct(staff.token)).status, 403, "view cannot create");
});

itDb("Create is enforced independently of Edit", async () => {
    const owner = await registerOwner();
    const product = (await newProduct(owner.token)).body.data;

    const creator = await createStaff(owner, { permissions: ["products:view", "products:create"] });
    assert.equal((await newProduct(creator.token)).status, 201, "create grant can create");
    const edit = await api("PATCH", `/products/${product.id}`, { token: creator.token, body: { price: 200 } });
    assert.equal(edit.status, 403, "create grant cannot edit");

    const editor = await createStaff(owner, { permissions: ["products:view", "products:create", "products:edit"] });
    const ok = await api("PATCH", `/products/${product.id}`, { token: editor.token, body: { price: 250 } });
    assert.equal(ok.status, 200, "edit grant can edit");
});

itDb('"manage" still grants everything (backward compatible)', async () => {
    const owner = await registerOwner();
    const product = (await newProduct(owner.token)).body.data;
    const manager = await createStaff(owner, { resources: ["products"] }); // legacy → products:manage

    assert.equal((await newProduct(manager.token)).status, 201, "manage can create");
    const edit = await api("PATCH", `/products/${product.id}`, { token: manager.token, body: { price: 300 } });
    assert.equal(edit.status, 200, "manage can edit");
});

itDb("Refund is gated on its own permission (baseline sale-makers cannot refund)", async () => {
    const owner = await registerOwner();
    const product = (await newProduct(owner.token, { branchId: owner.user.branchId, openingStock: 10 })).body.data;
    const sale = (
        await api("POST", "/sales", {
            token: owner.token,
            body: {
                branchId: owner.user.branchId,
                items: [{ itemType: "product", productId: product.id, quantity: 1 }],
                paymentMethod: "cash",
            },
        })
    ).body.data;
    const refundBody = { items: [{ saleItemId: sale.items[0].id, quantity: 1 }], refundMethod: "cash", reason: "x" };

    // A baseline staff member can make sales but must NOT be able to refund.
    const staff = await createStaff(owner, { resources: [] });
    assert.equal(
        (await api("POST", `/sales/${sale.id}/returns`, { token: staff.token, body: refundBody })).status,
        403,
        "baseline staff cannot refund"
    );

    // A role explicitly granted Refund can.
    const refunder = await createStaff(owner, { permissions: ["sales:refund"] });
    assert.equal(
        (await api("POST", `/sales/${sale.id}/returns`, { token: refunder.token, body: refundBody })).status,
        201,
        "sales:refund can refund"
    );
});

itDb("Stock Adjustment is gated on its own permission (create alone can't adjust)", async () => {
    const owner = await registerOwner();
    const product = (await newProduct(owner.token, { branchId: owner.user.branchId, openingStock: 20 })).body.data;
    const move = (perms, movementType) =>
        createStaff(owner, { permissions: perms }).then((s) =>
            api("POST", "/stock-movements", {
                token: s.token,
                body: { productId: product.id, branchId: owner.user.branchId, movementType, quantity: 2, reason: "t" },
            })
        );

    // Create-only: ordinary in/out works, adjustment is refused.
    assert.equal((await move(["stock_movements:view", "stock_movements:create"], "in")).status, 201, "create can stock-in");
    assert.equal(
        (await move(["stock_movements:view", "stock_movements:create"], "adjustment")).status,
        403,
        "create alone cannot adjust"
    );

    // With the Stock Adjustment grant, it's allowed.
    assert.equal(
        (await move(["stock_movements:view", "stock_movements:create", "stock_movements:stock_adjustment"], "adjustment")).status,
        201,
        "stock_adjustment grant can adjust"
    );
});
