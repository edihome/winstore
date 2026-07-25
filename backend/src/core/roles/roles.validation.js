/**
 * ============================================================
 * File: roles.validation.js
 * Module: Core Roles
 *
 * Description:
 * Validation rules for role endpoints.
 * ============================================================
 */

const { isNonEmptyString } = require("../../utils/validators");
const { MODULE_RESOURCE_VALUES, isValidPermission } = require("../permissions/permissions.catalog");
const { PRIVILEGED_ROLES } = require("../../utils/isPrivilegedRole");

// Reserved: middlewares/permission.js (via isPrivilegedRole) grants full
// access to any user whose ROLE NAME (not just is_system) is one of
// PRIVILEGED_ROLES — a staff-created role with one of these exact names
// would be a silent privilege-escalation bug, not a feature, so they're
// off-limits for anything created through this API. "developer" also
// gets cross-organization access to /organizations (see routes/index.js);
// provisioning one happens outside this API — see scripts/create-developer.js.
const RESERVED_ROLE_NAMES = PRIVILEGED_ROLES;

const validateResources = (resources) => {
    const errors = [];

    if (resources === undefined) {
        return errors;
    }

    if (!Array.isArray(resources)) {
        errors.push("resources must be an array of module keys.");
        return errors;
    }

    const invalid = resources.filter((resource) => !MODULE_RESOURCE_VALUES.includes(resource));
    if (invalid.length > 0) {
        errors.push(`Unknown module(s): ${invalid.join(", ")}.`);
    }

    return errors;
};

// Fine-grained grants: an array of "resource:action" strings from the matrix.
const validatePermissions = (permissions) => {
    const errors = [];
    if (permissions === undefined) {
        return errors;
    }
    if (!Array.isArray(permissions)) {
        errors.push("permissions must be an array of \"resource:action\" strings.");
        return errors;
    }
    const invalid = permissions.filter((permission) => !isValidPermission(permission));
    if (invalid.length > 0) {
        errors.push(`Unknown permission(s): ${invalid.join(", ")}.`);
    }
    return errors;
};

const validateCreateRole = (payload = {}) => {
    const errors = [];
    const name = String(payload.name || "").trim();
    const organizationId = String(payload.organizationId || "").trim();

    if (!isNonEmptyString(name)) {
        errors.push("Role name is required.");
    } else if (RESERVED_ROLE_NAMES.includes(name.toLowerCase())) {
        errors.push(`"${name.toLowerCase()}" is a reserved role name.`);
    }

    if (!isNonEmptyString(organizationId)) {
        errors.push("Organization ID is required.");
    }

    errors.push(...validateResources(payload.resources));
    errors.push(...validatePermissions(payload.permissions));

    return errors;
};

const validateUpdateRole = (payload = {}) => {
    const errors = [];

    if (payload.name !== undefined) {
        const name = String(payload.name).trim();
        if (!isNonEmptyString(name)) {
            errors.push("Role name cannot be empty.");
        } else if (RESERVED_ROLE_NAMES.includes(name.toLowerCase())) {
            errors.push(`"${name.toLowerCase()}" is a reserved role name.`);
        }
    }

    errors.push(...validateResources(payload.resources));
    errors.push(...validatePermissions(payload.permissions));

    return errors;
};

module.exports = {
    RESERVED_ROLE_NAMES,
    validateCreateRole,
    validateUpdateRole,
};
