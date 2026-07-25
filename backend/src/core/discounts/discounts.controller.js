/**
 * ============================================================
 * File: discounts.controller.js
 * Module: Core Discounts
 *
 * Description:
 * HTTP controller for discount endpoints.
 * ============================================================
 */

const asyncHandler = require("../../utils/asyncHandler");
const { success } = require("../../utils/response");
const { createTemplateHandler, createBulkImportHandler } = require("../../utils/bulkImportHandlers");
const discountsService = require("./discounts.service");

const IMPORT_HEADERS = ["Code", "Amount"];
const IMPORT_EXAMPLE_ROWS = [{ Code: "LOYAL10", Amount: 10 }];

const mapImportRow = (row, req) => ({
    code: row.Code,
    amount: Number(row.Amount),
    organizationId: req.user.organizationId,
});

const listDiscounts = asyncHandler(async (req, res) => {
    const discounts = await discountsService.listDiscounts({
        organizationId: req.query.organizationId,
        status: req.query.status,
    });
    return success(res, "Discounts fetched successfully.", discounts, 200);
});

const createDiscount = asyncHandler(async (req, res) => {
    const discount = await discountsService.createDiscount(req.body);
    return success(res, "Discount created successfully.", discount, 201);
});

const updateDiscountStatus = asyncHandler(async (req, res) => {
    const discount = await discountsService.updateDiscountStatus(req.params.id, req.user.organizationId, req.body);
    return success(res, "Discount updated successfully.", discount, 200);
});

const deleteDiscount = asyncHandler(async (req, res) => {
    await discountsService.deleteDiscount(req.params.id, req.user.organizationId);
    return success(res, "Discount deleted successfully.", null, 200);
});

const downloadImportTemplate = createTemplateHandler(
    "discounts-template.xlsx",
    IMPORT_HEADERS,
    IMPORT_EXAMPLE_ROWS
);

const bulkImportDiscounts = createBulkImportHandler(mapImportRow, discountsService.createDiscount);

module.exports = {
    listDiscounts,
    createDiscount,
    updateDiscountStatus,
    deleteDiscount,
    downloadImportTemplate,
    bulkImportDiscounts,
};
