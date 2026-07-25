/**
 * ============================================================
 * File: organizations.validation.js
 * Module: Core Organizations
 *
 * Description:
 * Validation rules for organization endpoints.
 * ============================================================
 */

const { isNonEmptyString, isValidSlug } = require("../../utils/validators");

const ORGANIZATION_STATUSES = ["active", "inactive"];

const validateSubscriptionFields = (payload, errors) => {
    if (payload.subscriptionExpiresAt !== undefined && payload.subscriptionExpiresAt !== null) {
        if (Number.isNaN(Date.parse(payload.subscriptionExpiresAt))) {
            errors.push("Subscription expiration must be a valid date.");
        }
    }

    if (payload.alertThresholdDays !== undefined) {
        const value = Number(payload.alertThresholdDays);
        if (!Number.isInteger(value) || value < 0) {
            errors.push("Alert threshold days must be a non-negative whole number.");
        }
    }

    if (payload.extensionDays !== undefined) {
        const value = Number(payload.extensionDays);
        if (!Number.isInteger(value) || value < 0) {
            errors.push("Extension days must be a non-negative whole number.");
        }
    }
};

const validateCreateOrganization = (payload = {}) => {
    const errors = [];
    const name = String(payload.name || "").trim();

    if (!isNonEmptyString(name)) {
        errors.push("Organization name is required.");
    }

    // Slug is optional here — the service auto-derives one from the name
    // (same as self-registration already does) when it's omitted. Only
    // reject a slug the caller explicitly typed in wrong.
    if (payload.slug !== undefined && String(payload.slug).trim() !== "" && !isValidSlug(String(payload.slug).trim())) {
        errors.push("Organization slug must be lowercase letters, numbers, and dashes only.");
    }

    validateSubscriptionFields(payload, errors);

    return errors;
};

const validateUpdateOrganization = (payload = {}) => {
    const errors = [];

    if (payload.name !== undefined && !isNonEmptyString(String(payload.name).trim())) {
        errors.push("Organization name cannot be empty.");
    }

    if (payload.slug !== undefined && !isValidSlug(String(payload.slug).trim())) {
        errors.push("Organization slug must be lowercase letters, numbers, and dashes only.");
    }

    if (payload.status !== undefined && !ORGANIZATION_STATUSES.includes(payload.status)) {
        errors.push(`status must be one of: ${ORGANIZATION_STATUSES.join(", ")}.`);
    }

    validateSubscriptionFields(payload, errors);

    return errors;
};

const validateRecordSubscriptionPayment = (payload = {}) => {
    const errors = [];

    const amount = Number(payload.amount);
    if (payload.amount === undefined || payload.amount === "" || !Number.isFinite(amount) || amount < 0) {
        errors.push("Payment amount must be a non-negative number.");
    }

    const daysGranted = Number(payload.daysGranted);
    if (!Number.isInteger(daysGranted) || daysGranted <= 0) {
        errors.push("Days granted must be a positive whole number.");
    }

    if (payload.currency !== undefined && !isNonEmptyString(String(payload.currency).trim())) {
        errors.push("Currency cannot be empty when provided.");
    }

    return errors;
};

module.exports = {
    ORGANIZATION_STATUSES,
    validateCreateOrganization,
    validateUpdateOrganization,
    validateRecordSubscriptionPayment,
};
