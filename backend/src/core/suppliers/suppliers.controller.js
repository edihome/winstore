/**
 * ============================================================
 * File: suppliers.controller.js
 * Module: Core Suppliers
 *
 * Description:
 * HTTP controller for supplier endpoints.
 * ============================================================
 */

const asyncHandler = require("../../utils/asyncHandler");
const { success, paginated } = require("../../utils/response");
const { parsePagination, parseSort, buildPageMeta } = require("../../utils/pagination");
const { createTemplateHandler, createBulkImportHandler } = require("../../utils/bulkImportHandlers");
const suppliersService = require("./suppliers.service");

const IMPORT_HEADERS = ["Name", "Email", "Phone"];
const IMPORT_EXAMPLE_ROWS = [{ Name: "Acme Wholesale", Email: "orders@acme.example", Phone: "555-0199" }];

const mapImportRow = (row, req) => ({
    name: row.Name,
    email: row.Email,
    phone: row.Phone,
    organizationId: req.user.organizationId,
});

const listSuppliers = asyncHandler(async (req, res) => {
    const pagination = parsePagination(req.query);
    const result = await suppliersService.listSuppliers({
        organizationId: req.query.organizationId,
        search: req.query.search,
        includeInactive: req.query.includeInactive === "true",
        pagination,
        sort: parseSort(req.query),
    });
    if (pagination) {
        return paginated(res, "Suppliers fetched successfully.", result.items, buildPageMeta(pagination, result.total));
    }
    return success(res, "Suppliers fetched successfully.", result, 200);
});

const createSupplier = asyncHandler(async (req, res) => {
    const supplier = await suppliersService.createSupplier(req.body);
    return success(res, "Supplier created successfully.", supplier, 201);
});

const updateSupplier = asyncHandler(async (req, res) => {
    const supplier = await suppliersService.updateSupplier(req.params.id, req.user.organizationId, req.body);
    return success(res, "Supplier updated successfully.", supplier, 200);
});

const deleteSupplier = asyncHandler(async (req, res) => {
    const force = req.query.force === "true" || req.body?.force === true;
    await suppliersService.deleteSupplier(req.params.id, req.user.organizationId, force);
    return success(res, "Supplier deleted successfully.", null, 200);
});

const downloadImportTemplate = createTemplateHandler(
    "suppliers-template.xlsx",
    IMPORT_HEADERS,
    IMPORT_EXAMPLE_ROWS
);

const bulkImportSuppliers = createBulkImportHandler(mapImportRow, suppliersService.createSupplier);

module.exports = {
    listSuppliers,
    createSupplier,
    updateSupplier,
    deleteSupplier,
    downloadImportTemplate,
    bulkImportSuppliers,
};
