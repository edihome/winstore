-- Same call as dropping inventory_items in 028: the reports table stored
-- only a title/type/status row per "generated" report — no content, no
-- inputs, nothing anyone could read back. Reports are computed live from
-- the real tables (sales, purchases, appointments, stock) by the reports
-- module; a registry of empty rows is the wrong model.
DROP TABLE IF EXISTS reports;
