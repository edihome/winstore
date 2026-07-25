/**
 * ============================================================
 * File: expenses.validation.js
 * Module: Core Expenses
 *
 * Description:
 * Validation rules and constants for expense endpoints.
 * ============================================================
 */

const { isNonEmptyString } = require("../../utils/validators");

const EXPENSE_STATUSES = Object.freeze({
    PENDING: "pending",
    PAID: "paid",
    CANCELLED: "cancelled",
});

const EXPENSE_STATUS_VALUES = Object.freeze(Object.values(EXPENSE_STATUSES));

const validateCreateExpense = (payload = {}) => {
    const errors = [];
    const description = String(payload.description || "").trim();
    const amount = Number(payload.amount);
    const amountProvided = isNonEmptyString(String(payload.amount ?? ""));
    const branchId = String(payload.branchId || "").trim();
    const organizationId = String(payload.organizationId || "").trim();

    if (!isNonEmptyString(description)) {
        errors.push("Expense description is required.");
    }

    if (!amountProvided || !Number.isFinite(amount) || amount <= 0) {
        errors.push("Expense amount must be a positive number.");
    }

    if (!isNonEmptyString(branchId)) {
        errors.push("Branch ID is required.");
    }

    if (!isNonEmptyString(organizationId)) {
        errors.push("Organization ID is required.");
    }

    return errors;
};

const validateUpdateExpenseStatus = (payload = {}) => {
    const errors = [];

    // Only the two outcomes are settable; an expense is born "pending".
    if (![EXPENSE_STATUSES.PAID, EXPENSE_STATUSES.CANCELLED].includes(payload.status)) {
        errors.push(`Status must be one of: ${EXPENSE_STATUSES.PAID}, ${EXPENSE_STATUSES.CANCELLED}.`);
    }

    return errors;
};

module.exports = {
    EXPENSE_STATUSES,
    EXPENSE_STATUS_VALUES,
    validateCreateExpense,
    validateUpdateExpenseStatus,
};
