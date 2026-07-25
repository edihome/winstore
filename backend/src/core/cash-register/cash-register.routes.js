/**
 * ============================================================
 * File: cash-register.routes.js
 * Module: Core Cash Register
 *
 * Description:
 * Routes for cash register management.
 * ============================================================
 */

const express = require("express");
const controller = require("./cash-register.controller");
const asyncHandler = require("../../utils/asyncHandler");

const router = express.Router();

router.get("/", asyncHandler(controller.listCashRegisters));
router.post("/", asyncHandler(controller.createCashRegister));
router.get("/transactions", asyncHandler(controller.listCashTransactions));
router.post("/transactions", asyncHandler(controller.createCashTransaction));

module.exports = router;
