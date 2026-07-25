-- Composite indexes for the hot report/list paths. Every report and every
-- transaction list filters by organization within a date range and orders by
-- created_at; the tables below had organization_id and created_at indexed
-- only SEPARATELY (or created_at not at all), so those queries couldn't use a
-- single index for both the tenant filter and the date range/ordering. These
-- composites fix that as row counts grow into production territory.

-- Sales: reports (revenue/profit/tax/etc.) and the Sales list.
CREATE INDEX IF NOT EXISTS idx_sales_org_created ON sales (organization_id, created_at DESC);

-- Purchases: the Purchases list and purchasing reports.
CREATE INDEX IF NOT EXISTS idx_purchases_org_created ON purchases (organization_id, created_at DESC);

-- Expenses: the Expenses list and the P&L / expense-breakdown reports.
CREATE INDEX IF NOT EXISTS idx_expenses_org_created ON expenses (organization_id, created_at DESC);

-- Sale line items: the by-product / by-category / profit reports group on the
-- product; the join column wasn't indexed.
CREATE INDEX IF NOT EXISTS idx_sale_items_product_id ON sale_items (product_id);
