/**
 * ============================================================
 * File: sync.scheduler.js
 * Module: Core Sync — automatic background reconcile
 *
 * Description:
 * Turns the manual "Sync now" into an unattended worker: on a BRANCH pointed at
 * a hub, it reconciles every SYNC_INTERVAL_MS, so a shop stays in step without
 * anyone clicking. Only active when the deployment supports sync (SYNC_ENABLED)
 * AND a hub is configured (SYNC_HUB_URL) — a hub install or a standalone shop
 * runs no worker. On failure it backs off exponentially (up to a cap) so a
 * flaky/offline link doesn't hammer the hub; a success resets the cadence.
 *
 * It syncs each org that has a "self" node in the local DB — one, on a branch.
 * Runs are never overlapped, and the last outcome is exposed for the UI.
 * ============================================================
 */

const env = require("../../config/env");
const db = require("../../config/db");
const logger = require("../../config/logger");
const syncService = require("./sync.service");
const syncConfig = require("./sync.config");

const BASE_INTERVAL = Math.max(Number(env.SYNC_INTERVAL_MS) || 300000, 15000);
const MAX_BACKOFF = Math.max(BASE_INTERVAL * 8, 900000);

let timer = null;
let running = false;
let stopped = true;
let backoff = BASE_INTERVAL;
const state = { lastRunAt: null, lastError: null, lastPushed: 0, lastPulled: 0 };

// The worker runs on a BRANCH (not a hub) when the deployment supports sync.
// Whether it has anywhere to sync TO (a hub) is re-checked each tick, so a
// branch that links mid-session starts syncing without a restart.
const isBranch = () => env.SYNC_NODE_KIND !== "hub";
const enabled = () => env.SYNC_ENABLED === "true" && isBranch();
const hubConfigured = () => Boolean(process.env.SYNC_HUB_URL || syncConfig.hubUrl() || env.SYNC_HUB_URL);

// The org(s) this install belongs to — its own "self" node(s). One on a branch.
const selfOrgs = async () => {
    const result = await db.runPrivileged(() =>
        db.query("SELECT DISTINCT organization_id FROM sync_nodes WHERE is_self = true")
    );
    return result.rows.map((r) => r.organization_id);
};

/**
 * One reconcile pass across this install's orgs. Never overlaps a prior pass.
 * Returns the aggregate outcome (also stored for the status endpoint).
 */
const runOnce = async () => {
    if (running) {
        return { skipped: true };
    }
    if (!hubConfigured()) {
        // A branch not yet linked to a hub — nothing to do, cheaply.
        return { pushed: 0, pulled: 0, skipped: true };
    }
    running = true;
    let pushed = 0;
    let pulled = 0;
    let error = null;
    try {
        const orgs = await selfOrgs();
        for (const org of orgs) {
            try {
                const result = await db.withOrgContext(org, () => syncService.run(org));
                pushed += result.pushed || 0;
                pulled += result.pulled || 0;
            } catch (err) {
                error = err.message;
                logger.warn("Auto-sync failed for org", { organizationId: org, error: err.message });
            }
        }
        state.lastRunAt = new Date().toISOString();
        state.lastPushed = pushed;
        state.lastPulled = pulled;
        state.lastError = error;
    } finally {
        running = false;
    }
    return { pushed, pulled, error };
};

const scheduleNext = (delay) => {
    if (stopped) return;
    timer = setTimeout(tick, delay);
    timer.unref?.();
};

const tick = async () => {
    const { error } = await runOnce();
    // Back off on failure so an offline link doesn't hammer the hub; a clean
    // run returns to the base cadence.
    backoff = error ? Math.min(backoff * 2, MAX_BACKOFF) : BASE_INTERVAL;
    scheduleNext(backoff);
};

const start = () => {
    if (!enabled() || !stopped) {
        return;
    }
    stopped = false;
    backoff = BASE_INTERVAL;
    logger.info("Auto-sync worker started", { intervalMs: BASE_INTERVAL });
    // First pass shortly after boot, not immediately, so startup stays quick.
    scheduleNext(5000);
};

const stop = () => {
    stopped = true;
    if (timer) {
        clearTimeout(timer);
        timer = null;
    }
};

const getStatus = () => ({
    lastSyncedAt: state.lastRunAt,
    lastError: state.lastError,
    running,
});

module.exports = { start, stop, runOnce, getStatus, enabled };
