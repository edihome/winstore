/**
 * ============================================================
 * File: sync.controller.js
 * Module: Core Sync
 *
 * Description:
 * HTTP surface for the offline-sync engine. Protocol handlers (status,
 * changes, apply, run, snapshot) are org-scoped by the request's DB context
 * (RLS) and open to a user OR a branch node. Enrollment splits into a PUBLIC
 * redeem (the code is the credential) and ADMIN-only code management.
 * ============================================================
 */

const asyncHandler = require("../../utils/asyncHandler");
const AppError = require("../../utils/AppError");
const env = require("../../config/env");
const { success } = require("../../utils/response");
const { isAdminUser } = require("../../utils/isAdminUser");
const syncService = require("./sync.service");
const syncScheduler = require("./sync.scheduler");
const syncConfig = require("./sync.config");
const { SYNC_SCHEMA_VERSION } = require("./sync.repository");
const { encodeSetupCode, hubUrlFromRequest } = require("./setup-code");

const requireAdmin = (req) => {
    if (!isAdminUser(req.user)) {
        throw new AppError("Only an administrator can manage offline branches.", 403);
    }
};

const getStatus = asyncHandler(async (req, res) => {
    const status = await syncService.status(req.user.organizationId);
    // Fold in the background worker's last outcome (last-synced, error) so the
    // dashboard can show "Synced 5m ago" without a separate call.
    return success(res, "Sync status fetched.", { ...status, ...syncScheduler.getStatus() }, 200);
});

// A peer PULLs this org's changes after their watermark. A branch node's pull
// also advances its confirmed low-water mark and GCs the outbox.
const getChanges = asyncHandler(async (req, res) => {
    const pullerNodeId = req.isNode ? req.user.nodeId : null;
    const changes = await syncService.pull(req.user.organizationId, req.query.since, req.query.limit, pullerNodeId);
    return success(res, "Changes fetched.", changes, 200);
});

// A peer PUSHes a batch for this org; we apply it idempotently. A push from a
// branch NODE is held to central-wins: reference/identity changes are ignored.
const applyChanges = asyncHandler(async (req, res) => {
    // Compatibility guard: if a branch declares its protocol version and it
    // doesn't match ours, refuse the batch rather than misapply it. (Tolerant
    // of absence — the branch's own run() handshake is the primary check.)
    const declared = req.headers["x-sync-schema-version"];
    if (req.isNode && declared !== undefined && Number(declared) !== SYNC_SCHEMA_VERSION) {
        throw new AppError(`Schema mismatch: hub is on protocol v${SYNC_SCHEMA_VERSION}, branch sent v${declared}. Update the branch.`, 409);
    }
    const result = await syncService.apply(req.body.changes, {
        fromBranchNode: Boolean(req.isNode),
        fromNodeId: req.isNode ? req.user.nodeId : null,
        nodeBranchId: req.isNode && req.syncNodeRow ? req.syncNodeRow.branch_id : null,
        organizationId: req.user.organizationId,
        isolateErrors: true,
    });
    return success(res, "Changes applied.", result, 200);
});

// Manual reconcile (the "Sync now" button): push, then pull + apply.
const run = asyncHandler(async (req, res) => {
    const result = await syncService.run(req.user.organizationId);
    return success(res, "Sync complete.", result, 200);
});

// A freshly-enrolled branch's full download of reference + identity, PAGINATED
// via a cursor (?t=&o=) so a big catalog streams in pages.
const snapshot = asyncHandler(async (req, res) => {
    const cursor = req.query.t !== undefined ? { t: Number(req.query.t), o: Number(req.query.o) || 0 } : null;
    const result = await syncService.snapshot(req.user.organizationId, cursor, req.query.limit, { inventory: req.query.inventory === "1", branchId: req.isNode ? req.syncNodeRow?.branch_id : null });
    return success(res, "Snapshot fetched.", result, 200);
});

// PUBLIC: a branch redeems a one-time code → node id + durable node token.
const enroll = asyncHandler(async (req, res) => {
    const result = await syncService.enroll(req.body.code, req.body.name);
    return success(res, "Branch enrolled.", result, 201);
});

// PUBLIC (pre-auth): tells the login screen whether THIS install is an
// unlinked branch that should show the first-run "link to head office" flow.
const linkStatus = asyncHandler(async (req, res) => {
    return success(
        res,
        "Link status.",
        {
            branchInstall: env.SYNC_ENABLED === "true" && env.SYNC_NODE_KIND === "branch",
            linked: syncConfig.isLinked(),
        },
        200
    );
});

// PUBLIC: exchange a branch's refresh secret for a short-lived access token.
const issueToken = asyncHandler(async (req, res) => {
    const result = await syncService.issueAccessToken(req.body.nodeId, req.body.refreshSecret);
    return success(res, "Access token issued.", result, 200);
});

// NODE-only: verify a user's password on the hub and return that user's hash for
// the branch to cache — so staff can then sign in offline. Released only to a
// caller who already proved the password (no bulk hash enumeration).
const verifyCredential = asyncHandler(async (req, res) => {
    if (!req.isNode) {
        throw new AppError("Only a branch may fetch a cached credential.", 403);
    }
    const result = await syncService.verifyCredential(req.body.email, req.body.password, req.syncNodeRow?.branch_id);
    return success(res, "Credential verified.", result, 200);
});

// PUBLIC (branch-side, first-run only): link THIS install to a hub — enroll,
// snapshot, and persist in one call. Guarded to an unlinked install by the
// service; the code is the credential.
const link = asyncHandler(async (req, res) => {
    const result = await syncService.link({ setupCode: req.body.setupCode, hubUrl: req.body.hubUrl, code: req.body.code, name: req.body.name });
    return success(res, "Branch linked to hub.", result, 201);
});

// ADMIN: mint a one-time enrollment code (and opt the org into offline).
const createEnrollCode = asyncHandler(async (req, res) => {
    requireAdmin(req);
    const publicUrl = hubUrlFromRequest(req);
    const result = await syncService.createEnrollCode(req.user.organizationId, {
        name: req.body.name,
        branchId: req.body.branchId,
        createdBy: req.user.id,
    });
    if (req.body.branchId) result.setupCode = encodeSetupCode(publicUrl, result.code);
    return success(res, "Enrollment code created.", result, 201);
});

// ADMIN: list this org's enrolled branch nodes.
const listBranches = asyncHandler(async (req, res) => {
    requireAdmin(req);
    const branches = await syncService.listBranches(req.user.organizationId);
    return success(res, "Branches fetched.", branches, 200);
});

// ADMIN: recently dropped changes (central-wins) — the sync "rejection console".
const listRejections = asyncHandler(async (req, res) => {
    requireAdmin(req);
    const rejections = await syncService.listRejections(req.user.organizationId);
    return success(res, "Rejections fetched.", rejections, 200);
});

// ADMIN: revoke a branch (its node token stops working immediately).
const revokeBranch = asyncHandler(async (req, res) => {
    requireAdmin(req);
    const result = await syncService.revokeBranch(req.params.nodeId);
    return success(res, "Branch revoked.", result, 200);
});

module.exports = { getStatus, getChanges, applyChanges, run, snapshot, enroll, issueToken, verifyCredential, link, linkStatus, createEnrollCode, listBranches, listRejections, revokeBranch };
