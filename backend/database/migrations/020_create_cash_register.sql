CREATE TABLE IF NOT EXISTS cash_registers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    opening_balance NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (opening_balance >= 0),
    current_balance NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (current_balance >= 0),
    status VARCHAR(30) NOT NULL DEFAULT 'open',
    opened_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    closed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT cash_registers_status_check CHECK (status IN ('open', 'closed'))
);

CREATE TABLE IF NOT EXISTS cash_register_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    cash_register_id UUID NOT NULL REFERENCES cash_registers(id) ON DELETE CASCADE,
    transaction_type VARCHAR(30) NOT NULL,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    balance_after NUMERIC(12,2) NOT NULL CHECK (balance_after >= 0),
    reference VARCHAR(150),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT cash_register_transactions_type_check CHECK (transaction_type IN ('inflow', 'outflow'))
);

CREATE INDEX IF NOT EXISTS idx_cash_registers_organization_id ON cash_registers (organization_id);
CREATE INDEX IF NOT EXISTS idx_cash_registers_branch_id ON cash_registers (branch_id);
CREATE INDEX IF NOT EXISTS idx_cash_registers_status ON cash_registers (status);
CREATE INDEX IF NOT EXISTS idx_cash_register_transactions_organization_id ON cash_register_transactions (organization_id);
CREATE INDEX IF NOT EXISTS idx_cash_register_transactions_register_id ON cash_register_transactions (cash_register_id);
