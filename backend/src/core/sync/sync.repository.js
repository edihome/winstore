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

// The sync PROTOCOL/payload compatibility version. Bump this whenever a change
// alters what crosses the wire — a synced table added/removed, or a column
// added/removed/retyped on a synced table — so a stale branch and an updated
// hub refuse to sync rather than silently corrupt each other. NOT every
// migration bumps it, only sync-payload-affecting ones. Env-overridable so the
// cross-node E2E can force a mismatch.
const SYNC_SCHEMA_VERSION = Number(process.env.SYNC_SCHEMA_VERSION) || 1;

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
    "sales", "sale_items", "payments", "sale_returns", "stock_movements", "stock_batches", "stock_shipments", "customer_ledger_entries",
    "expenses", "purchases", "purchase_items", "appointments", "attendance", "audit_logs",
    "products", "categories", "services", "discounts", "taxes", "customers", "suppliers", "users", "roles", "settings", "branches",
    // Tenant root + RBAC/identity reference (all id-keyed so the generic upsert
    // works). organizations is snapshot-only; permissions/role_permissions/
    // user_branches now also capture incrementally (migration 059).
    "organizations", "permissions", "role_permissions", "user_branches",
]);

// Directionality (the asymmetric design): the hub is AUTHORITATIVE for
// reference + identity (catalog, prices, roles, users, settings) — those flow
// DOWN only. A branch may push UP just what it authors: the transactions
// (append-only) plus customers (created at POS or centrally = bidirectional).
// A branch never pushes a reference change up, so it can't clobber the center.
const BRANCH_PUSH_TABLES = new Set([
    "sales", "sale_items", "payments", "sale_returns", "stock_movements", "stock_batches", "customer_ledger_entries",
    "expenses", "purchases", "purchase_items", "appointments", "attendance", "customers",
    // Shipments are bidirectional: the source authors ship, the destination
    // authors receive — so a branch pushes its half up (different fields, no
    // real conflict on the row).
    "stock_shipments",
    // NOTE: audit_logs is DELIBERATELY NOT here — a branch must not be able to
    // push forged audit entries. The hub owns the audit trail; a branch's local
    // audit stays local (dropped on push, so it never inflates the hub trail).
]);

// Dependency-safe apply order: parents/reference before children/transactions,
// so a batch applied top-to-bottom never trips a foreign key.
const APPLY_ORDER = [
    "organizations", "branches", "roles", "permissions", "role_permissions", "users", "user_branches", "settings", "categories", "taxes", "discounts", "suppliers", "products", "services", "customers",
    "purchases", "purchase_items", "sales", "sale_items", "payments", "sale_returns", "stock_movements", "stock_batches", "stock_shipments",
    "customer_ledger_entries", "expenses", "appointments", "attendance", "audit_logs",
];

// A change may never carry secrets over the wire. Password hashes are NEVER
// synced — a branch caches a user's hash locally only after that user proves
// their password online (see /sync/credential + auth first-online-login).
const stripSyncSecrets = (tableName, rowData) => {
    if (tableName === "users" && rowData && "password_hash" in rowData) {
        const clone = { ...rowData };
        delete clone.password_hash;
        return clone;
    }
    return rowData;
};

/** This org's change log after a peer's watermark, oldest first (secrets stripped). */
const getChangesSince = async (organizationId, sinceSeq, limit, client = pool) => {
    const result = await client.query(
        `SELECT seq, node_id, table_name, row_id, op, row_data
         FROM sync_outbox
         WHERE organization_id = $1 AND seq > $2
         ORDER BY seq ASC
         LIMIT $3`,
        [organizationId, sinceSeq, Math.min(Number(limit) || 500, 1000)]
    );
    return result.rows.map((row) => ({ ...row, row_data: stripSyncSecrets(row.table_name, row.row_data) }));
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
        // Never let a synced users row overwrite the locally-cached password
        // hash (which sync never carries) — preserve it across upserts.
        .filter((c) => c !== "id" && !(table === "users" && c === "password_hash"))
        .map((c) => `"${c}" = EXCLUDED."${c}"`)
        .join(", ");
    // users.password_hash is NOT NULL but sync never carries it — insert an
    // empty placeholder (auth treats "" as "not cached yet" and fetches it on
    // first online login). On conflict it's excluded above, so a real cached
    // hash is preserved.
    let rowData = entry.row_data;
    if (table === "users" && rowData && !rowData.password_hash) {
        rowData = { ...rowData, password_hash: "" };
    }
    await client.query(
        `INSERT INTO ${table} SELECT * FROM jsonb_populate_record(NULL::${table}, $1::jsonb)
         ON CONFLICT (id) DO UPDATE SET ${setClause}`,
        [rowData]
    );

    // product_stock is a maintained AGGREGATE, not a synced table — the app's
    // movement logic keeps it right on the acting node, but on OTHER nodes a
    // synced stock_movement wouldn't touch it. So when we apply a movement,
    // carry its authoritative post-movement quantity onto the aggregate, so
    // every node's branch stock reflects the movements it has seen. (Movements
    // apply in seq order, so the latest wins — idempotent to re-apply.)
    if (table === "stock_movements") {
        const m = entry.row_data || {};
        if (m.organization_id && m.branch_id && m.product_id && m.quantity_after != null) {
            await client.query(
                `INSERT INTO product_stock (id, organization_id, branch_id, product_id, quantity, reorder_level, created_at, updated_at)
                 VALUES (gen_random_uuid(), $1, $2, $3, $4, 0, NOW(), NOW())
                 ON CONFLICT (branch_id, product_id) DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = NOW()`,
                [m.organization_id, m.branch_id, m.product_id, m.quantity_after]
            );
        }
    }
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

/** A user's id + password hash by email, scoped to the current org by RLS. */
const findUserCredential = async (email, client = pool) => {
    const result = await client.query("SELECT id, password_hash FROM users WHERE lower(email) = lower($1) LIMIT 1", [email]);
    return result.rows[0] || null;
};

/** Whether an org has opted into offline sync (the per-org guardrail flag). */
const getOrgSyncEnabled = async (organizationId, client = pool) => {
    const result = await client.query("SELECT sync_enabled FROM organizations WHERE id = $1", [organizationId]);
    return result.rows[0]?.sync_enabled === true;
};

/** Flip an org's offline opt-in (set true when it enrolls its first branch). */
const setOrgSyncEnabled = async (organizationId, enabled, client = pool) => {
    await client.query("UPDATE organizations SET sync_enabled = $2 WHERE id = $1", [organizationId, enabled]);
};

// ---- enrollment ----------------------------------------------------------

const createEnrollmentToken = async ({ organizationId, branchId, tokenHash, name, expiresAt, createdBy }, client = pool) => {
    const result = await client.query(
        `INSERT INTO sync_enrollment_tokens (organization_id, branch_id, token_hash, name, expires_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, expires_at`,
        [organizationId, branchId || null, tokenHash, name || null, expiresAt, createdBy || null]
    );
    return result.rows[0];
};

/** Look up an unredeemed code by its hash — called under bypass (no org ctx). */
const findEnrollmentTokenByHash = async (tokenHash, client = pool) => {
    const result = await client.query(
        `SELECT id, organization_id, branch_id, name, expires_at, used_at
         FROM sync_enrollment_tokens WHERE token_hash = $1 LIMIT 1`,
        [tokenHash]
    );
    return result.rows[0] || null;
};

const markEnrollmentTokenUsed = async (id, nodeId, client = pool) => {
    await client.query("UPDATE sync_enrollment_tokens SET used_at = NOW(), used_by_node_id = $2 WHERE id = $1", [id, nodeId]);
};

/**
 * Atomically CLAIM a valid, unused, unexpired code — the update itself is the
 * lock, so two concurrent redemptions can't both win the "one-time" code. Marks
 * it used and returns the token, or null if it wasn't claimable.
 */
const claimEnrollmentToken = async (tokenHash, client = pool) => {
    const result = await client.query(
        `UPDATE sync_enrollment_tokens
         SET used_at = NOW()
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
         RETURNING id, organization_id, branch_id, name`,
        [tokenHash]
    );
    return result.rows[0] || null;
};

// ---- branch nodes (the hub's registry of remote branches) ----------------

const createBranchNode = async ({ id, organizationId, branchId, name, refreshSecretHash }, client = pool) => {
    await client.query(
        `INSERT INTO sync_nodes (id, organization_id, branch_id, name, kind, is_self, is_active, token_version, refresh_secret_hash)
         VALUES ($1, $2, $3, $4, 'branch', false, true, 0, $5)`,
        [id, organizationId, branchId || null, name || "Branch", refreshSecretHash || null]
    );
};

/**
 * Node lookup for the token-refresh endpoint — runs PRIVILEGED (no org context
 * yet; the refresh secret is the credential), so it selects across orgs by id.
 */
const findNodeForRefresh = async (nodeId, client = pool) => {
    const result = await client.query(
        "SELECT id, organization_id, is_active, token_version, refresh_secret_hash FROM sync_nodes WHERE id = $1",
        [nodeId]
    );
    return result.rows[0] || null;
};

/** A node by id, scoped to the current org by RLS — used to verify a token. */
const getNodeById = async (nodeId, client = pool) => {
    const result = await client.query(
        "SELECT id, organization_id, kind, is_self, is_active, token_version, name, branch_id, last_seen_at FROM sync_nodes WHERE id = $1",
        [nodeId]
    );
    return result.rows[0] || null;
};

/** The org's remote branch nodes (not the hub's own self node), for the UI. */
const listBranchNodes = async (organizationId, client = pool) => {
    const result = await client.query(
        `SELECT id, name, branch_id, is_active, token_version, last_seen_at, last_pulled_seq, created_at
         FROM sync_nodes WHERE organization_id = $1 AND kind = 'branch' AND is_self = false
         ORDER BY created_at DESC`,
        [organizationId]
    );
    return result.rows;
};

/** The newest change seq in this org's outbox — the yardstick for "behind". */
const getMaxOutboxSeq = async (organizationId, client = pool) => {
    const result = await client.query("SELECT COALESCE(MAX(seq), 0)::bigint AS max FROM sync_outbox WHERE organization_id = $1", [organizationId]);
    return Number(result.rows[0].max);
};

/** Revoke a branch: deactivate it AND bump its token version so its token dies. */
const revokeNode = async (nodeId, client = pool) => {
    const result = await client.query(
        `UPDATE sync_nodes SET is_active = false, token_version = token_version + 1
         WHERE id = $1 AND kind = 'branch' AND is_self = false RETURNING id`,
        [nodeId]
    );
    return result.rowCount > 0;
};

const touchNode = async (nodeId, client = pool) => {
    await client.query("UPDATE sync_nodes SET last_seen_at = NOW() WHERE id = $1", [nodeId]);
};

// ---- outbox garbage collection -------------------------------------------

/** Record how far a branch node has confirmed pulling (monotonic low-water). */
const recordNodePull = async (nodeId, sinceSeq, client = pool) => {
    await client.query(
        "UPDATE sync_nodes SET last_pulled_seq = GREATEST(last_pulled_seq, $2), last_seen_at = NOW() WHERE id = $1",
        [nodeId, Number(sinceSeq) || 0]
    );
};

/**
 * The lowest confirmed pull point across an org's ACTIVE branch nodes — below
 * this, the hub's outbox is safe to drop. Null when the org has no active
 * branch (then nothing is pruned: a branch might still be offline).
 */
const minBranchPullSeq = async (organizationId, client = pool) => {
    const result = await client.query(
        `SELECT MIN(last_pulled_seq) AS floor
         FROM sync_nodes
         WHERE organization_id = $1 AND kind = 'branch' AND is_self = false AND is_active = true`,
        [organizationId]
    );
    const floor = result.rows[0]?.floor;
    return floor === null || floor === undefined ? null : Number(floor);
};

// ---- rejection log (central-wins drops) ----------------------------------

const recordRejection = async ({ organizationId, nodeId, tableName, rowId, op, reason }, client = pool) => {
    await client.query(
        `INSERT INTO sync_rejections (organization_id, node_id, table_name, row_id, op, reason)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [organizationId, nodeId || null, tableName, rowId || null, op || null, reason || null]
    );
};

/** Recent dropped changes for the org, newest first, with the branch's name. */
const listRejections = async (organizationId, limit = 100, client = pool) => {
    const result = await client.query(
        `SELECT r.id, r.node_id, n.name AS node_name, r.table_name, r.row_id, r.op, r.reason, r.created_at
         FROM sync_rejections r
         LEFT JOIN sync_nodes n ON n.id = r.node_id
         WHERE r.organization_id = $1
         ORDER BY r.created_at DESC
         LIMIT $2`,
        [organizationId, Math.min(Number(limit) || 100, 500)]
    );
    return result.rows;
};

/** Drop outbox rows at or below a seq known to be delivered. Returns the count. */
const pruneOutboxBelow = async (organizationId, floorSeq, client = pool) => {
    if (!floorSeq || floorSeq <= 0) {
        return 0;
    }
    const result = await client.query(
        "DELETE FROM sync_outbox WHERE organization_id = $1 AND seq <= $2",
        [organizationId, floorSeq]
    );
    return result.rowCount;
};

const lockBootstrap = (client) => client.query("SELECT pg_advisory_xact_lock(198704, 1)");

const hasLocalBusiness = async (client = pool) => {
    const result = await client.query(
        "SELECT EXISTS(SELECT 1 FROM organizations) OR EXISTS(SELECT 1 FROM sync_branch_config) AS occupied"
    );
    return result.rows[0].occupied;
};

module.exports = {
    lockBootstrap,
    hasLocalBusiness,
    getSelfNodeId,
    getChangesSince,
    applyEntry,
    getStatus,
    stripSyncSecrets,
    findUserCredential,
    getOrgSyncEnabled,
    setOrgSyncEnabled,
    createEnrollmentToken,
    findEnrollmentTokenByHash,
    markEnrollmentTokenUsed,
    claimEnrollmentToken,
    createBranchNode,
    findNodeForRefresh,
    getNodeById,
    listBranchNodes,
    revokeNode,
    touchNode,
    getMaxOutboxSeq,
    recordRejection,
    listRejections,
    recordNodePull,
    minBranchPullSeq,
    pruneOutboxBelow,
    getHubWatermarks,
    setHubWatermarks,
    SYNCABLE_TABLES,
    APPLY_ORDER,
    BRANCH_PUSH_TABLES,
    SYNC_SCHEMA_VERSION,
};
