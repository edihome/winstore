/**
 * ============================================================
 * File: sync-enrollment.test.js
 * Module: Integration Tests — offline-sync branch enrollment
 *
 * Proves the enrollment surface without needing two instances: an admin mints
 * a one-time code (opting the org into offline), a branch redeems it for a
 * durable node token, that token authenticates the protocol WITHOUT a user
 * session, a used code is refused, a non-admin can't mint, revoke kills the
 * token, and the snapshot carries the tenant root + identity.
 * ============================================================
 */

require("./helpers");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { api, registerOwner, createStaff, itDb, useIntegrationDb } = require("./helpers");

useIntegrationDb();

const mintCode = (owner, body = { name: "Shop 1" }) => api("POST", "/sync/branches/code", { token: owner.token, body });
const enroll = (body) => api("POST", "/sync/enroll", { body });

itDb("an admin mints a code and a branch enrolls onto the org", async () => {
    const owner = await registerOwner();
    const code = (await mintCode(owner)).body.data.code;
    assert.ok(code, "a code is returned once");

    const res = await enroll({ code, name: "Shop 1" });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.organizationId, owner.user.organizationId, "enrolled onto the minting org");
    assert.ok(res.body.data.accessToken, "a durable node token is issued");
    assert.ok(res.body.data.nodeId, "a node id is issued");

    // Minting opts the org into offline.
    const status = await api("GET", "/sync/status", { token: owner.token });
    assert.equal(status.body.data.orgEnabled, true, "the org is now offline-enabled");
});

itDb("a used code cannot be redeemed twice", async () => {
    const owner = await registerOwner();
    const code = (await mintCode(owner)).body.data.code;
    assert.equal((await enroll({ code })).status, 201);
    assert.ok((await enroll({ code })).status >= 400, "second redemption is refused");
});

itDb("an invalid code is refused", async () => {
    assert.ok((await enroll({ code: "not-a-real-code" })).status >= 400);
    assert.ok((await enroll({})).status >= 400, "a missing code is refused");
});

itDb("link-status is public and reports this install is not a branch here", async () => {
    // No auth, no org — a pre-login probe the first-run screen makes.
    const res = await api("GET", "/sync/link-status");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.branchInstall, false, "test app isn't a branch install (SYNC_ENABLED off)");
    assert.equal(typeof res.body.data.linked, "boolean");
});

itDb("linking a branch requires a hub url and a code", async () => {
    // (The happy path — enroll+snapshot+persist — needs a live hub and is
    // proven by the cross-node E2E; here we cover the guard.)
    assert.equal((await api("POST", "/sync/link", { body: {} })).status, 400);
    assert.equal((await api("POST", "/sync/link", { body: { hubUrl: "http://example.test" } })).status, 400, "a code is required");
});

itDb("a non-admin cannot mint an enrollment code", async () => {
    const owner = await registerOwner();
    const staff = await createStaff(owner, { resources: ["customers"] });
    const res = await mintCode(staff);
    assert.equal(res.status, 403, "baseline staff is refused");
});

itDb("a node token authenticates the protocol without a user session", async () => {
    const owner = await registerOwner();
    const code = (await mintCode(owner)).body.data.code;
    const nodeToken = (await enroll({ code })).body.data.accessToken;

    const status = await api("GET", "/sync/status", { token: nodeToken });
    assert.equal(status.status, 200, JSON.stringify(status.body));
    assert.equal(status.body.data.orgEnabled, true);
});

itDb("revoking a branch refuses its node token", async () => {
    const owner = await registerOwner();
    const code = (await mintCode(owner)).body.data.code;
    const { accessToken: nodeToken, nodeId } = (await enroll({ code })).body.data;

    // It works before revoke…
    assert.equal((await api("GET", "/sync/status", { token: nodeToken })).status, 200);

    const revoke = await api("POST", `/sync/branches/${nodeId}/revoke`, { token: owner.token });
    assert.equal(revoke.status, 200, JSON.stringify(revoke.body));

    // …and is refused after.
    assert.equal((await api("GET", "/sync/status", { token: nodeToken })).status, 401, "revoked token rejected");

    // The branch shows up in the admin's list, marked inactive.
    const list = await api("GET", "/sync/branches", { token: owner.token });
    const row = list.body.data.find((b) => b.id === nodeId);
    assert.ok(row && row.is_active === false, "listed as revoked");
    assert.equal(typeof row.behind, "number", "branch health includes a 'behind' count");
});

itDb("linking refuses a loopback / link-local hub URL (SSRF guard)", async () => {
    assert.equal((await api("POST", "/sync/link", { body: { hubUrl: "http://127.0.0.1:9", code: "x" } })).status, 400);
    assert.equal((await api("POST", "/sync/link", { body: { hubUrl: "http://169.254.169.254/latest/meta-data", code: "x" } })).status, 400);
    assert.equal((await api("POST", "/sync/link", { body: { hubUrl: "file:///etc/passwd", code: "x" } })).status, 400, "non-http scheme refused");
});

itDb("a branch node can only sync records for its own branch", async () => {
    const owner = await registerOwner();
    const org = owner.user.organizationId;
    const code = (await mintCode(owner, { name: "Shop", branchId: owner.user.branchId })).body.data.code;
    const nodeToken = (await enroll({ code })).body.data.accessToken;

    // A movement stamped with a DIFFERENT branch is refused (and logged).
    const foreign = {
        table_name: "stock_movements",
        op: "I",
        seq: 1,
        row_data: { id: crypto.randomUUID(), organization_id: org, branch_id: crypto.randomUUID(), product_id: crypto.randomUUID(), movement_type: "in", quantity_change: 1, quantity_after: 1, created_at: new Date().toISOString() },
    };
    const res = await api("POST", "/sync/apply", { token: nodeToken, body: { changes: [foreign] } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.applied, 0, "foreign-branch row not applied");
    assert.equal(res.body.data.dropped, 1, "it was dropped");

    const rejections = (await api("GET", "/sync/rejections", { token: owner.token })).body.data;
    assert.ok(rejections.some((r) => r.table_name === "stock_movements" && /own branch/i.test(r.reason || "")), "logged as a branch-scope violation");
});

itDb("a branch cannot push audit logs (no forged audit trail)", async () => {
    const owner = await registerOwner();
    const org = owner.user.organizationId;
    const code = (await mintCode(owner)).body.data.code;
    const nodeToken = (await enroll({ code })).body.data.accessToken;

    const res = await api("POST", "/sync/apply", {
        token: nodeToken,
        body: { changes: [{ table_name: "audit_logs", op: "I", seq: 1, row_data: { id: crypto.randomUUID(), organization_id: org } }] },
    });
    assert.equal(res.body.data.applied, 0, "audit log not applied");
    assert.equal(res.body.data.dropped, 1, "audit log push dropped");
});

itDb("central-wins: the hub ignores a reference change pushed by a branch", async () => {
    const owner = await registerOwner();
    const org = owner.user.organizationId;
    const code = (await mintCode(owner)).body.data.code;
    const nodeToken = (await enroll({ code })).body.data.accessToken;

    // A branch node pushes a batch mixing a REFERENCE change (products, hub-owned)
    // with a customer (branch-authored). Only the customer must land.
    const custId = crypto.randomUUID();
    const prodId = crypto.randomUUID();
    const batch = [
        { table_name: "products", op: "I", row_data: { id: prodId, organization_id: org, name: "Branch tried to change price" }, seq: 1 },
        {
            table_name: "customers",
            op: "I",
            seq: 2,
            row_data: { id: custId, organization_id: org, name: "Node Cust", email: `n-${Date.now().toString(36)}@test.local`, phone: "0800", status: "active", credit_limit: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        },
    ];
    const res = await api("POST", "/sync/apply", { token: nodeToken, body: { changes: batch } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.applied, 1, "only the customer was applied");

    const customers = (await api("GET", "/customers", { token: owner.token })).body.data;
    assert.ok(customers.some((c) => c.id === custId), "the branch's customer was accepted");
    const products = (await api("GET", "/products", { token: owner.token })).body.data;
    assert.ok(!products.some((p) => p.id === prodId), "the branch's reference change was ignored");

    // The drop is logged for the admin's sync console.
    const rejections = (await api("GET", "/sync/rejections", { token: owner.token })).body.data;
    assert.ok(rejections.some((r) => r.table_name === "products" && r.row_id === prodId), "the ignored change was logged");
});

itDb("a branch push on a mismatched protocol version is refused", async () => {
    const owner = await registerOwner();
    const code = (await mintCode(owner)).body.data.code;
    const nodeToken = (await enroll({ code })).body.data.accessToken;

    // A matching version is accepted; a mismatched one is refused (409).
    const ok = await api("POST", "/sync/apply", { token: nodeToken, headers: { "X-Sync-Schema-Version": "1" }, body: { changes: [] } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));

    const bad = await api("POST", "/sync/apply", { token: nodeToken, headers: { "X-Sync-Schema-Version": "999" }, body: { changes: [] } });
    assert.equal(bad.status, 409, "a stale branch is turned away");
});

itDb("the snapshot pages via a cursor and drains fully", async () => {
    const owner = await registerOwner();
    const seen = new Set();
    let cursor = null;
    let pages = 0;
    do {
        const q = `?limit=3${cursor ? `&t=${cursor.t}&o=${cursor.o}` : ""}`;
        const res = await api("GET", `/sync/snapshot${q}`, { token: owner.token });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.ok(res.body.data.changes.length <= 3, "each page respects the limit");
        res.body.data.changes.forEach((c) => seen.add(c.table_name));
        cursor = res.body.data.next;
        pages += 1;
        assert.ok(pages < 50, "paging terminates");
    } while (cursor);

    assert.ok(pages > 1, "a fresh org spans multiple small pages");
    assert.ok(seen.has("organizations") && seen.has("users"), "draining covered the org root and users");
});

itDb("the snapshot carries the tenant root and identity", async () => {
    const owner = await registerOwner();
    await mintCode(owner);
    const snap = await api("GET", "/sync/snapshot", { token: owner.token });
    assert.equal(snap.status, 200, JSON.stringify(snap.body));
    const tables = new Set(snap.body.data.changes.map((c) => c.table_name));
    assert.ok(tables.has("organizations"), "includes the org row (FK root)");
    assert.ok(tables.has("users"), "includes users");
    assert.ok(tables.has("roles"), "includes roles");
    // Users are present but their password hash is NEVER shipped (cached later
    // via /sync/credential on first online login).
    const userChange = snap.body.data.changes.find((c) => c.table_name === "users");
    assert.ok(!("password_hash" in userChange.row_data), "no password hash in the snapshot");
});

itDb("a branch refreshes short-lived access tokens with its refresh secret", async () => {
    const owner = await registerOwner();
    const code = (await mintCode(owner)).body.data.code;
    const { nodeId, refreshSecret } = (await enroll({ code })).body.data;
    assert.ok(refreshSecret, "a durable refresh secret is issued");

    const tok = await api("POST", "/sync/token", { body: { nodeId, refreshSecret } });
    assert.equal(tok.status, 200, JSON.stringify(tok.body));
    assert.ok(tok.body.data.accessToken, "a fresh access token is minted");
    assert.equal((await api("GET", "/sync/status", { token: tok.body.data.accessToken })).status, 200, "the access token works");

    assert.equal((await api("POST", "/sync/token", { body: { nodeId, refreshSecret: "wrong" } })).status, 401, "a bad secret is refused");
});

itDb("a revoked branch cannot refresh a new token", async () => {
    const owner = await registerOwner();
    const code = (await mintCode(owner)).body.data.code;
    const { nodeId, refreshSecret } = (await enroll({ code })).body.data;
    await api("POST", `/sync/branches/${nodeId}/revoke`, { token: owner.token });
    assert.equal((await api("POST", "/sync/token", { body: { nodeId, refreshSecret } })).status, 401, "revoked → no refresh");
});

itDb("credential caching returns a hash only to a node, only on the right password", async () => {
    const owner = await registerOwner();
    const code = (await mintCode(owner)).body.data.code;
    const nodeToken = (await enroll({ code })).body.data.accessToken;

    // Right password → the hash (for the branch to cache).
    const ok = await api("POST", "/sync/credential", { token: nodeToken, body: { email: owner.email, password: owner.password } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.ok(ok.body.data.passwordHash, "hash returned on correct password");

    // Wrong password → 401 (no hash leaked).
    assert.equal((await api("POST", "/sync/credential", { token: nodeToken, body: { email: owner.email, password: "nope" } })).status, 401);

    // A USER token can't call it — nodes only.
    assert.equal((await api("POST", "/sync/credential", { token: owner.token, body: { email: owner.email, password: owner.password } })).status, 403);
});
