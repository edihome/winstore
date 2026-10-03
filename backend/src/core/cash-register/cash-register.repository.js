/**
 * ============================================================
 * File: cash-register.repository.js
 * Module: Core Cash Register
 *
 * Description:
 * SQL repository methods for cash register management.
 * ============================================================
 */

const pool = require("../../config/db");

/**
 * Borrow a PostgreSQL client for transaction work.
 *
 * @returns {Promise<object>} PostgreSQL client.
 */
const getClient = () => pool.connect();

/**
 * Fetch cash registers with optional filters.
 *
 * @param {object} filters Query filters.
 * @param {object} client PostgreSQL client or pool.
 * @returns {Promise<object[]>} Cash register database rows.
 */
const listCashRegisters = async (filters = {}, client = pool) => {
    const { organizationId = "", branchId = "", status = "", accessibleBranchIds = null } = filters;
    const result = await client.query(
        `
            SELECT id, organization_id, branch_id, name, opening_balance, current_balance, status, opened_at, closed_at, created_at, updated_at
            FROM cash_registers
            WHERE ($1::text = '' OR organization_id = $1::uuid)
              AND ($2::text = '' OR branch_id = $2::uuid)
              AND ($3::text = '' OR status = $3)
              AND ($4::uuid[] IS NULL OR branch_id = ANY($4::uuid[]))
            ORDER BY created_at DESC
        `,
        [organizationId, branchId, status, accessibleBranchIds]
    );

    return result.rows;
};

/**
 * Create a cash register.
 *
 * @param {object} registerData Cash register fields.
 * @param {object} client PostgreSQL client or pool.
 * @returns {Promise<object>} Created cash register database row.
 */
const createCashRegister = async (registerData, client = pool) => {
    const result = await client.query(
        `
            INSERT INTO cash_registers (
                id,
                organization_id,
                branch_id,
                name,
                opening_balance,
                current_balance,
                status,
                opened_at,
                created_at,
                updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $5, $6, NOW(), NOW(), NOW())
            RETURNING id, organization_id, branch_id, name, opening_balance, current_balance, status, opened_at, closed_at, created_at, updated_at
        `,
        [
            registerData.id,
            registerData.organizationId,
            registerData.branchId || null,
            registerData.name,
            registerData.openingBalance,
            registerData.status,
        ]
    );

    return result.rows[0];
};

/**
 * Fetch cash transactions with optional filters.
 *
 * @param {object} filters Query filters.
 * @param {object} client PostgreSQL client or pool.
 * @returns {Promise<object[]>} Cash transaction database rows.
 */
const listCashTransactions = async (filters = {}, client = pool) => {
    const { organizationId = "", cashRegisterId = "", branchId = "", accessibleBranchIds = null } = filters;
    const result = await client.query(
        `
            SELECT t.id, t.organization_id, t.cash_register_id, t.transaction_type,
                   t.amount, t.balance_after, t.reference, t.notes, t.created_at
            FROM cash_register_transactions t
            JOIN cash_registers r ON r.id = t.cash_register_id AND r.organization_id = t.organization_id
            WHERE ($1::text = '' OR t.organization_id = $1::uuid)
              AND ($2::text = '' OR t.cash_register_id = $2::uuid)
              AND ($3::text = '' OR r.branch_id = $3::uuid)
              AND ($4::uuid[] IS NULL OR r.branch_id = ANY($4::uuid[]))
            ORDER BY t.created_at DESC
        `,
        [organizationId, cashRegisterId, branchId, accessibleBranchIds]
    );

    return result.rows;
};

/**
 * Find and lock an open cash register.
 *
 * @param {string} cashRegisterId Cash register ID.
 * @param {string} organizationId Organization ID.
 * @param {object} client PostgreSQL transaction client.
 * @returns {Promise<object|null>} Cash register row.
 */
const findOpenCashRegisterForUpdate = async (cashRegisterId, organizationId, client) => {
    const result = await client.query(
        `
            SELECT id, organization_id, branch_id, current_balance, status
            FROM cash_registers
            WHERE id = $1 AND organization_id = $2
            FOR UPDATE
        `,
        [cashRegisterId, organizationId]
    );

    return result.rows[0] || null;
};

const findCashRegisterById = async (id, organizationId, client = pool) => {
    const result = await client.query(
        "SELECT id, organization_id, branch_id FROM cash_registers WHERE id = $1 AND organization_id = $2",
        [id, organizationId]
    );
    return result.rows[0] || null;
};

/**
 * Update a cash register balance.
 *
 * @param {string} cashRegisterId Cash register ID.
 * @param {number} balance New balance.
 * @param {object} client PostgreSQL transaction client.
 * @returns {Promise<object>} Updated cash register row.
 */
const updateCashRegisterBalance = async (cashRegisterId, balance, client) => {
    const result = await client.query(
        `
            UPDATE cash_registers
            SET current_balance = $2,
                updated_at = NOW()
            WHERE id = $1
            RETURNING id, organization_id, current_balance, status
        `,
        [cashRegisterId, balance]
    );

    return result.rows[0];
};

/**
 * Create a cash register transaction.
 *
 * @param {object} transactionData Cash transaction fields.
 * @param {object} client PostgreSQL transaction client.
 * @returns {Promise<object>} Created cash transaction row.
 */
const createCashTransaction = async (transactionData, client) => {
    const result = await client.query(
        `
            INSERT INTO cash_register_transactions (
                id,
                organization_id,
                cash_register_id,
                transaction_type,
                amount,
                balance_after,
                reference,
                notes,
                created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            RETURNING id, organization_id, cash_register_id, transaction_type, amount, balance_after, reference, notes, created_at
        `,
        [
            transactionData.id,
            transactionData.organizationId,
            transactionData.cashRegisterId,
            transactionData.transactionType,
            transactionData.amount,
            transactionData.balanceAfter,
            transactionData.reference || null,
            transactionData.notes || null,
        ]
    );

    return result.rows[0];
};

module.exports = {
    getClient,
    listCashRegisters,
    createCashRegister,
    listCashTransactions,
    findOpenCashRegisterForUpdate,
    findCashRegisterById,
    updateCashRegisterBalance,
    createCashTransaction,
};
