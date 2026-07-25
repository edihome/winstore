/**
 * ============================================================
 * File: purchases.service.js
 * Module: Core Purchases
 *
 * Description:
 * Purchase orders: the business origin of stock. A purchase is
 * created "pending" (nothing happens to inventory), then either:
 *   - received  → every line item becomes a stock-in movement,
 *                 using the same row-locking path sales/stock
 *                 already use, in ONE transaction — so a purchase
 *                 is never half-received.
 *   - cancelled → terminal, inventory untouched.
 * Unit costs are snapshotted onto purchase_items at order time.
 * ============================================================
 */

const crypto = require("crypto");
const AppError = require("../../utils/AppError");
const { assertBranchAccessible } = require("../../utils/assertBranchAccessible");
const {
    PURCHASE_STATUSES,
    validateCreatePurchase,
    validateUpdatePurchaseStatus,
} = require("./purchases.validation");
const purchasesRepository = require("./purchases.repository");
const { totalFromRows } = require("../../utils/pagination");
const suppliersRepository = require("../suppliers/suppliers.repository");
const productsRepository = require("../products/products.repository");
const stockMovementsRepository = require("../stock-movements/stock-movements.repository");

const round2 = (value) => Math.round(value * 100) / 100;

const toPurchaseItemResponse = (row) => {
    if (!row) {
        return null;
    }

    return {
        id: row.id,
        purchaseId: row.purchase_id,
        productId: row.product_id,
        productName: row.product_name,
        productSku: row.product_sku,
        quantity: row.quantity,
        unitCost: Number(row.unit_cost),
        lineTotal: Number(row.line_total),
        expiryDate: row.expiry_date || null,
        createdAt: row.created_at,
    };
};

const toPurchaseResponse = (row) => {
    if (!row) {
        return null;
    }

    const mapped = {
        id: row.id,
        organizationId: row.organization_id,
        branchId: row.branch_id,
        supplierId: row.supplier_id,
        supplierName: row.supplier_name,
        totalAmount: Number(row.total_amount),
        status: row.status,
        createdBy: row.created_by,
        receivedAt: row.received_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };

    if (row.item_count !== undefined) {
        mapped.itemCount = Number(row.item_count);
    }
    if (row.items !== undefined) {
        mapped.items = row.items.map(toPurchaseItemResponse);
    }

    return mapped;
};

const listPurchases = async (filters = {}) => {
    const rows = await purchasesRepository.listPurchases(filters);
    const items = rows.map(toPurchaseResponse);
    if (filters.pagination) {
        return { items, total: totalFromRows(rows) };
    }
    return items;
};

const getPurchase = async (id, organizationId, accessibleBranchIds = null) => {
    const purchase = await purchasesRepository.findPurchaseById(id, organizationId);
    if (!purchase) {
        throw new AppError("Purchase not found.", 404);
    }
    assertBranchAccessible(purchase.branch_id, accessibleBranchIds, "Purchase not found.");
    return toPurchaseResponse(purchase);
};

const createPurchase = async (payload, actingUserId) => {
    const validationErrors = validateCreatePurchase(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    const supplier = await suppliersRepository.findSupplierById(payload.supplierId, payload.organizationId);
    if (!supplier || supplier.status !== "active") {
        throw new AppError("The selected supplier is not available.", 400);
    }

    // Resolve every product up front so a bad id fails the whole order
    // before anything is written.
    const resolvedItems = [];
    for (const item of payload.items) {
        const product = await productsRepository.findProductById(item.productId, payload.organizationId);
        if (!product) {
            throw new AppError("One of the selected products was not found.", 400);
        }

        const quantity = Number(item.quantity);
        const unitCost = round2(Number(item.unitCost));
        resolvedItems.push({
            productId: product.id,
            quantity,
            unitCost,
            lineTotal: round2(quantity * unitCost),
            expiryDate: item.expiryDate || null,
        });
    }

    const totalAmount = round2(resolvedItems.reduce((sum, item) => sum + item.lineTotal, 0));

    const client = await purchasesRepository.getClient();

    try {
        await client.query("BEGIN");

        const purchaseId = crypto.randomUUID();
        await purchasesRepository.createPurchase(
            {
                id: purchaseId,
                organizationId: payload.organizationId,
                branchId: payload.branchId,
                supplierId: payload.supplierId,
                totalAmount,
                status: PURCHASE_STATUSES.PENDING,
                createdBy: actingUserId,
            },
            client
        );

        for (const item of resolvedItems) {
            await purchasesRepository.createPurchaseItem(
                {
                    id: crypto.randomUUID(),
                    organizationId: payload.organizationId,
                    purchaseId,
                    ...item,
                },
                client
            );
        }

        await client.query("COMMIT");

        const purchase = await purchasesRepository.findPurchaseById(purchaseId, payload.organizationId);
        return toPurchaseResponse(purchase);
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
};

const updatePurchaseStatus = async (id, organizationId, payload, accessibleBranchIds = null) => {
    const validationErrors = validateUpdatePurchaseStatus(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    const existing = await purchasesRepository.findPurchaseById(id, organizationId);
    if (!existing) {
        throw new AppError("Purchase not found.", 404);
    }
    assertBranchAccessible(existing.branch_id, accessibleBranchIds, "Purchase not found.");

    // received/cancelled are terminal — same lifecycle rule as service
    // appointments: once settled, history can't be rewritten.
    if (existing.status !== PURCHASE_STATUSES.PENDING) {
        throw new AppError(`Cannot move a purchase from "${existing.status}" to "${payload.status}".`, 409);
    }

    if (payload.status === PURCHASE_STATUSES.CANCELLED) {
        const purchase = await purchasesRepository.updatePurchaseStatus(id, organizationId, payload.status, null);
        return toPurchaseResponse({ ...purchase, supplier_name: existing.supplier_name });
    }

    // Receiving: stock in every line item and flip the status in one
    // transaction, so the purchase can never be half-received.
    const client = await purchasesRepository.getClient();

    try {
        await client.query("BEGIN");

        for (const item of existing.items) {
            const stockRow = await stockMovementsRepository.findOrCreateProductStockForUpdate(
                {
                    organizationId,
                    branchId: existing.branch_id,
                    productId: item.product_id,
                },
                client
            );

            const quantityAfter = Number(stockRow.quantity) + item.quantity;
            await stockMovementsRepository.updateProductStockQuantity(stockRow.id, quantityAfter, client);
            await stockMovementsRepository.createStockMovement(
                {
                    id: crypto.randomUUID(),
                    organizationId,
                    branchId: existing.branch_id,
                    productId: item.product_id,
                    movementType: "in",
                    quantityChange: item.quantity,
                    quantityAfter,
                    reason: "Purchase received",
                },
                client
            );

            // Expiry was captured on the line item at order time, if the
            // supplier's shipment carried one — seed the FEFO batch now,
            // at the moment the stock actually enters the branch.
            if (item.expiry_date) {
                await stockMovementsRepository.createStockBatch(
                    {
                        organizationId,
                        branchId: existing.branch_id,
                        productId: item.product_id,
                        quantity: item.quantity,
                        expiryDate: item.expiry_date,
                    },
                    client
                );
            }
        }

        const purchase = await purchasesRepository.updatePurchaseStatus(
            id,
            organizationId,
            PURCHASE_STATUSES.RECEIVED,
            new Date(),
            client
        );

        await client.query("COMMIT");
        return toPurchaseResponse({ ...purchase, supplier_name: existing.supplier_name });
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
};

module.exports = {
    listPurchases,
    getPurchase,
    createPurchase,
    updatePurchaseStatus,
};
