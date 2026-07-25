/**
 * ============================================================
 * File: audit.repository.js
 * Module: Core Audit
 *
 * Description:
 * SQL repository methods for audit log management.
 * ============================================================
 */

const pool = require("../../config/db");
const { orderByClause, limitOffsetClause } = require("../../utils/pagination");

const AUDIT_SORTS = { createdAt: "created_at", action: "action", entityType: "entity_type" };

const listAuditLogs = async (filters = {}, client = pool) => {
    const { organizationId = "", pagination = null, sort = null } = filters;

    const params = [organizationId];
    const order = orderByClause(sort, AUDIT_SORTS, "created_at DESC");
    const { clause, params: pageParams } = limitOffsetClause(pagination, params.length + 1);

    const result = await client.query(
        `
            SELECT id, organization_id, user_id, action, entity_type, entity_id, metadata, created_at,
                   COUNT(*) OVER() AS total_count
            FROM audit_logs
            WHERE ($1::text = '' OR organization_id = $1::uuid)
            ${order}${clause}
        `,
        [...params, ...pageParams]
    );

    return result.rows;
};

const createAuditLog = async (auditData, client = pool) => {
    const result = await client.query(
        `
            INSERT INTO audit_logs (id, organization_id, user_id, action, entity_type, entity_id, metadata, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
            RETURNING id, organization_id, user_id, action, entity_type, entity_id, metadata, created_at
        `,
        [auditData.id, auditData.organizationId, auditData.userId || null, auditData.action, auditData.entityType || null, auditData.entityId || null, auditData.metadata || {}]
    );

    return result.rows[0];
};

module.exports = {
    listAuditLogs,
    createAuditLog,
};
