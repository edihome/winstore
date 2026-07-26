/**
 * ============================================================
 * File: sync.config.js
 * Module: Core Sync — a branch's persisted link to its hub
 *
 * Description:
 * Holds (and caches) THIS install's enrollment: the hub URL and the durable
 * node token, from sync_branch_config. Loaded once at startup so the hot paths
 * (run/hubFetch/scheduler) can read it synchronously, and rewritten when the
 * branch links (see sync.service.link). A hub install or an unenrolled branch
 * simply has no config, and everything degrades to "no hub".
 * ============================================================
 */

const db = require("../../config/db");
const logger = require("../../config/logger");

// { organizationId, hubUrl, nodeId, refreshSecret } | null
let cache = null;

/** Load the persisted link into memory (called at boot). Safe pre-migration. */
const load = async () => {
    try {
        const result = await db.runPrivileged(() =>
            db.query("SELECT organization_id, hub_url, node_id, refresh_secret FROM sync_branch_config LIMIT 1")
        );
        const row = result.rows[0];
        cache = row
            ? { organizationId: row.organization_id, hubUrl: row.hub_url, nodeId: row.node_id, refreshSecret: row.refresh_secret }
            : null;
    } catch (error) {
        // Table may not exist yet (fresh DB pre-migration) — treat as unlinked.
        cache = null;
        logger.warn?.("sync config not loaded", { error: error.message });
    }
    return cache;
};

/** Persist (and cache) a branch's link after enrollment (the refresh secret). */
const save = async ({ organizationId, hubUrl, nodeId, refreshSecret }) => {
    await db.runPrivileged(() =>
        db.query(
            `INSERT INTO sync_branch_config (organization_id, hub_url, node_id, node_token, refresh_secret)
             VALUES ($1, $2, $3, '', $4)
             ON CONFLICT (organization_id) DO UPDATE
               SET hub_url = EXCLUDED.hub_url, node_id = EXCLUDED.node_id,
                   refresh_secret = EXCLUDED.refresh_secret, enrolled_at = NOW()`,
            [organizationId, hubUrl, nodeId || null, refreshSecret]
        )
    );
    cache = { organizationId, hubUrl, nodeId, refreshSecret };
    return cache;
};

const get = () => cache;
const isLinked = () => Boolean(cache);
const hubUrl = () => (cache ? cache.hubUrl : "");

module.exports = { load, save, get, isLinked, hubUrl };
