/**
 * ============================================================
 * File: isPrivilegedRole.js
 * Module: Shared Utilities
 *
 * Description:
 * Role names that bypass permission checks and branch scoping
 * entirely — "super_admin" (an organization's own owner) and
 * "developer" (a platform operator, who additionally gets cross-
 * organization access to the /organizations endpoints specifically;
 * see routes/index.js). Centralized so every checkpoint that grants
 * this bypass stays in sync — scattering the string comparison across
 * files risks one of them being missed when a new privileged role is
 * added.
 * ============================================================
 */

const PRIVILEGED_ROLES = ["super_admin", "developer"];

const isPrivilegedRole = (role) => PRIVILEGED_ROLES.includes(role);
// Owners keep their permissions, but an activated desktop trades only as its
// installed branch. Head-office web sessions retain organization-wide scope.
const canAccessAllBranches = (role) => isPrivilegedRole(role) && !require("../core/sync/sync.config").get()?.branchId;

module.exports = { PRIVILEGED_ROLES, isPrivilegedRole, canAccessAllBranches };
