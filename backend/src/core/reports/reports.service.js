/**
 * ============================================================
 * File: reports.service.js
 * Module: Core Reports
 *
 * Description:
 * Computed reports over the real business tables. Nothing is
 * stored — every report is aggregated at request time, so the
 * numbers can never drift from the data they summarize.
 *
 * Date handling: `from`/`to` arrive as YYYY-MM-DD. The range is
 * half-open [from, to + 1 day) so the `to` day is fully included.
 * Defaults to the last 30 days.
 * ============================================================
 */

const AppError = require("../../utils/AppError");
const { validateReportRange } = require("./reports.validation");
const reportsRepository = require("./reports.repository");
const expensesRepository = require("../expenses/expenses.repository");
const customerLedgerRepository = require("../customer-ledger/customer-ledger.repository");

const DAY_MS = 24 * 60 * 60 * 1000;

const resolveRange = (query) => {
    const validationErrors = validateReportRange(query);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    const to = query.to ? new Date(new Date(query.to).getTime() + DAY_MS) : new Date();
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * DAY_MS);

    return { from, to };
};

const getSummary = async (query = {}) => {
    const { from, to } = resolveRange(query);
    const scope = { organizationId: query.organizationId, branchId: query.branchId, from, to };

    const [sales, returns, purchases, appointments, customers, expenses] = await Promise.all([
        reportsRepository.getSalesSummary(scope),
        reportsRepository.getReturnsSummary(scope),
        reportsRepository.getPurchasesSummary(scope),
        reportsRepository.getAppointmentsSummary(scope),
        reportsRepository.getNewCustomerCount(scope),
        expensesRepository.getPaidExpensesSummary(scope),
    ]);

    const grossRevenue = Number(sales.revenue);
    const refundTotal = Number(returns.refund_total);

    return {
        from,
        to,
        sales: {
            count: sales.sale_count,
            subtotal: Number(sales.subtotal),
            discountTotal: Number(sales.discount_total),
            taxTotal: Number(sales.tax_total),
            revenue: grossRevenue,
        },
        returns: {
            count: returns.return_count,
            total: refundTotal,
        },
        // Revenue after refunds — the figure that actually landed.
        netRevenue: Math.round((grossRevenue - refundTotal) * 100) / 100,
        purchases: {
            count: purchases.purchase_count,
            spend: Number(purchases.spend),
        },
        expenses: {
            count: expenses.expense_count,
            total: Number(expenses.total),
        },
        appointments: {
            completed: appointments.completed,
            scheduled: appointments.scheduled,
            notKept: appointments.not_kept,
        },
        newCustomers: customers.new_customers,
    };
};

const getTopItems = async (query = {}) => {
    const { from, to } = resolveRange(query);
    const rows = await reportsRepository.getTopItems({
        organizationId: query.organizationId,
        branchId: query.branchId,
        from,
        to,
    });

    return rows.map((row) => ({
        itemType: row.item_type,
        name: row.name,
        quantity: row.quantity,
        revenue: Number(row.revenue),
    }));
};

/**
 * Revenue per day for the dashboard sparkline. Same half-open range
 * handling as every other report; defaults to the last 7 days when no
 * range is given.
 */
const getRevenueTrend = async (query = {}) => {
    const to = query.to ? new Date(new Date(query.to).getTime() + DAY_MS) : new Date();
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - 7 * DAY_MS);
    if (query.from || query.to) {
        const validationErrors = validateReportRange(query);
        if (validationErrors.length > 0) {
            throw new AppError(validationErrors.join(" "), 400);
        }
    }

    const rows = await reportsRepository.getDailyRevenue({
        organizationId: query.organizationId,
        branchId: query.branchId,
        from,
        to,
    });

    return rows.map((row) => ({
        day: row.day,
        revenue: Number(row.revenue),
        saleCount: row.sale_count,
    }));
};

const getLowStock = async (query = {}) => {
    const rows = await reportsRepository.getLowStock({
        organizationId: query.organizationId,
        branchId: query.branchId,
    });

    return rows.map((row) => ({
        productId: row.product_id,
        branchId: row.branch_id,
        productName: row.product_name,
        productSku: row.product_sku,
        branchName: row.branch_name,
        quantity: row.quantity,
        reorderLevel: row.reorder_level,
    }));
};

const round2 = (value) => Math.round(Number(value) * 100) / 100;
const marginPct = (profit, revenue) => (Number(revenue) > 0 ? round2((Number(profit) / Number(revenue)) * 100) : 0);

const getProfit = async (query = {}) => {
    const { from, to } = resolveRange(query);
    const scope = { organizationId: query.organizationId, branchId: query.branchId, from, to };
    const [summary, byProduct] = await Promise.all([
        reportsRepository.getProfitSummary(scope),
        reportsRepository.getProfitByProduct(scope),
    ]);

    const productRevenue = Number(summary.product_revenue);
    const serviceRevenue = Number(summary.service_revenue);
    const cogs = Number(summary.cogs);
    const revenue = productRevenue + serviceRevenue;
    const grossProfit = revenue - cogs;

    return {
        range: { from, to },
        totals: {
            revenue: round2(revenue),
            productRevenue: round2(productRevenue),
            serviceRevenue: round2(serviceRevenue),
            cogs: round2(cogs),
            grossProfit: round2(grossProfit),
            marginPct: marginPct(grossProfit, revenue),
        },
        products: byProduct.map((row) => ({
            id: row.id,
            name: row.name,
            sku: row.sku,
            quantity: row.quantity,
            revenue: round2(row.revenue),
            cost: round2(row.cost),
            profit: round2(row.profit),
            marginPct: marginPct(row.profit, row.revenue),
        })),
    };
};

const getSalesByStaff = async (query = {}) => {
    const { from, to } = resolveRange(query);
    const rows = await reportsRepository.getSalesByStaff({
        organizationId: query.organizationId,
        branchId: query.branchId,
        from,
        to,
    });
    return {
        range: { from, to },
        staff: rows.map((row) => ({
            id: row.id,
            name: `${row.first_name} ${row.last_name}`.trim(),
            saleCount: row.sale_count,
            revenue: round2(row.revenue),
            refunded: round2(row.refunded),
            netRevenue: round2(Number(row.revenue) - Number(row.refunded)),
            averageSale: row.sale_count > 0 ? round2(Number(row.revenue) / row.sale_count) : 0,
        })),
    };
};

const getCashUp = async (query = {}) => {
    const { from, to } = resolveRange(query);
    const rows = await reportsRepository.getPaymentBreakdown({
        organizationId: query.organizationId,
        branchId: query.branchId,
        from,
        to,
    });
    const methods = rows.map((row) => ({ method: row.method, count: row.count, total: round2(row.total) }));
    return {
        range: { from, to },
        methods,
        total: round2(methods.reduce((sum, m) => sum + m.total, 0)),
        expectedCash: round2(methods.filter((m) => m.method === "cash").reduce((sum, m) => sum + m.total, 0)),
    };
};

const getProfitAndLoss = async (query = {}) => {
    const { from, to } = resolveRange(query);
    const scope = { organizationId: query.organizationId, branchId: query.branchId, from, to };
    const [profit, expenseRows] = await Promise.all([
        reportsRepository.getProfitSummary(scope),
        reportsRepository.getExpensesByCategory(scope),
    ]);

    const revenue = Number(profit.product_revenue) + Number(profit.service_revenue);
    const cogs = Number(profit.cogs);
    const grossProfit = revenue - cogs;
    const expenses = expenseRows.map((row) => ({ category: row.category, count: row.count, total: round2(row.total) }));
    const totalExpenses = round2(expenses.reduce((sum, e) => sum + e.total, 0));

    return {
        range: { from, to },
        revenue: round2(revenue),
        cogs: round2(cogs),
        grossProfit: round2(grossProfit),
        expenses,
        totalExpenses,
        netProfit: round2(grossProfit - totalExpenses),
    };
};

const getExpiry = async (query = {}) => {
    const withinDays = Math.min(365, Math.max(1, Number.parseInt(query.withinDays, 10) || 90));
    const rows = await reportsRepository.getExpiringStock({
        organizationId: query.organizationId,
        branchId: query.branchId,
        withinDays,
    });
    const items = rows.map((row) => ({
        productId: row.product_id,
        productName: row.product_name,
        productSku: row.product_sku,
        branchName: row.branch_name,
        expiryDate: row.expiry_date,
        daysLeft: row.days_left,
        quantity: row.quantity,
        valueAtRisk: round2(row.value_at_risk),
        status: row.days_left < 0 ? "expired" : row.days_left <= 30 ? "critical" : "warning",
    }));
    return {
        withinDays,
        items,
        totalAtRisk: round2(items.reduce((sum, i) => sum + i.valueAtRisk, 0)),
        expiredValue: round2(items.filter((i) => i.status === "expired").reduce((sum, i) => sum + i.valueAtRisk, 0)),
    };
};

const getInventoryValuation = async (query = {}) => {
    const rows = await reportsRepository.getInventoryValuation({
        organizationId: query.organizationId,
        branchId: query.branchId,
    });
    const items = rows.map((row) => ({
        productId: row.id,
        name: row.name,
        sku: row.sku,
        categoryName: row.category_name || "Uncategorized",
        quantity: row.quantity,
        cost: round2(row.cost),
        costValue: round2(row.cost_value),
        retailValue: round2(row.retail_value),
    }));
    return {
        items,
        totalCostValue: round2(items.reduce((sum, i) => sum + i.costValue, 0)),
        totalRetailValue: round2(items.reduce((sum, i) => sum + i.retailValue, 0)),
        skuCount: items.length,
    };
};

const getSalesByCategory = async (query = {}) => {
    const { from, to } = resolveRange(query);
    const rows = await reportsRepository.getSalesByCategory({
        organizationId: query.organizationId,
        branchId: query.branchId,
        from,
        to,
    });
    return {
        range: { from, to },
        categories: rows.map((row) => ({
            category: row.category,
            quantity: row.quantity,
            revenue: round2(row.revenue),
            cost: round2(row.cost),
            profit: round2(row.profit),
            marginPct: marginPct(row.profit, row.revenue),
        })),
    };
};

const getBranchComparison = async (query = {}) => {
    const { from, to } = resolveRange(query);
    const rows = await reportsRepository.getBranchComparison({
        organizationId: query.organizationId,
        from,
        to,
    });
    return {
        range: { from, to },
        branches: rows.map((row) => ({
            id: row.id,
            name: row.name,
            saleCount: row.sale_count,
            revenue: round2(row.revenue),
            refunded: round2(row.refunded),
            netRevenue: round2(Number(row.revenue) - Number(row.refunded)),
        })),
    };
};

const getTax = async (query = {}) => {
    const { from, to } = resolveRange(query);
    const scope = { organizationId: query.organizationId, branchId: query.branchId, from, to };
    const [summary, daily] = await Promise.all([
        reportsRepository.getTaxSummary(scope),
        reportsRepository.getTaxDaily(scope),
    ]);
    const taxTotal = Number(summary.tax_total);
    const taxableBase = Number(summary.taxable_base);
    return {
        range: { from, to },
        saleCount: summary.sale_count,
        taxCollected: round2(taxTotal),
        taxableBase: round2(taxableBase),
        gross: round2(summary.gross),
        effectiveRate: marginPct(taxTotal, taxableBase),
        daily: daily.map((row) => ({
            day: row.day,
            taxableBase: round2(row.taxable_base),
            taxCollected: round2(row.tax_total),
        })),
    };
};

const getDiscounts = async (query = {}) => {
    const { from, to } = resolveRange(query);
    const rows = await reportsRepository.getDiscountUsage({
        organizationId: query.organizationId,
        branchId: query.branchId,
        from,
        to,
    });
    const discounts = rows.map((row) => ({
        code: row.code,
        timesUsed: row.times_used,
        totalDiscount: round2(row.total_discount),
    }));
    return {
        range: { from, to },
        discounts,
        totalGiven: round2(discounts.reduce((sum, d) => sum + d.totalDiscount, 0)),
    };
};

const getCustomers = async (query = {}) => {
    const { from, to } = resolveRange(query);
    const rows = await reportsRepository.getTopCustomers({
        organizationId: query.organizationId,
        branchId: query.branchId,
        from,
        to,
    });
    return {
        range: { from, to },
        customers: rows.map((row) => ({
            id: row.id,
            name: row.name,
            orderCount: row.order_count,
            spend: round2(row.spend),
            lastOrder: row.last_order,
        })),
    };
};

/**
 * Receivables: who owes the business money and how much, right now — a
 * snapshot from the customer credit ledger (no date range).
 */
const getReceivables = async (query = {}) => {
    const rows = await customerLedgerRepository.getReceivables({ organizationId: query.organizationId });
    const customers = rows.map((row) => ({
        id: row.id,
        name: row.name,
        phone: row.phone,
        balance: round2(row.balance),
        lastActivity: row.last_activity,
    }));
    return {
        customers,
        totalOutstanding: round2(customers.reduce((sum, customer) => sum + customer.balance, 0)),
    };
};

module.exports = {
    getSummary,
    getTopItems,
    getRevenueTrend,
    getLowStock,
    getReceivables,
    getProfit,
    getSalesByStaff,
    getCashUp,
    getProfitAndLoss,
    getExpiry,
    getInventoryValuation,
    getSalesByCategory,
    getBranchComparison,
    getTax,
    getDiscounts,
    getCustomers,
};
