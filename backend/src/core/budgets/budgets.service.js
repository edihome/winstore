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

const listBudgets = async (filters = {}) => {
    return budgetsRepository.listBudgets(filters);
};

const createBudget = async (payload) => {
    const validationErrors = validateCreateBudget(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    const budget = await budgetsRepository.createBudget({
        id: crypto.randomUUID(),
        organizationId: payload.organizationId,
        name: payload.name,
        amount: payload.amount,
        status: payload.status || "active",
    });

    return budget;
};

module.exports = {
    listBudgets,
    createBudget,
};
