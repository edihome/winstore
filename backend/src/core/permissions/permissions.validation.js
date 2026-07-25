/**
 * ============================================================
 * File: permissions.validation.js
 * Module: Core Permissions
 *
 * Description:
 * Validation rules for permission endpoints.
 * ============================================================
 */

const { isNonEmptyString } = require("../../utils/validators");

const validateCreatePermission = (payload = {}) => {
    const errors = [];
    const name = String(payload.name || "").trim();
    const resource = String(payload.resource || "").trim();
    const action = String(payload.action || "").trim();
    const organizationId = String(payload.organizationId || "").trim();

    if (!isNonEmptyString(name)) {
        errors.push("Permission name is required.");
    }

    if (!isNonEmptyString(resource)) {
        errors.push("Permission resource is required.");
    }

    if (!isNonEmptyString(action)) {
        errors.push("Permission action is required.");
    }

    if (!isNonEmptyString(organizationId)) {
        errors.push("Organization ID is required.");
    }

    return errors;
};

module.exports = {
    validateCreatePermission,
};
