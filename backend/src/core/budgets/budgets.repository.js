/**
 * ============================================================
 * File: budgets.repository.js
 * Module: Core Budgets
 *
 * Description:
 * SQL repository methods for budget management.
 * ============================================================
 */

const pool = require("../../config/db");

const listBudgets = async (filters = {}, client = pool) => {
    const { organizationId = "" } = filters;
    const result = await client.query(
        `
            SELECT id, organization_id, name, amount, status, created_at
            FROM budgets
            WHERE ($1::text = '' OR organization_id = $1::uuid)
            ORDER BY created_at DESC
        `,
        [organizationId]
    );

    return result.rows;
};

const createBudget = async (budgetData, client = pool) => {
    const result = await client.query(
        `
            INSERT INTO budgets (id, organization_id, name, amount, status, created_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
            RETURNING id, organization_id, name, amount, status, created_at
        `,
        [budgetData.id, budgetData.organizationId, budgetData.name, budgetData.amount, budgetData.status || "active"]
    );

    return result.rows[0];
};

module.exports = {
    listBudgets,
    createBudget,
};
