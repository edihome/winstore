/**
 * ============================================================
 * File: AppError.js
 * Module: Shared Utilities
 *
 * Description:
 * Custom application error class.
 *
 * Every business error thrown inside the application should
 * use this class instead of the default JavaScript Error.
 *
 * This allows us to return consistent API responses.
 *
 * Author: Winstore Team
 * ============================================================
 */

 class AppError extends Error {
    /**
     * Create a new application error.
     *
     * @param {string} message - Human-readable error message.
     * @param {number} statusCode - HTTP status code.
     */
    constructor(message, statusCode) {
        super(message);

        this.statusCode = statusCode;
        this.status = `${statusCode}`.startsWith("4")
            ? "fail"
            : "error";

        this.isOperational = true;

        // Maintain proper stack trace.
        Error.captureStackTrace(this, this.constructor);
    }
}

module.exports = AppError;