/**
 * ============================================================
 * File: rateLimiters.js
 * Module: Middlewares
 *
 * Description:
 * Shared rate limiters. The strict `authRateLimiter` guards password-
 * verifying endpoints (login, register, the attendance kiosk toggle)
 * against credential-stuffing; the broad `generalApiRateLimiter` caps
 * overall traffic per client so no single caller can hammer or scrape the
 * API. Both key on req.ip, so on a shop LAN each device gets its own
 * allowance (and behind a proxy, set TRUST_PROXY so req.ip is the real
 * client — see app.js). Both are skipped under `test`, where the suite
 * drives many requests from one address in-process.
 * ============================================================
 */

const rateLimit = require("express-rate-limit");

const skipInTest = () => process.env.NODE_ENV === "test";

const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipInTest,
    message: {
        success: false,
        message: "Too many attempts. Please try again later.",
        errors: [],
    },
});

// A broad ceiling for all API traffic — generous enough that a busy till
// never notices (300 requests/minute per device), low enough to blunt
// scraping or a crude flood.
const generalApiRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipInTest,
    message: {
        success: false,
        message: "Too many requests. Please slow down and try again shortly.",
        errors: [],
    },
});

module.exports = { authRateLimiter, generalApiRateLimiter };
