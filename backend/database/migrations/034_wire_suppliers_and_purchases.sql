-- suppliers and purchases get the same hardening pass as customers (029)
-- and discounts/taxes (033): real foreign keys and uniqueness, and
-- purchases gains what sales gained in 030/031 — a branch, line items,
-- and a status lifecycle — instead of a single disconnected total_amount.
ALTER TABLE suppliers
    ADD CONSTRAINT suppliers_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE suppliers
    ADD CONSTRAINT suppliers_organization_email_unique UNIQUE (organization_id, email);

ALTER TABLE purchases
    ADD CONSTRAINT purchases_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE purchases
    ADD CONSTRAINT purchases_supplier_id_fkey
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT;

ALTER TABLE purchases
    ADD COLUMN branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
    ADD COLUMN created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN received_at TIMESTAMP WITH TIME ZONE;

-- Table was scaffolding-only until this slice, safe to enforce immediately.
ALTER TABLE purchases
    ALTER COLUMN branch_id SET NOT NULL;

ALTER TABLE purchases
    ADD CONSTRAINT purchases_status_check CHECK (status IN ('pending', 'received', 'cancelled'));

CREATE INDEX IF NOT EXISTS idx_purchases_branch_id ON purchases (branch_id);

-- Line items: what was actually ordered, at what cost. unit_cost is
-- snapshotted at order time — later edits to a product never rewrite
-- what a past purchase order said.
CREATE TABLE IF NOT EXISTS purchase_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    purchase_id UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_cost NUMERIC(12,2) NOT NULL CHECK (unit_cost >= 0),
    line_total NUMERIC(12,2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase_id ON purchase_items (purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_product_id ON purchase_items (product_id);
