/**
 * ============================================================
 * File: sync.controller.js
 * Module: Core Sync
 *
 * Description:
 * HTTP surface for the offline-sync engine. All handlers are scoped to the
 * caller's organization by the request's DB context (RLS), so they are safe
 * to expose to any authenticated staff member — sync is an operational
 * action, not an administrative one.
 * ============================================================
 */

const asyncHandler = require("../../utils/asyncHandler");
const { success } = require("../../utils/response");
const syncService = require("./sync.service");

const getStatus = asyncHandler(async (req, res) => {
    const status = await syncService.status(req.user.organizationId);
    return success(res, "Sync status fetched.", status, 200);
});

// A peer PULLs this org's changes after their watermark.
const getChanges = asyncHandler(async (req, res) => {
    const changes = await syncService.pull(req.user.organizationId, req.query.since, req.query.limit);
    return success(res, "Changes fetched.", changes, 200);
});

// A peer PUSHes a batch for this org; we apply it idempotently.
const applyChanges = asyncHandler(async (req, res) => {
    const result = await syncService.apply(req.body.changes);
    return success(res, "Changes applied.", result, 200);
});

// Manual reconcile (the "Sync now" button): push, then pull + apply.
const run = asyncHandler(async (req, res) => {
    const result = await syncService.run(req.user.organizationId);
    return success(res, "Sync complete.", result, 200);
});

module.exports = { getStatus, getChanges, applyChanges, run };
