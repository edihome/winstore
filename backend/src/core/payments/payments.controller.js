/**
 * ============================================================
 * File: payments.controller.js
 * Module: Core Payments
 * ============================================================
 */

const asyncHandler = require("../../utils/asyncHandler");
const { success } = require("../../utils/response");
const paymentsService = require("./payments.service");

const listPayments = asyncHandler(async (req, res) => {
    const payments = await paymentsService.listPayments({
        organizationId: req.query.organizationId,
        saleId: req.query.saleId,
    });
    return success(res, "Payments fetched successfully.", payments, 200);
});

const createPayment = asyncHandler(async (req, res) => {
    const payment = await paymentsService.createPayment(req.body, req.user.id);
    return success(res, "Payment recorded successfully.", payment, 201);
});

module.exports = {
    listPayments,
    createPayment,
};
