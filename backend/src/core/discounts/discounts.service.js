/**
 * ============================================================
 * File: discounts.service.js
 * Module: Core Discounts
 *
 * Description:
 * Business logic for discount management. Discounts are flat
 * amounts attached to a code; checkout (sales.service) looks them
 * up by id and snapshots the amount onto the sale.
 * ============================================================
 */

const crypto = require("crypto");
const AppError = require("../../utils/AppError");
const { validateCreateDiscount, validateUpdateDiscount } = require("./discounts.validation");
const discountsRepository = require("./discounts.repository");
const { hardDelete } = require("../../utils/hardDelete");

const toDiscountResponse = (row) => {
    if (!row) {
        return null;
    }

    return {
        id: row.id,
        organizationId: row.organization_id,
        code: row.code,
        amount: Number(row.amount),
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
};

const listDiscounts = async (filters = {}) => {
    const rows = await discountsRepository.listDiscounts(filters);
    return rows.map(toDiscountResponse);
};

const createDiscount = async (payload) => {
    const validationErrors = validateCreateDiscount(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    const code = String(payload.code).trim();
    const existing = await discountsRepository.findDiscountByCode(payload.organizationId, code);
    if (existing) {
        throw new AppError("A discount with this code already exists.", 409);
    }

    const discount = await discountsRepository.createDiscount({
        id: crypto.randomUUID(),
        organizationId: payload.organizationId,
        code,
        amount: Number(payload.amount),
        status: payload.status || "active",
    });

    return toDiscountResponse(discount);
};

const updateDiscountStatus = async (id, organizationId, payload) => {
    const validationErrors = validateUpdateDiscount(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    const discount = await discountsRepository.updateDiscountStatus(id, organizationId, payload.status);
    if (!discount) {
        throw new AppError("Discount not found.", 404);
    }

    return toDiscountResponse(discount);
};

/**
 * Developer-only hard delete — see backend/src/utils/hardDelete.js.
 * Every other role only ever gets activate/deactivate via updateDiscountStatus.
 * Sales reference a discount via ON DELETE SET NULL, so this never blocks —
 * past invoices keep their snapshotted discountAmount either way.
 */
const deleteDiscount = async (id, organizationId) => {
    const existing = await discountsRepository.findDiscountById(id, organizationId);
    if (!existing) {
        throw new AppError("Discount not found.", 404);
    }

    await hardDelete({ table: "discounts", id });
};

module.exports = {
    listDiscounts,
    createDiscount,
    updateDiscountStatus,
    deleteDiscount,
};
