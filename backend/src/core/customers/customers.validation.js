/**
 * ============================================================
 * File: customers.validation.js
 * Module: Core Customers
 *
 * Description:
 * Validation rules and constants for customer endpoints.
 * ============================================================
 */

const { isNonEmptyString, isValidEmail } = require("../../utils/validators");

const CUSTOMER_STATUSES = Object.freeze({
    ACTIVE: "active",
    INACTIVE: "inactive",
});

const CUSTOMER_STATUS_VALUES = Object.freeze(Object.values(CUSTOMER_STATUSES));

const validateCreateCustomer = (payload = {}) => {
    const errors = [];
    const name = String(payload.name || "").trim();
    const email = String(payload.email || "").trim();
    const phone = String(payload.phone || "").trim();
    const organizationId = String(payload.organizationId || "").trim();

    if (!isNonEmptyString(name)) {
        errors.push("Customer name is required.");
    }

    if (!isValidEmail(email)) {
        errors.push("Customer email must be a valid email address.");
    }

    if (!isNonEmptyString(phone)) {
        errors.push("Customer phone is required.");
    }

    if (!isNonEmptyString(organizationId)) {
        errors.push("Organization ID is required.");
    }

    return errors;
};

const validateUpdateCustomer = (payload = {}) => {
    const errors = [];

    if (payload.name !== undefined && !isNonEmptyString(String(payload.name).trim())) {
        errors.push("Customer name cannot be empty.");
    }

    if (payload.email !== undefined && !isValidEmail(String(payload.email).trim())) {
        errors.push("Customer email must be a valid email address.");
    }

    if (payload.phone !== undefined && !isNonEmptyString(String(payload.phone).trim())) {
        errors.push("Customer phone cannot be empty.");
    }

    if (payload.status !== undefined && !CUSTOMER_STATUS_VALUES.includes(payload.status)) {
        errors.push(`Status must be one of: ${CUSTOMER_STATUS_VALUES.join(", ")}.`);
    }

    return errors;
};

module.exports = {
    CUSTOMER_STATUSES,
    CUSTOMER_STATUS_VALUES,
    validateCreateCustomer,
    validateUpdateCustomer,
};
