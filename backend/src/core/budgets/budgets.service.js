/**
 * ============================================================
 * File: budgets.service.js
 * Module: Core Budgets
 *
 * Description:
 * Business logic for budget management.
 * ============================================================
 */

const crypto = require("crypto");
const AppError = require("../../utils/AppError");
const { validateCreateBudget } = require("./budgets.validation");
const budgetsRepository = require("./budgets.repository");
const { moneyToCents } = require("../../utils/money");

const toBudgetResponse = (row) => ({
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    amount: Number(row.amount),
    status: row.status,
    createdAt: row.created_at,
});

const listBudgets = async (filters = {}) => {
    const budgets = await budgetsRepository.listBudgets(filters);
    return budgets.map(toBudgetResponse);
};

const createBudget = async (payload) => {
    const validationErrors = validateCreateBudget(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    const budget = await budgetsRepository.createBudget({
        id: crypto.randomUUID(),
        organizationId: payload.organizationId,
        name: payload.name.trim(),
        amount: moneyToCents(payload.amount) / 100,
        status: payload.status || "active",
    });

    return toBudgetResponse(budget);
};

module.exports = {
    listBudgets,
    createBudget,
};
