/**
 * ============================================================
 * File: auth.routes.js
 * Module: Core Auth
 *
 * Description:
 * Authentication routes for registration and login.
 * ============================================================
 */

const express = require("express");
const controller = require("./auth.controller");
const { authenticate } = require("../../middlewares/auth");
const { enforceOrgDbContext } = require("../../middlewares/orgContext");
const { enforceActiveSession } = require("../../middlewares/sessionGuard");
const { authRateLimiter } = require("../../middlewares/rateLimiters");

const router = express.Router();

router.post("/register", authRateLimiter, controller.register);
router.post("/login", authRateLimiter, controller.login);
// /me and /change-password sit behind the session guard too, so a
// revoked token can't even refresh its profile or re-change a password —
// the frontend treats a failed /auth/me as a dead session and redirects
// to login, which is exactly the desired end state for a revoked token.
// enforceOrgDbContext establishes the tenant's DB context first, since the
// session guard reads the users table (now under row level security).
router.get("/me", authenticate, enforceOrgDbContext, enforceActiveSession, controller.me);
router.patch("/change-password", authenticate, enforceOrgDbContext, enforceActiveSession, controller.changePassword);
// Self-service passport photo — any authenticated user sets their own.
router.patch("/photo", authenticate, enforceOrgDbContext, enforceActiveSession, controller.updatePhoto);

module.exports = router;
