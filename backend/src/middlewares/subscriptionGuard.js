/**
 * ============================================================
 * File: subscriptionGuard.js
 * Module: Middlewares
 *
 * Description:
 * Per-request enforcement of the organization's standing, applied to
 * every business resource. Login and /auth/me already refuse or lock a
 * lapsed tenant (see auth.service.resolveSubscriptionEnforcement), but
 * a session token lives for hours — without this check, a tenant the
 * developer just deactivated (or whose subscription ran out mid-day)
 * would keep working until their next login. This closes that gap: the
 * developer's Deactivate toggle and a subscription running out both
 * take effect on the very next request.
 *
 * A deactivated organization and an expired subscription are the SAME
 * consequence by design. The developer platform role is exempt, and the
 * routes a locked owner may still use (/auth/*, /subscription) are
 * mounted without this middleware — see routes/index.js.
 * ============================================================
 */

const organizationsRepository = require("../core/organizations/organizations.repository");
const { computeSubscriptionStanding } = require("../core/organizations/organizations.service");

const enforceActiveSubscription = async (req, res, next) => {
    try {
        if (req.user.role === "developer") {
            return next();
        }

        const organization = await organizationsRepository.findOrganizationById(req.user.organizationId);
        if (!organization || organization.status === "inactive") {
            return res.status(403).json({
                success: false,
                message: "Your organization's account has been deactivated. Access is limited until it is reactivated.",
                errors: [],
            });
        }

        const standing = computeSubscriptionStanding(organization);
        if (standing && standing.status === "expired") {
            return res.status(403).json({
                success: false,
                message: "Your subscription has expired. Access is limited until it is renewed.",
                errors: [],
            });
        }

        return next();
    } catch (error) {
        return next(error);
    }
};

module.exports = {
    enforceActiveSubscription,
};
