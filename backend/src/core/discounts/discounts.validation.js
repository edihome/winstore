/**
 * ============================================================
 * File: discounts.validation.js
 * Module: Core Discounts
 *
 * Description:
 * Validation rules for discount endpoints.
 * ============================================================
 */

const { isNonEmptyString } = require("../../utils/validators");

const DISCOUNT_STATUSES = ["active", "inactive"];

const validateCreateDiscount = (payload = {}) => {
    const errors = [];
    const code = String(payload.code || "").trim();
    const amount = Number(payload.amount);
    const organizationId = String(payload.organizationId || "").trim();

    if (!isNonEmptyString(code)) {
        errors.push("Discount code is required.");
    }

    if (!Number.isFinite(amount) || amount <= 0) {
        errors.push("Discount amount must be a positive number.");
    }

    if (!isNonEmptyString(organizationId)) {
        errors.push("Organization ID is required.");
    }

    return errors;
};

const validateUpdateDiscount = (payload = {}) => {
    const errors = [];

    if (payload.status !== undefined && !DISCOUNT_STATUSES.includes(payload.status)) {
        errors.push(`Status must be one of: ${DISCOUNT_STATUSES.join(", ")}.`);
    }

    return errors;
};

module.exports = {
    validateCreateDiscount,
    validateUpdateDiscount,
};
