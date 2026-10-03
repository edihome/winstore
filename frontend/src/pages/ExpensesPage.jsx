/**
 * ============================================================
 * File: ExpensesPage.jsx
 * Module: Expenses
 *
 * Description:
 * Record branch expenses in the app's modern list pattern: full-width
 * sortable, paginated table; "Record expense" in a slide-over drawer;
 * toasts for outcomes; amounts in the organization's own currency.
 * An expense starts "pending"; marking it Paid counts it as real
 * spend on the Reports page, or Cancel if it never happened. Both
 * outcomes are terminal, same rule as purchase orders.
 * ============================================================
 */

import { useState } from "react";
import apiClient from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useFormat } from "../utils/format";
import BulkImportControls from "../components/BulkImportControls";
import Drawer from "../components/Drawer";
import EmptyState from "../components/EmptyState";
import StatusChip from "../components/StatusChip";
import ConfirmAction from "../components/ConfirmAction";
import { TableSkeleton } from "../components/Skeleton";
import { useServerTable, SortableTh, TablePager } from "../components/tableKit";

const initialForm = { description: "", category: "general", amount: "" };

// Expenses' card/panel accent (shared with Purchasing — both represent
// money leaving the business).
const ACCENT_STYLE = { "--card-accent": "var(--color-clay)", "--card-glow": "rgba(163, 69, 43, 0.35)" };

const STATUS_TONES = { pending: "warning", paid: "success", cancelled: "danger" };

export default function ExpensesPage() {
  const { activeBranch, hasPermission } = useAuth();
  const canCreate = hasPermission("expenses", "create");
  const canEdit = hasPermission("expenses", "edit");
  const toast = useToast();
  const { money, currency, date } = useFormat();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);

  const kit = useServerTable(
    ({ page, limit, sortKey, sortDir }) =>
      apiClient.get("/expenses", { params: { page, limit, sortKey, sortDir, branchId: activeBranch.id } }),
    { pageSize: 12, defaultSort: { key: "createdAt", dir: "desc" }, deps: [activeBranch.id] }
  );

  const handleChange = (event) => {
    setForm((prev) => ({ ...prev, [event.target.name]: event.target.value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canCreate) return;
    setSubmitting(true);
    try {
      await apiClient.post("/expenses", {
        description: form.description,
        category: form.category,
        amount: Number(form.amount),
        branchId: activeBranch.id,
      });
      toast.success(`Expense recorded: ${form.description}.`);
      setForm(initialForm);
      setDrawerOpen(false);
      kit.reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const setStatus = async (expense, status) => {
    if (!canEdit) return;
    try {
      await apiClient.patch(`/expenses/${expense.id}/status`, { status });
      toast.success(`${expense.description} marked ${status}.`);
      kit.reload();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const inputClass =
    "w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal";

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="field-label text-clay">Expenses</span>
          <h2 className="font-display text-xl font-semibold text-ink">Branch expenses</h2>
        </div>
        <div className="flex items-center gap-2">
          <BulkImportControls resource="expenses" label="expenses" onImported={kit.reload} />
          {canCreate && <button type="button" onClick={() => setDrawerOpen(true)} className="btn-solid btn-solid-primary btn-solid-sm">
            + Record expense
          </button>}
        </div>
      </div>

      {kit.error && (
        <p role="alert" className="mb-4 rounded border border-clay/30 bg-clay-soft px-3 py-2 text-sm text-clay">
          {kit.error}
        </p>
      )}

      {kit.loading && kit.visible.length === 0 ? (
        <TableSkeleton rows={8} />
      ) : kit.total === 0 ? (
        <EmptyState
          icon="🧮"
          title="No expenses recorded yet"
          hint="Expenses marked Paid count as real spend on the Reports page."
          actionLabel={canCreate ? "Record your first expense" : undefined}
          onAction={canCreate ? () => setDrawerOpen(true) : undefined}
        />
      ) : (
        <>
          <div className="panel" style={ACCENT_STYLE}>
            <table className="w-full text-left text-sm">
              <thead className="border-b border-paper-line bg-paper">
                <tr>
                  <SortableTh kit={kit} sortKey="description">Description</SortableTh>
                  <SortableTh kit={kit} sortKey="category" className="hidden sm:table-cell">Category</SortableTh>
                  <SortableTh kit={kit} sortKey="createdAt" className="hidden md:table-cell">Recorded</SortableTh>
                  <SortableTh kit={kit} sortKey="amount" align="right" className="text-right">Amount</SortableTh>
                  <SortableTh kit={kit} sortKey="status">Status</SortableTh>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {kit.visible.map((expense) => (
                  <tr key={expense.id} className="border-b border-paper-line last:border-0">
                    <td className="px-4 py-2 text-ink">{expense.description}</td>
                    <td className="hidden px-4 py-2 text-ink-soft sm:table-cell">{expense.category}</td>
                    <td className="hidden px-4 py-2 font-mono text-xs text-ink-soft md:table-cell">
                      {date(expense.createdAt)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-ink">{money(expense.amount)}</td>
                    <td className="px-4 py-2">
                      <StatusChip tone={STATUS_TONES[expense.status] || "neutral"}>{expense.status}</StatusChip>
                    </td>
                    <td className="px-4 py-2 text-right">
                      {canEdit && expense.status === "pending" && (
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setStatus(expense, "paid")}
                            className="btn-link btn-link-success"
                          >
                            Mark paid
                          </button>
                          <ConfirmAction label="Cancel" onConfirm={() => setStatus(expense, "cancelled")} />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePager kit={kit} noun="expenses" />
        </>
      )}

      <Drawer
        open={drawerOpen && canCreate}
        onClose={() => setDrawerOpen(false)}
        title="Record an expense"
        subtitle={activeBranch?.name ? `For ${activeBranch.name}` : undefined}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="description" className="field-label mb-1 block">
              Description
            </label>
            <input
              id="description"
              name="description"
              required
              autoFocus
              value={form.description}
              onChange={handleChange}
              placeholder="e.g. Electricity bill"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="category" className="field-label mb-1 block">
              Category
            </label>
            <input
              id="category"
              name="category"
              value={form.category}
              onChange={handleChange}
              placeholder="e.g. utilities"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="amount" className="field-label mb-1 block">
              Amount ({currency})
            </label>
            <input
              id="amount"
              name="amount"
              type="number"
              min="0.01"
              step="0.01"
              required
              value={form.amount}
              onChange={handleChange}
              className={inputClass}
            />
          </div>
          <button type="submit" disabled={submitting} className="btn-solid btn-solid-primary">
            {submitting ? "Recording…" : "Record expense"}
          </button>
        </form>
      </Drawer>
    </div>
  );
}
