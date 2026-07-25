/**
 * ============================================================
 * File: customer-ledger.validation.js
 * Module: Core Customer Ledger
 * ============================================================
 */

const PAYMENT_METHODS = ["cash", "card", "transfer", "other"];

/**
 * Validate a manually-posted ledger entry (a payment received, or an
 * adjustment). Credit CHARGES are posted only by the sales flow, never here.
 */
const validateManualEntry = (payload = {}) => {
    const errors = [];

    if (payload.entryType !== "payment" && payload.entryType !== "adjustment") {
        errors.push("entryType must be 'payment' or 'adjustment'.");
    }

    const amount = Number(payload.amount);
    if (!Number.isFinite(amount)) {
        errors.push("amount must be a number.");
    } else if (payload.entryType === "payment" && amount <= 0) {
        errors.push("A payment amount must be greater than zero.");
    } else if (payload.entryType === "adjustment" && amount === 0) {
        errors.push("An adjustment amount cannot be zero.");
    }

    if (
        payload.method !== undefined &&
        payload.method !== null &&
        payload.method !== "" &&
        !PAYMENT_METHODS.includes(payload.method)
    ) {
        errors.push(`method must be one of: ${PAYMENT_METHODS.join(", ")}.`);
    }

    return errors;
};

module.exports = { PAYMENT_METHODS, validateManualEntry };
