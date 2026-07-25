/**
 * ============================================================
 * File: organizations.controller.js
 * Module: Core Organizations
 *
 * Description:
 * HTTP controller for organization endpoints.
 * ============================================================
 */

const asyncHandler = require("../../utils/asyncHandler");
const { success } = require("../../utils/response");
const organizationsService = require("./organizations.service");

const listOrganizations = asyncHandler(async (req, res) => {
    const organizations = await organizationsService.listOrganizations(req.query);
    return success(res, "Organizations retrieved successfully.", organizations, 200);
});

const createOrganization = asyncHandler(async (req, res) => {
    const organization = await organizationsService.createOrganization(req.body);
    return success(res, "Organization created successfully.", organization, 201);
});

const updateOrganization = asyncHandler(async (req, res) => {
    const organization = await organizationsService.updateOrganization(req.params.id, req.body);
    return success(res, "Organization updated successfully.", organization, 200);
});

const deleteOrganization = asyncHandler(async (req, res) => {
    await organizationsService.deleteOrganization(req.params.id, req.user.organizationId);
    return success(res, "Organization deleted successfully.", null, 200);
});

const recordSubscriptionPayment = asyncHandler(async (req, res) => {
    const result = await organizationsService.recordSubscriptionPayment(req.params.id, req.body, req.user);
    return success(res, "Payment recorded and subscription extended.", result, 201);
});

const listSubscriptionPayments = asyncHandler(async (req, res) => {
    const payments = await organizationsService.listSubscriptionPayments(req.params.id);
    return success(res, "Payments retrieved successfully.", payments, 200);
});

module.exports = {
    listOrganizations,
    createOrganization,
    updateOrganization,
    deleteOrganization,
    recordSubscriptionPayment,
    listSubscriptionPayments,
};
