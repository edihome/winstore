-- Subscription tracking for the developer's cross-organization Platform
-- screen: an expiration date the developer sets per tenant, how many
-- days before that date a warning should start showing to the tenant's
-- own super_admin at login, and a grace period (extension days) every
-- tenant gets after their expiration date before they're truly overdue.
--
-- subscription_expires_at is nullable on purpose: an organization with
-- no expiration set yet (e.g. one that just self-registered, before the
-- developer has reviewed and set their plan) simply has no alert
-- computed for it — see auth.service.js's computeSubscriptionAlert.
ALTER TABLE organizations
    ADD COLUMN subscription_expires_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN alert_threshold_days INTEGER NOT NULL DEFAULT 30,
    ADD COLUMN extension_days INTEGER NOT NULL DEFAULT 0,
    ADD CONSTRAINT organizations_alert_threshold_days_non_negative CHECK (alert_threshold_days >= 0),
    ADD CONSTRAINT organizations_extension_days_non_negative CHECK (extension_days >= 0);
