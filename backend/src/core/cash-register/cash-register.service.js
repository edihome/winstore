/**
 * ============================================================
 * File: cash-register.service.js
 * Module: Core Cash Register
 *
 * Description:
 * Business logic for cash register management.
 * ============================================================
 */

const crypto = require("crypto");
const AppError = require("../../utils/AppError");
const {
    CASH_REGISTER_STATUSES,
    CASH_TRANSACTION_TYPES,
    validateCreateCashRegister,
    validateCreateCashTransaction,
} = require("./cash-register.validation");
const cashRegisterRepository = require("./cash-register.repository");

/**
 * Map a cash register database row into an API-safe response object.
 *
 * @param {object|null} row Cash register database row.
 * @returns {object|null} API-safe cash register object.
 */
const toCashRegisterResponse = (row) => {
    if (!row) {
        return null;
    }

    return {
        id: row.id,
        organizationId: row.organization_id,
        branchId: row.branch_id,
        name: row.name,
        openingBalance: row.opening_balance,
        currentBalance: row.current_balance,
        status: row.status,
        openedAt: row.opened_at,
        closedAt: row.closed_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
};

/**
 * Map a cash transaction database row into an API-safe response object.
 *
 * @param {object|null} row Cash transaction database row.
 * @returns {object|null} API-safe cash transaction object.
 */
const toCashTransactionResponse = (row) => {
    if (!row) {
        return null;
    }

    return {
        id: row.id,
        organizationId: row.organization_id,
        cashRegisterId: row.cash_register_id,
        transactionType: row.transaction_type,
        amount: row.amount,
        balanceAfter: row.balance_after,
        reference: row.reference,
        notes: row.notes,
        createdAt: row.created_at,
    };
};

/**
 * List cash registers using optional filters.
 *
 * @param {object} filters Query filters.
 * @returns {Promise<object[]>} API-safe cash register records.
 */
const listCashRegisters = async (filters = {}) => {
    const registers = await cashRegisterRepository.listCashRegisters(filters);
    return registers.map(toCashRegisterResponse);
};

/**
 * Create a cash register.
 *
 * @param {object} payload Request body.
 * @returns {Promise<object>} API-safe cash register record.
 */
const createCashRegister = async (payload) => {
    const validationErrors = validateCreateCashRegister(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    const register = await cashRegisterRepository.createCashRegister({
        id: crypto.randomUUID(),
        organizationId: payload.organizationId,
        branchId: payload.branchId,
        name: payload.name.trim(),
        openingBalance: Number(payload.openingBalance || 0),
        status: CASH_REGISTER_STATUSES.OPEN,
    });

    return toCashRegisterResponse(register);
};

/**
 * List cash transactions using optional filters.
 *
 * @param {object} filters Query filters.
 * @returns {Promise<object[]>} API-safe cash transaction records.
 */
const listCashTransactions = async (filters = {}) => {
    const transactions = await cashRegisterRepository.listCashTransactions(filters);
    return transactions.map(toCashTransactionResponse);
};

/**
 * Create a cash transaction and update the register balance in one transaction.
 *
 * @param {object} payload Request body.
 * @returns {Promise<object>} API-safe cash transaction record.
 */
const createCashTransaction = async (payload) => {
    const validationErrors = validateCreateCashTransaction(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    const client = await cashRegisterRepository.getClient();
    const amount = Number(payload.amount);

    try {
        await client.query("BEGIN");

        const register = await cashRegisterRepository.findOpenCashRegisterForUpdate(
            payload.cashRegisterId,
            payload.organizationId,
            client
        );

        if (!register) {
            throw new AppError("Cash register was not found for this organization.", 404);
        }

        if (register.status !== CASH_REGISTER_STATUSES.OPEN) {
            throw new AppError("Cash transactions can only be recorded against an open register.", 400);
        }

        const signedAmount =
            payload.transactionType === CASH_TRANSACTION_TYPES.OUTFLOW
                ? -amount
                : amount;
        const balanceAfter = Number(register.current_balance) + signedAmount;

        if (balanceAfter < 0) {
            throw new AppError("Cash transaction cannot reduce register balance below zero.", 400);
        }

        await cashRegisterRepository.updateCashRegisterBalance(payload.cashRegisterId, balanceAfter, client);

        const transaction = await cashRegisterRepository.createCashTransaction(
            {
                id: crypto.randomUUID(),
                organizationId: payload.organizationId,
                cashRegisterId: payload.cashRegisterId,
                transactionType: payload.transactionType,
                amount,
                balanceAfter,
                reference: payload.reference,
                notes: payload.notes,
            },
            client
        );

        await client.query("COMMIT");
        return toCashTransactionResponse(transaction);
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
};

module.exports = {
    listCashRegisters,
    createCashRegister,
    listCashTransactions,
    createCashTransaction,
};
