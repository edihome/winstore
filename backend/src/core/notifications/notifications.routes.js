/**
 * ============================================================
 * File: notifications.routes.js
 * Module: Core Notifications
 *
 * Description:
 * Routes for notification management.
 * ============================================================
 */

const express = require("express");
const controller = require("./notifications.controller");

const router = express.Router();

router.get("/", controller.listNotifications);
router.post("/", controller.createNotification);

module.exports = router;
