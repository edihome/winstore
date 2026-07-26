/**
 * ============================================================
 * File: stock-shipments.service.js
 * Module: Core Stock Shipments
 *
 * The async two-step cross-branch transfer, for when source and destination are
 * separate offline nodes. Each half updates ITS branch's stock through the same
 * app logic the rest of inventory uses, so the acting node's aggregate is always
 * right; the shipment record + movements sync so the other node learns of it.
 * ============================================================
 */

const crypto = require("crypto");
const AppError = require("../../utils/AppError");
const stockMovementsRepository = require("../stock-movements/stock-movements.repository");
const productsRepository = require("../products/products.repository");
const branchesRepository = require("../branches/branches.repository");
const { STOCK_MOVEMENT_TYPES } = require("../stock-movements/stock-movements.validation");
const shipmentsRepository = require("./stock-shipments.repository");

const asPositiveInt = (value) => {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
};

const assertBranchAccess = (accessibleBranchIds, branchId, label) => {
    if (accessibleBranchIds !== null && !accessibleBranchIds.includes(branchId)) {
        throw new AppError(`You do not have access to the ${label} branch.`, 403);
    }
};

/**
 * SHIP: stock leaves the source immediately (an OUT movement) and a shipment
 * record is created in_transit. Batches consumed FEFO ride along so tracked
 * expiry follows the goods.
 */
const shipStock = async (payload, accessibleBranchIds = null) => {
    const { organizationId, productId, fromBranchId, toBranchId, reason, shippedBy } = payload;
    const quantity = asPositiveInt(payload.quantity);

    if (!productId || !fromBranchId || !toBranchId) {
        throw new AppError("A product, source branch and destination branch are required.", 400);
    }
    if (fromBranchId === toBranchId) {
        throw new AppError("The source and destination branches must be different.", 400);
    }
    if (!quantity) {
        throw new AppError("Shipment quantity must be a positive whole number.", 400);
    }
    assertBranchAccess(accessibleBranchIds, fromBranchId, "source");

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
            throw new AppError(`Not enough stock at ${fromBranch.name} — only ${Number(sourceStock.quantity)} available.`, 400);
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
                reason: reason || `Shipment to ${toBranch.name}`,
            },
            client
        );

        const consumed = await stockMovementsRepository.consumeStockBatchesFEFO(
            { branchId: fromBranchId, productId, quantity },
            client
        );
        const batches = consumed.map((b) => ({ quantity: b.quantityConsumed, expiryDate: b.expiryDate }));

        const shipment = await shipmentsRepository.createShipment(
            { organizationId, productId, fromBranchId, toBranchId, quantity, reason, batches, shippedBy },
            client
        );

        await client.query("COMMIT");
        return shipment;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
};

/**
 * RECEIVE: the destination confirms arrival — stock lands (an IN movement),
 * tracked batches are recreated, and the shipment is marked received.
 */
const receiveShipment = async (shipmentId, { organizationId, receivedBy } = {}, accessibleBranchIds = null) => {
    const client = await stockMovementsRepository.getClient();
    try {
        await client.query("BEGIN");

        const shipment = await shipmentsRepository.getForUpdate(shipmentId, client);
        if (!shipment) {
            throw new AppError("Shipment not found.", 404);
        }
        if (shipment.status !== "in_transit") {
            throw new AppError(`This shipment is already ${shipment.status}.`, 400);
        }
        assertBranchAccess(accessibleBranchIds, shipment.to_branch_id, "destination");

        const quantity = Number(shipment.quantity);
        const destStock = await stockMovementsRepository.findOrCreateProductStockForUpdate(
            { organizationId, branchId: shipment.to_branch_id, productId: shipment.product_id },
            client
        );
        const toQuantityAfter = Number(destStock.quantity) + quantity;
        await stockMovementsRepository.updateProductStockQuantity(destStock.id, toQuantityAfter, client);
        await stockMovementsRepository.createStockMovement(
            {
                id: crypto.randomUUID(),
                organizationId,
                branchId: shipment.to_branch_id,
                productId: shipment.product_id,
                movementType: STOCK_MOVEMENT_TYPES.IN,
                quantityChange: quantity,
                quantityAfter: toQuantityAfter,
                reason: `Received shipment ${shipment.id.slice(0, 8)}`,
            },
            client
        );
        for (const batch of shipment.batches || []) {
            await stockMovementsRepository.createStockBatch(
                { organizationId, branchId: shipment.to_branch_id, productId: shipment.product_id, quantity: batch.quantity, expiryDate: batch.expiryDate },
                client
            );
        }

        const updated = await shipmentsRepository.markReceived(shipmentId, receivedBy, client);
        await client.query("COMMIT");
        return updated;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
};

/**
 * CANCEL: the source calls off an in_transit shipment; stock returns to it (an
 * IN movement back) and the shipment is marked cancelled.
 */
const cancelShipment = async (shipmentId, { organizationId } = {}, accessibleBranchIds = null) => {
    const client = await stockMovementsRepository.getClient();
    try {
        await client.query("BEGIN");

        const shipment = await shipmentsRepository.getForUpdate(shipmentId, client);
        if (!shipment) {
            throw new AppError("Shipment not found.", 404);
        }
        if (shipment.status !== "in_transit") {
            throw new AppError(`This shipment is already ${shipment.status}.`, 400);
        }
        assertBranchAccess(accessibleBranchIds, shipment.from_branch_id, "source");

        const quantity = Number(shipment.quantity);
        const sourceStock = await stockMovementsRepository.findOrCreateProductStockForUpdate(
            { organizationId, branchId: shipment.from_branch_id, productId: shipment.product_id },
            client
        );
        const backQuantity = Number(sourceStock.quantity) + quantity;
        await stockMovementsRepository.updateProductStockQuantity(sourceStock.id, backQuantity, client);
        await stockMovementsRepository.createStockMovement(
            {
                id: crypto.randomUUID(),
                organizationId,
                branchId: shipment.from_branch_id,
                productId: shipment.product_id,
                movementType: STOCK_MOVEMENT_TYPES.IN,
                quantityChange: quantity,
                quantityAfter: backQuantity,
                reason: `Cancelled shipment ${shipment.id.slice(0, 8)}`,
            },
            client
        );
        for (const batch of shipment.batches || []) {
            await stockMovementsRepository.createStockBatch(
                { organizationId, branchId: shipment.from_branch_id, productId: shipment.product_id, quantity: batch.quantity, expiryDate: batch.expiryDate },
                client
            );
        }

        const updated = await shipmentsRepository.markCancelled(shipmentId, client);
        await client.query("COMMIT");
        return updated;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
};

const listShipments = (filters, accessibleBranchIds = null) =>
    shipmentsRepository.listShipments({
        organizationId: filters.organizationId,
        status: filters.status,
        branchIds: accessibleBranchIds,
    });

module.exports = { shipStock, receiveShipment, cancelShipment, listShipments };
