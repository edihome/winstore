/**
 * ============================================================
 * File: branches.controller.js
 * Module: Core Branches
 *
 * Description:
 * HTTP controller for branch endpoints.
 * ============================================================
 */

const asyncHandler = require("../../utils/asyncHandler");
const { success } = require("../../utils/response");
const { createTemplateHandler, createBulkImportHandler } = require("../../utils/bulkImportHandlers");
const branchesService = require("./branches.service");

const IMPORT_HEADERS = ["Name", "Code", "Headquarters (yes/no)"];
const IMPORT_EXAMPLE_ROWS = [{ Name: "Downtown Branch", Code: "DT1", "Headquarters (yes/no)": "no" }];

const isTruthyCell = (value) => ["yes", "true", "1"].includes(String(value || "").trim().toLowerCase());

const mapImportRow = (row, req) => ({
    name: row.Name,
    code: row.Code,
    isHeadquarters: isTruthyCell(row["Headquarters (yes/no)"]),
    organizationId: req.user.organizationId,
});

const listBranches = asyncHandler(async (req, res) => {
    const branches = await branchesService.listBranches(req.query, req.user);
    return success(res, "Branches retrieved successfully.", branches, 200);
});

const createBranch = asyncHandler(async (req, res) => {
    const branch = await branchesService.createBranch(req.body);
    return success(res, "Branch created successfully.", branch, 201);
});

const updateBranch = asyncHandler(async (req, res) => {
    const branch = await branchesService.updateBranch(req.params.id, req.user.organizationId, req.body, req.user);
    return success(res, "Branch updated successfully.", branch, 200);
});

const downloadImportTemplate = createTemplateHandler(
    "branches-template.xlsx",
    IMPORT_HEADERS,
    IMPORT_EXAMPLE_ROWS
);

const bulkImportBranches = createBulkImportHandler(mapImportRow, branchesService.createBranch);

module.exports = {
    listBranches,
    createBranch,
    updateBranch,
    downloadImportTemplate,
    bulkImportBranches,
};
