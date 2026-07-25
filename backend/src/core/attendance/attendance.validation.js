/**
 * ============================================================
 * File: attendance.validation.js
 * Module: Core Attendance
 *
 * Description:
 * Validation rules for attendance endpoints.
 * ============================================================
 */

const { isNonEmptyString } = require("../../utils/validators");

const validateCreateAttendance = (payload = {}) => {
    const errors = [];
    const userId = String(payload.userId || "").trim();
    const organizationId = String(payload.organizationId || "").trim();

    if (!isNonEmptyString(userId)) {
        errors.push("User ID is required.");
    }

    if (!isNonEmptyString(organizationId)) {
        errors.push("Organization ID is required.");
    }

    return errors;
};

const validateKioskToggle = (payload = {}) => {
    const errors = [];

    if (!isNonEmptyString(String(payload.email || "").trim())) {
        errors.push("Email is required.");
    }

    if (!isNonEmptyString(String(payload.password || ""))) {
        errors.push("Password is required.");
    }

    return errors;
};

module.exports = {
    validateCreateAttendance,
    validateKioskToggle,
};
