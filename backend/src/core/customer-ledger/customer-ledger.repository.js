/**
 * ============================================================
 * File: customer-ledger.repository.js
 * Module: Core Customer Ledger
 *
 * Description:
 * SQL for the customer credit ledger (see migration 054). Every balance
 * change is one append-only row carrying the running balance_after, so a
 * customer's current balance is just their latest entry's balance_after.
 * ============================================================
 */

const pool = require("../../config/db");
const { orderByClause, limitOffsetClause } = require("../../utils/pagination");

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const getClient = () => pool.connect();

/**
 * The customer's current balance, locking their row FOR UPDATE so concurrent
 * ledger writes for the same customer serialize (no lost updates on the
 * running balance). Returns null when the customer doesn't exist in the org.
 *
 * @returns {Promise<number|null>}
 */
const lockCustomerAndGetBalance = async (customerId, organizationId, client) => {
    const customer = await client.query(
        `SELECT id FROM customers WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
        [customerId, organizationId]
    );
    if (customer.rows.length === 0) {
        return null;
    }
    const latest = await client.query(
        `SELECT balance_after FROM customer_ledger_entries
         WHERE customer_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
        [customerId]
    );
    return latest.rows.length ? Number(latest.rows[0].balance_after) : 0;
};

/**
 * Append one ledger entry. `amount` is SIGNED (+ increases what the customer
 * owes, − decreases). MUST be called inside a transaction (client required);
 * the caller is responsible for having locked the customer via
 * lockCustomerAndGetBalance first (createSale and the ledger service both do).
 *
 * @returns {Promise<object>} The inserted row (with balance_after).
 */
const insertEntry = async (entry, previousBalance, client) => {
    const balanceAfter = round2(previousBalance + Number(entry.amount));
    const result = await client.query(
        `
            INSERT INTO customer_ledger_entries
                (id, organization_id, customer_id, entry_type, amount, balance_after, sale_id, method, note, created_by, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
            RETURNING id, organization_id, customer_id, entry_type, amount, balance_after, sale_id, method, note, created_by, created_at
        `,
        [
            entry.id,
            entry.organizationId,
            entry.customerId,
            entry.entryType,
            round2(entry.amount),
            balanceAfter,
            entry.saleId || null,
            entry.method || null,
            entry.note || null,
            entry.createdBy || null,
        ]
    );
    return result.rows[0];
};

/**
 * Lock the customer, read their running balance, and append the entry — the
 * whole balance-mutating operation. MUST run inside a transaction. Returns
 * null if the customer doesn't exist in the org.
 *
 * @returns {Promise<object|null>} The inserted row, or null (customer missing).
 */
const recordEntry = async (entry, client) => {
    const previousBalance = await lockCustomerAndGetBalance(entry.customerId, entry.organizationId, client);
    if (previousBalance === null) {
        return null;
    }
    return insertEntry(entry, previousBalance, client);
};

/**
 * Lock the customer and read their credit limit + current balance together —
 * for enforcing the limit on a credit sale within its transaction. Returns
 * null if the customer doesn't exist in the org. creditLimit null = no limit.
 */
const getCreditProfile = async (customerId, organizationId, client) => {
    const result = await client.query(
        `
            SELECT c.credit_limit,
                   (SELECT balance_after FROM customer_ledger_entries e
                    WHERE e.customer_id = c.id ORDER BY e.created_at DESC, e.id DESC LIMIT 1) AS balance
            FROM customers c
            WHERE c.id = $1 AND c.organization_id = $2
            FOR UPDATE
        `,
        [customerId, organizationId]
    );
    if (result.rows.length === 0) {
        return null;
    }
    return {
        creditLimit: result.rows[0].credit_limit === null ? null : Number(result.rows[0].credit_limit),
        balance: Number(result.rows[0].balance || 0),
    };
};

/** A customer's current balance (non-locking read). */
const getBalance = async (customerId, organizationId, client = pool) => {
    const result = await client.query(
        `SELECT balance_after FROM customer_ledger_entries
         WHERE customer_id = $1 AND organization_id = $2
         ORDER BY created_at DESC, id DESC LIMIT 1`,
        [customerId, organizationId]
    );
    return result.rows.length ? Number(result.rows[0].balance_after) : 0;
};

const LEDGER_SORTS = { createdAt: "created_at", amount: "amount" };

const listEntries = async (filters = {}, client = pool) => {
    const { customerId = "", organizationId = "", pagination = null, sort = null } = filters;
    const params = [customerId, organizationId];
    const order = orderByClause(sort, LEDGER_SORTS, "created_at DESC");
    const { clause, params: pageParams } = limitOffsetClause(pagination, params.length + 1);

    const result = await client.query(
        `
            SELECT id, organization_id, customer_id, entry_type, amount, balance_after,
                   sale_id, method, note, created_by, created_at,
                   COUNT(*) OVER() AS total_count
            FROM customer_ledger_entries
            WHERE customer_id = $1 AND organization_id = $2
            ${order}${clause}
        `,
        [...params, ...pageParams]
    );
    return result.rows;
};

/**
 * Outstanding receivables: each customer's current balance (their latest
 * entry) where it's positive — i.e. who owes the business, most first.
 */
const getReceivables = async ({ organizationId }, client = pool) => {
    const result = await client.query(
        `
            SELECT c.id, c.name, c.phone, le.balance_after AS balance, le.created_at AS last_activity
            FROM customers c
            INNER JOIN LATERAL (
                SELECT balance_after, created_at
                FROM customer_ledger_entries e
                WHERE e.customer_id = c.id
                ORDER BY e.created_at DESC, e.id DESC
                LIMIT 1
            ) le ON TRUE
            WHERE c.organization_id = $1
              AND le.balance_after > 0.005
            ORDER BY le.balance_after DESC
        `,
        [organizationId]
    );
    return result.rows;
};

module.exports = {
    getClient,
    round2,
    lockCustomerAndGetBalance,
    insertEntry,
    recordEntry,
    getBalance,
    getCreditProfile,
    listEntries,
    getReceivables,
};
