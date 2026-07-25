/**
 * ============================================================
 * File: generate-secret.js
 * Module: Scripts
 *
 * Description:
 * Print a strong, random value suitable for JWT_SECRET. Runs entirely
 * offline. Copy the output into your environment / .env before deploying:
 *
 *   npm run generate-secret
 *
 * ============================================================
 */

const crypto = require("crypto");

// 48 random bytes -> 64 url-safe characters, comfortably above the 32-char
// minimum the app enforces in production (see config/env.js).
process.stdout.write(`${crypto.randomBytes(48).toString("base64url")}\n`);
