import { useEffect, useState } from "react";
import apiClient from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useFormat } from "../../utils/format";
import { buildCashRegisterPayload, buildCashTransactionPayload, cashBalanceAfter } from "../../utils/finance";
import Drawer from "../../components/Drawer";

const INPUT_CLASS = "w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal";
const EMPTY_MOVEMENT = { transactionType: "inflow", amount: "", reference: "", notes: "" };

export function CreateRegisterDrawer({ open, branches, defaultBranchId, onClose, onCreated }) {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("cash_register", "create");
  const { currency } = useFormat();
  const toast = useToast();
  const [form, setForm] = useState({ name: "", branchId: "", openingBalance: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ name: "", branchId: defaultBranchId, openingBalance: "" });
      setError("");
    }
  }, [open, defaultBranchId]);

  const submit = async (event) => {
    event.preventDefault();
    if (!canCreate || saving) return;
    setError("");
    try {
      const payload = buildCashRegisterPayload(form);
      setSaving(true);
      const response = await apiClient.post("/cash-register", payload);
      toast.success(`Register "${payload.name}" opened.`);
      onCreated(response.data.data);
      onClose();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer open={open && canCreate} onClose={() => !saving && onClose()} title="Open a cash register" subtitle="Start with the cash already in the till">
      <form onSubmit={submit} className="space-y-4">
        <div><label htmlFor="register-name" className="field-label mb-1 block">Name</label>
          <input id="register-name" required autoFocus maxLength={255} value={form.name} onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))} placeholder="e.g. Front counter" className={INPUT_CLASS} /></div>
        <div><label htmlFor="register-branch" className="field-label mb-1 block">Branch</label>
          <select id="register-branch" required value={form.branchId} onChange={(event) => setForm((value) => ({ ...value, branchId: event.target.value }))} className={INPUT_CLASS}>
            <option value="" disabled>Choose a branch</option>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select></div>
        <div><label htmlFor="register-opening" className="field-label mb-1 block">Opening balance ({currency})</label>
          <input id="register-opening" inputMode="decimal" value={form.openingBalance} onChange={(event) => setForm((value) => ({ ...value, openingBalance: event.target.value }))} placeholder="0.00" className={INPUT_CLASS} />
          <p className="mt-1 text-xs text-ink-soft">Leave blank to start with an empty till.</p></div>
        {error && <p role="alert" className="rounded border border-clay/30 bg-clay-soft px-3 py-2 text-sm text-clay">{error}</p>}
        <button type="submit" disabled={saving || !branches.length} className="btn-solid btn-solid-primary">{saving ? "Opening…" : "Open register"}</button>
      </form>
    </Drawer>
  );
}

export function CashMovementDrawer({ register, onClose, onRecorded }) {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("cash_register", "create");
  const { currency, money } = useFormat();
  const toast = useToast();
  const [form, setForm] = useState(EMPTY_MOVEMENT);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(EMPTY_MOVEMENT);
    setError("");
  }, [register?.id]);

  let preview = null;
  let previewError = "";
  if (register && form.amount.trim()) {
    try {
      preview = cashBalanceAfter(register.currentBalance, form.transactionType, form.amount);
    } catch (failure) {
      previewError = failure.message;
    }
  }

  const submit = async (event) => {
    event.preventDefault();
    if (!canCreate || saving) return;
    setError("");
    try {
      const payload = buildCashTransactionPayload(form, register);
      setSaving(true);
      await apiClient.post("/cash-register/transactions", payload);
      toast.success(`${form.transactionType === "inflow" ? "Money in" : "Money out"} recorded for ${register.name}.`);
      onRecorded();
      onClose();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer open={Boolean(register) && canCreate} onClose={() => !saving && onClose()} title="Record cash movement" subtitle={register?.name}>
      <form onSubmit={submit} className="space-y-4">
        <p className="rounded bg-paper px-3 py-2 text-sm text-ink-soft">Current balance <strong className="ml-2 font-mono text-ink">{money(register?.currentBalance)}</strong></p>
        <div><label htmlFor="cash-direction" className="field-label mb-1 block">Movement</label>
          <select id="cash-direction" value={form.transactionType} onChange={(event) => setForm((value) => ({ ...value, transactionType: event.target.value }))} className={INPUT_CLASS}>
            <option value="inflow">Money in</option><option value="outflow">Money out</option>
          </select></div>
        <div><label htmlFor="cash-amount" className="field-label mb-1 block">Amount ({currency})</label>
          <input id="cash-amount" required autoFocus inputMode="decimal" aria-invalid={Boolean(previewError) || undefined} value={form.amount} onChange={(event) => setForm((value) => ({ ...value, amount: event.target.value }))} placeholder="0.00" className={INPUT_CLASS} /></div>
        <div><label htmlFor="cash-reference" className="field-label mb-1 block">Reference <span className="normal-case text-ink-soft">(optional)</span></label>
          <input id="cash-reference" maxLength={150} value={form.reference} onChange={(event) => setForm((value) => ({ ...value, reference: event.target.value }))} placeholder="e.g. Deposit slip or voucher number" className={INPUT_CLASS} /></div>
        <div><label htmlFor="cash-notes" className="field-label mb-1 block">Notes <span className="normal-case text-ink-soft">(optional)</span></label>
          <textarea id="cash-notes" rows={3} value={form.notes} onChange={(event) => setForm((value) => ({ ...value, notes: event.target.value }))} placeholder="What was this movement for?" className={INPUT_CLASS} /></div>
        {preview !== null && <p className="rounded border border-teal/20 bg-teal-soft px-3 py-2 text-sm text-ink">Balance after this movement <strong className="ml-2 font-mono">{money(preview)}</strong></p>}
        {(error || previewError) && <p role="alert" className="rounded border border-clay/30 bg-clay-soft px-3 py-2 text-sm text-clay">{error || previewError}</p>}
        <button type="submit" disabled={saving || Boolean(previewError) || !form.amount.trim()} className={`btn-solid ${form.transactionType === "outflow" ? "btn-solid-warning" : "btn-solid-success"}`}>{saving ? "Recording…" : "Record movement"}</button>
      </form>
    </Drawer>
  );
}
