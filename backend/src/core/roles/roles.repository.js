/**
 * ============================================================
 * File: roles.repository.js
 * Module: Core Roles
 *
 * Description:
 * SQL repository methods for role management, including which
 * catalog resources (see permissions.catalog.js) a role grants.
 * ============================================================
 */

const pool = require("../../config/db");

const listRoles = async (filters = {}, client = pool) => {
    const { organizationId = "" } = filters;
    const result = await client.query(
        `
            SELECT
                r.id, r.organization_id, r.name, r.description, r.is_system, r.created_at, r.updated_at,
                COALESCE(
                    (
                        SELECT array_agg(DISTINCT p.resource ORDER BY p.resource)
                        FROM role_permissions rp
                        INNER JOIN permissions p ON p.id = rp.permission_id
                        WHERE rp.role_id = r.id
                    ),
                    ARRAY[]::varchar[]
                ) AS resources,
                COALESCE(
                    (
                        SELECT array_agg(p.resource || ':' || p.action ORDER BY p.resource, p.action)
                        FROM role_permissions rp
                        INNER JOIN permissions p ON p.id = rp.permission_id
                        WHERE rp.role_id = r.id
                    ),
                    ARRAY[]::text[]
                ) AS permissions
            FROM roles r
            WHERE ($1::text = '' OR r.organization_id = $1::uuid)
            ORDER BY r.created_at DESC
        `,
        [organizationId]
    );

    return result.rows;
};

const findRoleById = async (id, organizationId, client = pool) => {
    const result = await client.query(
        `
            SELECT id, organization_id, name, description, is_system, created_at, updated_at
            FROM roles
            WHERE id = $1 AND organization_id = $2
            LIMIT 1
        `,
        [id, organizationId]
    );

    return result.rows[0] || null;
};

const createRole = async (roleData, client = pool) => {
    const result = await client.query(
        `
            INSERT INTO roles (id, organization_id, name, description, is_system, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
            RETURNING id, organization_id, name, description, is_system, created_at, updated_at
        `,
        [roleData.id, roleData.organizationId, roleData.name, roleData.description || "", roleData.isSystem || false]
    );

    return result.rows[0];
};

const updateRole = async (id, organizationId, changes, client = pool) => {
    const result = await client.query(
        `
            UPDATE roles
            SET
                name = COALESCE($3, name),
                description = COALESCE($4, description),
                updated_at = NOW()
            WHERE id = $1 AND organization_id = $2
            RETURNING id, organization_id, name, description, is_system, created_at, updated_at
        `,
        [id, organizationId, changes.name ?? null, changes.description ?? null]
    );

    return result.rows[0] || null;
};

/**
 * Replace everything a role grants with exactly the given permission ids.
 * Used by both create (starts from nothing) and update (starts from
 * whatever was there before) so the role's grants always match the
 * checkboxes submitted, not an accumulation of past ones.
 *
 * @param {string} roleId Role ID.
 * @param {string[]} permissionIds Permission IDs to grant.
 * @param {object} client Transaction client.
 * @returns {Promise<void>}
 */
const setRolePermissions = async (roleId, permissionIds, client) => {
    await client.query(`DELETE FROM role_permissions WHERE role_id = $1`, [roleId]);

    for (const permissionId of permissionIds) {
        await client.query(
            `
                INSERT INTO role_permissions (id, role_id, permission_id, created_at)
                VALUES (gen_random_uuid(), $1, $2, NOW())
                ON CONFLICT (role_id, permission_id) DO NOTHING
            `,
            [roleId, permissionId]
        );
    }
};

module.exports = {
    listRoles,
    findRoleById,
    createRole,
    updateRole,
    setRolePermissions,
};
