/**
 * ============================================================
 * File: auth-rbac.test.js
 * Module: Integration Tests — access control
 *
 * Description:
 * End-to-end coverage of the rules that keep money and data safe:
 *   - baseline capabilities let ordinary staff sell,
 *   - admin-only modules stay closed to them,
 *   - an expired/deactivated subscription locks staff out per request, and
 *   - HR/salary fields are writable and readable only by a super_admin.
 * ============================================================
 */

require("./helpers"); // MUST be first — points the app at the test schema.
const assert = require("node:assert/strict");
const { api, registerOwner, createStaff, itDb, useIntegrationDb, pool } = require("./helpers");

useIntegrationDb();

const makeProduct = async (owner, openingStock = 20) => {
    const res = await api("POST", "/products", {
        token: owner.token,
        body: {
            name: "Widget",
            sku: `SKU-${Math.random().toString(36).slice(2, 8)}`,
            price: 1000,
            branchId: owner.user.branchId,
            openingStock,
        },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.data;
};

itDb("a baseline staff member can complete a sale", async () => {
    const owner = await registerOwner();
    const product = await makeProduct(owner);
    const cashier = await createStaff(owner, { resources: [] });

    const sale = await api("POST", "/sales", {
        token: cashier.token,
        body: {
            branchId: cashier.user.branchId,
            items: [{ itemType: "product", productId: product.id, quantity: 1 }],
            paymentMethod: "cash",
        },
    });

    assert.equal(sale.status, 201, JSON.stringify(sale.body));
});

itDb("a baseline staff member cannot manage inventory or products (admin-only)", async () => {
    const owner = await registerOwner();
    const product = await makeProduct(owner);
    const cashier = await createStaff(owner, { resources: [] });

    const createProduct = await api("POST", "/products", {
        token: cashier.token,
        body: { name: "Sneaky", sku: "SNK-1", price: 10, branchId: cashier.user.branchId },
    });
    assert.equal(createProduct.status, 403, "staff must not create products");

    const stockMove = await api("POST", "/stock-movements", {
        token: cashier.token,
        body: { branchId: cashier.user.branchId, productId: product.id, movementType: "in", quantity: 5 },
    });
    assert.equal(stockMove.status, 403, "staff must not record stock movements");
});

itDb("baseline staff can SEE stock levels but not change them", async () => {
    // The merged Products & Stock page is "everyone reads, admins act": a
    // cashier has to be able to look up what's on the shelf (baseline
    // products:read), while every way of CHANGING a quantity stays behind its
    // own grant. Reads and writes on /inventory are therefore gated against
    // different resources — this pins that split.
    const owner = await registerOwner();
    const product = await makeProduct(owner);
    const cashier = await createStaff(owner, { resources: [] });

    const levels = await api("GET", `/inventory?branchId=${cashier.user.branchId}`, { token: cashier.token });
    assert.equal(levels.status, 200, JSON.stringify(levels.body));

    // ...and the product is in that list with its real quantity, not hidden.
    const row = (levels.body.data || []).find((r) => r.productId === product.id);
    assert.ok(row, "the product must be visible to a read-only viewer");
    assert.equal(Number(row.quantity), 20);

    const setReorder = await api("PATCH", "/inventory/reorder-level", {
        token: cashier.token,
        body: { branchId: cashier.user.branchId, productId: product.id, reorderLevel: 5 },
    });
    assert.equal(setReorder.status, 403, "staff must not set reorder levels");
});

itDb("a product with no stock row at the branch lists as zero, not missing", async () => {
    // The merge's core promise: a product that has never been stocked (or has
    // sold out) stays on the page at quantity 0. If it vanished, there would
    // be no row to receive stock against.
    const owner = await registerOwner();
    const product = await makeProduct(owner, 0);

    const levels = await api("GET", `/inventory?branchId=${owner.user.branchId}`, { token: owner.token });
    assert.equal(levels.status, 200, JSON.stringify(levels.body));

    const row = (levels.body.data || []).find((r) => r.productId === product.id);
    assert.ok(row, "an unstocked product must still be listed");
    assert.equal(Number(row.quantity), 0);
    assert.equal(row.outOfStock, true);
    assert.equal(row.productName, "Widget");
});

itDb("an expired subscription locks staff out of the app on the very next request", async () => {
    const owner = await registerOwner();
    const cashier = await createStaff(owner, { resources: [] });

    // While the subscription is healthy, staff can use the app.
    const before = await api("GET", "/customers", { token: cashier.token });
    assert.equal(before.status, 200, JSON.stringify(before.body));

    // Push the org well past expiry AND its grace window (columns live on
    // organizations; the per-request guard re-reads them every call). This
    // direct write runs outside a request, so bypass RLS to reach the row.
    await pool.runPrivileged(() =>
        pool.query("UPDATE organizations SET subscription_expires_at = NOW() - INTERVAL '30 days', extension_days = 7")
    );

    const after = await api("GET", "/customers", { token: cashier.token });
    assert.equal(after.status, 403, "staff must be blocked once the subscription has lapsed");
});

itDb("a deactivated organization locks staff out just like an expired subscription", async () => {
    const owner = await registerOwner();
    const cashier = await createStaff(owner, { resources: [] });

    await pool.runPrivileged(() => pool.query("UPDATE organizations SET status = 'inactive'"));

    const after = await api("GET", "/customers", { token: cashier.token });
    assert.equal(after.status, 403, "staff must be blocked while the org is deactivated");
});

itDb("HR/salary is writable and readable only by a super_admin", async () => {
    const owner = await registerOwner();
    const target = await createStaff(owner, { resources: [] });
    const admin = await createStaff(owner, { resources: ["users"] });
    const targetId = target.user.id;

    // The owner (super_admin) sets a salary.
    const ownerSet = await api("PATCH", `/users/${targetId}`, {
        token: owner.token,
        body: { salary: 500000 },
    });
    assert.equal(ownerSet.status, 200, JSON.stringify(ownerSet.body));

    // The owner can read it back (HR is nested under `hr`, super_admin-only).
    const ownerView = (await api("GET", "/users", { token: owner.token })).body.data.find((u) => u.id === targetId);
    assert.equal(ownerView.hr.salary, 500000, "super_admin sees the salary");

    // An ordinary admin (with users:manage) tries to change the salary…
    const adminSet = await api("PATCH", `/users/${targetId}`, {
        token: admin.token,
        body: { salary: 999999 },
    });
    assert.ok(adminSet.status < 300, `admin update itself is allowed: ${JSON.stringify(adminSet.body)}`);

    // …but the HR field is ignored: the owner still sees the original value.
    const stillOriginal = (await api("GET", "/users", { token: owner.token })).body.data.find(
        (u) => u.id === targetId
    );
    assert.equal(stillOriginal.hr.salary, 500000, "an ordinary admin cannot change salary");

    // And an ordinary admin never even receives the HR block.
    const adminView = (await api("GET", "/users", { token: admin.token })).body.data.find((u) => u.id === targetId);
    assert.equal(adminView.hr, undefined, "an ordinary admin never receives HR fields");
});
