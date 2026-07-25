/**
 * ============================================================
 * File: logger.js
 * Module: Configuration
 *
 * Description:
 * Minimal structured logger — no dependencies. In production it emits one
 * JSON object per line (greppable, and ready to ship to any log collector
 * or file); in development it prints a readable line; under test it stays
 * silent so the test reporter's output isn't buried (assertions surface any
 * real failure). Every log can carry structured metadata (a request id,
 * route, org, etc.) so production incidents are traceable instead of blind.
 * ============================================================
 */

const env = require("./env");

const isTest = env.NODE_ENV === "test";
const isProduction = env.NODE_ENV === "production";

/**
 * @param {"info"|"warn"|"error"} level
 * @param {string} message
 * @param {object} [meta] Structured fields; a `stack` is kept but printed
 *   separately in development so lines stay readable.
 */
const write = (level, message, meta = {}) => {
    if (isTest) {
        return;
    }

    const { stack, ...rest } = meta;

    if (isProduction) {
        const entry = { time: new Date().toISOString(), level, message, ...rest };
        if (stack) {
            entry.stack = stack;
        }
        process.stdout.write(`${JSON.stringify(entry)}\n`);
        return;
    }

    const out = level === "error" ? console.error : console.log;
    const metaStr = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : "";
    out(`[${new Date().toISOString()}] ${level.toUpperCase()} ${message}${metaStr}`);
    if (stack) {
        out(stack);
    }
};

module.exports = {
    info: (message, meta) => write("info", message, meta),
    warn: (message, meta) => write("warn", message, meta),
    error: (message, meta) => write("error", message, meta),
};
