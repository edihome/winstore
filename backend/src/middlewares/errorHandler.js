/**
 * ============================================================
 * File: errorHandler.js
 * Module: Global Middleware
 *
 * Description:
 * Centralized error handler for the Winstore API.
 *
 * All errors thrown anywhere in the application eventually
 * arrive here before being sent to the client.
 * ============================================================
 */

 const env = require("../config/env");
 const logger = require("../config/logger");

 const isDevelopment = env.NODE_ENV === "development";

 const errorHandler = (err, req, res, next) => {
    const statusCode = err.statusCode || 500;

    // Only errors we raised on purpose (AppError sets isOperational) carry
    // a message safe to show a client — validation failures, "not found",
    // permission denials, etc. Anything else (an unexpected throw, a raw
    // Postgres error whose message would leak table/column/constraint
    // names) is flattened to a generic message so internals never escape.
    const isOperational = err.isOperational === true;

    // Log server-side with correlation. Expected client errors (operational
    // 4xx) are noise at "error" level, so they go to "warn" without a stack;
    // anything unexpected (a real bug, a 5xx) is logged in full with its
    // stack so production incidents are traceable rather than blind.
    const context = {
        requestId: req.id,
        method: req.method,
        path: (req.originalUrl || req.url || "").split("?")[0],
        status: statusCode,
        org: req.user && req.user.organizationId,
    };
    if (isOperational && statusCode < 500) {
        logger.warn(err.message, context);
    } else {
        logger.error(err.message || "Unhandled error", { ...context, stack: err.stack });
    }

    const message = isOperational ? err.message : "Something went wrong. Please try again.";

    res.status(statusCode).json({
        success: false,
        message,
        // The correlation id, so a user can quote it and support can find the
        // matching server-side log line.
        requestId: req.id,
        // Only ever set by AppError (operational), so it's safe to pass through.
        blockedByDependents: err.blockedByDependents || undefined,
        // Stack traces are a development-only convenience and never leave
        // the server otherwise — and even in development, only for
        // deliberate errors, so a raw internal error still can't leak its
        // internals by accident.
        stack: isDevelopment && isOperational ? err.stack : undefined,
    });
};

module.exports = errorHandler;