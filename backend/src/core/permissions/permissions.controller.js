/**
 * ============================================================
 * File: permissions.controller.js
 * Module: Core Permissions
 *
 * Description:
 * HTTP controller for permission endpoints.
 * ============================================================
 */

const asyncHandler = require("../../utils/asyncHandler");
const { success } = require("../../utils/response");
const permissionsService = require("./permissions.service");

const listPermissions = asyncHandler(async (req, res) => {
    const permissions = await permissionsService.listPermissions(req.query);
    return success(res, "Permissions retrieved successfully.", permissions, 200);
});

const createPermission = asyncHandler(async (req, res) => {
    const permission = await permissionsService.createPermission(req.body);
    return success(res, "Permission created successfully.", permission, 201);
});

module.exports = {
    listPermissions,
    createPermission,
};
