/**
 * ============================================================
 * File: sales.controller.js
 * Module: Core Sales
 * ============================================================
 */

const asyncHandler = require("../../utils/asyncHandler");
const { success, paginated } = require("../../utils/response");
const { parsePagination, parseSort, buildPageMeta } = require("../../utils/pagination");
const { canAccessAllBranches } = require("../../utils/isPrivilegedRole");
const { userHasPermission } = require("../../middlewares/permission");
const AppError = require("../../utils/AppError");
const salesService = require("./sales.service");

const listSales = asyncHandler(async (req, res) => {
    const pagination = parsePagination(req.query);
    const result = await salesService.listSales({
        organizationId: req.query.organizationId,
        branchId: req.query.branchId,
        customerId: req.query.customerId,
        pagination,
        sort: parseSort(req.query),
    });
    if (pagination) {
        return paginated(res, "Sales fetched successfully.", result.items, buildPageMeta(pagination, result.total));
    }
    return success(res, "Sales fetched successfully.", result, 200);
});

const getSale = asyncHandler(async (req, res) => {
    const accessibleBranchIds = canAccessAllBranches(req.user.role) ? null : req.user.accessibleBranchIds;
    const sale = await salesService.getSale(req.params.id, req.user.organizationId, accessibleBranchIds);
    return success(res, "Sale fetched successfully.", sale, 200);
});

const createSale = asyncHandler(async (req, res) => {
    const sale = await salesService.createSale(req.body, req.user.id);
    return success(res, "Sale completed successfully.", sale, 201);
});

const createReturn = asyncHandler(async (req, res) => {
    // Refund is its own permission. Selling is baseline (everyone gets
    // sales:manage), so refund is gated on the EXPLICIT "sales:refund" action
    // — held by Admin/Super Admin and any custom role granted Refund — not by
    // the baseline sales grant.
    if (!userHasPermission(req.user, ["sales:refund"])) {
        throw new AppError("You do not have permission to process refunds.", 403);
    }
    const accessibleBranchIds = canAccessAllBranches(req.user.role) ? null : req.user.accessibleBranchIds;
    const result = await salesService.createReturn(
        { ...req.body, saleId: req.params.id },
        req.user.id,
        accessibleBranchIds
    );
    return success(res, "Return processed and refund recorded.", result, 201);
});

module.exports = {
    listSales,
    getSale,
    createSale,
    createReturn,
};
