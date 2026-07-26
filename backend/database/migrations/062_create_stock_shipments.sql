-- Cross-branch stock transfers as an ASYNC two-step shipment, for when the
-- source and destination branches are separate offline nodes (the synchronous
-- stock-movements.transferStock only works when both branches share a DB).
--
--   ship    : stock leaves the source now (an OUT movement) + a shipment record
--             in_transit. The record + movement sync up to the hub and down to
--             the destination branch.
--   receive : the destination confirms arrival (an IN movement) and marks the
--             shipment received. Its update syncs back.
--   cancel  : the source calls off an in_transit shipment; the stock returns.
--
-- batches carries the FEFO-consumed expiry batches so tracked expiry follows the
-- goods to the destination. The record is bidirectional in sync (source authors
-- ship, destination authors receive) — different fields, so no real conflict.

CREATE TABLE stock_shipments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    product_id UUID NOT NULL REFERENCES products(id),
    from_branch_id UUID NOT NULL REFERENCES branches(id),
    to_branch_id UUID NOT NULL REFERENCES branches(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    status TEXT NOT NULL DEFAULT 'in_transit' CHECK (status IN ('in_transit', 'received', 'cancelled')),
    reason TEXT,
    batches JSONB NOT NULL DEFAULT '[]'::jsonb,
    shipped_by UUID,
    shipped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    received_by UUID,
    received_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (from_branch_id <> to_branch_id)
);
CREATE INDEX idx_stock_shipments_to_branch ON stock_shipments (to_branch_id, status);
CREATE INDEX idx_stock_shipments_from_branch ON stock_shipments (from_branch_id, status);

ALTER TABLE stock_shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_shipments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stock_shipments
    USING (
        organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    )
    WITH CHECK (
        organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    );

-- Capture for sync (dormant unless app.sync_capture='on'), same as the other
-- syncable tables — it carries organization_id directly.
DROP TRIGGER IF EXISTS sync_capture_trg ON stock_shipments;
CREATE TRIGGER sync_capture_trg AFTER INSERT OR UPDATE OR DELETE ON stock_shipments
    FOR EACH ROW EXECUTE FUNCTION sync_capture();
