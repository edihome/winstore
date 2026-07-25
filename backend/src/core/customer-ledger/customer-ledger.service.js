/**
 * ============================================================
 * File: customer-ledger.service.js
 * Module: Core Customer Ledger
 *
 * Description:
 * Business logic for the customer credit ledger: recording payments and
 * adjustments against a customer's balance, and reading their statement.
 * Credit CHARGES from a sale are posted by the sales flow inside the sale's
 * own transaction (via the repository), not here.
 * ============================================================
 */

const crypto = require("crypto");
const AppError = require("../../utils/AppError");
const ledgerRepository = require("./customer-ledger.repository");
const customersRepository = require("../customers/customers.repository");
const { validateManualEntry } = require("./customer-ledger.validation");
const { totalFromRows } = require("../../utils/pagination");

const toEntryResponse = (row) => ({
    id: row.id,
    customerId: row.customer_id,
    entryType: row.entry_type,
    amount: Number(row.amount),
    balanceAfter: Number(row.balance_after),
    saleId: row.sale_id,
    method: row.method,
    note: row.note,
    createdBy: row.created_by,
    createdAt: row.created_at,
});

/**
 * Record a manual payment or adjustment against a customer's balance.
 *
 * @param {string} customerId
 * @param {string} organizationId
 * @param {object} payload { entryType: 'payment'|'adjustment', amount, method?, note? }
 * @param {string} actingUserId
 * @returns {Promise<object>} The posted entry (with the new balance_after).
 */
const recordManualEntry = async (customerId, organizationId, payload, actingUserId) => {
    const errors = validateManualEntry(payload);
    if (errors.length > 0) {
        throw new AppError(errors.join(" "), 400);
    }

    // Signed amount: a payment always REDUCES what the customer owes; an
    // adjustment is taken exactly as given (positive adds, negative forgives).
    const input = Number(payload.amount);
    const signedAmount = payload.entryType === "payment" ? -Math.abs(input) : input;

    const client = await ledgerRepository.getClient();
    try {
        await client.query("BEGIN");
        const row = await ledgerRepository.recordEntry(
            {
                id: crypto.randomUUID(),
                organizationId,
                customerId,
                entryType: payload.entryType,
                amount: signedAmount,
                method: payload.entryType === "payment" ? payload.method || "cash" : null,
                note: payload.note ? String(payload.note).trim() : null,
                createdBy: actingUserId,
            },
            client
        );
        if (!row) {
            throw new AppError("Customer not found.", 404);
        }
        await client.query("COMMIT");
        return toEntryResponse(row);
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
};

/**
 * A customer's statement: their current balance plus their ledger entries.
 *
 * @returns {Promise<{balance:number, entries:object[], total?:number}>}
 */
const getStatement = async (customerId, organizationId, filters = {}) => {
    const customer = await customersRepository.findCustomerById(customerId, organizationId);
    if (!customer) {
        throw new AppError("Customer not found.", 404);
    }

    const balance = await ledgerRepository.getBalance(customerId, organizationId);
    const rows = await ledgerRepository.listEntries({
        customerId,
        organizationId,
        pagination: filters.pagination,
        sort: filters.sort,
    });
    const result = { balance, entries: rows.map(toEntryResponse) };
    if (filters.pagination) {
        result.total = totalFromRows(rows);
    }
    return result;
};

module.exports = { recordManualEntry, getStatement, toEntryResponse };
