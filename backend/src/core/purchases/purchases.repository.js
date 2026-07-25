/**
 * ============================================================
 * File: purchases.repository.js
 * Module: Core Purchases
 *
 * Description:
 * SQL repository methods for purchases and purchase items.
 * ============================================================
 */

const pool = require("../../config/db");
const { orderByClause, limitOffsetClause } = require("../../utils/pagination");

const getClient = () => pool.connect();

const PURCHASE_SORTS = { createdAt: "p.created_at", total: "p.total_amount", supplier: "s.name", status: "p.status" };

const listPurchases = async (filters = {}, client = pool) => {
    const { organizationId = "", branchId = "", status = "", pagination = null, sort = null } = filters;

    const params = [organizationId, branchId, status];
    const order = orderByClause(sort, PURCHASE_SORTS, "p.created_at DESC");
    const { clause, params: pageParams } = limitOffsetClause(pagination, params.length + 1);

    const result = await client.query(
        `
            SELECT
                p.id, p.organization_id, p.branch_id, p.supplier_id,
                p.total_amount, p.status, p.created_by, p.received_at,
                p.created_at, p.updated_at,
                s.name AS supplier_name,
                (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id) AS item_count,
                COUNT(*) OVER() AS total_count
            FROM purchases p
            INNER JOIN suppliers s ON s.id = p.supplier_id
            WHERE ($1::text = '' OR p.organization_id = $1::uuid)
              AND ($2::text = '' OR p.branch_id = $2::uuid)
              AND ($3::text = '' OR p.status = $3)
            ${order}${clause}
        `,
        [...params, ...pageParams]
    );

    return result.rows;
};

const findPurchaseById = async (id, organizationId, client = pool) => {
    const purchaseResult = await client.query(
        `
            SELECT
                p.id, p.organization_id, p.branch_id, p.supplier_id,
                p.total_amount, p.status, p.created_by, p.received_at,
                p.created_at, p.updated_at,
                s.name AS supplier_name
            FROM purchases p
            INNER JOIN suppliers s ON s.id = p.supplier_id
            WHERE p.id = $1 AND p.organization_id = $2
            LIMIT 1
        `,
        [id, organizationId]
    );

    const purchase = purchaseResult.rows[0];
    if (!purchase) {
        return null;
    }

    const itemsResult = await client.query(
        `
            SELECT pi.id, pi.purchase_id, pi.product_id, pi.quantity, pi.unit_cost, pi.line_total,
                   pi.expiry_date, pi.created_at,
                   pr.name AS product_name, pr.sku AS product_sku
            FROM purchase_items pi
            INNER JOIN products pr ON pr.id = pi.product_id
            WHERE pi.purchase_id = $1
            ORDER BY pi.created_at ASC
        `,
        [id]
    );

    return { ...purchase, items: itemsResult.rows };
};

const createPurchase = async (purchaseData, client) => {
    const result = await client.query(
        `
            INSERT INTO purchases (
                id, organization_id, branch_id, supplier_id,
                total_amount, status, created_by, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
            RETURNING id, organization_id, branch_id, supplier_id,
                      total_amount, status, created_by, received_at, created_at, updated_at
        `,
        [
            purchaseData.id,
            purchaseData.organizationId,
            purchaseData.branchId,
            purchaseData.supplierId,
            purchaseData.totalAmount,
            purchaseData.status || "pending",
            purchaseData.createdBy,
        ]
    );

    return result.rows[0];
};

const createPurchaseItem = async (itemData, client) => {
    const result = await client.query(
        `
            INSERT INTO purchase_items (
                id, organization_id, purchase_id, product_id, quantity, unit_cost, line_total, expiry_date, created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            RETURNING id, purchase_id, product_id, quantity, unit_cost, line_total, expiry_date, created_at
        `,
        [
            itemData.id,
            itemData.organizationId,
            itemData.purchaseId,
            itemData.productId,
            itemData.quantity,
            itemData.unitCost,
            itemData.lineTotal,
            itemData.expiryDate || null,
        ]
    );

    return result.rows[0];
};

const updatePurchaseStatus = async (id, organizationId, status, receivedAt, client = pool) => {
    const result = await client.query(
        `
            UPDATE purchases
            SET status = $3, received_at = COALESCE($4, received_at), updated_at = NOW()
            WHERE id = $1 AND organization_id = $2
            RETURNING id, organization_id, branch_id, supplier_id,
                      total_amount, status, created_by, received_at, created_at, updated_at
        `,
        [id, organizationId, status, receivedAt]
    );

    return result.rows[0] || null;
};

module.exports = {
    getClient,
    listPurchases,
    findPurchaseById,
    createPurchase,
    createPurchaseItem,
    updatePurchaseStatus,
};
