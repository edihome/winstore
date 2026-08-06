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

/**
 * Current stock for a branch, listed PRODUCT-first.
 *
 * When a branch is given, this drives the merged Products & Stock page, so it
 * must list every product in the catalog — including ones with no
 * `product_stock` row at that branch yet (a product created elsewhere, or one
 * whose stock never moved). Those are genuinely "out of stock", i.e. quantity
 * 0, and they have to be visible: a product you cannot see is a product you
 * cannot receive stock for. Hence the LEFT JOIN — an INNER JOIN would hide
 * exactly the rows the user needs to act on.
 *
 * With no branch filter the old row-per-(branch, product) shape is kept, since
 * "every product across every branch" is a different question and callers
 * (reports, exports) already expect stock rows.
 */
const listProductStock = async (filters = {}, client = pool) => {
    const { organizationId = "", branchId = "" } = filters;

    if (branchId) {
        const result = await client.query(
            `
                SELECT
                    ps.id, p.organization_id, $2::uuid AS branch_id, p.id AS product_id,
                    COALESCE(ps.quantity, 0) AS quantity,
                    COALESCE(ps.reorder_level, 0) AS reorder_level,
                    COALESCE(ps.updated_at, p.updated_at) AS updated_at,
                    p.name AS product_name, p.sku AS product_sku,
                    p.barcode AS product_barcode, p.price AS product_price,
                    p.cost AS product_cost, p.status AS product_status,
                    c.name AS category_name,
                    b.name AS branch_name
                FROM products p
                LEFT JOIN product_stock ps ON ps.product_id = p.id AND ps.branch_id = $2::uuid
                LEFT JOIN categories c ON c.id = p.category_id
                LEFT JOIN branches b ON b.id = $2::uuid
                WHERE ($1::text = '' OR p.organization_id = $1::uuid)
                ORDER BY p.name ASC
            `,
            [organizationId, branchId]
        );

        return result.rows;
    }

    const result = await client.query(
        `
            SELECT
                ps.id, ps.organization_id, ps.branch_id, ps.product_id,
                ps.quantity, ps.reorder_level, ps.updated_at,
                p.name AS product_name, p.sku AS product_sku,
                p.barcode AS product_barcode, p.price AS product_price,
                p.cost AS product_cost, p.status AS product_status,
                c.name AS category_name,
                b.name AS branch_name
            FROM product_stock ps
            INNER JOIN products p ON p.id = ps.product_id
            INNER JOIN branches b ON b.id = ps.branch_id
            LEFT JOIN categories c ON c.id = p.category_id
            WHERE ($1::text = '' OR ps.organization_id = $1::uuid)
            ORDER BY p.name ASC
        `,
        [organizationId]
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
