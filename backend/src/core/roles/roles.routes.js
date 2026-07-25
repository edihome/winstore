/**
 * ============================================================
 * File: roles.routes.js
 * Module: Core Roles
 *
 * Description:
 * Routes for role management. /catalog must be registered before
 * any future "/:id" route to avoid "catalog" being parsed as an id.
 * ============================================================
 */

const express = require("express");
const controller = require("./roles.controller");

const router = express.Router();

router.get("/catalog", controller.getCatalog);
router.get("/", controller.listRoles);
router.post("/", controller.createRole);
router.patch("/:id", controller.updateRole);

module.exports = router;
