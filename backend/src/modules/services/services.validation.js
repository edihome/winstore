/**
 * ============================================================
 * File: services.validation.js
 * Module: Services
 *
 * Description:
 * Validation rules and constants for service catalog endpoints.
 * ============================================================
 */

const { isNonEmptyString } = require("../../utils/validators");

const MIN_DURATION_MINUTES = 5;
const MAX_DURATION_MINUTES = 24 * 60;

/**
 * Validate the payload for creating a service.
 *
 * @param {object} payload Request body.
 * @returns {string[]} List of validation error messages (empty if valid).
 */
const validateCreateService = (payload = {}) => {
    const errors = [];
    const name = String(payload.name || "").trim();
    const durationMinutes = Number(payload.durationMinutes);
    const price = Number(payload.price);

    if (!isNonEmptyString(name)) {
        errors.push("Service name is required.");
    }

    if (!Number.isFinite(durationMinutes) || durationMinutes < MIN_DURATION_MINUTES || durationMinutes > MAX_DURATION_MINUTES) {
        errors.push(`Duration must be a number between ${MIN_DURATION_MINUTES} and ${MAX_DURATION_MINUTES} minutes.`);
    }

    if (!Number.isFinite(price) || price < 0) {
        errors.push("Price must be a non-negative number.");
    }

    return errors;
};

/**
 * Validate the payload for updating a service.
 * All fields are optional, but whatever is provided must be valid.
 *
 * @param {object} payload Request body.
 * @returns {string[]} List of validation error messages (empty if valid).
 */
const validateUpdateService = (payload = {}) => {
    const errors = [];

    if (payload.name !== undefined && !isNonEmptyString(String(payload.name).trim())) {
        errors.push("Service name cannot be empty.");
    }

    if (payload.durationMinutes !== undefined) {
        const durationMinutes = Number(payload.durationMinutes);
        if (!Number.isFinite(durationMinutes) || durationMinutes < MIN_DURATION_MINUTES || durationMinutes > MAX_DURATION_MINUTES) {
            errors.push(`Duration must be a number between ${MIN_DURATION_MINUTES} and ${MAX_DURATION_MINUTES} minutes.`);
        }
    }

    if (payload.price !== undefined) {
        const price = Number(payload.price);
        if (!Number.isFinite(price) || price < 0) {
            errors.push("Price must be a non-negative number.");
        }
    }

    return errors;
};

module.exports = {
    MIN_DURATION_MINUTES,
    MAX_DURATION_MINUTES,
    validateCreateService,
    validateUpdateService,
};
