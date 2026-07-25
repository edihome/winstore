/**
 * ============================================================
 * File: suppliers.validation.js
 * Module: Core Suppliers
 *
 * Description:
 * Validation rules and constants for supplier endpoints.
 * ============================================================
 */

const { isNonEmptyString, isValidEmail } = require("../../utils/validators");

const SUPPLIER_STATUSES = ["active", "inactive"];

const validateCreateSupplier = (payload = {}) => {
    const errors = [];
    const name = String(payload.name || "").trim();
    const email = String(payload.email || "").trim();
    const phone = String(payload.phone || "").trim();
    const organizationId = String(payload.organizationId || "").trim();

    if (!isNonEmptyString(name)) {
        errors.push("Supplier name is required.");
    }

    if (!isValidEmail(email)) {
        errors.push("Supplier email must be a valid email address.");
    }

    if (!isNonEmptyString(phone)) {
        errors.push("Supplier phone is required.");
    }

    if (!isNonEmptyString(organizationId)) {
        errors.push("Organization ID is required.");
    }

    return errors;
};

const validateUpdateSupplier = (payload = {}) => {
    const errors = [];

    if (payload.name !== undefined && !isNonEmptyString(String(payload.name).trim())) {
        errors.push("Supplier name cannot be empty.");
    }

    if (payload.email !== undefined && !isValidEmail(String(payload.email).trim())) {
        errors.push("Supplier email must be a valid email address.");
    }

    if (payload.phone !== undefined && !isNonEmptyString(String(payload.phone).trim())) {
        errors.push("Supplier phone cannot be empty.");
    }

    if (payload.status !== undefined && !SUPPLIER_STATUSES.includes(payload.status)) {
        errors.push(`Status must be one of: ${SUPPLIER_STATUSES.join(", ")}.`);
    }

    return errors;
};

module.exports = {
    validateCreateSupplier,
    validateUpdateSupplier,
};
