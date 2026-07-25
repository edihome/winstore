/**
 * ============================================================
 * File: payments.validation.js
 * Module: Core Payments
 * ============================================================
 */

const { isNonEmptyString } = require("../../utils/validators");

const PAYMENT_METHODS = ["cash", "card", "transfer", "other"];

const validateCreatePayment = (payload = {}) => {
    const errors = [];
    const saleId = String(payload.saleId || "").trim();
    const organizationId = String(payload.organizationId || "").trim();
    const amount = Number(payload.amount);

    if (!isNonEmptyString(saleId)) {
        errors.push("saleId is required.");
    }

    if (!isNonEmptyString(organizationId)) {
        errors.push("Organization ID is required.");
    }

    if (!Number.isFinite(amount) || amount <= 0) {
        errors.push("Amount must be a positive number.");
    }

    if (payload.method !== undefined && !PAYMENT_METHODS.includes(payload.method)) {
        errors.push(`Method must be one of: ${PAYMENT_METHODS.join(", ")}.`);
    }

    return errors;
};

module.exports = {
    validateCreatePayment,
};
