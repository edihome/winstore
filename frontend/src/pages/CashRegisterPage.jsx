import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useFormat } from "../utils/format";
import { sumMoneyAmounts } from "../utils/finance";
import EmptyState from "../components/EmptyState";
import StatusChip from "../components/StatusChip";
import { TableSkeleton } from "../components/Skeleton";
import { SortableTh, TablePager, useTableKit } from "../components/tableKit";
import FinanceSummary from "./finance/FinanceSummary";
import { CreateRegisterDrawer, CashMovementDrawer } from "./finance/CashRegisterDrawers";
import { useFinanceRows } from "./finance/useFinanceRows";

const ACCENT_STYLE = { "--card-accent": "var(--color-teal)", "--card-glow": "rgba(15, 111, 99, 0.35)" };
const INPUT_CLASS = "w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal";
const normalizeRegister = (row) => ({ ...row, currentBalance: Number(row.currentBalance), openingBalance: Number(row.openingBalance) });
const normalizeTransaction = (row) => ({ ...row, amount: Number(row.amount), balanceAfter: Number(row.balanceAfter) });

export default function CashRegisterPage() {
  const { user, activeBranch, hasPermission } = useAuth();
  const canCreate = hasPermission("cash_register", "create");
  const canViewAll = user?.role === "super_admin" || user?.role === "developer";
  const { money, dateTime } = useFormat();
  const [branchId, setBranchId] = useState(activeBranch?.id || "");
  const [selectedId, setSelectedId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [movementRegister, setMovementRegister] = useState(null);
  const [historySearch, setHistorySearch] = useState("");
  const [historyType, setHistoryType] = useState("");
  const branchList = useFinanceRows("/branches");
  const branches = useMemo(() => {
    const available = branchList.rows.length ? branchList.rows : user?.accessibleBranches || [];
    return available.length ? available : user?.branch ? [user.branch] : [];
  }, [branchList.rows, user]);
  const registers = useFinanceRows(canViewAll || branchId ? "/cash-register" : null, branchId ? { branchId } : {}, normalizeRegister);
  const selectedRegister = registers.rows.find((row) => row.id === selectedId) || registers.rows[0] || null;
  const transactions = useFinanceRows(selectedRegister ? "/cash-register/transactions" : null, { cashRegisterId: selectedRegister?.id }, normalizeTransaction);
  const registerKit = useTableKit(registers.rows, { pageSize: 6, defaultSort: { key: "createdAt", dir: "desc" } });
  const historyRows = useMemo(() => transactions.rows.filter((row) => !historyType || row.transactionType === historyType), [transactions.rows, historyType]);
  const historyKit = useTableKit(historyRows, {
    pageSize: 12,
    searchText: historySearch,
    searchFn: (row) => `${row.reference || ""} ${row.notes || ""}`,
    defaultSort: { key: "createdAt", dir: "desc" },
  });
  const setHistoryPage = historyKit.setPage;
  const setRegisterPage = registerKit.setPage;
  const openRegisters = registers.rows.filter((row) => row.status === "open");
  const branchName = (id) => branches.find((branch) => branch.id === id)?.name || (id ? "Branch" : "Unassigned");

  useEffect(() => {
    setBranchId(activeBranch?.id || "");
  }, [activeBranch?.id]);

  useEffect(() => {
    if (!canViewAll && !branchId && branches[0]?.id) setBranchId(branches[0].id);
  }, [canViewAll, branchId, branches]);

  useEffect(() => {
    setSelectedId("");
    setMovementRegister(null);
    setCreateOpen(false);
    setRegisterPage(1);
  }, [branchId, setRegisterPage]);

  useEffect(() => {
    setHistorySearch("");
    setHistoryType("");
    setHistoryPage(1);
  }, [selectedRegister?.id, setHistoryPage]);

  const refresh = () => {
    registers.reload();
    transactions.reload();
  };
  const registerCreated = (register) => {
    setBranchId(register.branchId);
    setSelectedId(register.id);
    registers.reload();
  };

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="field-label text-teal">Billing</span>
          <h2 className="font-display text-xl font-semibold text-ink">Cash register</h2>
          <p className="mt-1 text-sm text-ink-soft">Record cash entering and leaving each till, and review its running balance.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={refresh} disabled={registers.loading || transactions.loading} className="btn-chip btn-chip-neutral">Refresh</button>
          {canCreate && <button type="button" onClick={() => setCreateOpen(true)} disabled={!branches.length} className="btn-solid btn-solid-primary btn-solid-sm">+ Open register</button>}
        </div>
      </div>
      <div className="mb-5 max-w-xs">
        <label htmlFor="cash-branch" className="field-label mb-1 block">Branch</label>
        <select id="cash-branch" value={branchId} onChange={(event) => setBranchId(event.target.value)} className={INPUT_CLASS}>
          {canViewAll && <option value="">All branches</option>}
          {!canViewAll && !branches.length && <option value="">No accessible branches</option>}
          {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
        </select>
      </div>
      {registers.error && <p role="alert" className="mb-4 rounded border border-clay/30 bg-clay-soft px-3 py-2 text-sm text-clay">{registers.error}</p>}
      {branchList.error && !branches.length && <p role="alert" className="mb-4 text-sm text-clay">{branchList.error}</p>}
      {!registers.loading && !registers.error && <FinanceSummary tiles={[
        { label: "Open registers", value: openRegisters.length },
        { label: "Cash in open registers", value: money(sumMoneyAmounts(openRegisters.map((row) => row.currentBalance))) },
        { label: "Registers in this view", value: registers.rows.length },
      ]} />}
      {registers.loading ? <TableSkeleton rows={3} /> : registers.error ? null : registers.rows.length === 0 ? (
        <EmptyState icon="▣" title="No registers in this view" hint={branches.length ? "Open a register with the cash already in your till, then record money in and money out." : "Add or request access to a branch before opening a register."}
          actionLabel={canCreate && branches.length ? "Open your first register" : undefined} onAction={canCreate && branches.length ? () => setCreateOpen(true) : undefined} />
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {registerKit.visible.map((register) => (
              <button key={register.id} type="button" aria-pressed={selectedRegister?.id === register.id} onClick={() => setSelectedId(register.id)}
                className={`ledger-card py-4 pr-4 text-left ${selectedRegister?.id === register.id ? "ring-2 ring-teal" : ""}`} style={ACCENT_STYLE}>
                <div className="mb-2 flex items-start justify-between gap-2"><div>
                  <p className="font-display font-semibold text-ink">{register.name}</p>
                  <p className="mt-0.5 text-xs text-ink-soft">{branchName(register.branchId)}</p>
                </div><StatusChip tone={register.status === "open" ? "success" : "neutral"}>{register.status}</StatusChip></div>
                <p className="font-mono text-xl font-semibold text-ink">{money(register.currentBalance)}</p>
                <p className="mt-1 text-xs text-ink-soft">Opened with {money(register.openingBalance)}</p>
                <p className="mt-3 font-mono text-xs text-ink-soft">{dateTime(register.openedAt || register.createdAt)}</p>
              </button>
            ))}
          </div>
          <TablePager kit={registerKit} noun="registers" />
        </>
      )}
      {selectedRegister && !registers.loading && !registers.error && (
        <section className="mt-8" aria-label="Register transaction history">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div><p className="field-label text-teal">Transaction history</p>
              <h3 className="font-display text-lg font-semibold text-ink">{selectedRegister.name}</h3>
              <p className="mt-1 text-sm text-ink-soft">Current balance {money(selectedRegister.currentBalance)}</p></div>
            {canCreate && selectedRegister.status === "open" && <button type="button" onClick={() => setMovementRegister(selectedRegister)} className="btn-solid btn-solid-primary btn-solid-sm">Record movement</button>}
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            <input aria-label="Search cash transactions" placeholder="Search references or notes…" value={historySearch} onChange={(event) => { setHistorySearch(event.target.value); historyKit.setPage(1); }} className={`${INPUT_CLASS} max-w-sm`} />
            <select aria-label="Cash movement type" value={historyType} onChange={(event) => { setHistoryType(event.target.value); historyKit.setPage(1); }} className={`${INPUT_CLASS} max-w-44`}>
              <option value="">All movements</option><option value="inflow">Money in</option><option value="outflow">Money out</option>
            </select>
          </div>
          {transactions.error && <p role="alert" className="mb-4 rounded border border-clay/30 bg-clay-soft px-3 py-2 text-sm text-clay">{transactions.error}</p>}
          {transactions.loading ? <TableSkeleton rows={5} /> : transactions.error ? null : transactions.rows.length === 0 ? (
            <EmptyState icon="↔" title="No cash movements yet" hint={`This register opened with ${money(selectedRegister.openingBalance)}. Its cash movements will appear here.`} />
          ) : historyKit.total === 0 ? <EmptyState icon="⌕" title="No matching movements" hint="Try another reference, note, or movement type." /> : (
            <>
              <div className="panel overflow-x-auto" style={ACCENT_STYLE}>
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-paper-line bg-paper"><tr>
                    <SortableTh kit={historyKit} sortKey="createdAt">Recorded</SortableTh>
                    <SortableTh kit={historyKit} sortKey="transactionType">Movement</SortableTh>
                    <SortableTh kit={historyKit} sortKey="reference">Reference / notes</SortableTh>
                    <SortableTh kit={historyKit} sortKey="amount" align="right">Amount</SortableTh>
                    <SortableTh kit={historyKit} sortKey="balanceAfter" align="right">Balance after</SortableTh>
                  </tr></thead>
                  <tbody>{historyKit.visible.map((transaction) => <tr key={transaction.id} className="border-b border-paper-line last:border-0">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-ink-soft">{dateTime(transaction.createdAt)}</td>
                    <td className="px-4 py-3"><StatusChip tone={transaction.transactionType === "inflow" ? "success" : "warning"}>{transaction.transactionType === "inflow" ? "Money in" : "Money out"}</StatusChip></td>
                    <td className="max-w-sm px-4 py-3 text-ink">{transaction.reference || "—"}{transaction.notes && <span className="mt-0.5 block whitespace-pre-wrap text-xs text-ink-soft">{transaction.notes}</span>}</td>
                    <td className={`whitespace-nowrap px-4 py-3 text-right font-mono text-xs ${transaction.transactionType === "inflow" ? "text-signal" : "text-clay"}`}>{transaction.transactionType === "inflow" ? "+" : "−"}{money(transaction.amount)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-xs text-ink">{money(transaction.balanceAfter)}</td>
                  </tr>)}</tbody>
                </table>
              </div>
              <TablePager kit={historyKit} noun="movements" />
            </>
          )}
        </section>
      )}
      <CreateRegisterDrawer open={createOpen && canCreate} branches={branches} defaultBranchId={branchId || activeBranch?.id || branches[0]?.id || ""} onClose={() => setCreateOpen(false)} onCreated={registerCreated} />
      <CashMovementDrawer register={canCreate ? movementRegister : null} onClose={() => setMovementRegister(null)} onRecorded={refresh} />
    </div>
  );
}
