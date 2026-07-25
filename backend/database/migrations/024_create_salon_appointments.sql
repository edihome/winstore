CREATE TABLE IF NOT EXISTS salon_appointments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    stylist_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    service_id UUID NOT NULL REFERENCES salon_services(id) ON DELETE RESTRICT,
    scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
    -- duration_minutes and price are snapshotted from salon_services at
    -- booking time, so a later price/duration change on the service never
    -- rewrites the record of what was actually booked and charged.
    duration_minutes INTEGER NOT NULL,
    price NUMERIC(12, 2) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'scheduled',
    notes TEXT,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT salon_appointments_status_valid
        CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show')),
    CONSTRAINT salon_appointments_duration_positive CHECK (duration_minutes > 0)
);

-- Used to build a stylist's day/week view and to check for overlapping
-- bookings before confirming a new appointment.
CREATE INDEX IF NOT EXISTS idx_salon_appointments_organization_id ON salon_appointments (organization_id);
CREATE INDEX IF NOT EXISTS idx_salon_appointments_branch_id ON salon_appointments (branch_id);
CREATE INDEX IF NOT EXISTS idx_salon_appointments_stylist_scheduled ON salon_appointments (stylist_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_salon_appointments_customer_id ON salon_appointments (customer_id);
