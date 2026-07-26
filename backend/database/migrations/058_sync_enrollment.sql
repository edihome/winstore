-- Branch enrollment: how a shop install becomes a trusted node of an existing
-- org. Two credentials with two lifetimes (see the design doc):
--   * a ONE-TIME enrollment code (hashed here, short TTL) pairs a branch once;
--   * a durable, revocable NODE TOKEN authenticates the branch daemon after.
-- The node lifecycle columns on sync_nodes are what the node token checks so a
-- branch can be cut off (is_active) or rotated (token_version).

-- One-time enrollment codes. token_hash is SHA-256 of a high-entropy code
-- (never the code itself), looked up on redemption.
CREATE TABLE sync_enrollment_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID REFERENCES branches(id),
    token_hash TEXT NOT NULL,
    name TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    used_by_node_id UUID,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_sync_enrollment_tokens_hash ON sync_enrollment_tokens (token_hash);

ALTER TABLE sync_enrollment_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_enrollment_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sync_enrollment_tokens
    USING (
        organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    )
    WITH CHECK (
        organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    );

-- Node lifecycle: a registered branch can be revoked (is_active=false) or have
-- its token rotated (token_version bump), both checked on every node request.
ALTER TABLE sync_nodes ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE sync_nodes ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
