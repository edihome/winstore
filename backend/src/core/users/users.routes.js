/**
 * ============================================================
 * File: users.routes.js
 * Module: Core Users
 *
 * Description:
 * Routes for user management.
 * ============================================================
 */

const express = require("express");
const controller = require("./users.controller");
const { uploadSingleFile } = require("../../middlewares/upload");
const { requireRole } = require("../../middlewares/permission");

const router = express.Router();

router.get("/", controller.listUsers);
router.get("/import-template", controller.downloadImportTemplate);
router.post("/import", uploadSingleFile, controller.bulkImportUsers);
router.post("/", controller.createUser);
router.patch("/:id", controller.updateUser);
router.patch("/:id/password", controller.resetPassword);
router.delete("/:id", requireRole("developer"), controller.deleteUser);

module.exports = router;
