/**
 * ============================================================
 * File: categories.repository.js
 * Module: Core Categories
 *
 * Description:
 * SQL repository methods for category management.
 * ============================================================
 */

const pool = require("../../config/db");

/**
 * Fetch categories with optional filters.
 *
 * @param {object} filters Query filters.
 * @param {object} client PostgreSQL client or pool.
 * @returns {Promise<object[]>} Category database rows.
 */
const listCategories = async (filters = {}, client = pool) => {
    const { organizationId = "", status = "" } = filters;
    const result = await client.query(
        `
            SELECT id, organization_id, name, slug, status, created_at, updated_at
            FROM categories
            WHERE ($1::text = '' OR organization_id = $1::uuid)
              AND ($2::text = '' OR status = $2)
            ORDER BY name ASC
        `,
        [organizationId, status]
    );

    return result.rows;
};

/**
 * Find a category by organization and slug.
 *
 * @param {string} organizationId Organization ID.
 * @param {string} slug Category slug.
 * @param {object} client PostgreSQL client or pool.
 * @returns {Promise<object|null>} Category row when found.
 */
const findCategoryBySlug = async (organizationId, slug, client = pool) => {
    const result = await client.query(
        `
            SELECT id, organization_id, name, slug, status, created_at, updated_at
            FROM categories
            WHERE organization_id = $1 AND slug = $2
            LIMIT 1
        `,
        [organizationId, slug]
    );

    return result.rows[0] || null;
};

/**
 * Create a category.
 *
 * @param {object} categoryData Category fields.
 * @param {object} client PostgreSQL client or pool.
 * @returns {Promise<object>} Created category database row.
 */
const createCategory = async (categoryData, client = pool) => {
    const result = await client.query(
        `
            INSERT INTO categories (id, organization_id, name, slug, status, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
            RETURNING id, organization_id, name, slug, status, created_at, updated_at
        `,
        [
            categoryData.id,
            categoryData.organizationId,
            categoryData.name,
            categoryData.slug,
            categoryData.status,
        ]
    );

    return result.rows[0];
};

module.exports = {
    listCategories,
    findCategoryBySlug,
    createCategory,
};
