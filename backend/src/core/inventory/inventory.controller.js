/**
 * ============================================================
 * File: inventory.controller.js
 * Module: Core Inventory
 * ============================================================
 */

const asyncHandler = require("../../utils/asyncHandler");
const { success } = require("../../utils/response");
const inventoryService = require("./inventory.service");

const listProductStock = asyncHandler(async (req, res) => {
    const stock = await inventoryService.listProductStock({
        organizationId: req.query.organizationId,
        branchId: req.query.branchId,
    });
    return success(res, "Stock levels fetched successfully.", stock, 200);
});

const updateReorderLevel = asyncHandler(async (req, res) => {
    const stock = await inventoryService.updateReorderLevel({
        organizationId: req.user.organizationId,
        branchId: req.body.branchId,
        productId: req.body.productId,
        reorderLevel: req.body.reorderLevel,
    });
    return success(res, "Reorder level updated successfully.", stock, 200);
});

const listStockBatches = asyncHandler(async (req, res) => {
    const batches = await inventoryService.listStockBatches({
        organizationId: req.query.organizationId,
        branchId: req.query.branchId,
    });
    return success(res, "Stock batches fetched successfully.", batches, 200);
});

module.exports = {
    listProductStock,
    updateReorderLevel,
    listStockBatches,
};
