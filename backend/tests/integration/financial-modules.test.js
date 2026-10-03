/** Budgets and cash registers: money, permissions, tenant/branch isolation. */
require("./helpers");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { api, registerOwner, createStaff, itDb, useIntegrationDb, pool } = require("./helpers");

useIntegrationDb();

const createBudget = (owner, body = {}) => api("POST", "/budgets", {
    token: owner.token, body: { name: "Operating budget", amount: 1250.50, ...body },
});
const createRegister = (owner, body = {}) => api("POST", "/cash-register", {
    token: owner.token,
    body: { name: "Front till", branchId: owner.user.branchId, openingBalance: 100, ...body },
});
const transact = (owner, cashRegisterId, body = {}) => api("POST", "/cash-register/transactions", {
    token: owner.token,
    body: { cashRegisterId, transactionType: "inflow", amount: 25, ...body },
});
const created = (response) => {
    assert.equal(response.status, 201, JSON.stringify(response.body));
    return response.body.data;
};
const registers = async (owner, query = "") => {
    const response = await api("GET", `/cash-register${query}`, { token: owner.token });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return response.body.data;
};
const transactions = async (owner, cashRegisterId) => {
    const response = await api("GET", `/cash-register/transactions?cashRegisterId=${cashRegisterId}`, { token: owner.token });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return response.body.data;
};

itDb("financial endpoints require authentication", async () => {
    for (const path of ["/budgets", "/cash-register", "/cash-register/transactions"]) {
        assert.equal((await api("GET", path)).status, 401, path);
        assert.equal((await api("POST", path, { body: {} })).status, 401, path);
    }
});

itDb("budgets return numeric camelCase records and stay within their organization", async () => {
    const owner = await registerOwner();
    const other = await registerOwner();
    const budget = created(await createBudget(owner));
    created(await createBudget(other, { name: "Other organization's budget", amount: 800 }));
    assert.equal(budget.organizationId, owner.user.organizationId);
    assert.equal(budget.amount, 1250.50);
    assert.equal(budget.status, "active");
    assert.ok(budget.createdAt);

    const response = await api("GET", "/budgets", { token: owner.token });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(response.body.data.map((row) => row.id), [budget.id]);
    assert.equal((await api("GET", `/budgets?organizationId=${other.user.organizationId}`, { token: owner.token })).status, 403);
    assert.equal((await createBudget(owner, { organizationId: other.user.organizationId })).status, 403);
});

itDb("invalid budgets are rejected before they create financial records", async () => {
    const owner = await registerOwner();
    for (const body of [
        { name: " " }, { amount: -1 }, { amount: 0 }, { amount: "not-money" },
        { amount: "Infinity" }, { amount: true }, { amount: null }, { amount: [] },
        { amount: 0.004 }, { amount: 1.005 }, { amount: 10000000000 }, { status: "unrecognized" },
    ]) {
        const response = await createBudget(owner, body);
        assert.equal(response.status, 400, JSON.stringify({ body, response: response.body }));
    }
    const response = await api("GET", "/budgets", { token: owner.token });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(response.body.data, []);
});

itDb("granular financial view permissions do not enable writes", async () => {
    const owner = await registerOwner();
    const register = created(await createRegister(owner));
    created(await createBudget(owner));
    const staff = await createStaff(owner, { permissions: ["budgets:view", "cash_register:view"] });
    const withoutGrants = await createStaff(owner);

    for (const path of ["/budgets", "/cash-register", `/cash-register/transactions?cashRegisterId=${register.id}`]) {
        assert.equal((await api("GET", path, { token: staff.token })).status, 200, path);
        assert.equal((await api("GET", path, { token: withoutGrants.token })).status, 403, path);
    }
    assert.equal((await createBudget(staff)).status, 403);
    assert.equal((await createRegister(staff)).status, 403);
    assert.equal((await transact(staff, register.id)).status, 403);
    assert.equal((await registers(owner))[0].currentBalance, 100);
    assert.deepEqual(await transactions(owner, register.id), []);
});

itDb("cash inflows and outflows reconcile the register balance and append-only log", async () => {
    const owner = await registerOwner();
    const register = created(await createRegister(owner, { openingBalance: 0.10 }));
    assert.equal(register.organizationId, owner.user.organizationId);
    assert.equal(register.branchId, owner.user.branchId);
    assert.equal(register.openingBalance, 0.10);
    assert.equal(register.currentBalance, 0.10);
    assert.equal(register.status, "open");
    const inflow = created(await transact(owner, register.id, { amount: "0.20", reference: "FLOAT", notes: "Top up" }));
    assert.equal(inflow.amount, 0.20);
    assert.equal(inflow.balanceAfter, 0.30);
    assert.equal(inflow.reference, "FLOAT");
    assert.equal(inflow.notes, "Top up");
    const outflow = created(await transact(owner, register.id, { transactionType: "outflow", amount: 0.30 }));
    assert.equal(outflow.balanceAfter, 0);
    assert.equal((await registers(owner))[0].currentBalance, 0);
    const rows = await transactions(owner, register.id);
    assert.equal(rows.length, 2);
    assert.deepEqual(new Set(rows.map((row) => row.id)), new Set([inflow.id, outflow.id]));
    const loggedCents = rows.reduce((sum, row) => sum + (row.transactionType === "inflow" ? 1 : -1) * Math.round(row.amount * 100), 0);
    assert.equal(Math.round(register.openingBalance * 100) + loggedCents, 0);
});

itDb("invalid cash entries and overdrafts leave the balance and log unchanged", async () => {
    const owner = await registerOwner();
    for (const body of [
        { name: " " }, { branchId: "" }, { openingBalance: -1 }, { openingBalance: "invalid" },
        { openingBalance: true }, { openingBalance: null }, { openingBalance: [] },
        { openingBalance: 0.004 }, { openingBalance: 1.005 }, { openingBalance: 10000000000 },
    ]) {
        assert.equal((await createRegister(owner, body)).status, 400, JSON.stringify(body));
    }
    const missingBranch = await api("POST", "/cash-register", {
        token: owner.token, body: { name: "Missing branch", openingBalance: 100 },
    });
    assert.equal(missingBranch.status, 400, JSON.stringify(missingBranch.body));
    const register = created(await createRegister(owner));
    for (const body of [
        { amount: 0 }, { amount: -1 }, { amount: "invalid" }, { amount: true }, { amount: null },
        { amount: [] }, { amount: 0.004 }, { amount: 1.005 }, { amount: 10000000000 },
        { transactionType: "invalid" }, { transactionType: " inflow " }, { transactionType: ["inflow"] },
        { reference: { label: "object reference" } },
    ]) {
        assert.equal((await transact(owner, register.id, body)).status, 400, JSON.stringify(body));
    }
    const overdraw = await transact(owner, register.id, { transactionType: "outflow", amount: 101 });
    assert.equal(overdraw.status, 400, JSON.stringify(overdraw.body));
    assert.equal((await registers(owner))[0].currentBalance, 100);
    assert.deepEqual(await transactions(owner, register.id), []);
});

itDb("cash register access follows the register's branch, including its transactions", async () => {
    const owner = await registerOwner();
    const secondBranch = created(await api("POST", "/branches", {
        token: owner.token, body: { name: "Other branch", code: "OTHER" },
    }));
    const own = created(await createRegister(owner));
    const other = created(await createRegister(owner, { name: "Other till", branchId: secondBranch.id }));
    created(await transact(owner, own.id));
    created(await transact(owner, other.id));
    const staff = await createStaff(owner, { permissions: ["cash_register:view", "cash_register:create"] });
    assert.deepEqual((await registers(staff)).map((row) => row.id), [own.id]);
    assert.equal((await api("GET", `/cash-register?branchId=${secondBranch.id}`, { token: staff.token })).status, 403);
    assert.equal((await createRegister(staff, { branchId: secondBranch.id })).status, 403);
    assert.equal((await transact(staff, other.id)).status, 404);
    assert.equal((await api("GET", `/cash-register/transactions?cashRegisterId=${other.id}`, { token: staff.token })).status, 404);
    const allVisible = await api("GET", "/cash-register/transactions", { token: staff.token });
    assert.equal(allVisible.status, 200, JSON.stringify(allVisible.body));
    assert.deepEqual(allVisible.body.data.map((row) => row.cashRegisterId), [own.id]);
    assert.equal(created(await transact(staff, own.id, { amount: 5 })).balanceAfter, 130);
});

itDb("a foreign organization's register or branch cannot be attached to cash records", async () => {
    const owner = await registerOwner();
    const other = await registerOwner();
    const register = created(await createRegister(other));
    assert.equal((await transact(owner, register.id)).status, 404);
    const foreignBranch = await createRegister(owner, { branchId: other.user.branchId });
    assert.ok([400, 403, 404].includes(foreignBranch.status), JSON.stringify(foreignBranch.body));
    assert.deepEqual(await registers(owner), []);
    assert.equal((await registers(other))[0].currentBalance, 100);
    assert.deepEqual(await transactions(other, register.id), []);
});

itDb("legacy branchless registers are visible only to privileged users", async () => {
    const owner = await registerOwner();
    const staff = await createStaff(owner, { permissions: ["cash_register:view", "cash_register:create"] });
    const id = crypto.randomUUID();
    await pool.runPrivileged(() => pool.query(
        "INSERT INTO cash_registers (id, organization_id, name, opening_balance, current_balance) VALUES ($1, $2, $3, 100, 100)",
        [id, owner.user.organizationId, "Legacy unassigned till"]
    ));
    assert.ok((await registers(owner)).some((row) => row.id === id));
    assert.deepEqual(await registers(staff), []);
    assert.equal((await transact(staff, id)).status, 404);
    assert.equal(created(await transact(owner, id)).balanceAfter, 125);
});

itDb("a closed cash register cannot accept further movements", async () => {
    const owner = await registerOwner();
    const register = created(await createRegister(owner));
    await pool.runPrivileged(() => pool.query(
        "UPDATE cash_registers SET status = 'closed', closed_at = NOW() WHERE id = $1", [register.id]
    ));
    assert.equal((await transact(owner, register.id)).status, 400);
    assert.equal((await registers(owner))[0].currentBalance, 100);
    assert.deepEqual(await transactions(owner, register.id), []);
});

itDb("concurrent cash outflows cannot spend the same balance twice", async () => {
    const owner = await registerOwner();
    const register = created(await createRegister(owner));
    let requests = [];
    let bothBlocked = false;
    await pool.runPrivileged(async () => {
        const blocker = await pool.connect();
        try {
            await blocker.query("BEGIN");
            const { rows: [{ pid }] } = await blocker.query("SELECT pg_backend_pid() AS pid");
            await blocker.query("SELECT id FROM cash_registers WHERE id = $1 FOR UPDATE", [register.id]);
            requests = [
                transact(owner, register.id, { transactionType: "outflow", amount: 80 }),
                transact(owner, register.id, { transactionType: "outflow", amount: 80 }),
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
            try { await blocker.query("ROLLBACK"); } finally { blocker.release(); }
        }
    });
    const responses = await Promise.all(requests);
    assert.ok(bothBlocked, "both outflows overlap while the register is locked");
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 400], JSON.stringify(responses));
    assert.equal((await registers(owner))[0].currentBalance, 20);
    const rows = await transactions(owner, register.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].amount, 80);
    assert.equal(rows[0].balanceAfter, 20);
});
