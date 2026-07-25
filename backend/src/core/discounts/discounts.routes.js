/**
 * ============================================================
 * File: discounts.routes.js
 * Module: Core Discounts
 * ============================================================
 */

const express = require("express");
const controller = require("./discounts.controller");
const { uploadSingleFile } = require("../../middlewares/upload");
const { requireRole } = require("../../middlewares/permission");

const router = express.Router();

router.get("/", controller.listDiscounts);
router.get("/import-template", controller.downloadImportTemplate);
router.post("/import", uploadSingleFile, controller.bulkImportDiscounts);
router.post("/", controller.createDiscount);
router.patch("/:id", controller.updateDiscountStatus);
router.delete("/:id", requireRole("developer"), controller.deleteDiscount);

module.exports = router;
