/**
 * ============================================================
 * File: notifications.controller.js
 * Module: Core Notifications
 *
 * Description:
 * HTTP controller for notification endpoints.
 * ============================================================
 */

const asyncHandler = require("../../utils/asyncHandler");
const { success } = require("../../utils/response");
const notificationsService = require("./notifications.service");

const listNotifications = asyncHandler(async (req, res) => {
    const notifications = await notificationsService.listNotifications(req.query);
    return success(res, "Notifications retrieved successfully.", notifications, 200);
});

const createNotification = asyncHandler(async (req, res) => {
    const notification = await notificationsService.createNotification(req.body);
    return success(res, "Notification created successfully.", notification, 201);
});

module.exports = {
    listNotifications,
    createNotification,
};
