/**
 * ============================================================
 * File: inventory.repository.js
 * Module: Core Inventory
 *
 * Description:
 * Read-side SQL for current stock levels. Stock quantities are only
 * ever mutated through the stock-movements module (see that module's
 * findOrCreateProductStockForUpdate) so every change is auditable —
 * this module is intentionally list-only.
 * ============================================================
 */

const pool = require("../../config/db");

/**
 * Create or update the reorder level for a (branch, product) pair. A
 * single atomic upsert, not a lock-then-update — reorder level is a
 * threshold setting, not a quantity balance, so there's no concurrent
 * read-modify-write race to protect against the way there is for
 * quantity changes.
 */
const upsertReorderLevel = async ({ organizationId, branchId, productId, reorderLevel }, client = pool) => {
    const result = await client.query(
        `
            INSERT INTO product_stock (id, organization_id, branch_id, product_id, quantity, reorder_level, created_at, updated_at)
            VALUES (gen_random_uuid(), $1, $2, $3, 0, $4, NOW(), NOW())
            ON CONFLICT (branch_id, product_id) DO UPDATE SET reorder_level = $4, updated_at = NOW()
            RETURNING id, organization_id, branch_id, product_id, quantity, reorder_level, updated_at
        `,
        [organizationId, branchId, productId, reorderLevel]
    );

    return result.rows[0];
};

const listProductStock = async (filters = {}, client = pool) => {
    const { organizationId = "", branchId = "" } = filters;

    const result = await client.query(
        `
            SELECT
                ps.id, ps.organization_id, ps.branch_id, ps.product_id,
                ps.quantity, ps.reorder_level, ps.updated_at,
                p.name AS product_name, p.sku AS product_sku,
                b.name AS branch_name
            FROM product_stock ps
            INNER JOIN products p ON p.id = ps.product_id
            INNER JOIN branches b ON b.id = ps.branch_id
            WHERE ($1::text = '' OR ps.organization_id = $1::uuid)
              AND ($2::text = '' OR ps.branch_id = $2::uuid)
            ORDER BY p.name ASC
        `,
        [organizationId, branchId]
    );

    return result.rows;
};

/**
 * List stock batches that still have quantity remaining, soonest expiry
 * first (nulls last) — the "what's expiring soon" view.
 */
const listStockBatches = async (filters = {}, client = pool) => {
    const { organizationId = "", branchId = "" } = filters;

    const result = await client.query(
        `
            SELECT
                sb.id, sb.organization_id, sb.branch_id, sb.product_id,
                sb.quantity, sb.expiry_date, sb.received_at,
                p.name AS product_name, p.sku AS product_sku,
                b.name AS branch_name
            FROM stock_batches sb
            INNER JOIN products p ON p.id = sb.product_id
            INNER JOIN branches b ON b.id = sb.branch_id
            WHERE sb.quantity > 0
              AND ($1::text = '' OR sb.organization_id = $1::uuid)
              AND ($2::text = '' OR sb.branch_id = $2::uuid)
            ORDER BY sb.expiry_date ASC NULLS LAST, sb.received_at ASC
        `,
        [organizationId, branchId]
    );

    return result.rows;
};

module.exports = {
    listProductStock,
    upsertReorderLevel,
    listStockBatches,
};
