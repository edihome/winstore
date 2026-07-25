/**
 * ============================================================
 * File: categories.validation.js
 * Module: Core Categories
 *
 * Description:
 * Validation rules and constants for category endpoints.
 * ============================================================
 */

const { isNonEmptyString, isValidSlug } = require("../../utils/validators");

const CATEGORY_STATUSES = Object.freeze({
    ACTIVE: "active",
    INACTIVE: "inactive",
});

const CATEGORY_STATUS_VALUES = Object.freeze(Object.values(CATEGORY_STATUSES));

/**
 * Validate the payload used to create a category.
 *
 * @param {object} payload Request body.
 * @returns {string[]} Validation error messages.
 */
const validateCreateCategory = (payload = {}) => {
    const errors = [];
    const name = String(payload.name || "").trim();
    const slug = String(payload.slug || "").trim();
    const organizationId = String(payload.organizationId || "").trim();
    const status = String(payload.status || "").trim();

    if (!isNonEmptyString(name)) {
        errors.push("Category name is required.");
    }

    if (payload.slug !== undefined && !isValidSlug(slug)) {
        errors.push("Category slug must use lowercase letters, numbers, and hyphens.");
    }

    if (!isNonEmptyString(organizationId)) {
        errors.push("Organization ID is required.");
    }

    if (payload.status !== undefined && !CATEGORY_STATUS_VALUES.includes(status)) {
        errors.push(`Category status must be one of: ${CATEGORY_STATUS_VALUES.join(", ")}.`);
    }

    return errors;
};

module.exports = {
    CATEGORY_STATUSES,
    CATEGORY_STATUS_VALUES,
    validateCreateCategory,
};
