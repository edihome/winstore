/**
 * ============================================================
 * File: appointments.validation.js
 * Module: Appointments
 *
 * Description:
 * Validation rules and constants for service appointment endpoints.
 * ============================================================
 */

const { isNonEmptyString } = require("../../utils/validators");

const APPOINTMENT_STATUSES = ["scheduled", "completed", "cancelled", "no_show"];

/**
 * Validate the payload for booking an appointment.
 *
 * @param {object} payload Request body.
 * @returns {string[]} List of validation error messages (empty if valid).
 */
const validateCreateAppointment = (payload = {}) => {
    const errors = [];

    if (!isNonEmptyString(String(payload.branchId || ""))) {
        errors.push("branchId is required.");
    }

    if (!isNonEmptyString(String(payload.customerId || ""))) {
        errors.push("customerId is required.");
    }

    if (!isNonEmptyString(String(payload.providerId || ""))) {
        errors.push("providerId is required.");
    }

    if (!isNonEmptyString(String(payload.serviceId || ""))) {
        errors.push("serviceId is required.");
    }

    const scheduledAt = payload.scheduledAt ? new Date(payload.scheduledAt) : null;
    if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
        errors.push("scheduledAt must be a valid date/time.");
    }

    return errors;
};

/**
 * Validate a status-transition request.
 *
 * @param {object} payload Request body.
 * @returns {string[]} List of validation error messages (empty if valid).
 */
const validateUpdateAppointmentStatus = (payload = {}) => {
    const errors = [];

    if (!APPOINTMENT_STATUSES.includes(payload.status)) {
        errors.push(`status must be one of: ${APPOINTMENT_STATUSES.join(", ")}.`);
    }

    return errors;
};

module.exports = {
    APPOINTMENT_STATUSES,
    validateCreateAppointment,
    validateUpdateAppointmentStatus,
};
