-- customers.organization_id had no foreign key constraint (same gap as
-- products before migration 025), and nothing prevented the same email
-- being registered as two different customer records within one org.
ALTER TABLE customers
    ADD CONSTRAINT customers_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE customers
    ADD CONSTRAINT customers_organization_email_unique UNIQUE (organization_id, email);
