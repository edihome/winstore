/**
 * ============================================================
 * File: stock-shipments.repository.js
 * Module: Core Stock Shipments
 *
 * SQL for the async cross-branch shipment lifecycle. All queries run under the
 * caller's org DB context (RLS), and the lifecycle mutations run inside the
 * transaction the service opens with stock-movements' getClient().
 * ============================================================
 */

const crypto = require("crypto");
const pool = require("../../config/db");

const createShipment = async (data, client = pool) => {
    const result = await client.query(
        `INSERT INTO stock_shipments
            (id, organization_id, product_id, from_branch_id, to_branch_id, quantity, status, reason, batches, shipped_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'in_transit', $7, $8::jsonb, $9)
         RETURNING *`,
        [
            crypto.randomUUID(),
            data.organizationId,
            data.productId,
            data.fromBranchId,
            data.toBranchId,
            data.quantity,
            data.reason || null,
            JSON.stringify(data.batches || []),
            data.shippedBy || null,
        ]
    );
    return result.rows[0];
};

/** Lock a shipment for a state transition (receive/cancel). */
const getForUpdate = async (id, client) => {
    const result = await client.query("SELECT * FROM stock_shipments WHERE id = $1 FOR UPDATE", [id]);
    return result.rows[0] || null;
};

const markReceived = async (id, receivedBy, client) => {
    const result = await client.query(
        `UPDATE stock_shipments SET status = 'received', received_by = $2, received_at = NOW()
         WHERE id = $1 RETURNING *`,
        [id, receivedBy || null]
    );
    return result.rows[0];
};

const markCancelled = async (id, client) => {
    const result = await client.query(
        `UPDATE stock_shipments SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1 RETURNING *`,
        [id]
    );
    return result.rows[0];
};

/**
 * List shipments for the org, joined to product + branch names, newest first.
 * Optional filters: status, and branch scoping (to the branches a caller may see).
 */
const listShipments = async ({ organizationId, status, branchIds }, client = pool) => {
    const params = [organizationId];
    let where = "s.organization_id = $1";
    if (status) {
        params.push(status);
        where += ` AND s.status = $${params.length}`;
    }
    if (Array.isArray(branchIds)) {
        params.push(branchIds);
        where += ` AND (s.from_branch_id = ANY($${params.length}) OR s.to_branch_id = ANY($${params.length}))`;
    }
    const result = await client.query(
        `SELECT s.*, p.name AS product_name, fb.name AS from_branch_name, tb.name AS to_branch_name
         FROM stock_shipments s
         JOIN products p ON p.id = s.product_id
         JOIN branches fb ON fb.id = s.from_branch_id
         JOIN branches tb ON tb.id = s.to_branch_id
         WHERE ${where}
         ORDER BY s.shipped_at DESC`,
        params
    );
    return result.rows;
};

module.exports = { createShipment, getForUpdate, markReceived, markCancelled, listShipments };
