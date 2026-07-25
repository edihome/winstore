-- discounts and taxes had the same gaps customers/products had before
-- migrations 025/029: no organization foreign key, and nothing preventing
-- the same discount code from existing twice in one organization.
ALTER TABLE discounts
    ADD CONSTRAINT discounts_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE discounts
    ADD CONSTRAINT discounts_organization_code_unique UNIQUE (organization_id, code);

ALTER TABLE discounts
    ADD CONSTRAINT discounts_amount_check CHECK (amount >= 0);

ALTER TABLE taxes
    ADD CONSTRAINT taxes_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE taxes
    ADD CONSTRAINT taxes_rate_check CHECK (rate >= 0 AND rate <= 100);

-- Record which discount was applied to a sale. The amount is still
-- snapshotted onto sales.discount_amount at checkout time (so editing a
-- discount later never rewrites history); this link is for traceability.
ALTER TABLE sales
    ADD COLUMN discount_id UUID REFERENCES discounts(id) ON DELETE SET NULL;
