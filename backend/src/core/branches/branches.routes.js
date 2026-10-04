/**
 * ============================================================
 * File: branches.routes.js
 * Module: Core Branches
 *
 * Description:
 * Routes for branch management.
 * ============================================================
 */

const express = require("express");
const controller = require("./branches.controller");
const { uploadSingleFile } = require("../../middlewares/upload");

const router = express.Router();

router.get("/", controller.listBranches);
router.get("/import-template", controller.downloadImportTemplate);
router.post("/import", uploadSingleFile, controller.bulkImportBranches);
router.post("/", controller.createBranch);
router.post("/:id/setup-code", controller.createSetupCode);
router.patch("/:id", controller.updateBranch);

module.exports = router;
