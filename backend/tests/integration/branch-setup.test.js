require("./helpers");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { api, registerOwner, createStaff, itDb, useIntegrationDb, pool } = require("./helpers");
const { decodeSetupCode } = require("../../src/core/sync/setup-code");

useIntegrationDb();
const addBranch = (owner) => api("POST", "/branches", { token: owner.token, body: { name: "Ikeja", isHeadquarters: false } });

itDb("Add Branch generates its reference and a hashed, branch-bound 24-hour setup code", async () => {
    const owner = await registerOwner();
    const response = await addBranch(owner);
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const branch = response.body.data;
    assert.match(branch.code, /^BR-/);
    const decoded = decodeSetupCode(branch.setupCode);
    assert.match(decoded.hubUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
    const hash = crypto.createHash("sha256").update(decoded.code).digest("hex");
    const { rows: [stored] } = await pool.runPrivileged(() => pool.query("SELECT * FROM sync_enrollment_tokens WHERE token_hash = $1", [hash]));
    assert.equal(stored.branch_id, branch.id);
    assert.equal(stored.organization_id, owner.user.organizationId);
    assert.ok(new Date(branch.setupCodeExpiresAt).getTime() - Date.now() > 23 * 60 * 60 * 1000);
    assert.ok(!JSON.stringify(stored).includes(decoded.code));
    const list = await api("GET", "/branches", { token: owner.token });
    assert.ok(list.body.data.every((row) => !row.setupCode));
    const enrolled = await api("POST", "/sync/enroll", { body: { code: decoded.code, name: "Different branch" } });
    assert.equal(enrolled.status, 201, JSON.stringify(enrolled.body));
    assert.equal(enrolled.body.data.branchId, branch.id);
    assert.equal((await api("POST", "/sync/enroll", { body: { code: decoded.code } })).status, 400);
});

itDb("regenerating a branch setup code invalidates the previous unused code", async () => {
    const owner = await registerOwner();
    const branch = (await addBranch(owner)).body.data;
    const next = await api("POST", `/branches/${branch.id}/setup-code`, { token: owner.token, body: {} });
    assert.equal(next.status, 201, JSON.stringify(next.body));
    assert.equal(next.body.data.branchId, branch.id);
    assert.equal((await api("POST", "/sync/enroll", { body: { code: decodeSetupCode(branch.setupCode).code } })).status, 400);
    assert.equal((await api("POST", "/sync/enroll", { body: { code: decodeSetupCode(next.body.data.setupCode).code } })).status, 201);
});

itDb("setup codes require create permission and cannot target another tenant or an unassigned branch", async () => {
    const owner = await registerOwner();
    const branch = (await addBranch(owner)).body.data;
    const reader = await createStaff(owner);
    assert.equal((await api("POST", `/branches/${branch.id}/setup-code`, { token: reader.token, body: {} })).status, 403);
    const manager = await createStaff(owner, { permissions: ["branches:create"] });
    assert.equal((await api("POST", `/branches/${branch.id}/setup-code`, { token: manager.token, body: {} })).status, 403);
    const outsider = await registerOwner();
    assert.equal((await api("POST", `/branches/${branch.id}/setup-code`, { token: outsider.token, body: {} })).status, 404);
    const invalid = await api("POST", "/sync/branches/code", { token: outsider.token, body: { branchId: branch.id } });
    assert.equal(invalid.status, 404);
});

itDb("expired setup codes are rejected and concurrent redemption succeeds only once", async () => {
    const owner = await registerOwner();
    const branch = (await addBranch(owner)).body.data;
    const code = decodeSetupCode(branch.setupCode).code;
    await pool.runPrivileged(() => pool.query("UPDATE sync_enrollment_tokens SET expires_at = NOW() - INTERVAL '1 minute' WHERE branch_id = $1", [branch.id]));
    assert.equal((await api("POST", "/sync/enroll", { body: { code } })).status, 400);
    const next = await api("POST", `/branches/${branch.id}/setup-code`, { token: owner.token, body: {} });
    const valid = decodeSetupCode(next.body.data.setupCode).code;
    const redeemed = await Promise.all([1, 2].map(() => api("POST", "/sync/enroll", { body: { code: valid } })));
    assert.deepEqual(redeemed.map((response) => response.status).sort(), [201, 400]);
});

itDb("a bound desktop can cache credentials only for staff assigned to its branch", async () => {
    const owner = await registerOwner();
    const branch = (await addBranch(owner)).body.data;
    const assigned = await createStaff(owner, { branchId: branch.id });
    const other = await createStaff(owner);
    const enrolled = await api("POST", "/sync/enroll", { body: { code: decodeSetupCode(branch.setupCode).code } });
    const token = enrolled.body.data.accessToken;
    assert.equal((await api("POST", "/sync/credential", { token, body: { email: other.email, password: other.password } })).status, 403);
    const verified = await api("POST", "/sync/credential", { token, body: { email: assigned.email, password: assigned.password } });
    assert.equal(verified.status, 200, JSON.stringify(verified.body));
    assert.equal(verified.body.data.userId, assigned.user.id);
});
