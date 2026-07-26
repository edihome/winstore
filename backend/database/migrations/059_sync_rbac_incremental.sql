-- Incremental RBAC/identity sync (Phase 2). permissions, role_permissions and
-- user_branches previously replicated only in the enrollment SNAPSHOT; now they
-- flow continuously like the rest of reference data (DOWN-only — hub-authored).
--
-- Two wrinkles the standard capture trigger can't handle:
--   1. user_branches has a COMPOSITE PK and no id, but the outbox keys on a
--      row_id UUID and apply upserts ON CONFLICT (id). Give it an id.
--   2. role_permissions and user_branches carry NO organization_id, so the
--      outbox org must be DERIVED from the parent (role / user).

-- 1) user_branches gets a stable id (fills existing rows), usable as the sync key.
ALTER TABLE user_branches ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid();
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_branches_id_key') THEN
        ALTER TABLE user_branches ADD CONSTRAINT user_branches_id_key UNIQUE (id);
    END IF;
END $$;

-- 2) Capture variant that derives the org from a parent row. TG_ARGV[0] = parent
--    table, TG_ARGV[1] = the local FK column pointing at it. DORMANT like the
--    base trigger (no-ops unless app.sync_capture='on'). On a cascade delete the
--    parent may already be gone → org NULL → we skip (the parent's own captured
--    delete cascades locally on the branch anyway).
CREATE OR REPLACE FUNCTION sync_capture_child() RETURNS trigger AS $$
DECLARE
    rec jsonb;
    org uuid;
BEGIN
    IF current_setting('app.sync_capture', true) IS DISTINCT FROM 'on' THEN
        RETURN NULL;
    END IF;

    IF TG_OP = 'DELETE' THEN rec := to_jsonb(OLD); ELSE rec := to_jsonb(NEW); END IF;

    EXECUTE format('SELECT organization_id FROM %I WHERE id = $1', TG_ARGV[0])
        INTO org USING (rec->>TG_ARGV[1])::uuid;
    IF org IS NULL THEN
        RETURN NULL;
    END IF;

    INSERT INTO sync_outbox (organization_id, node_id, table_name, row_id, op, row_data)
    VALUES (
        org,
        NULLIF(current_setting('app.current_node', true), '')::uuid,
        TG_TABLE_NAME,
        (rec->>'id')::uuid,
        CASE TG_OP WHEN 'INSERT' THEN 'I' WHEN 'UPDATE' THEN 'U' ELSE 'D' END,
        rec
    );
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- permissions carries organization_id → the standard capture trigger.
DROP TRIGGER IF EXISTS sync_capture_trg ON permissions;
CREATE TRIGGER sync_capture_trg AFTER INSERT OR UPDATE OR DELETE ON permissions
    FOR EACH ROW EXECUTE FUNCTION sync_capture();

-- role_permissions → org via its role; user_branches → org via its user.
DROP TRIGGER IF EXISTS sync_capture_trg ON role_permissions;
CREATE TRIGGER sync_capture_trg AFTER INSERT OR UPDATE OR DELETE ON role_permissions
    FOR EACH ROW EXECUTE FUNCTION sync_capture_child('roles', 'role_id');

DROP TRIGGER IF EXISTS sync_capture_trg ON user_branches;
CREATE TRIGGER sync_capture_trg AFTER INSERT OR UPDATE OR DELETE ON user_branches
    FOR EACH ROW EXECUTE FUNCTION sync_capture_child('users', 'user_id');
