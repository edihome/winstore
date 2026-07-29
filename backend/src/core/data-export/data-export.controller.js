/**
 * ============================================================
 * File: data-export.controller.js
 * Module: Core Data Export
 * ============================================================
 */

const crypto = require("crypto");
const asyncHandler = require("../../utils/asyncHandler");
const dataExportService = require("./data-export.service");
const auditRepository = require("../audit/audit.repository");

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// GET /data-export — one workbook of the whole org's data. super_admin only
// (gated at the mount). Streamed as an .xlsx download and written to the audit
// log, since bulk data export is a sensitive action.
const exportAll = asyncHandler(async (req, res) => {
    const { buffer, sheets } = await dataExportService.buildExportBuffer(req.user.organizationId);

    try {
        await auditRepository.createAuditLog({
            id: crypto.randomUUID(),
            organizationId: req.user.organizationId,
            userId: req.user.id,
            action: "data.exported",
            entityType: "organization",
            entityId: req.user.organizationId,
            metadata: { sheets, bytes: buffer.length },
        });
    } catch {
        /* never fail the export on an audit-log hiccup */
    }

    const date = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", XLSX_CONTENT_TYPE);
    res.setHeader("Content-Disposition", `attachment; filename="winstore-export-${date}.xlsx"`);
    return res.send(buffer);
});

module.exports = { exportAll };
