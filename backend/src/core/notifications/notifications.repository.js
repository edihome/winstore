/**
 * ============================================================
 * File: notifications.repository.js
 * Module: Core Notifications
 *
 * Description:
 * SQL repository methods for notification management.
 * ============================================================
 */

const pool = require("../../config/db");

const listNotifications = async (filters = {}, client = pool) => {
    const { organizationId = "" } = filters;
    const result = await client.query(
        `
            SELECT id, organization_id, user_id, message, type, is_read, created_at
            FROM notifications
            WHERE ($1::text = '' OR organization_id = $1::uuid)
            ORDER BY created_at DESC
        `,
        [organizationId]
    );

    return result.rows;
};

const createNotification = async (notificationData, client = pool) => {
    const result = await client.query(
        `
            INSERT INTO notifications (id, organization_id, user_id, message, type, is_read, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW())
            RETURNING id, organization_id, user_id, message, type, is_read, created_at
        `,
        [notificationData.id, notificationData.organizationId, notificationData.userId || null, notificationData.message, notificationData.type || "info", notificationData.isRead || false]
    );

    return result.rows[0];
};

module.exports = {
    listNotifications,
    createNotification,
};
