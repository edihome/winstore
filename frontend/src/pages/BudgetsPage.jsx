import { useMemo, useState } from "react";
import apiClient from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useFormat } from "../utils/format";
import { buildBudgetPayload, sumMoneyAmounts } from "../utils/finance";
import Drawer from "../components/Drawer";
import EmptyState from "../components/EmptyState";
import StatusChip from "../components/StatusChip";
import { TableSkeleton } from "../components/Skeleton";
import { SortableTh, TablePager, useTableKit } from "../components/tableKit";
import FinanceSummary from "./finance/FinanceSummary";
import { useFinanceRows } from "./finance/useFinanceRows";

const ACCENT_STYLE = { "--card-accent": "var(--color-teal)", "--card-glow": "rgba(15, 111, 99, 0.35)" };
const INPUT_CLASS = "w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal";
const INITIAL_FORM = { name: "", amount: "", status: "active" };
const normalizeBudget = (row) => ({ ...row, amount: Number(row.amount), createdAt: row.createdAt || row.created_at });

export default function BudgetsPage() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("budgets", "create");
  const toast = useToast();
  const { money, currency, date } = useFormat();
  const budgets = useFinanceRows("/budgets", {}, normalizeBudget);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form, setForm] = useState(INITIAL_FORM);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const filtered = useMemo(() => budgets.rows.filter((row) => !status || row.status === status), [budgets.rows, status]);
  const kit = useTableKit(filtered, {
    pageSize: 12,
    searchText: search,
    searchFn: (row) => row.name,
    defaultSort: { key: "createdAt", dir: "desc" },
  });
  const activeBudgets = budgets.rows.filter((row) => row.status === "active");

  const openCreate = () => {
    if (!canCreate) return;
    setForm(INITIAL_FORM);
    setFormError("");
    setDrawerOpen(true);
  };

  const saveBudget = async (event) => {
    event.preventDefault();
    if (!canCreate || saving) return;
    setFormError("");
    try {
      const payload = buildBudgetPayload(form);
      setSaving(true);
      await apiClient.post("/budgets", payload);
      toast.success(`Budget "${payload.name}" added.`);
      setDrawerOpen(false);
      budgets.reload();
    } catch (error) {
      setFormError(error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="field-label text-teal">Billing</span>
          <h2 className="font-display text-xl font-semibold text-ink">Budgets</h2>
          <p className="mt-1 text-sm text-ink-soft">Plan amounts for your organization, such as stock purchases or operating costs.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={budgets.reload} disabled={budgets.loading} className="btn-chip btn-chip-neutral">Refresh</button>
          {canCreate && <button type="button" onClick={openCreate} className="btn-solid btn-solid-primary btn-solid-sm">+ Add budget</button>}
        </div>
      </div>
      {budgets.error && <p role="alert" className="mb-4 rounded border border-clay/30 bg-clay-soft px-3 py-2 text-sm text-clay">{budgets.error}</p>}
      {!budgets.loading && !budgets.error && <FinanceSummary tiles={[
        { label: "Active budgets", value: activeBudgets.length },
        { label: "Active planned total", value: money(sumMoneyAmounts(activeBudgets.map((row) => row.amount))) },
        { label: "All budgets", value: budgets.rows.length },
      ]} />}
      <div className="mb-4 flex flex-wrap gap-2">
        <input aria-label="Search budgets" placeholder="Search budgets…" value={search} onChange={(event) => { setSearch(event.target.value); kit.setPage(1); }} className={`${INPUT_CLASS} max-w-sm`} />
        <select aria-label="Budget status" value={status} onChange={(event) => { setStatus(event.target.value); kit.setPage(1); }} className={`${INPUT_CLASS} max-w-40`}>
          <option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option>
        </select>
      </div>
      {budgets.loading ? <TableSkeleton rows={6} /> : budgets.error ? null : budgets.rows.length === 0 ? (
        <EmptyState icon="◎" title="No budgets yet" hint="Give a plan a name and an amount so your team can see what has been set aside."
          actionLabel={canCreate ? "Add your first budget" : undefined} onAction={canCreate ? openCreate : undefined} />
      ) : kit.total === 0 ? <EmptyState icon="⌕" title="No matching budgets" hint="Try another name or status." /> : (
        <>
          <div className="panel overflow-x-auto" style={ACCENT_STYLE}>
            <table className="w-full text-left text-sm">
              <thead className="border-b border-paper-line bg-paper"><tr>
                <SortableTh kit={kit} sortKey="name">Budget</SortableTh>
                <SortableTh kit={kit} sortKey="amount" align="right">Planned amount</SortableTh>
                <SortableTh kit={kit} sortKey="status">Status</SortableTh>
                <SortableTh kit={kit} sortKey="createdAt">Created</SortableTh>
              </tr></thead>
              <tbody>{kit.visible.map((budget) => <tr key={budget.id} className="border-b border-paper-line last:border-0">
                <td className="px-4 py-3 text-ink">{budget.name}</td>
                <td className="px-4 py-3 text-right font-mono text-xs text-ink">{money(budget.amount)}</td>
                <td className="px-4 py-3"><StatusChip tone={budget.status === "active" ? "success" : "neutral"}>{budget.status}</StatusChip></td>
                <td className="px-4 py-3 font-mono text-xs text-ink-soft">{date(budget.createdAt)}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <TablePager kit={kit} noun="budgets" />
        </>
      )}
      <Drawer open={drawerOpen && canCreate} onClose={() => !saving && setDrawerOpen(false)} title="Add a budget" subtitle="A plan for the whole organization">
        <form onSubmit={saveBudget} className="space-y-4">
          <div><label htmlFor="budget-name" className="field-label mb-1 block">Name</label>
            <input id="budget-name" required autoFocus maxLength={255} value={form.name} onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))} placeholder="e.g. October stock purchases" className={INPUT_CLASS} /></div>
          <div><label htmlFor="budget-amount" className="field-label mb-1 block">Planned amount ({currency})</label>
            <input id="budget-amount" required inputMode="decimal" value={form.amount} onChange={(event) => setForm((value) => ({ ...value, amount: event.target.value }))} placeholder="0.00" className={INPUT_CLASS} /></div>
          <div><label htmlFor="budget-status" className="field-label mb-1 block">Status</label>
            <select id="budget-status" value={form.status} onChange={(event) => setForm((value) => ({ ...value, status: event.target.value }))} className={INPUT_CLASS}><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
          {formError && <p role="alert" className="rounded border border-clay/30 bg-clay-soft px-3 py-2 text-sm text-clay">{formError}</p>}
          <button type="submit" disabled={saving} className="btn-solid btn-solid-primary">{saving ? "Saving…" : "Add budget"}</button>
        </form>
      </Drawer>
    </div>
  );
}
