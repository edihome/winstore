-- Customer credit ledger: an append-only record of what each customer owes.
-- A credit sale posts a "charge" (increases the balance); collecting money
-- later posts a "payment" (decreases it); "adjustment" is a manual +/- (an
-- opening balance, a write-off). `amount` is SIGNED — positive increases the
-- receivable, negative decreases it — and `balance_after` is the running
-- balance the moment this entry was posted, so a customer's current balance
-- is just their most recent entry's balance_after (0 with no entries). A
-- positive balance means the customer owes the business.

CREATE TABLE customer_ledger_entries (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id),
    customer_id UUID NOT NULL REFERENCES customers(id),
    entry_type TEXT NOT NULL CHECK (entry_type IN ('charge', 'payment', 'adjustment')),
    amount NUMERIC(12, 2) NOT NULL,
    balance_after NUMERIC(12, 2) NOT NULL,
    sale_id UUID REFERENCES sales(id),
    method TEXT,
    note TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_customer_ledger_customer_created ON customer_ledger_entries (customer_id, created_at DESC);
CREATE INDEX idx_customer_ledger_organization_id ON customer_ledger_entries (organization_id);

-- Tenant isolation, same as every other table (see migration 052).
ALTER TABLE customer_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_ledger_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_ledger_entries
    USING (
        organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    )
    WITH CHECK (
        organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    );
