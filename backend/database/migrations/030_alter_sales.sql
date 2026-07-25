-- sales previously had no organization/customer FK constraints, no
-- branch_id, and only a single total_amount with no cost breakdown and no
-- line items at all — there was no way to know what was actually sold.
ALTER TABLE sales
    ADD CONSTRAINT sales_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE sales
    ADD CONSTRAINT sales_customer_id_fkey
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT;

ALTER TABLE sales
    ADD COLUMN branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
    ADD COLUMN subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN created_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Fresh table, safe to enforce immediately.
ALTER TABLE sales
    ALTER COLUMN branch_id SET NOT NULL;

ALTER TABLE sales
    ADD CONSTRAINT sales_status_check CHECK (status IN ('paid', 'void'));

CREATE INDEX IF NOT EXISTS idx_sales_branch_id ON sales (branch_id);
