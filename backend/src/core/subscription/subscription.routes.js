/**
 * ============================================================
 * File: subscription.routes.js
 * Module: Core Subscription
 *
 * Description:
 * Tenant-facing subscription route. Role-gated at the mount in
 * routes/index.js (super_admin/developer), and deliberately on the
 * SUBSCRIPTION_LOCKED_ALLOWLIST in middlewares/auth.js — a locked
 * session exists precisely to reach this page.
 * ============================================================
 */

const express = require("express");
const controller = require("./subscription.controller");

const router = express.Router();

router.get("/", controller.getSubscriptionOverview);

module.exports = router;
