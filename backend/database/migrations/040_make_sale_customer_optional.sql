-- A sale no longer requires a customer — walk-in sales (no name on file)
-- are common at a checkout counter and shouldn't be blocked on picking
-- someone from the Customers list first.
ALTER TABLE sales ALTER COLUMN customer_id DROP NOT NULL;
