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
    const amount = Number(value);
    return Number.isFinite(amount) && amount >= 0;
};

const isPositiveAmount = (value) => {
    const amount = Number(value);
    return Number.isFinite(amount) && amount > 0;
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
    const name = String(payload.name || "").trim();

    if (!isNonEmptyString(organizationId)) {
        errors.push("Organization ID is required.");
    }

    if (payload.branchId !== undefined && !isNonEmptyString(branchId)) {
        errors.push("Branch ID cannot be empty when provided.");
    }

    if (!isNonEmptyString(name)) {
        errors.push("Cash register name is required.");
    }

    if (payload.openingBalance !== undefined && !isNonNegativeAmount(payload.openingBalance)) {
        errors.push("Opening balance cannot be negative.");
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
    const transactionType = String(payload.transactionType || "").trim();

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
        errors.push("Cash transaction amount must be greater than zero.");
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
