/**
 * ============================================================
 * File: settings.controller.js
 * Module: Core Settings
 *
 * Description:
 * HTTP controller for settings endpoints.
 * ============================================================
 */

const asyncHandler = require("../../utils/asyncHandler");
const { success } = require("../../utils/response");
const settingsService = require("./settings.service");

const listSettings = asyncHandler(async (req, res) => {
    const settings = await settingsService.listSettings(req.query);
    return success(res, "Settings retrieved successfully.", settings, 200);
});

const createSetting = asyncHandler(async (req, res) => {
    const setting = await settingsService.createSetting(req.body);
    return success(res, "Setting created successfully.", setting, 201);
});

const updateSettings = asyncHandler(async (req, res) => {
    const settings = await settingsService.updateSettings(req.user.organizationId, req.body);
    return success(res, "Settings updated successfully.", settings, 200);
});

module.exports = {
    listSettings,
    createSetting,
    updateSettings,
};
