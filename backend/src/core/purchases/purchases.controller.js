/**
 * ============================================================
 * File: purchases.controller.js
 * Module: Core Purchases
 *
 * Description:
 * HTTP controller for purchase endpoints.
 * ============================================================
 */

const asyncHandler = require("../../utils/asyncHandler");
const { success, paginated } = require("../../utils/response");
const { parsePagination, parseSort, buildPageMeta } = require("../../utils/pagination");
const { canAccessAllBranches } = require("../../utils/isPrivilegedRole");
const purchasesService = require("./purchases.service");

const listPurchases = asyncHandler(async (req, res) => {
    const pagination = parsePagination(req.query);
    const result = await purchasesService.listPurchases({
        organizationId: req.query.organizationId,
        branchId: req.query.branchId,
        status: req.query.status,
        pagination,
        sort: parseSort(req.query),
    });
    if (pagination) {
        return paginated(res, "Purchases fetched successfully.", result.items, buildPageMeta(pagination, result.total));
    }
    return success(res, "Purchases fetched successfully.", result, 200);
});

const getPurchase = asyncHandler(async (req, res) => {
    const accessibleBranchIds = canAccessAllBranches(req.user.role) ? null : req.user.accessibleBranchIds;
    const purchase = await purchasesService.getPurchase(req.params.id, req.user.organizationId, accessibleBranchIds);
    return success(res, "Purchase fetched successfully.", purchase, 200);
});

const createPurchase = asyncHandler(async (req, res) => {
    const purchase = await purchasesService.createPurchase(req.body, req.user.id);
    return success(res, "Purchase created successfully.", purchase, 201);
});

const updatePurchaseStatus = asyncHandler(async (req, res) => {
    const accessibleBranchIds = canAccessAllBranches(req.user.role) ? null : req.user.accessibleBranchIds;
    const purchase = await purchasesService.updatePurchaseStatus(req.params.id, req.user.organizationId, req.body, accessibleBranchIds);
    return success(res, "Purchase updated successfully.", purchase, 200);
});

module.exports = {
    listPurchases,
    getPurchase,
    createPurchase,
    updatePurchaseStatus,
};
