/**
 * ============================================================
 * File: validators.js
 * Module: Shared Utilities
 *
 * Description:
 * Common validation helpers for the Winstore backend.
 * ============================================================
 */

const isNonEmptyString = (value) =>
    typeof value === "string" && value.trim().length > 0;

const isValidEmail = (value) => {
    if (!isNonEmptyString(value)) {
        return false;
    }

    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
};

const isValidSlug = (value) =>
    isNonEmptyString(value) && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.trim());

module.exports = {
    isNonEmptyString,
    isValidEmail,
    isValidSlug,
};
