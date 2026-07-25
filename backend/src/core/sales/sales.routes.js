/**
 * ============================================================
 * File: sales.routes.js
 * Module: Core Sales
 * ============================================================
 */

const express = require("express");
const controller = require("./sales.controller");

const router = express.Router();

router.get("/", controller.listSales);
router.get("/:id", controller.getSale);
router.post("/", controller.createSale);
// Return part or all of a paid sale (restock + refund). Same sales:manage
// gate and branch scope as the rest of the module.
router.post("/:id/returns", controller.createReturn);

module.exports = router;
