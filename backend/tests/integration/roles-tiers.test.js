/**
 * ============================================================
 * File: roles-tiers.test.js
 * Module: Integration Tests — access tiers
 *
 * Description:
 * Proves the predefined access tiers (Staff / Supervisor / Admin / Super
 * Admin) are seeded per organization and grant the right access: Staff gets
 * only the baseline, Supervisor adds shop-floor oversight (inventory) but not
 * administration, and Admin can manage administration (branches).
 * ============================================================
 */

require("./helpers"); // MUST be first — points the app at the test schema.
const assert = require("node:assert/strict");
const { api, registerOwner, createStaff, itDb, useIntegrationDb } = require("./helpers");

useIntegrationDb();

const tierRoleId = async (owner, name) => {
    const roles = (await api("GET", "/roles", { token: owner.token })).body.data;
    const role = roles.find((r) => r.name === name);
    assert.ok(role, `the "${name}" tier role is seeded`);
    return role.id;
};

itDb("the four tiers are seeded for a new organization", async () => {
    const owner = await registerOwner();
    const names = (await api("GET", "/roles", { token: owner.token })).body.data.map((r) => r.name);
    for (const tier of ["staff", "supervisor", "admin", "super_admin"]) {
        assert.ok(names.includes(tier), `has ${tier}`);
    }
});

itDb("Staff tier gets the baseline only — can sell, cannot manage inventory", async () => {
    const owner = await registerOwner();
    const staff = await createStaff(owner, { roleId: await tierRoleId(owner, "staff") });

    // Baseline: create a customer.
    const cust = await api("POST", "/customers", {
        token: staff.token,
        body: { name: "Walk-in", phone: "0800", email: `w-${Date.now()}@t.local` },
    });
    assert.equal(cust.status, 201, "staff can add a customer (baseline)");

    // Not baseline: manage the product catalog.
    const prod = await api("POST", "/products", {
        token: staff.token,
        body: { name: "X", sku: `X-${Date.now()}`, price: 100 },
    });
    assert.equal(prod.status, 403, "staff cannot manage products");
});

itDb("Supervisor tier adds shop-floor oversight but not administration", async () => {
    const owner = await registerOwner();
    const supervisor = await createStaff(owner, { roleId: await tierRoleId(owner, "supervisor") });

    // Shop-floor: manage the product catalog.
    const prod = await api("POST", "/products", {
        token: supervisor.token,
        body: { name: "Y", sku: `Y-${Date.now()}`, price: 100 },
    });
    assert.equal(prod.status, 201, "supervisor can manage products");

    // Administration: create a branch — must be refused.
    const branch = await api("POST", "/branches", {
        token: supervisor.token,
        body: { name: "Second", code: `S-${Date.now().toString(36).slice(-5)}` },
    });
    assert.equal(branch.status, 403, "supervisor cannot manage branches");

    // Administration: create another user — must be refused.
    const user = await api("POST", "/users", {
        token: supervisor.token,
        body: { firstName: "N", lastName: "O", email: `no-${Date.now()}@t.local`, password: "password123" },
    });
    assert.equal(user.status, 403, "supervisor cannot manage staff");
});

itDb("Admin tier can manage administration (branches and staff)", async () => {
    const owner = await registerOwner();
    const admin = await createStaff(owner, { roleId: await tierRoleId(owner, "admin") });

    const branch = await api("POST", "/branches", {
        token: admin.token,
        body: { name: "Branch Two", code: `B2-${Date.now().toString(36).slice(-5)}` },
    });
    assert.equal(branch.status, 201, "admin can create a branch");

    const prod = await api("POST", "/products", {
        token: admin.token,
        body: { name: "Z", sku: `Z-${Date.now()}`, price: 100 },
    });
    assert.equal(prod.status, 201, "admin can manage products");
});
