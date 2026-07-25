/**
 * ============================================================
 * File: customers.routes.js
 * Module: Core Customers
 * ============================================================
 */

const express = require("express");
const controller = require("./customers.controller");
const ledgerController = require("../customer-ledger/customer-ledger.controller");
const { uploadSingleFile } = require("../../middlewares/upload");
const { requireRole } = require("../../middlewares/permission");

const router = express.Router();

router.get("/", controller.listCustomers);
router.get("/import-template", controller.downloadImportTemplate);
router.post("/import", uploadSingleFile, controller.bulkImportCustomers);
router.post("/", controller.createCustomer);
// Credit ledger: read a customer's statement (balance + entries), or post a
// payment/adjustment against it. Gated by the "customers" resource like the
// rest of this router (a payment is a customers:manage action).
router.get("/:id/ledger", ledgerController.getLedger);
router.post("/:id/ledger", ledgerController.recordEntry);
router.patch("/:id", controller.updateCustomer);
router.delete("/:id", requireRole("developer"), controller.deleteCustomer);

module.exports = router;
