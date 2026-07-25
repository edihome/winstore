/**
 * ============================================================
 * File: reports.controller.js
 * Module: Core Reports
 *
 * Description:
 * HTTP controller for report endpoints.
 * ============================================================
 */

const asyncHandler = require("../../utils/asyncHandler");
const { success } = require("../../utils/response");
const reportsService = require("./reports.service");

const reportQuery = (req) => ({
    organizationId: req.query.organizationId,
    branchId: req.query.branchId,
    from: req.query.from,
    to: req.query.to,
    withinDays: req.query.withinDays,
});

const getSummary = asyncHandler(async (req, res) => {
    const summary = await reportsService.getSummary(reportQuery(req));
    return success(res, "Summary report fetched successfully.", summary, 200);
});

const getTopItems = asyncHandler(async (req, res) => {
    const items = await reportsService.getTopItems(reportQuery(req));
    return success(res, "Top items report fetched successfully.", items, 200);
});

const getLowStock = asyncHandler(async (req, res) => {
    const items = await reportsService.getLowStock(reportQuery(req));
    return success(res, "Low stock report fetched successfully.", items, 200);
});

const getRevenueTrend = asyncHandler(async (req, res) => {
    const trend = await reportsService.getRevenueTrend(reportQuery(req));
    return success(res, "Revenue trend fetched successfully.", trend, 200);
});

const getProfit = asyncHandler(async (req, res) => {
    const report = await reportsService.getProfit(reportQuery(req));
    return success(res, "Profit report fetched successfully.", report, 200);
});

const getSalesByStaff = asyncHandler(async (req, res) => {
    const report = await reportsService.getSalesByStaff(reportQuery(req));
    return success(res, "Sales-by-staff report fetched successfully.", report, 200);
});

const getCashUp = asyncHandler(async (req, res) => {
    const report = await reportsService.getCashUp(reportQuery(req));
    return success(res, "Cash-up report fetched successfully.", report, 200);
});

const getProfitAndLoss = asyncHandler(async (req, res) => {
    const report = await reportsService.getProfitAndLoss(reportQuery(req));
    return success(res, "Profit & loss report fetched successfully.", report, 200);
});

const getExpiry = asyncHandler(async (req, res) => {
    const report = await reportsService.getExpiry(reportQuery(req));
    return success(res, "Expiry report fetched successfully.", report, 200);
});

const getInventoryValuation = asyncHandler(async (req, res) => {
    const report = await reportsService.getInventoryValuation(reportQuery(req));
    return success(res, "Inventory valuation fetched successfully.", report, 200);
});

const getSalesByCategory = asyncHandler(async (req, res) => {
    const report = await reportsService.getSalesByCategory(reportQuery(req));
    return success(res, "Sales-by-category report fetched successfully.", report, 200);
});

const getBranchComparison = asyncHandler(async (req, res) => {
    const report = await reportsService.getBranchComparison(reportQuery(req));
    return success(res, "Branch comparison fetched successfully.", report, 200);
});

const getTax = asyncHandler(async (req, res) => {
    const report = await reportsService.getTax(reportQuery(req));
    return success(res, "Tax report fetched successfully.", report, 200);
});

const getDiscounts = asyncHandler(async (req, res) => {
    const report = await reportsService.getDiscounts(reportQuery(req));
    return success(res, "Discounts report fetched successfully.", report, 200);
});

const getCustomers = asyncHandler(async (req, res) => {
    const report = await reportsService.getCustomers(reportQuery(req));
    return success(res, "Customer report fetched successfully.", report, 200);
});

const getReceivables = asyncHandler(async (req, res) => {
    const report = await reportsService.getReceivables(reportQuery(req));
    return success(res, "Receivables report fetched successfully.", report, 200);
});

module.exports = {
    getSummary,
    getTopItems,
    getRevenueTrend,
    getLowStock,
    getReceivables,
    getProfit,
    getSalesByStaff,
    getCashUp,
    getProfitAndLoss,
    getExpiry,
    getInventoryValuation,
    getSalesByCategory,
    getBranchComparison,
    getTax,
    getDiscounts,
    getCustomers,
};
