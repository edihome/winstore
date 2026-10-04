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

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const dns = require("dns").promises;
const net = require("net");
const http = require("http");
const https = require("https");
const AppError = require("../../utils/AppError");
const env = require("../../config/env");
const db = require("../../config/db");
const syncRepository = require("./sync.repository");
const syncConfig = require("./sync.config");
const { invalidateOrgSync } = require("../../middlewares/orgContext");
const { decodeSetupCode } = require("./setup-code");
const { isPrivilegedRole } = require("../../utils/isPrivilegedRole");

// Resolved at CALL time, not module load. Precedence: an explicit env override
// (deployment/testing) → the branch's PERSISTED link (survives restarts) → the
// parsed env. So an enrolled branch keeps working after a reboot with no env.
const hubUrl = () => String(process.env.SYNC_HUB_URL || syncConfig.hubUrl() || env.SYNC_HUB_URL || "").replace(/\/+$/, "");

// Short-lived access tokens (24h) minted from the branch's long-lived refresh
// secret, so a stolen access token expires fast. Cached in memory and refreshed
// automatically. An explicit SYNC_HUB_TOKEN env still wins (tests / manual).
const ACCESS_TOKEN_TTL = "24h";
let accessCache = { token: null, exp: 0 };
const getAccessToken = async () => {
    const override = process.env.SYNC_HUB_TOKEN || env.SYNC_HUB_TOKEN;
    if (override) return override;
    if (accessCache.token && Date.now() < accessCache.exp - 60000) {
        return accessCache.token;
    }
    const cfg = syncConfig.get();
    if (!cfg || !cfg.refreshSecret || !cfg.nodeId) return "";
    const res = await requestJson(`${hubUrl()}/api/v1/sync/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId: cfg.nodeId, refreshSecret: cfg.refreshSecret }),
    });
    if (!res.ok) {
        throw new AppError(res.body.message || "Could not refresh sync access — re-enroll may be required.", 502);
    }
    const token = res.body.data.accessToken;
    const decoded = jwt.decode(token) || {};
    accessCache = { token, exp: (decoded.exp || 0) * 1000 };
    return token;
};

/**
 * This org's changes after `since`, for a peer to apply. When the puller is a
 * branch NODE, record how far it has confirmed pulling and garbage-collect the
 * outbox below the lowest confirmed point across all active branches.
 */
const pull = async (organizationId, since, limit, pullerNodeId = null) => {
    const changes = await syncRepository.getChangesSince(organizationId, Number(since) || 0, limit);
    if (pullerNodeId) {
        await syncRepository.recordNodePull(pullerNodeId, Number(since) || 0);
        const floor = await syncRepository.minBranchPullSeq(organizationId);
        if (floor != null) {
            await syncRepository.pruneOutboxBelow(organizationId, floor);
        }
    }
    return changes;
};

/**
 * Apply a peer's batch idempotently, in dependency-safe order, with capture
 * suppressed (so we don't re-log — and re-broadcast — what we just received).
 * RLS rejects any row that isn't this org's, so a bad batch can't cross tenants.
 *
 * @returns {Promise<{applied:number}>}
 */
const apply = async (changes = [], { fromBranchNode = false, fromNodeId = null, nodeBranchId = null, organizationId = null, isolateErrors = false, client: externalClient = null } = {}) => {
    if (!Array.isArray(changes) || changes.length === 0) {
        return { applied: 0 };
    }
    // Enforce what a branch push may contain:
    //  - central-wins: reference/identity tables are hub-authoritative (dropped);
    //  - branch scope: if the node is bound to a branch, it may only sync rows
    //    for THAT branch — it can't forge records attributed to a sibling branch.
    // Each drop is logged so nothing disappears silently.
    const accepted = [];
    const dropped = []; // { entry, reason }
    if (fromBranchNode) {
        for (const c of changes) {
            if (!syncRepository.BRANCH_PUSH_TABLES.has(c.table_name)) {
                dropped.push({ entry: c, reason: "Reference data is managed centrally — a branch cannot change it." });
            } else if (nodeBranchId && c.row_data && c.row_data.branch_id && c.row_data.branch_id !== nodeBranchId) {
                dropped.push({ entry: c, reason: "A branch may only sync records for its own branch." });
            } else {
                accepted.push(c);
            }
        }
    } else {
        accepted.push(...changes);
    }
    if (accepted.length === 0 && dropped.length === 0) {
        return { applied: 0 };
    }
    const order = syncRepository.APPLY_ORDER;
    const ordered = [...accepted].sort((a, b) => {
        const ai = order.indexOf(a.table_name);
        const bi = order.indexOf(b.table_name);
        if (ai !== bi) return ai - bi;
        return (Number(a.seq) || 0) - (Number(b.seq) || 0);
    });

    const client = externalClient || await db.connect();
    try {
        if (!externalClient) await client.query("BEGIN");
        // Suppress echo: applying a peer's change must not capture it again.
        await client.query("SELECT set_config('app.sync_capture', 'off', true)");
        const rowIdOf = (entry) => entry.row_id || (entry.row_data && entry.row_data.id) || null;
        let applied = 0;
        let failed = 0;
        for (const entry of ordered) {
            if (!isolateErrors) {
                await syncRepository.applyEntry(entry, client);
                applied += 1;
                continue;
            }
            // Isolate each entry in a savepoint so ONE poison row (bad data, a
            // missing dependency) is quarantined and logged instead of failing
            // the whole batch and stalling sync forever. Watermarks advance past
            // it, so it won't be retried — the admin sees it in the console.
            await client.query("SAVEPOINT sync_entry");
            try {
                await syncRepository.applyEntry(entry, client);
                await client.query("RELEASE SAVEPOINT sync_entry");
                applied += 1;
            } catch (err) {
                await client.query("ROLLBACK TO SAVEPOINT sync_entry");
                if (organizationId) {
                    await syncRepository.recordRejection(
                        { organizationId, nodeId: fromNodeId, tableName: entry.table_name, rowId: rowIdOf(entry), op: entry.op, reason: `Could not apply: ${err.message}` },
                        client
                    );
                }
                failed += 1;
            }
        }
        // Log what was rejected (central-wins or branch-scope), so an admin can
        // see a branch trying to write data it shouldn't — a real signal.
        for (const { entry, reason } of dropped) {
            await syncRepository.recordRejection(
                { organizationId, nodeId: fromNodeId, tableName: entry.table_name, rowId: rowIdOf(entry), op: entry.op, reason },
                client
            );
        }
        if (!externalClient) await client.query("COMMIT");
        return { applied, dropped: dropped.length, failed };
    } catch (error) {
        if (!externalClient) await client.query("ROLLBACK");
        throw error;
    } finally {
        if (!externalClient) client.release();
    }
};

const status = async (organizationId) => {
    const s = await syncRepository.getStatus(organizationId);
    const orgEnabled = await syncRepository.getOrgSyncEnabled(organizationId);
    return {
        // Master switch for the deployment.
        enabled: env.SYNC_ENABLED === "true",
        // This org opted into offline — the frontend hides the sync UI unless true.
        orgEnabled,
        hubConfigured: Boolean(hubUrl()),
        pending: s.pending,
        latestSeq: s.maxSeq,
        // Protocol version, for the branch↔hub compatibility handshake.
        schemaVersion: syncRepository.SYNC_SCHEMA_VERSION,
    };
};

const hubFetch = async (path, options = {}) => {
    const token = await getAccessToken();
    const res = await fetch(`${hubUrl()}${path}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
    if (!hubUrl()) {
        // A hub node, or a branch not yet pointed at one — nothing to reconcile.
        return { pushed: 0, pulled: 0, at: new Date().toISOString(), message: "No hub configured." };
    }

    // 0) Compatibility handshake: refuse to sync a branch and hub that disagree
    // on the protocol version, rather than exchange rows one side can't map.
    const hubState = await hubFetch("/api/v1/sync/status");
    const hubVersion = Number(hubState.data?.schemaVersion);
    if (hubVersion !== syncRepository.SYNC_SCHEMA_VERSION) {
        throw new AppError(
            `Sync halted: this branch speaks protocol v${syncRepository.SYNC_SCHEMA_VERSION} but the hub speaks v${hubVersion || "?"}. Update the branch to match the hub.`,
            409
        );
    }

    const selfNode = await syncRepository.getSelfNodeId(organizationId);
    const marks = await syncRepository.getHubWatermarks(organizationId, selfNode);

    // 1) Push our changes above the push watermark — but only the tables a
    // branch is allowed to author (transactions + customers). Reference/identity
    // edits stay local; the hub owns those. The watermark still advances past
    // the skipped rows so they aren't re-scanned every run.
    const changesSince = await syncRepository.getChangesSince(organizationId, marks.lastPushedSeq, 1000);
    const outgoing = changesSince.filter((c) => syncRepository.BRANCH_PUSH_TABLES.has(c.table_name));
    let lastPushedSeq = marks.lastPushedSeq;
    if (outgoing.length > 0) {
        await hubFetch("/api/v1/sync/apply", {
            method: "POST",
            headers: { "X-Sync-Schema-Version": String(syncRepository.SYNC_SCHEMA_VERSION) },
            body: JSON.stringify({ changes: outgoing }),
        });
    }
    if (changesSince.length > 0) {
        lastPushedSeq = Math.max(...changesSince.map((c) => Number(c.seq)));
    }

    // 2) Pull the hub's changes above the pull watermark and apply them.
    const pulled = await hubFetch(`/api/v1/sync/changes?since=${marks.lastPulledSeq}&limit=1000`);
    const incoming = pulled.data || [];
    let lastPulledSeq = marks.lastPulledSeq;
    if (incoming.length > 0) {
        // Resilient: a single bad row from the hub is quarantined+logged, not a
        // reason to stall this branch's whole reconcile.
        await apply(incoming, { organizationId, isolateErrors: true });
        lastPulledSeq = Math.max(...incoming.map((c) => Number(c.seq)));
    }

    await syncRepository.setHubWatermarks(marks.id, { lastPushedSeq, lastPulledSeq });
    // GC our own outbox: everything at/below the push watermark is on the hub now.
    if (lastPushedSeq > marks.lastPushedSeq) {
        await syncRepository.pruneOutboxBelow(organizationId, lastPushedSeq);
    }
    return { pushed: outgoing.length, pulled: incoming.length, at: new Date().toISOString() };
};

// ---- enrollment ----------------------------------------------------------

const hashCode = (code) => crypto.createHash("sha256").update(code).digest("hex");
// Access tokens are SHORT-lived and minted from the refresh secret; the node row
// (is_active + token_version) is still the revocation authority.
const signNodeToken = ({ nodeId, organizationId, tokenVersion = 0 }) =>
    jwt.sign({ typ: "sync-node", sub: nodeId, organizationId, tokenVersion }, env.JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });

/**
 * Exchange a branch's refresh secret for a fresh short-lived access token.
 * Public (the secret is the credential); runs privileged to find the node by id.
 */
const issueAccessToken = async (nodeId, refreshSecret) => {
    if (!nodeId || !refreshSecret) {
        throw new AppError("A node id and refresh secret are required.", 400);
    }
    return db.runPrivileged(async () => {
        const node = await syncRepository.findNodeForRefresh(nodeId);
        const presented = crypto.createHash("sha256").update(String(refreshSecret)).digest("hex");
        const ok =
            node &&
            node.is_active === true &&
            node.refresh_secret_hash &&
            crypto.timingSafeEqual(Buffer.from(node.refresh_secret_hash), Buffer.from(presented));
        if (!ok) {
            throw new AppError("Invalid or revoked sync credentials.", 401);
        }
        const accessToken = signNodeToken({ nodeId: node.id, organizationId: node.organization_id, tokenVersion: node.token_version });
        return { accessToken, expiresIn: ACCESS_TOKEN_TTL };
    });
};

/**
 * Hub, admin: mint a one-time enrollment code for a branch install and opt the
 * org into offline (which turns on capture for it). The code is returned in the
 * clear ONCE; only its hash is stored.
 */
const createEnrollCode = async (organizationId, { name, branchId, createdBy, expiresInMs = 15 * 60 * 1000, replaceUnused = false, client: externalClient = null } = {}) => {
    const code = crypto.randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + expiresInMs);
    const client = externalClient || await db.connect();
    try {
        if (!externalClient) await client.query("BEGIN");
        if (branchId) {
            const result = await client.query("SELECT id, name FROM branches WHERE id = $1 AND organization_id = $2 FOR NO KEY UPDATE", [branchId, organizationId]);
            if (!result.rows[0]) throw new AppError("Branch not found.", 404);
            name = result.rows[0].name;
            if (replaceUnused) await client.query("UPDATE sync_enrollment_tokens SET expires_at = NOW() WHERE organization_id = $1 AND branch_id = $2 AND used_at IS NULL", [organizationId, branchId]);
        }
        await syncRepository.createEnrollmentToken({ organizationId, branchId, tokenHash: hashCode(code), name, expiresAt, createdBy }, client);
        await syncRepository.setOrgSyncEnabled(organizationId, true, client);
        if (!externalClient) await client.query("COMMIT");
    } catch (error) {
        if (!externalClient) await client.query("ROLLBACK");
        throw error;
    } finally { if (!externalClient) client.release(); }
    invalidateOrgSync(organizationId);
    return { code, expiresAt };
};

/**
 * Branch: redeem a code → register this install as a branch node of the org and
 * issue a durable node token. Runs with RLS bypassed because the caller has no
 * org context yet — the code IS the credential, and it resolves the org.
 */
const enroll = async (code, name) => {
    if (!code || typeof code !== "string") {
        throw new AppError("An enrollment code is required.", 400);
    }
    return db.runPrivileged(async () => {
        const client = db.storage.getStore().client;
        await client.query("BEGIN");
        try {
            // Claim the code ATOMICALLY (the UPDATE is the lock) so a race can't
            // redeem a one-time code twice. A null claim → look up why, for a clear
            // message.
            const token = await syncRepository.claimEnrollmentToken(hashCode(code), client);
            if (!token) {
                const existing = await syncRepository.findEnrollmentTokenByHash(hashCode(code));
                if (!existing) throw new AppError("Invalid enrollment code.", 400);
                if (existing.used_at) throw new AppError("This enrollment code has already been used.", 400);
                throw new AppError("This enrollment code has expired.", 400);
            }
            const nodeId = crypto.randomUUID();
            const refreshSecret = crypto.randomBytes(32).toString("base64url");
            const refreshSecretHash = crypto.createHash("sha256").update(refreshSecret).digest("hex");
            await syncRepository.createBranchNode({ id: nodeId, organizationId: token.organization_id, branchId: token.branch_id, name: token.branch_id ? token.name : name || token.name, refreshSecretHash }, client);
            await syncRepository.markEnrollmentTokenUsed(token.id, nodeId, client);
            await syncRepository.setOrgSyncEnabled(token.organization_id, true, client);
            // Hand back the durable refresh secret + an initial short-lived access token.
            const accessToken = signNodeToken({ nodeId, organizationId: token.organization_id, tokenVersion: 0 });
            await client.query("COMMIT");
            return { organizationId: token.organization_id, branchId: token.branch_id, nodeId, refreshSecret, accessToken };
        } catch (error) { await client.query("ROLLBACK"); throw error; }
    });
};

const listBranches = async (organizationId) => {
    const [nodes, maxSeq] = await Promise.all([
        syncRepository.listBranchNodes(organizationId),
        syncRepository.getMaxOutboxSeq(organizationId),
    ]);
    // "behind" = how many of the hub's changes this branch hasn't confirmed yet.
    return nodes.map((n) => ({ ...n, behind: Math.max(0, maxSeq - Number(n.last_pulled_seq || 0)) }));
};

const listRejections = (organizationId) => syncRepository.listRejections(organizationId);

/**
 * Verify a user's password on the HUB (node-authed, runs under the node's org
 * context/RLS) and, only on success, return that user's password hash for the
 * branch to CACHE locally — so the branch can later verify offline. The hash is
 * released only to someone who already proved the password, so a branch can't
 * enumerate hashes. `organizationId` is the node's org (the caller).
 */
const verifyCredential = async (email, password, branchId = null) => {
    if (!email || !password) {
        throw new AppError("Email and password are required.", 400);
    }
    const user = await syncRepository.findUserCredential(email);
    if (!user || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
        throw new AppError("Invalid email or password.", 401);
    }
    if (!user.is_active) throw new AppError("This account has been deactivated.", 403);
    if (branchId && !isPrivilegedRole(user.role_name)) {
        const grants = await db.query("SELECT branch_id FROM user_branches WHERE user_id = $1", [user.id]);
        const ids = grants.rows.length ? grants.rows.map((row) => row.branch_id) : [user.branch_id];
        if (!ids.includes(branchId)) throw new AppError("You do not have access to this branch.", 403);
    }
    return { userId: user.id, passwordHash: user.password_hash };
};

/**
 * BRANCH side: on a user's first login here, verify their password against the
 * hub and cache the returned hash locally so they can sign in offline next time.
 * Returns the hash on success, null if the hub rejected the password, or throws
 * if the hub is unreachable (→ "connect and try again"). No-op off a branch.
 */
const fetchCredentialFromHub = async (email, password) => {
    if (!syncConfig.isLinked() || !hubUrl()) {
        return null;
    }
    const token = await getAccessToken();
    let res;
    try {
        res = await requestJson(`${hubUrl()}/api/v1/sync/credential`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ email, password }),
        });
    } catch (err) {
        throw new AppError(`Could not reach the hub: ${err.message}`, 503);
    }
    if (res.status === 401) return null; // hub rejected the password
    if (!res.ok) throw new AppError(res.body.message || "The hub could not verify this sign-in.", 502);
    const { userId, passwordHash } = res.body.data;
    await db.runPrivileged(() => db.query("UPDATE users SET password_hash = $2 WHERE id = $1", [userId, passwordHash]));
    return passwordHash;
};

const revokeBranch = async (nodeId) => {
    const ok = await syncRepository.revokeNode(nodeId);
    if (!ok) {
        throw new AppError("Branch not found.", 404);
    }
    return { revoked: true };
};

// ---- initial snapshot ----------------------------------------------------

// The reference + identity a freshly-enrolled branch needs to trade offline
// from day one, in FK-safe order. Applied via the same idempotent upsert as any
// change batch. Join tables rely on RLS to scope via their parent records.
const SNAPSHOT_TABLES = [
    { table: "organizations", filter: "self" }, // the tenant root — FK target for the rest
    { table: "branches", filter: "org" },
    { table: "roles", filter: "org" },
    { table: "permissions", filter: "org" },
    { table: "role_permissions", filter: "rls" }, // org-less join; RLS scopes via parent role
    { table: "users", filter: "org" },
    { table: "user_branches", filter: "rls" }, // org-less join; RLS scopes via parent user
    { table: "settings", filter: "org" },
    { table: "categories", filter: "org" },
    { table: "taxes", filter: "org" },
    { table: "discounts", filter: "org" },
    { table: "suppliers", filter: "org" },
    { table: "products", filter: "org" },
    { table: "services", filter: "org" },
    { table: "customers", filter: "org" },
];

const SNAPSHOT_PAGE = 2000;

const pageSnapshotTable = async (table, filter, organizationId, limit, offset, branchId = null) => {
    const base =
        filter === "self"
            ? `SELECT * FROM ${table} WHERE id = $1`
            : filter === "org"
              ? `SELECT * FROM ${table} WHERE organization_id = $1`
              : `SELECT * FROM ${table}`; // RLS scopes it
    const params = filter === "rls" ? [] : [organizationId];
    const scopedBase = branchId ? `${base} AND branch_id = $2` : base;
    if (branchId) params.push(branchId);
    const result = await db.query(`${scopedBase} ORDER BY id LIMIT ${Number(limit)} OFFSET ${Number(offset)}`, params);
    return result.rows;
};

/**
 * A one-time full download for a branch that has just enrolled — PAGINATED so a
 * large catalog doesn't come back in one payload. A cursor walks the FK-ordered
 * SNAPSHOT_TABLES: `{ t: table index, o: offset within it }`; `next` is the
 * cursor to fetch the following page, or null when drained. Runs under the
 * caller's org context (RLS scopes every row). Password hashes are NOT shipped —
 * a user's hash is cached on the branch only after their first ONLINE login (see
 * verifyCredential + the auth first-online-login flow).
 */
const snapshot = async (organizationId, cursor = null, limit = SNAPSHOT_PAGE, { inventory = false, branchId = null } = {}) => {
    // Record the boundary before reading rows. Setup remembers the FIRST page's
    // value so later sync includes edits made during/after the download, while
    // older stock movements cannot overwrite checkout performed after setup.
    const watermark = await syncRepository.getMaxOutboxSeq(organizationId);
    const pageLimit = Math.min(Number(limit) || SNAPSHOT_PAGE, 5000);
    let t = cursor && Number.isInteger(cursor.t) ? cursor.t : 0;
    let o = cursor && Number.isInteger(cursor.o) ? cursor.o : 0;
    const changes = [];
    const tables = inventory && branchId ? [...SNAPSHOT_TABLES, { table: "product_stock", filter: "org", branchId }, { table: "stock_batches", filter: "org", branchId }] : SNAPSHOT_TABLES;

    while (t < tables.length && changes.length < pageLimit) {
        const { table, filter, branchId: tableBranchId } = tables[t];
        const remaining = pageLimit - changes.length;
        const rows = await pageSnapshotTable(table, filter, organizationId, remaining, o, tableBranchId);
        for (const row of rows) {
            // Never ship password hashes — even in the snapshot (see /sync/credential).
            changes.push({ table_name: table, op: "I", row_data: syncRepository.stripSyncSecrets(table, row) });
        }
        if (rows.length < remaining) {
            t += 1; // this table is drained — move to the next
            o = 0;
        } else {
            o += rows.length; // more rows may remain in this table
        }
    }

    const next = t < tables.length ? { t, o } : null;
    return { changes, next, watermark, at: new Date().toISOString() };
};

/**
 * Branch first-run: apply a snapshot into the LOCAL (empty) database. Runs with
 * RLS bypassed because the branch has no org context yet — the snapshot rows
 * carry their own organization_id, and this is the org's own device seeding
 * itself, exactly like registration. Capture stays off (apply suppresses it).
 */
const applySnapshot = (changes) => db.runPrivileged(() => apply(changes));

// Loopback + link-local (incl. the cloud metadata endpoint 169.254.169.254) —
// the SSRF targets we refuse to let a link request point us at. Private LAN
// ranges (192.168/10/172.16) are intentionally allowed: a hub can be a shop's
// own LAN server.
const isBlockedAddress = (ip) => {
    if (net.isIPv4(ip)) {
        return ip.startsWith("127.") || ip.startsWith("169.254.") || ip === "0.0.0.0";
    }
    const lower = ip.toLowerCase().replace(/^::ffff:/, "");
    if (net.isIPv4(lower)) return isBlockedAddress(lower);
    return lower === "::1" || lower === "::" || lower.startsWith("fe80:");
};

/**
 * Validate a hub URL a branch is asked to link to (SSRF guard): only http(s),
 * and (unless SYNC_HUB_ALLOWED_HOSTS is set) the host must not resolve to
 * loopback or link-local. Returns the VETTED ip to pin the connection to, so a
 * DNS rebind between this check and the request can't redirect us (see
 * requestJson). For an allowlisted host, returns null (host is trusted by name).
 *
 * @returns {Promise<{pinnedIp: string|null}>}
 */
const assertHubUrlAllowed = async (hubUrl) => {
    let url;
    try {
        url = new URL(hubUrl);
    } catch {
        throw new AppError("A valid hub URL is required.", 400);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new AppError("The hub URL must be http or https.", 400);
    }
    const host = url.hostname.toLowerCase();
    const allowlist = (process.env.SYNC_HUB_ALLOWED_HOSTS || "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
    if (allowlist.length) {
        if (!allowlist.includes(host)) {
            throw new AppError("This hub address is not permitted.", 400);
        }
        return { pinnedIp: null };
    }
    let addresses;
    try {
        addresses = await dns.lookup(host, { all: true });
    } catch {
        throw new AppError(`Could not resolve the hub address "${host}".`, 400);
    }
    if (addresses.length === 0 || addresses.some((a) => isBlockedAddress(a.address))) {
        throw new AppError("The hub address is not permitted (loopback/link-local).", 400);
    }
    return { pinnedIp: addresses[0].address };
};

/**
 * JSON request to a hub, pinned to a pre-vetted IP (via a fixed DNS lookup) so a
 * rebind can't move the connection off the address we validated. SNI/Host stay
 * the original hostname, so TLS still validates against the cert.
 */
const requestJson = (fullUrl, { method = "GET", headers = {}, body, pinnedIp } = {}) =>
    new Promise((resolve, reject) => {
        const u = new URL(fullUrl);
        const lib = u.protocol === "https:" ? https : http;
        const options = {
            method,
            hostname: u.hostname,
            port: u.port || (u.protocol === "https:" ? 443 : 80),
            path: `${u.pathname}${u.search}`,
            headers: { ...headers },
        };
        if (pinnedIp) {
            options.lookup = (_host, _opts, cb) => cb(null, pinnedIp, net.isIPv6(pinnedIp) ? 6 : 4);
        }
        if (body) {
            options.headers["Content-Length"] = Buffer.byteLength(body);
        }
        const req = lib.request(options, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
                let parsed = {};
                try {
                    parsed = JSON.parse(data);
                } catch {
                    parsed = {};
                }
                resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, body: parsed });
            });
        });
        req.on("error", reject);
        req.setTimeout(30000, () => req.destroy(new Error("Hub request timed out.")));
        if (body) req.write(body);
        req.end();
    });

/**
 * Branch first-run: LINK this install to a hub in one step — redeem the code on
 * the hub, download the snapshot, seed the local DB, and persist the link so it
 * survives restarts. Only works while UNLINKED (the code is the credential);
 * once linked it refuses, so it can't be silently re-pointed.
 *
 * @param {{hubUrl:string, code:string, name?:string}} input
 * @returns {Promise<{organizationId:string, nodeId:string}>}
 */
const link = async ({ hubUrl: hub, code, name, setupCode } = {}) => {
    if (syncConfig.isLinked()) {
        throw new AppError("This install is already linked to a hub.", 409);
    }
    if (setupCode !== undefined) {
        const decoded = decodeSetupCode(setupCode);
        hub = decoded.hubUrl;
        code = decoded.code;
    }
    if (typeof hub !== "string" || !hub.trim() || typeof code !== "string" || !code.trim()) {
        throw new AppError("A hub URL and an enrollment code are required.", 400);
    }
    if (env.SYNC_ENABLED !== "true" || env.SYNC_NODE_KIND !== "branch") {
        throw new AppError("Only a branch install can link to a hub.", 403);
    }

    return db.runPrivileged(async () => {
        const client = db.storage.getStore().client;
        await client.query("BEGIN");
        let redeemed = false;
        try {
            // Serialize first-run requests before consuming a one-time hub code.
            await syncRepository.lockBootstrap(client);
            if (syncConfig.isLinked() || await syncRepository.hasLocalBusiness(client)) {
                throw new AppError("Linking requires an empty branch install. Existing business data must be preserved.", 409);
            }
            // SSRF guard before any outbound request; pin the vetted address.
            const { pinnedIp } = await assertHubUrlAllowed(hub.trim());
            const base = hub.trim().replace(/\/+$/, "");

            const call = async (path, { method = "GET", headers = {}, body } = {}) => {
                let res;
                try {
                    res = await requestJson(`${base}${path}`, { method, headers: { "Content-Type": "application/json", ...headers }, body, pinnedIp });
                } catch (err) {
                    throw new AppError(`Could not reach the hub at ${base}: ${err.message}`, 502);
                }
                if (!res.ok) {
                    throw new AppError(res.body.message || `Hub responded ${res.status}.`, res.status === 400 ? 400 : 502);
                }
                return res.body;
            };

            // Redeem the code, then apply every page in this one transaction.
            const enrolled = await call("/api/v1/sync/enroll", { method: "POST", body: JSON.stringify({ code, name }) });
            redeemed = true;
            const { organizationId, branchId = null, nodeId, refreshSecret, accessToken } = enrolled.data;
            if (setupCode !== undefined && !branchId) throw new AppError("The setup code must belong to a branch.", 502);
            let cursor = null;
            let snapshotWatermark = null;
            do {
                let q = cursor ? `?t=${cursor.t}&o=${cursor.o}` : "";
                if (setupCode !== undefined) q += `${q ? "&" : "?"}inventory=1`;
                const snap = await call(`/api/v1/sync/snapshot${q}`, { headers: { Authorization: `Bearer ${accessToken}` } });
                if (setupCode !== undefined && snapshotWatermark === null) {
                    snapshotWatermark = Number(snap.data.watermark);
                    if (!Number.isSafeInteger(snapshotWatermark) || snapshotWatermark < 0) throw new AppError("Invalid snapshot sync boundary.", 502);
                }
                const stock = snap.data.changes.filter((entry) => entry.table_name === "product_stock");
                await apply(snap.data.changes.filter((entry) => entry.table_name !== "product_stock"), { client });
                for (const entry of stock) {
                    if (!branchId || entry.row_data?.branch_id !== branchId || entry.row_data?.organization_id !== organizationId) throw new AppError("Invalid stock in the branch download.", 502);
                    await syncRepository.applyBootstrapStock(entry.row_data, client);
                }
                cursor = snap.data.next;
            } while (cursor);

            // Publish the durable link and its cache only after all pages succeed.
            if (branchId) {
                const branch = await client.query("SELECT id FROM branches WHERE id = $1 AND organization_id = $2", [branchId, organizationId]);
                if (!branch.rows[0]) throw new AppError("The assigned branch was missing from the download.", 502);
            }
            if (snapshotWatermark !== null) {
                const localNodeId = await syncRepository.getSelfNodeId(organizationId, client);
                const marks = await syncRepository.getHubWatermarks(organizationId, localNodeId, client);
                await syncRepository.setHubWatermarks(marks.id, { lastPushedSeq: 0, lastPulledSeq: snapshotWatermark }, client);
            }
            const config = await syncConfig.save({ organizationId, branchId, hubUrl: base, nodeId, refreshSecret }, client);
            await client.query("COMMIT");
            syncConfig.remember(config);
            return { organizationId, nodeId, ...(branchId ? { branchId } : {}) };
        } catch (error) {
            await client.query("ROLLBACK");
            if (redeemed) {
                throw new AppError("Branch setup could not finish. Local data was left unchanged. Ask head office for a new enrollment code and retry.", 502);
            }
            throw error;
        }
    });
};

module.exports = { pull, apply, status, run, createEnrollCode, enroll, issueAccessToken, verifyCredential, fetchCredentialFromHub, listBranches, listRejections, revokeBranch, snapshot, applySnapshot, link };
