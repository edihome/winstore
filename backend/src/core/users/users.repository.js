/**
 * ============================================================
 * File: users.repository.js
 * Module: Core Users
 *
 * Description:
 * SQL repository methods for user management.
 * ============================================================
 */

const pool = require("../../config/db");
const { orderByClause, limitOffsetClause } = require("../../utils/pagination");

// The sensitive HR/"vital data" columns — selected so a super_admin can
// see them; the service strips them from the response for anyone else.
const HR_COLUMNS = `
    u.position, u.employment_date, u.phone, u.address, u.date_of_birth, u.gender,
    u.next_of_kin, u.next_of_kin_phone, u.national_id, u.bank_name,
    u.bank_account_number, u.salary, u.benefits`;

const USER_SORTS = {
    firstName: "u.first_name",
    lastName: "u.last_name",
    email: "u.email",
    roleName: "r.name",
    branchName: "b.name",
    createdAt: "u.created_at",
};

const listUsers = async (filters = {}, client = pool) => {
    const {
        organizationId = "",
        branchIds = null,
        search = "",
        excludeSystemRoles = false,
        pagination = null,
        sort = null,
    } = filters;

    const params = [organizationId, branchIds, search, excludeSystemRoles];
    const order = orderByClause(sort, USER_SORTS, "u.created_at DESC");
    const { clause, params: pageParams } = limitOffsetClause(pagination, params.length + 1);

    const result = await client.query(
        `
            SELECT
                u.id, u.organization_id, u.branch_id, u.role_id,
                u.first_name, u.last_name, u.email, u.is_active, u.must_change_password,
                u.created_at, u.updated_at, u.xmin::text AS version,
                b.name AS branch_name,
                r.name AS role_name,
                COALESCE(r.is_system, false) AS role_is_system,
                COALESCE(
                    (SELECT array_agg(ub.branch_id) FROM user_branches ub WHERE ub.user_id = u.id),
                    ARRAY[]::uuid[]
                ) AS accessible_branch_ids,
                ${HR_COLUMNS},
                COUNT(*) OVER() AS total_count
            FROM users u
            LEFT JOIN branches b ON b.id = u.branch_id
            LEFT JOIN roles r ON r.id = u.role_id
            WHERE ($1::text = '' OR u.organization_id = $1::uuid)
              AND ($2::uuid[] IS NULL OR u.branch_id = ANY($2::uuid[]))
              AND ($3::text = '' OR u.first_name ILIKE '%' || $3 || '%' OR u.last_name ILIKE '%' || $3 || '%'
                   OR u.email ILIKE '%' || $3 || '%')
              AND ($4::boolean = false OR COALESCE(r.is_system, false) = false)
            ${order}${clause}
        `,
        [...params, ...pageParams]
    );

    return result.rows;
};

const findUserById = async (id, organizationId, client = pool) => {
    const result = await client.query(
        `
            SELECT
                u.id, u.organization_id, u.branch_id, u.role_id,
                u.first_name, u.last_name, u.email, u.is_active, u.must_change_password,
                u.created_at, u.updated_at, u.xmin::text AS version,
                b.name AS branch_name,
                r.name AS role_name,
                COALESCE(r.is_system, false) AS role_is_system,
                COALESCE(
                    (SELECT array_agg(ub.branch_id) FROM user_branches ub WHERE ub.user_id = u.id),
                    ARRAY[]::uuid[]
                ) AS accessible_branch_ids,
                ${HR_COLUMNS}
            FROM users u
            LEFT JOIN branches b ON b.id = u.branch_id
            LEFT JOIN roles r ON r.id = u.role_id
            WHERE u.id = $1 AND u.organization_id = $2
            LIMIT 1
        `,
        [id, organizationId]
    );

    return result.rows[0] || null;
};

const findUserByEmail = async (email, client = pool) => {
    const result = await client.query(
        `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
        [email]
    );

    return result.rows[0] || null;
};

// Admin-created staff always start must_change_password = true: the
// admin knows this password (they just typed it), so the account isn't
// really "theirs" until they set one only they know.
const createUser = async (userData, client = pool) => {
    const result = await client.query(
        `
            INSERT INTO users (id, organization_id, branch_id, role_id, first_name, last_name, email, password_hash, is_active, must_change_password, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, NOW(), NOW())
            RETURNING id, organization_id, branch_id, role_id, first_name, last_name, email, is_active, must_change_password, created_at, updated_at
        `,
        [
            userData.id,
            userData.organizationId,
            userData.branchId || null,
            userData.roleId || null,
            userData.firstName,
            userData.lastName,
            userData.email,
            userData.passwordHash,
            userData.isActive !== false,
        ]
    );

    return result.rows[0];
};

const updateUser = async (id, organizationId, changes, expectedVersion = null, client = pool) => {
    // COALESCE everywhere: only the fields actually passed change; the
    // rest (including the HR columns during a plain deactivate) are left
    // exactly as they were. Empty strings clear a text field; a null
    // simply means "not provided this time".
    const params = [
        id,
        organizationId,
        changes.firstName ?? null,
        changes.lastName ?? null,
        changes.branchId ?? null,
        changes.roleId ?? null,
        changes.isActive ?? null,
        changes.position ?? null,
        changes.employmentDate ?? null,
        changes.phone ?? null,
        changes.address ?? null,
        changes.dateOfBirth ?? null,
        changes.gender ?? null,
        changes.nextOfKin ?? null,
        changes.nextOfKinPhone ?? null,
        changes.nationalId ?? null,
        changes.bankName ?? null,
        changes.bankAccountNumber ?? null,
        changes.salary ?? null,
        changes.benefits ?? null,
    ];
    // Optimistic lock — see utils/optimisticLock. Omitting it updates as before.
    let versionClause = "";
    if (expectedVersion !== null) {
        params.push(expectedVersion);
        versionClause = ` AND xmin = $${params.length}::xid`;
    }

    const result = await client.query(
        `
            UPDATE users
            SET
                first_name = COALESCE($3, first_name),
                last_name = COALESCE($4, last_name),
                branch_id = COALESCE($5, branch_id),
                role_id = COALESCE($6, role_id),
                is_active = COALESCE($7, is_active),
                position = COALESCE($8, position),
                employment_date = COALESCE($9, employment_date),
                phone = COALESCE($10, phone),
                address = COALESCE($11, address),
                date_of_birth = COALESCE($12, date_of_birth),
                gender = COALESCE($13, gender),
                next_of_kin = COALESCE($14, next_of_kin),
                next_of_kin_phone = COALESCE($15, next_of_kin_phone),
                national_id = COALESCE($16, national_id),
                bank_name = COALESCE($17, bank_name),
                bank_account_number = COALESCE($18, bank_account_number),
                salary = COALESCE($19, salary),
                benefits = COALESCE($20, benefits),
                updated_at = NOW()
            WHERE id = $1 AND organization_id = $2${versionClause}
            RETURNING id, xmin::text AS version
        `,
        params
    );

    return result.rows[0] || null;
};

// An admin reset is the same "temporary password someone else knows"
// situation as initial creation — force a change again.
const updatePasswordHash = async (id, organizationId, passwordHash, client = pool) => {
    await client.query(
        `UPDATE users SET password_hash = $3, must_change_password = true, updated_at = NOW() WHERE id = $1 AND organization_id = $2`,
        [id, organizationId, passwordHash]
    );
};

// Invalidate every outstanding session for a user by bumping their
// token_version (see middlewares/sessionGuard.js). Org-scoped so an
// admin can only ever revoke sessions of a user in their own
// organization. Used on deactivation and admin password reset.
const bumpTokenVersion = async (id, organizationId, client = pool) => {
    await client.query(
        `UPDATE users SET token_version = token_version + 1, updated_at = NOW() WHERE id = $1 AND organization_id = $2`,
        [id, organizationId]
    );
};

module.exports = {
    listUsers,
    findUserById,
    findUserByEmail,
    createUser,
    updateUser,
    updatePasswordHash,
    bumpTokenVersion,
};
