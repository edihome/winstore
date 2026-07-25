-- Session invalidation support. Every session JWT carries the user's
-- token_version at issue time; a per-request check (see
-- middlewares/sessionGuard.js) rejects any token whose version no longer
-- matches the row. Bumping this column instantly invalidates every
-- outstanding token for that user — the mechanism behind immediate
-- deactivation, admin password reset, and killing other sessions on a
-- self-service password change.
--
-- Without it, a JWT stayed valid for its full 8h lifetime regardless of
-- the account being deactivated, because nothing re-checked the database
-- after the token was minted.
ALTER TABLE users
    ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;
