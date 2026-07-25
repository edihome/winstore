/**
 * ============================================================
 * File: isAdminUser.js
 * Module: Shared Utilities
 *
 * Description:
 * Is this request's user an "admin" — the organization owner/developer, or
 * someone holding an administration-area grant (managing users, roles, or
 * branches)? Used to gate sensitive actions that baseline staff shouldn't do
 * even though they hold the resource's normal grant (e.g. writing off a
 * customer's balance, or setting a customer's credit limit). Mirrors the
 * frontend's isAdmin check in AppLayout.
 * ============================================================
 */

const { isPrivilegedRole } = require("./isPrivilegedRole");

const ADMIN_PERMISSIONS = ["users:manage", "roles:manage", "branches:manage"];

const isAdminUser = (user) =>
    Boolean(user) &&
    (isPrivilegedRole(user.role) || ADMIN_PERMISSIONS.some((permission) => (user.permissions || []).includes(permission)));

module.exports = { isAdminUser };
