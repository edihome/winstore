CREATE TABLE IF NOT EXISTS stock_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
    inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    movement_type VARCHAR(30) NOT NULL,
    quantity_change INTEGER NOT NULL,
    quantity_after INTEGER NOT NULL CHECK (quantity_after >= 0),
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT stock_movements_type_check CHECK (movement_type IN ('in', 'out', 'adjustment')),
    CONSTRAINT stock_movements_quantity_change_check CHECK (quantity_change <> 0)
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_organization_id ON stock_movements (organization_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_branch_id ON stock_movements (branch_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_inventory_item_id ON stock_movements (inventory_item_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created_at ON stock_movements (created_at);
