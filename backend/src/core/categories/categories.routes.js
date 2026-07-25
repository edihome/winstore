/**
 * ============================================================
 * File: categories.routes.js
 * Module: Core Categories
 *
 * Description:
 * Routes for category management.
 * ============================================================
 */

const express = require("express");
const controller = require("./categories.controller");
const asyncHandler = require("../../utils/asyncHandler");

const router = express.Router();

router.get("/", asyncHandler(controller.listCategories));
router.post("/", asyncHandler(controller.createCategory));

module.exports = router;
