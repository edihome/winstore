/**
 * ============================================================
 * File: roles.service.js
 * Module: Core Roles
 *
 * Description:
 * Business logic for role management. A role's grants are exactly
 * the set of catalog resources (see permissions.catalog.js)
 * submitted as checkboxes — create and update both resolve those
 * resource keys to this organization's existing "manage"
 * permissions and replace the role's role_permissions rows in one
 * transaction, so a role's grants are never a stale accumulation.
 * ============================================================
 */

const crypto = require("crypto");
const pool = require("../../config/db");
const AppError = require("../../utils/AppError");
const { validateCreateRole, validateUpdateRole } = require("./roles.validation");
const {
    MODULE_CATALOG_WITH_ACTIONS,
    MODULE_ACTION,
    ROLE_TIERS,
} = require("../permissions/permissions.catalog");
const rolesRepository = require("./roles.repository");
const permissionsRepository = require("../permissions/permissions.repository");

const toRoleResponse = (row) => {
    if (!row) {
        return null;
    }

    return {
        id: row.id,
        organizationId: row.organization_id,
        name: row.name,
        description: row.description,
        isSystem: row.is_system,
        resources: row.resources || [],
        // Fine-grained grants as "resource:action" strings (what the Roles
        // page's permission matrix reads/writes).
        permissions: row.permissions || [],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
};

const getCatalog = () => MODULE_CATALOG_WITH_ACTIONS;

/**
 * Turn a role-create/update payload into the permission-row ids to link.
 * Accepts EITHER `permissions` (fine-grained "resource:action" strings — the
 * new matrix) OR `resources` (legacy list of module keys → "manage" each, kept
 * for backward compatibility). Fine-grained rows are materialized on demand.
 *
 * @param {string} organizationId
 * @param {object} payload
 * @param {object} client PostgreSQL transaction client.
 * @returns {Promise<string[]>} Permission ids to link to the role.
 */
const resolvePermissionIds = async (organizationId, payload, client) => {
    if (Array.isArray(payload.permissions)) {
        const ids = [];
        for (const permission of payload.permissions) {
            const [resource, action] = String(permission).split(":");
            const row = await permissionsRepository.findOrCreatePermission(organizationId, resource, action, client);
            ids.push(row.id);
        }
        return ids;
    }

    const resources = Array.isArray(payload.resources) ? payload.resources : [];
    if (resources.length === 0) {
        return [];
    }
    const permissions = await permissionsRepository.findPermissionsByResources(
        organizationId,
        resources,
        MODULE_ACTION,
        client
    );
    return permissions.map((permission) => permission.id);
};

/**
 * Ensure the predefined access tiers (Staff, Supervisor, Admin) exist as
 * roles for this organization, seeding any that are missing. Idempotent and
 * cheap — called before listing roles so the tier picker on the Staff page
 * always has them. The owner tier (super_admin) is created at registration.
 *
 * @param {string} organizationId
 */
const ensureTierRoles = async (organizationId) => {
    const existing = await rolesRepository.listRoles({ organizationId });
    const existingNames = new Set(existing.map((role) => role.name));
    const missing = ROLE_TIERS.filter((tier) => !existingNames.has(tier.name));
    if (missing.length === 0) {
        return;
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        for (const tier of missing) {
            const role = await rolesRepository.createRole(
                {
                    id: crypto.randomUUID(),
                    organizationId,
                    name: tier.name,
                    description: tier.description,
                    isSystem: false,
                },
                client
            );
            const permissionIds = [];
            if (tier.resources.length > 0) {
                const permissions = await permissionsRepository.findPermissionsByResources(
                    organizationId,
                    tier.resources,
                    MODULE_ACTION,
                    client
                );
                permissionIds.push(...permissions.map((permission) => permission.id));
            }
            for (const permission of tier.extraPermissions || []) {
                const [resource, action] = permission.split(":");
                const row = await permissionsRepository.findOrCreatePermission(organizationId, resource, action, client);
                permissionIds.push(row.id);
            }
            if (permissionIds.length > 0) {
                await rolesRepository.setRolePermissions(role.id, permissionIds, client);
            }
        }
        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        // A concurrent request may have seeded the same tier first; that's
        // fine — the caller's own list below will still find it.
        if (!/duplicate key|unique/i.test(error.message)) {
            throw error;
        }
    } finally {
        client.release();
    }
};

const listRoles = async (filters = {}) => {
    if (filters.organizationId) {
        await ensureTierRoles(filters.organizationId);
    }
    const rows = await rolesRepository.listRoles(filters);
    return rows.map(toRoleResponse);
};

const createRole = async (payload) => {
    const validationErrors = validateCreateRole(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const role = await rolesRepository.createRole(
            {
                id: crypto.randomUUID(),
                organizationId: payload.organizationId,
                name: payload.name.trim(),
                description: payload.description ? String(payload.description).trim() : "",
                isSystem: false,
            },
            client
        );

        const permissionIds = await resolvePermissionIds(payload.organizationId, payload, client);
        if (permissionIds.length > 0) {
            await rolesRepository.setRolePermissions(role.id, permissionIds, client);
        }

        await client.query("COMMIT");

        const rows = await rolesRepository.listRoles({ organizationId: payload.organizationId });
        return toRoleResponse(rows.find((row) => row.id === role.id));
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
};

const updateRole = async (id, organizationId, payload) => {
    const validationErrors = validateUpdateRole(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    const existing = await rolesRepository.findRoleById(id, organizationId);
    if (!existing) {
        throw new AppError("Role not found.", 404);
    }

    if (existing.is_system) {
        throw new AppError("System roles cannot be modified.", 409);
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        await rolesRepository.updateRole(
            id,
            organizationId,
            {
                name: payload.name !== undefined ? String(payload.name).trim() : undefined,
                description: payload.description !== undefined ? String(payload.description).trim() : undefined,
            },
            client
        );

        if (payload.permissions !== undefined || payload.resources !== undefined) {
            const permissionIds = await resolvePermissionIds(organizationId, payload, client);
            await rolesRepository.setRolePermissions(id, permissionIds, client);
        }

        await client.query("COMMIT");

        const rows = await rolesRepository.listRoles({ organizationId });
        return toRoleResponse(rows.find((row) => row.id === id));
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
};

module.exports = {
    getCatalog,
    listRoles,
    createRole,
    updateRole,
};
