/**
 * ============================================================
 * File: settings.routes.js
 * Module: Core Settings
 *
 * Description:
 * Routes for settings management.
 * ============================================================
 */

const express = require("express");
const controller = require("./settings.controller");

const router = express.Router();

router.get("/", controller.listSettings);
router.post("/", controller.createSetting);
router.patch("/", controller.updateSettings);

module.exports = router;
