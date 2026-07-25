/**
 * ============================================================
 * File: notifications.validation.js
 * Module: Core Notifications
 *
 * Description:
 * Validation rules for notification endpoints.
 * ============================================================
 */

const { isNonEmptyString } = require("../../utils/validators");

const validateCreateNotification = (payload = {}) => {
    const errors = [];
    const message = String(payload.message || "").trim();
    const organizationId = String(payload.organizationId || "").trim();

    if (!isNonEmptyString(message)) {
        errors.push("Notification message is required.");
    }

    if (!isNonEmptyString(organizationId)) {
        errors.push("Organization ID is required.");
    }

    return errors;
};

module.exports = {
    validateCreateNotification,
};
