/**
 * ============================================================
 * File: orgContext.js
 * Module: Middlewares
 *
 * Description:
 * Establishes the database-level tenant context for an authenticated
 * request. Runs right after `authenticate` (so req.user is known) and
 * before anything that touches tenant data — including the session guard.
 *
 * It checks out one dedicated connection, pins it to the caller's
 * organization via the `app.current_org` setting that Row Level Security
 * policies read (see migration 052), and stashes it on an AsyncLocalStorage
 * context so every query in the request runs isolated to that tenant at the
 * database. The developer role — the one legitimately cross-organization
 * actor — is given the RLS bypass instead. The connection is reset and
 * released when the response finishes.
 *
 * If a request has no tenant identity, it proceeds with NO context: RLS
 * then returns nothing for tenant tables, which is the safe default (never
 * another org's data).
 * ============================================================
 */

const db = require("../config/db");
const env = require("../config/env");
const { getSelfNodeId } = require("../core/sync/sync.repository");

// Master switch: does THIS deployment support sync at all? Off on a pure
// cloud SaaS deploy → the whole per-org path below is skipped, so a plain
// tenant pays nothing (no extra query, no capture).
const SYNC_ENABLED = env.SYNC_ENABLED === "true";

// Each org's self node id, resolved once and cached (stable for the process).
const selfNodeCache = new Map();
const resolveSelfNode = async (orgId, client) => {
    if (selfNodeCache.has(orgId)) {
        return selfNodeCache.get(orgId);
    }
    const id = await getSelfNodeId(orgId, client);
    selfNodeCache.set(orgId, id);
    return id;
};

// Per-org opt-in flag, short-TTL cached so the common (not-enrolled) case is a
// Map hit, not a query per request — while still engaging capture within the
// TTL after an org enrolls, even across multiple hub instances. Enrollment
// also clears the entry in-process for an immediate effect on that instance.
const ORG_SYNC_TTL_MS = 60000;
const orgSyncCache = new Map();
const isOrgSyncEnabled = async (orgId, client) => {
    const hit = orgSyncCache.get(orgId);
    if (hit && Date.now() - hit.at < ORG_SYNC_TTL_MS) {
        return hit.enabled;
    }
    const result = await client.query("SELECT sync_enabled FROM organizations WHERE id = $1", [orgId]);
    const enabled = result.rows[0]?.sync_enabled === true;
    orgSyncCache.set(orgId, { enabled, at: Date.now() });
    return enabled;
};

// Called by enrollment when an org's flag flips, so this instance engages
// capture on the very next request instead of waiting out the TTL.
const invalidateOrgSync = (orgId) => orgSyncCache.delete(orgId);

const enforceOrgDbContext = async (req, res, next) => {
    const orgId = req.user && req.user.organizationId;
    const bypass = Boolean(req.user && req.user.role === "developer");

    if (!orgId && !bypass) {
        return next();
    }

    let client;
    let syncNode = null;
    try {
        client = await db.pool.connect();
        if (bypass) {
            await client.query("SELECT set_config('app.bypass_rls', 'on', false)");
        } else {
            // Explicitly clear bypass too — never rely on a pooled connection
            // having been left clean. A non-developer request must never carry
            // RLS bypass, whatever the connection's prior use.
            await client.query("SELECT set_config('app.bypass_rls', 'off', false)");
            await client.query("SELECT set_config('app.current_org', $1, false)", [orgId]);
            // Turn on change capture for this org's writes ONLY when the
            // deployment supports sync AND this specific org has opted into
            // offline. The org lookup runs after current_org is set, so RLS
            // allows it (the org can read its own row).
            if (SYNC_ENABLED && (await isOrgSyncEnabled(orgId, client))) {
                syncNode = await resolveSelfNode(orgId, client);
                await client.query("SELECT set_config('app.sync_capture', 'on', false)");
                await client.query("SELECT set_config('app.current_node', $1, false)", [syncNode]);
            }
        }
    } catch (error) {
        if (client) {
            client.release(true);
        }
        return next(error);
    }

    let released = false;
    const cleanup = async () => {
        if (released) {
            return;
        }
        released = true;
        try {
            // Clear before returning the connection to the pool so it can
            // never be reused carrying a stale tenant context.
            await client.query("SELECT set_config('app.current_org', '', false)");
            await client.query("SELECT set_config('app.bypass_rls', 'off', false)");
            if (SYNC_ENABLED) {
                await client.query("SELECT set_config('app.sync_capture', 'off', false)");
                await client.query("SELECT set_config('app.current_node', '', false)");
            }
            client.release();
        } catch {
            client.release(true);
        }
    };
    res.on("finish", cleanup);
    res.on("close", cleanup);

    // Run the rest of the request within the context so every query the
    // downstream handlers issue lands on this org-scoped connection.
    db.storage.run({ client, orgId, bypass, syncNode }, () => next());
};

module.exports = { enforceOrgDbContext, invalidateOrgSync };
