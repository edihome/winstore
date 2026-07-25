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

const validateCreateBudget = (payload = {}) => {
    const errors = [];
    const name = String(payload.name || "").trim();
    const amount = String(payload.amount || "").trim();
    const organizationId = String(payload.organizationId || "").trim();

    if (!isNonEmptyString(name)) {
        errors.push("Budget name is required.");
    }

    if (!isNonEmptyString(amount)) {
        errors.push("Budget amount is required.");
    }

    if (!isNonEmptyString(organizationId)) {
        errors.push("Organization ID is required.");
    }

    return errors;
};

module.exports = {
    validateCreateBudget,
};
