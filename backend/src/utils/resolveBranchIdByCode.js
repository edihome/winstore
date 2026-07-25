/**
 * ============================================================
 * File: resolveBranchIdByCode.js
 * Module: Shared Utilities
 *
 * Description:
 * Resolves a branch code (as typed in a bulk-import spreadsheet) to its
 * ID, fetching the organization's branch list once per import request
 * (cached on req, not once per row) and rejecting a branch the caller
 * isn't actually allowed to act on — bulk import rows carry a branch
 * per ROW, so this is the per-row equivalent of what
 * middlewares/branchScope.js enforces for a single request-level
 * branchId (see that file's isBulkImportPath skip).
 * ============================================================
 */

const AppError = require("./AppError");
const { isPrivilegedRole } = require("./isPrivilegedRole");
const branchesService = require("../core/branches/branches.service");

const resolveBranchIdByCode = async (branchCode, req) => {
    const code = String(branchCode || "").trim();
    if (!code) {
        throw new AppError("Branch Code is required.", 400);
    }

    if (!req._branchIdsByCode) {
        const branches = await branchesService.listBranches({ organizationId: req.user.organizationId });
        req._branchIdsByCode = new Map(branches.map((branch) => [branch.code.toLowerCase(), branch.id]));
    }

    const branchId = req._branchIdsByCode.get(code.toLowerCase());
    if (!branchId) {
        throw new AppError(`No branch found with code "${code}".`, 400);
    }

    if (!isPrivilegedRole(req.user.role) && !(req.user.accessibleBranchIds || []).includes(branchId)) {
        throw new AppError(`You do not have access to branch "${code}".`, 400);
    }

    return branchId;
};

module.exports = { resolveBranchIdByCode };
