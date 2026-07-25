/**
 * ============================================================
 * File: expenses.service.js
 * Module: Core Expenses
 *
 * Description:
 * Business logic for expense management. An expense is recorded
 * "pending", then either marked paid (counts as real spend in
 * reports, stamped with paid_at) or cancelled (never happened).
 * Both outcomes are terminal, same rule as purchases.
 * ============================================================
 */

const crypto = require("crypto");
const AppError = require("../../utils/AppError");
const { assertBranchAccessible } = require("../../utils/assertBranchAccessible");
const {
    EXPENSE_STATUSES,
    validateCreateExpense,
    validateUpdateExpenseStatus,
} = require("./expenses.validation");
const expensesRepository = require("./expenses.repository");
const { totalFromRows } = require("../../utils/pagination");

const toExpenseResponse = (row) => {
    if (!row) {
        return null;
    }

    return {
        id: row.id,
        organizationId: row.organization_id,
        branchId: row.branch_id,
        description: row.description,
        category: row.category,
        amount: Number(row.amount),
        status: row.status,
        createdBy: row.created_by,
        paidAt: row.paid_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
};

const listExpenses = async (filters = {}) => {
    const rows = await expensesRepository.listExpenses(filters);
    const items = rows.map(toExpenseResponse);
    if (filters.pagination) {
        return { items, total: totalFromRows(rows) };
    }
    return items;
};

const createExpense = async (payload, actingUserId) => {
    const validationErrors = validateCreateExpense(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    const expense = await expensesRepository.createExpense({
        id: crypto.randomUUID(),
        organizationId: payload.organizationId,
        branchId: payload.branchId,
        description: String(payload.description).trim(),
        category: payload.category ? String(payload.category).trim() : "general",
        amount: Number(payload.amount),
        status: EXPENSE_STATUSES.PENDING,
        createdBy: actingUserId,
    });

    return toExpenseResponse(expense);
};

const updateExpenseStatus = async (id, organizationId, payload, accessibleBranchIds = null) => {
    const validationErrors = validateUpdateExpenseStatus(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    const existing = await expensesRepository.findExpenseById(id, organizationId);
    if (!existing) {
        throw new AppError("Expense not found.", 404);
    }
    assertBranchAccessible(existing.branch_id, accessibleBranchIds, "Expense not found.");

    if (existing.status !== EXPENSE_STATUSES.PENDING) {
        throw new AppError(`Cannot move an expense from "${existing.status}" to "${payload.status}".`, 409);
    }

    const paidAt = payload.status === EXPENSE_STATUSES.PAID ? new Date() : null;
    const expense = await expensesRepository.updateExpenseStatus(id, organizationId, payload.status, paidAt);
    return toExpenseResponse(expense);
};

module.exports = {
    listExpenses,
    createExpense,
    updateExpenseStatus,
};
