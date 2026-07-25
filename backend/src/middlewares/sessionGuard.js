/**
 * ============================================================
 * File: sessionGuard.js
 * Module: Middlewares
 *
 * Description:
 * Per-request session validity check, run right after authenticate on
 * every protected route. A JWT is a bearer credential valid until it
 * expires (8h here) — on its own, nothing stops a token that was minted
 * before the account was deactivated, its password reset, or its
 * sessions revoked. This closes that window: one primary-key lookup
 * confirms the account is still active AND that the token's version
 * still matches the row (see auth.repository.bumpTokenVersion), so
 * deactivation and password changes take effect on the very next
 * request instead of up to eight hours later.
 *
 * Kept separate from authenticate (which stays a pure, synchronous JWT
 * verify) so token decoding remains unit-testable without a database.
 * ============================================================
 */

const authRepository = require("../core/auth/auth.repository");

const enforceActiveSession = async (req, res, next) => {
    try {
        const state = await authRepository.findSessionStateById(req.user.id);

        if (!state || !state.is_active) {
            return res.status(401).json({
                success: false,
                message: "Your session is no longer valid. Please sign in again.",
                errors: [],
            });
        }

        // Tokens issued before the latest bump (deactivation, password
        // reset, password change) carry a stale version and are refused.
        if (Number(req.user.tokenVersion ?? 0) !== Number(state.token_version)) {
            return res.status(401).json({
                success: false,
                message: "Your session has ended. Please sign in again.",
                errors: [],
            });
        }

        return next();
    } catch (error) {
        return next(error);
    }
};

module.exports = {
    enforceActiveSession,
};
