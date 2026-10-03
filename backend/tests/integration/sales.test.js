/**
 * ============================================================
 * File: sales.test.js
 * Module: Integration Tests — the money path
 *
 * Description:
 * End-to-end coverage of checkout: correct totals, payment reconciliation
 * (single method, cash change, split tender), the insufficient-stock guard,
 * inventory deduction, and returns/refunds (full + proportional). Drives
 * the real app over HTTP against the isolated test schema.
 * ============================================================
 */

require("./helpers"); // MUST be first — points the app at the test schema.
const assert = require("node:assert/strict");
const { api, registerOwner, itDb, useIntegrationDb, pool } = require("./helpers");

useIntegrationDb();

const round2 = (n) => Math.round(n * 100) / 100;
const paidTotal = (sale) => round2(sale.payments.reduce((sum, p) => sum + Number(p.amount), 0));

const makeProduct = async (owner, { price = 1000, openingStock = 50 } = {}) => {
    const res = await api("POST", "/products", {
        token: owner.token,
        body: {
            name: "Widget",
            sku: `SKU-${Math.random().toString(36).slice(2, 8)}`,
            price,
            branchId: owner.user.branchId,
            openingStock,
        },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.data;
};

const sell = (owner, productId, quantity, extra = {}) =>
    api("POST", "/sales", {
        token: owner.token,
        body: {
            branchId: owner.user.branchId,
            items: [{ itemType: "product", productId, quantity }],
            ...extra,
        },
    });

const stockQty = async (owner, productId) => {
    const res = await api("GET", `/inventory?branchId=${owner.user.branchId}&productId=${productId}`, {
        token: owner.token,
    });
    const rows = res.body.data || [];
    const row = rows.find((r) => r.productId === productId) || rows[0];
    return row ? Number(row.quantity) : 0;
};

itDb("checkout charges the correct total, records the payment, and deducts stock", async () => {
    const owner = await registerOwner();
    const product = await makeProduct(owner, { price: 1000, openingStock: 10 });

    const sale = await sell(owner, product.id, 3, { paymentMethod: "cash" });

    assert.equal(sale.status, 201, JSON.stringify(sale.body));
    assert.equal(sale.body.data.totalAmount, 3000);
    assert.equal(paidTotal(sale.body.data), 3000);
    assert.equal(sale.body.data.changeGiven, 0);
    assert.equal(await stockQty(owner, product.id), 7, "stock deducted by 3");
});

itDb("checkout is rejected when stock is insufficient, leaving inventory untouched", async () => {
    const owner = await registerOwner();
    const product = await makeProduct(owner, { price: 500, openingStock: 5 });

    const sale = await sell(owner, product.id, 6, { paymentMethod: "cash" });

    assert.equal(sale.status, 409, JSON.stringify(sale.body)); // 409 Conflict: not enough stock
    assert.equal(await stockQty(owner, product.id), 5, "stock unchanged after a failed sale");
});

itDb("cash over-tender records change while payments still reconcile to the total", async () => {
    const owner = await registerOwner();
    const product = await makeProduct(owner, { price: 1000, openingStock: 10 });

    const sale = await sell(owner, product.id, 2, { payments: [{ method: "cash", amount: 5000 }] });

    assert.equal(sale.status, 201, JSON.stringify(sale.body));
    assert.equal(sale.body.data.changeGiven, 3000);
    assert.equal(paidTotal(sale.body.data), 2000, "recorded payment equals the total, not the tender");
});

itDb("split tender across methods reconciles exactly to the total", async () => {
    const owner = await registerOwner();
    const product = await makeProduct(owner, { price: 1000, openingStock: 10 });

    const sale = await sell(owner, product.id, 3, {
        payments: [
            { method: "card", amount: 2000 },
            { method: "cash", amount: 1000 },
        ],
    });

    assert.equal(sale.status, 201, JSON.stringify(sale.body));
    assert.equal(sale.body.data.payments.length, 2);
    assert.equal(paidTotal(sale.body.data), 3000);
    assert.equal(sale.body.data.changeGiven, 0);
});

itDb("underpaying the total is rejected", async () => {
    const owner = await registerOwner();
    const product = await makeProduct(owner, { price: 1000, openingStock: 10 });

    const sale = await sell(owner, product.id, 2, { payments: [{ method: "cash", amount: 1500 }] });

    assert.equal(sale.status, 400, JSON.stringify(sale.body));
});

itDb("a paid sale can be fully returned: refund equals the total and stock is restored", async () => {
    const owner = await registerOwner();
    const product = await makeProduct(owner, { price: 1000, openingStock: 10 });

    const sale = (await sell(owner, product.id, 4, { paymentMethod: "cash" })).body.data;
    assert.equal(await stockQty(owner, product.id), 6);

    const ret = await api("POST", `/sales/${sale.id}/returns`, {
        token: owner.token,
        body: {
            items: sale.items.map((i) => ({ saleItemId: i.id, quantity: i.quantity })),
            reason: "changed mind",
            refundMethod: "cash",
        },
    });

    assert.equal(ret.status, 201, JSON.stringify(ret.body));
    assert.equal(await stockQty(owner, product.id), 10, "stock fully restored");

    const after = (await api("GET", `/sales/${sale.id}`, { token: owner.token })).body.data;
    assert.equal(after.returnedAmount, 4000);
    assert.equal(after.returnStatus, "full");
});

itDb("a partial return refunds proportionally (VAT included) and restocks that quantity", async () => {
    const owner = await registerOwner();
    // A 7.5% VAT so the total exceeds the subtotal; the proportional refund
    // must carry a share of the tax, not just the goods value.
    const tax = await api("POST", "/taxes", { token: owner.token, body: { name: "VAT", rate: 7.5 } });
    assert.equal(tax.status, 201, JSON.stringify(tax.body));

    const product = await makeProduct(owner, { price: 1000, openingStock: 10 });
    const sale = (await sell(owner, product.id, 4, { paymentMethod: "cash" })).body.data;
    assert.equal(sale.totalAmount, 4300, "4000 subtotal + 7.5% VAT");

    const ret = await api("POST", `/sales/${sale.id}/returns`, {
        token: owner.token,
        body: { items: [{ saleItemId: sale.items[0].id, quantity: 1 }], reason: "one faulty", refundMethod: "cash" },
    });
    assert.equal(ret.status, 201, JSON.stringify(ret.body));

    const after = (await api("GET", `/sales/${sale.id}`, { token: owner.token })).body.data;
    // 1 of 4 units: total * (1000 / 4000) = 4300 * 0.25 = 1075.
    assert.equal(after.returnedAmount, 1075, "proportional refund includes a share of VAT");
    assert.equal(after.returnStatus, "partial");
    assert.equal(await stockQty(owner, product.id), 7, "the returned unit is restocked (6 -> 7)");
});

itDb("duplicate and malformed return lines do not refund or restock anything", async () => {
    const owner = await registerOwner();
    const product = await makeProduct(owner, { price: 100, openingStock: 10 });
    const sale = (await sell(owner, product.id, 1, { paymentMethod: "cash" })).body.data;
    const line = { saleItemId: sale.items[0].id, quantity: 1 };

    const duplicate = await api("POST", `/sales/${sale.id}/returns`, {
        token: owner.token, body: { items: [line, line] },
    });
    assert.equal(duplicate.status, 400, JSON.stringify(duplicate.body));
    assert.match(duplicate.body.message, /only appear once/);

    const malformed = await api("POST", `/sales/${sale.id}/returns`, {
        token: owner.token, body: { items: [null] },
    });
    assert.equal(malformed.status, 400, JSON.stringify(malformed.body));

    const after = (await api("GET", `/sales/${sale.id}`, { token: owner.token })).body.data;
    assert.equal(after.returnedAmount, 0);
    assert.equal(after.items[0].returnedQuantity, 0);
    assert.equal(await stockQty(owner, product.id), 9, "failed returns leave stock unchanged");
});

itDb("concurrent returns cannot refund or restock the same sold unit twice", async () => {
    const owner = await registerOwner();
    const product = await makeProduct(owner, { price: 100, openingStock: 10 });
    const sale = (await sell(owner, product.id, 1, { paymentMethod: "cash" })).body.data;
    const body = { items: [{ saleItemId: sale.items[0].id, quantity: 1 }] };

    let requests = [];
    let bothBlocked = false;
    await pool.runPrivileged(async () => {
        const blocker = await pool.connect();
        try {
            await blocker.query("BEGIN");
            const { rows: [{ pid }] } = await blocker.query("SELECT pg_backend_pid() AS pid");
            // Hold stock so the first request cannot finish while the second
            // arrives. Before the fix both requests validate the same unit;
            // with the fix the second waits on the sale instead of stock.
            await blocker.query(
                "SELECT id FROM product_stock WHERE branch_id = $1 AND product_id = $2 FOR UPDATE",
                [owner.user.branchId, product.id]
            );
            requests = [
                api("POST", `/sales/${sale.id}/returns`, { token: owner.token, body }),
                api("POST", `/sales/${sale.id}/returns`, { token: owner.token, body }),
            ];
            const deadline = Date.now() + 10000;
            while (Date.now() < deadline) {
                const { rows: [{ count }] } = await pool.query(`
                    WITH RECURSIVE blocked AS (
                        SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))
                        UNION
                        SELECT a.pid FROM pg_stat_activity a
                        JOIN blocked b ON b.pid = ANY(pg_blocking_pids(a.pid))
                    )
                    SELECT COUNT(*)::int AS count FROM blocked
                `, [pid]);
                if (count >= 2) {
                    bothBlocked = true;
                    break;
                }
                await new Promise((resolve) => setTimeout(resolve, 20));
            }
        } finally {
            await blocker.query("ROLLBACK");
            blocker.release();
        }
    });

    const responses = await Promise.all(requests);
    assert.ok(bothBlocked, "both returns must overlap before releasing stock");
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409], JSON.stringify(responses));
    const after = (await api("GET", `/sales/${sale.id}`, { token: owner.token })).body.data;
    assert.equal(after.returnedAmount, 100);
    assert.equal(after.items[0].returnedQuantity, 1);
    assert.equal(await stockQty(owner, product.id), 10, "the sold unit is restocked exactly once");
});

itDb("sequential partial returns cannot exceed the quantity sold", async () => {
    const owner = await registerOwner();
    const product = await makeProduct(owner, { price: 100, openingStock: 10 });
    const sale = (await sell(owner, product.id, 2, { paymentMethod: "cash" })).body.data;
    const returnQuantity = (quantity) => api("POST", `/sales/${sale.id}/returns`, {
        token: owner.token, body: { items: [{ saleItemId: sale.items[0].id, quantity }] },
    });
    assert.equal((await returnQuantity(1)).status, 201);
    assert.equal((await returnQuantity(2)).status, 409);
    assert.equal((await returnQuantity(1)).status, 201);
    assert.equal((await returnQuantity(1)).status, 409);

    const after = (await api("GET", `/sales/${sale.id}`, { token: owner.token })).body.data;
    assert.equal(after.returnedAmount, 200);
    assert.equal(after.items[0].returnedQuantity, 2);
    assert.equal(await stockQty(owner, product.id), 10);
});
