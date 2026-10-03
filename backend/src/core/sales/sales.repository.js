/**
 * ============================================================
 * File: sales.repository.js
 * Module: Core Sales
 *
 * Description:
 * SQL repository methods for sales and sale items.
 * ============================================================
 */

const pool = require("../../config/db");
const { orderByClause, limitOffsetClause } = require("../../utils/pagination");

const getClient = () => pool.connect();

const SALE_SORTS = {
    createdAt: "s.created_at",
    total: "s.total_amount",
    customer: "c.name",
    status: "s.status",
};

const listSales = async (filters = {}, client = pool) => {
    const { organizationId = "", branchId = "", customerId = "", pagination = null, sort = null } = filters;

    const params = [organizationId, branchId, customerId];
    const order = orderByClause(sort, SALE_SORTS, "s.created_at DESC");
    const { clause, params: pageParams } = limitOffsetClause(pagination, params.length + 1);

    const result = await client.query(
        `
            SELECT
                s.id, s.organization_id, s.branch_id, s.customer_id,
                s.subtotal, s.discount_id, s.discount_amount, s.tax_amount, s.total_amount, s.status,
                s.returned_amount, s.change_given,
                s.created_by, s.created_at, s.updated_at,
                c.name AS customer_name,
                d.code AS discount_code,
                (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS item_count,
                COUNT(*) OVER() AS total_count
            FROM sales s
            LEFT JOIN customers c ON c.id = s.customer_id
            LEFT JOIN discounts d ON d.id = s.discount_id
            WHERE ($1::text = '' OR s.organization_id = $1::uuid)
              AND ($2::text = '' OR s.branch_id = $2::uuid)
              AND ($3::text = '' OR s.customer_id = $3::uuid)
            ${order}${clause}
        `,
        [...params, ...pageParams]
    );

    return result.rows;
};

const findSaleById = async (id, organizationId, client = pool, { forUpdate = false } = {}) => {
    const saleResult = await client.query(
        `
            SELECT
                s.id, s.organization_id, s.branch_id, s.customer_id,
                s.subtotal, s.discount_id, s.discount_amount, s.tax_amount, s.total_amount, s.status,
                s.returned_amount, s.change_given,
                s.created_by, s.created_at, s.updated_at,
                c.name AS customer_name,
                d.code AS discount_code,
                u.first_name AS cashier_first_name, u.last_name AS cashier_last_name
            FROM sales s
            LEFT JOIN customers c ON c.id = s.customer_id
            LEFT JOIN discounts d ON d.id = s.discount_id
            LEFT JOIN users u ON u.id = s.created_by
            WHERE s.id = $1 AND s.organization_id = $2
            LIMIT 1
            ${forUpdate ? "FOR UPDATE OF s" : ""}
        `,
        [id, organizationId]
    );

    const sale = saleResult.rows[0];
    if (!sale) {
        return null;
    }

    const itemsResult = await client.query(
        `
            SELECT id, sale_id, item_type, product_id, appointment_id, service_id,
                   description, quantity, unit_price, line_total, created_at
            FROM sale_items
            WHERE sale_id = $1
            ORDER BY created_at ASC
        `,
        [id]
    );

    const paymentsResult = await client.query(
        `
            SELECT id, sale_id, amount, method, status, reference, created_at
            FROM payments
            WHERE sale_id = $1
            ORDER BY created_at ASC
        `,
        [id]
    );

    return { ...sale, items: itemsResult.rows, payments: paymentsResult.rows };
};

const createSale = async (saleData, client) => {
    const result = await client.query(
        `
            INSERT INTO sales (
                id, organization_id, branch_id, customer_id,
                subtotal, discount_id, discount_amount, tax_amount, total_amount, status, created_by, change_given, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
            RETURNING id, organization_id, branch_id, customer_id,
                      subtotal, discount_id, discount_amount, tax_amount, total_amount, status, created_by, change_given, created_at, updated_at
        `,
        [
            saleData.id,
            saleData.organizationId,
            saleData.branchId,
            saleData.customerId,
            saleData.subtotal,
            saleData.discountId || null,
            saleData.discountAmount || 0,
            saleData.taxAmount || 0,
            saleData.totalAmount,
            saleData.status || "paid",
            saleData.createdBy,
            saleData.changeGiven || 0,
        ]
    );

    return result.rows[0];
};

const createSaleItem = async (itemData, client) => {
    const result = await client.query(
        `
            INSERT INTO sale_items (
                id, organization_id, sale_id, item_type, product_id, appointment_id, service_id,
                description, quantity, unit_price, line_total, created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
            RETURNING id, sale_id, item_type, product_id, appointment_id, service_id,
                      description, quantity, unit_price, line_total, created_at
        `,
        [
            itemData.id,
            itemData.organizationId,
            itemData.saleId,
            itemData.itemType,
            itemData.productId || null,
            itemData.appointmentId || null,
            itemData.serviceId || null,
            itemData.description,
            itemData.quantity,
            itemData.unitPrice,
            itemData.lineTotal,
        ]
    );

    return result.rows[0];
};

const createPayment = async (paymentData, client) => {
    const result = await client.query(
        `
            INSERT INTO payments (id, organization_id, sale_id, reference, amount, method, status, created_by, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
            RETURNING id, organization_id, sale_id, reference, amount, method, status, created_by, created_at, updated_at
        `,
        [
            paymentData.id,
            paymentData.organizationId,
            paymentData.saleId,
            paymentData.reference,
            paymentData.amount,
            paymentData.method || "cash",
            paymentData.status || "completed",
            paymentData.createdBy,
        ]
    );

    return result.rows[0];
};

const findSaleItemByAppointmentId = async (appointmentId, client = pool) => {
    const result = await client.query(
        `SELECT id, sale_id FROM sale_items WHERE appointment_id = $1 LIMIT 1`,
        [appointmentId]
    );

    return result.rows[0] || null;
};

/**
 * How much of each line item on a sale has already been returned, as a
 * { [saleItemId]: quantity } map — so a new return can never take back
 * more than was sold.
 */
const getReturnedQuantities = async (saleId, client = pool) => {
    const result = await client.query(
        `
            SELECT sri.sale_item_id, SUM(sri.quantity)::int AS returned
            FROM sale_return_items sri
            INNER JOIN sale_returns sr ON sr.id = sri.return_id
            WHERE sr.sale_id = $1
            GROUP BY sri.sale_item_id
        `,
        [saleId]
    );

    return Object.fromEntries(result.rows.map((row) => [row.sale_item_id, row.returned]));
};

const createSaleReturn = async (returnData, client) => {
    const result = await client.query(
        `
            INSERT INTO sale_returns (id, organization_id, branch_id, sale_id, total_refund, refund_method, reason, created_by, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            RETURNING id, organization_id, branch_id, sale_id, total_refund, refund_method, reason, created_by, created_at
        `,
        [
            returnData.id,
            returnData.organizationId,
            returnData.branchId,
            returnData.saleId,
            returnData.totalRefund,
            returnData.refundMethod || "cash",
            returnData.reason || null,
            returnData.createdBy || null,
        ]
    );

    return result.rows[0];
};

const createSaleReturnItem = async (itemData, client) => {
    const result = await client.query(
        `
            INSERT INTO sale_return_items (id, return_id, sale_item_id, quantity, line_refund, created_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
            RETURNING id, return_id, sale_item_id, quantity, line_refund
        `,
        [itemData.id, itemData.returnId, itemData.saleItemId, itemData.quantity, itemData.lineRefund]
    );

    return result.rows[0];
};

const incrementReturnedAmount = async (saleId, amount, client) => {
    await client.query(
        `UPDATE sales SET returned_amount = returned_amount + $2, updated_at = NOW() WHERE id = $1`,
        [saleId, amount]
    );
};

module.exports = {
    getClient,
    listSales,
    findSaleById,
    findSaleItemByAppointmentId,
    createSale,
    createSaleItem,
    createPayment,
    getReturnedQuantities,
    createSaleReturn,
    createSaleReturnItem,
    incrementReturnedAmount,
};
