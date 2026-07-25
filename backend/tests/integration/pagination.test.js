/**
 * ============================================================
 * File: pagination.test.js
 * Module: Integration Tests — server-side pagination
 *
 * Description:
 * Proves list endpoints paginate on the server when asked (page/limit +
 * a total), sort on the server, and stay backward compatible (no page/limit
 * → the full list, exactly as before). Customers is the reference vertical.
 * ============================================================
 */

require("./helpers"); // MUST be first — points the app at the test schema.
const assert = require("node:assert/strict");
const { api, registerOwner, itDb, useIntegrationDb } = require("./helpers");

useIntegrationDb();

const makeCustomer = async (owner, name) => {
    const res = await api("POST", "/customers", {
        token: owner.token,
        body: { name, phone: "08000000000", email: `c-${Math.random().toString(36).slice(2, 9)}@test.local` },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
};

itDb("returns the full list when no page/limit is given (backward compatible)", async () => {
    const owner = await registerOwner();
    for (const n of ["Ada", "Bola", "Chidi", "Dupe", "Emeka"]) await makeCustomer(owner, n);

    const res = await api("GET", "/customers", { token: owner.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 5, "all rows returned");
    assert.equal(res.body.pagination, undefined, "no pagination envelope when not requested");
});

itDb("returns one page plus a total when page/limit are given", async () => {
    const owner = await registerOwner();
    for (const n of ["Ada", "Bola", "Chidi", "Dupe", "Emeka"]) await makeCustomer(owner, n);

    const p1 = await api("GET", "/customers?page=1&limit=2", { token: owner.token });
    assert.equal(p1.status, 200);
    assert.equal(p1.body.data.length, 2, "page size honored");
    assert.deepEqual(p1.body.pagination, { page: 1, limit: 2, total: 5, totalPages: 3 });

    const p3 = await api("GET", "/customers?page=3&limit=2", { token: owner.token });
    assert.equal(p3.body.data.length, 1, "last page has the remainder");
    assert.equal(p3.body.pagination.page, 3);
});

itDb("sorts on the server, across the whole set (not just one page)", async () => {
    const owner = await registerOwner();
    for (const n of ["Ada", "Bola", "Chidi", "Dupe", "Emeka"]) await makeCustomer(owner, n);

    const desc = await api("GET", "/customers?page=1&limit=2&sortKey=name&sortDir=desc", { token: owner.token });
    assert.deepEqual(
        desc.body.data.map((c) => c.name),
        ["Emeka", "Dupe"],
        "the first page of a name-desc sort is the last two names overall"
    );
});

itDb("an out-of-range or garbage limit is clamped, not trusted", async () => {
    const owner = await registerOwner();
    await makeCustomer(owner, "Ada");

    const res = await api("GET", "/customers?page=1&limit=999999", { token: owner.token });
    assert.equal(res.status, 200);
    assert.ok(res.body.pagination.limit <= 200, "limit is capped");
});

itDb("the Services catalog paginates on the server (final-batch check)", async () => {
    const owner = await registerOwner();
    for (const name of ["Cut", "Colour", "Wash", "Shave", "Trim"]) {
        const res = await api("POST", "/services", {
            token: owner.token,
            body: { name, durationMinutes: 30, price: 1000 },
        });
        assert.equal(res.status, 201, JSON.stringify(res.body));
    }

    const all = await api("GET", "/services", { token: owner.token });
    assert.equal(all.body.data.length, 5, "no page param → the full list");
    assert.equal(all.body.pagination, undefined);

    const p1 = await api("GET", "/services?page=1&limit=2&sortKey=name&sortDir=asc", { token: owner.token });
    assert.equal(p1.body.data.length, 2);
    assert.equal(p1.body.pagination.total, 5);
    assert.equal(p1.body.data[0].name, "Colour", "server sort applied across the whole set");
});

itDb("the Sales list paginates on the server too (highest-volume list)", async () => {
    const owner = await registerOwner();
    const branchId = owner.user.branchId;
    const product = (
        await api("POST", "/products", {
            token: owner.token,
            body: { name: "Item", sku: `IT-${Math.random().toString(36).slice(2, 8)}`, price: 1000, branchId, openingStock: 100 },
        })
    ).body.data;
    for (let i = 0; i < 5; i += 1) {
        const sale = await api("POST", "/sales", {
            token: owner.token,
            body: { branchId, items: [{ itemType: "product", productId: product.id, quantity: 1 }], paymentMethod: "cash" },
        });
        assert.equal(sale.status, 201, JSON.stringify(sale.body));
    }

    const all = await api("GET", "/sales", { token: owner.token });
    assert.equal(all.body.data.length, 5, "no page param → the full list");
    assert.equal(all.body.pagination, undefined);

    const p1 = await api("GET", "/sales?page=1&limit=2", { token: owner.token });
    assert.equal(p1.body.data.length, 2);
    assert.deepEqual(p1.body.pagination, { page: 1, limit: 2, total: 5, totalPages: 3 });

    const p3 = await api("GET", "/sales?page=3&limit=2", { token: owner.token });
    assert.equal(p3.body.data.length, 1, "last page has the remainder");
});
