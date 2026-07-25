-- Sales returns / refunds. A paid sale can be returned in whole or part:
-- the returned quantities are restocked (products only — a delivered
-- service can't go back on the shelf), the customer is refunded, and
-- reports net the refund out of revenue. The original sale and its items
-- are never mutated (they are the historical record); a return is a
-- separate document that references them.
--
-- sales.returned_amount is a running total on the sale, used to show its
-- return status (none / partial / full) and to net revenue in reports
-- without recomputing from the return rows each time.
CREATE TABLE sale_returns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
    total_refund NUMERIC(12, 2) NOT NULL DEFAULT 0,
    refund_method VARCHAR(20) NOT NULL DEFAULT 'cash',
    reason TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE sale_return_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    return_id UUID NOT NULL REFERENCES sale_returns(id) ON DELETE CASCADE,
    sale_item_id UUID NOT NULL REFERENCES sale_items(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    line_refund NUMERIC(12, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sale_returns_sale_id ON sale_returns (sale_id);
CREATE INDEX idx_sale_returns_org_created ON sale_returns (organization_id, created_at);
CREATE INDEX idx_sale_return_items_return_id ON sale_return_items (return_id);

ALTER TABLE sales ADD COLUMN returned_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;
