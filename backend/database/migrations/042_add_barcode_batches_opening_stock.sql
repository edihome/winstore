-- Additive support for four commonly-expected inventory fields:
-- barcode/EAN, reorder level (already existed, just had no write path —
-- no schema change needed there), opening stock (a workflow, not a
-- schema change — reuses stock_movements), and expiry date.
--
-- Expiry is a property of a received BATCH of stock, not of the product
-- itself (the same SKU can have units with different expiry dates on the
-- shelf at once), so it needs its own table rather than a column on
-- product_stock. product_stock.quantity stays the untouched, authoritative
-- aggregate — stock_batches is supplementary FEFO (first-expiry-first-out)
-- tracking layered on top, populated only when an expiry date is actually
-- supplied at stock-in time.

ALTER TABLE products ADD COLUMN barcode VARCHAR(64);

-- Partial unique index: barcode is optional, and only needs to be unique
-- within an organization (two different organizations may legitimately
-- sell the same manufacturer barcode).
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_organization_barcode_unique
    ON products (organization_id, barcode)
    WHERE barcode IS NOT NULL;

CREATE TABLE IF NOT EXISTS stock_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL DEFAULT 0,
    expiry_date DATE,
    received_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT stock_batches_quantity_non_negative CHECK (quantity >= 0)
);

CREATE INDEX IF NOT EXISTS idx_stock_batches_organization_id ON stock_batches (organization_id);
-- FEFO consumption always looks up batches by (branch, product) ordered by
-- expiry — this index serves both the lookup and the ORDER BY.
CREATE INDEX IF NOT EXISTS idx_stock_batches_branch_product_expiry
    ON stock_batches (branch_id, product_id, expiry_date);

-- Optional per-line-item expiry captured at purchase-creation time, used
-- to seed a stock_batches row when that item is later received.
ALTER TABLE purchase_items ADD COLUMN expiry_date DATE;
