/**
 * ============================================================
 * File: settings.service.js
 * Module: Core Settings
 *
 * Description:
 * Business logic for settings management.
 * ============================================================
 */

const crypto = require("crypto");
const AppError = require("../../utils/AppError");
const { isValidEmail } = require("../../utils/validators");
const { validateCreateSetting } = require("./settings.validation");
const settingsRepository = require("./settings.repository");

// The only keys the tenant-facing PATCH /settings will write, each with
// a max length. Anything else in the body (e.g. organizationId stamped by
// enforceOrganizationScope) is ignored, so this endpoint can never set an
// arbitrary key. The logo is a data: URI stored inline (see the Business
// Profile page); the generous cap holds a small resized image.
const EDITABLE_SETTINGS = {
    currency: 8,
    timezone: 64,
    date_format: 32,
    business_address: 400,
    business_phone: 120,
    business_email: 160,
    receipt_message: 600,
    logo: 800000,
};

const listSettings = async (filters = {}) => {
    return settingsRepository.listSettings(filters);
};

/**
 * Tenant-facing update of an organization's own settings — currency,
 * timezone, and the receipt/branding profile (address, contacts, logo,
 * custom message). Only whitelisted keys are written; each is length-
 * capped, the logo must be an image data URI, and the email (if given)
 * must be valid.
 *
 * @param {string} organizationId The caller's own organization.
 * @param {object} payload Object of { key: value } to set.
 * @returns {Promise<object[]>} The organization's full settings list after the update.
 */
const updateSettings = async (organizationId, payload = {}) => {
    const errors = [];
    const writes = [];

    for (const [key, maxLength] of Object.entries(EDITABLE_SETTINGS)) {
        if (payload[key] === undefined) {
            continue;
        }

        const value = payload[key] === null ? "" : String(payload[key]);

        if (value.length > maxLength) {
            errors.push(`${key} is too long (max ${maxLength} characters).`);
            continue;
        }
        if (key === "logo" && value && !/^data:image\/[a-z0-9.+-]+;base64,/i.test(value)) {
            errors.push("Logo must be an uploaded image.");
            continue;
        }
        if (key === "business_email" && value && !isValidEmail(value)) {
            errors.push("Business email must be a valid email address.");
            continue;
        }

        writes.push({ key, value });
    }

    if (errors.length > 0) {
        throw new AppError(errors.join(" "), 400);
    }

    for (const { key, value } of writes) {
        await settingsRepository.upsertSetting(organizationId, key, value);
    }

    return settingsRepository.listSettings({ organizationId });
};

const createSetting = async (payload) => {
    const validationErrors = validateCreateSetting(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    const setting = await settingsRepository.createSetting({
        id: crypto.randomUUID(),
        organizationId: payload.organizationId,
        key: payload.key,
        value: payload.value || "",
    });

    return setting;
};

module.exports = {
    listSettings,
    createSetting,
    updateSettings,
};
