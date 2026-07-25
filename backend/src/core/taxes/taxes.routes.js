/**
 * ============================================================
 * File: taxes.routes.js
 * Module: Core Taxes
 * ============================================================
 */

const express = require("express");
const controller = require("./taxes.controller");
const { uploadSingleFile } = require("../../middlewares/upload");
const { requireRole } = require("../../middlewares/permission");

const router = express.Router();

router.get("/", controller.listTaxes);
router.get("/import-template", controller.downloadImportTemplate);
router.post("/import", uploadSingleFile, controller.bulkImportTaxes);
router.post("/", controller.createTax);
router.patch("/:id", controller.updateTaxStatus);
router.delete("/:id", requireRole("developer"), controller.deleteTax);

module.exports = router;
