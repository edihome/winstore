CREATE TABLE IF NOT EXISTS salon_services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    duration_minutes INTEGER NOT NULL,
    price NUMERIC(12, 2) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT salon_services_duration_positive CHECK (duration_minutes > 0),
    CONSTRAINT salon_services_price_non_negative CHECK (price >= 0)
);

-- branch_id is nullable: a null branch means the service is offered at
-- every branch in the organization, rather than requiring a duplicate
-- row per branch.
CREATE INDEX IF NOT EXISTS idx_salon_services_organization_id ON salon_services (organization_id);
CREATE INDEX IF NOT EXISTS idx_salon_services_branch_id ON salon_services (branch_id);
