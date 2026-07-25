-- Billing records for the developer-managed subscription flow. Each row
-- is one recorded renewal payment: which tenant paid, how much, how many
-- days of service that purchase granted, and the expiration date the
-- subscription advanced to as a result. Rows are append-only history —
-- the live expiration date stays on organizations.subscription_expires_at,
-- which recording a payment advances in the same transaction (see
-- organizations.service.recordSubscriptionPayment).
--
-- There is deliberately no payment-gateway integration: this deployment
-- is offline-first and payments are collected outside the software, so a
-- payment here is the operator's ledger entry of money already received.
CREATE TABLE subscription_payments (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
    currency TEXT NOT NULL DEFAULT 'USD',
    days_granted INTEGER NOT NULL CHECK (days_granted > 0),
    reference TEXT,
    notes TEXT,
    previous_expires_at TIMESTAMP WITH TIME ZONE,
    new_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subscription_payments_organization ON subscription_payments(organization_id);
