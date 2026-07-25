/**
 * ============================================================
 * File: purchases.routes.js
 * Module: Core Purchases
 * ============================================================
 */

const express = require("express");
const controller = require("./purchases.controller");

const router = express.Router();

router.get("/", controller.listPurchases);
router.get("/:id", controller.getPurchase);
router.post("/", controller.createPurchase);
router.patch("/:id/status", controller.updatePurchaseStatus);

module.exports = router;
