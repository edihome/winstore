-- Visibility for what the hub SILENTLY drops. Central-wins means a branch can't
-- push reference/identity changes up — by design — but an admin needs to see
-- when it happens (a branch repeatedly trying to change a price is a real signal
-- of misconfiguration or user confusion). Each dropped change is logged here.
--
-- Install-local diagnostics: NEVER synced (not in SYNCABLE_TABLES / the snapshot).

CREATE TABLE sync_rejections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    node_id UUID,
    table_name TEXT NOT NULL,
    row_id UUID,
    op CHAR(1),
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_sync_rejections_org ON sync_rejections (organization_id, created_at DESC);

ALTER TABLE sync_rejections ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_rejections FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sync_rejections
    USING (
        organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    )
    WITH CHECK (
        organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    );
