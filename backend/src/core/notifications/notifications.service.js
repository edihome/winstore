/**
 * ============================================================
 * File: notifications.service.js
 * Module: Core Notifications
 *
 * Description:
 * Business logic for notification management.
 * ============================================================
 */

const crypto = require("crypto");
const AppError = require("../../utils/AppError");
const { validateCreateNotification } = require("./notifications.validation");
const notificationsRepository = require("./notifications.repository");

const listNotifications = async (filters = {}) => {
    return notificationsRepository.listNotifications(filters);
};

const createNotification = async (payload) => {
    const validationErrors = validateCreateNotification(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    const notification = await notificationsRepository.createNotification({
        id: crypto.randomUUID(),
        organizationId: payload.organizationId,
        userId: payload.userId || null,
        message: payload.message,
        type: payload.type || "info",
        isRead: payload.isRead || false,
    });

    return notification;
};

module.exports = {
    listNotifications,
    createNotification,
};
