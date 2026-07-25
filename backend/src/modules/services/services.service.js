/**
 * ============================================================
 * File: services.service.js
 * Module: Services
 *
 * Description:
 * Business logic for the service catalog.
 * ============================================================
 */

const crypto = require("crypto");
const AppError = require("../../utils/AppError");
const servicesRepository = require("./services.repository");
const { totalFromRows } = require("../../utils/pagination");
const { validateCreateService, validateUpdateService } = require("./services.validation");
const { hardDelete } = require("../../utils/hardDelete");

/**
 * @param {object} row Raw services row.
 * @returns {object} API-shaped service.
 */
const toServiceResponse = (row) => {
    if (!row) {
        return null;
    }

    return {
        id: row.id,
        organizationId: row.organization_id,
        branchId: row.branch_id,
        name: row.name,
        description: row.description,
        durationMinutes: row.duration_minutes,
        price: Number(row.price),
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
};

const listServices = async (filters = {}) => {
    const rows = await servicesRepository.listServices(filters);
    const items = rows.map(toServiceResponse);
    if (filters.pagination) {
        return { items, total: totalFromRows(rows) };
    }
    return items;
};

const createService = async (payload) => {
    const validationErrors = validateCreateService(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    const row = await servicesRepository.createService({
        id: crypto.randomUUID(),
        organizationId: payload.organizationId,
        branchId: payload.branchId,
        name: String(payload.name).trim(),
        description: payload.description,
        durationMinutes: Number(payload.durationMinutes),
        price: Number(payload.price),
        isActive: payload.isActive,
    });

    return toServiceResponse(row);
};

const updateService = async (id, organizationId, payload) => {
    const validationErrors = validateUpdateService(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    const existing = await servicesRepository.findServiceById(id, organizationId);
    if (!existing) {
        throw new AppError("Service not found.", 404);
    }

    const row = await servicesRepository.updateService(id, organizationId, {
        name: payload.name !== undefined ? String(payload.name).trim() : undefined,
        description: payload.description,
        durationMinutes: payload.durationMinutes !== undefined ? Number(payload.durationMinutes) : undefined,
        price: payload.price !== undefined ? Number(payload.price) : undefined,
        isActive: payload.isActive,
    });

    return toServiceResponse(row);
};

/**
 * Developer-only hard delete — see backend/src/utils/hardDelete.js.
 * Every other role only ever gets activate/deactivate via updateService.
 */
const deleteService = async (id, organizationId, force = false) => {
    const existing = await servicesRepository.findServiceById(id, organizationId);
    if (!existing) {
        throw new AppError("Service not found.", 404);
    }

    await hardDelete({ table: "services", id, force });
};

module.exports = {
    listServices,
    createService,
    updateService,
    deleteService,
};
