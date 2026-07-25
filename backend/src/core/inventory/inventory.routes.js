/**
 * ============================================================
 * File: inventory.routes.js
 * Module: Core Inventory
 * ============================================================
 */

const express = require("express");
const controller = require("./inventory.controller");

const router = express.Router();

router.get("/", controller.listProductStock);
router.get("/batches", controller.listStockBatches);
router.patch("/reorder-level", controller.updateReorderLevel);

module.exports = router;
