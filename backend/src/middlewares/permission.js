/**
 * ============================================================
 * File: permission.js
 * Module: Middlewares
 *
 * Description:
 * Permission-based authorization middleware.
 * ============================================================
 */

const { isPrivilegedRole } = require("../utils/isPrivilegedRole");
const { isBaselinePermission } = require("../core/permissions/permissions.catalog");

/**
 * Check whether the authenticated user has one of the required permissions.
 *
 * Grants in three tiers: privileged roles (super_admin/developer) pass
 * everything; then the BASELINE every organization member holds — add
 * customers, offer services, make sales, book appointments, and the
 * reads those need — checked against the fixed catalog rather than the
 * session token, so a baseline capability can never be missing from an
 * already-issued token and a baseline change needs no re-login; finally,
 * the role's own explicit grants carried on the token.
 *
 * @param {object} user Authenticated user object.
 * @param {string[]} requiredPermissions Allowed permission names.
 * @returns {boolean} True when the user is authorized.
 */
const userHasPermission = (user = {}, requiredPermissions = []) => {
    if (isPrivilegedRole(user.role)) {
        return true;
    }

    if (requiredPermissions.some(isBaselinePermission)) {
        return true;
    }

    const permissions = user.permissions || [];
    return requiredPermissions.some((permission) => permissions.includes(permission));
};

/**
 * Require a single permission.
 *
 * @param {string} requiredPermission Permission name.
 * @returns {Function} Express middleware.
 */
const requirePermission = (requiredPermission) => (req, res, next) => {
    const user = req.user || {};

    if (!userHasPermission(user, [requiredPermission])) {
        return res.status(403).json({
            success: false,
            message: "You do not have permission to perform this action.",
            errors: [],
        });
    }

    return next();
};

/**
 * Require at least one permission from a list.
 *
 * @param {string[]} requiredPermissions Permission names.
 * @returns {Function} Express middleware.
 */
const requireAnyPermission = (requiredPermissions = []) => (req, res, next) => {
    const user = req.user || {};

    if (!userHasPermission(user, requiredPermissions)) {
        return res.status(403).json({
            success: false,
            message: "You do not have permission to perform this action.",
            errors: [],
        });
    }

    return next();
};

/**
 * Require an exact role name — used for the "developer" platform role,
 * which isn't a per-organization permission grant at all (it's cross-
 * organization access to /organizations specifically), so the regular
 * resource/permission checks don't apply to it.
 *
 * @param {string} role Exact role name required.
 * @returns {Function} Express middleware.
 */
const requireRole = (role) => (req, res, next) => {
    if (req.user?.role !== role) {
        return res.status(403).json({
            success: false,
            message: "You do not have permission to perform this action.",
            errors: [],
        });
    }

    return next();
};

/**
 * Require one of several exact role names — same idea as requireRole,
 * for the endpoints that belong to a class of roles rather than one
 * (e.g. /subscription is for an organization's own super_admin, and a
 * developer inspecting their own org).
 *
 * @param {string[]} roles Accepted role names.
 * @returns {Function} Express middleware.
 */
const requireAnyRole = (roles = []) => (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
        return res.status(403).json({
            success: false,
            message: "You do not have permission to perform this action.",
            errors: [],
        });
    }

    return next();
};

module.exports = {
    requirePermission,
    requireAnyPermission,
    requireRole,
    requireAnyRole,
    userHasPermission,
};
