-- Let a sale line bill a service DIRECTLY, without a prior appointment —
-- so a walk-in can buy a service on the Sales page the same way they buy
-- a product. Until now a "service" line could only reference a completed
-- appointment (appointment_id), which forced every service sale through
-- the booking flow and required a named customer.
--
-- A service line is now EITHER an appointment being billed (appointment_id)
-- OR a direct catalog service (service_id), never both. Products are
-- unchanged. The appointment-unique constraint (one bill per appointment)
-- stays; a catalog service can be sold any number of times, so service_id
-- is intentionally not unique.
ALTER TABLE sale_items
    ADD COLUMN service_id UUID REFERENCES services(id) ON DELETE RESTRICT;

ALTER TABLE sale_items DROP CONSTRAINT sale_items_reference_check;

ALTER TABLE sale_items
    ADD CONSTRAINT sale_items_reference_check CHECK (
        (item_type = 'product' AND product_id IS NOT NULL AND appointment_id IS NULL AND service_id IS NULL)
        OR
        (item_type = 'service' AND product_id IS NULL AND (
            (appointment_id IS NOT NULL AND service_id IS NULL)
            OR
            (appointment_id IS NULL AND service_id IS NOT NULL)
        ))
    );
