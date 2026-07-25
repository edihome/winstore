/**
 * ============================================================
 * File: hardDelete.js
 * Module: Shared Utilities
 *
 * Description:
 * Generic hard delete for the Developer role's "delete anything you
 * can view" capability. Every other role only ever gets
 * activate/deactivate (a status flag) — this is deliberately the one
 * exception, gated behind requireRole("developer") on each resource's
 * routes, not a permission grant.
 *
 * A record with rows still pointing at it via a plain (non-cascading)
 * foreign key is blocked with a clear 409 unless the caller passes
 * `force`, in which case those referencing rows are removed first,
 * recursively — so a deeper dependent (e.g. an appointment's own
 * billed sale line item) doesn't silently re-block the same delete.
 * Foreign keys already declared ON DELETE CASCADE/SET NULL need no
 * entry here at all; they resolve themselves with no blocking.
 *
 * Some dependents are line items of a larger record (a sale/purchase),
 * not standalone rows — deleting just the one line item would leave an
 * invoice with a total that no longer matches its items. Those use
 * `escalateTo` to remove the whole parent record instead (which then
 * cascades to its own line items/payments via the schema's existing
 * ON DELETE CASCADE), so a force-delete never leaves a partial invoice.
 *
 * This is intentionally generic, cross-cutting raw SQL living outside
 * any one module's repository — like bulkImport.js, it's
 * infrastructure the per-resource services call into, not business
 * logic that belongs to one of them.
 * ============================================================
 */

const pool = require("../config/db");
const AppError = require("./AppError");

const RESTRICT_DEPENDENTS = {
    products: [
        {
            table: "sale_items",
            column: "product_id",
            label: "sale(s)",
            escalateTo: { table: "sales", idColumn: "sale_id" },
        },
        {
            table: "purchase_items",
            column: "product_id",
            label: "purchase(s)",
            escalateTo: { table: "purchases", idColumn: "purchase_id" },
        },
        { table: "stock_movements", column: "product_id", label: "stock movement(s)" },
    ],
    customers: [
        { table: "appointments", column: "customer_id", label: "appointment(s)" },
        { table: "sales", column: "customer_id", label: "sale(s)" },
    ],
    suppliers: [
        { table: "purchases", column: "supplier_id", label: "purchase(s)" },
    ],
    services: [
        { table: "appointments", column: "service_id", label: "appointment(s)" },
    ],
    users: [
        { table: "appointments", column: "provider_id", label: "appointment(s) as provider" },
        { table: "appointments", column: "created_by", label: "appointment(s) created" },
    ],
    appointments: [
        {
            table: "sale_items",
            column: "appointment_id",
            label: "sale(s)",
            escalateTo: { table: "sales", idColumn: "sale_id" },
        },
    ],
    sales: [],
    discounts: [],
    taxes: [],
    organizations: [],
};

/**
 * How many distinct records this dependent would affect — the distinct
 * parent count when escalating (e.g. sales, not sale_items rows), so
 * the block message says "1 sale" rather than "3 sale line items".
 */
const countReferencingRows = async (dependent, id, client) => {
    if (dependent.escalateTo) {
        const result = await client.query(
            `SELECT COUNT(DISTINCT ${dependent.escalateTo.idColumn})::int AS count FROM ${dependent.table} WHERE ${dependent.column} = $1`,
            [id]
        );
        return result.rows[0].count;
    }

    const result = await client.query(`SELECT COUNT(*)::int AS count FROM ${dependent.table} WHERE ${dependent.column} = $1`, [id]);
    return result.rows[0].count;
};

/**
 * Recursively remove every row that references `id` in `table` (per
 * RESTRICT_DEPENDENTS), clearing each dependent's own dependents first,
 * then remove `id` itself. A dependent with `escalateTo` removes its
 * parent record instead of the line item directly.
 */
const cascadeDelete = async (table, id, client) => {
    const dependents = RESTRICT_DEPENDENTS[table] || [];

    for (const dependent of dependents) {
        if (dependent.escalateTo) {
            const { rows } = await client.query(
                `SELECT DISTINCT ${dependent.escalateTo.idColumn} AS parent_id FROM ${dependent.table} WHERE ${dependent.column} = $1`,
                [id]
            );
            for (const row of rows) {
                await cascadeDelete(dependent.escalateTo.table, row.parent_id, client);
            }
            continue;
        }

        const { rows } = await client.query(
            `SELECT id FROM ${dependent.table} WHERE ${dependent.column} = $1`,
            [id]
        );
        for (const row of rows) {
            await cascadeDelete(dependent.table, row.id, client);
        }
    }

    await client.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
};

/**
 * Hard-delete a row by id.
 *
 * Without `force`: blocks with a 409 listing exactly what still
 * references it, when any RESTRICT dependent has rows. The thrown
 * error carries `blockedByDependents: true` so the caller can offer a
 * "delete anyway" retry.
 *
 * With `force: true`: cascades through every dependent first
 * (recursively), then deletes the row. This can delete far more than
 * the one record — e.g. force-deleting a customer also deletes their
 * appointments and sales — by design, since the caller was already
 * shown what would go and chose to proceed.
 *
 * @param {object} params { table, id, force }
 * @returns {Promise<void>}
 */
const hardDelete = async ({ table, id, force = false }) => {
    const dependents = RESTRICT_DEPENDENTS[table] || [];
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        if (!force && dependents.length > 0) {
            const blocking = [];
            for (const dependent of dependents) {
                const count = await countReferencingRows(dependent, id, client);
                if (count > 0) {
                    blocking.push(`${count} ${dependent.label}`);
                }
            }

            if (blocking.length > 0) {
                const error = new AppError(
                    `This record is still referenced by ${blocking.join(", ")}. Delete anyway? This will permanently remove those records too.`,
                    409
                );
                error.blockedByDependents = true;
                throw error;
            }
        }

        await cascadeDelete(table, id, client);

        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
};

module.exports = { hardDelete };
