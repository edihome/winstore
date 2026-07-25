-- The missing piece: sales had no line items, so there was no record of
-- what was actually sold. Each row is either a product (deducts stock) or
-- a completed salon appointment being billed (price already snapshotted
-- on the appointment in migration 024).
CREATE TABLE IF NOT EXISTS sale_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    item_type VARCHAR(20) NOT NULL,
    product_id UUID REFERENCES products(id) ON DELETE RESTRICT,
    salon_appointment_id UUID REFERENCES salon_appointments(id) ON DELETE RESTRICT,
    description VARCHAR(255) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price NUMERIC(12, 2) NOT NULL,
    line_total NUMERIC(12, 2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT sale_items_type_check CHECK (item_type IN ('product', 'service')),
    CONSTRAINT sale_items_quantity_positive CHECK (quantity > 0),
    -- Exactly one of product_id / salon_appointment_id, matching item_type.
    CONSTRAINT sale_items_reference_check CHECK (
        (item_type = 'product' AND product_id IS NOT NULL AND salon_appointment_id IS NULL)
        OR
        (item_type = 'service' AND salon_appointment_id IS NOT NULL AND product_id IS NULL)
    ),
    -- A completed appointment can only ever be billed once. UNIQUE allows
    -- multiple NULLs (product rows), so this only constrains service rows.
    CONSTRAINT sale_items_appointment_unique UNIQUE (salon_appointment_id)
);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items (sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_organization_id ON sale_items (organization_id);
