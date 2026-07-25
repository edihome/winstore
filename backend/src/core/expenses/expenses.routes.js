/**
 * ============================================================
 * File: expenses.routes.js
 * Module: Core Expenses
 * ============================================================
 */

const express = require("express");
const controller = require("./expenses.controller");
const { uploadSingleFile } = require("../../middlewares/upload");

const router = express.Router();

router.get("/", controller.listExpenses);
router.get("/import-template", controller.downloadImportTemplate);
router.post("/import", uploadSingleFile, controller.bulkImportExpenses);
router.post("/", controller.createExpense);
router.patch("/:id/status", controller.updateExpenseStatus);

module.exports = router;
