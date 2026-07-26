/**
 * ============================================================
 * File: auth.service.js
 * Module: Core Auth
 *
 * Description:
 * Business logic for account registration and authentication.
 * ============================================================
 */

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const pool = require("../../config/db");
const env = require("../../config/env");
const logger = require("../../config/logger");
const AppError = require("../../utils/AppError");
const authRepository = require("./auth.repository");
const permissionsRepository = require("../permissions/permissions.repository");
const branchesService = require("../branches/branches.service");
const {
    MODULE_CATALOG,
    MODULE_ACTION,
    BASELINE_RESOURCES,
    BASELINE_READ_RESOURCES,
} = require("../permissions/permissions.catalog");
const settingsRepository = require("../settings/settings.repository");
const auditRepository = require("../audit/audit.repository");
const syncService = require("../sync/sync.service");
const { computeSubscriptionStanding } = require("../organizations/organizations.service");
const { validateLogin, validateRegister, validateChangePassword } = require("./auth.validation");

/**
 * Sign a session JWT for a user row (as returned by
 * authRepository.findUserByEmail/findUserById) plus their resolved
 * permission strings. Shared by login and changePassword — the latter
 * re-issues a token so a cleared must_change_password flag takes effect
 * immediately, instead of the stale claim from the token they logged in
 * with blocking every other route until their next login.
 *
 * @param {object} user User row with id/email/role_name/organization_id/branch_id/must_change_password.
 * @param {string[]} permissions Resolved "<resource>:<action>" strings.
 * @returns {string} Signed JWT.
 */
const buildSessionToken = (user, permissions, subscriptionLocked = false) =>
    jwt.sign(
        {
            sub: user.id,
            email: user.email,
            role: user.role_name || "user",
            organizationId: user.organization_id,
            branchId: user.branch_id,
            permissions,
            mustChangePassword: user.must_change_password,
            // Bound to users.token_version — the per-request session guard
            // (middlewares/sessionGuard.js) rejects the token once this no
            // longer matches the row, so bumping the column logs the user
            // out everywhere. Defaults to 0 for the registration path,
            // where the row is created at version 0.
            tokenVersion: user.token_version ?? 0,
            // Set for a super_admin logging in after their subscription
            // (and grace period) ran out: the session exists only to see
            // the renewal notice and the Subscription page — every other
            // route refuses it (see middlewares/auth.js).
            subscriptionLocked,
        },
        env.JWT_SECRET,
        { expiresIn: "8h" }
    );

/**
 * Decide what an expired subscription (or a deactivated organization)
 * means for this user's session — the enforcement the alert banner
 * promises. Evaluated at login and on every /auth/me refresh, so a
 * lapse takes effect no later than the next page load:
 *
 *  - developer: never affected — the platform operator must always be
 *    able to reach the Platform screen to fix a tenant's subscription.
 *  - organization "inactive" (the developer's Deactivate toggle) and
 *    subscription "expired" (past expiry AND past the grace period)
 *    carry the SAME consequence: staff are refused outright; the
 *    super_admin may still sign in but the session is LOCKED to the
 *    renewal-info routes only (see buildSessionToken /
 *    middlewares/auth.js) — they're the one person who needs to get in
 *    to see what restoring access takes.
 *  - "in_grace" and everything before it: full access; the banner
 *    (buildSubscriptionAlert) does the nagging.
 *
 * @param {object} user User row with role_name/organization_status/subscription fields.
 * @returns {{blocked: boolean, locked: boolean, message: string|null}}
 */
const resolveSubscriptionEnforcement = (user) => {
    if (user.role_name === "developer") {
        return { blocked: false, locked: false, message: null };
    }

    if (user.organization_status === "inactive") {
        if (user.role_name === "super_admin") {
            return {
                blocked: false,
                locked: true,
                message: "Your organization's account has been deactivated. Access is limited until it is reactivated.",
            };
        }
        return {
            blocked: true,
            locked: false,
            message: "This organization's account has been deactivated. Please contact your administrator.",
        };
    }

    const standing = computeSubscriptionStanding(user);
    if (standing && standing.status === "expired") {
        if (user.role_name === "super_admin") {
            return {
                blocked: false,
                locked: true,
                message: "Your subscription has expired. Access is limited until it is renewed.",
            };
        }
        return {
            blocked: true,
            locked: false,
            message: "This organization's subscription has expired. Please contact your administrator.",
        };
    }

    return { blocked: false, locked: false, message: null };
};

/**
 * Resolve the permission strings a session should carry: the role's own
 * grants plus the baseline modules every organization member gets
 * regardless of role (add customers, offer services, make sales — see
 * BASELINE_RESOURCES). The developer platform role is excluded from the
 * baseline: it isn't an organization member doing floor work, and it
 * bypasses permission checks anyway (see utils/isPrivilegedRole.js).
 *
 * @param {object} user User row with role_id/role_name.
 * @returns {Promise<string[]>} "<resource>:<action>" strings.
 */
const resolvePermissionsForUser = async (user) => {
    const permissionRows = await permissionsRepository.getPermissionsByRoleId(user.role_id);
    const permissions = permissionRows.map((row) => `${row.resource}:${row.action}`);

    if (user.role_name === "developer") {
        return permissions;
    }

    const baseline = BASELINE_RESOURCES.map((resource) => `${resource}:${MODULE_ACTION}`);
    // Read-only grants so the baseline "make a sale" job can actually
    // load the product catalog, discounts, taxes, and billable
    // appointments it depends on — see BASELINE_READ_RESOURCES.
    const baselineRead = BASELINE_READ_RESOURCES.map((resource) => `${resource}:read`);
    return Array.from(new Set([...permissions, ...baseline, ...baselineRead]));
};

const slugify = (value) =>
    String(value)
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "organization";

/**
 * Build the "your subscription is about to expire" alert shown to a
 * tenant's own super_admin at login (and on every /auth/me refresh
 * within that session — see AuthContext.jsx's dismissal handling on
 * the frontend). Only ever computed for super_admin: staff accounts
 * aren't the ones responsible for renewing, and the developer platform
 * role isn't a paying tenant. Silent (returns null) while comfortably
 * within the active period — see organizations.service.computeSubscriptionStanding
 * for the actual date math shared with the developer's Platform list.
 *
 * @param {object} user User row (as returned by authRepository.findUserByEmail/findUserById).
 * @returns {object|null} { level, message, daysRemaining } or null.
 */
const buildSubscriptionAlert = (user) => {
    if (user.role_name !== "super_admin") {
        return null;
    }

    const standing = computeSubscriptionStanding(user);
    if (!standing || standing.status === "active") {
        return null;
    }

    const expiresOn = new Date(standing.expiresAt).toLocaleDateString();

    if (standing.status === "expiring_soon") {
        return {
            level: "warning",
            daysRemaining: standing.daysRemaining,
            message: `Your subscription expires in ${standing.daysRemaining} day${standing.daysRemaining === 1 ? "" : "s"} (${expiresOn}). Please renew soon to avoid interruption.`,
        };
    }

    if (standing.status === "in_grace") {
        return {
            level: "critical",
            daysRemaining: standing.graceDaysRemaining,
            message: `Your subscription expired on ${expiresOn}. You have ${standing.graceDaysRemaining} grace day${standing.graceDaysRemaining === 1 ? "" : "s"} left before access may be affected.`,
        };
    }

    // status === "expired": past both the expiration date and the grace period.
    return {
        level: "expired",
        daysRemaining: 0,
        message: `Your subscription (and grace period) expired on ${expiresOn}. Please contact support to renew.`,
    };
};

/**
 * Default settings created for every new organization at registration time.
 * Matches the documented registration transaction, which includes a
 * "Create Settings" step before COMMIT.
 */
const DEFAULT_SETTINGS = [
    { key: "currency", value: "NGN" },
    { key: "timezone", value: "Africa/Lagos" },
    { key: "date_format", value: "DD/MM/YYYY" },
];

const register = async (payload) => {
    const validationErrors = validateRegister(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    // Registration creates a brand-new organization before any tenant
    // context could exist, so the whole thing runs with row level security
    // bypassed (see config/db.runPrivileged).
    return pool.runPrivileged(async () => {
    const existingUser = await authRepository.findUserByEmail(payload.email);
    if (existingUser) {
        throw new AppError("An account with this email already exists.", 409);
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const organizationId = crypto.randomUUID();
        const branchId = crypto.randomUUID();
        const roleId = crypto.randomUUID();
        const adminId = crypto.randomUUID();

        const organization = await authRepository.createOrganization(
            {
                id: organizationId,
                name: payload.organizationName,
                slug: slugify(payload.organizationSlug || payload.organizationName),
                status: "active",
            },
            client
        );

        const branch = await authRepository.createBranch(
            {
                id: branchId,
                organizationId,
                name: payload.branchName || "Main Branch",
                code: payload.branchCode || "MAIN",
                isHeadquarters: true,
            },
            client
        );

        // Always "super_admin" — never caller-supplied. Role NAMES carry
        // privilege here (see utils/isPrivilegedRole.js), so honoring a
        // submitted roleName would let a public registration name its owner
        // role "developer" and self-provision cross-organization access.
        const role = await authRepository.createRole(
            {
                id: roleId,
                organizationId,
                name: "super_admin",
                description: "System administrator",
                isSystem: true,
            },
            client
        );

        // Every protected module gets a "<resource>:manage" permission,
        // all granted to the admin role — the full catalog, not just the
        // admin-only subset, so the Roles UI can offer every module as a
        // checkbox to every organization from day one.
        for (const { resource } of MODULE_CATALOG) {
            const permission = await authRepository.createPermission(
                {
                    id: crypto.randomUUID(),
                    organizationId,
                    name: `${resource}:${MODULE_ACTION}`,
                    resource,
                    action: MODULE_ACTION,
                },
                client
            );

            // Link the permission to the admin role so it actually takes effect
            // at login (see permissions.repository.getPermissionsByRoleId).
            // Without this step the role exists but grants nothing.
            await authRepository.linkRolePermission(
                {
                    id: crypto.randomUUID(),
                    roleId,
                    permissionId: permission.id,
                },
                client
            );
        }

        const passwordHash = await bcrypt.hash(payload.password, 12);

        const user = await authRepository.createUser(
            {
                id: adminId,
                organizationId,
                branchId,
                roleId,
                firstName: payload.firstName,
                lastName: payload.lastName,
                email: payload.email,
                passwordHash,
                isActive: true,
            },
            client
        );

        // Create Settings — documented as part of the registration transaction.
        for (const setting of DEFAULT_SETTINGS) {
            await settingsRepository.createSetting(
                {
                    id: crypto.randomUUID(),
                    organizationId,
                    key: setting.key,
                    value: setting.value,
                },
                client
            );
        }

        await auditRepository.createAuditLog(
            {
                id: crypto.randomUUID(),
                organizationId,
                userId: adminId,
                action: "organization.registered",
                entityType: "organization",
                entityId: organizationId,
                metadata: { branchId, roleId },
            },
            client
        );

        await client.query("COMMIT");

        return {
            organization,
            branch,
            role,
            user,
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
    });
};

const login = async (payload) => {
    const validationErrors = validateLogin(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    // Login looks a user up by email across ALL organizations (there is no
    // tenant context yet), so it runs with row level security bypassed.
    return pool.runPrivileged(async () => {
    const user = await authRepository.findUserByEmail(payload.email);
    if (!user) {
        throw new AppError("Invalid email or password.", 401);
    }

    if (!user.is_active) {
        throw new AppError("This account has been deactivated.", 403);
    }

    // Offline branch, first login for this user: the snapshot never shipped
    // password hashes, so cache this user's hash from the hub NOW (only after
    // the hub confirms the password) — then offline logins work thereafter.
    let passwordHash = user.password_hash;
    if (!passwordHash) {
        let fetched;
        try {
            fetched = await syncService.fetchCredentialFromHub(payload.email, payload.password);
        } catch {
            throw new AppError("This device needs an internet connection the first time you sign in here. Connect and try again.", 503);
        }
        if (!fetched) {
            throw new AppError("Invalid email or password.", 401);
        }
        passwordHash = fetched;
    }

    const isPasswordValid = await bcrypt.compare(payload.password, passwordHash);
    if (!isPasswordValid) {
        throw new AppError("Invalid email or password.", 401);
    }

    const enforcement = resolveSubscriptionEnforcement(user);
    if (enforcement.blocked) {
        throw new AppError(enforcement.message, 403);
    }

    // Load the role's actual permissions so req.user.permissions is populated
    // for every request, not just for the "super_admin" role-name bypass.
    const permissions = await resolvePermissionsForUser(user);

    const primaryBranch = user.branch_id
        ? { id: user.branch_id, name: user.branch_name, code: user.branch_code }
        : null;
    const accessibleBranches = await branchesService.getAccessibleBranchesForUser(user.id, primaryBranch);

    const token = buildSessionToken(user, permissions, enforcement.locked);

    // Attendance (staff physically arriving/leaving the store) is tracked
    // separately from logging into the software — see the "Attendance"
    // action on the login screen and attendanceService.kioskToggle.
    // Signing into the dashboard is not itself a movement event.

    try {
        await auditRepository.createAuditLog({
            id: crypto.randomUUID(),
            organizationId: user.organization_id,
            userId: user.id,
            action: "user.login",
            entityType: "user",
            entityId: user.id,
            metadata: {},
        });
    } catch (error) {
        logger.warn("Failed to write login audit log", { message: error.message });
    }

    return {
        token,
        user: {
            id: user.id,
            firstName: user.first_name,
            lastName: user.last_name,
            email: user.email,
            organizationId: user.organization_id,
            branchId: user.branch_id,
            role: user.role_name,
            permissions,
            mustChangePassword: user.must_change_password,
            subscriptionLocked: enforcement.locked,
            accessibleBranches,
            subscriptionAlert: buildSubscriptionAlert(user),
        },
    };
    });
};

/**
 * Build the profile returned by GET /auth/me for the dashboard shell.
 *
 * @param {string} userId Authenticated user's ID (from the JWT subject).
 * @returns {Promise<object>} User profile with organization/branch/role context.
 */
const me = async (userId) => {
    const user = await authRepository.findUserById(userId);
    if (!user) {
        throw new AppError("User not found.", 404);
    }

    // Re-evaluated on every profile fetch, not just at login — a
    // subscription that lapses mid-session takes effect at the next page
    // refresh (the frontend treats a failed /auth/me as a dead session).
    const enforcement = resolveSubscriptionEnforcement(user);
    if (enforcement.blocked) {
        throw new AppError(enforcement.message, 403);
    }

    // Same lookup login() does — without it, the JWT is the only place
    // permissions ever existed, so a plain page refresh (which only hits
    // /auth/me, not /auth/login) would leave the frontend with no way to
    // know what the user is actually allowed to do.
    const permissions = await resolvePermissionsForUser(user);

    const primaryBranch = user.branch_id
        ? { id: user.branch_id, name: user.branch_name, code: user.branch_code }
        : null;
    const accessibleBranches = await branchesService.getAccessibleBranchesForUser(user.id, primaryBranch);

    // The org's display settings (currency, timezone, date_format —
    // created at registration) ride along on the profile so the frontend
    // formats money and dates the way this organization actually
    // operates, instead of hardcoding dollars and the browser's locale.
    const settingRows = await settingsRepository.listSettings({ organizationId: user.organization_id });
    const settings = Object.fromEntries(settingRows.map((row) => [row.key_name, row.value]));

    return {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        isActive: user.is_active,
        role: user.role_name,
        photo: user.photo || null,
        permissions,
        mustChangePassword: user.must_change_password,
        subscriptionLocked: enforcement.locked,
        organization: {
            id: user.organization_id,
            name: user.organization_name,
            slug: user.organization_slug,
        },
        settings,
        branch: {
            id: user.branch_id,
            name: user.branch_name,
            code: user.branch_code,
        },
        accessibleBranches,
        subscriptionAlert: buildSubscriptionAlert(user),
    };
};

/**
 * Change the authenticated user's own password. Requires the current
 * password — this is the "I know my password but want to change it"
 * path; an admin overriding someone else's forgotten password is a
 * separate, deliberately distinct flow (see users.service.resetPassword).
 *
 * Returns a freshly signed token: the token the caller authenticated
 * with still carries whatever mustChangePassword claim it was issued
 * with, and the backend's own route guard (middlewares/auth.js) reads
 * that claim from the token, not a live DB lookup — without a new
 * token, a user who just cleared the flag would stay locked out of
 * every other route until their next login.
 *
 * @param {string} userId Authenticated user's ID (from the JWT subject).
 * @param {object} payload { currentPassword, newPassword }.
 * @returns {Promise<object>} { token }.
 */
const changePassword = async (userId, payload) => {
    const validationErrors = validateChangePassword(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    const user = await authRepository.findPasswordHashById(userId);
    if (!user) {
        throw new AppError("User not found.", 404);
    }

    const isCurrentPasswordValid = await bcrypt.compare(payload.currentPassword, user.password_hash);
    if (!isCurrentPasswordValid) {
        throw new AppError("Current password is incorrect.", 401);
    }

    const passwordHash = await bcrypt.hash(payload.newPassword, 12);
    await authRepository.updatePasswordHash(userId, passwordHash);

    // Changing a password should end every OTHER active session for this
    // account (a shared or leaked password stops working immediately).
    // Bumping the version invalidates all outstanding tokens; we then
    // re-issue at the new version below so the caller's own session
    // survives seamlessly.
    await authRepository.bumpTokenVersion(userId);

    const updatedUser = await authRepository.findUserById(userId);
    const permissions = await resolvePermissionsForUser(updatedUser);
    // Re-derive the locked flag rather than trusting the old token's —
    // the re-issued token must reflect the subscription as it stands now.
    const enforcement = resolveSubscriptionEnforcement(updatedUser);
    const token = buildSessionToken(updatedUser, permissions, enforcement.locked);

    return { token };
};

/**
 * Set the authenticated user's own passport photo — a small image data
 * URI (resized in the browser before upload). Passing an empty value
 * clears it. Validated the same way the org logo is: must be an image
 * data URI within a sane size.
 *
 * @param {string} userId Authenticated user's ID.
 * @param {object} payload { photo }.
 * @returns {Promise<object>} { photo }.
 */
const updatePhoto = async (userId, payload = {}) => {
    const photo = payload.photo === null || payload.photo === undefined ? "" : String(payload.photo);

    if (photo && !/^data:image\/[a-z0-9.+-]+;base64,/i.test(photo)) {
        throw new AppError("Photo must be an uploaded image.", 400);
    }
    if (photo.length > 800000) {
        throw new AppError("Photo is too large.", 400);
    }

    await authRepository.updateUserPhoto(userId, photo);
    return { photo: photo || null };
};

module.exports = {
    register,
    login,
    me,
    changePassword,
    updatePhoto,
    resolveSubscriptionEnforcement,
};
