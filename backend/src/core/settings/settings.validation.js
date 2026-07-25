/**
 * ============================================================
 * File: settings.validation.js
 * Module: Core Settings
 *
 * Description:
 * Validation rules for settings endpoints.
 * ============================================================
 */

const { isNonEmptyString } = require("../../utils/validators");

const validateCreateSetting = (payload = {}) => {
    const errors = [];
    const key = String(payload.key || "").trim();
    const organizationId = String(payload.organizationId || "").trim();

    if (!isNonEmptyString(key)) {
        errors.push("Setting key is required.");
    }

    if (!isNonEmptyString(organizationId)) {
        errors.push("Organization ID is required.");
    }

    return errors;
};

module.exports = {
    validateCreateSetting,
};
