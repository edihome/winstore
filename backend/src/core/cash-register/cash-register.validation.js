/**
 * ============================================================
 * File: cash-register.validation.js
 * Module: Core Cash Register
 *
 * Description:
 * Validation rules and constants for cash register endpoints.
 * ============================================================
 */

const { isNonEmptyString } = require("../../utils/validators");
const { moneyToCents } = require("../../utils/money");

const CASH_REGISTER_STATUSES = Object.freeze({
    OPEN: "open",
    CLOSED: "closed",
});

const CASH_TRANSACTION_TYPES = Object.freeze({
    INFLOW: "inflow",
    OUTFLOW: "outflow",
});

const CASH_REGISTER_STATUS_VALUES = Object.freeze(Object.values(CASH_REGISTER_STATUSES));
const CASH_TRANSACTION_TYPE_VALUES = Object.freeze(Object.values(CASH_TRANSACTION_TYPES));

const isNonNegativeAmount = (value) => {
    return moneyToCents(value) !== null;
};

const isPositiveAmount = (value) => {
    const amount = moneyToCents(value);
    return amount !== null && amount > 0;
};

/**
 * Validate the payload used to create a cash register.
 *
 * @param {object} payload Request body.
 * @returns {string[]} Validation error messages.
 */
const validateCreateCashRegister = (payload = {}) => {
    const errors = [];
    const organizationId = String(payload.organizationId || "").trim();
    const branchId = String(payload.branchId || "").trim();
    const name = payload.name;

    if (!isNonEmptyString(organizationId)) {
        errors.push("Organization ID is required.");
    }

    if (!isNonEmptyString(branchId)) {
        errors.push("Branch ID is required.");
    }

    if (!isNonEmptyString(name)) {
        errors.push("Cash register name is required.");
    } else if (name.trim().length > 255) {
        errors.push("Cash register name cannot exceed 255 characters.");
    }

    if (payload.openingBalance !== undefined && !isNonNegativeAmount(payload.openingBalance)) {
        errors.push("Opening balance must be nonnegative, at most 9,999,999,999.99, with no more than two decimal places.");
    }

    return errors;
};

/**
 * Validate the payload used to create a cash transaction.
 *
 * @param {object} payload Request body.
 * @returns {string[]} Validation error messages.
 */
const validateCreateCashTransaction = (payload = {}) => {
    const errors = [];
    const organizationId = String(payload.organizationId || "").trim();
    const cashRegisterId = String(payload.cashRegisterId || "").trim();
    const transactionType = payload.transactionType;

    if (!isNonEmptyString(organizationId)) {
        errors.push("Organization ID is required.");
    }

    if (!isNonEmptyString(cashRegisterId)) {
        errors.push("Cash register ID is required.");
    }

    if (!CASH_TRANSACTION_TYPE_VALUES.includes(transactionType)) {
        errors.push(`Cash transaction type must be one of: ${CASH_TRANSACTION_TYPE_VALUES.join(", ")}.`);
    }

    if (!isPositiveAmount(payload.amount)) {
        errors.push("Cash transaction amount must be greater than zero, at most 9,999,999,999.99, with no more than two decimal places.");
    }

    if (payload.reference != null && (typeof payload.reference !== "string" || payload.reference.length > 150)) {
        errors.push("Reference must be text with no more than 150 characters.");
    }
    if (payload.notes != null && typeof payload.notes !== "string") {
        errors.push("Notes must be text.");
    }

    return errors;
};

module.exports = {
    CASH_REGISTER_STATUSES,
    CASH_REGISTER_STATUS_VALUES,
    CASH_TRANSACTION_TYPES,
    CASH_TRANSACTION_TYPE_VALUES,
    validateCreateCashRegister,
    validateCreateCashTransaction,
};
