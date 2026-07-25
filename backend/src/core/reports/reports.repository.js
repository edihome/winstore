/**
 * ============================================================
 * File: reports.repository.js
 * Module: Core Reports
 *
 * Description:
 * Read-side SQL for computed reports. Like the inventory module,
 * this is intentionally read-only — reports aggregate the real
 * tables (sales, purchases, appointments, customers, stock) at
 * request time; nothing here writes anything.
 *
 * Date ranges are half-open: [from, to).
 * ============================================================
 */

const pool = require("../../config/db");

const getSalesSummary = async ({ organizationId, branchId = "", from, to }, client = pool) => {
    const result = await client.query(
        `
            SELECT
                COUNT(*)::int AS sale_count,
                COALESCE(SUM(subtotal), 0) AS subtotal,
                COALESCE(SUM(discount_amount), 0) AS discount_total,
                COALESCE(SUM(tax_amount), 0) AS tax_total,
                COALESCE(SUM(total_amount), 0) AS revenue
            FROM sales
            WHERE organization_id = $1
              AND ($2::text = '' OR branch_id = $2::uuid)
              AND status = 'paid'
              AND created_at >= $3 AND created_at < $4
        `,
        [organizationId, branchId, from, to]
    );

    return result.rows[0];
};

const getReturnsSummary = async ({ organizationId, branchId = "", from, to }, client = pool) => {
    const result = await client.query(
        `
            SELECT
                COUNT(*)::int AS return_count,
                COALESCE(SUM(total_refund), 0) AS refund_total
            FROM sale_returns
            WHERE organization_id = $1
              AND ($2::text = '' OR branch_id = $2::uuid)
              AND created_at >= $3 AND created_at < $4
        `,
        [organizationId, branchId, from, to]
    );

    return result.rows[0];
};

const getPurchasesSummary = async ({ organizationId, branchId = "", from, to }, client = pool) => {
    const result = await client.query(
        `
            SELECT
                COUNT(*)::int AS purchase_count,
                COALESCE(SUM(total_amount), 0) AS spend
            FROM purchases
            WHERE organization_id = $1
              AND ($2::text = '' OR branch_id = $2::uuid)
              AND status = 'received'
              AND received_at >= $3 AND received_at < $4
        `,
        [organizationId, branchId, from, to]
    );

    return result.rows[0];
};

const getAppointmentsSummary = async ({ organizationId, branchId = "", from, to }, client = pool) => {
    const result = await client.query(
        `
            SELECT
                COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
                COUNT(*) FILTER (WHERE status = 'scheduled')::int AS scheduled,
                COUNT(*) FILTER (WHERE status IN ('cancelled', 'no_show'))::int AS not_kept
            FROM appointments
            WHERE organization_id = $1
              AND ($2::text = '' OR branch_id = $2::uuid)
              AND scheduled_at >= $3 AND scheduled_at < $4
        `,
        [organizationId, branchId, from, to]
    );

    return result.rows[0];
};

const getNewCustomerCount = async ({ organizationId, from, to }, client = pool) => {
    const result = await client.query(
        `
            SELECT COUNT(*)::int AS new_customers
            FROM customers
            WHERE organization_id = $1
              AND created_at >= $2 AND created_at < $3
        `,
        [organizationId, from, to]
    );

    return result.rows[0];
};

const getTopItems = async ({ organizationId, branchId = "", from, to, limit = 10 }, client = pool) => {
    const result = await client.query(
        `
            SELECT
                si.item_type,
                COALESCE(p.name, ss.name, si.description) AS name,
                SUM(si.quantity)::int AS quantity,
                SUM(si.line_total) AS revenue
            FROM sale_items si
            INNER JOIN sales s ON s.id = si.sale_id
            LEFT JOIN products p ON p.id = si.product_id
            LEFT JOIN appointments sa ON sa.id = si.appointment_id
            LEFT JOIN services ss ON ss.id = sa.service_id
            WHERE s.organization_id = $1
              AND ($2::text = '' OR s.branch_id = $2::uuid)
              AND s.status = 'paid'
              AND s.created_at >= $3 AND s.created_at < $4
            GROUP BY si.item_type, COALESCE(p.name, ss.name, si.description)
            ORDER BY revenue DESC
            LIMIT $5
        `,
        [organizationId, branchId, from, to, limit]
    );

    return result.rows;
};

/**
 * Paid revenue per calendar day over [from, to) — generate_series fills
 * the quiet days with zero rows so the dashboard sparkline always has
 * one point per day, not a line that skips days nothing was sold.
 */
const getDailyRevenue = async ({ organizationId, branchId = "", from, to }, client = pool) => {
    const result = await client.query(
        `
            SELECT
                d.day::date AS day,
                COALESCE(SUM(s.total_amount), 0) AS revenue,
                COUNT(s.id)::int AS sale_count
            FROM generate_series($3::timestamptz, $4::timestamptz - INTERVAL '1 day', INTERVAL '1 day') AS d(day)
            LEFT JOIN sales s
                ON s.created_at >= d.day AND s.created_at < d.day + INTERVAL '1 day'
               AND s.organization_id = $1
               AND ($2::text = '' OR s.branch_id = $2::uuid)
               AND s.status = 'paid'
            GROUP BY d.day
            ORDER BY d.day ASC
        `,
        [organizationId, branchId, from, to]
    );

    return result.rows;
};

const getLowStock = async ({ organizationId, branchId = "" }, client = pool) => {
    const result = await client.query(
        `
            SELECT
                ps.product_id, ps.branch_id, ps.quantity, ps.reorder_level,
                p.name AS product_name, p.sku AS product_sku,
                b.name AS branch_name
            FROM product_stock ps
            INNER JOIN products p ON p.id = ps.product_id
            INNER JOIN branches b ON b.id = ps.branch_id
            WHERE ps.organization_id = $1
              AND ($2::text = '' OR ps.branch_id = $2::uuid)
              AND ps.quantity <= ps.reorder_level
            ORDER BY ps.quantity ASC, p.name ASC
        `,
        [organizationId, branchId]
    );

    return result.rows;
};

// --- Profit & margin -------------------------------------------------------

// Product revenue vs cost of goods sold, plus service revenue (services carry
// no stock cost). Gross profit is computed in the service.
const getProfitSummary = async ({ organizationId, branchId = "", from, to }, client = pool) => {
    const result = await client.query(
        `
            SELECT
                COALESCE(SUM(si.line_total) FILTER (WHERE si.item_type = 'product'), 0) AS product_revenue,
                COALESCE(SUM(si.quantity * p.cost) FILTER (WHERE si.item_type = 'product'), 0) AS cogs,
                COALESCE(SUM(si.line_total) FILTER (WHERE si.item_type = 'service'), 0) AS service_revenue
            FROM sale_items si
            INNER JOIN sales s ON s.id = si.sale_id
            LEFT JOIN products p ON p.id = si.product_id
            WHERE s.organization_id = $1
              AND ($2::text = '' OR s.branch_id = $2::uuid)
              AND s.status = 'paid'
              AND s.created_at >= $3 AND s.created_at < $4
        `,
        [organizationId, branchId, from, to]
    );
    return result.rows[0];
};

const getProfitByProduct = async ({ organizationId, branchId = "", from, to, limit = 100 }, client = pool) => {
    const result = await client.query(
        `
            SELECT
                p.id, p.name, p.sku,
                SUM(si.quantity)::int AS quantity,
                COALESCE(SUM(si.line_total), 0) AS revenue,
                COALESCE(SUM(si.quantity * p.cost), 0) AS cost,
                COALESCE(SUM(si.line_total - si.quantity * p.cost), 0) AS profit
            FROM sale_items si
            INNER JOIN sales s ON s.id = si.sale_id
            INNER JOIN products p ON p.id = si.product_id
            WHERE si.item_type = 'product'
              AND s.organization_id = $1
              AND ($2::text = '' OR s.branch_id = $2::uuid)
              AND s.status = 'paid'
              AND s.created_at >= $3 AND s.created_at < $4
            GROUP BY p.id, p.name, p.sku
            ORDER BY profit DESC
            LIMIT $5
        `,
        [organizationId, branchId, from, to, limit]
    );
    return result.rows;
};

// --- Sales by staff (cashier) ----------------------------------------------

const getSalesByStaff = async ({ organizationId, branchId = "", from, to }, client = pool) => {
    const result = await client.query(
        `
            SELECT
                u.id, u.first_name, u.last_name,
                COUNT(s.id)::int AS sale_count,
                COALESCE(SUM(s.total_amount), 0) AS revenue,
                COALESCE(SUM(s.returned_amount), 0) AS refunded
            FROM sales s
            INNER JOIN users u ON u.id = s.created_by
            WHERE s.organization_id = $1
              AND ($2::text = '' OR s.branch_id = $2::uuid)
              AND s.status = 'paid'
              AND s.created_at >= $3 AND s.created_at < $4
            GROUP BY u.id, u.first_name, u.last_name
            ORDER BY revenue DESC
        `,
        [organizationId, branchId, from, to]
    );
    return result.rows;
};

// --- Payments / cash-up ----------------------------------------------------

const getPaymentBreakdown = async ({ organizationId, branchId = "", from, to }, client = pool) => {
    const result = await client.query(
        `
            SELECT
                pm.method,
                COUNT(*)::int AS count,
                COALESCE(SUM(pm.amount), 0) AS total
            FROM payments pm
            INNER JOIN sales s ON s.id = pm.sale_id
            WHERE s.organization_id = $1
              AND ($2::text = '' OR s.branch_id = $2::uuid)
              AND s.status = 'paid'
              AND s.created_at >= $3 AND s.created_at < $4
            GROUP BY pm.method
            ORDER BY total DESC
        `,
        [organizationId, branchId, from, to]
    );
    return result.rows;
};

// --- Expenses by category (for P&L) ----------------------------------------

const getExpensesByCategory = async ({ organizationId, branchId = "", from, to }, client = pool) => {
    const result = await client.query(
        `
            SELECT
                COALESCE(NULLIF(category, ''), 'Uncategorized') AS category,
                COUNT(*)::int AS count,
                COALESCE(SUM(amount), 0) AS total
            FROM expenses
            WHERE organization_id = $1
              AND ($2::text = '' OR branch_id = $2::uuid)
              AND status = 'paid'
              AND paid_at >= $3 AND paid_at < $4
            GROUP BY 1
            ORDER BY total DESC
        `,
        [organizationId, branchId, from, to]
    );
    return result.rows;
};

// --- Expiry (batches at or near expiry) ------------------------------------

const getExpiringStock = async ({ organizationId, branchId = "", withinDays = 90 }, client = pool) => {
    const result = await client.query(
        `
            SELECT
                sb.product_id, p.name AS product_name, p.sku AS product_sku, p.cost,
                sb.branch_id, b.name AS branch_name,
                sb.expiry_date,
                (sb.expiry_date - CURRENT_DATE)::int AS days_left,
                SUM(sb.quantity)::int AS quantity,
                COALESCE(SUM(sb.quantity * p.cost), 0) AS value_at_risk
            FROM stock_batches sb
            INNER JOIN products p ON p.id = sb.product_id
            INNER JOIN branches b ON b.id = sb.branch_id
            WHERE sb.organization_id = $1
              AND ($2::text = '' OR sb.branch_id = $2::uuid)
              AND sb.quantity > 0
              AND sb.expiry_date IS NOT NULL
              AND sb.expiry_date <= CURRENT_DATE + ($3::int * INTERVAL '1 day')
            GROUP BY sb.product_id, p.name, p.sku, p.cost, sb.branch_id, b.name, sb.expiry_date
            ORDER BY sb.expiry_date ASC
        `,
        [organizationId, branchId, withinDays]
    );
    return result.rows;
};

// --- Inventory valuation ---------------------------------------------------

const getInventoryValuation = async ({ organizationId, branchId = "" }, client = pool) => {
    const result = await client.query(
        `
            SELECT
                p.id, p.name, p.sku, p.cost, p.price,
                c.name AS category_name,
                SUM(ps.quantity)::int AS quantity,
                COALESCE(SUM(ps.quantity * p.cost), 0) AS cost_value,
                COALESCE(SUM(ps.quantity * p.price), 0) AS retail_value
            FROM product_stock ps
            INNER JOIN products p ON p.id = ps.product_id
            LEFT JOIN categories c ON c.id = p.category_id
            WHERE ps.organization_id = $1
              AND ($2::text = '' OR ps.branch_id = $2::uuid)
              AND ps.quantity > 0
            GROUP BY p.id, p.name, p.sku, p.cost, p.price, c.name
            ORDER BY cost_value DESC
        `,
        [organizationId, branchId]
    );
    return result.rows;
};

// --- Sales by category -----------------------------------------------------

const getSalesByCategory = async ({ organizationId, branchId = "", from, to }, client = pool) => {
    const result = await client.query(
        `
            SELECT
                COALESCE(c.name, 'Uncategorized') AS category,
                SUM(si.quantity)::int AS quantity,
                COALESCE(SUM(si.line_total), 0) AS revenue,
                COALESCE(SUM(si.quantity * p.cost), 0) AS cost,
                COALESCE(SUM(si.line_total - si.quantity * p.cost), 0) AS profit
            FROM sale_items si
            INNER JOIN sales s ON s.id = si.sale_id
            INNER JOIN products p ON p.id = si.product_id
            LEFT JOIN categories c ON c.id = p.category_id
            WHERE si.item_type = 'product'
              AND s.organization_id = $1
              AND ($2::text = '' OR s.branch_id = $2::uuid)
              AND s.status = 'paid'
              AND s.created_at >= $3 AND s.created_at < $4
            GROUP BY COALESCE(c.name, 'Uncategorized')
            ORDER BY revenue DESC
        `,
        [organizationId, branchId, from, to]
    );
    return result.rows;
};

// --- Branch comparison (all branches, ignores the branch filter) -----------

const getBranchComparison = async ({ organizationId, from, to }, client = pool) => {
    const result = await client.query(
        `
            SELECT
                b.id, b.name,
                COUNT(s.id)::int AS sale_count,
                COALESCE(SUM(s.total_amount), 0) AS revenue,
                COALESCE(SUM(s.returned_amount), 0) AS refunded
            FROM branches b
            LEFT JOIN sales s
                ON s.branch_id = b.id
               AND s.status = 'paid'
               AND s.created_at >= $2 AND s.created_at < $3
            WHERE b.organization_id = $1
            GROUP BY b.id, b.name
            ORDER BY revenue DESC
        `,
        [organizationId, from, to]
    );
    return result.rows;
};

// --- VAT / tax -------------------------------------------------------------

const getTaxSummary = async ({ organizationId, branchId = "", from, to }, client = pool) => {
    const result = await client.query(
        `
            SELECT
                COUNT(*)::int AS sale_count,
                COALESCE(SUM(tax_amount), 0) AS tax_total,
                COALESCE(SUM(subtotal - discount_amount), 0) AS taxable_base,
                COALESCE(SUM(total_amount), 0) AS gross
            FROM sales
            WHERE organization_id = $1
              AND ($2::text = '' OR branch_id = $2::uuid)
              AND status = 'paid'
              AND created_at >= $3 AND created_at < $4
        `,
        [organizationId, branchId, from, to]
    );
    return result.rows[0];
};

const getTaxDaily = async ({ organizationId, branchId = "", from, to }, client = pool) => {
    const result = await client.query(
        `
            SELECT
                d.day::date AS day,
                COALESCE(SUM(s.subtotal - s.discount_amount), 0) AS taxable_base,
                COALESCE(SUM(s.tax_amount), 0) AS tax_total
            FROM generate_series($3::timestamptz, $4::timestamptz - INTERVAL '1 day', INTERVAL '1 day') AS d(day)
            LEFT JOIN sales s
                ON s.created_at >= d.day AND s.created_at < d.day + INTERVAL '1 day'
               AND s.organization_id = $1
               AND ($2::text = '' OR s.branch_id = $2::uuid)
               AND s.status = 'paid'
            GROUP BY d.day
            ORDER BY d.day ASC
        `,
        [organizationId, branchId, from, to]
    );
    return result.rows;
};

// --- Discounts given -------------------------------------------------------

const getDiscountUsage = async ({ organizationId, branchId = "", from, to }, client = pool) => {
    const result = await client.query(
        `
            SELECT
                COALESCE(d.code, 'Ad-hoc') AS code,
                COUNT(s.id)::int AS times_used,
                COALESCE(SUM(s.discount_amount), 0) AS total_discount
            FROM sales s
            LEFT JOIN discounts d ON d.id = s.discount_id
            WHERE s.organization_id = $1
              AND ($2::text = '' OR s.branch_id = $2::uuid)
              AND s.status = 'paid'
              AND s.discount_amount > 0
              AND s.created_at >= $3 AND s.created_at < $4
            GROUP BY COALESCE(d.code, 'Ad-hoc')
            ORDER BY total_discount DESC
        `,
        [organizationId, branchId, from, to]
    );
    return result.rows;
};

// --- Top customers ---------------------------------------------------------

const getTopCustomers = async ({ organizationId, branchId = "", from, to, limit = 50 }, client = pool) => {
    const result = await client.query(
        `
            SELECT
                c.id, c.name,
                COUNT(s.id)::int AS order_count,
                COALESCE(SUM(s.total_amount), 0) AS spend,
                MAX(s.created_at) AS last_order
            FROM sales s
            INNER JOIN customers c ON c.id = s.customer_id
            WHERE s.organization_id = $1
              AND ($2::text = '' OR s.branch_id = $2::uuid)
              AND s.status = 'paid'
              AND s.created_at >= $3 AND s.created_at < $4
            GROUP BY c.id, c.name
            ORDER BY spend DESC
            LIMIT $5
        `,
        [organizationId, branchId, from, to, limit]
    );
    return result.rows;
};

module.exports = {
    getSalesSummary,
    getReturnsSummary,
    getPurchasesSummary,
    getAppointmentsSummary,
    getNewCustomerCount,
    getTopItems,
    getDailyRevenue,
    getLowStock,
    getProfitSummary,
    getProfitByProduct,
    getSalesByStaff,
    getPaymentBreakdown,
    getExpensesByCategory,
    getExpiringStock,
    getInventoryValuation,
    getSalesByCategory,
    getBranchComparison,
    getTaxSummary,
    getTaxDaily,
    getDiscountUsage,
    getTopCustomers,
};
