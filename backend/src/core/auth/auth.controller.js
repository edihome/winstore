/**
 * ============================================================
 * File: auth.controller.js
 * Module: Core Auth
 *
 * Description:
 * HTTP controller for authentication endpoints.
 * ============================================================
 */

const asyncHandler = require("../../utils/asyncHandler");
const { success } = require("../../utils/response");
const authService = require("./auth.service");

const register = asyncHandler(async (req, res) => {
    const result = await authService.register(req.body);
    return success(res, "Account created successfully.", result, 201);
});

const login = asyncHandler(async (req, res) => {
    const result = await authService.login(req.body);
    return success(res, "Login successful.", result, 200);
});

const me = asyncHandler(async (req, res) => {
    const profile = await authService.me(req.user.id);
    return success(res, "Profile fetched successfully.", profile, 200);
});

const changePassword = asyncHandler(async (req, res) => {
    const result = await authService.changePassword(req.user.id, req.body);
    return success(res, "Password changed successfully.", result, 200);
});

const updatePhoto = asyncHandler(async (req, res) => {
    const result = await authService.updatePhoto(req.user.id, req.body);
    return success(res, "Photo updated successfully.", result, 200);
});

module.exports = {
    register,
    login,
    me,
    changePassword,
    updatePhoto,
};
