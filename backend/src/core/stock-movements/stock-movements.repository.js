/**
 * ============================================================
 * File: stock-movements.repository.js
 * Module: Core Stock Movements
 *
 * Description:
 * SQL repository methods for stock movement management.
 * ============================================================
 */

const pool = require("../../config/db");
const { orderByClause, limitOffsetClause } = require("../../utils/pagination");

/**
 * Borrow a PostgreSQL client for transaction work.
 *
 * @returns {Promise<object>} PostgreSQL client.
 */
const getClient = () => pool.connect();

/**
 * Fetch stock movements with optional filters.
 *
 * @param {object} filters Query filters.
 * @param {object} client PostgreSQL client or pool.
 * @returns {Promise<object[]>} Stock movement database rows.
 */
const STOCK_MOVEMENT_SORTS = {
    createdAt: "sm.created_at",
    product: "p.name",
    type: "sm.movement_type",
    quantity: "sm.quantity_change",
};

const listStockMovements = async (filters = {}, client = pool) => {
    const { organizationId = "", branchId = "", productId = "", pagination = null, sort = null } = filters;

    const params = [organizationId, branchId, productId];
    const order = orderByClause(sort, STOCK_MOVEMENT_SORTS, "sm.created_at DESC");
    const { clause, params: pageParams } = limitOffsetClause(pagination, params.length + 1);

    const result = await client.query(
        `
            SELECT
                sm.id, sm.organization_id, sm.branch_id, sm.product_id,
                sm.movement_type, sm.quantity_change, sm.quantity_after, sm.reason, sm.created_at,
                p.name AS product_name, p.sku AS product_sku,
                COUNT(*) OVER() AS total_count
            FROM stock_movements sm
            INNER JOIN products p ON p.id = sm.product_id
            WHERE ($1::text = '' OR sm.organization_id = $1::uuid)
              AND ($2::text = '' OR sm.branch_id = $2::uuid)
              AND ($3::text = '' OR sm.product_id = $3::uuid)
            ${order}${clause}
        `,
        [...params, ...pageParams]
    );

    return result.rows;
};

/**
 * Ensure a product_stock row exists for this (branch, product) pair, then
 * lock it for update within the caller's transaction. Using an upsert
 * followed by a locking SELECT means the very first stock movement for a
 * product at a branch doesn't need a separate "initialize stock" step.
 *
 * @param {object} params { organizationId, branchId, productId }
 * @param {object} client PostgreSQL transaction client.
 * @returns {Promise<object>} Locked product_stock row.
 */
const findOrCreateProductStockForUpdate = async ({ organizationId, branchId, productId }, client) => {
    await client.query(
        `
            INSERT INTO product_stock (id, organization_id, branch_id, product_id, quantity, reorder_level, created_at, updated_at)
            VALUES (gen_random_uuid(), $1, $2, $3, 0, 0, NOW(), NOW())
            ON CONFLICT (branch_id, product_id) DO NOTHING
        `,
        [organizationId, branchId, productId]
    );

    const result = await client.query(
        `
            SELECT id, organization_id, branch_id, product_id, quantity, reorder_level
            FROM product_stock
            WHERE branch_id = $1 AND product_id = $2
            FOR UPDATE
        `,
        [branchId, productId]
    );

    return result.rows[0] || null;
};

/**
 * Update a product_stock row's quantity.
 *
 * @param {string} id product_stock row ID.
 * @param {number} quantity New quantity.
 * @param {object} client PostgreSQL transaction client.
 * @returns {Promise<object>} Updated product_stock row.
 */
const updateProductStockQuantity = async (id, quantity, client) => {
    const result = await client.query(
        `
            UPDATE product_stock
            SET quantity = $2, updated_at = NOW()
            WHERE id = $1
            RETURNING id, organization_id, branch_id, product_id, quantity, reorder_level
        `,
        [id, quantity]
    );

    return result.rows[0];
};

/**
 * Create a stock movement.
 *
 * @param {object} movementData Stock movement fields.
 * @param {object} client PostgreSQL client or pool.
 * @returns {Promise<object>} Created stock movement database row.
 */
const createStockMovement = async (movementData, client = pool) => {
    const result = await client.query(
        `
            INSERT INTO stock_movements (
                id, organization_id, branch_id, product_id,
                movement_type, quantity_change, quantity_after, reason, created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            RETURNING id, organization_id, branch_id, product_id, movement_type, quantity_change, quantity_after, reason, created_at
        `,
        [
            movementData.id,
            movementData.organizationId,
            movementData.branchId,
            movementData.productId,
            movementData.movementType,
            movementData.quantityChange,
            movementData.quantityAfter,
            movementData.reason || null,
        ]
    );

    return result.rows[0];
};

/**
 * Record a new stock batch (a stock-in with a known expiry date, or a
 * positive adjustment). product_stock.quantity is the untouched,
 * authoritative aggregate — this is a supplementary table for FEFO
 * tracking, only ever populated when an expiry date is actually supplied.
 *
 * @param {object} batchData { organizationId, branchId, productId, quantity, expiryDate }
 * @param {object} client PostgreSQL transaction client.
 * @returns {Promise<object>} Created stock_batches row.
 */
const createStockBatch = async ({ organizationId, branchId, productId, quantity, expiryDate }, client) => {
    const result = await client.query(
        `
            INSERT INTO stock_batches (
                id, organization_id, branch_id, product_id, quantity, expiry_date, received_at, created_at, updated_at
            )
            VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW(), NOW(), NOW())
            RETURNING id, organization_id, branch_id, product_id, quantity, expiry_date
        `,
        [organizationId, branchId, productId, quantity, expiryDate || null]
    );

    return result.rows[0];
};

/**
 * Consume up to `quantity` units from this (branch, product)'s batches,
 * oldest-expiry-first (nulls last, since a batch with no known expiry is
 * assumed to outlast one that does). Locks every candidate batch row
 * within the caller's transaction before touching any of them, so a
 * concurrent sale/movement for the same product can't double-spend the
 * same batch.
 *
 * Batches are a best-effort FEFO layer on top of the authoritative
 * aggregate quantity, not a hard ledger: stock received before this
 * feature shipped (or without an expiry date) has no batch row at all, so
 * it's normal for the batches found here to cover less than `quantity` —
 * whatever isn't covered is simply untracked stock leaving without an
 * attributed expiry. Never throws for insufficient batch coverage; the
 * aggregate-quantity check upstream is what guards against overselling.
 *
 * @param {object} params { organizationId, branchId, productId, quantity }
 * @param {object} client PostgreSQL transaction client.
 * @returns {Promise<object[]>} The batches consumed from, with how much was taken from each.
 */
const consumeStockBatchesFEFO = async ({ branchId, productId, quantity }, client) => {
    const { rows: batches } = await client.query(
        `
            SELECT id, quantity, expiry_date
            FROM stock_batches
            WHERE branch_id = $1 AND product_id = $2 AND quantity > 0
            ORDER BY expiry_date ASC NULLS LAST, received_at ASC
            FOR UPDATE
        `,
        [branchId, productId]
    );

    let remaining = quantity;
    const consumed = [];

    for (const batch of batches) {
        if (remaining <= 0) {
            break;
        }

        const takeFromBatch = Math.min(remaining, batch.quantity);
        const newQuantity = batch.quantity - takeFromBatch;

        await client.query(
            `UPDATE stock_batches SET quantity = $2, updated_at = NOW() WHERE id = $1`,
            [batch.id, newQuantity]
        );

        consumed.push({ batchId: batch.id, quantityConsumed: takeFromBatch, expiryDate: batch.expiry_date });
        remaining -= takeFromBatch;
    }

    return consumed;
};

module.exports = {
    getClient,
    listStockMovements,
    findOrCreateProductStockForUpdate,
    updateProductStockQuantity,
    createStockMovement,
    createStockBatch,
    consumeStockBatchesFEFO,
};
