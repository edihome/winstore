/**
 * ============================================================
 * File: organizations.repository.js
 * Module: Core Organizations
 *
 * Description:
 * SQL repository methods for organization management.
 * ============================================================
 */

const pool = require("../../config/db");

const ORGANIZATION_COLUMNS =
    "id, name, slug, status, subscription_expires_at, alert_threshold_days, extension_days, created_at, updated_at";

const listOrganizations = async (filters = {}, client = pool) => {
    const { search = "" } = filters;
    const query = `
        SELECT ${ORGANIZATION_COLUMNS}
        FROM organizations
        WHERE ($1::text = '' OR LOWER(name) LIKE LOWER($1))
        ORDER BY created_at DESC
    `;

    const result = await client.query(query, [`%${search}%`]);
    return result.rows;
};

const createOrganization = async (organizationData, client = pool) => {
    const result = await client.query(
        `
            INSERT INTO organizations (
                id, name, slug, status, subscription_expires_at, alert_threshold_days, extension_days, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
            RETURNING ${ORGANIZATION_COLUMNS}
        `,
        [
            organizationData.id,
            organizationData.name,
            organizationData.slug,
            organizationData.status || "active",
            organizationData.subscriptionExpiresAt || null,
            organizationData.alertThresholdDays ?? 30,
            organizationData.extensionDays ?? 0,
        ]
    );

    return result.rows[0];
};

const findOrganizationBySlug = async (slug, client = pool) => {
    const result = await client.query(
        `
            SELECT ${ORGANIZATION_COLUMNS}
            FROM organizations
            WHERE slug = $1
            LIMIT 1
        `,
        [slug]
    );

    return result.rows[0] || null;
};

const findOrganizationById = async (id, client = pool) => {
    const result = await client.query(
        `
            SELECT ${ORGANIZATION_COLUMNS}
            FROM organizations
            WHERE id = $1
            LIMIT 1
        `,
        [id]
    );

    return result.rows[0] || null;
};

const updateOrganization = async (id, updates, client = pool) => {
    const result = await client.query(
        `
            UPDATE organizations
            SET name = COALESCE($2, name),
                slug = COALESCE($3, slug),
                status = COALESCE($4, status),
                subscription_expires_at = CASE WHEN $5 THEN $6 ELSE subscription_expires_at END,
                alert_threshold_days = COALESCE($7, alert_threshold_days),
                extension_days = COALESCE($8, extension_days),
                updated_at = NOW()
            WHERE id = $1
            RETURNING ${ORGANIZATION_COLUMNS}
        `,
        [
            id,
            updates.name ?? null,
            updates.slug ?? null,
            updates.status ?? null,
            updates.subscriptionExpiresAt !== undefined,
            updates.subscriptionExpiresAt ?? null,
            updates.alertThresholdDays ?? null,
            updates.extensionDays ?? null,
        ]
    );

    return result.rows[0] || null;
};

const createSubscriptionPayment = async (paymentData, client = pool) => {
    const result = await client.query(
        `
            INSERT INTO subscription_payments (
                id, organization_id, amount, currency, days_granted, reference, notes,
                previous_expires_at, new_expires_at, recorded_by, created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
            RETURNING id, organization_id, amount, currency, days_granted, reference, notes,
                      previous_expires_at, new_expires_at, recorded_by, created_at
        `,
        [
            paymentData.id,
            paymentData.organizationId,
            paymentData.amount,
            paymentData.currency,
            paymentData.daysGranted,
            paymentData.reference || null,
            paymentData.notes || null,
            paymentData.previousExpiresAt || null,
            paymentData.newExpiresAt,
            paymentData.recordedBy || null,
        ]
    );

    return result.rows[0];
};

const listSubscriptionPayments = async (organizationId, client = pool) => {
    const result = await client.query(
        `
            SELECT
                p.id, p.organization_id, p.amount, p.currency, p.days_granted, p.reference, p.notes,
                p.previous_expires_at, p.new_expires_at, p.created_at,
                u.first_name AS recorded_by_first_name, u.last_name AS recorded_by_last_name
            FROM subscription_payments p
            LEFT JOIN users u ON u.id = p.recorded_by
            WHERE p.organization_id = $1
            ORDER BY p.created_at DESC
        `,
        [organizationId]
    );

    return result.rows;
};

module.exports = {
    listOrganizations,
    createOrganization,
    findOrganizationBySlug,
    findOrganizationById,
    updateOrganization,
    createSubscriptionPayment,
    listSubscriptionPayments,
};
