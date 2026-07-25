/**
 * ============================================================
 * File: services.controller.js
 * Module: Services
 *
 * Description:
 * HTTP controller for the service catalog.
 * ============================================================
 */

const asyncHandler = require("../../utils/asyncHandler");
const { success, paginated } = require("../../utils/response");
const { parsePagination, parseSort, buildPageMeta } = require("../../utils/pagination");
const { createTemplateHandler, createBulkImportHandler } = require("../../utils/bulkImportHandlers");
const servicesService = require("./services.service");

const IMPORT_HEADERS = ["Name", "Description", "Duration Minutes", "Price"];
const IMPORT_EXAMPLE_ROWS = [
    { Name: "Haircut & Style", Description: "Wash, cut, and style", "Duration Minutes": 30, Price: 45 },
];

const mapImportRow = (row, req) => ({
    name: row.Name,
    description: row.Description || undefined,
    durationMinutes: Number(row["Duration Minutes"]),
    price: Number(row.Price),
    organizationId: req.user.organizationId,
});

const listServices = asyncHandler(async (req, res) => {
    const pagination = parsePagination(req.query);
    const result = await servicesService.listServices({
        organizationId: req.query.organizationId,
        branchId: req.query.branchId,
        includeInactive: req.query.includeInactive === "true",
        search: req.query.search,
        pagination,
        sort: parseSort(req.query),
    });
    if (pagination) {
        return paginated(res, "Services fetched successfully.", result.items, buildPageMeta(pagination, result.total));
    }
    return success(res, "Services fetched successfully.", result, 200);
});

const createService = asyncHandler(async (req, res) => {
    const service = await servicesService.createService(req.body);
    return success(res, "Service created successfully.", service, 201);
});

const updateService = asyncHandler(async (req, res) => {
    const service = await servicesService.updateService(req.params.id, req.user.organizationId, req.body);
    return success(res, "Service updated successfully.", service, 200);
});

const deleteService = asyncHandler(async (req, res) => {
    const force = req.query.force === "true" || req.body?.force === true;
    await servicesService.deleteService(req.params.id, req.user.organizationId, force);
    return success(res, "Service deleted successfully.", null, 200);
});

const downloadImportTemplate = createTemplateHandler(
    "services-template.xlsx",
    IMPORT_HEADERS,
    IMPORT_EXAMPLE_ROWS
);

const bulkImportServices = createBulkImportHandler(mapImportRow, servicesService.createService);

module.exports = {
    listServices,
    createService,
    updateService,
    deleteService,
    downloadImportTemplate,
    bulkImportServices,
};
