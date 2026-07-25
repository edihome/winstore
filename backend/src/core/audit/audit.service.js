/**
 * ============================================================
 * File: audit.service.js
 * Module: Core Audit
 *
 * Description:
 * Business logic for audit log management.
 * ============================================================
 */

const crypto = require("crypto");
const AppError = require("../../utils/AppError");
const { validateCreateAuditLog } = require("./audit.validation");
const auditRepository = require("./audit.repository");
const { totalFromRows } = require("../../utils/pagination");

const listAuditLogs = async (filters = {}) => {
    const rows = await auditRepository.listAuditLogs(filters);
    // Strip the window COUNT(*) that rides along on each row.
    const items = rows.map(({ total_count, ...row }) => row);
    if (filters.pagination) {
        return { items, total: totalFromRows(rows) };
    }
    return items;
};

const createAuditLog = async (payload) => {
    const validationErrors = validateCreateAuditLog(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    const log = await auditRepository.createAuditLog({
        id: crypto.randomUUID(),
        organizationId: payload.organizationId,
        userId: payload.userId || null,
        action: payload.action,
        entityType: payload.entityType || null,
        entityId: payload.entityId || null,
        metadata: payload.metadata || {},
    });

    return log;
};

module.exports = {
    listAuditLogs,
    createAuditLog,
};
