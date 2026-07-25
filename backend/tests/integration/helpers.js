/**
 * ============================================================
 * File: helpers.js
 * Module: Integration Tests
 *
 * Description:
 * Shared harness for the money-path integration suite. Boots the REAL
 * Express app in-process on an ephemeral port, pointed at the isolated
 * "winstore_test" schema (see testdb.js), and drives it over HTTP — so
 * every test exercises the full stack: routes, auth/permission/branch/
 * subscription middleware, services, repositories, and real PostgreSQL
 * transactions. No mocks, no running dev server, no touching real data.
 *
 * Requiring this module MUST be the first thing a test file does, because
 * it sets DATABASE_URL to the test schema before the app's connection pool
 * is created.
 *
 * If the test schema isn't set up (e.g. CI without a database), tests
 * registered via `itDb` skip cleanly instead of failing — run
 * `npm run test:setup` once to enable them.
 * ============================================================
 */

require("dotenv").config({ quiet: true });
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "integration-test-secret";

const { TEST_SCHEMA, appDatabaseUrl } = require("./testdb");

// Redirect the whole app onto the isolated schema BEFORE config/db builds
// its pool. config/env re-runs dotenv, but dotenv never overrides a variable
// already set on process.env, so this assignment wins.
process.env.DATABASE_URL = appDatabaseUrl();

const test = require("node:test");
const { before, after } = test;
const app = require("../../src/app");
const pool = require("../../src/config/db");

let server = null;
let baseUrl = "";
let dbReady = false;

const startApp = async () => {
    await new Promise((resolve) => {
        server = app.listen(0, resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
};

/**
 * Empty every test-schema table (keeping the migration bookkeeping) so each
 * case starts from a clean, known state.
 *
 * @returns {Promise<void>}
 */
const resetDb = async () => {
    const { rows } = await pool.query(
        "SELECT tablename FROM pg_tables WHERE schemaname = $1 AND tablename <> 'pgmigrations'",
        [TEST_SCHEMA]
    );
    if (rows.length === 0) {
        return;
    }
    const list = rows.map((row) => `"${TEST_SCHEMA}"."${row.tablename}"`).join(", ");
    await pool.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
};

/**
 * Make an API call against the in-process app.
 *
 * @param {string} method HTTP method.
 * @param {string} path Path under /api/v1 (e.g. "/sales").
 * @param {object} [options] { token, body }.
 * @returns {Promise<{status:number, body:object}>}
 */
const api = async (method, path, { token, body, headers } = {}) => {
    const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(headers || {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    let parsed = {};
    try {
        parsed = await res.json();
    } catch {
        parsed = {};
    }
    return { status: res.status, body: parsed, headers: res.headers };
};

let counter = 0;
const uniqueEmail = (prefix = "user") => `${prefix}-${Date.now().toString(36)}-${counter++}@test.local`;

/**
 * Register a brand-new organization and return the owner's logged-in
 * session. The first user of an org is its super_admin.
 *
 * @param {object} [overrides] { email, password, organizationName }.
 * @returns {Promise<{token:string, user:object, email:string, password:string}>}
 */
const registerOwner = async (overrides = {}) => {
    const email = overrides.email || uniqueEmail("owner");
    const password = overrides.password || "password123";
    const organizationName = overrides.organizationName || `Org ${email}`;

    const reg = await api("POST", "/auth/register", {
        body: { firstName: "Test", lastName: "Owner", email, password, organizationName },
    });
    if (reg.status >= 300) {
        throw new Error(`registerOwner failed: ${reg.status} ${JSON.stringify(reg.body)}`);
    }
    const login = await api("POST", "/auth/login", { body: { email, password } });
    return { ...login.body.data, email, password };
};

/**
 * Create a non-privileged staff user under an owner and return that user's
 * logged-in session. Grants exactly the given module resources (":manage"
 * on each); baseline capabilities apply regardless.
 *
 * @param {object} owner Owner session from registerOwner.
 * @param {object} [options] { resources: string[], branchId }.
 * @returns {Promise<{token:string, user:object, email:string, password:string, roleId:string}>}
 */
const createStaff = async (owner, { resources = [], permissions, branchId, roleId: presetRoleId } = {}) => {
    // Either assign an existing role (e.g. a seeded tier) by id, or spin up a
    // custom role from granular `permissions` ("resource:action" strings) or a
    // legacy `resources` list (→ manage each).
    let roleId = presetRoleId;
    if (!roleId) {
        const body = permissions
            ? { name: `Role ${uniqueEmail("r")}`, permissions }
            : { name: `Role ${uniqueEmail("r")}`, resources };
        const role = await api("POST", "/roles", { token: owner.token, body });
        if (role.status >= 300) {
            throw new Error(`createStaff role failed: ${role.status} ${JSON.stringify(role.body)}`);
        }
        roleId = role.body.data.id;
    }
    const branch = branchId || owner.user.branchId;

    const email = uniqueEmail("staff");
    const password = "password123";
    const created = await api("POST", "/users", {
        token: owner.token,
        // Send both the primary branchId and the branchIds set, exactly as the
        // Staff page does — the primary column is what branch-scope checks use.
        body: { firstName: "Staff", lastName: "Member", email, password, roleId, branchId: branch, branchIds: [branch] },
    });
    if (created.status >= 300) {
        throw new Error(`createStaff user failed: ${created.status} ${JSON.stringify(created.body)}`);
    }

    // New users are created with must_change_password set, and the app
    // blocks every action until they do. Clear it so the helper hands back
    // a ready-to-use session, just like a real first login would.
    const firstLogin = await api("POST", "/auth/login", { body: { email, password } });
    const finalPassword = "password456";
    const changed = await api("PATCH", "/auth/change-password", {
        token: firstLogin.body.data.token,
        body: { currentPassword: password, newPassword: finalPassword },
    });
    if (changed.status >= 300) {
        throw new Error(`createStaff change-password failed: ${changed.status} ${JSON.stringify(changed.body)}`);
    }
    const login = await api("POST", "/auth/login", { body: { email, password: finalPassword } });
    return { ...login.body.data, email, password: finalPassword, roleId };
};

/**
 * Register before/after hooks: detect the isolated schema and boot the app
 * once for the file, tearing it down at the end.
 *
 * @returns {void}
 */
const useIntegrationDb = () => {
    before(async () => {
        try {
            await pool.query(`SELECT 1 FROM "${TEST_SCHEMA}".organizations LIMIT 1`);
            dbReady = true;
            await startApp();
        } catch {
            dbReady = false;
        }
    });
    after(async () => {
        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }
        await pool.end();
    });
};

const SKIP_MESSAGE = 'test schema unavailable — run "npm run test:setup" to enable integration tests';

/**
 * Define a database-backed test: skips cleanly when the schema isn't set
 * up, and otherwise resets to a clean schema before running.
 *
 * @param {string} name Test name.
 * @param {Function} fn async (t) => {...}
 * @returns {void}
 */
const itDb = (name, fn) => {
    test(name, async (t) => {
        if (!dbReady) {
            t.skip(SKIP_MESSAGE);
            return;
        }
        await resetDb();
        await fn(t);
    });
};

module.exports = { api, registerOwner, createStaff, resetDb, itDb, useIntegrationDb, pool, TEST_SCHEMA };
