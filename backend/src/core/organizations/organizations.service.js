/**
 * ============================================================
 * File: organizations.service.js
 * Module: Core Organizations
 *
 * Description:
 * Business logic for organization management, including the
 * subscription tracking the developer's Platform screen surfaces:
 * an expiration date per tenant, a configurable alert lead time, and
 * a grace period every tenant gets after expiring.
 * ============================================================
 */

const crypto = require("crypto");
const pool = require("../../config/db");
const AppError = require("../../utils/AppError");
const {
    validateCreateOrganization,
    validateUpdateOrganization,
    validateRecordSubscriptionPayment,
} = require("./organizations.validation");
const organizationsRepository = require("./organizations.repository");
const auditRepository = require("../audit/audit.repository");
const { hardDelete } = require("../../utils/hardDelete");

const ORGANIZATION_STATUSES = Object.freeze({
    ACTIVE: "active",
    INACTIVE: "inactive",
});

const DAY_MS = 24 * 60 * 60 * 1000;

const slugify = (value) =>
    String(value)
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "organization";

/**
 * Derive the subscription's current standing from its expiration date,
 * alert lead time, and grace period, all relative to "now" at call
 * time — the one place this math happens, shared by the developer's
 * Platform list (for the red-row highlight) and the login/me alert
 * banner shown to a tenant's own super_admin (see auth.service.js).
 *
 * @param {object} row Organization row (snake_case, as returned by the repository).
 * @returns {object|null} Subscription standing, or null if no expiration is set.
 */
const computeSubscriptionStanding = (row) => {
    if (!row.subscription_expires_at) {
        return null;
    }

    const expiresAt = new Date(row.subscription_expires_at);
    const daysRemaining = Math.ceil((expiresAt.getTime() - Date.now()) / DAY_MS);
    const alertThresholdDays = row.alert_threshold_days ?? 30;
    const extensionDays = row.extension_days ?? 0;

    let graceDaysRemaining = null;
    let status = "active";

    if (daysRemaining < 0) {
        graceDaysRemaining = extensionDays + daysRemaining; // daysRemaining is negative here
        status = graceDaysRemaining >= 0 ? "in_grace" : "expired";
    } else if (daysRemaining < alertThresholdDays) {
        status = "expiring_soon";
    }

    return {
        expiresAt: row.subscription_expires_at,
        alertThresholdDays,
        extensionDays,
        daysRemaining,
        graceDaysRemaining,
        status,
        // The developer's Platform list's red-row rule is deliberately a
        // flat 30 days, independent of this org's own configurable alert
        // threshold — a simple, consistent visual regardless of per-tenant
        // settings.
        isExpiringSoon: daysRemaining < 30,
    };
};

const toOrganizationResponse = (row) => {
    if (!row) {
        return null;
    }

    return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        status: row.status,
        subscription: computeSubscriptionStanding(row),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
};

const listOrganizations = async (filters = {}) => {
    const organizations = await organizationsRepository.listOrganizations(filters);
    return organizations.map(toOrganizationResponse);
};

const createOrganization = async (payload) => {
    const validationErrors = validateCreateOrganization(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    const slug = slugify(payload.slug || payload.name);
    const existingOrg = await organizationsRepository.findOrganizationBySlug(slug);
    if (existingOrg) {
        throw new AppError("An organization with this slug already exists.", 409);
    }

    const organization = await organizationsRepository.createOrganization({
        id: crypto.randomUUID(),
        name: payload.name,
        slug,
        status: payload.status || ORGANIZATION_STATUSES.ACTIVE,
        subscriptionExpiresAt: payload.subscriptionExpiresAt || null,
        alertThresholdDays: payload.alertThresholdDays,
        extensionDays: payload.extensionDays,
    });

    return toOrganizationResponse(organization);
};

/**
 * Update an organization's own name, slug, status, or subscription
 * details (expiration date, alert lead time, grace/extension days) —
 * this is the "Update" flow on the developer's Platform screen, the
 * one place all of a tenant's subscription details are adjusted.
 * "Removing" an organization by flipping status to "inactive" is the
 * normal path for everyone; deleteOrganization below is the
 * Developer-only hard-delete escape hatch.
 *
 * @param {string} id Organization ID.
 * @param {object} payload Fields to update, all optional.
 * @returns {Promise<object>} API-safe organization record.
 */
const updateOrganization = async (id, payload) => {
    const validationErrors = validateUpdateOrganization(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    if (payload.slug !== undefined) {
        const slug = String(payload.slug).trim();
        const existingOrg = await organizationsRepository.findOrganizationBySlug(slug);
        if (existingOrg && existingOrg.id !== id) {
            throw new AppError("An organization with this slug already exists.", 409);
        }
    }

    const organization = await organizationsRepository.updateOrganization(id, {
        name: payload.name !== undefined ? String(payload.name).trim() : undefined,
        slug: payload.slug !== undefined ? String(payload.slug).trim() : undefined,
        status: payload.status,
        subscriptionExpiresAt: payload.subscriptionExpiresAt,
        alertThresholdDays:
            payload.alertThresholdDays !== undefined ? Number(payload.alertThresholdDays) : undefined,
        extensionDays: payload.extensionDays !== undefined ? Number(payload.extensionDays) : undefined,
    });

    if (!organization) {
        throw new AppError("Organization not found.", 404);
    }

    return toOrganizationResponse(organization);
};

/**
 * Developer-only hard delete. Every organization_id foreign key in this
 * schema is ON DELETE CASCADE, so this wipes every branch, user,
 * product, sale, and every other record that organization ever created
 * — there's nothing to block on. The one hard rule no `force` flag can
 * override: a developer can't delete the organization their own
 * account belongs to (it would delete their own user row out from
 * under the request).
 *
 * @param {string} id Organization ID.
 * @param {string} actingOrganizationId The acting developer's own organization ID.
 * @returns {Promise<void>}
 */
const deleteOrganization = async (id, actingOrganizationId) => {
    const existing = await organizationsRepository.findOrganizationById(id);
    if (!existing) {
        throw new AppError("Organization not found.", 404);
    }

    if (id === actingOrganizationId) {
        throw new AppError("You cannot delete your own organization.", 400);
    }

    await hardDelete({ table: "organizations", id });
};

const toPaymentResponse = (row) => ({
    id: row.id,
    organizationId: row.organization_id,
    amount: Number(row.amount),
    currency: row.currency,
    daysGranted: row.days_granted,
    reference: row.reference,
    notes: row.notes,
    previousExpiresAt: row.previous_expires_at,
    newExpiresAt: row.new_expires_at,
    recordedByName:
        row.recorded_by_first_name || row.recorded_by_last_name
            ? `${row.recorded_by_first_name || ""} ${row.recorded_by_last_name || ""}`.trim()
            : null,
    createdAt: row.created_at,
});

/**
 * Record a renewal payment for a tenant and advance their subscription
 * by the purchased days in the same transaction — the "SaaS billing"
 * flow for this deployment: money changes hands outside the software
 * (offline-first, no payment gateway), and the developer logs it here.
 *
 * The new expiration extends from whichever is LATER: the current
 * expiration date (renewing early keeps the remaining days) or now
 * (renewing after a lapse doesn't burn the purchased days on the
 * already-lapsed gap).
 *
 * @param {string} organizationId Tenant organization ID.
 * @param {object} payload { amount, daysGranted, currency?, reference?, notes? }.
 * @param {object} actingUser req.user of the developer recording it.
 * @returns {Promise<object>} { payment, organization } with the advanced expiry.
 */
const recordSubscriptionPayment = async (organizationId, payload, actingUser) => {
    const validationErrors = validateRecordSubscriptionPayment(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    const organization = await organizationsRepository.findOrganizationById(organizationId);
    if (!organization) {
        throw new AppError("Organization not found.", 404);
    }

    const daysGranted = Number(payload.daysGranted);
    const previousExpiresAt = organization.subscription_expires_at
        ? new Date(organization.subscription_expires_at)
        : null;
    const base = previousExpiresAt && previousExpiresAt.getTime() > Date.now() ? previousExpiresAt : new Date();
    const newExpiresAt = new Date(base.getTime() + daysGranted * DAY_MS);

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const payment = await organizationsRepository.createSubscriptionPayment(
            {
                id: crypto.randomUUID(),
                organizationId,
                amount: Number(payload.amount),
                currency: payload.currency ? String(payload.currency).trim() : "USD",
                daysGranted,
                reference: payload.reference ? String(payload.reference).trim() : null,
                notes: payload.notes ? String(payload.notes).trim() : null,
                previousExpiresAt,
                newExpiresAt,
                recordedBy: actingUser.id,
            },
            client
        );

        const updated = await organizationsRepository.updateOrganization(
            organizationId,
            { subscriptionExpiresAt: newExpiresAt.toISOString() },
            client
        );

        await auditRepository.createAuditLog(
            {
                id: crypto.randomUUID(),
                organizationId,
                userId: actingUser.id,
                action: "subscription.payment_recorded",
                entityType: "organization",
                entityId: organizationId,
                metadata: { paymentId: payment.id, daysGranted, newExpiresAt: newExpiresAt.toISOString() },
            },
            client
        );

        await client.query("COMMIT");

        return {
            payment: toPaymentResponse(payment),
            organization: toOrganizationResponse(updated),
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
};

const listSubscriptionPayments = async (organizationId) => {
    const rows = await organizationsRepository.listSubscriptionPayments(organizationId);
    return rows.map(toPaymentResponse);
};

module.exports = {
    listOrganizations,
    createOrganization,
    updateOrganization,
    deleteOrganization,
    computeSubscriptionStanding,
    recordSubscriptionPayment,
    listSubscriptionPayments,
};
