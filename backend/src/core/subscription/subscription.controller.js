/**
 * ============================================================
 * File: subscription.controller.js
 * Module: Core Subscription
 *
 * Description:
 * HTTP controller for the tenant-facing subscription endpoint.
 * ============================================================
 */

const asyncHandler = require("../../utils/asyncHandler");
const { success } = require("../../utils/response");
const subscriptionService = require("./subscription.service");

const getSubscriptionOverview = asyncHandler(async (req, res) => {
    const overview = await subscriptionService.getSubscriptionOverview(req.user.organizationId);
    return success(res, "Subscription retrieved successfully.", overview, 200);
});

module.exports = {
    getSubscriptionOverview,
};
