/**
 * ============================================================
 * File: taxes.repository.js
 * Module: Core Taxes
 *
 * Description:
 * SQL repository methods for tax management.
 * ============================================================
 */

const pool = require("../../config/db");

const listTaxes = async (filters = {}, client = pool) => {
    const { organizationId = "", status = "" } = filters;
    const result = await client.query(
        `
            SELECT id, organization_id, name, rate, status, created_at, updated_at
            FROM taxes
            WHERE ($1::text = '' OR organization_id = $1::uuid)
              AND ($2::text = '' OR status = $2)
            ORDER BY created_at DESC
        `,
        [organizationId, status]
    );

    return result.rows;
};

const findTaxById = async (id, organizationId, client = pool) => {
    const result = await client.query(
        `
            SELECT id, organization_id, name, rate, status, created_at, updated_at
            FROM taxes
            WHERE id = $1 AND organization_id = $2
            LIMIT 1
        `,
        [id, organizationId]
    );

    return result.rows[0] || null;
};

const createTax = async (taxData, client = pool) => {
    const result = await client.query(
        `
            INSERT INTO taxes (id, organization_id, name, rate, status, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
            RETURNING id, organization_id, name, rate, status, created_at, updated_at
        `,
        [taxData.id, taxData.organizationId, taxData.name, taxData.rate, taxData.status || "active"]
    );

    return result.rows[0];
};

const updateTaxStatus = async (id, organizationId, status, client = pool) => {
    const result = await client.query(
        `
            UPDATE taxes
            SET status = $3, updated_at = NOW()
            WHERE id = $1 AND organization_id = $2
            RETURNING id, organization_id, name, rate, status, created_at, updated_at
        `,
        [id, organizationId, status]
    );

    return result.rows[0] || null;
};

module.exports = {
    listTaxes,
    findTaxById,
    createTax,
    updateTaxStatus,
};
