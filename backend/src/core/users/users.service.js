/**
 * ============================================================
 * File: users.service.js
 * Module: Core Users
 *
 * Description:
 * Business logic for staff management: creating users, assigning
 * them a branch and role, and activating/deactivating accounts.
 * A deactivated user is rejected at login (see auth.service.login)
 * but keeps their history intact — never deleted.
 * ============================================================
 */

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const pool = require("../../config/db");
const AppError = require("../../utils/AppError");
const { validateCreateUser, validateUpdateUser, validateResetPassword } = require("./users.validation");
const usersRepository = require("./users.repository");
const rolesRepository = require("../roles/roles.repository");
const branchesRepository = require("../branches/branches.repository");
const branchesService = require("../branches/branches.service");
const { isPrivilegedRole } = require("../../utils/isPrivilegedRole");
const { hardDelete } = require("../../utils/hardDelete");
const { conflictError, expectedVersionOf } = require("../../utils/optimisticLock");
const { totalFromRows } = require("../../utils/pagination");

// The sensitive HR/"vital data" fields — only ever attached to the
// response for a privileged viewer (see toUserResponse's includeHr).
const toHrDetails = (row) => ({
    position: row.position || "",
    employmentDate: row.employment_date,
    phone: row.phone || "",
    address: row.address || "",
    dateOfBirth: row.date_of_birth,
    gender: row.gender || "",
    nextOfKin: row.next_of_kin || "",
    nextOfKinPhone: row.next_of_kin_phone || "",
    nationalId: row.national_id || "",
    bankName: row.bank_name || "",
    bankAccountNumber: row.bank_account_number || "",
    salary: row.salary === null || row.salary === undefined ? null : Number(row.salary),
    benefits: row.benefits || "",
});

/**
 * @param {object} row Users row.
 * @param {boolean} includeHr Attach the HR/salary fields — only true for
 *   a super_admin/developer viewer, so ordinary admins never receive
 *   another person's salary/bank details even via the API.
 */
const toUserResponse = (row, includeHr = false) => {
    if (!row) {
        return null;
    }

    const base = {
        id: row.id,
        organizationId: row.organization_id,
        branchId: row.branch_id,
        branchName: row.branch_name,
        roleId: row.role_id,
        roleName: row.role_name,
        roleIsSystem: row.role_is_system || false,
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email,
        isActive: row.is_active,
        mustChangePassword: row.must_change_password || false,
        accessibleBranchIds: row.accessible_branch_ids || [],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        version: row.version,
    };

    return includeHr ? { ...base, hr: toHrDetails(row) } : base;
};

// HR payload keys → the change fields the repository understands. Empty
// text is kept as "" (clears the field); blank dates/salary become null
// (COALESCE leaves them unchanged rather than erroring on a bad cast).
const HR_TEXT_KEYS = ["position", "phone", "address", "gender", "nextOfKin", "nextOfKinPhone", "nationalId", "bankName", "bankAccountNumber", "benefits"];
const extractHrChanges = (payload = {}) => {
    const changes = {};
    for (const key of HR_TEXT_KEYS) {
        if (payload[key] !== undefined) changes[key] = String(payload[key]);
    }
    if (payload.employmentDate !== undefined) changes.employmentDate = payload.employmentDate || null;
    if (payload.dateOfBirth !== undefined) changes.dateOfBirth = payload.dateOfBirth || null;
    if (payload.salary !== undefined) {
        changes.salary = payload.salary === "" || payload.salary === null ? null : Number(payload.salary);
    }
    return changes;
};

const assertRoleBelongsToOrganization = async (roleId, organizationId) => {
    const role = await rolesRepository.findRoleById(roleId, organizationId);
    if (!role) {
        throw new AppError("The selected role was not found.", 400);
    }
    return role;
};

/**
 * Role-assignment guard: holding users:manage lets an admin add staff,
 * but must never be a ladder above their own rung. Only a super admin
 * (or a developer) may put someone on a system role — that's the one
 * sanctioned "upgrade a user to super admin" path — and the reserved
 * "developer" platform role can only ever be assigned by a developer
 * (role NAMES carry privilege; see utils/isPrivilegedRole.js).
 *
 * @param {object} role Role row (name, is_system).
 * @param {object} actingUser req.user of whoever is assigning it.
 */
const assertRoleAssignable = (role, actingUser) => {
    if (role.name === "developer" && actingUser.role !== "developer") {
        throw new AppError("Only a developer can assign the developer role.", 403);
    }

    if (role.is_system && !isPrivilegedRole(actingUser.role)) {
        throw new AppError("Only a super admin can assign this role.", 403);
    }
};

/**
 * Branch ids the acting user may manage staff in: null (no restriction)
 * for privileged roles, otherwise exactly the branches a super admin
 * assigned to them — an admin's reach over staff is bounded the same
 * way their reach over sales or expenses already is.
 *
 * @param {object} actingUser req.user of whoever is acting.
 * @returns {Promise<string[]|null>} Branch ids, or null for unrestricted.
 */
const getActingBranchIds = async (actingUser) => {
    if (isPrivilegedRole(actingUser.role)) {
        return null;
    }

    const primaryBranch = actingUser.branchId ? { id: actingUser.branchId } : null;
    const branches = await branchesService.getAccessibleBranchesForUser(actingUser.id, primaryBranch);
    return branches.map((branch) => branch.id);
};

/**
 * Reject any staff branch assignment that reaches outside the acting
 * admin's own branches. Privileged actors (actingBranchIds === null)
 * are unrestricted; everyone else must place staff in a branch they
 * manage — never "no branch", which would float the account outside
 * every branch boundary the admin themselves is held to.
 *
 * @param {string[]} branchIds The target user's resolved branch ids.
 * @param {string[]|null} actingBranchIds From getActingBranchIds.
 */
const assertBranchesWithinActingScope = (branchIds, actingBranchIds) => {
    if (actingBranchIds === null) {
        return;
    }

    if (branchIds.length === 0) {
        throw new AppError("Staff must be assigned to one of your branches.", 403);
    }

    if (branchIds.some((id) => !actingBranchIds.includes(id))) {
        throw new AppError("You can only manage staff in branches assigned to you.", 403);
    }
};

/**
 * Guard for acting on an EXISTING user: a system-role account (the
 * organization's owner) is off-limits to non-privileged actors, a
 * developer account is off-limits to everyone but a developer, and an
 * admin can only reach staff whose branch is one of their own.
 *
 * @param {object} existing Target user row (role_name, role_is_system, branch_id).
 * @param {object} actingUser req.user of whoever is acting.
 * @param {string[]|null} actingBranchIds From getActingBranchIds.
 */
const assertTargetUserManageable = (existing, actingUser, actingBranchIds) => {
    if (existing.role_name === "developer" && actingUser.role !== "developer") {
        throw new AppError("Developer accounts can only be managed by a developer.", 403);
    }

    if (actingBranchIds === null) {
        return;
    }

    if (existing.role_is_system) {
        throw new AppError("This user's role is protected.", 403);
    }

    if (!existing.branch_id || !actingBranchIds.includes(existing.branch_id)) {
        throw new AppError("You can only manage staff in branches assigned to you.", 403);
    }
};

const assertBranchBelongsToOrganization = async (branchId, organizationId) => {
    const branch = await branchesRepository.findBranchById(branchId, organizationId);
    if (!branch) {
        throw new AppError("The selected branch was not found.", 400);
    }
};

/**
 * Validate every submitted branch id and fold the user's primary branch
 * into the set, so a primary branch is always implicitly accessible —
 * the admin never has to remember to also check its box.
 *
 * @param {string[]} branchIds Submitted "additional access" branch ids.
 * @param {string} primaryBranchId The user's branchId, if any.
 * @param {string} organizationId Organization scope.
 * @returns {Promise<string[]>} Deduplicated, validated branch ids.
 */
const resolveAccessibleBranchIds = async (branchIds, primaryBranchId, organizationId) => {
    const candidates = Array.from(new Set([primaryBranchId, ...(branchIds || [])].filter(Boolean)));

    for (const branchId of candidates) {
        await assertBranchBelongsToOrganization(branchId, organizationId);
    }

    return candidates;
};

const listUsers = async (filters = {}, actingUser) => {
    // Admins only ever see staff of branches assigned to them; privileged
    // roles (branchIds null) see the whole organization.
    const branchIds = await getActingBranchIds(actingUser);
    // Only a super_admin/developer receives the HR/salary fields.
    const includeHr = isPrivilegedRole(actingUser.role);
    // Non-privileged callers manage floor staff only — a system-role account
    // (the owner, a developer) isn't theirs to see or act on (every Staff-page
    // action on it would be refused anyway; see assertTargetUserManageable).
    // Filtered in SQL so paginated totals/pages stay correct.
    const excludeSystemRoles = branchIds !== null;
    const rows = await usersRepository.listUsers({ ...filters, branchIds, excludeSystemRoles });
    const users = rows.map((row) => toUserResponse(row, includeHr));

    if (filters.pagination) {
        return { items: users, total: totalFromRows(rows) };
    }
    return users;
};

const createUser = async (payload, actingUser) => {
    const validationErrors = validateCreateUser(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    const existing = await usersRepository.findUserByEmail(payload.email.trim());
    if (existing) {
        throw new AppError("A user with this email already exists.", 409);
    }

    if (payload.roleId) {
        const role = await assertRoleBelongsToOrganization(payload.roleId, payload.organizationId);
        assertRoleAssignable(role, actingUser);
    }

    const accessibleBranchIds = await resolveAccessibleBranchIds(
        payload.branchIds,
        payload.branchId,
        payload.organizationId
    );

    const actingBranchIds = await getActingBranchIds(actingUser);
    assertBranchesWithinActingScope(accessibleBranchIds, actingBranchIds);

    const passwordHash = await bcrypt.hash(payload.password, 12);
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const user = await usersRepository.createUser(
            {
                id: crypto.randomUUID(),
                organizationId: payload.organizationId,
                branchId: payload.branchId || null,
                roleId: payload.roleId || null,
                firstName: payload.firstName.trim(),
                lastName: payload.lastName.trim(),
                email: payload.email.trim(),
                passwordHash,
                isActive: true,
            },
            client
        );

        if (accessibleBranchIds.length > 0) {
            await branchesRepository.setUserBranches(user.id, accessibleBranchIds, client);
        }

        await client.query("COMMIT");

        const created = await usersRepository.findUserById(user.id, payload.organizationId);
        return toUserResponse(created);
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
};

const updateUser = async (id, organizationId, payload, actingUser) => {
    const validationErrors = validateUpdateUser(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    const existing = await usersRepository.findUserById(id, organizationId);
    if (!existing) {
        throw new AppError("User not found.", 404);
    }

    const actingBranchIds = await getActingBranchIds(actingUser);
    assertTargetUserManageable(existing, actingUser, actingBranchIds);

    if (payload.roleId) {
        const role = await assertRoleBelongsToOrganization(payload.roleId, organizationId);
        assertRoleAssignable(role, actingUser);
    }

    // HR/"vital data" (salary, benefits, bank, next of kin, …) is
    // editable ONLY by a super_admin/developer. An ordinary admin's HR
    // fields in the payload are ignored — they can manage staff but never
    // touch salary or the other sensitive details.
    const privileged = isPrivilegedRole(actingUser.role);
    const hrChanges = privileged ? extractHrChanges(payload) : {};

    // The primary branch this update settles on: the new one if changing
    // it, otherwise whatever the user already has.
    const effectivePrimaryBranchId = payload.branchId !== undefined ? payload.branchId : existing.branch_id;
    const branchAccessChanged = payload.branchId !== undefined || payload.branchIds !== undefined;
    const accessibleBranchIds = branchAccessChanged
        ? await resolveAccessibleBranchIds(payload.branchIds, effectivePrimaryBranchId, organizationId)
        : null;

    if (accessibleBranchIds !== null) {
        assertBranchesWithinActingScope(accessibleBranchIds, actingBranchIds);
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const updatedRow = await usersRepository.updateUser(
            id,
            organizationId,
            {
                firstName: payload.firstName !== undefined ? String(payload.firstName).trim() : undefined,
                lastName: payload.lastName !== undefined ? String(payload.lastName).trim() : undefined,
                branchId: payload.branchId,
                roleId: payload.roleId,
                isActive: payload.isActive,
                ...hrChanges,
            },
            expectedVersionOf(payload),
            client
        );

        // Existed a moment ago (checked above), so an empty result means the
        // version guard caught a concurrent change — roll back and report it.
        if (!updatedRow) {
            throw conflictError();
        }

        if (accessibleBranchIds !== null) {
            await branchesRepository.setUserBranches(id, accessibleBranchIds, client);
        }

        // Deactivating a user must end their live sessions immediately,
        // not merely block the next login — bump their token_version so
        // the per-request guard rejects any token they already hold.
        if (payload.isActive === false && existing.is_active) {
            await usersRepository.bumpTokenVersion(id, organizationId, client);
        }

        await client.query("COMMIT");

        const updated = await usersRepository.findUserById(id, organizationId);
        return toUserResponse(updated, privileged);
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
};

/**
 * Admin-driven password reset: sets a new password for another user
 * without knowing their current one. Deliberately refused for a user
 * whose role is the system admin role — a lower-privileged holder of
 * "users:manage" resetting a co-admin's password out from under them
 * would be a privilege-escalation path, the same class of risk slice 10
 * closed for editing the system role itself. The admin's own password
 * always goes through the self-service change-password flow instead,
 * which proves they still know the current one.
 *
 * @param {string} id Target user ID.
 * @param {string} organizationId Acting user's organization ID.
 * @param {object} payload { newPassword }.
 * @returns {Promise<object>} Updated user.
 */
const resetPassword = async (id, organizationId, payload, actingUser) => {
    const validationErrors = validateResetPassword(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    const existing = await usersRepository.findUserById(id, organizationId);
    if (!existing) {
        throw new AppError("User not found.", 404);
    }

    if (existing.role_is_system) {
        throw new AppError("This user's role is protected — they must change their own password.", 409);
    }

    const actingBranchIds = await getActingBranchIds(actingUser);
    assertTargetUserManageable(existing, actingUser, actingBranchIds);

    const passwordHash = await bcrypt.hash(payload.newPassword, 12);
    await usersRepository.updatePasswordHash(id, organizationId, passwordHash);
    // An admin reset also revokes the target's existing sessions — the
    // old password (and any token minted under it) stops working at once,
    // and their next login carries the forced-change flag.
    await usersRepository.bumpTokenVersion(id, organizationId);

    const updated = await usersRepository.findUserById(id, organizationId);
    return toUserResponse(updated);
};

/**
 * Developer-only hard delete — see backend/src/utils/hardDelete.js.
 * Every other role only ever gets activate/deactivate via updateUser.
 * Two guards no `force` flag can override: an account can't delete
 * itself (locking the acting user out mid-request), and a system-role
 * account is protected the same way resetPassword already refuses it —
 * a lower-privileged holder of "users:manage" removing a co-admin
 * outright would be the same privilege-escalation risk.
 *
 * @param {string} id Target user ID.
 * @param {string} organizationId Acting user's organization ID.
 * @param {string} actingUserId The user performing the delete.
 * @param {boolean} force Cascade through dependents instead of blocking.
 * @returns {Promise<void>}
 */
const deleteUser = async (id, organizationId, actingUserId, force = false) => {
    const existing = await usersRepository.findUserById(id, organizationId);
    if (!existing) {
        throw new AppError("User not found.", 404);
    }

    if (id === actingUserId) {
        throw new AppError("You cannot delete your own account.", 400);
    }

    if (existing.role_is_system) {
        throw new AppError("This user's role is protected and cannot be deleted.", 409);
    }

    await hardDelete({ table: "users", id, force });
};

module.exports = {
    listUsers,
    createUser,
    updateUser,
    resetPassword,
    deleteUser,
};
