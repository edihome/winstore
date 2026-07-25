-- Supports forcing a password change: staff created by an admin (or whose
-- password an admin reset) get a temporary password the admin knows, so
-- they're required to set their own on first login. Self-registered
-- admins set their own password knowingly at registration and are never
-- forced.
ALTER TABLE users
    ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT true;

-- Existing users already know their own password (they've been using it) —
-- only newly created/reset accounts going forward should be forced.
UPDATE users SET must_change_password = false;
