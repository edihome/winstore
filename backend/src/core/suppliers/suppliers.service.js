/**
 * ============================================================
 * File: suppliers.service.js
 * Module: Core Suppliers
 *
 * Description:
 * Business logic for supplier management.
 * ============================================================
 */

const crypto = require("crypto");
const AppError = require("../../utils/AppError");
const { validateCreateSupplier, validateUpdateSupplier } = require("./suppliers.validation");
const suppliersRepository = require("./suppliers.repository");
const { totalFromRows } = require("../../utils/pagination");
const { hardDelete } = require("../../utils/hardDelete");

const toSupplierResponse = (row) => {
    if (!row) {
        return null;
    }

    return {
        id: row.id,
        organizationId: row.organization_id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
};

const listSuppliers = async (filters = {}) => {
    const rows = await suppliersRepository.listSuppliers(filters);
    const items = rows.map(toSupplierResponse);
    if (filters.pagination) {
        return { items, total: totalFromRows(rows) };
    }
    return items;
};

const createSupplier = async (payload) => {
    const validationErrors = validateCreateSupplier(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    const existing = await suppliersRepository.findSupplierByEmail(payload.organizationId, payload.email.trim());
    if (existing) {
        throw new AppError("A supplier with this email already exists.", 409);
    }

    const supplier = await suppliersRepository.createSupplier({
        id: crypto.randomUUID(),
        organizationId: payload.organizationId,
        name: payload.name.trim(),
        email: payload.email.trim(),
        phone: payload.phone.trim(),
        status: payload.status,
    });

    return toSupplierResponse(supplier);
};

const updateSupplier = async (id, organizationId, payload) => {
    const validationErrors = validateUpdateSupplier(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    const existing = await suppliersRepository.findSupplierById(id, organizationId);
    if (!existing) {
        throw new AppError("Supplier not found.", 404);
    }

    if (payload.email !== undefined && payload.email.trim().toLowerCase() !== existing.email.toLowerCase()) {
        const emailOwner = await suppliersRepository.findSupplierByEmail(organizationId, payload.email.trim());
        if (emailOwner) {
            throw new AppError("A supplier with this email already exists.", 409);
        }
    }

    const supplier = await suppliersRepository.updateSupplier(id, organizationId, {
        name: payload.name !== undefined ? String(payload.name).trim() : undefined,
        email: payload.email !== undefined ? String(payload.email).trim() : undefined,
        phone: payload.phone !== undefined ? String(payload.phone).trim() : undefined,
        status: payload.status,
    });

    return toSupplierResponse(supplier);
};

/**
 * Developer-only hard delete — see backend/src/utils/hardDelete.js.
 * Every other role only ever gets activate/deactivate via updateSupplier.
 */
const deleteSupplier = async (id, organizationId, force = false) => {
    const existing = await suppliersRepository.findSupplierById(id, organizationId);
    if (!existing) {
        throw new AppError("Supplier not found.", 404);
    }

    await hardDelete({ table: "suppliers", id, force });
};

module.exports = {
    listSuppliers,
    createSupplier,
    updateSupplier,
    deleteSupplier,
};
