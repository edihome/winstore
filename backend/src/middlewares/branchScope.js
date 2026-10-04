/**
 * ============================================================
 * File: branchScope.js
 * Module: Middlewares
 *
 * Description:
 * Enforces branch-level data isolation for protected routes,
 * the same way organizationScope.js enforces org-level isolation.
 * Without this, organization scoping alone let any authenticated
 * user read or write another branch's data just by supplying a
 * different branchId in the query string or request body — the
 * frontend always sends the active branch, but nothing stopped a
 * direct API call from sending someone else's.
 *
 * The organization's owner (role === "super_admin") is exempt,
 * matching the existing permission-bypass rule in middlewares/permission.js
 * — an owner is expected to see every branch in their own org.
 * ============================================================
 */

const branchesService = require("../core/branches/branches.service");
const { canAccessAllBranches } = require("../utils/isPrivilegedRole");

/**
 * Resolve (and cache on req.user for the life of the request) the branch
 * ids this user may act on: their explicit user_branches grants, or —
 * when none are set — just their primary branch.
 *
 * @param {object} req Express request with req.user already populated.
 * @returns {Promise<string[]>} Accessible branch ids.
 */
const resolveAccessibleBranchIds = async (req) => {
    if (req.user.accessibleBranchIds) {
        return req.user.accessibleBranchIds;
    }

    const primaryBranch = req.user.branchId ? { id: req.user.branchId } : null;
    const branches = await branchesService.getAccessibleBranchesForUser(req.user.id, primaryBranch, req.user.role);
    req.user.accessibleBranchIds = branches.map((branch) => branch.id);
    return req.user.accessibleBranchIds;
};

// Bulk-import routes carry a branch per spreadsheet ROW (a "Branch Code"
// column), not one branchId for the whole request — the generic
// single-branchId enforcement below doesn't apply to them at all. Each
// resource's own bulk-import row-mapper checks the resolved branch
// against resolveAccessibleBranchIds itself instead (see e.g.
// expenses.controller.js's resolveBranchId).
const isBulkImportPath = (path) => path === "/import" || path === "/import-template";

// A stock transfer carries TWO branchIds (fromBranchId + toBranchId), not one
// request-level branchId, so the single-branchId enforcement below doesn't
// apply. The stock-movements service checks both branches against the
// resolved accessible ids itself.
const isMultiBranchPath = (path) => path === "/transfer";

/**
 * Middleware factory for branch-scoped resources. Skips id-based routes
 * (e.g. PATCH /purchases/:id) and bulk-import routes entirely — neither
 * takes a single request-level branchId filter, and both are instead
 * guarded inside their own services/controllers by comparing against
 * req.user.accessibleBranchIds.
 *
 * @returns {Function} Express middleware.
 */
const enforceBranchScope = () => async (req, res, next) => {
    try {
        if (canAccessAllBranches(req.user.role)) {
            return next();
        }

        if ((req.params && req.params.id) || isBulkImportPath(req.path) || isMultiBranchPath(req.path)) {
            await resolveAccessibleBranchIds(req);
            return next();
        }

        const accessibleBranchIds = await resolveAccessibleBranchIds(req);
        if (accessibleBranchIds.length === 0) {
            return res.status(403).json({
                success: false,
                message: "You do not have access to any branch.",
                errors: [],
            });
        }

        const candidateBranchId = req.query?.branchId || req.body?.branchId;

        if (candidateBranchId) {
            if (!accessibleBranchIds.includes(candidateBranchId)) {
                return res.status(403).json({
                    success: false,
                    message: "You do not have access to this branch.",
                    errors: [],
                });
            }
            return next();
        }

        if (accessibleBranchIds.length > 1) {
            return res.status(400).json({
                success: false,
                message: "branchId is required — you have access to more than one branch.",
                errors: [],
            });
        }

        const onlyBranchId = accessibleBranchIds[0];
        if (["GET", "HEAD"].includes(req.method)) {
            // Express 5's req.query has no setter — see organizationScope.js.
            Object.defineProperty(req, "query", {
                value: { ...req.query, branchId: onlyBranchId },
                writable: true,
                configurable: true,
                enumerable: true,
            });
        } else if (req.body && typeof req.body === "object") {
            req.body.branchId = onlyBranchId;
        }

        return next();
    } catch (error) {
        return next(error);
    }
};

module.exports = {
    enforceBranchScope,
    resolveAccessibleBranchIds,
};
