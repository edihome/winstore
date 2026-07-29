/**
 * ============================================================
 * File: pending-sales.repository.js
 * Module: Core Pending Sales (held / parked carts)
 * ============================================================
 */

const pool = require("../../config/db");

const create = async (data, client = pool) => {
    const result = await client.query(
        `INSERT INTO pending_sales
            (organization_id, branch_id, created_by, label, item_count, total, cart, customer_id, discount_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
         RETURNING *`,
        [
            data.organizationId,
            data.branchId,
            data.createdBy || null,
            data.label || null,
            data.itemCount || 0,
            data.total || 0,
            JSON.stringify(data.cart || []),
            data.customerId || null,
            data.discountId || null,
        ]
    );
    return result.rows[0];
};

/**
 * A user's OWN held sales (each cashier/admin sees only their own), optionally
 * filtered to one branch, newest first.
 */
const list = async (organizationId, branchId, userId, client = pool) => {
    const result = await client.query(
        `SELECT p.*, TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS cashier_name
         FROM pending_sales p
         LEFT JOIN users u ON u.id = p.created_by
         WHERE p.organization_id = $1 AND p.created_by = $2 AND ($3::uuid IS NULL OR p.branch_id = $3::uuid)
         ORDER BY p.created_at DESC`,
        [organizationId, userId, branchId || null]
    );
    return result.rows;
};

/** Remove a held sale — only the user's own (id + created_by both must match). */
const remove = async (id, userId, client = pool) => {
    const result = await client.query("DELETE FROM pending_sales WHERE id = $1 AND created_by = $2 RETURNING id", [id, userId]);
    return result.rowCount > 0;
};

module.exports = { create, list, remove };
