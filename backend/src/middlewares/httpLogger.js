/**
 * ============================================================
 * File: httpLogger.js
 * Module: Middlewares
 *
 * Description:
 * Request correlation + access logging.
 *   - `attachRequestId` gives every request a unique id (honoring an inbound
 *     X-Request-Id from a proxy/frontend if present) and echoes it back as a
 *     response header. The id also appears in access logs and error logs and
 *     in error response bodies, so a user reporting a problem can quote it
 *     and it can be found in the logs.
 *   - `accessLogger` logs one structured line per completed request
 *     (method, path, status, duration, org). Used in production; development
 *     keeps morgan's colored output and test logs nothing.
 * ============================================================
 */

const crypto = require("node:crypto");
const logger = require("../config/logger");

const attachRequestId = (req, res, next) => {
    const inbound = req.headers["x-request-id"];
    req.id = typeof inbound === "string" && inbound.trim() ? inbound.trim().slice(0, 64) : crypto.randomUUID();
    res.setHeader("X-Request-Id", req.id);
    return next();
};

const accessLogger = (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on("finish", () => {
        const ms = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
        logger.info("request", {
            requestId: req.id,
            method: req.method,
            path: (req.originalUrl || req.url).split("?")[0],
            status: res.statusCode,
            ms,
            org: req.user && req.user.organizationId,
        });
    });
    return next();
};

module.exports = { attachRequestId, accessLogger };
