/**
 * ============================================================
 * File: roles.controller.js
 * Module: Core Roles
 *
 * Description:
 * HTTP controller for role endpoints.
 * ============================================================
 */

const asyncHandler = require("../../utils/asyncHandler");
const { success } = require("../../utils/response");
const rolesService = require("./roles.service");

const getCatalog = asyncHandler(async (req, res) => {
    const catalog = rolesService.getCatalog();
    return success(res, "Module catalog fetched successfully.", catalog, 200);
});

const listRoles = asyncHandler(async (req, res) => {
    const roles = await rolesService.listRoles({ organizationId: req.query.organizationId });
    return success(res, "Roles retrieved successfully.", roles, 200);
});

const createRole = asyncHandler(async (req, res) => {
    const role = await rolesService.createRole(req.body);
    return success(res, "Role created successfully.", role, 201);
});

const updateRole = asyncHandler(async (req, res) => {
    const role = await rolesService.updateRole(req.params.id, req.user.organizationId, req.body);
    return success(res, "Role updated successfully.", role, 200);
});

module.exports = {
    getCatalog,
    listRoles,
    createRole,
    updateRole,
};
