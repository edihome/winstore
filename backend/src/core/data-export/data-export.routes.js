/**
 * ============================================================
 * File: data-export.routes.js
 * Module: Core Data Export
 * ============================================================
 */

const express = require("express");
const controller = require("./data-export.controller");

const router = express.Router();

router.get("/", controller.exportAll);

module.exports = router;
