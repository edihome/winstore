-- products.organization_id had no foreign key constraint, and there was no
-- link at all between the product catalog and category management.
ALTER TABLE products
    ADD CONSTRAINT products_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE products
    ADD COLUMN category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    ADD COLUMN cost NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE products
    ADD CONSTRAINT products_organization_sku_unique UNIQUE (organization_id, sku);

CREATE INDEX IF NOT EXISTS idx_products_category_id ON products (category_id);
