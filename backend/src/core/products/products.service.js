/**
 * ============================================================
 * File: products.service.js
 * Module: Core Products
 *
 * Description:
 * Business logic for product management.
 * ============================================================
 */

const crypto = require("crypto");
const AppError = require("../../utils/AppError");
const { validateCreateProduct, validateUpdateProduct, marginError } = require("./products.validation");
const productsRepository = require("./products.repository");
const stockMovementsService = require("../stock-movements/stock-movements.service");
const inventoryService = require("../inventory/inventory.service");
const { hardDelete } = require("../../utils/hardDelete");
const { conflictError, expectedVersionOf } = require("../../utils/optimisticLock");
const { totalFromRows } = require("../../utils/pagination");

/**
 * Maps a raw database row (snake_case, string-typed numerics from pg)
 * into the camelCase, correctly-typed shape returned by the API.
 */
const toProductResponse = (row) => {
    if (!row) {
        return null;
    }

    const mapped = {
        id: row.id,
        organizationId: row.organization_id,
        categoryId: row.category_id,
        name: row.name,
        sku: row.sku,
        barcode: row.barcode || null,
        price: Number(row.price),
        cost: Number(row.cost),
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        version: row.version,
    };

    // Present only when the row came from the joined list query.
    if (row.category_name !== undefined) {
        mapped.categoryName = row.category_name;
    }

    return mapped;
};

const listProducts = async (filters = {}) => {
    const rows = await productsRepository.listProducts(filters);
    const items = rows.map(toProductResponse);
    if (filters.pagination) {
        return { items, total: totalFromRows(rows) };
    }
    return items;
};

const createProduct = async (payload) => {
    const validationErrors = validateCreateProduct(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    const existing = await productsRepository.findProductBySku(payload.organizationId, payload.sku.trim());
    if (existing) {
        throw new AppError("A product with this SKU already exists.", 409);
    }

    const barcode = payload.barcode ? String(payload.barcode).trim() : null;
    if (barcode) {
        const existingBarcode = await productsRepository.findProductByBarcode(payload.organizationId, barcode);
        if (existingBarcode) {
            throw new AppError("A product with this barcode already exists.", 409);
        }
    }

    const product = await productsRepository.createProduct({
        id: crypto.randomUUID(),
        organizationId: payload.organizationId,
        categoryId: payload.categoryId,
        name: payload.name.trim(),
        sku: payload.sku.trim(),
        barcode,
        price: payload.price,
        cost: payload.cost,
        status: payload.status,
    });

    // Opening stock is a workflow convenience, not a schema property of
    // the product — it just fires the same audited stock-in movement a
    // manual Stock page entry would, for the branch creating the product.
    const openingStock = Number(payload.openingStock);
    if (Number.isInteger(openingStock) && openingStock > 0 && payload.branchId) {
        await stockMovementsService.createStockMovement({
            organizationId: payload.organizationId,
            branchId: payload.branchId,
            productId: product.id,
            movementType: "in",
            quantity: openingStock,
            reason: "Opening stock",
            expiryDate: payload.openingStockExpiryDate || null,
        });
    }

    // Reorder level lives on product_stock (it's per-branch), not on the
    // product itself — set it as a convenience at creation time when given.
    const reorderLevel = Number(payload.reorderLevel);
    if (Number.isInteger(reorderLevel) && reorderLevel >= 0 && payload.branchId) {
        await inventoryService.updateReorderLevel({
            organizationId: payload.organizationId,
            branchId: payload.branchId,
            productId: product.id,
            reorderLevel,
        });
    }

    return toProductResponse(product);
};

const updateProduct = async (id, organizationId, payload) => {
    const validationErrors = validateUpdateProduct(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    const existing = await productsRepository.findProductById(id, organizationId);
    if (!existing) {
        throw new AppError("Product not found.", 404);
    }

    // Check the rule against the values the row will actually END UP with: an
    // edit may send only one of the two, and "drop the price below the stored
    // cost" (or "raise the cost above the stored price") has to be caught just
    // the same as sending a bad pair together.
    const margin = marginError(
        payload.price !== undefined ? payload.price : existing.price,
        payload.cost !== undefined ? payload.cost : existing.cost
    );
    if (margin) {
        throw new AppError(margin, 400);
    }

    let barcode;
    if (payload.barcode !== undefined) {
        barcode = payload.barcode ? String(payload.barcode).trim() : null;
        if (barcode) {
            const existingBarcode = await productsRepository.findProductByBarcode(organizationId, barcode);
            if (existingBarcode && existingBarcode.id !== id) {
                throw new AppError("A product with this barcode already exists.", 409);
            }
        }
    }

    const product = await productsRepository.updateProduct(
        id,
        organizationId,
        {
            categoryId: payload.categoryId,
            name: payload.name !== undefined ? String(payload.name).trim() : undefined,
            barcode,
            price: payload.price,
            cost: payload.cost,
            status: payload.status,
        },
        expectedVersionOf(payload)
    );

    // The row existed a moment ago (checked above), so an empty result means
    // the version guard matched nothing — someone else changed it first.
    if (!product) {
        throw conflictError();
    }

    return toProductResponse(product);
};

/**
 * Bulk-import upsert. Creates the product, or — if one with this SKU already
 * exists in the org — UPDATES its catalog fields instead of failing. This
 * makes a re-uploaded or partially-overlapping product sheet idempotent
 * (existing items are updated, new ones added) rather than erroring on every
 * SKU that's already there. Opening stock/reorder level are applied on CREATE
 * only and never touched on an update, so a re-import can't inflate inventory.
 *
 * @param {object} payload Mapped import row (see products.controller.mapImportRow).
 * @returns {Promise<object>} The created or updated product.
 */
const importProduct = async (payload) => {
    const sku = String(payload.sku || "").trim();
    if (sku) {
        const existing = await productsRepository.findProductBySku(payload.organizationId, sku);
        if (existing) {
            return updateProduct(existing.id, payload.organizationId, {
                name: payload.name,
                categoryId: payload.categoryId,
                barcode: payload.barcode,
                price: payload.price,
                cost: payload.cost,
            });
        }
    }
    return createProduct(payload);
};

/**
 * Developer-only hard delete — see backend/src/utils/hardDelete.js.
 * Every other role only ever gets activate/deactivate via updateProduct.
 */
const deleteProduct = async (id, organizationId, force = false) => {
    const existing = await productsRepository.findProductById(id, organizationId);
    if (!existing) {
        throw new AppError("Product not found.", 404);
    }

    await hardDelete({ table: "products", id, force });
};

module.exports = {
    listProducts,
    createProduct,
    updateProduct,
    importProduct,
    deleteProduct,
};
