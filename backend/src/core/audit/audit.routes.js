/**
 * ============================================================
 * File: audit.routes.js
 * Module: Core Audit
 *
 * Description:
 * Routes for audit log management.
 * ============================================================
 */

const express = require("express");
const controller = require("./audit.controller");

const router = express.Router();

// Read-only by design. Audit entries are written only by internal
// service code, never over HTTP — see audit.controller.js.
router.get("/", controller.listAuditLogs);

module.exports = router;
