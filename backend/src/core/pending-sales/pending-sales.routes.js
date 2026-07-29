/**
 * ============================================================
 * File: pending-sales.routes.js
 * Module: Core Pending Sales
 * ============================================================
 */

const express = require("express");
const controller = require("./pending-sales.controller");

const router = express.Router();

router.get("/", controller.list);
router.post("/", controller.hold);
router.delete("/:id", controller.remove);

module.exports = router;
