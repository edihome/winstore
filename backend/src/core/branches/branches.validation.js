/**
 * ============================================================
 * File: branches.validation.js
 * Module: Core Branches
 *
 * Description:
 * Validation rules for branch endpoints.
 * ============================================================
 */

const { isNonEmptyString } = require("../../utils/validators");

const validateCreateBranch = (payload = {}) => {
    const errors = [];
    const name = String(payload.name || "").trim();
    const code = String(payload.code || "").trim();
    const organizationId = String(payload.organizationId || "").trim();

    if (!isNonEmptyString(name)) {
        errors.push("Branch name is required.");
    }

    if (!isNonEmptyString(code)) {
        errors.push("Branch code is required.");
    }

    if (!isNonEmptyString(organizationId)) {
        errors.push("Organization ID is required.");
    }

    return errors;
};

const validateUpdateBranch = (payload = {}) => {
    const errors = [];

    if (payload.name !== undefined && !isNonEmptyString(String(payload.name).trim())) {
        errors.push("Branch name cannot be blank.");
    }

    if (payload.code !== undefined && !isNonEmptyString(String(payload.code).trim())) {
        errors.push("Branch code cannot be blank.");
    }

    if (payload.isHeadquarters !== undefined && typeof payload.isHeadquarters !== "boolean") {
        errors.push("isHeadquarters must be true or false.");
    }

    return errors;
};

module.exports = {
    validateCreateBranch,
    validateUpdateBranch,
};
