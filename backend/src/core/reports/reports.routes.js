/**
 * ============================================================
 * File: reports.routes.js
 * Module: Core Reports
 * ============================================================
 */

const express = require("express");
const controller = require("./reports.controller");

const router = express.Router();

router.get("/summary", controller.getSummary);
router.get("/top-items", controller.getTopItems);
router.get("/revenue-trend", controller.getRevenueTrend);
router.get("/low-stock", controller.getLowStock);
router.get("/profit", controller.getProfit);
router.get("/sales-by-staff", controller.getSalesByStaff);
router.get("/cash-up", controller.getCashUp);
router.get("/profit-loss", controller.getProfitAndLoss);
router.get("/expiry", controller.getExpiry);
router.get("/inventory-value", controller.getInventoryValuation);
router.get("/sales-by-category", controller.getSalesByCategory);
router.get("/branch-comparison", controller.getBranchComparison);
router.get("/tax", controller.getTax);
router.get("/discounts", controller.getDiscounts);
router.get("/customers", controller.getCustomers);
router.get("/receivables", controller.getReceivables);

module.exports = router;
