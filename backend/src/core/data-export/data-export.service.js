/**
 * ============================================================
 * File: data-export.service.js
 * Module: Core Data Export
 *
 * Description:
 * Builds a single Excel workbook (one sheet per dataset) of an organization's
 * important business data — the owner's portable copy / backup. Runs under the
 * caller's org DB context, so RLS guarantees it can ONLY ever contain the
 * caller's own organization's rows. Secrets (password hashes, sync tokens) are
 * never selected. Each dataset is resilient: a query that fails (e.g. a table
 * absent in some deployment) becomes a note in its sheet, not a failed export.
 * ============================================================
 */

const ExcelJS = require("exceljs");
const db = require("../../config/db");

// sheet name → SQL (org-scoped by RLS + an explicit filter). Sheet names stay
// ≤ 31 chars and free of Excel's forbidden characters ( : \ / ? * [ ] ).
const DATASETS = [
    { sheet: "Sales", sql: "SELECT * FROM sales WHERE organization_id = $1" },
    { sheet: "Sale Items", sql: "SELECT * FROM sale_items WHERE organization_id = $1" },
    { sheet: "Payments", sql: "SELECT * FROM payments WHERE organization_id = $1" },
    { sheet: "Sale Returns", sql: "SELECT * FROM sale_returns WHERE organization_id = $1" },
    { sheet: "Customer Ledger", sql: "SELECT * FROM customer_ledger_entries WHERE organization_id = $1" },
    { sheet: "Expenses", sql: "SELECT * FROM expenses WHERE organization_id = $1" },
    { sheet: "Purchases", sql: "SELECT * FROM purchases WHERE organization_id = $1" },
    { sheet: "Purchase Items", sql: "SELECT * FROM purchase_items WHERE organization_id = $1" },
    { sheet: "Cash Register", sql: "SELECT * FROM cash_register_transactions WHERE organization_id = $1" },
    { sheet: "Customers", sql: "SELECT * FROM customers WHERE organization_id = $1" },
    { sheet: "Suppliers", sql: "SELECT * FROM suppliers WHERE organization_id = $1" },
    // Staff WITHOUT password hashes.
    { sheet: "Staff", sql: "SELECT id, first_name, last_name, email, role_id, branch_id, is_active, must_change_password, created_at FROM users WHERE organization_id = $1" },
    { sheet: "Roles", sql: "SELECT * FROM roles WHERE organization_id = $1" },
    { sheet: "Products", sql: "SELECT * FROM products WHERE organization_id = $1" },
    { sheet: "Product Stock", sql: "SELECT * FROM product_stock WHERE organization_id = $1" },
    { sheet: "Services", sql: "SELECT * FROM services WHERE organization_id = $1" },
    { sheet: "Categories", sql: "SELECT * FROM categories WHERE organization_id = $1" },
    { sheet: "Taxes", sql: "SELECT * FROM taxes WHERE organization_id = $1" },
    { sheet: "Discounts", sql: "SELECT * FROM discounts WHERE organization_id = $1" },
    { sheet: "Branches", sql: "SELECT * FROM branches WHERE organization_id = $1" },
    { sheet: "Stock Movements", sql: "SELECT * FROM stock_movements WHERE organization_id = $1" },
    { sheet: "Stock Shipments", sql: "SELECT * FROM stock_shipments WHERE organization_id = $1" },
    { sheet: "Stock Batches", sql: "SELECT * FROM stock_batches WHERE organization_id = $1" },
    { sheet: "Appointments", sql: "SELECT * FROM appointments WHERE organization_id = $1" },
    { sheet: "Attendance", sql: "SELECT * FROM attendance WHERE organization_id = $1" },
    { sheet: "Settings", sql: "SELECT * FROM settings WHERE organization_id = $1" },
    { sheet: "Subscription Payments", sql: "SELECT * FROM subscription_payments WHERE organization_id = $1" },
];

// ExcelJS accepts Date/number/string/boolean directly; anything else (jsonb
// objects/arrays) is stringified so it doesn't render as [object Object].
const toCell = (value) => {
    if (value === null || value === undefined) return "";
    if (value instanceof Date) return value;
    if (typeof value === "object") return JSON.stringify(value);
    return value;
};

const addSheet = (workbook, name, rows) => {
    const ws = workbook.addWorksheet(name);
    if (!rows.length) {
        ws.addRow(["(no records)"]);
        return;
    }
    const keys = Object.keys(rows[0]);
    ws.columns = keys.map((k) => ({ header: k, key: k, width: 20 }));
    ws.getRow(1).font = { bold: true };
    for (const row of rows) {
        ws.addRow(keys.reduce((acc, k) => ({ ...acc, [k]: toCell(row[k]) }), {}));
    }
};

/**
 * Build the full-export workbook for an organization.
 *
 * @param {string} organizationId
 * @returns {Promise<{buffer: Buffer, sheets: number}>}
 */
const buildExportBuffer = async (organizationId) => {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Winstore";
    workbook.created = new Date();

    // A small cover sheet so the file is self-describing.
    const cover = workbook.addWorksheet("About this export");
    cover.addRow(["Winstore data export"]);
    cover.addRow(["Generated", new Date().toISOString()]);
    cover.addRow(["Note", "Each sheet is one dataset for your organization. Password hashes and system secrets are never included."]);
    cover.getRow(1).font = { bold: true, size: 14 };

    for (const { sheet, sql } of DATASETS) {
        try {
            const result = await db.query(sql, [organizationId]);
            addSheet(workbook, sheet, result.rows);
        } catch (error) {
            // A dataset that can't be read (missing table in some deployment)
            // shouldn't sink the whole export — note it and move on.
            const ws = workbook.addWorksheet(sheet);
            ws.addRow([`(could not export: ${error.message})`]);
        }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return { buffer: Buffer.from(buffer), sheets: DATASETS.length };
};

module.exports = { buildExportBuffer, DATASETS };
