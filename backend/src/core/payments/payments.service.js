/**
 * ============================================================
 * File: payments.service.js
 * Module: Core Payments
 * ============================================================
 */

const crypto = require("crypto");
const AppError = require("../../utils/AppError");
const { validateCreatePayment } = require("./payments.validation");
const paymentsRepository = require("./payments.repository");
const salesRepository = require("../sales/sales.repository");

const toPaymentResponse = (row) => {
    if (!row) {
        return null;
    }

    return {
        id: row.id,
        organizationId: row.organization_id,
        saleId: row.sale_id,
        reference: row.reference,
        amount: Number(row.amount),
        method: row.method,
        status: row.status,
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
};

const listPayments = async (filters = {}) => {
    const rows = await paymentsRepository.listPayments(filters);
    return rows.map(toPaymentResponse);
};

const createPayment = async (payload, actingUserId) => {
    const validationErrors = validateCreatePayment(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    // The sale being paid must belong to the caller's own organization —
    // without this, a payment could be attached to another tenant's sale
    // by supplying its id (the org id on the row is forced to the caller's
    // by enforceOrganizationScope, but the sale reference was never checked).
    const sale = await salesRepository.findSaleById(payload.saleId, payload.organizationId);
    if (!sale) {
        throw new AppError("The sale being paid was not found for this organization.", 404);
    }

    const payment = await paymentsRepository.createPayment({
        id: crypto.randomUUID(),
        organizationId: payload.organizationId,
        saleId: payload.saleId,
        reference: payload.reference || `PAY-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        amount: payload.amount,
        method: payload.method,
        status: payload.status,
        createdBy: actingUserId,
    });

    return toPaymentResponse(payment);
};

module.exports = {
    listPayments,
    createPayment,
};
