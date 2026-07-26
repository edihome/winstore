-- A branch install's own record of WHERE its hub is and HOW to authenticate to
-- it (the durable node token), so an enrolled branch survives a restart instead
-- of forgetting its enrollment. Install-local and per-org: on a branch there is
-- exactly one org, hence one row. NEVER synced — it holds this node's own
-- credentials, not shared tenant data (not in SYNCABLE_TABLES / the snapshot).
--
-- The node token is stored in the clear: it's a long-lived credential on the
-- org's OWN device, the same trust basis as the offline password hashes the
-- snapshot ships. RLS-scoped like everything else.

CREATE TABLE sync_branch_config (
    organization_id UUID PRIMARY KEY REFERENCES organizations(id),
    hub_url TEXT NOT NULL,
    node_id UUID,
    node_token TEXT NOT NULL,
    enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE sync_branch_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_branch_config FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sync_branch_config
    USING (
        organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    )
    WITH CHECK (
        organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    );
