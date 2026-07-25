CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(120) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT categories_status_check CHECK (status IN ('active', 'inactive')),
    CONSTRAINT categories_organization_slug_unique UNIQUE (organization_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_categories_organization_id ON categories (organization_id);
CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories (slug);
