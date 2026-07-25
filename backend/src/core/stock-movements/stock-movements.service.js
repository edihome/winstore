/**
 * ============================================================
 * File: stock-movements.service.js
 * Module: Core Stock Movements
 *
 * Description:
 * Business logic for stock movement management. Every stock quantity
 * change in the system flows through here — this is the single
 * audited path, matching inventory.repository's read-only design.
 * ============================================================
 */

const crypto = require("crypto");
const AppError = require("../../utils/AppError");
const stockMovementsRepository = require("./stock-movements.repository");
const { totalFromRows } = require("../../utils/pagination");
const productsRepository = require("../products/products.repository");
const branchesRepository = require("../branches/branches.repository");
const {
    STOCK_MOVEMENT_TYPES,
    validateCreateStockMovement,
    validateStockTransfer,
} = require("./stock-movements.validation");

const mapStockMovement = (row) => {
    if (!row) {
        return null;
    }

    const mapped = {
        id: row.id,
        organizationId: row.organization_id,
        branchId: row.branch_id,
        productId: row.product_id,
        movementType: row.movement_type,
        quantityChange: row.quantity_change,
        quantityAfter: row.quantity_after,
        reason: row.reason,
        createdAt: row.created_at,
    };

    if (row.product_name !== undefined) {
        mapped.productName = row.product_name;
    }
    if (row.product_sku !== undefined) {
        mapped.productSku = row.product_sku;
    }

    return mapped;
};

const normalizeQuantityChange = (movementType, quantityValue) => {
    const quantity = Number(quantityValue);

    if (movementType === STOCK_MOVEMENT_TYPES.OUT) {
        return -Math.abs(quantity);
    }

    if (movementType === STOCK_MOVEMENT_TYPES.IN) {
        return Math.abs(quantity);
    }

    return quantity;
};

/**
 * List stock movements using optional filters.
 *
 * @param {object} filters Query filters.
 * @returns {Promise<object[]>} API-safe stock movement records.
 */
const listStockMovements = async (filters = {}) => {
    const movements = await stockMovementsRepository.listStockMovements(filters);
    const items = movements.map(mapStockMovement);
    if (filters.pagination) {
        return { items, total: totalFromRows(movements) };
    }
    return items;
};

/**
 * Create a stock movement and update the branch's product stock in one
 * transaction. Row-locks the product_stock row (creating it on first use)
 * so concurrent movements for the same product/branch can't race each
 * other into an inconsistent quantity, and refuses to let stock go
 * negative.
 *
 * @param {object} payload Request body.
 * @returns {Promise<object>} API-safe stock movement record.
 */
const createStockMovement = async (payload) => {
    const validationErrors = validateCreateStockMovement(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    const product = await productsRepository.findProductById(payload.productId, payload.organizationId);
    if (!product) {
        throw new AppError("Product not found for this organization.", 404);
    }

    const client = await stockMovementsRepository.getClient();
    const quantityValue = payload.quantityChange ?? payload.quantity;
    const quantityChange = normalizeQuantityChange(payload.movementType, quantityValue);

    try {
        await client.query("BEGIN");

        const stockRow = await stockMovementsRepository.findOrCreateProductStockForUpdate(
            {
                organizationId: payload.organizationId,
                branchId: payload.branchId,
                productId: payload.productId,
            },
            client
        );

        const quantityAfter = Number(stockRow.quantity) + quantityChange;
        if (quantityAfter < 0) {
            throw new AppError("Stock movement cannot reduce inventory below zero.", 400);
        }

        await stockMovementsRepository.updateProductStockQuantity(stockRow.id, quantityAfter, client);

        // Batch/FEFO tracking is additive on top of the aggregate quantity
        // above: stock arriving (positive change) with a known expiry
        // seeds a batch; stock leaving (negative change) is drawn from
        // existing batches oldest-expiry-first. A positive adjustment with
        // no expiry given, or any movement for a product nobody has ever
        // supplied an expiry date for, simply doesn't touch stock_batches.
        if (quantityChange > 0 && payload.expiryDate) {
            await stockMovementsRepository.createStockBatch(
                {
                    organizationId: payload.organizationId,
                    branchId: payload.branchId,
                    productId: payload.productId,
                    quantity: quantityChange,
                    expiryDate: payload.expiryDate,
                },
                client
            );
        } else if (quantityChange < 0) {
            await stockMovementsRepository.consumeStockBatchesFEFO(
                {
                    branchId: payload.branchId,
                    productId: payload.productId,
                    quantity: Math.abs(quantityChange),
                },
                client
            );
        }

        const movement = await stockMovementsRepository.createStockMovement(
            {
                id: crypto.randomUUID(),
                organizationId: payload.organizationId,
                branchId: payload.branchId,
                productId: payload.productId,
                movementType: payload.movementType,
                quantityChange,
                quantityAfter,
                reason: payload.reason,
            },
            client
        );

        await client.query("COMMIT");
        return mapStockMovement(movement);
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
};

/**
 * Move stock of one product from a source branch to a destination branch,
 * atomically. This is a single logical operation recorded as two stock
 * movements — an "out" at the source and an "in" at the destination — so
 * each branch's ledger and product_stock aggregate stays exactly right and
 * the pair balances to zero for the organization as a whole.
 *
 * Expiry batches are carried across: the exact batches consumed FEFO at the
 * source (with their expiry dates) are recreated at the destination, so a
 * transferred pack keeps its expiry for the receiving branch's FEFO. Stock
 * with no tracked batch (received before batches, or without an expiry) just
 * moves as aggregate quantity, same as everywhere else in the system.
 *
 * @param {object} payload { organizationId, productId, fromBranchId, toBranchId, quantity, reason }
 * @param {string[]|null} accessibleBranchIds Branch ids the caller may act
 *   on, or null for privileged callers (owner/developer) who may use any
 *   branch in their organization.
 * @returns {Promise<object>} { product, fromBranch, toBranch, quantity, fromQuantityAfter, toQuantityAfter }
 */
const transferStock = async (payload, accessibleBranchIds = null) => {
    const validationErrors = validateStockTransfer(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    const { organizationId, productId, fromBranchId, toBranchId, reason } = payload;
    const quantity = Number(payload.quantity);

    if (accessibleBranchIds !== null) {
        if (!accessibleBranchIds.includes(fromBranchId)) {
            throw new AppError("You do not have access to the source branch.", 403);
        }
        if (!accessibleBranchIds.includes(toBranchId)) {
            throw new AppError("You do not have access to the destination branch.", 403);
        }
    }

    const product = await productsRepository.findProductById(productId, organizationId);
    if (!product) {
        throw new AppError("Product not found for this organization.", 404);
    }

    const fromBranch = await branchesRepository.findBranchById(fromBranchId, organizationId);
    if (!fromBranch) {
        throw new AppError("Source branch not found for this organization.", 404);
    }

    const toBranch = await branchesRepository.findBranchById(toBranchId, organizationId);
    if (!toBranch) {
        throw new AppError("Destination branch not found for this organization.", 404);
    }

    const client = await stockMovementsRepository.getClient();

    try {
        await client.query("BEGIN");

        const sourceStock = await stockMovementsRepository.findOrCreateProductStockForUpdate(
            { organizationId, branchId: fromBranchId, productId },
            client
        );

        const fromQuantityAfter = Number(sourceStock.quantity) - quantity;
        if (fromQuantityAfter < 0) {
            throw new AppError(
                `Not enough stock at ${fromBranch.name} — only ${Number(sourceStock.quantity)} available.`,
                400
            );
        }

        await stockMovementsRepository.updateProductStockQuantity(sourceStock.id, fromQuantityAfter, client);
        await stockMovementsRepository.createStockMovement(
            {
                id: crypto.randomUUID(),
                organizationId,
                branchId: fromBranchId,
                productId,
                movementType: STOCK_MOVEMENT_TYPES.OUT,
                quantityChange: -quantity,
                quantityAfter: fromQuantityAfter,
                reason: reason || `Transfer to ${toBranch.name}`,
            },
            client
        );

        const consumedBatches = await stockMovementsRepository.consumeStockBatchesFEFO(
            { branchId: fromBranchId, productId, quantity },
            client
        );

        const destinationStock = await stockMovementsRepository.findOrCreateProductStockForUpdate(
            { organizationId, branchId: toBranchId, productId },
            client
        );

        const toQuantityAfter = Number(destinationStock.quantity) + quantity;
        await stockMovementsRepository.updateProductStockQuantity(destinationStock.id, toQuantityAfter, client);
        await stockMovementsRepository.createStockMovement(
            {
                id: crypto.randomUUID(),
                organizationId,
                branchId: toBranchId,
                productId,
                movementType: STOCK_MOVEMENT_TYPES.IN,
                quantityChange: quantity,
                quantityAfter: toQuantityAfter,
                reason: reason || `Transfer from ${fromBranch.name}`,
            },
            client
        );

        // Recreate the consumed batches at the destination so tracked expiry
        // dates follow the goods. Only the batch-tracked portion is carried;
        // any untracked remainder is already reflected in the aggregate above.
        for (const batch of consumedBatches) {
            await stockMovementsRepository.createStockBatch(
                {
                    organizationId,
                    branchId: toBranchId,
                    productId,
                    quantity: batch.quantityConsumed,
                    expiryDate: batch.expiryDate,
                },
                client
            );
        }

        await client.query("COMMIT");

        return {
            product: { id: product.id, name: product.name, sku: product.sku },
            fromBranch: { id: fromBranch.id, name: fromBranch.name },
            toBranch: { id: toBranch.id, name: toBranch.name },
            quantity,
            fromQuantityAfter,
            toQuantityAfter,
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
};

module.exports = {
    listStockMovements,
    createStockMovement,
    transferStock,
};
