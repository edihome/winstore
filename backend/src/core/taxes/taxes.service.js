/**
 * ============================================================
 * File: taxes.service.js
 * Module: Core Taxes
 *
 * Description:
 * Business logic for tax management. Taxes are percentage rates;
 * checkout (sales.service) applies every active tax to the
 * discounted subtotal and snapshots the total onto the sale.
 * ============================================================
 */

const crypto = require("crypto");
const AppError = require("../../utils/AppError");
const { validateCreateTax, validateUpdateTax } = require("./taxes.validation");
const taxesRepository = require("./taxes.repository");
const { hardDelete } = require("../../utils/hardDelete");

const toTaxResponse = (row) => {
    if (!row) {
        return null;
    }

    return {
        id: row.id,
        organizationId: row.organization_id,
        name: row.name,
        rate: Number(row.rate),
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
};

const listTaxes = async (filters = {}) => {
    const rows = await taxesRepository.listTaxes(filters);
    return rows.map(toTaxResponse);
};

const createTax = async (payload) => {
    const validationErrors = validateCreateTax(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    const tax = await taxesRepository.createTax({
        id: crypto.randomUUID(),
        organizationId: payload.organizationId,
        name: String(payload.name).trim(),
        rate: Number(payload.rate),
        status: payload.status || "active",
    });

    return toTaxResponse(tax);
};

const updateTaxStatus = async (id, organizationId, payload) => {
    const validationErrors = validateUpdateTax(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    const tax = await taxesRepository.updateTaxStatus(id, organizationId, payload.status);
    if (!tax) {
        throw new AppError("Tax not found.", 404);
    }

    return toTaxResponse(tax);
};

/**
 * Developer-only hard delete — see backend/src/utils/hardDelete.js.
 * Every other role only ever gets activate/deactivate via updateTaxStatus.
 * Nothing references a tax by id (the rate is snapshotted onto each
 * sale as a flat amount), so this never blocks.
 */
const deleteTax = async (id, organizationId) => {
    const existing = await taxesRepository.findTaxById(id, organizationId);
    if (!existing) {
        throw new AppError("Tax not found.", 404);
    }

    await hardDelete({ table: "taxes", id });
};

module.exports = {
    listTaxes,
    createTax,
    updateTaxStatus,
    deleteTax,
};
