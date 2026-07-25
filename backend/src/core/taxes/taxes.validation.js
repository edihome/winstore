/**
 * ============================================================
 * File: taxes.validation.js
 * Module: Core Taxes
 *
 * Description:
 * Validation rules for tax endpoints.
 * ============================================================
 */

const { isNonEmptyString } = require("../../utils/validators");

const TAX_STATUSES = ["active", "inactive"];

const validateCreateTax = (payload = {}) => {
    const errors = [];
    const name = String(payload.name || "").trim();
    // Number("") coerces to 0, which would sneak past the range check —
    // an absent/blank rate must be rejected, not treated as 0%.
    const rateProvided = isNonEmptyString(String(payload.rate ?? ""));
    const rate = Number(payload.rate);
    const organizationId = String(payload.organizationId || "").trim();

    if (!isNonEmptyString(name)) {
        errors.push("Tax name is required.");
    }

    if (!rateProvided || !Number.isFinite(rate) || rate < 0 || rate > 100) {
        errors.push("Tax rate must be a number between 0 and 100.");
    }

    if (!isNonEmptyString(organizationId)) {
        errors.push("Organization ID is required.");
    }

    return errors;
};

const validateUpdateTax = (payload = {}) => {
    const errors = [];

    if (payload.status !== undefined && !TAX_STATUSES.includes(payload.status)) {
        errors.push(`Status must be one of: ${TAX_STATUSES.join(", ")}.`);
    }

    return errors;
};

module.exports = {
    validateCreateTax,
    validateUpdateTax,
};
