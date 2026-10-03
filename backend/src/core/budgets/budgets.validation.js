/**
 * ============================================================
 * File: budgets.validation.js
 * Module: Core Budgets
 *
 * Description:
 * Validation rules for budget endpoints.
 * ============================================================
 */

const { isNonEmptyString } = require("../../utils/validators");
const { moneyToCents } = require("../../utils/money");

const validateCreateBudget = (payload = {}) => {
    const errors = [];
    const name = payload.name;
    const amount = moneyToCents(payload.amount);
    const organizationId = String(payload.organizationId || "").trim();

    if (!isNonEmptyString(name)) {
        errors.push("Budget name is required.");
    } else if (name.trim().length > 255) {
        errors.push("Budget name cannot exceed 255 characters.");
    }

    if (amount === null || amount <= 0) {
        errors.push("Budget amount must be positive, at most 9,999,999,999.99, with no more than two decimal places.");
    }

    if (payload.status !== undefined && !["active", "inactive"].includes(payload.status)) {
        errors.push("Budget status must be active or inactive.");
    }

    if (!isNonEmptyString(organizationId)) {
        errors.push("Organization ID is required.");
    }

    return errors;
};

module.exports = {
    validateCreateBudget,
};
