/**
 * ============================================================
 * File: cors.js
 * Module: Configuration
 *
 * Description:
 * Cross-origin policy for the API, built around Winstore being
 * offline-first: a shop's own machine or any device on its LAN must be
 * able to reach the API with ZERO configuration, in every environment and
 * with the internet unplugged. On top of that, a cloud deployment can
 * allow its public frontend origin via FRONTEND_URL.
 *
 * Requests with no Origin header (same-origin page loads, curl, native
 * desktop/mobile clients) are always allowed — CORS only governs
 * cross-origin BROWSER requests.
 * ============================================================
 */

const env = require("./env");

const parseList = (value) =>
    value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

// localhost (v4/v6) and the three private IPv4 ranges (RFC 1918) — i.e. any
// address a shop's LAN hands out — plus mDNS ".local" hostnames.
const PRIVATE_HOST =
    /^(localhost|127\.0\.0\.1|::1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/;

/**
 * Whether an Origin points at this machine or the local network.
 *
 * @param {string} origin The browser Origin header value.
 * @returns {boolean}
 */
const isLanOrigin = (origin) => {
    try {
        const host = new URL(origin).hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
        return PRIVATE_HOST.test(host) || host.endsWith(".local");
    } catch {
        return false;
    }
};

const allowedOrigins = parseList(env.FRONTEND_URL);

const corsOptions = {
    origin(origin, callback) {
        // Non-browser / same-origin clients send no Origin — always allow.
        if (!origin) {
            return callback(null, true);
        }
        // Offline-first: the local machine and LAN devices always work.
        if (isLanOrigin(origin)) {
            return callback(null, true);
        }
        // Explicitly configured public origins (a cloud frontend).
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        // Development stays permissive so local tooling isn't fought;
        // production allows only the origins above.
        if (env.NODE_ENV !== "production") {
            return callback(null, true);
        }
        // Not allowed: reply without CORS headers so the browser blocks it
        // (callback(null, false) — never an Error, which would 500).
        return callback(null, false);
    },
    credentials: true,
};

module.exports = { corsOptions, isLanOrigin };
