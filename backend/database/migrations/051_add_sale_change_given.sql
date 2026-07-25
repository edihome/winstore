-- Cash change handed back on a sale. Checkout now supports split tender
-- (part cash, part card/transfer) and cash over-tender: the payment rows
-- always reconcile to the sale total, and any cash paid above the total
-- is recorded here as change so a reprinted receipt can show "tendered"
-- and "change" correctly.
ALTER TABLE sales
    ADD COLUMN change_given NUMERIC(12, 2) NOT NULL DEFAULT 0;
