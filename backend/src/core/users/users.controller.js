/**
 * ============================================================
 * File: users.controller.js
 * Module: Core Users
 *
 * Description:
 * HTTP controller for user endpoints.
 * ============================================================
 */

const crypto = require("crypto");
const asyncHandler = require("../../utils/asyncHandler");
const { success, paginated } = require("../../utils/response");
const { parsePagination, parseSort, buildPageMeta } = require("../../utils/pagination");
const AppError = require("../../utils/AppError");
const { createTemplateHandler, createBulkImportHandler } = require("../../utils/bulkImportHandlers");
const usersService = require("./users.service");
const branchesService = require("../branches/branches.service");
const rolesRepository = require("../roles/roles.repository");

const IMPORT_HEADERS = ["First Name", "Last Name", "Email", "Branch Code", "Role Name"];
const IMPORT_EXAMPLE_ROWS = [
    { "First Name": "Cash", "Last Name": "Ier", Email: "cashier@example.com", "Branch Code": "MAIN", "Role Name": "Cashier" },
];

// Bulk-imported staff get a random temporary password, same as a
// manually-created account with no password typed by hand would need —
// there's deliberately no "Password" column in this template, since
// asking an admin to invent and type real passwords into a spreadsheet
// is the opposite of good practice. Every imported account already
// carries `mustChangePassword: true` (users.repository.createUser sets
// it unconditionally), so the generated password only ever needs to
// work once, for the admin to hand off and the new hire to replace at
// first login — the same flow slice 12 built for manual resets.
const generateTemporaryPassword = () => crypto.randomBytes(9).toString("base64url");

// Not the branch-scoped resolveBranchIdByCode helper — /users isn't a
// branch-scoped resource (no useBranchScopedResource wrapping in
// routes/index.js), and the existing manual "Add staff" form has never
// restricted which branch an admin can assign a new hire to beyond it
// belonging to the same organization. Bulk import shouldn't be stricter
// than the form it's replacing.
const resolveBranchIdForStaff = async (branchCode, req) => {
    const code = String(branchCode || "").trim();
    if (!code) {
        return undefined;
    }

    if (!req._branchIdsByCode) {
        const branches = await branchesService.listBranches({ organizationId: req.user.organizationId });
        req._branchIdsByCode = new Map(branches.map((branch) => [branch.code.toLowerCase(), branch.id]));
    }

    const branchId = req._branchIdsByCode.get(code.toLowerCase());
    if (!branchId) {
        throw new AppError(`No branch found with code "${code}".`, 400);
    }
    return branchId;
};

const resolveRoleIdByName = async (roleName, req) => {
    const name = String(roleName || "").trim();
    if (!name) {
        return undefined;
    }

    if (!req._roleIdsByName) {
        const roles = await rolesRepository.listRoles({ organizationId: req.user.organizationId });
        req._roleIdsByName = new Map(roles.map((role) => [role.name.toLowerCase(), role.id]));
    }

    const roleId = req._roleIdsByName.get(name.toLowerCase());
    if (!roleId) {
        throw new AppError(`No role found named "${name}".`, 400);
    }
    return roleId;
};

const mapImportRow = async (row, req) => ({
    firstName: row["First Name"],
    lastName: row["Last Name"],
    email: row.Email,
    password: generateTemporaryPassword(),
    branchId: await resolveBranchIdForStaff(row["Branch Code"], req),
    roleId: await resolveRoleIdByName(row["Role Name"], req),
    organizationId: req.user.organizationId,
});

const listUsers = asyncHandler(async (req, res) => {
    const pagination = parsePagination(req.query);
    const result = await usersService.listUsers(
        {
            organizationId: req.query.organizationId,
            search: req.query.search,
            pagination,
            sort: parseSort(req.query),
        },
        req.user
    );
    if (pagination) {
        return paginated(res, "Users retrieved successfully.", result.items, buildPageMeta(pagination, result.total));
    }
    return success(res, "Users retrieved successfully.", result, 200);
});

const createUser = asyncHandler(async (req, res) => {
    const user = await usersService.createUser(req.body, req.user);
    return success(res, "User created successfully.", user, 201);
});

const updateUser = asyncHandler(async (req, res) => {
    const user = await usersService.updateUser(req.params.id, req.user.organizationId, req.body, req.user);
    return success(res, "User updated successfully.", user, 200);
});

const resetPassword = asyncHandler(async (req, res) => {
    const user = await usersService.resetPassword(req.params.id, req.user.organizationId, req.body, req.user);
    return success(res, "Password reset successfully.", user, 200);
});

const deleteUser = asyncHandler(async (req, res) => {
    const force = req.query.force === "true" || req.body?.force === true;
    await usersService.deleteUser(req.params.id, req.user.organizationId, req.user.id, force);
    return success(res, "User deleted successfully.", null, 200);
});

const downloadImportTemplate = createTemplateHandler(
    "staff-template.xlsx",
    IMPORT_HEADERS,
    IMPORT_EXAMPLE_ROWS
);

const bulkImportUsers = createBulkImportHandler(mapImportRow, async (payload, req) => {
    const user = await usersService.createUser(payload, req.user);
    // Surfaced only in this import response, to whoever just ran it —
    // the one place the generated password needs to be readable at all,
    // so it can be handed off to the new hire.
    return { ...user, temporaryPassword: payload.password };
});

module.exports = {
    listUsers,
    createUser,
    updateUser,
    resetPassword,
    deleteUser,
    downloadImportTemplate,
    bulkImportUsers,
};
