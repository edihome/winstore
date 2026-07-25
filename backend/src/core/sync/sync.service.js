/**
 * ============================================================
 * File: sync.service.js
 * Module: Core Sync (offline-sync engine — Phase 1)
 *
 * Description:
 * The sync protocol on top of the Phase 0 change log:
 *   - pull   — hand a peer this org's changes after their watermark;
 *   - apply  — idempotently apply a peer's batch onto the local DB, with
 *              change-capture suppressed so applied rows don't echo back;
 *   - status — outbox depth + last-sync time for the org;
 *   - run    — a branch's reconcile: push local changes to the hub, then
 *              pull and apply the hub's, advancing watermarks.
 *
 * Enabled by SYNC_ENABLED (capture) + SYNC_HUB_URL/TOKEN (a branch's hub).
 * Everything is per-tenant: the caller's org context (RLS) is the boundary.
 * ============================================================
 */

const AppError = require("../../utils/AppError");
const env = require("../../config/env");
const db = require("../../config/db");
const syncRepository = require("./sync.repository");

const HUB_URL = env.SYNC_HUB_URL.replace(/\/+$/, "");
const HUB_TOKEN = env.SYNC_HUB_TOKEN;

/** This org's changes after `since`, for a peer to apply. */
const pull = async (organizationId, since, limit) =>
    syncRepository.getChangesSince(organizationId, Number(since) || 0, limit);

/**
 * Apply a peer's batch idempotently, in dependency-safe order, with capture
 * suppressed (so we don't re-log — and re-broadcast — what we just received).
 * RLS rejects any row that isn't this org's, so a bad batch can't cross tenants.
 *
 * @returns {Promise<{applied:number}>}
 */
const apply = async (changes = []) => {
    if (!Array.isArray(changes) || changes.length === 0) {
        return { applied: 0 };
    }
    const order = syncRepository.APPLY_ORDER;
    const ordered = [...changes].sort((a, b) => {
        const ai = order.indexOf(a.table_name);
        const bi = order.indexOf(b.table_name);
        if (ai !== bi) return ai - bi;
        return (Number(a.seq) || 0) - (Number(b.seq) || 0);
    });

    const client = await db.connect();
    try {
        await client.query("BEGIN");
        // Suppress echo: applying a peer's change must not capture it again.
        await client.query("SELECT set_config('app.sync_capture', 'off', true)");
        let applied = 0;
        for (const entry of ordered) {
            await syncRepository.applyEntry(entry, client);
            applied += 1;
        }
        await client.query("COMMIT");
        return { applied };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
};

const status = async (organizationId) => {
    const s = await syncRepository.getStatus(organizationId);
    return {
        enabled: env.SYNC_ENABLED === "true",
        hubConfigured: Boolean(HUB_URL),
        pending: s.pending,
        latestSeq: s.maxSeq,
    };
};

const hubFetch = async (path, options = {}) => {
    const res = await fetch(`${HUB_URL}${path}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(HUB_TOKEN ? { Authorization: `Bearer ${HUB_TOKEN}` } : {}),
            ...(options.headers || {}),
        },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new AppError(body.message || `Hub responded ${res.status}.`, 502);
    }
    return body;
};

/**
 * A branch's manual/scheduled reconcile: push everything above our push
 * watermark to the hub, then pull and apply everything above our pull
 * watermark. A hub install (or an unconfigured one) has nothing to do.
 *
 * @param {string} organizationId
 * @returns {Promise<{pushed:number, pulled:number, at:string, message?:string}>}
 */
const run = async (organizationId) => {
    if (!HUB_URL) {
        // A hub node, or a branch not yet pointed at one — nothing to reconcile.
        return { pushed: 0, pulled: 0, at: new Date().toISOString(), message: "No hub configured." };
    }

    const selfNode = await syncRepository.getSelfNodeId(organizationId);
    const marks = await syncRepository.getHubWatermarks(organizationId, selfNode);

    // 1) Push our changes above the push watermark.
    const outgoing = await syncRepository.getChangesSince(organizationId, marks.lastPushedSeq, 1000);
    let lastPushedSeq = marks.lastPushedSeq;
    if (outgoing.length > 0) {
        await hubFetch("/api/v1/sync/apply", { method: "POST", body: JSON.stringify({ changes: outgoing }) });
        lastPushedSeq = Math.max(...outgoing.map((c) => Number(c.seq)));
    }

    // 2) Pull the hub's changes above the pull watermark and apply them.
    const pulled = await hubFetch(`/api/v1/sync/changes?since=${marks.lastPulledSeq}&limit=1000`);
    const incoming = pulled.data || [];
    let lastPulledSeq = marks.lastPulledSeq;
    if (incoming.length > 0) {
        await apply(incoming);
        lastPulledSeq = Math.max(...incoming.map((c) => Number(c.seq)));
    }

    await syncRepository.setHubWatermarks(marks.id, { lastPushedSeq, lastPulledSeq });
    return { pushed: outgoing.length, pulled: incoming.length, at: new Date().toISOString() };
};

module.exports = { pull, apply, status, run };
