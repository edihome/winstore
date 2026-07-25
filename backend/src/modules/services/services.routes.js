/**
 * ============================================================
 * File: services.routes.js
 * Module: Services
 *
 * Description:
 * Routes for the service catalog.
 * ============================================================
 */

const express = require("express");
const controller = require("./services.controller");
const { uploadSingleFile } = require("../../middlewares/upload");
const { requireRole } = require("../../middlewares/permission");

const router = express.Router();

router.get("/", controller.listServices);
router.get("/import-template", controller.downloadImportTemplate);
router.post("/import", uploadSingleFile, controller.bulkImportServices);
router.post("/", controller.createService);
router.patch("/:id", controller.updateService);
router.delete("/:id", requireRole("developer"), controller.deleteService);

module.exports = router;
