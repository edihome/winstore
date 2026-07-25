/**
 * ============================================================
 * File: budgets.controller.js
 * Module: Core Budgets
 *
 * Description:
 * HTTP controller for budget endpoints.
 * ============================================================
 */

const budgetsService = require("./budgets.service");
const { success } = require("../../utils/response");

const listBudgets = async (req, res, next) => {
    try {
        const budgets = await budgetsService.listBudgets(req.query);
        return success(res, "Budgets fetched successfully", budgets, 200);
    } catch (error) {
        next(error);
    }
};

const createBudget = async (req, res, next) => {
    try {
        const budget = await budgetsService.createBudget(req.body);
        return success(res, "Budget created successfully", budget, 201);
    } catch (error) {
        next(error);
    }
};

module.exports = {
    listBudgets,
    createBudget,
};
