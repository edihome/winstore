/**
 * ============================================================
 * File: assertBranchAccessible.js
 * Module: Utils
 *
 * Description:
 * Shared guard for id-based fetch/update services (get-by-id,
 * status updates) that aren't behind enforceBranchScope's
 * query/body filtering. 404s rather than 403s when the record's
 * branch isn't in the caller's accessible set, so a limited user
 * can't tell "wrong branch" apart from "doesn't exist". Pass null
 * for accessibleBranchIds to skip the check (super_admin callers).
 * ============================================================
 */

const AppError = require("./AppError");

const assertBranchAccessible = (branchId, accessibleBranchIds, notFoundMessage) => {
    if (!accessibleBranchIds) {
        return;
    }

    if (!accessibleBranchIds.includes(branchId)) {
        throw new AppError(notFoundMessage, 404);
    }
};

module.exports = { assertBranchAccessible };
