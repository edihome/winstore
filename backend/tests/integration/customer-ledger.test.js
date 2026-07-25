/**
 * ============================================================
 * File: customer-ledger.test.js
 * Module: Integration Tests — customer credit ledger
 *
 * Description:
 * Proves the credit ledger end to end: selling on credit posts a charge and
 * raises the customer's balance (in the same transaction as the sale),
 * recording a payment lowers it, split cash+credit reconciles correctly, the
 * statement and receivables report reflect the balance, and you can't sell on
 * credit without a customer.
 * ============================================================
 */

require("./helpers"); // MUST be first — points the app at the test schema.
const assert = require("node:assert/strict");
const { api, registerOwner, createStaff, itDb, useIntegrationDb } = require("./helpers");

useIntegrationDb();

const setup = async () => {
    const owner = await registerOwner();
    const branchId = owner.user.branchId;
    const product = (
        await api("POST", "/products", {
            token: owner.token,
            body: { name: "Bag of Rice", sku: `RICE-${Math.random().toString(36).slice(2, 8)}`, price: 1000, branchId, openingStock: 100 },
        })
    ).body.data;
    const customer = (
        await api("POST", "/customers", {
            token: owner.token,
            body: { name: "Ada", phone: "08000000000", email: `ada-${Math.random().toString(36).slice(2, 8)}@t.local` },
        })
    ).body.data;
    const sell = (qty, body) =>
        api("POST", "/sales", {
            token: owner.token,
            body: { branchId, customerId: customer.id, items: [{ itemType: "product", productId: product.id, quantity: qty }], ...body },
        });
    return { owner, branchId, product, customer, sell };
};

itDb("a full-credit sale posts a charge and raises the customer's balance", async () => {
    const { owner, customer, sell } = await setup();

    const sale = await sell(1, { payments: [{ method: "credit", amount: 1000 }] });
    assert.equal(sale.status, 201, JSON.stringify(sale.body));
    assert.equal(sale.body.data.payments.length, 0, "nothing was collected — it's all on account");

    const ledger = await api("GET", `/customers/${customer.id}/ledger`, { token: owner.token });
    assert.equal(ledger.body.data.balance, 1000, "owes the full amount");
    assert.equal(ledger.body.data.entries.length, 1);
    assert.equal(ledger.body.data.entries[0].entryType, "charge");
    assert.equal(ledger.body.data.entries[0].balanceAfter, 1000);
});

itDb("recording a payment lowers the balance", async () => {
    const { owner, customer, sell } = await setup();
    await sell(1, { payments: [{ method: "credit", amount: 1000 }] });

    const pay = await api("POST", `/customers/${customer.id}/ledger`, {
        token: owner.token,
        body: { entryType: "payment", amount: 400, method: "cash" },
    });
    assert.equal(pay.status, 201, JSON.stringify(pay.body));
    assert.equal(pay.body.data.balanceAfter, 600, "1000 owed − 400 paid = 600");

    const ledger = await api("GET", `/customers/${customer.id}/ledger`, { token: owner.token });
    assert.equal(ledger.body.data.balance, 600);
});

itDb("a split cash+credit sale reconciles (collected = total − credit)", async () => {
    const { owner, customer, sell } = await setup();

    const sale = await sell(2, { payments: [{ method: "cash", amount: 1500 }, { method: "credit", amount: 500 }] });
    assert.equal(sale.status, 201, JSON.stringify(sale.body));
    const paid = sale.body.data.payments.reduce((s, p) => s + Number(p.amount), 0);
    assert.equal(paid, 1500, "only the cash was collected");

    const ledger = await api("GET", `/customers/${customer.id}/ledger`, { token: owner.token });
    assert.equal(ledger.body.data.balance, 500, "the credit portion is owed");
});

itDb("the receivables report lists who owes and the total", async () => {
    const { owner, customer, sell } = await setup();
    await sell(1, { payments: [{ method: "credit", amount: 1000 }] });

    const report = await api("GET", "/reports/receivables", { token: owner.token });
    assert.equal(report.status, 200);
    const row = report.body.data.customers.find((c) => c.id === customer.id);
    assert.ok(row, "the customer appears in receivables");
    assert.equal(row.balance, 1000);
    assert.equal(report.body.data.totalOutstanding, 1000);
});

itDb("selling on credit without a customer is rejected", async () => {
    const { owner, branchId, product } = await setup();
    const res = await api("POST", "/sales", {
        token: owner.token,
        body: { branchId, items: [{ itemType: "product", productId: product.id, quantity: 1 }], payments: [{ method: "credit", amount: 1000 }] },
    });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(res.body.message, /customer is required/i);
});

itDb("refunding a credit sale to account reduces the balance (not cash out)", async () => {
    const { owner, customer, sell } = await setup();
    const sale = await sell(2, { payments: [{ method: "credit", amount: 2000 }] }); // owes 2000
    const detail = await api("GET", `/sales/${sale.body.data.id}`, { token: owner.token });
    const saleItemId = detail.body.data.items[0].id;

    const refund = await api("POST", `/sales/${sale.body.data.id}/returns`, {
        token: owner.token,
        body: { items: [{ saleItemId, quantity: 1 }], refundMethod: "credit" },
    });
    assert.equal(refund.status, 201, JSON.stringify(refund.body));

    const ledger = await api("GET", `/customers/${customer.id}/ledger`, { token: owner.token });
    assert.equal(ledger.body.data.balance, 1000, "2000 owed − 1000 returned to account = 1000");
});

itDb("a credit sale that would exceed the customer's limit is refused", async () => {
    const { owner, customer, sell } = await setup();
    await api("PATCH", `/customers/${customer.id}`, { token: owner.token, body: { creditLimit: 500 } });

    const overLimit = await sell(1, { payments: [{ method: "credit", amount: 1000 }] });
    assert.equal(overLimit.status, 400, JSON.stringify(overLimit.body));
    assert.match(overLimit.body.message, /credit limit/i);

    const withinLimit = await sell(1, { payments: [{ method: "cash", amount: 600 }, { method: "credit", amount: 400 }] });
    assert.equal(withinLimit.status, 201, "within the limit is fine");
});

itDb("a cashier can take a payment but cannot post an adjustment", async () => {
    const { owner, customer, sell } = await setup();
    await sell(1, { payments: [{ method: "credit", amount: 1000 }] });
    const cashier = await createStaff(owner, { resources: [] }); // baseline only

    const payment = await api("POST", `/customers/${customer.id}/ledger`, {
        token: cashier.token,
        body: { entryType: "payment", amount: 200, method: "cash" },
    });
    assert.equal(payment.status, 201, "a cashier may record a payment");

    const adjustment = await api("POST", `/customers/${customer.id}/ledger`, {
        token: cashier.token,
        body: { entryType: "adjustment", amount: -500 },
    });
    assert.equal(adjustment.status, 403, "a cashier may NOT write off a balance");
});

itDb("an admin can raise then clear a customer's credit limit", async () => {
    const { owner, customer, sell } = await setup();

    await api("PATCH", `/customers/${customer.id}`, { token: owner.token, body: { creditLimit: 500 } });
    let row = (await api("GET", "/customers", { token: owner.token })).body.data.find((c) => c.id === customer.id);
    assert.equal(row.creditLimit, 500);

    // Clearing (blank) sets it back to "no limit".
    await api("PATCH", `/customers/${customer.id}`, { token: owner.token, body: { creditLimit: "" } });
    row = (await api("GET", "/customers", { token: owner.token })).body.data.find((c) => c.id === customer.id);
    assert.equal(row.creditLimit, null, "blank clears the limit");

    // With no limit, a large credit sale is allowed again.
    const sale = await sell(1, { payments: [{ method: "credit", amount: 1000 }] });
    assert.equal(sale.status, 201);
});

itDb("a cashier cannot set a customer's credit limit (silently ignored)", async () => {
    const { owner, customer } = await setup();
    const cashier = await createStaff(owner, { resources: [] });

    // The edit itself succeeds (they may change other fields)…
    const res = await api("PATCH", `/customers/${customer.id}`, {
        token: cashier.token,
        body: { phone: "08099999999", creditLimit: 5000 },
    });
    assert.ok(res.status < 300, JSON.stringify(res.body));

    // …but the credit limit was ignored.
    const row = (await api("GET", "/customers", { token: owner.token })).body.data.find((c) => c.id === customer.id);
    assert.equal(row.creditLimit, null, "a cashier can't hand out credit");
    assert.equal(row.phone, "08099999999", "their other edit did go through");
});

itDb("a paid-off customer drops off the receivables report", async () => {
    const { owner, customer, sell } = await setup();
    await sell(1, { payments: [{ method: "credit", amount: 1000 }] });
    await api("POST", `/customers/${customer.id}/ledger`, {
        token: owner.token,
        body: { entryType: "payment", amount: 1000, method: "cash" },
    });

    const report = await api("GET", "/reports/receivables", { token: owner.token });
    assert.equal(report.body.data.customers.find((c) => c.id === customer.id), undefined, "zero balance → not a receivable");
});
