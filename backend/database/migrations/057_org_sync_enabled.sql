-- Per-org opt-in for offline sync — the guardrail that keeps the multi-tenant
-- SaaS hub free of any sync cost for orgs that never asked for offline.
--
-- Capture is now gated on TWO levels: the process-global SYNC_ENABLED (a
-- deployment supports sync at all) AND this per-org flag (this tenant actually
-- enrolled a branch). orgContext only turns on app.sync_capture when both are
-- true, so on the hub the outbox grows only for offline orgs; every plain
-- cloud org is byte-for-byte unaffected. Default false: an org is pure SaaS
-- until it enrolls its first branch (which flips this true).

ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS sync_enabled BOOLEAN NOT NULL DEFAULT false;
