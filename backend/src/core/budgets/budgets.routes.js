const express = require("express");
const controller = require("./budgets.controller");
const asyncHandler = require("../../utils/asyncHandler");

const router = express.Router();

router.get("/", asyncHandler(controller.listBudgets));
router.post("/", asyncHandler(controller.createBudget));

module.exports = router;
