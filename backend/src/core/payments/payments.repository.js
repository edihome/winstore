/**
 * ============================================================
 * File: payments.repository.js
 * Module: Core Payments
 *
 * Description:
 * SQL repository methods for payment management. In normal use,
 * payments are created by sales.service as part of checkout — this
 * module's create path exists for recording payments outside that
 * flow (e.g. a follow-up payment against an existing sale).
 * ============================================================
 */

const pool = require("../../config/db");

const listPayments = async (filters = {}, client = pool) => {
    const { organizationId = "", saleId = "" } = filters;
    const result = await client.query(
        `
            SELECT id, organization_id, sale_id, reference, amount, method, status, created_by, created_at, updated_at
            FROM payments
            WHERE ($1::text = '' OR organization_id = $1::uuid)
              AND ($2::text = '' OR sale_id = $2::uuid)
            ORDER BY created_at DESC
        `,
        [organizationId, saleId]
    );

    return result.rows;
};

const createPayment = async (paymentData, client = pool) => {
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

module.exports = {
    listPayments,
    createPayment,
};
