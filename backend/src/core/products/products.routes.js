/**
 * ============================================================
 * File: products.routes.js
 * Module: Core Products
 *
 * Description:
 * Routes for product management.
 * ============================================================
 */

const express = require("express");
const controller = require("./products.controller");
const { uploadSingleFile } = require("../../middlewares/upload");
const { requireRole } = require("../../middlewares/permission");

const router = express.Router();

router.get("/", controller.listProducts);
router.get("/import-template", controller.downloadImportTemplate);
router.post("/import", uploadSingleFile, controller.bulkImportProducts);
router.post("/", controller.createProduct);
router.patch("/:id", controller.updateProduct);
// Hard delete is Developer-only — every other role only gets
// activate/deactivate via PATCH above. See utils/hardDelete.js.
router.delete("/:id", requireRole("developer"), controller.deleteProduct);

module.exports = router;
