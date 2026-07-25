/**
 * ============================================================
 * File: auth.validation.js
 * Module: Core Auth
 *
 * Description:
 * Request validation rules for authentication endpoints.
 * ============================================================
 */

const { isNonEmptyString, isValidEmail } = require("../../utils/validators");

const validateLogin = (payload = {}) => {
    const errors = [];
    const email = String(payload.email || "").trim();
    const password = String(payload.password || "").trim();

    if (!isValidEmail(email)) {
        errors.push("A valid email is required.");
    }

    if (!isNonEmptyString(password)) {
        errors.push("Password is required.");
    }

    return errors;
};

const validateRegister = (payload = {}) => {
    const errors = [];
    const firstName = String(payload.firstName || "").trim();
    const lastName = String(payload.lastName || "").trim();
    const email = String(payload.email || "").trim();
    const password = String(payload.password || "").trim();
    const organizationName = String(payload.organizationName || "").trim();

    if (!isNonEmptyString(firstName)) {
        errors.push("First name is required.");
    }

    if (!isNonEmptyString(lastName)) {
        errors.push("Last name is required.");
    }

    if (!isValidEmail(email)) {
        errors.push("A valid email is required.");
    }

    if (!isNonEmptyString(password) || password.length < 8) {
        errors.push("Password must be at least 8 characters long.");
    }

    if (!isNonEmptyString(organizationName)) {
        errors.push("Organization name is required.");
    }

    return errors;
};

const validateChangePassword = (payload = {}) => {
    const errors = [];
    const currentPassword = String(payload.currentPassword || "").trim();
    const newPassword = String(payload.newPassword || "").trim();

    if (!isNonEmptyString(currentPassword)) {
        errors.push("Current password is required.");
    }

    if (!isNonEmptyString(newPassword) || newPassword.length < 8) {
        errors.push("New password must be at least 8 characters long.");
    }

    return errors;
};

module.exports = {
    validateLogin,
    validateRegister,
    validateChangePassword,
};
