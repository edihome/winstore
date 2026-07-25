/**
 * ============================================================
 * File: payments.routes.js
 * Module: Core Payments
 * ============================================================
 */

const express = require("express");
const controller = require("./payments.controller");

const router = express.Router();

router.get("/", controller.listPayments);
router.post("/", controller.createPayment);

module.exports = router;
