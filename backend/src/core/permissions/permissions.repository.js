/**
 * ============================================================
 * File: permissions.repository.js
 * Module: Core Permissions
 *
 * Description:
 * SQL repository methods for permission management.
 * ============================================================
 */

const pool = require("../../config/db");

const listPermissions = async (filters = {}, client = pool) => {
    const { organizationId = "" } = filters;
    const result = await client.query(
        `
            SELECT id, organization_id, name, resource, action, created_at, updated_at
            FROM permissions
            WHERE ($1::text = '' OR organization_id = $1::uuid)
            ORDER BY created_at DESC
        `,
        [organizationId]
    );

    return result.rows;
};

const createPermission = async (permissionData, client = pool) => {
    const result = await client.query(
        `
            INSERT INTO permissions (id, organization_id, name, resource, action, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
            RETURNING id, organization_id, name, resource, action, created_at, updated_at
        `,
        [permissionData.id, permissionData.organizationId, permissionData.name, permissionData.resource, permissionData.action]
    );

    return result.rows[0];
};

/**
 * Get the permission row for an org's (resource, action), creating it if it
 * doesn't exist yet. Registration only seeds the "manage" permission per
 * module, so fine-grained actions (customers:create, sales:refund, …) are
 * materialized on demand the first time a custom role grants them.
 *
 * @param {string} organizationId
 * @param {string} resource
 * @param {string} action
 * @param {object} client PostgreSQL client (transaction).
 * @returns {Promise<{id:string}>}
 */
const findOrCreatePermission = async (organizationId, resource, action, client = pool) => {
    const existing = await client.query(
        `SELECT id FROM permissions WHERE organization_id = $1 AND resource = $2 AND action = $3 LIMIT 1`,
        [organizationId, resource, action]
    );
    if (existing.rows[0]) {
        return existing.rows[0];
    }
    const inserted = await client.query(
        `
            INSERT INTO permissions (id, organization_id, name, resource, action, created_at, updated_at)
            VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), NOW())
            RETURNING id
        `,
        [organizationId, `${resource}:${action}`, resource, action]
    );
    return inserted.rows[0];
};

/**
 * Fetch every permission granted to a role via role_permissions.
 *
 * Used at login time to embed the user's actual permissions into the JWT,
 * instead of leaving req.user.permissions permanently empty.
 *
 * @param {string} roleId Role ID.
 * @param {object} client Optional pg client (defaults to the pool).
 * @returns {Promise<Array>} Permission rows granted to the role.
 */
const getPermissionsByRoleId = async (roleId, client = pool) => {
    if (!roleId) {
        return [];
    }

    const result = await client.query(
        `
            SELECT p.id, p.name, p.resource, p.action
            FROM role_permissions rp
            INNER JOIN permissions p ON p.id = rp.permission_id
            WHERE rp.role_id = $1
        `,
        [roleId]
    );

    return result.rows;
};

/**
 * Resolve catalog resource keys to this organization's permission ids
 * (always the "manage" action — see permissions.catalog.js). Used by
 * roles.service to turn submitted checkboxes into role_permissions rows.
 *
 * @param {string} organizationId Organization ID.
 * @param {string[]} resources Catalog resource keys.
 * @param {string} action Permission action (defaults to "manage").
 * @param {object} client Optional pg client.
 * @returns {Promise<Array>} Matching permission rows.
 */
const findPermissionsByResources = async (organizationId, resources, action = "manage", client = pool) => {
    if (!resources || resources.length === 0) {
        return [];
    }

    const result = await client.query(
        `
            SELECT id, resource, action
            FROM permissions
            WHERE organization_id = $1 AND resource = ANY($2::text[]) AND action = $3
        `,
        [organizationId, resources, action]
    );

    return result.rows;
};

module.exports = {
    listPermissions,
    createPermission,
    findOrCreatePermission,
    getPermissionsByRoleId,
    findPermissionsByResources,
};
