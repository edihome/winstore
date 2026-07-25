/**
 * ============================================================
 * File: sync.routes.js
 * Module: Core Sync
 * ============================================================
 */

const express = require("express");
const controller = require("./sync.controller");

const router = express.Router();

router.get("/status", controller.getStatus);
router.get("/changes", controller.getChanges);
router.post("/apply", controller.applyChanges);
router.post("/run", controller.run);

module.exports = router;
