/**
 * ============================================================
 * File: permissions.service.js
 * Module: Core Permissions
 *
 * Description:
 * Business logic for permission management.
 * ============================================================
 */

const crypto = require("crypto");
const AppError = require("../../utils/AppError");
const { validateCreatePermission } = require("./permissions.validation");
const permissionsRepository = require("./permissions.repository");

const listPermissions = async (filters = {}) => {
    return permissionsRepository.listPermissions(filters);
};

const createPermission = async (payload) => {
    const validationErrors = validateCreatePermission(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    const permission = await permissionsRepository.createPermission({
        id: crypto.randomUUID(),
        organizationId: payload.organizationId,
        name: payload.name,
        resource: payload.resource,
        action: payload.action,
    });

    return permission;
};

module.exports = {
    listPermissions,
    createPermission,
};
