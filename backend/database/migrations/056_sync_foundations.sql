-- Phase 0 of the offline-sync engine: DORMANT foundations. This installs the
-- change-capture machinery but leaves it OFF — the trigger no-ops unless a
-- connection sets app.sync_capture='on' — so there is no behavior change and
-- no measurable overhead until sync is actually enabled (Phase 1). All three
-- tables are tenant-scoped and RLS-forced like the rest of the schema, because
-- the central hub is the single multi-tenant SaaS, not a per-org server.

-- 1) Node registry — who the sync participants are for an org. `is_self` is
--    THIS install's own node (a branch node on a shop box; a hub node per org
--    on the central SaaS) and is local to each database.
CREATE TABLE sync_nodes (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID REFERENCES branches(id),
    name TEXT,
    kind TEXT NOT NULL DEFAULT 'branch' CHECK (kind IN ('hub', 'branch')),
    is_self BOOLEAN NOT NULL DEFAULT false,
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_sync_nodes_self ON sync_nodes (organization_id) WHERE is_self;
CREATE INDEX idx_sync_nodes_org ON sync_nodes (organization_id);

-- 2) Outbox — the durable, ordered log of local changes. `seq` is the cursor
--    peers advance through; `row_data` is the snapshot to apply on the peer.
CREATE TABLE sync_outbox (
    seq BIGSERIAL PRIMARY KEY,
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    node_id UUID,
    table_name TEXT NOT NULL,
    row_id UUID,
    op CHAR(1) NOT NULL CHECK (op IN ('I', 'U', 'D')),
    row_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_sync_outbox_org_seq ON sync_outbox (organization_id, seq);

-- 3) Watermarks — how far each peer has pushed/pulled. Empty until Phase 1.
CREATE TABLE sync_state (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id),
    local_node_id UUID,
    remote_node_id UUID,
    last_pushed_seq BIGINT NOT NULL DEFAULT 0,
    last_pulled_seq BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_sync_state_org ON sync_state (organization_id);

-- Tenant isolation (migration 052 pattern).
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['sync_nodes', 'sync_outbox', 'sync_state'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format($f$
            CREATE POLICY tenant_isolation ON %I
            USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid
                   OR current_setting('app.bypass_rls', true) = 'on')
            WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid
                        OR current_setting('app.bypass_rls', true) = 'on')
        $f$, t);
    END LOOP;
END $$;

-- The capture trigger — DORMANT unless the connection sets app.sync_capture='on'.
-- Reads org + id + snapshot off the row generically via to_jsonb, and stamps
-- the writing node from app.current_node (both GUCs sit next to app.current_org).
CREATE OR REPLACE FUNCTION sync_capture() RETURNS trigger AS $$
DECLARE
    rec jsonb;
BEGIN
    IF current_setting('app.sync_capture', true) IS DISTINCT FROM 'on' THEN
        RETURN NULL;
    END IF;

    IF TG_OP = 'DELETE' THEN
        rec := to_jsonb(OLD);
    ELSE
        rec := to_jsonb(NEW);
    END IF;

    INSERT INTO sync_outbox (organization_id, node_id, table_name, row_id, op, row_data)
    VALUES (
        (rec->>'organization_id')::uuid,
        NULLIF(current_setting('app.current_node', true), '')::uuid,
        TG_TABLE_NAME,
        (rec->>'id')::uuid,
        CASE TG_OP WHEN 'INSERT' THEN 'I' WHEN 'UPDATE' THEN 'U' ELSE 'D' END,
        rec
    );
    RETURN NULL; -- AFTER trigger: return value is ignored
END;
$$ LANGUAGE plpgsql;

-- Attach to the syncable tables (all carry organization_id). Derived state
-- (product_stock, stock_batches) is re-derivable from stock_movements and is
-- deliberately NOT captured; org-less child tables sync via their parents.
DO $$
DECLARE
    t text;
    syncable text[] := ARRAY[
        'sales', 'sale_items', 'payments', 'sale_returns', 'stock_movements', 'customer_ledger_entries',
        'expenses', 'purchases', 'purchase_items', 'appointments', 'attendance', 'audit_logs',
        'products', 'categories', 'services', 'discounts', 'taxes', 'customers', 'suppliers', 'users', 'roles', 'settings', 'branches'
    ];
BEGIN
    FOREACH t IN ARRAY syncable LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS sync_capture_trg ON %I', t);
        EXECUTE format(
            'CREATE TRIGGER sync_capture_trg AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION sync_capture()',
            t
        );
    END LOOP;
END $$;
