/**
 * ============================================================
 * File: audit.validation.js
 * Module: Core Audit
 *
 * Description:
 * Validation rules for audit log endpoints.
 * ============================================================
 */

const { isNonEmptyString } = require("../../utils/validators");

const validateCreateAuditLog = (payload = {}) => {
    const errors = [];
    const action = String(payload.action || "").trim();
    const organizationId = String(payload.organizationId || "").trim();

    if (!isNonEmptyString(action)) {
        errors.push("Audit action is required.");
    }

    if (!isNonEmptyString(organizationId)) {
        errors.push("Organization ID is required.");
    }

    return errors;
};

module.exports = {
    validateCreateAuditLog,
};
