-- Generalize the Salon module into a generic Services module: any
-- service-based business (cleaning, consulting, tutoring, salons — not
-- salons specifically) can define its own service catalog and take
-- appointments against it. "stylist" becomes "provider" (the staff
-- member who performs the appointment) for the same reason.

ALTER TABLE salon_services RENAME TO services;
ALTER TABLE salon_appointments RENAME TO appointments;

ALTER TABLE appointments RENAME COLUMN stylist_id TO provider_id;
ALTER TABLE sale_items RENAME COLUMN salon_appointment_id TO appointment_id;

-- Postgres doesn't rename indexes/constraints along with their table —
-- do it explicitly so the schema doesn't keep "salon_*" names for a
-- table that no longer has that name.
ALTER INDEX idx_salon_services_organization_id RENAME TO idx_services_organization_id;
ALTER INDEX idx_salon_services_branch_id RENAME TO idx_services_branch_id;
ALTER INDEX idx_salon_appointments_organization_id RENAME TO idx_appointments_organization_id;
ALTER INDEX idx_salon_appointments_branch_id RENAME TO idx_appointments_branch_id;
ALTER INDEX idx_salon_appointments_stylist_scheduled RENAME TO idx_appointments_provider_scheduled;
ALTER INDEX idx_salon_appointments_customer_id RENAME TO idx_appointments_customer_id;

ALTER TABLE services RENAME CONSTRAINT salon_services_duration_positive TO services_duration_positive;
ALTER TABLE services RENAME CONSTRAINT salon_services_price_non_negative TO services_price_non_negative;
ALTER TABLE appointments RENAME CONSTRAINT salon_appointments_status_valid TO appointments_status_valid;
ALTER TABLE appointments RENAME CONSTRAINT salon_appointments_duration_positive TO appointments_duration_positive;

-- Existing organizations already have "salon_services"/"salon_appointments"
-- rows in `permissions` (provisioned at their own registration time, one
-- row per catalog entry). role_permissions links by permission id, not by
-- resource string, so updating the resource/name here is enough to carry
-- every existing role's grant forward under the new key — no
-- role_permissions changes needed.
UPDATE permissions SET resource = 'services', name = 'services:manage' WHERE resource = 'salon_services';
UPDATE permissions SET resource = 'appointments', name = 'appointments:manage' WHERE resource = 'salon_appointments';
