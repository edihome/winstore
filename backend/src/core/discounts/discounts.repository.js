/**
 * ============================================================
 * File: discounts.repository.js
 * Module: Core Discounts
 *
 * Description:
 * SQL repository methods for discount management.
 * ============================================================
 */

const pool = require("../../config/db");

const listDiscounts = async (filters = {}, client = pool) => {
    const { organizationId = "", status = "" } = filters;
    const result = await client.query(
        `
            SELECT id, organization_id, code, amount, status, created_at, updated_at
            FROM discounts
            WHERE ($1::text = '' OR organization_id = $1::uuid)
              AND ($2::text = '' OR status = $2)
            ORDER BY created_at DESC
        `,
        [organizationId, status]
    );

    return result.rows;
};

const findDiscountById = async (id, organizationId, client = pool) => {
    const result = await client.query(
        `
            SELECT id, organization_id, code, amount, status, created_at, updated_at
            FROM discounts
            WHERE id = $1 AND organization_id = $2
            LIMIT 1
        `,
        [id, organizationId]
    );

    return result.rows[0] || null;
};

const findDiscountByCode = async (organizationId, code, client = pool) => {
    const result = await client.query(
        `
            SELECT id, organization_id, code, amount, status, created_at, updated_at
            FROM discounts
            WHERE organization_id = $1 AND LOWER(code) = LOWER($2)
            LIMIT 1
        `,
        [organizationId, code]
    );

    return result.rows[0] || null;
};

const createDiscount = async (discountData, client = pool) => {
    const result = await client.query(
        `
            INSERT INTO discounts (id, organization_id, code, amount, status, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
            RETURNING id, organization_id, code, amount, status, created_at, updated_at
        `,
        [discountData.id, discountData.organizationId, discountData.code, discountData.amount, discountData.status || "active"]
    );

    return result.rows[0];
};

const updateDiscountStatus = async (id, organizationId, status, client = pool) => {
    const result = await client.query(
        `
            UPDATE discounts
            SET status = $3, updated_at = NOW()
            WHERE id = $1 AND organization_id = $2
            RETURNING id, organization_id, code, amount, status, created_at, updated_at
        `,
        [id, organizationId, status]
    );

    return result.rows[0] || null;
};

module.exports = {
    listDiscounts,
    findDiscountById,
    findDiscountByCode,
    createDiscount,
    updateDiscountStatus,
};
