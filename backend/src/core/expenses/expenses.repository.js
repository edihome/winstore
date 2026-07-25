/**
 * ============================================================
 * File: expenses.repository.js
 * Module: Core Expenses
 *
 * Description:
 * SQL repository methods for expense management.
 * ============================================================
 */

const pool = require("../../config/db");
const { orderByClause, limitOffsetClause } = require("../../utils/pagination");

const EXPENSE_SORTS = { createdAt: "created_at", amount: "amount", category: "category", status: "status" };

const listExpenses = async (filters = {}, client = pool) => {
    const { organizationId = "", branchId = "", status = "", pagination = null, sort = null } = filters;

    const params = [organizationId, branchId, status];
    const order = orderByClause(sort, EXPENSE_SORTS, "created_at DESC");
    const { clause, params: pageParams } = limitOffsetClause(pagination, params.length + 1);

    const result = await client.query(
        `
            SELECT id, organization_id, branch_id, description, category, amount,
                   status, created_by, paid_at, created_at, updated_at,
                   COUNT(*) OVER() AS total_count
            FROM expenses
            WHERE ($1::text = '' OR organization_id = $1::uuid)
              AND ($2::text = '' OR branch_id = $2::uuid)
              AND ($3::text = '' OR status = $3)
            ${order}${clause}
        `,
        [...params, ...pageParams]
    );

    return result.rows;
};

const findExpenseById = async (id, organizationId, client = pool) => {
    const result = await client.query(
        `
            SELECT id, organization_id, branch_id, description, category, amount,
                   status, created_by, paid_at, created_at, updated_at
            FROM expenses
            WHERE id = $1 AND organization_id = $2
            LIMIT 1
        `,
        [id, organizationId]
    );

    return result.rows[0] || null;
};

const createExpense = async (expenseData, client = pool) => {
    const result = await client.query(
        `
            INSERT INTO expenses (
                id, organization_id, branch_id, description, category, amount,
                status, created_by, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
            RETURNING id, organization_id, branch_id, description, category, amount,
                      status, created_by, paid_at, created_at, updated_at
        `,
        [
            expenseData.id,
            expenseData.organizationId,
            expenseData.branchId,
            expenseData.description,
            expenseData.category || "general",
            expenseData.amount,
            expenseData.status || "pending",
            expenseData.createdBy,
        ]
    );

    return result.rows[0];
};

const updateExpenseStatus = async (id, organizationId, status, paidAt, client = pool) => {
    const result = await client.query(
        `
            UPDATE expenses
            SET status = $3, paid_at = COALESCE($4, paid_at), updated_at = NOW()
            WHERE id = $1 AND organization_id = $2
            RETURNING id, organization_id, branch_id, description, category, amount,
                      status, created_by, paid_at, created_at, updated_at
        `,
        [id, organizationId, status, paidAt]
    );

    return result.rows[0] || null;
};

const getPaidExpensesSummary = async ({ organizationId, branchId = "", from, to }, client = pool) => {
    const result = await client.query(
        `
            SELECT
                COUNT(*)::int AS expense_count,
                COALESCE(SUM(amount), 0) AS total
            FROM expenses
            WHERE organization_id = $1
              AND ($2::text = '' OR branch_id = $2::uuid)
              AND status = 'paid'
              AND paid_at >= $3 AND paid_at < $4
        `,
        [organizationId, branchId, from, to]
    );

    return result.rows[0];
};

module.exports = {
    listExpenses,
    findExpenseById,
    createExpense,
    updateExpenseStatus,
    getPaidExpensesSummary,
};
