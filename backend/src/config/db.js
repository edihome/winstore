/**
 * ============================================================
 * File: db.js
 * Module: Configuration
 *
 * Description:
 * Shared PostgreSQL connection pool, wrapped so that every query runs with
 * the caller's tenant context attached. Row Level Security policies (see
 * migration 052) read a per-connection `app.current_org` setting, so
 * organization isolation is enforced by the DATABASE — a query that forgets
 * its `WHERE organization_id = …` returns nothing rather than another
 * tenant's rows.
 *
 * The whole app keeps using this module exactly like a pg Pool
 * (`.query`, `.connect`). The routing is invisible:
 *   - `.query`   runs on the active request's org-scoped connection when one
 *                is set (see middlewares/orgContext.js), else on the raw pool
 *                (no context → RLS returns nothing, the safe default);
 *   - `.connect` hands out a dedicated connection for an explicit
 *                transaction and pins the tenant context to it the moment the
 *                transaction opens (right after BEGIN), clearing when it ends.
 *
 * `runPrivileged` is the narrow, deliberate escape hatch for the few
 * operations that legitimately cross or precede a single tenant (login,
 * registration, the attendance kiosk, the developer role).
 * ============================================================
 */

const { Pool } = require("pg");
const { AsyncLocalStorage } = require("node:async_hooks");
const env = require("./env");
const logger = require("./logger");

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  // Each in-flight request pins one connection for its org context (plus a
  // second for any explicit transaction), so the ceiling is higher than the
  // old default of 20.
  max: 30,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  logger.error("PostgreSQL pool error", { message: err.message, stack: err.stack });
});

// Carries the current request's tenant context (the org-scoped connection and
// its organization id / bypass flag) across the async call chain.
const storage = new AsyncLocalStorage();

// Applies the active context onto a transaction the instant it opens. Called
// on the wrapped client returned by `connect()` — the app's services all
// start transactions with `client.query("BEGIN")`, so this fires exactly
// once per transaction and clears automatically on COMMIT/ROLLBACK (LOCAL).
const pinContextAfterBegin = (rawQuery, store) => (...args) => {
  const text = typeof args[0] === "string" ? args[0] : args[0] && args[0].text;
  const result = rawQuery(...args);
  if (store && /^\s*BEGIN/i.test(String(text || ""))) {
    return Promise.resolve(result).then(async (res) => {
      // Establish the FULL context every time, setting both GUCs — never just
      // one. A pooled connection can carry a stale value from a prior
      // transaction on it (e.g. a runPrivileged bypass that reverted at the
      // session level but lingered), so a non-bypass transaction must
      // explicitly clear bypass, and a bypass transaction must clear the org.
      // Otherwise a later transaction could silently inherit RLS bypass.
      if (store.bypass) {
        await rawQuery("SELECT set_config('app.bypass_rls', 'on', true)");
        await rawQuery("SELECT set_config('app.current_org', '', true)");
      } else {
        await rawQuery("SELECT set_config('app.bypass_rls', 'off', true)");
        await rawQuery("SELECT set_config('app.current_org', $1, true)", [store.orgId || ""]);
      }
      // Sync change-capture: only when the request carries a self node (i.e.
      // SYNC_ENABLED). The trigger (migration 056) reads both GUCs.
      if (store.syncNode) {
        await rawQuery("SELECT set_config('app.sync_capture', 'on', true)");
        await rawQuery("SELECT set_config('app.current_node', $1, true)", [store.syncNode]);
      }
      return res;
    });
  }
  return result;
};

const db = {
  query: (...args) => {
    const store = storage.getStore();
    return (store && store.client ? store.client : pool).query(...args);
  },

  connect: async () => {
    const client = await pool.connect();
    const store = storage.getStore();
    const rawQuery = client.query.bind(client);
    client.query = pinContextAfterBegin(rawQuery, store);
    return client;
  },

  on: (...args) => pool.on(...args),
  end: (...args) => pool.end(...args),
  get totalCount() {
    return pool.totalCount;
  },
  get idleCount() {
    return pool.idleCount;
  },
};

// Exposed for the request-context middleware.
db.pool = pool;
db.storage = storage;

/**
 * Run `fn` with RLS bypassed, on a dedicated connection. For the handful of
 * legitimately cross-/pre-tenant operations: login and the attendance kiosk
 * (look a user up by email across all orgs), and registration (creates a new
 * organization before any context exists). Deliberately narrow — everything
 * else is forced to a single tenant.
 *
 * @param {Function} fn Async function to run under the bypass.
 * @returns {Promise<*>} Whatever `fn` returns.
 */
db.runPrivileged = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.bypass_rls', 'on', false)");
    return await storage.run({ client, bypass: true }, () => fn());
  } finally {
    try {
      await client.query("SELECT set_config('app.bypass_rls', 'off', false)");
      client.release();
    } catch {
      client.release(true);
    }
  }
};

module.exports = db;
