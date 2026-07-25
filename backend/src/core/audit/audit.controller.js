/**
 * ============================================================
 * File: audit.controller.js
 * Module: Core Audit
 *
 * Description:
 * HTTP controller for audit log endpoints.
 * ============================================================
 */

const asyncHandler = require("../../utils/asyncHandler");
const { success, paginated } = require("../../utils/response");
const { parsePagination, parseSort, buildPageMeta } = require("../../utils/pagination");
const auditService = require("./audit.service");

const listAuditLogs = asyncHandler(async (req, res) => {
    const pagination = parsePagination(req.query);
    const result = await auditService.listAuditLogs({
        organizationId: req.query.organizationId,
        pagination,
        sort: parseSort(req.query),
    });
    if (pagination) {
        return paginated(res, "Audit logs retrieved successfully.", result.items, buildPageMeta(pagination, result.total));
    }
    return success(res, "Audit logs retrieved successfully.", result, 200);
});

// There is deliberately NO create handler. Audit entries are written
// only by internal service code (auth.service, organizations.service,
// … calling auditRepository.createAuditLog directly, inside the same
// transaction as the action they record). Exposing a client-writable
// POST /audit let any holder of audit:manage forge entries attributing
// actions to other users — an audit trail you can write to arbitrarily
// proves nothing. Reads stay available for review.

module.exports = {
    listAuditLogs,
};
