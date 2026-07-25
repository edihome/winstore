/**
 * ============================================================
 * File: reports.validation.js
 * Module: Core Reports
 *
 * Description:
 * Validation rules for report query parameters.
 * ============================================================
 */

const isValidDateString = (value) => {
    if (typeof value !== "string" || value.trim() === "") {
        return false;
    }
    return !Number.isNaN(new Date(value).getTime());
};

const validateReportRange = (query = {}) => {
    const errors = [];

    if (query.from !== undefined && !isValidDateString(query.from)) {
        errors.push("from must be a valid date (YYYY-MM-DD).");
    }

    if (query.to !== undefined && !isValidDateString(query.to)) {
        errors.push("to must be a valid date (YYYY-MM-DD).");
    }

    if (
        isValidDateString(query.from) &&
        isValidDateString(query.to) &&
        new Date(query.from) > new Date(query.to)
    ) {
        errors.push("from must be on or before to.");
    }

    return errors;
};

module.exports = {
    validateReportRange,
};
