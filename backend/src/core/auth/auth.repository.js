/**
 * ============================================================
 * File: auth.repository.js
 * Module: Core Auth
 *
 * Description:
 * SQL repository methods for authentication and bootstrap data.
 * ============================================================
 */

const pool = require("../../config/db");

const findUserByEmail = async (email, client = pool) => {
    const result = await client.query(
        `
            SELECT
                u.*, r.name AS role_name, b.name AS branch_name, b.code AS branch_code,
                o.status AS organization_status,
                o.subscription_expires_at, o.alert_threshold_days, o.extension_days
            FROM users u
            LEFT JOIN roles r ON r.id = u.role_id
            LEFT JOIN branches b ON b.id = u.branch_id
            LEFT JOIN organizations o ON o.id = u.organization_id
            WHERE LOWER(u.email) = LOWER($1)
            LIMIT 1
        `,
        [email]
    );

    return result.rows[0] || null;
};

/**
 * Fetch a user together with their organization, branch, and role names.
 * Backs the GET /auth/me endpoint used by the dashboard shell.
 *
 * @param {string} id User ID (from the JWT subject).
 * @param {object} client Optional pg client.
 * @returns {Promise<object|null>} Enriched user profile, or null if not found.
 */
const findUserById = async (id, client = pool) => {
    const result = await client.query(
        `
            SELECT
                u.id, u.first_name, u.last_name, u.email, u.is_active, u.created_at,
                u.organization_id, u.branch_id, u.role_id, u.must_change_password, u.token_version, u.photo,
                r.name AS role_name,
                o.name AS organization_name, o.slug AS organization_slug,
                o.status AS organization_status,
                o.subscription_expires_at, o.alert_threshold_days, o.extension_days,
                b.name AS branch_name, b.code AS branch_code
            FROM users u
            LEFT JOIN roles r ON r.id = u.role_id
            LEFT JOIN organizations o ON o.id = u.organization_id
            LEFT JOIN branches b ON b.id = u.branch_id
            WHERE u.id = $1
            LIMIT 1
        `,
        [id]
    );

    return result.rows[0] || null;
};

/**
 * Link a permission to a role via role_permissions.
 * Called once per bootstrap permission during registration so the
 * newly created admin role actually carries those permissions.
 *
 * @param {object} linkData { id, roleId, permissionId }
 * @param {object} client pg client (should be the transaction client).
 * @returns {Promise<object>} The created link row.
 */
const linkRolePermission = async (linkData, client = pool) => {
    const result = await client.query(
        `
            INSERT INTO role_permissions (id, role_id, permission_id, created_at)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (role_id, permission_id) DO NOTHING
            RETURNING id, role_id, permission_id, created_at
        `,
        [linkData.id, linkData.roleId, linkData.permissionId]
    );

    return result.rows[0] || null;
};

const createOrganization = async (organizationData, client = pool) => {
    const result = await client.query(
        `
            INSERT INTO organizations (id, name, slug, status, created_at, updated_at)
            VALUES ($1, $2, $3, $4, NOW(), NOW())
            RETURNING *
        `,
        [organizationData.id, organizationData.name, organizationData.slug, organizationData.status || "active"]
    );

    return result.rows[0];
};

const createBranch = async (branchData, client = pool) => {
    const result = await client.query(
        `
            INSERT INTO branches (id, organization_id, name, code, is_headquarters, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
            RETURNING *
        `,
        [branchData.id, branchData.organizationId, branchData.name, branchData.code, branchData.isHeadquarters || false]
    );

    return result.rows[0];
};

const createRole = async (roleData, client = pool) => {
    const result = await client.query(
        `
            INSERT INTO roles (id, organization_id, name, description, is_system, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
            RETURNING *
        `,
        [roleData.id, roleData.organizationId, roleData.name, roleData.description || "", roleData.isSystem || false]
    );

    return result.rows[0];
};

const createPermission = async (permissionData, client = pool) => {
    const result = await client.query(
        `
            INSERT INTO permissions (id, organization_id, name, resource, action, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
            RETURNING *
        `,
        [permissionData.id, permissionData.organizationId, permissionData.name, permissionData.resource, permissionData.action]
    );

    return result.rows[0];
};

/**
 * Fetch a user's stored password hash, needed to verify the current
 * password on a self-service change (GET /auth/me and findUserById both
 * omit it deliberately, since it should never leave auth.repository).
 *
 * @param {string} id User ID.
 * @param {object} client Optional pg client.
 * @returns {Promise<object|null>} { id, passwordHash } or null.
 */
const findPasswordHashById = async (id, client = pool) => {
    const result = await client.query(`SELECT id, password_hash FROM users WHERE id = $1 LIMIT 1`, [id]);
    return result.rows[0] || null;
};

/**
 * The minimal live state the per-request session guard needs: is the
 * account still active, and does its token_version still match the one
 * embedded in the presented JWT. A single primary-key lookup, run on
 * every authenticated request — see middlewares/sessionGuard.js.
 *
 * @param {string} id User ID (from the JWT subject).
 * @param {object} client Optional pg client.
 * @returns {Promise<object|null>} { id, is_active, token_version } or null.
 */
const findSessionStateById = async (id, client = pool) => {
    const result = await client.query(
        `SELECT id, is_active, token_version FROM users WHERE id = $1 LIMIT 1`,
        [id]
    );
    return result.rows[0] || null;
};

/**
 * Invalidate every outstanding session for a user by bumping their
 * token_version. Called on deactivation, admin password reset, and
 * self-service password change (which then re-issues a fresh token at
 * the new version, so the acting session survives while others die).
 *
 * @param {string} id User ID.
 * @param {object} client Optional pg client (pass the txn client to
 *   keep the bump atomic with the change that triggered it).
 * @returns {Promise<number>} The new token_version.
 */
const bumpTokenVersion = async (id, client = pool) => {
    const result = await client.query(
        `UPDATE users SET token_version = token_version + 1, updated_at = NOW() WHERE id = $1 RETURNING token_version`,
        [id]
    );
    return result.rows[0]?.token_version ?? 0;
};

// Self-service change proves the user knows their password, whatever it
// was — clears the forced-change flag so they're never prompted again
// for this same password.
const updatePasswordHash = async (id, passwordHash, client = pool) => {
    await client.query(
        `UPDATE users SET password_hash = $2, must_change_password = false, updated_at = NOW() WHERE id = $1`,
        [id, passwordHash]
    );
};

// Set (or clear, with "") a user's own passport photo.
const updateUserPhoto = async (id, photo, client = pool) => {
    await client.query(
        `UPDATE users SET photo = $2, updated_at = NOW() WHERE id = $1`,
        [id, photo || null]
    );
};

// Only ever called for the self-registered admin at registration — they
// chose this password deliberately, so they're never forced to change it.
const createUser = async (userData, client = pool) => {
    const result = await client.query(
        `
            INSERT INTO users (id, organization_id, branch_id, role_id, first_name, last_name, email, password_hash, is_active, must_change_password, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, NOW(), NOW())
            RETURNING id, organization_id, branch_id, role_id, first_name, last_name, email, is_active, must_change_password, created_at, updated_at
        `,
        [userData.id, userData.organizationId, userData.branchId, userData.roleId, userData.firstName, userData.lastName, userData.email, userData.passwordHash, userData.isActive !== false]
    );

    return result.rows[0];
};

module.exports = {
    findUserByEmail,
    findUserById,
    findPasswordHashById,
    findSessionStateById,
    bumpTokenVersion,
    updatePasswordHash,
    updateUserPhoto,
    createOrganization,
    createBranch,
    createRole,
    createPermission,
    createUser,
    linkRolePermission,
};
