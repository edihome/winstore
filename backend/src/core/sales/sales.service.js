/**
 * ============================================================
 * File: sales.service.js
 * Module: Core Sales
 *
 * Description:
 * Checkout: the transaction that ties Customers, Appointments,
 * Products, Stock, and Payments together into one invoice — this is
 * the platform's own stated goal ("one invoice for services and
 * products"), not previously implemented anywhere.
 *
 * For each line item:
 *   - product   → price comes from the product catalog (never trusted
 *                 from the client), and stock is deducted using the
 *                 same row-locking logic stock-movements already uses,
 *                 in the SAME transaction — so a sale and its stock
 *                 deduction always succeed or fail together.
 *   - service   → must reference a completed, not-yet-billed
 *                 appointment; price comes from the price already
 *                 snapshotted on that appointment at booking time.
 * ============================================================
 */

const crypto = require("crypto");
const AppError = require("../../utils/AppError");
const { assertBranchAccessible } = require("../../utils/assertBranchAccessible");
const { validateCreateSale, TENDER_METHODS } = require("./sales.validation");
const customerLedgerRepository = require("../customer-ledger/customer-ledger.repository");
const salesRepository = require("./sales.repository");
const productsRepository = require("../products/products.repository");
const stockMovementsRepository = require("../stock-movements/stock-movements.repository");
const discountsRepository = require("../discounts/discounts.repository");
const taxesRepository = require("../taxes/taxes.repository");
const appointmentsRepository = require("../../modules/appointments/appointments.repository");
const servicesRepository = require("../../modules/services/services.repository");
const { totalFromRows } = require("../../utils/pagination");

// NUMERIC columns come back as strings and float math can drift past two
// decimals — round every money figure at the point it's computed.
const round2 = (value) => Math.round(value * 100) / 100;

const toSaleItemResponse = (row) => {
    if (!row) {
        return null;
    }

    return {
        id: row.id,
        saleId: row.sale_id,
        itemType: row.item_type,
        productId: row.product_id,
        appointmentId: row.appointment_id,
        serviceId: row.service_id,
        description: row.description,
        quantity: row.quantity,
        unitPrice: Number(row.unit_price),
        lineTotal: Number(row.line_total),
        createdAt: row.created_at,
    };
};

const toPaymentResponse = (row) => {
    if (!row) {
        return null;
    }

    return {
        id: row.id,
        saleId: row.sale_id,
        amount: Number(row.amount),
        method: row.method,
        status: row.status,
        reference: row.reference,
        createdAt: row.created_at,
    };
};

const toSaleResponse = (row) => {
    if (!row) {
        return null;
    }

    const mapped = {
        id: row.id,
        organizationId: row.organization_id,
        branchId: row.branch_id,
        customerId: row.customer_id,
        customerName: row.customer_name || "Walk-in",
        cashierName:
            row.cashier_first_name || row.cashier_last_name
                ? `${row.cashier_first_name || ""} ${row.cashier_last_name || ""}`.trim()
                : null,
        subtotal: Number(row.subtotal),
        discountId: row.discount_id,
        discountCode: row.discount_code || null,
        discountAmount: Number(row.discount_amount),
        taxAmount: Number(row.tax_amount),
        totalAmount: Number(row.total_amount),
        changeGiven: Number(row.change_given || 0),
        status: row.status,
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };

    // Return status derived from how much of the sale's value has been
    // refunded — no extra column or status-constraint change needed.
    const returnedAmount = Number(row.returned_amount || 0);
    mapped.returnedAmount = returnedAmount;
    // 1-cent tolerance: proportional per-line refunds can round a hair
    // short of the total on a full return.
    mapped.returnStatus =
        returnedAmount <= 0 ? "none" : returnedAmount >= Number(row.total_amount) - 0.01 ? "full" : "partial";

    if (row.item_count !== undefined) {
        mapped.itemCount = Number(row.item_count);
    }
    if (row.items !== undefined) {
        mapped.items = row.items.map((item) => {
            const mappedItem = toSaleItemResponse(item);
            // returnedQuantities is attached by getSale below; when present,
            // expose how many of each line remain returnable.
            if (item.returned_quantity !== undefined) {
                mappedItem.returnedQuantity = item.returned_quantity;
                mappedItem.returnableQuantity = Math.max(0, item.quantity - item.returned_quantity);
            }
            return mappedItem;
        });
    }
    if (row.payments !== undefined) {
        mapped.payments = row.payments.map(toPaymentResponse);
    }

    return mapped;
};

const listSales = async (filters = {}) => {
    const rows = await salesRepository.listSales(filters);
    const items = rows.map(toSaleResponse);
    if (filters.pagination) {
        return { items, total: totalFromRows(rows) };
    }
    return items;
};

const getSale = async (id, organizationId, accessibleBranchIds = null) => {
    const sale = await salesRepository.findSaleById(id, organizationId);
    if (!sale) {
        throw new AppError("Sale not found.", 404);
    }
    assertBranchAccessible(sale.branch_id, accessibleBranchIds, "Sale not found.");

    // Annotate each line with how much has already been returned, so the
    // UI can offer the remaining returnable quantity.
    const returnedByItem = await salesRepository.getReturnedQuantities(id);
    sale.items = sale.items.map((item) => ({ ...item, returned_quantity: returnedByItem[item.id] || 0 }));

    return toSaleResponse(sale);
};

/**
 * Resolve one line item against the real catalog/appointment data and,
 * for products, deduct stock. Throws AppError on anything that would
 * make the line invalid (missing product, uncompleted/already-billed
 * appointment, insufficient stock).
 */
const resolveLineItem = async (item, context, client) => {
    const { organizationId, branchId, customerId } = context;

    if (item.itemType === "product") {
        const product = await productsRepository.findProductById(item.productId, organizationId);
        if (!product || product.status !== "active") {
            throw new AppError("One of the selected products is not available.", 400);
        }

        const quantity = Number(item.quantity);
        const unitPrice = Number(product.price);
        const lineTotal = quantity * unitPrice;

        const stockRow = await stockMovementsRepository.findOrCreateProductStockForUpdate(
            { organizationId, branchId, productId: product.id },
            client
        );

        const quantityAfter = Number(stockRow.quantity) - quantity;
        if (quantityAfter < 0) {
            throw new AppError(`Not enough stock for "${product.name}" to complete this sale.`, 409);
        }

        await stockMovementsRepository.updateProductStockQuantity(stockRow.id, quantityAfter, client);
        await stockMovementsRepository.consumeStockBatchesFEFO(
            { branchId, productId: product.id, quantity },
            client
        );
        await stockMovementsRepository.createStockMovement(
            {
                id: crypto.randomUUID(),
                organizationId,
                branchId,
                productId: product.id,
                movementType: "out",
                quantityChange: -quantity,
                quantityAfter,
                reason: "Sale",
            },
            client
        );

        return {
            itemType: "product",
            productId: product.id,
            appointmentId: null,
            description: product.name,
            quantity,
            unitPrice,
            lineTotal,
        };
    }

    // item.itemType === "service" — two ways to bill a service:

    // (1) Direct catalog service (walk-in): no appointment, price snapshotted
    // from the catalog. Sold like a product, quantity allowed.
    if (!item.appointmentId) {
        const service = await servicesRepository.findServiceById(item.serviceId, organizationId, client);
        if (!service || !service.is_active) {
            throw new AppError("One of the selected services is not available.", 400);
        }

        const quantity = Number(item.quantity) > 0 ? Number(item.quantity) : 1;
        const unitPrice = Number(service.price);

        return {
            itemType: "service",
            productId: null,
            appointmentId: null,
            serviceId: service.id,
            description: service.name,
            quantity,
            unitPrice,
            lineTotal: round2(quantity * unitPrice),
        };
    }

    // (2) A booked appointment being billed: must be completed, belong to
    // this sale's customer, and not already billed.
    const appointment = await appointmentsRepository.findAppointmentById(
        item.appointmentId,
        organizationId,
        client
    );
    if (!appointment) {
        throw new AppError("One of the selected appointments was not found.", 400);
    }
    if (appointment.status !== "completed") {
        throw new AppError("Only completed appointments can be billed.", 409);
    }

    if (appointment.customer_id !== customerId) {
        throw new AppError("This appointment belongs to a different customer.", 400);
    }

    const alreadyBilled = await salesRepository.findSaleItemByAppointmentId(appointment.id, client);
    if (alreadyBilled) {
        throw new AppError("This appointment has already been billed on another sale.", 409);
    }

    return {
        itemType: "service",
        productId: null,
        appointmentId: appointment.id,
        serviceId: null,
        description: "Service appointment",
        quantity: 1,
        unitPrice: Number(appointment.price),
        lineTotal: Number(appointment.price),
    };
};

/**
 * Resolve how the customer paid into (a) the payment rows to store — which
 * always sum EXACTLY to the sale total — and (b) the cash change to give
 * back. Accepts either a single `paymentMethod` (exact-total, the classic
 * path) or a `payments: [{ method, amount }]` array of tenders for split
 * payment and cash over-tender.
 *
 * Non-cash tenders (card/transfer/other) can never exceed the total — you
 * can't overcharge a card — the tenders together must at least cover the
 * total, and any surplus is cash change.
 *
 * @param {object} payload Sale payload (payments[] or paymentMethod).
 * @param {number} totalAmount The computed sale total.
 * @returns {{paymentRows: {method,amount}[], changeGiven: number}}
 */
const resolveTenders = (payload, totalAmount) => {
    const tenders =
        Array.isArray(payload.payments) && payload.payments.length > 0
            ? payload.payments.map((tender) => ({ method: tender.method, amount: round2(Number(tender.amount)) }))
            : [{ method: payload.paymentMethod || "cash", amount: totalAmount }];

    for (const tender of tenders) {
        if (!TENDER_METHODS.includes(tender.method)) {
            throw new AppError(`Payment method must be one of: ${TENDER_METHODS.join(", ")}.`, 400);
        }
        if (!Number.isFinite(tender.amount) || tender.amount <= 0) {
            throw new AppError("Each payment amount must be greater than zero.", 400);
        }
    }

    // "credit" = put on the customer's account (a receivable), not collected.
    // Everything non-cash (card/transfer/other/credit) can't exceed the total.
    const creditAmount = round2(tenders.filter((t) => t.method === "credit").reduce((sum, t) => sum + t.amount, 0));
    const nonCashTotal = round2(tenders.filter((t) => t.method !== "cash").reduce((sum, t) => sum + t.amount, 0));
    const totalTendered = round2(tenders.reduce((sum, t) => sum + t.amount, 0));

    if (nonCashTotal > totalAmount + 0.001) {
        throw new AppError("Card/transfer/credit payments cannot exceed the sale total.", 400);
    }
    if (totalTendered < totalAmount - 0.001) {
        throw new AppError("Amount tendered is less than the total due.", 400);
    }

    const cashApplied = round2(totalAmount - nonCashTotal); // cash needed to reach the total
    const changeGiven = round2(totalTendered - totalAmount); // cash surplus handed back

    // Payment rows are money COLLECTED only — credit is excluded here and
    // instead recorded as a charge on the customer's ledger (see createSale).
    // So Σ(paymentRows) === totalAmount − creditAmount.
    const paymentRows = tenders
        .filter((t) => t.method !== "cash" && t.method !== "credit")
        .map((t) => ({ method: t.method, amount: t.amount }));
    if (cashApplied > 0) {
        paymentRows.push({ method: "cash", amount: cashApplied });
    }

    return { paymentRows, changeGiven, creditAmount };
};

const createSale = async (payload, actingUserId) => {
    const validationErrors = validateCreateSale(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    const client = await salesRepository.getClient();

    try {
        await client.query("BEGIN");

        const resolvedItems = [];
        for (const item of payload.items) {
            // Sequential, not Promise.all: stock rows are locked one at a
            // time within this same transaction, and resolving items
            // concurrently would risk deadlocks when a sale contains the
            // same product twice.
            const resolved = await resolveLineItem(
                item,
                { organizationId: payload.organizationId, branchId: payload.branchId, customerId: payload.customerId || null },
                client
            );
            resolvedItems.push(resolved);
        }

        const subtotal = round2(resolvedItems.reduce((sum, item) => sum + item.lineTotal, 0));

        // Discount: a flat amount looked up by id, never trusted from the
        // client, clamped so a large discount can't push the total negative.
        let discountId = null;
        let discountAmount = 0;
        if (payload.discountId) {
            const discount = await discountsRepository.findDiscountById(
                payload.discountId,
                payload.organizationId,
                client
            );
            if (!discount || discount.status !== "active") {
                throw new AppError("The selected discount is not available.", 400);
            }
            discountId = discount.id;
            discountAmount = round2(Math.min(Number(discount.amount), subtotal));
        }

        // Tax: every active tax for the organization applies to the
        // discounted subtotal. The summed amount is snapshotted onto the
        // sale, so later rate changes never rewrite past invoices.
        const activeTaxes = await taxesRepository.listTaxes(
            { organizationId: payload.organizationId, status: "active" },
            client
        );
        const taxRate = activeTaxes.reduce((sum, tax) => sum + Number(tax.rate), 0);
        const taxAmount = round2(((subtotal - discountAmount) * taxRate) / 100);

        const totalAmount = round2(subtotal - discountAmount + taxAmount);

        // Split tender + cash change. Payment rows always reconcile to the
        // total; any cash over-tender is recorded as change_given.
        const { paymentRows, changeGiven, creditAmount } = resolveTenders(payload, totalAmount);

        const saleId = crypto.randomUUID();
        await salesRepository.createSale(
            {
                id: saleId,
                organizationId: payload.organizationId,
                branchId: payload.branchId,
                customerId: payload.customerId || null,
                subtotal,
                discountId,
                discountAmount,
                taxAmount,
                totalAmount,
                changeGiven,
                status: "paid",
                createdBy: actingUserId,
            },
            client
        );

        for (const item of resolvedItems) {
            await salesRepository.createSaleItem(
                {
                    id: crypto.randomUUID(),
                    organizationId: payload.organizationId,
                    saleId,
                    ...item,
                },
                client
            );
        }

        for (const row of paymentRows) {
            await salesRepository.createPayment(
                {
                    id: crypto.randomUUID(),
                    organizationId: payload.organizationId,
                    saleId,
                    reference: `SALE-${saleId.slice(0, 8).toUpperCase()}`,
                    amount: row.amount,
                    method: row.method,
                    status: "completed",
                    createdBy: actingUserId,
                },
                client
            );
        }

        // Sold on credit: the uncollected portion becomes a charge on the
        // customer's ledger, in the SAME transaction as the sale (so a sale
        // and its receivable commit or roll back together).
        if (creditAmount > 0) {
            // Enforce the customer's credit limit (if any) against their
            // balance after this sale — inside the transaction, on the locked
            // row, so two concurrent credit sales can't both slip under it.
            const profile = await customerLedgerRepository.getCreditProfile(
                payload.customerId,
                payload.organizationId,
                client
            );
            if (!profile) {
                throw new AppError("Customer not found for this credit sale.", 400);
            }
            if (profile.creditLimit !== null && round2(profile.balance + creditAmount) > profile.creditLimit + 0.001) {
                throw new AppError("This credit sale would exceed the customer's credit limit.", 400);
            }

            const charge = await customerLedgerRepository.recordEntry(
                {
                    id: crypto.randomUUID(),
                    organizationId: payload.organizationId,
                    customerId: payload.customerId,
                    entryType: "charge",
                    amount: creditAmount, // positive → increases what they owe
                    saleId,
                    createdBy: actingUserId,
                },
                client
            );
            if (!charge) {
                throw new AppError("Customer not found for this credit sale.", 400);
            }
        }

        await client.query("COMMIT");

        const sale = await salesRepository.findSaleById(saleId, payload.organizationId);
        return toSaleResponse(sale);
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
};

// "credit" refunds to the customer's account (reduces what they owe) instead
// of paying cash back — the mirror of a credit sale.
const REFUND_METHODS = ["cash", "card", "transfer", "other", "credit"];

/**
 * Return part or all of a paid sale: restock the returned products
 * (services can't be un-delivered, so they're refunded but not
 * restocked), record the refund, and advance the sale's returned_amount.
 * The refund per line is PROPORTIONAL to the sale total — it nets out
 * the sale-level discount and tax the customer actually paid, so a full
 * return refunds exactly the total.
 *
 * @param {object} payload { saleId, organizationId, items:[{saleItemId, quantity}], reason, refundMethod }.
 * @param {string} actingUserId Who processed the return.
 * @param {string[]|null} accessibleBranchIds Branch scope of the caller.
 * @returns {Promise<object>} { refund, sale }.
 */
const createReturn = async (payload, actingUserId, accessibleBranchIds = null) => {
    if (!Array.isArray(payload.items) || payload.items.length === 0) {
        throw new AppError("Select at least one item to return.", 400);
    }
    if (payload.refundMethod !== undefined && !REFUND_METHODS.includes(payload.refundMethod)) {
        throw new AppError(`refundMethod must be one of: ${REFUND_METHODS.join(", ")}.`, 400);
    }

    const client = await salesRepository.getClient();

    try {
        await client.query("BEGIN");

        const sale = await salesRepository.findSaleById(payload.saleId, payload.organizationId, client);
        if (!sale) {
            throw new AppError("Sale not found.", 404);
        }
        assertBranchAccessible(sale.branch_id, accessibleBranchIds, "Sale not found.");
        if (sale.status !== "paid") {
            throw new AppError("Only a paid sale can be returned.", 409);
        }

        const returnedByItem = await salesRepository.getReturnedQuantities(sale.id, client);
        const saleItemsById = Object.fromEntries(sale.items.map((item) => [item.id, item]));
        const subtotal = Number(sale.subtotal);

        const returnId = crypto.randomUUID();
        const resolvedReturnItems = [];
        let totalRefund = 0;

        for (const requested of payload.items) {
            const saleItem = saleItemsById[requested.saleItemId];
            if (!saleItem) {
                throw new AppError("A returned item does not belong to this sale.", 400);
            }
            const quantity = Number(requested.quantity);
            if (!Number.isInteger(quantity) || quantity <= 0) {
                throw new AppError("Return quantity must be a positive whole number.", 400);
            }
            const returnable = saleItem.quantity - (returnedByItem[saleItem.id] || 0);
            if (quantity > returnable) {
                throw new AppError(
                    `Cannot return more than remains for "${saleItem.description}" (${returnable} left).`,
                    409
                );
            }

            // Proportional refund: this line's share of the pre-discount
            // subtotal, applied to the amount actually paid (post discount + tax).
            const grossLine = quantity * Number(saleItem.unit_price);
            const proportion = subtotal > 0 ? grossLine / subtotal : 0;
            const lineRefund = round2(proportion * Number(sale.total_amount));
            totalRefund = round2(totalRefund + lineRefund);

            // Restock products only — a completed service can't go back.
            if (saleItem.item_type === "product" && saleItem.product_id) {
                const stockRow = await stockMovementsRepository.findOrCreateProductStockForUpdate(
                    { organizationId: sale.organization_id, branchId: sale.branch_id, productId: saleItem.product_id },
                    client
                );
                const quantityAfter = Number(stockRow.quantity) + quantity;
                await stockMovementsRepository.updateProductStockQuantity(stockRow.id, quantityAfter, client);
                await stockMovementsRepository.createStockMovement(
                    {
                        id: crypto.randomUUID(),
                        organizationId: sale.organization_id,
                        branchId: sale.branch_id,
                        productId: saleItem.product_id,
                        movementType: "in",
                        quantityChange: quantity,
                        quantityAfter,
                        reason: "Sale return",
                    },
                    client
                );
            }

            resolvedReturnItems.push({ saleItemId: saleItem.id, quantity, lineRefund });
        }

        const saleReturn = await salesRepository.createSaleReturn(
            {
                id: returnId,
                organizationId: sale.organization_id,
                branchId: sale.branch_id,
                saleId: sale.id,
                totalRefund,
                refundMethod: payload.refundMethod || "cash",
                reason: payload.reason ? String(payload.reason).trim() : null,
                createdBy: actingUserId,
            },
            client
        );

        for (const returnItem of resolvedReturnItems) {
            await salesRepository.createSaleReturnItem({ id: crypto.randomUUID(), returnId, ...returnItem }, client);
        }

        await salesRepository.incrementReturnedAmount(sale.id, totalRefund, client);

        // Refund to account: instead of paying cash back, reduce what the
        // customer owes on their ledger (the mirror of a credit sale). Posted
        // in this same transaction so the restock, the return, and the balance
        // change all commit or roll back together.
        if ((payload.refundMethod || "cash") === "credit") {
            if (!sale.customer_id) {
                throw new AppError("This sale has no customer, so it can't be refunded to an account.", 400);
            }
            const entry = await customerLedgerRepository.recordEntry(
                {
                    id: crypto.randomUUID(),
                    organizationId: sale.organization_id,
                    customerId: sale.customer_id,
                    entryType: "adjustment",
                    amount: round2(-totalRefund), // reduces what they owe
                    saleId: sale.id,
                    note: "Refund to account",
                    createdBy: actingUserId,
                },
                client
            );
            if (!entry) {
                throw new AppError("Customer not found for refund to account.", 400);
            }
        }

        await client.query("COMMIT");

        const refreshed = await salesRepository.findSaleById(sale.id, sale.organization_id);
        return {
            refund: {
                id: saleReturn.id,
                totalRefund: Number(saleReturn.total_refund),
                refundMethod: saleReturn.refund_method,
                reason: saleReturn.reason,
                createdAt: saleReturn.created_at,
            },
            sale: toSaleResponse(refreshed),
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
};

module.exports = {
    listSales,
    getSale,
    createSale,
    createReturn,
};
