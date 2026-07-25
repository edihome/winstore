/**
 * ============================================================
 * File: auth.js
 * Module: Middlewares
 *
 * Description:
 * JWT authentication middleware for protecting API routes.
 * ============================================================
 */

const jwt = require("jsonwebtoken");
const env = require("../config/env");

// Routes a user with a pending forced password change may still reach.
// Enforced server-side (not just hidden in the UI) so a temporary,
// admin-shared password can't be used indefinitely just by skipping the
// frontend's redirect.
const SELF_SERVICE_ALLOWLIST = ["/auth/me", "/auth/change-password"];

// Routes a subscription-locked session (a super_admin signed in after
// their subscription and grace period ran out — see auth.service's
// resolveSubscriptionEnforcement) may still reach: their profile, their
// own password, and the Subscription page that tells them how to renew.
const SUBSCRIPTION_LOCKED_ALLOWLIST = [...SELF_SERVICE_ALLOWLIST, "/subscription"];

const pathMatchesAllowlist = (originalUrl, allowlist) => {
    const path = originalUrl.split("?")[0];
    return allowlist.some((allowed) => path.endsWith(allowed));
};

const authenticate = (req, res, next) => {
    const authHeader = req.headers?.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!token) {
        return res.status(401).json({
            success: false,
            message: "Authentication token is required.",
        });
    }

    try {
        const decoded = jwt.verify(token, env.JWT_SECRET);
        req.user = {
            id: decoded.sub,
            email: decoded.email,
            role: decoded.role || "user",
            organizationId: decoded.organizationId,
            branchId: decoded.branchId || null,
            permissions: decoded.permissions || [],
            mustChangePassword: Boolean(decoded.mustChangePassword),
            subscriptionLocked: Boolean(decoded.subscriptionLocked),
            // Compared against the live users.token_version by
            // middlewares/sessionGuard.js to reject revoked sessions.
            tokenVersion: decoded.tokenVersion ?? 0,
        };

        if (req.user.mustChangePassword && !pathMatchesAllowlist(req.originalUrl, SELF_SERVICE_ALLOWLIST)) {
            return res.status(403).json({
                success: false,
                message: "You must change your password before continuing.",
                errors: [],
            });
        }

        if (
            req.user.subscriptionLocked &&
            !pathMatchesAllowlist(req.originalUrl, SUBSCRIPTION_LOCKED_ALLOWLIST)
        ) {
            return res.status(403).json({
                success: false,
                message: "Your subscription has expired. Access is limited until it is renewed.",
                errors: [],
            });
        }

        return next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: "Invalid or expired token.",
        });
    }
};

module.exports = {
    authenticate,
};
