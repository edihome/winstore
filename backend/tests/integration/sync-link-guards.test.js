/** Branch first-run linking must preserve any existing local installation. */
require("dotenv").config({ quiet: true });
process.env.SYNC_ENABLED = "true";
process.env.SYNC_NODE_KIND = "branch";
process.env.SYNC_HUB_ALLOWED_HOSTS = "";
require("./helpers");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const { api, itDb, useIntegrationDb, pool } = require("./helpers");

useIntegrationDb();

const localCounts = async () => {
    const { rows: [counts] } = await pool.runPrivileged(() => pool.query(
        "SELECT (SELECT COUNT(*)::int FROM organizations) AS organizations, (SELECT COUNT(*)::int FROM sync_branch_config) AS links"
    ));
    return counts;
};

// An explicitly allowed, process-local hub drives the real HTTP bootstrap
// without depending on an external service or any production database.
const withFakeHub = async ({ failSecondPage = false } = {}, fn) => {
    const organizationId = crypto.randomUUID();
    const nodeId = crypto.randomUUID();
    const at = new Date().toISOString();
    const organization = {
        id: organizationId, name: "Snapshot organization", slug: `snapshot-${organizationId}`,
        status: "active", sync_enabled: true, subscription_expires_at: null,
        alert_threshold_days: 30, extension_days: 0, created_at: at, updated_at: at,
    };
    const calls = { enroll: [], snapshots: [] };
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, "http://127.0.0.1");
        res.setHeader("Content-Type", "application/json");
        if (req.method === "POST" && url.pathname === "/api/v1/sync/enroll") {
            let body = "";
            for await (const chunk of req) body += chunk;
            calls.enroll.push(JSON.parse(body));
            res.end(JSON.stringify({ data: { organizationId, nodeId, refreshSecret: "test-refresh-secret", accessToken: "test-access-token" } }));
            return;
        }
        if (req.method === "GET" && url.pathname === "/api/v1/sync/snapshot") {
            calls.snapshots.push({ search: url.search, authorization: req.headers.authorization });
            if (url.search) {
                if (failSecondPage) {
                    res.statusCode = 500;
                    res.end(JSON.stringify({ message: "Simulated later-page failure." }));
                } else {
                    res.end(JSON.stringify({ data: { changes: [], next: null } }));
                }
            } else {
                res.end(JSON.stringify({ data: {
                    changes: [{ table_name: "organizations", op: "I", row_data: organization }],
                    next: { t: 1, o: 0 },
                } }));
            }
            return;
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ message: "Unexpected fake-hub request." }));
    });
    const previousAllowlist = process.env.SYNC_HUB_ALLOWED_HOSTS;
    try {
        await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
        process.env.SYNC_HUB_ALLOWED_HOSTS = "127.0.0.1";
        await fn({ hubUrl: `http://127.0.0.1:${server.address().port}`, organizationId, nodeId, calls });
    } finally {
        process.env.SYNC_HUB_ALLOWED_HOSTS = previousAllowlist;
        await new Promise((resolve) => server.close(resolve));
    }
};

itDb("an empty branch advertises first-run linking and rejects incomplete payloads", async () => {
    const status = await api("GET", "/sync/link-status");
    assert.equal(status.status, 200, JSON.stringify(status.body));
    assert.equal(status.body.data.branchInstall, true);
    assert.equal(status.body.data.linked, false);
    for (const body of [{}, { hubUrl: "https://hub.example.test" }, { code: "enrollment-code" }]) {
        assert.equal((await api("POST", "/sync/link", { body })).status, 400, JSON.stringify(body));
    }
    assert.equal((await api("POST", "/auth/register", { body: {
        organizationName: "Unlinked local business", firstName: "Local", lastName: "Owner",
        email: "unlinked@test.local", password: "password123",
    } })).status, 403, "branches cannot create businesses before enrollment");
    assert.deepEqual(await localCounts(), { organizations: 0, links: 0 });
});

itDb("first-run linking rejects unsafe hub URLs without creating local data", async () => {
    for (const hubUrl of ["http://127.0.0.1:9", "http://169.254.169.254/latest/meta-data", "file:///etc/passwd"]) {
        const response = await api("POST", "/sync/link", { body: { hubUrl, code: "never-redeem-this" } });
        assert.equal(response.status, 400, JSON.stringify({ hubUrl, response: response.body }));
    }
    const counts = await pool.runPrivileged(() => pool.query(
        "SELECT (SELECT COUNT(*)::int FROM organizations) AS organizations, (SELECT COUNT(*)::int FROM sync_branch_config) AS links"
    ));
    assert.equal(counts.rows[0].organizations, 0);
    assert.equal(counts.rows[0].links, 0);
});

itDb("an existing local organization blocks linking before outbound calls and is preserved", async () => {
    const id = crypto.randomUUID();
    // Model an existing database switched into branch mode outside the supported
    // desktop setup. Branch registration itself is forbidden by the API.
    await pool.runPrivileged(() => pool.query(
        "INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3)",
        [id, "Existing business", `existing-${id}`]
    ));
    const response = await api("POST", "/sync/link", {
        // Deliberately nonresolving: the occupied-install guard must run before
        // DNS or enrollment, preserving the local data without network access.
        body: { hubUrl: "https://not-a-real-hub.example.test", code: "never-redeem-this" },
    });
    assert.equal(response.status, 409, JSON.stringify(response.body));
    const preserved = await pool.runPrivileged(() => pool.query("SELECT id, name FROM organizations"));
    assert.deepEqual(preserved.rows, [{ id, name: "Existing business" }]);
    const counts = await pool.runPrivileged(() => pool.query(
        "SELECT (SELECT COUNT(*)::int FROM organizations) AS organizations, (SELECT COUNT(*)::int FROM users) AS users, (SELECT COUNT(*)::int FROM sync_branch_config) AS links"
    ));
    assert.equal(counts.rows[0].organizations, 1);
    assert.equal(counts.rows[0].users, 0);
    assert.equal(counts.rows[0].links, 0);
});

itDb("a later snapshot failure rolls back bootstrap data and allows a retry", async () => {
    await withFakeHub({ failSecondPage: true }, async ({ hubUrl, calls }) => {
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const response = await api("POST", "/sync/link", { body: { hubUrl, code: `replacement-code-${attempt}` } });
            assert.equal(response.status, 502, JSON.stringify(response.body));
            assert.match(response.body.message, /new enrollment code/i);
            assert.deepEqual(await localCounts(), { organizations: 0, links: 0 });
            const status = await api("GET", "/sync/link-status");
            assert.equal(status.status, 200, JSON.stringify(status.body));
            assert.equal(status.body.data.linked, false);
        }
        assert.deepEqual(calls.enroll.map((body) => body.code), ["replacement-code-0", "replacement-code-1"]);
        assert.equal(calls.snapshots.length, 4, "each attempt reaches the failing page after applying the first page");
        assert.ok(calls.snapshots.every((call) => call.authorization === "Bearer test-access-token"));
    });
});

// Keep this last: the real install-level link cache intentionally survives
// request boundaries, and the completed enrollment must not be reset in tests.
itDb("a successful paged bootstrap persists one link and refuses enrollment again", async () => {
    await withFakeHub({}, async ({ hubUrl, organizationId, nodeId, calls }) => {
        const payload = { hubUrl, code: "successful-fake-enrollment-code" };
        const response = await api("POST", "/sync/link", { body: payload });
        assert.equal(response.status, 201, JSON.stringify(response.body));
        assert.deepEqual(response.body.data, { organizationId, nodeId });
        assert.deepEqual(await localCounts(), { organizations: 1, links: 1 });
        const { rows: [link] } = await pool.runPrivileged(() => pool.query(
            "SELECT organization_id, hub_url, node_id, refresh_secret FROM sync_branch_config"
        ));
        assert.deepEqual(link, { organization_id: organizationId, hub_url: hubUrl, node_id: nodeId, refresh_secret: "test-refresh-secret" });
        assert.equal((await api("GET", "/sync/link-status")).body.data.linked, true);
        assert.equal((await api("POST", "/sync/link", { body: payload })).status, 409);
        assert.equal((await api("POST", "/auth/register", { body: {
            organizationName: "Linked local business", firstName: "Local", lastName: "Owner",
            email: "linked@test.local", password: "password123",
        } })).status, 403, "linked branches cannot create a second business");
        assert.deepEqual(await localCounts(), { organizations: 1, links: 1 });
        assert.equal(calls.enroll.length, 1, "already linked guards prevent outbound enrollment");
        assert.equal(calls.snapshots.length, 2);
    });
});
