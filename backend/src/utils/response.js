/**
 * ============================================================
 * File: response.js
 * Module: Shared Utilities
 *
 * Description:
 * Standard API response helper used throughout Winstore.
 *
 * Every successful response should use these helper methods to
 * ensure consistency across the entire API.
 * ============================================================
 */

/**
 * Send a successful response.
 *
 * @param {object} res Express response object
 * @param {string} message Response message
 * @param {object|array|null} data Response payload
 * @param {number} statusCode HTTP status code
 */
 const success = (
    res,
    message = "Request completed successfully.",
    data = null,
    statusCode = 200
) => {
    return res.status(statusCode).json({
        success: true,
        message,
        data,
    });
};

/**
 * Send a failure response.
 *
 * Normally this is only used for validation errors.
 * Unexpected errors should be handled by the global
 * error handler middleware.
 *
 * @param {object} res Express response object
 * @param {string} message Error message
 * @param {array|null} errors Validation errors
 * @param {number} statusCode HTTP status code
 */
const fail = (
    res,
    message = "Request failed.",
    errors = null,
    statusCode = 400
) => {
    return res.status(statusCode).json({
        success: false,
        message,
        errors,
    });
};

/**
 * Send a successful paginated list response. `data` stays a plain array (the
 * current page of rows), so consumers that ignore pagination keep working;
 * page metadata rides alongside in `pagination`.
 *
 * @param {object} res Express response object
 * @param {string} message Response message
 * @param {array} data The current page of rows
 * @param {{page:number,limit:number,total:number,totalPages:number}} pagination
 * @param {number} statusCode HTTP status code
 */
const paginated = (res, message = "Request completed successfully.", data = [], pagination = null, statusCode = 200) => {
    return res.status(statusCode).json({
        success: true,
        message,
        data,
        pagination,
    });
};

module.exports = {
    success,
    fail,
    paginated,
};