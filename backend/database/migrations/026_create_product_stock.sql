-- Replaces inventory_items: that table duplicated name/sku separately from
-- products (no link between the two — the same item had to be entered
-- twice) and had no branch_id, so stock quantity wasn't even per-branch on
-- a platform whose whole premise is multi-branch. product_stock ties stock
-- directly to the real product catalog, one row per (branch, product).
CREATE TABLE IF NOT EXISTS product_stock (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL DEFAULT 0,
    reorder_level INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT product_stock_quantity_non_negative CHECK (quantity >= 0),
    CONSTRAINT product_stock_branch_product_unique UNIQUE (branch_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_product_stock_organization_id ON product_stock (organization_id);
CREATE INDEX IF NOT EXISTS idx_product_stock_product_id ON product_stock (product_id);
