/**
 * ============================================================
 * File: stock-shipments.routes.js
 * Module: Core Stock Shipments
 * ============================================================
 */

const express = require("express");
const controller = require("./stock-shipments.controller");
const asyncHandler = require("../../utils/asyncHandler");

const router = express.Router();

router.get("/", asyncHandler(controller.listShipments));
router.post("/", asyncHandler(controller.shipStock));
router.post("/:id/receive", asyncHandler(controller.receiveShipment));
router.post("/:id/cancel", asyncHandler(controller.cancelShipment));

module.exports = router;
