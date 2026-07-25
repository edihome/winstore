/**
 * ============================================================
 * File: subscription.service.js
 * Module: Core Subscription
 *
 * Description:
 * The tenant-facing read side of subscription management: an
 * organization's own super_admin checking where their subscription
 * stands and what renewals have been recorded. Read-only by design —
 * payments are collected outside the software and recorded by the
 * developer on the Platform screen (see organizations.service's
 * recordSubscriptionPayment), so this module has no repository or
 * validation file of its own; it reuses the organizations module's.
 * ============================================================
 */

const AppError = require("../../utils/AppError");
const organizationsRepository = require("../organizations/organizations.repository");
const {
    computeSubscriptionStanding,
    listSubscriptionPayments,
} = require("../organizations/organizations.service");

/**
 * Everything the tenant's Subscription page shows: the organization's
 * identity, its live standing (or null when the developer hasn't set an
 * expiration yet), and the recorded payment history.
 *
 * @param {string} organizationId The caller's own organization ID.
 * @returns {Promise<object>} { organization, standing, payments }.
 */
const getSubscriptionOverview = async (organizationId) => {
    const organization = await organizationsRepository.findOrganizationById(organizationId);
    if (!organization) {
        throw new AppError("Organization not found.", 404);
    }

    const payments = await listSubscriptionPayments(organizationId);

    return {
        organization: {
            id: organization.id,
            name: organization.name,
            status: organization.status,
        },
        standing: computeSubscriptionStanding(organization),
        payments,
    };
};

module.exports = {
    getSubscriptionOverview,
};
