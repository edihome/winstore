/**
 * ============================================================
 * File: organizations.routes.js
 * Module: Core Organizations
 *
 * Description:
 * Routes for organization management.
 * ============================================================
 */

const express = require("express");
const controller = require("./organizations.controller");

const router = express.Router();

router.get("/", controller.listOrganizations);
router.post("/", controller.createOrganization);
router.patch("/:id", controller.updateOrganization);
router.delete("/:id", controller.deleteOrganization);
router.get("/:id/payments", controller.listSubscriptionPayments);
router.post("/:id/payments", controller.recordSubscriptionPayment);

module.exports = router;
