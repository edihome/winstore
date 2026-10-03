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
const branchesRepository = require("../branches/branches.repository");
const { moneyToCents, MAX_MONEY_CENTS } = require("../../utils/money");

const assertId = (id, label) => {
    if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        throw new AppError(`${label} must be a valid ID.`, 400);
    }
};

const assertBranchAccess = (branchId, accessibleBranchIds, hidden = false) => {
    if (accessibleBranchIds !== null && !accessibleBranchIds.includes(branchId)) {
        throw new AppError(hidden ? "Cash register not found." : "You do not have access to this branch.", hidden ? 404 : 403);
    }
};

const validateFilters = (filters, accessibleBranchIds) => {
    if (filters.branchId) {
        assertId(filters.branchId, "Branch ID");
        assertBranchAccess(filters.branchId, accessibleBranchIds);
    }
    if (filters.cashRegisterId) assertId(filters.cashRegisterId, "Cash register ID");
    if (filters.status && !Object.values(CASH_REGISTER_STATUSES).includes(filters.status)) {
        throw new AppError("Cash register status must be open or closed.", 400);
    }
};

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
        openingBalance: Number(row.opening_balance),
        currentBalance: Number(row.current_balance),
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
        amount: Number(row.amount),
        balanceAfter: Number(row.balance_after),
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
const listCashRegisters = async (filters = {}, accessibleBranchIds = null) => {
    validateFilters(filters, accessibleBranchIds);
    const registers = await cashRegisterRepository.listCashRegisters({ ...filters, accessibleBranchIds });
    return registers.map(toCashRegisterResponse);
};

/**
 * Create a cash register.
 *
 * @param {object} payload Request body.
 * @returns {Promise<object>} API-safe cash register record.
 */
const createCashRegister = async (payload, accessibleBranchIds = null) => {
    const validationErrors = validateCreateCashRegister(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    assertId(payload.branchId, "Branch ID");
    assertBranchAccess(payload.branchId, accessibleBranchIds);
    if (!(await branchesRepository.findBranchById(payload.branchId, payload.organizationId))) {
        throw new AppError("Branch not found for this organization.", 404);
    }

    const register = await cashRegisterRepository.createCashRegister({
        id: crypto.randomUUID(),
        organizationId: payload.organizationId,
        branchId: payload.branchId,
        name: payload.name.trim(),
        openingBalance: moneyToCents(payload.openingBalance === undefined ? 0 : payload.openingBalance) / 100,
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
const listCashTransactions = async (filters = {}, accessibleBranchIds = null) => {
    validateFilters(filters, accessibleBranchIds);
    if (filters.cashRegisterId) {
        const register = await cashRegisterRepository.findCashRegisterById(filters.cashRegisterId, filters.organizationId);
        if (!register) throw new AppError("Cash register not found.", 404);
        assertBranchAccess(register.branch_id, accessibleBranchIds, true);
    }
    const transactions = await cashRegisterRepository.listCashTransactions({ ...filters, accessibleBranchIds });
    return transactions.map(toCashTransactionResponse);
};

/**
 * Create a cash transaction and update the register balance in one transaction.
 *
 * @param {object} payload Request body.
 * @returns {Promise<object>} API-safe cash transaction record.
 */
const createCashTransaction = async (payload, accessibleBranchIds = null) => {
    const validationErrors = validateCreateCashTransaction(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    assertId(payload.cashRegisterId, "Cash register ID");

    const client = await cashRegisterRepository.getClient();
    const amountCents = moneyToCents(payload.amount);
    const amount = amountCents / 100;

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
        assertBranchAccess(register.branch_id, accessibleBranchIds, true);

        if (register.status !== CASH_REGISTER_STATUSES.OPEN) {
            throw new AppError("Cash transactions can only be recorded against an open register.", 400);
        }

        const signedAmount =
            payload.transactionType === CASH_TRANSACTION_TYPES.OUTFLOW
                ? -amountCents
                : amountCents;
        const balanceCents = moneyToCents(register.current_balance) + signedAmount;

        if (balanceCents < 0) {
            throw new AppError("Cash transaction cannot reduce register balance below zero.", 400);
        }
        if (balanceCents > MAX_MONEY_CENTS) {
            throw new AppError("Cash transaction exceeds the maximum register balance.", 400);
        }
        const balanceAfter = balanceCents / 100;

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
