/**
 * ============================================================
 * File: taxes.controller.js
 * Module: Core Taxes
 *
 * Description:
 * HTTP controller for tax endpoints.
 * ============================================================
 */

const asyncHandler = require("../../utils/asyncHandler");
const { success } = require("../../utils/response");
const { createTemplateHandler, createBulkImportHandler } = require("../../utils/bulkImportHandlers");
const taxesService = require("./taxes.service");

const IMPORT_HEADERS = ["Name", "Rate"];
const IMPORT_EXAMPLE_ROWS = [{ Name: "VAT", Rate: 7.5 }];

const mapImportRow = (row, req) => ({
    name: row.Name,
    rate: Number(row.Rate),
    organizationId: req.user.organizationId,
});

const listTaxes = asyncHandler(async (req, res) => {
    const taxes = await taxesService.listTaxes({
        organizationId: req.query.organizationId,
        status: req.query.status,
    });
    return success(res, "Taxes fetched successfully.", taxes, 200);
});

const createTax = asyncHandler(async (req, res) => {
    const tax = await taxesService.createTax(req.body);
    return success(res, "Tax created successfully.", tax, 201);
});

const updateTaxStatus = asyncHandler(async (req, res) => {
    const tax = await taxesService.updateTaxStatus(req.params.id, req.user.organizationId, req.body);
    return success(res, "Tax updated successfully.", tax, 200);
});

const deleteTax = asyncHandler(async (req, res) => {
    await taxesService.deleteTax(req.params.id, req.user.organizationId);
    return success(res, "Tax deleted successfully.", null, 200);
});

const downloadImportTemplate = createTemplateHandler(
    "taxes-template.xlsx",
    IMPORT_HEADERS,
    IMPORT_EXAMPLE_ROWS
);

const bulkImportTaxes = createBulkImportHandler(mapImportRow, taxesService.createTax);

module.exports = {
    listTaxes,
    createTax,
    updateTaxStatus,
    deleteTax,
    downloadImportTemplate,
    bulkImportTaxes,
};
