const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createStoreNetwork, verifyConnection, requestPinned } = require("../src/store-network");
const { readOwner } = require("../src/sharing-controller");

// Real TLS and real API/database behavior, isolated by the calling smoke's
// fresh cluster. Loopback is enabled only in this test harness, never setup.
const exerciseSharedStore = async (host, owner, credentials) => {
    let gateway = await createStoreNetwork({ userData: host.userData, backendUrl: host.base, port: 0, allowLoopback: true });
    await gateway.start({ address: "127.0.0.1", storeName: "Isolated shared store" });
    const connection = await verifyConnection(gateway.getConnectionCode(), { allowLoopback: true });
    const call = async (route, { method = "GET", token, body, expected = 200 } = {}) => {
        const result = await requestPinned(connection, "/api/v1" + route, { allowLoopback: true, method,
            headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const payload = JSON.parse(result.body);
        assert.equal(result.statusCode, expected, method + " " + route + ": " + JSON.stringify(payload));
        return payload.data;
    };
    let role;
    const makeCashier = async (index) => {
        const email = "till-" + index + "-" + crypto.randomUUID() + "@example.test";
        const password = crypto.randomBytes(16).toString("hex");
        await host.api("/users", { method: "POST", token: owner.token, expected: 201, body: {
            firstName: "Till", lastName: String(index), email, password, roleId: role.id,
            branchId: owner.user.branchId, branchIds: [owner.user.branchId],
        } });
        const first = await call("/auth/login", { method: "POST", body: { email, password } });
        const newPassword = crypto.randomBytes(16).toString("hex");
        await call("/auth/change-password", { method: "PATCH", token: first.token, body: { currentPassword: password, newPassword } });
        return call("/auth/login", { method: "POST", body: { email, password: newPassword } });
    };
    try {
        role = await host.api("/roles", { method: "POST", expected: 201, token: owner.token, body: { name: "Shared store cashier", resources: ["sales"] } });
        const till1 = await makeCashier(1);
        const till2 = await makeCashier(2);
        assert.notEqual(till1.user.id, till2.user.id);
        await assert.rejects(readOwner(host.base, till1.token), /store owner/);
        await call("/roles", { token: till1.token, expected: 403 });
        await call("/auth/register", { method: "POST", body: {}, expected: 403 });
        await call("/sync/link", { method: "POST", body: {}, expected: 403 });
        const product = await host.api("/products", { method: "POST", expected: 201, token: owner.token, body: {
            name: "Final shared item", sku: "SHARED-" + crypto.randomUUID(), price: 100,
            branchId: owner.user.branchId, openingStock: 1,
        } });
        const sale = { items: [{ itemType: "product", productId: product.id, quantity: 1 }], paymentMethod: "cash" };
        const results = await Promise.all([till1, till2].map((till) => requestPinned(connection, "/api/v1/sales", {
            allowLoopback: true, method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + till.token }, body: JSON.stringify(sale),
        })));
        assert.deepEqual(results.map((result) => result.statusCode).sort(), [201, 409], "only one till can sell the final item");
        const stock = await call("/inventory?branchId=" + owner.user.branchId + "&productId=" + product.id, { token: till1.token });
        assert.equal(stock.find((row) => row.productId === product.id).quantity, 0);
        const sales = await call("/sales", { token: owner.token });
        const records = Array.isArray(sales) ? sales : sales.items;
        assert.equal(records.length, 1, "exactly one sale persisted");
        const port = gateway.getStatus().port;
        await gateway.stop();
        await assert.rejects(verifyConnection(connection, { allowLoopback: true, timeoutMs: 1000 }), /Could not connect/);
        await host.stop();
        await host.start();
        gateway = await createStoreNetwork({ userData: host.userData, backendUrl: host.base, port, allowLoopback: true });
        await gateway.start({ address: "127.0.0.1", storeName: "Isolated shared store" });
        await verifyConnection(connection, { allowLoopback: true });
        const returned = await call("/auth/login", { method: "POST", body: credentials });
        assert.equal(returned.user.id, owner.user.id);
        const remaining = await call("/inventory?branchId=" + owner.user.branchId + "&productId=" + product.id, { token: returned.token });
        assert.equal(remaining.find((row) => row.productId === product.id).quantity, 0);
        console.log("Shared store: two staff sessions, permissions, final-item concurrency, encrypted pairing, unavailable host and restart persistence passed.");
    } finally { await gateway.stop(); }
};
module.exports = { exerciseSharedStore };
