/**
 * ============================================================
 * File: cash-register.controller.js
 * Module: Core Cash Register
 *
 * Description:
 * HTTP controller for cash register endpoints.
 * ============================================================
 */

const cashRegisterService = require("./cash-register.service");
const { success } = require("../../utils/response");
const { resolveAccessibleBranchIds } = require("../../middlewares/branchScope");
const { canAccessAllBranches } = require("../../utils/isPrivilegedRole");

const branchScope = (req) => canAccessAllBranches(req.user.role)
    ? null
    : resolveAccessibleBranchIds(req);

/**
 * Handle cash register listing requests.
 *
 * @param {object} req Express request.
 * @param {object} res Express response.
 * @returns {Promise<object>} JSON response.
 */
const listCashRegisters = async (req, res) => {
    const registers = await cashRegisterService.listCashRegisters(req.query, await branchScope(req));
    return success(res, "Cash registers fetched successfully.", registers, 200);
};

/**
 * Handle cash register creation requests.
 *
 * @param {object} req Express request.
 * @param {object} res Express response.
 * @returns {Promise<object>} JSON response.
 */
const createCashRegister = async (req, res) => {
    const register = await cashRegisterService.createCashRegister(req.body, await branchScope(req));
    return success(res, "Cash register created successfully.", register, 201);
};

/**
 * Handle cash transaction listing requests.
 *
 * @param {object} req Express request.
 * @param {object} res Express response.
 * @returns {Promise<object>} JSON response.
 */
const listCashTransactions = async (req, res) => {
    const transactions = await cashRegisterService.listCashTransactions(req.query, await branchScope(req));
    return success(res, "Cash transactions fetched successfully.", transactions, 200);
};

/**
 * Handle cash transaction creation requests.
 *
 * @param {object} req Express request.
 * @param {object} res Express response.
 * @returns {Promise<object>} JSON response.
 */
const createCashTransaction = async (req, res) => {
    const transaction = await cashRegisterService.createCashTransaction(req.body, await branchScope(req));
    return success(res, "Cash transaction created successfully.", transaction, 201);
};

module.exports = {
    listCashRegisters,
    createCashRegister,
    listCashTransactions,
    createCashTransaction,
};
