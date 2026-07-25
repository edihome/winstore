/**
 * ============================================================
 * File: reports.test.js
 * Module: Integration Tests — owner reports
 *
 * Description:
 * Proves the new owner reports compute correctly off real sales/stock:
 * profit & margin (revenue − COGS), sales-by-staff, cash-up, P&L, and
 * inventory valuation.
 * ============================================================
 */

require("./helpers"); // MUST be first — points the app at the test schema.
const assert = require("node:assert/strict");
const { api, registerOwner, itDb, useIntegrationDb } = require("./helpers");

useIntegrationDb();

// Seed a product (cost 600, price 1000, opening stock 50) and sell 3 for cash.
const seedSaleWithProfit = async (owner) => {
    const branchId = owner.user.branchId;
    const product = (
        await api("POST", "/products", {
            token: owner.token,
            body: { name: "Panadol", sku: `PN-${Date.now()}`, price: 1000, cost: 600, branchId, openingStock: 50 },
        })
    ).body.data;
    await api("POST", "/sales", {
        token: owner.token,
        body: { branchId, items: [{ itemType: "product", productId: product.id, quantity: 3 }], paymentMethod: "cash" },
    });
    return { branchId, product };
};

itDb("profit report computes revenue, COGS, gross profit, and margin", async () => {
    const owner = await registerOwner();
    await seedSaleWithProfit(owner);

    const p = (await api("GET", "/reports/profit", { token: owner.token })).body.data;
    assert.equal(p.totals.revenue, 3000, "3 × 1000");
    assert.equal(p.totals.cogs, 1800, "3 × 600");
    assert.equal(p.totals.grossProfit, 1200);
    assert.equal(p.totals.marginPct, 40, "1200/3000");
    assert.equal(p.products[0].profit, 1200, "per-product profit");
});

itDb("sales-by-staff attributes the sale to its cashier", async () => {
    const owner = await registerOwner();
    await seedSaleWithProfit(owner);

    const r = (await api("GET", "/reports/sales-by-staff", { token: owner.token })).body.data;
    assert.equal(r.staff.length, 1);
    assert.equal(r.staff[0].saleCount, 1);
    assert.equal(r.staff[0].revenue, 3000);
    assert.equal(r.staff[0].averageSale, 3000);
});

itDb("cash-up totals payments by method", async () => {
    const owner = await registerOwner();
    await seedSaleWithProfit(owner);

    const c = (await api("GET", "/reports/cash-up", { token: owner.token })).body.data;
    assert.equal(c.total, 3000);
    assert.equal(c.expectedCash, 3000, "all cash");
    assert.ok(c.methods.some((m) => m.method === "cash" && m.total === 3000));
});

itDb("P&L nets gross profit against expenses", async () => {
    const owner = await registerOwner();
    await seedSaleWithProfit(owner);
    // Record an expense and mark it paid (which stamps paid_at) so it lands in the P&L.
    const expense = (
        await api("POST", "/expenses", {
            token: owner.token,
            body: { description: "Rent", amount: 500, category: "Rent", branchId: owner.user.branchId },
        })
    ).body.data;
    await api("PATCH", `/expenses/${expense.id}/status`, { token: owner.token, body: { status: "paid" } });

    const pl = (await api("GET", "/reports/profit-loss", { token: owner.token })).body.data;
    assert.equal(pl.grossProfit, 1200);
    assert.equal(pl.totalExpenses, 500);
    assert.equal(pl.netProfit, 700, "1200 − 500");
});

itDb("inventory valuation values stock on hand at cost", async () => {
    const owner = await registerOwner();
    await seedSaleWithProfit(owner); // 50 opening − 3 sold = 47 on hand

    const inv = (await api("GET", "/reports/inventory-value", { token: owner.token })).body.data;
    assert.equal(inv.totalCostValue, 47 * 600, "47 × 600");
    assert.equal(inv.totalRetailValue, 47 * 1000, "47 × 1000");
});
