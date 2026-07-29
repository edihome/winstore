-- Held / parked sales: a cashier can save the current cart and resume it later
-- (or another cashier at the till can). This is TRANSIENT working state — a
-- snapshot of the cart + who/where — not a completed sale, and NOT synced. It's
-- deleted when the sale is finally completed or cancelled.

CREATE TABLE pending_sales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL REFERENCES branches(id),
    created_by UUID REFERENCES users(id),
    label TEXT,
    item_count INTEGER NOT NULL DEFAULT 0,
    total NUMERIC(14, 2) NOT NULL DEFAULT 0,
    cart JSONB NOT NULL DEFAULT '[]'::jsonb,
    customer_id UUID,
    discount_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_pending_sales_branch ON pending_sales (branch_id, created_at DESC);

ALTER TABLE pending_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_sales FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pending_sales
    USING (
        organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    )
    WITH CHECK (
        organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    );
