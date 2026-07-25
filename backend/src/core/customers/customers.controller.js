/**
 * ============================================================
 * File: customers.controller.js
 * Module: Core Customers
 *
 * Description:
 * HTTP controller for customer endpoints.
 * ============================================================
 */

const asyncHandler = require("../../utils/asyncHandler");
const { success, paginated } = require("../../utils/response");
const { parsePagination, parseSort, buildPageMeta } = require("../../utils/pagination");
const { isAdminUser } = require("../../utils/isAdminUser");
const { createTemplateHandler, createBulkImportHandler } = require("../../utils/bulkImportHandlers");
const customersService = require("./customers.service");

const IMPORT_HEADERS = ["Name", "Email", "Phone"];
const IMPORT_EXAMPLE_ROWS = [{ Name: "Jane Doe", Email: "jane@example.com", Phone: "555-0100" }];

const mapImportRow = (row, req) => ({
    name: row.Name,
    email: row.Email,
    phone: row.Phone,
    organizationId: req.user.organizationId,
});

const listCustomers = asyncHandler(async (req, res) => {
    const pagination = parsePagination(req.query);
    const result = await customersService.listCustomers({
        organizationId: req.query.organizationId,
        search: req.query.search,
        includeInactive: req.query.includeInactive === "true",
        pagination,
        sort: parseSort(req.query),
    });
    if (pagination) {
        return paginated(res, "Customers fetched successfully.", result.items, buildPageMeta(pagination, result.total));
    }
    return success(res, "Customers fetched successfully.", result, 200);
});

// Setting a customer's credit limit is an admin control, not a routine
// customers:manage action — silently ignore it from non-admins (their other
// edits still go through) so a cashier can't hand out or raise credit.
const stripCreditLimitForNonAdmins = (req) => {
    if (req.body && req.body.creditLimit !== undefined && !isAdminUser(req.user)) {
        delete req.body.creditLimit;
    }
};

const createCustomer = asyncHandler(async (req, res) => {
    stripCreditLimitForNonAdmins(req);
    const customer = await customersService.createCustomer(req.body);
    return success(res, "Customer created successfully.", customer, 201);
});

const updateCustomer = asyncHandler(async (req, res) => {
    stripCreditLimitForNonAdmins(req);
    const customer = await customersService.updateCustomer(req.params.id, req.user.organizationId, req.body);
    return success(res, "Customer updated successfully.", customer, 200);
});

const deleteCustomer = asyncHandler(async (req, res) => {
    const force = req.query.force === "true" || req.body?.force === true;
    await customersService.deleteCustomer(req.params.id, req.user.organizationId, force);
    return success(res, "Customer deleted successfully.", null, 200);
});

const downloadImportTemplate = createTemplateHandler(
    "customers-template.xlsx",
    IMPORT_HEADERS,
    IMPORT_EXAMPLE_ROWS
);

const bulkImportCustomers = createBulkImportHandler(mapImportRow, customersService.createCustomer);

module.exports = {
    listCustomers,
    createCustomer,
    updateCustomer,
    deleteCustomer,
    downloadImportTemplate,
    bulkImportCustomers,
};
