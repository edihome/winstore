-- stock_movements previously referenced the now-removed inventory_items
-- table and had an optional branch_id. Repointing it at products, and
-- making branch_id mandatory, since a movement always happens at a
-- specific branch's stock.
ALTER TABLE stock_movements
    DROP COLUMN inventory_item_id;

ALTER TABLE stock_movements
    ADD COLUMN product_id UUID REFERENCES products(id) ON DELETE RESTRICT;

-- Fresh table with no existing rows in a new environment, so this is safe
-- to enforce immediately rather than as a follow-up migration.
ALTER TABLE stock_movements
    ALTER COLUMN product_id SET NOT NULL,
    ALTER COLUMN branch_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stock_movements_product_id ON stock_movements (product_id);
