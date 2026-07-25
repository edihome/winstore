-- Optional per-customer credit limit: the maximum balance they're allowed to
-- owe. NULL means no limit (unlimited credit). A credit sale that would push
-- the customer's balance above their limit is refused (see sales.service).
ALTER TABLE customers
    ADD COLUMN credit_limit NUMERIC(12, 2);
