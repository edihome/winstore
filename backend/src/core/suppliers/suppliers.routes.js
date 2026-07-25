/**
 * ============================================================
 * File: suppliers.routes.js
 * Module: Core Suppliers
 * ============================================================
 */

const express = require("express");
const controller = require("./suppliers.controller");
const { uploadSingleFile } = require("../../middlewares/upload");
const { requireRole } = require("../../middlewares/permission");

const router = express.Router();

router.get("/", controller.listSuppliers);
router.get("/import-template", controller.downloadImportTemplate);
router.post("/import", uploadSingleFile, controller.bulkImportSuppliers);
router.post("/", controller.createSupplier);
router.patch("/:id", controller.updateSupplier);
router.delete("/:id", requireRole("developer"), controller.deleteSupplier);

module.exports = router;
