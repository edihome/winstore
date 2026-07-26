/**
 * ============================================================
 * File: sync-e2e.smoke.js
 * Module: Offline-sync engine — cross-node E2E proof (real enrollment)
 *
 * TWO real app instances reconciling over HTTP through the ACTUAL enrollment
 * flow. One process is this script (the BRANCH, on winstore_test); a spawned
 * child is the HUB (on winstore_test_hub). End to end:
 *
 *   1. hub org registered normally (plain SaaS tenant);
 *   2. admin mints a one-time enrollment code (opts the org into offline);
 *   3. branch redeems it → gets a node id + durable node token;
 *   4. branch downloads the initial SNAPSHOT and seeds its empty local DB;
 *   5. a user logs in ON THE BRANCH (proves identity+hashes came down);
 *   6. UPSTREAM: a branch sale-customer reaches the hub DB;
 *   7. DOWNSTREAM: a hub customer reaches the branch;
 *   8. REVOKE: after the hub revokes the branch, its node token is refused.
 *
 * Not part of `npm test` (two schemas + two SYNC-enabled processes).
 * Run: node tests/integration/sync-e2e.smoke.js
 * (Requires `npm run test:setup` to have created winstore_test first.)
 * ============================================================
 */

require("dotenv").config({ quiet: true });
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "integration-test-secret";
process.env.SYNC_ENABLED = "true";
process.env.SYNC_NODE_KIND = "branch";
// The E2E hub runs on loopback; the SSRF guard blocks loopback by default, so
// explicitly allowlist it (the intended escape hatch for a known hub host).
process.env.SYNC_HUB_ALLOWED_HOSTS = "127.0.0.1";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { Client } = require("pg");

const { TEST_SCHEMA, appDatabaseUrl } = require("./testdb");
const { HUB_SCHEMA, baseUrl } = require("./e2eSchema");

process.env.DATABASE_URL = appDatabaseUrl();

const app = require("../../src/app");
const pool = require("../../src/config/db");
const syncScheduler = require("../../src/core/sync/sync.scheduler");

const HUB_PORT = 5091;
const HUB_URL = `http://127.0.0.1:${HUB_PORT}`;
const PASSWORD = "password123";

const call = async (root, method, path_, { token, body } = {}) => {
    const res = await fetch(`${root}/api/v1${path_}`, {
        method,
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
};

const ensureHubSchema = async () => {
    const client = new Client({ connectionString: baseUrl() });
    await client.connect();
    try {
        await client.query(`DROP SCHEMA IF EXISTS ${HUB_SCHEMA} CASCADE`);
        await client.query(`CREATE SCHEMA ${HUB_SCHEMA}`);
    } finally {
        await client.end();
    }
    const bin = path.join(__dirname, "..", "..", "node_modules", "node-pg-migrate", "bin", "node-pg-migrate.js");
    const res = spawnSync(
        process.execPath,
        [bin, "up", "-m", "database/migrations", "--no-check-order", "--schema", HUB_SCHEMA, "--schema", "public", "--migrations-schema", HUB_SCHEMA],
        { cwd: path.join(__dirname, "..", ".."), env: { ...process.env, DATABASE_URL: baseUrl() }, stdio: "ignore" }
    );
    if (res.status !== 0) throw new Error(`hub schema migration failed (exit ${res.status})`);
};

const startHub = () =>
    new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(__dirname, "_e2e-hub-server.js")], {
            env: { ...process.env, E2E_HUB_PORT: String(HUB_PORT), DATABASE_URL: baseUrl(), SYNC_NODE_KIND: "hub" },
        });
        let out = "";
        const timer = setTimeout(() => reject(new Error(`hub did not become ready:\n${out}`)), 20000);
        child.stdout.on("data", (d) => {
            out += d.toString();
            if (out.includes("HUB_READY")) { clearTimeout(timer); resolve(child); }
        });
        child.stderr.on("data", (d) => (out += d.toString()));
        child.on("exit", (code) => reject(new Error(`hub exited early (${code}):\n${out}`)));
    });

const hubHasCustomer = async (orgId, custId) => {
    const client = new Client({ connectionString: baseUrl() });
    await client.connect();
    try {
        await client.query("SELECT set_config('app.bypass_rls', 'on', false)");
        const r = await client.query(`SELECT 1 FROM ${HUB_SCHEMA}.customers WHERE id = $1 AND organization_id = $2`, [custId, orgId]);
        return r.rowCount > 0;
    } finally {
        await client.end();
    }
};

const hubHasCategory = async (orgId, name) => {
    const client = new Client({ connectionString: baseUrl() });
    await client.connect();
    try {
        await client.query("SELECT set_config('app.bypass_rls', 'on', false)");
        const r = await client.query(`SELECT 1 FROM ${HUB_SCHEMA}.categories WHERE name = $1 AND organization_id = $2`, [name, orgId]);
        return r.rowCount > 0;
    } finally {
        await client.end();
    }
};

const qtyAt = async (root, token, branchId, productId) => {
    const res = await call(root, "GET", `/inventory?branchId=${branchId}&productId=${productId}`, { token });
    const row = (res.body.data || []).find((r) => r.productId === productId);
    return row ? Number(row.quantity) : 0;
};

let hub;
let branchServer;

const run = async () => {
    console.log("· preparing hub schema…");
    await ensureHubSchema();
    hub = await startHub();
    await new Promise((r) => (branchServer = app.listen(0, r)));
    const branchUrl = `http://127.0.0.1:${branchServer.address().port}`;

    // 1) A normal SaaS tenant on the hub.
    const email = `e2e-${Date.now().toString(36)}@test.local`;
    await call(HUB_URL, "POST", "/auth/register", { body: { firstName: "E2E", lastName: "Owner", email, password: PASSWORD, organizationName: `E2E ${email}` } });
    const hubLogin = await call(HUB_URL, "POST", "/auth/login", { body: { email, password: PASSWORD } });
    const hubToken = hubLogin.body.data.token;
    const org = hubLogin.body.data.user.organizationId;
    console.log(`· hub org ${org.slice(0, 8)}… registered`);

    // 2) Admin mints a one-time enrollment code (opts the org into offline).
    const codeRes = await call(HUB_URL, "POST", "/sync/branches/code", { token: hubToken, body: { name: "Shop 1" } });
    assert.equal(codeRes.status, 201, `mint code: ${JSON.stringify(codeRes.body)}`);
    const code = codeRes.body.data.code;

    // Reference for the cross-branch shipment test: a second branch + a stocked
    // product on the hub (both flow DOWN to the branch; the opening-stock
    // movement carries the aggregate via product_stock propagation on apply).
    const mainId = hubLogin.body.data.user.branchId;
    const depotId = (await call(HUB_URL, "POST", "/branches", { token: hubToken, body: { name: "Depot", code: `D-${Date.now().toString(36)}` } })).body.data.id;
    const product = (await call(HUB_URL, "POST", "/products", { token: hubToken, body: { name: "Widget", sku: `W-${Date.now().toString(36)}`, price: 100, branchId: mainId, openingStock: 30 } })).body.data;

    // 3) FIRST-RUN LINK. The unlinked branch first reports itself as a branch
    //    awaiting link (what the login screen probes to show the link form).
    const beforeStatus = await call(branchUrl, "GET", "/sync/link-status");
    assert.equal(beforeStatus.body.data.branchInstall, true, "branch install advertises itself");
    assert.equal(beforeStatus.body.data.linked, false, "not linked yet");

    // Links itself to the hub in ONE call — enroll + snapshot + persist. No env,
    // no manual token handling.
    const linked = await call(branchUrl, "POST", "/sync/link", { body: { hubUrl: HUB_URL, code, name: "Shop 1" } });
    assert.equal(linked.status, 201, `link: ${JSON.stringify(linked.body)}`);
    assert.equal(linked.body.data.organizationId, org, "linked onto the hub's org");
    const nodeId = linked.body.data.nodeId;
    console.log(`· branch linked to hub as node ${nodeId.slice(0, 8)}… (config persisted)`);

    // Now it reports as linked — the login screen would show sign-in, not the link form.
    assert.equal((await call(branchUrl, "GET", "/sync/link-status")).body.data.linked, true, "reports linked after");

    // A used code can't be redeemed again; a linked install refuses re-link.
    assert.ok((await call(HUB_URL, "POST", "/sync/enroll", { body: { code } })).status >= 400, "used code refused");
    assert.ok((await call(branchUrl, "POST", "/sync/link", { body: { hubUrl: HUB_URL, code } })).status >= 400, "re-link refused");

    // 4) A user logs in ON THE BRANCH — proves identity + password hashes came down.
    const branchLogin = await call(branchUrl, "POST", "/auth/login", { body: { email, password: PASSWORD } });
    assert.equal(branchLogin.status, 200, `branch login: ${JSON.stringify(branchLogin.body)}`);
    const branchToken = branchLogin.body.data.token;
    assert.equal(branchLogin.body.data.user.organizationId, org, "branch user is on the hub's org");
    // The snapshot shipped NO hash; first online login cached it locally.
    const cachedHash = await pool.runPrivileged(
        async () => (await pool.query(`SELECT password_hash FROM "${TEST_SCHEMA}".users WHERE lower(email) = lower($1)`, [email])).rows[0]?.password_hash
    );
    assert.ok(cachedHash && cachedHash.length > 20, "password hash cached on the branch after first online login");
    console.log("· user logged in on the branch (hash cached, offline login works next)");

    // 5) UPSTREAM — a branch write reaches the hub. The branch reads its hub +
    //    node token from the PERSISTED config (no env set here).
    const up = await call(branchUrl, "POST", "/customers", { token: branchToken, body: { name: "Branch Walk-in", email: `up-${Date.now().toString(36)}@test.local`, phone: "08010000000" } });
    assert.equal(up.status, 201, `branch create: ${JSON.stringify(up.body)}`);
    const upId = up.body.data.id;
    const r1 = (await call(branchUrl, "POST", "/sync/run", { token: branchToken })).body.data;
    assert.ok(r1.pushed >= 1, `expected a push, got ${JSON.stringify(r1)}`);
    assert.ok(await hubHasCustomer(org, upId), "branch customer landed in the hub DB");
    console.log(`✔ upstream: branch→hub (pushed ${r1.pushed})`);

    // GC: once pushed, the branch drops the change from its own outbox.
    const branchOutbox = await pool.runPrivileged(async () =>
        (await pool.query(`SELECT COUNT(*)::int AS n FROM "${TEST_SCHEMA}".sync_outbox WHERE organization_id = $1`, [org])).rows[0].n
    );
    assert.equal(branchOutbox, 0, "branch outbox pruned after push");
    console.log("✔ gc: branch outbox emptied after push");

    // 7) DOWNSTREAM — a hub write reaches the branch.
    const down = await call(HUB_URL, "POST", "/customers", { token: hubToken, body: { name: "Hub HQ Entry", email: `down-${Date.now().toString(36)}@test.local`, phone: "08020000000" } });
    assert.equal(down.status, 201, `hub create: ${JSON.stringify(down.body)}`);
    const downId = down.body.data.id;
    const r2 = (await call(branchUrl, "POST", "/sync/run", { token: branchToken })).body.data;
    assert.ok(r2.pulled >= 1, `expected a pull, got ${JSON.stringify(r2)}`);
    const onBranch = await call(branchUrl, "GET", "/customers", { token: branchToken });
    assert.ok(onBranch.body.data.some((c) => c.id === downId), "hub customer landed on the branch");
    console.log(`✔ downstream: hub→branch (pulled ${r2.pulled})`);

    // 7.4) INCREMENTAL RBAC — a role created on the hub AFTER enrollment (with
    //      its permission links) flows down to the branch.
    const roleName = `Cashiers ${Date.now().toString(36)}`;
    const hubRole = await call(HUB_URL, "POST", "/roles", { token: hubToken, body: { name: roleName, resources: ["customers"] } });
    assert.equal(hubRole.status, 201, `hub role: ${JSON.stringify(hubRole.body)}`);
    await call(branchUrl, "POST", "/sync/run", { token: branchToken });
    const branchRoles = await call(branchUrl, "GET", "/roles", { token: branchToken });
    assert.ok(branchRoles.body.data.some((r) => r.name === roleName), "hub role reached the branch");
    console.log("✔ incremental RBAC: a hub role edit reached the branch");

    // 7.5) AUTO-SYNC — the background worker reconciles with no button press.
    const auto = await call(branchUrl, "POST", "/customers", { token: branchToken, body: { name: "Auto Walk-in", email: `auto-${Date.now().toString(36)}@test.local`, phone: "08040000000" } });
    const autoRes = await syncScheduler.runOnce();
    assert.ok(autoRes.pushed >= 1, `auto-sync expected a push, got ${JSON.stringify(autoRes)}`);
    assert.ok(await hubHasCustomer(org, auto.body.data.id), "auto-sync shipped the branch write to the hub");
    console.log(`✔ auto-sync: worker reconciled without a button press (pushed ${autoRes.pushed})`);

    // 7.6) CENTRAL-WINS — a branch's REFERENCE edit stays local; the hub owns
    //      reference/identity, so it never flows up.
    const catName = `Branch Cat ${Date.now().toString(36)}`;
    const cat = await call(branchUrl, "POST", "/categories", { token: branchToken, body: { name: catName } });
    assert.equal(cat.status, 201, `branch category: ${JSON.stringify(cat.body)}`);
    await call(branchUrl, "POST", "/sync/run", { token: branchToken });
    assert.ok(!(await hubHasCategory(org, catName)), "branch's reference edit did NOT reach the hub");
    console.log("✔ central-wins: branch reference edit stayed local (not pushed up)");

    // 7.7) CROSS-BRANCH SHIPMENT across nodes + product_stock propagation.
    // The opening-stock movement synced down: the branch sees Main = 30 even
    // though product_stock isn't a synced table (propagation on apply).
    await call(branchUrl, "POST", "/sync/run", { token: branchToken });
    assert.equal(await qtyAt(branchUrl, branchToken, mainId, product.id), 30, "opening stock propagated to the branch");

    // Branch ships Main → Depot; source is deducted locally and the record is in_transit.
    const shipment = (await call(branchUrl, "POST", "/shipments", { token: branchToken, body: { productId: product.id, fromBranchId: mainId, toBranchId: depotId, quantity: 12 } })).body.data;
    assert.equal(shipment.status, "in_transit", "shipped in_transit");
    assert.equal(await qtyAt(branchUrl, branchToken, mainId, product.id), 18, "branch source deducted");
    await call(branchUrl, "POST", "/sync/run", { token: branchToken });

    // Hub now sees the in_transit shipment AND Main = 18 (the OUT movement's
    // aggregate propagated up on apply).
    const hubShipments = await call(HUB_URL, "GET", "/shipments?status=in_transit", { token: hubToken });
    assert.ok(hubShipments.body.data.some((s) => s.id === shipment.id), "shipment reached the hub");
    assert.equal(await qtyAt(HUB_URL, hubToken, mainId, product.id), 18, "source deduction propagated to the hub");

    // Hub RECEIVES it → Depot credited, shipment completed.
    const recv = await call(HUB_URL, "POST", `/shipments/${shipment.id}/receive`, { token: hubToken });
    assert.equal(recv.status, 200, `receive: ${JSON.stringify(recv.body)}`);
    assert.equal(await qtyAt(HUB_URL, hubToken, depotId, product.id), 12, "destination credited on the hub");

    // Branch pulls the completion + the destination IN movement.
    await call(branchUrl, "POST", "/sync/run", { token: branchToken });
    const branchShip = (await call(branchUrl, "GET", "/shipments", { token: branchToken })).body.data.find((s) => s.id === shipment.id);
    assert.equal(branchShip.status, "received", "branch sees the shipment received");
    assert.equal(await qtyAt(branchUrl, branchToken, depotId, product.id), 12, "destination credit propagated back to the branch");
    console.log("✔ shipment: branch→hub ship, hub receive, both stocks correct across nodes");

    // 8) REVOKE — the hub cuts the branch off; its node token is refused.
    const revoke = await call(HUB_URL, "POST", `/sync/branches/${nodeId}/revoke`, { token: hubToken });
    assert.equal(revoke.status, 200, `revoke: ${JSON.stringify(revoke.body)}`);
    await call(branchUrl, "POST", "/customers", { token: branchToken, body: { name: "After Revoke", email: `rev-${Date.now().toString(36)}@test.local`, phone: "08030000000" } });
    const afterRevoke = await call(branchUrl, "POST", "/sync/run", { token: branchToken });
    assert.ok(afterRevoke.status >= 400, `a revoked branch can no longer sync (got ${afterRevoke.status})`);
    console.log("✔ revoke: disconnected branch is refused by the hub");

    console.log("\nCROSS-NODE E2E PASSED — real enrollment, snapshot, sync, revoke.");
};

const cleanup = async () => {
    try { if (branchServer) await new Promise((r) => branchServer.close(r)); } catch {}
    try { if (hub) hub.kill("SIGTERM"); } catch {}
    try { await pool.end(); } catch {}
};

run()
    .then(async () => { await cleanup(); process.exit(0); })
    .catch(async (err) => { console.error("\nE2E FAILED:", err.message); await cleanup(); process.exit(1); });
