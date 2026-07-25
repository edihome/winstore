/**
 * ============================================================
 * File: branches.repository.js
 * Module: Core Branches
 *
 * Description:
 * SQL repository methods for branch management.
 * ============================================================
 */

const pool = require("../../config/db");

const listBranches = async (filters = {}, client = pool) => {
    const { organizationId = "" } = filters;
    const result = await client.query(
        `
            SELECT id, organization_id, name, code, is_headquarters, created_at, updated_at
            FROM branches
            WHERE ($1::text = '' OR organization_id = $1::uuid)
            ORDER BY created_at DESC
        `,
        [organizationId]
    );

    return result.rows;
};

const findBranchById = async (id, organizationId, client = pool) => {
    const result = await client.query(
        `
            SELECT id, organization_id, name, code, is_headquarters, created_at, updated_at
            FROM branches
            WHERE id = $1 AND organization_id = $2
            LIMIT 1
        `,
        [id, organizationId]
    );

    return result.rows[0] || null;
};

const createBranch = async (branchData, client = pool) => {
    const result = await client.query(
        `
            INSERT INTO branches (id, organization_id, name, code, is_headquarters, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
            RETURNING id, organization_id, name, code, is_headquarters, created_at, updated_at
        `,
        [branchData.id, branchData.organizationId, branchData.name, branchData.code, branchData.isHeadquarters || false]
    );

    return result.rows[0];
};

const updateBranch = async (id, organizationId, updates, client = pool) => {
    const result = await client.query(
        `
            UPDATE branches
            SET name = COALESCE($3, name),
                code = COALESCE($4, code),
                is_headquarters = COALESCE($5, is_headquarters),
                updated_at = NOW()
            WHERE id = $1 AND organization_id = $2
            RETURNING id, organization_id, name, code, is_headquarters, created_at, updated_at
        `,
        [id, organizationId, updates.name ?? null, updates.code ?? null, updates.isHeadquarters ?? null]
    );

    return result.rows[0] || null;
};

/**
 * Every branch a user has been explicitly granted via user_branches.
 * Callers fall back to the user's single primary branch_id when this
 * comes back empty — see auth.service.me/login and users.service — so a
 * user with no explicit grants (the common case) still works unchanged.
 *
 * @param {string} userId User ID.
 * @param {object} client Optional pg client.
 * @returns {Promise<Array>} { id, name, code } rows, ordered by name.
 */
const listAccessibleBranchesForUser = async (userId, client = pool) => {
    const result = await client.query(
        `
            SELECT b.id, b.name, b.code
            FROM user_branches ub
            INNER JOIN branches b ON b.id = ub.branch_id
            WHERE ub.user_id = $1
            ORDER BY b.name ASC
        `,
        [userId]
    );

    return result.rows;
};

/**
 * Replace a user's full set of granted branches with exactly the given
 * ids — same "replace, don't accumulate" pattern as
 * roles.repository.setRolePermissions.
 *
 * @param {string} userId User ID.
 * @param {string[]} branchIds Branch IDs to grant.
 * @param {object} client Transaction client.
 * @returns {Promise<void>}
 */
const setUserBranches = async (userId, branchIds, client) => {
    await client.query(`DELETE FROM user_branches WHERE user_id = $1`, [userId]);

    for (const branchId of branchIds) {
        await client.query(
            `INSERT INTO user_branches (user_id, branch_id, created_at) VALUES ($1, $2, NOW())
             ON CONFLICT (user_id, branch_id) DO NOTHING`,
            [userId, branchId]
        );
    }
};

module.exports = {
    listBranches,
    findBranchById,
    createBranch,
    updateBranch,
    listAccessibleBranchesForUser,
    setUserBranches,
};
