-- payments had no link to sales at all — there was no way to know which
-- invoice a payment was actually for.
ALTER TABLE payments
    ADD CONSTRAINT payments_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE payments
    ADD COLUMN sale_id UUID REFERENCES sales(id) ON DELETE CASCADE,
    ADD COLUMN method VARCHAR(20) NOT NULL DEFAULT 'cash',
    ADD COLUMN created_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Fresh table — every payment in this flow is tied to a sale.
ALTER TABLE payments
    ALTER COLUMN sale_id SET NOT NULL;

ALTER TABLE payments
    ADD CONSTRAINT payments_method_check CHECK (method IN ('cash', 'card', 'transfer', 'other')),
    ADD CONSTRAINT payments_status_check CHECK (status IN ('completed', 'refunded'));

CREATE INDEX IF NOT EXISTS idx_payments_sale_id ON payments (sale_id);
