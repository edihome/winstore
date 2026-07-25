/**
 * ============================================================
 * File: sync.repository.js
 * Module: Core Sync (offline-sync engine — Phase 0)
 *
 * Description:
 * Identity primitive for the sync engine. Every install has exactly one
 * "self" node per organization (a branch node on a shop box; a hub node per
 * org on the central SaaS). It's created lazily the first time it's needed —
 * the same idempotent pattern as roles.service.ensureTierRoles — and its id
 * is what stamps the writing node onto captured changes (app.current_node).
 *
 * Phase 0 is dormant: this exists and is tested, but nothing in the running
 * app calls it yet (capture is off). Phase 1 wires it into the request path.
 * ============================================================
 */

const crypto = require("crypto");
const pool = require("../../config/db");

/**
 * The organization's own node id, creating it on first use. Runs under the
 * caller's DB context (RLS scopes it to the org).
 *
 * @param {string} organizationId
 * @param {object} client DB client/pool (defaults to the pool).
 * @returns {Promise<string>} the self node's UUID.
 */
const getSelfNodeId = async (organizationId, client = pool) => {
    const existing = await client.query(
        `SELECT id FROM sync_nodes WHERE organization_id = $1 AND is_self = true LIMIT 1`,
        [organizationId]
    );
    if (existing.rows.length) {
        return existing.rows[0].id;
    }

    const id = crypto.randomUUID();
    const kind = process.env.SYNC_NODE_KIND === "hub" ? "hub" : "branch";
    try {
        await client.query(
            `INSERT INTO sync_nodes (id, organization_id, name, kind, is_self) VALUES ($1, $2, $3, $4, true)`,
            [id, organizationId, "This install", kind]
        );
        return id;
    } catch (error) {
        // A concurrent caller won the partial-unique race — use theirs.
        const row = await client.query(
            `SELECT id FROM sync_nodes WHERE organization_id = $1 AND is_self = true LIMIT 1`,
            [organizationId]
        );
        if (row.rows.length) {
            return row.rows[0].id;
        }
        throw error;
    }
};

// The tables the engine syncs — must match migration 056. Gates apply so a
// peer can never make us write an arbitrary table name.
const SYNCABLE_TABLES = new Set([
    "sales", "sale_items", "payments", "sale_returns", "stock_movements", "customer_ledger_entries",
    "expenses", "purchases", "purchase_items", "appointments", "attendance", "audit_logs",
    "products", "categories", "services", "discounts", "taxes", "customers", "suppliers", "users", "roles", "settings", "branches",
]);

// Dependency-safe apply order: parents/reference before children/transactions,
// so a batch applied top-to-bottom never trips a foreign key.
const APPLY_ORDER = [
    "branches", "roles", "users", "settings", "categories", "taxes", "discounts", "suppliers", "products", "services", "customers",
    "purchases", "purchase_items", "sales", "sale_items", "payments", "sale_returns", "stock_movements",
    "customer_ledger_entries", "expenses", "appointments", "attendance", "audit_logs",
];

/** This org's change log after a peer's watermark, oldest first. */
const getChangesSince = async (organizationId, sinceSeq, limit, client = pool) => {
    const result = await client.query(
        `SELECT seq, node_id, table_name, row_id, op, row_data
         FROM sync_outbox
         WHERE organization_id = $1 AND seq > $2
         ORDER BY seq ASC
         LIMIT $3`,
        [organizationId, sinceSeq, Math.min(Number(limit) || 500, 1000)]
    );
    return result.rows;
};

const columnCache = new Map();
const getColumns = async (table, client) => {
    if (columnCache.has(table)) {
        return columnCache.get(table);
    }
    const result = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = $1 AND table_schema = current_schema()
         ORDER BY ordinal_position`,
        [table]
    );
    const cols = result.rows.map((row) => row.column_name);
    columnCache.set(table, cols);
    return cols;
};

/**
 * Idempotently apply one change onto the local DB, within the caller's org
 * context (RLS rejects a row that isn't the caller's org). Insert/update is an
 * upsert by id; delete removes by id (absent → no-op). MUST run in a
 * transaction with capture suppressed (the service does that) to avoid echo.
 */
const applyEntry = async (entry, client) => {
    const table = entry.table_name;
    if (!SYNCABLE_TABLES.has(table)) {
        throw new Error(`Refusing to apply an unknown table "${table}".`);
    }
    if (entry.op === "D") {
        await client.query(`DELETE FROM ${table} WHERE id = $1`, [entry.row_id]);
        return;
    }
    const setClause = (await getColumns(table, client))
        .filter((c) => c !== "id")
        .map((c) => `"${c}" = EXCLUDED."${c}"`)
        .join(", ");
    await client.query(
        `INSERT INTO ${table} SELECT * FROM jsonb_populate_record(NULL::${table}, $1::jsonb)
         ON CONFLICT (id) DO UPDATE SET ${setClause}`,
        [entry.row_data]
    );
};

/** Read (creating on first use) the org's watermarks against its hub peer. */
const getHubWatermarks = async (organizationId, localNodeId, client = pool) => {
    const existing = await client.query(
        `SELECT id, last_pushed_seq, last_pulled_seq FROM sync_state
         WHERE organization_id = $1 AND remote_node_id IS NULL LIMIT 1`,
        [organizationId]
    );
    if (existing.rows.length) {
        return {
            id: existing.rows[0].id,
            lastPushedSeq: Number(existing.rows[0].last_pushed_seq),
            lastPulledSeq: Number(existing.rows[0].last_pulled_seq),
        };
    }
    const id = crypto.randomUUID();
    await client.query(
        `INSERT INTO sync_state (id, organization_id, local_node_id, remote_node_id) VALUES ($1, $2, $3, NULL)`,
        [id, organizationId, localNodeId]
    );
    return { id, lastPushedSeq: 0, lastPulledSeq: 0 };
};

const setHubWatermarks = async (stateId, { lastPushedSeq, lastPulledSeq }, client = pool) => {
    await client.query(
        `UPDATE sync_state SET last_pushed_seq = $2, last_pulled_seq = $3, updated_at = NOW() WHERE id = $1`,
        [stateId, lastPushedSeq, lastPulledSeq]
    );
};

/** Sync status for an org: outbox depth and the newest local seq. */
const getStatus = async (organizationId, client = pool) => {
    const result = await client.query(
        `SELECT COUNT(*)::int AS pending, COALESCE(MAX(seq), 0)::bigint AS max_seq
         FROM sync_outbox WHERE organization_id = $1`,
        [organizationId]
    );
    return { pending: result.rows[0].pending, maxSeq: Number(result.rows[0].max_seq) };
};

module.exports = {
    getSelfNodeId,
    getChangesSince,
    applyEntry,
    getStatus,
    getHubWatermarks,
    setHubWatermarks,
    SYNCABLE_TABLES,
    APPLY_ORDER,
};
