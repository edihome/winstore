/**
 * ============================================================
 * File: permissions.routes.js
 * Module: Core Permissions
 *
 * Description:
 * Routes for permission management.
 * ============================================================
 */

const express = require("express");
const controller = require("./permissions.controller");

const router = express.Router();

router.get("/", controller.listPermissions);
router.post("/", controller.createPermission);

module.exports = router;
