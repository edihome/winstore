-- expenses had the same gaps as purchases before slice 7: no organization
-- FK, no branch, and a "status" column nothing ever set beyond its
-- 'pending' default. Wired to the same pattern as purchases: a branch,
-- a terminal lifecycle, and who recorded it.
ALTER TABLE expenses
    ADD CONSTRAINT expenses_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE expenses
    ADD COLUMN branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
    ADD COLUMN category VARCHAR(100) NOT NULL DEFAULT 'general',
    ADD COLUMN created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN paid_at TIMESTAMP WITH TIME ZONE;

-- Table was scaffolding-only until this slice, safe to enforce immediately.
ALTER TABLE expenses
    ALTER COLUMN branch_id SET NOT NULL;

ALTER TABLE expenses
    ADD CONSTRAINT expenses_amount_check CHECK (amount > 0);

-- pending -> paid | cancelled, both terminal (same rule as purchases).
-- Reports only ever count 'paid' expenses as real spend.
ALTER TABLE expenses
    DROP CONSTRAINT IF EXISTS expenses_status_check;

ALTER TABLE expenses
    ADD CONSTRAINT expenses_status_check CHECK (status IN ('pending', 'paid', 'cancelled'));

ALTER TABLE expenses
    ALTER COLUMN status SET DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS idx_expenses_branch_id ON expenses (branch_id);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses (category);
