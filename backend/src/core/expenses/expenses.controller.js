/**
 * ============================================================
 * File: expenses.controller.js
 * Module: Core Expenses
 *
 * Description:
 * HTTP controller for expense endpoints.
 * ============================================================
 */

const asyncHandler = require("../../utils/asyncHandler");
const { success, paginated } = require("../../utils/response");
const { parsePagination, parseSort, buildPageMeta } = require("../../utils/pagination");
const { isPrivilegedRole } = require("../../utils/isPrivilegedRole");
const { createTemplateHandler, createBulkImportHandler } = require("../../utils/bulkImportHandlers");
const { resolveBranchIdByCode } = require("../../utils/resolveBranchIdByCode");
const expensesService = require("./expenses.service");

const IMPORT_HEADERS = ["Description", "Category", "Amount", "Branch Code"];
const IMPORT_EXAMPLE_ROWS = [
    { Description: "Electricity bill", Category: "utilities", Amount: 150.5, "Branch Code": "MAIN" },
];

const mapImportRow = async (row, req) => ({
    description: row.Description,
    category: row.Category || undefined,
    amount: Number(row.Amount),
    branchId: await resolveBranchIdByCode(row["Branch Code"], req),
    organizationId: req.user.organizationId,
});

const listExpenses = asyncHandler(async (req, res) => {
    const pagination = parsePagination(req.query);
    const result = await expensesService.listExpenses({
        organizationId: req.query.organizationId,
        branchId: req.query.branchId,
        status: req.query.status,
        pagination,
        sort: parseSort(req.query),
    });
    if (pagination) {
        return paginated(res, "Expenses fetched successfully.", result.items, buildPageMeta(pagination, result.total));
    }
    return success(res, "Expenses fetched successfully.", result, 200);
});

const createExpense = asyncHandler(async (req, res) => {
    const expense = await expensesService.createExpense(req.body, req.user.id);
    return success(res, "Expense created successfully.", expense, 201);
});

const updateExpenseStatus = asyncHandler(async (req, res) => {
    const accessibleBranchIds = isPrivilegedRole(req.user.role) ? null : req.user.accessibleBranchIds;
    const expense = await expensesService.updateExpenseStatus(req.params.id, req.user.organizationId, req.body, accessibleBranchIds);
    return success(res, "Expense updated successfully.", expense, 200);
});

const downloadImportTemplate = createTemplateHandler(
    "expenses-template.xlsx",
    IMPORT_HEADERS,
    IMPORT_EXAMPLE_ROWS
);

const bulkImportExpenses = createBulkImportHandler(
    mapImportRow,
    (payload, req) => expensesService.createExpense(payload, req.user.id)
);

module.exports = {
    listExpenses,
    createExpense,
    updateExpenseStatus,
    downloadImportTemplate,
    bulkImportExpenses,
};
