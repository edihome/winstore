/**
 * ============================================================
 * File: stock-movements.routes.js
 * Module: Core Stock Movements
 *
 * Description:
 * Routes for stock movement management.
 * ============================================================
 */

const express = require("express");
const controller = require("./stock-movements.controller");
const asyncHandler = require("../../utils/asyncHandler");
const { uploadSingleFile } = require("../../middlewares/upload");

const router = express.Router();

router.get("/", asyncHandler(controller.listStockMovements));
router.get("/import-template", controller.downloadImportTemplate);
router.post("/import", uploadSingleFile, controller.bulkImportStockMovements);
router.post("/transfer", asyncHandler(controller.transferStock));
router.post("/", asyncHandler(controller.createStockMovement));

module.exports = router;
