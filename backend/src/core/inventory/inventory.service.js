/**
 * ============================================================
 * File: inventory.service.js
 * Module: Core Inventory
 *
 * Description:
 * Business logic for the current-stock read view. Quantity changes
 * happen exclusively through core/stock-movements.
 * ============================================================
 */

const AppError = require("../../utils/AppError");
const { isNonEmptyString } = require("../../utils/validators");
const inventoryRepository = require("./inventory.repository");

const toProductStockResponse = (row) => {
    if (!row) {
        return null;
    }

    return {
        id: row.id,
        organizationId: row.organization_id,
        branchId: row.branch_id,
        branchName: row.branch_name,
        productId: row.product_id,
        productName: row.product_name,
        productSku: row.product_sku,
        quantity: row.quantity,
        reorderLevel: row.reorder_level,
        isLowStock: row.quantity <= row.reorder_level,
        updatedAt: row.updated_at,
    };
};

const listProductStock = async (filters = {}) => {
    const rows = await inventoryRepository.listProductStock(filters);
    return rows.map(toProductStockResponse);
};

const updateReorderLevel = async (payload = {}) => {
    const errors = [];
    if (!isNonEmptyString(String(payload.organizationId || ""))) {
        errors.push("Organization ID is required.");
    }
    if (!isNonEmptyString(String(payload.branchId || ""))) {
        errors.push("Branch ID is required.");
    }
    if (!isNonEmptyString(String(payload.productId || ""))) {
        errors.push("Product ID is required.");
    }
    const reorderLevel = Number(payload.reorderLevel);
    if (!Number.isInteger(reorderLevel) || reorderLevel < 0) {
        errors.push("Reorder level must be a non-negative whole number.");
    }
    if (errors.length > 0) {
        throw new AppError(errors.join(" "), 400);
    }

    const row = await inventoryRepository.upsertReorderLevel({
        organizationId: payload.organizationId,
        branchId: payload.branchId,
        productId: payload.productId,
        reorderLevel,
    });

    return toProductStockResponse(row);
};

const toStockBatchResponse = (row) => {
    if (!row) {
        return null;
    }

    return {
        id: row.id,
        organizationId: row.organization_id,
        branchId: row.branch_id,
        branchName: row.branch_name,
        productId: row.product_id,
        productName: row.product_name,
        productSku: row.product_sku,
        quantity: row.quantity,
        expiryDate: row.expiry_date,
        receivedAt: row.received_at,
    };
};

const listStockBatches = async (filters = {}) => {
    const rows = await inventoryRepository.listStockBatches(filters);
    return rows.map(toStockBatchResponse);
};

module.exports = {
    listProductStock,
    updateReorderLevel,
    listStockBatches,
};
