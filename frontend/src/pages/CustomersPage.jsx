/**
 * ============================================================
 * File: CustomersPage.jsx
 * Module: Customers
 *
 * Description:
 * Customer directory in the app's modern list pattern: a full-width
 * sortable, paginated table with search; create/edit in a slide-over
 * drawer (see components/Drawer.jsx) instead of a permanent left-hand
 * form; toasts for outcomes; a two-step confirm before deactivating.
 * ============================================================
 */

import { useEffect, useState } from "react";
import apiClient from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useFormat } from "../utils/format";
import { isAdministrativeUser } from "../utils/permissions";
import BulkImportControls from "../components/BulkImportControls";
import DeleteButton from "../components/DeleteButton";
import Drawer from "../components/Drawer";
import EmptyState from "../components/EmptyState";
import StatusChip from "../components/StatusChip";
import ConfirmAction from "../components/ConfirmAction";
import { TableSkeleton } from "../components/Skeleton";
import { useServerTable, SortableTh, TablePager } from "../components/tableKit";

const initialForm = { name: "", email: "", phone: "", creditLimit: "" };

// This module's card/panel accent — see index.css's --card-accent/--card-glow.
const ACCENT_STYLE = { "--card-accent": "var(--color-sky)", "--card-glow": "rgba(31, 111, 168, 0.35)" };

const ENTRY_LABEL = { charge: "Credit sale", payment: "Payment", adjustment: "Adjustment" };

export default function CustomersPage() {
  const { user } = useAuth();
  const toast = useToast();
  const { money, dateTime } = useFormat();
  // Setting a credit limit is an admin control (mirrors the backend gate).
  const isAdmin = isAdministrativeUser(user);
  const [search, setSearch] = useState("");
  // Debounced copy fed to the server-side table, so we don't fetch on every keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  // Record version loaded into the edit form; sent back on save so a
  // concurrent edit is caught (409) rather than silently overwritten.
  const [editingVersion, setEditingVersion] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);

  // Credit ledger drawer: the customer whose account is open, their statement
  // (balance + entries), and the "record a payment" form.
  const [ledgerCustomer, setLedgerCustomer] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [ledgerBusy, setLedgerBusy] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("cash");

  const kit = useServerTable(
    ({ page, limit, sortKey, sortDir, search: q }) =>
      apiClient.get("/customers", {
        params: { page, limit, sortKey, sortDir, search: q || undefined, includeInactive: true },
      }),
    { pageSize: 12, defaultSort: { key: "name", dir: "asc" }, search: debouncedSearch }
  );

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const openCreate = () => {
    setEditingId(null);
    setEditingVersion(null);
    setForm(initialForm);
    setDrawerOpen(true);
  };

  const openEdit = (customer) => {
    setEditingId(customer.id);
    setEditingVersion(customer.version || null);
    setForm({
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      creditLimit: customer.creditLimit == null ? "" : String(customer.creditLimit),
    });
    setDrawerOpen(true);
  };

  const handleChange = (event) => {
    setForm((prev) => ({ ...prev, [event.target.name]: event.target.value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      if (editingId) {
        await apiClient.patch(`/customers/${editingId}`, { ...form, expectedVersion: editingVersion || undefined });
        toast.success(`${form.name} updated.`);
      } else {
        await apiClient.post("/customers", form);
        toast.success(`${form.name} added.`);
      }
      setDrawerOpen(false);
      kit.reload();
    } catch (err) {
      toast.error(err.message);
      // A concurrent edit (409): close the stale form and refresh.
      if (err.status === 409) {
        setDrawerOpen(false);
        kit.reload();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (customer) => {
    try {
      await apiClient.patch(`/customers/${customer.id}`, {
        status: customer.status === "active" ? "inactive" : "active",
      });
      toast.success(`${customer.name} ${customer.status === "active" ? "deactivated" : "activated"}.`);
      kit.reload();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const loadLedger = async (customerId) => {
    setLedgerBusy(true);
    try {
      const res = await apiClient.get(`/customers/${customerId}/ledger`, { params: { limit: 25 } });
      setLedger(res.data.data);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLedgerBusy(false);
    }
  };

  const openLedger = (customer) => {
    setLedgerCustomer(customer);
    setLedger(null);
    setPayAmount("");
    setPayMethod("cash");
    loadLedger(customer.id);
  };

  const recordPayment = async (event) => {
    event.preventDefault();
    const amount = Number(payAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setLedgerBusy(true);
    try {
      await apiClient.post(`/customers/${ledgerCustomer.id}/ledger`, {
        entryType: "payment",
        amount,
        method: payMethod,
      });
      toast.success(`Payment of ${money(amount)} recorded for ${ledgerCustomer.name}.`);
      setPayAmount("");
      await loadLedger(ledgerCustomer.id);
      kit.reload(); // a payment changes what the customer owes
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLedgerBusy(false);
    }
  };

  const inputClass =
    "w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal";

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="field-label text-sky">Customers</span>
          <h2 className="font-display text-xl font-semibold text-ink">Customer directory</h2>
        </div>
        <div className="flex items-center gap-2">
          <BulkImportControls resource="customers" label="customers" onImported={() => kit.reload()} />
          <button type="button" onClick={openCreate} className="btn-solid btn-solid-primary btn-solid-sm">
            + Add customer
          </button>
        </div>
      </div>

      {kit.error && (
        <p role="alert" className="mb-4 rounded border border-clay/30 bg-clay-soft px-3 py-2 text-sm text-clay">
          {kit.error}
        </p>
      )}

      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search by name or email…"
        aria-label="Search customers"
        className={`mb-3 max-w-md ${inputClass}`}
      />

      {kit.loading && kit.visible.length === 0 ? (
        <TableSkeleton rows={8} />
      ) : kit.total === 0 ? (
        search ? (
          <EmptyState icon="🔍" title="No customers match your search" hint="Try a different name or email." />
        ) : (
          <EmptyState
            icon="🧾"
            title="No customers yet"
            hint="Customers you add here can be attached to sales and appointments."
            actionLabel="Add your first customer"
            onAction={openCreate}
          />
        )
      ) : (
        <>
          <div className="panel" style={ACCENT_STYLE}>
            <table className="w-full text-left text-sm">
              <thead className="border-b border-paper-line bg-paper">
                <tr>
                  <SortableTh kit={kit} sortKey="name">Name</SortableTh>
                  <SortableTh kit={kit} sortKey="email" className="hidden sm:table-cell">Email</SortableTh>
                  <th className="px-4 py-2 font-medium text-ink-soft">Phone</th>
                  <SortableTh kit={kit} sortKey="status">Status</SortableTh>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {kit.visible.map((customer) => (
                  <tr key={customer.id} className="border-b border-paper-line last:border-0">
                    <td className="px-4 py-2 text-ink">{customer.name}</td>
                    <td className="hidden px-4 py-2 text-ink-soft sm:table-cell">{customer.email}</td>
                    <td className="px-4 py-2 font-mono text-xs text-ink-soft">{customer.phone}</td>
                    <td className="px-4 py-2">
                      <StatusChip tone={customer.status === "active" ? "success" : "neutral"}>
                        {customer.status}
                      </StatusChip>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => openLedger(customer)} className="btn-link btn-link-primary">
                          Account
                        </button>
                        <button type="button" onClick={() => openEdit(customer)} className="btn-link btn-link-primary">
                          Edit
                        </button>
                        {customer.status === "active" ? (
                          <ConfirmAction label="Deactivate" onConfirm={() => toggleActive(customer)} />
                        ) : (
                          <button type="button" onClick={() => toggleActive(customer)} className="btn-link btn-link-success">
                            Activate
                          </button>
                        )}
                        {user?.role === "developer" && (
                          <DeleteButton
                            resource="customers"
                            id={customer.id}
                            label={customer.name}
                            onDeleted={() => kit.reload()}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePager kit={kit} noun="customers" />
        </>
      )}

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editingId ? "Edit customer" : "Add a customer"}
        subtitle={editingId ? undefined : "Customers can be attached to sales and appointments."}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="name" className="field-label mb-1 block">
              Name
            </label>
            <input id="name" name="name" required autoFocus value={form.name} onChange={handleChange} className={inputClass} />
          </div>
          <div>
            <label htmlFor="email" className="field-label mb-1 block">
              Email
            </label>
            <input id="email" name="email" type="email" required value={form.email} onChange={handleChange} className={inputClass} />
          </div>
          <div>
            <label htmlFor="phone" className="field-label mb-1 block">
              Phone
            </label>
            <input id="phone" name="phone" required value={form.phone} onChange={handleChange} className={inputClass} />
          </div>
          {isAdmin && (
            <div>
              <label htmlFor="creditLimit" className="field-label mb-1 block">
                Credit limit <span className="normal-case text-ink-soft">(optional — blank means no limit)</span>
              </label>
              <input
                id="creditLimit"
                name="creditLimit"
                type="number"
                min="0"
                step="0.01"
                value={form.creditLimit}
                onChange={handleChange}
                placeholder="Max they can owe on account"
                className={inputClass}
              />
            </div>
          )}
          <button type="submit" disabled={submitting} className="btn-solid btn-solid-primary">
            {submitting ? "Saving…" : editingId ? "Save changes" : "Add customer"}
          </button>
        </form>
      </Drawer>

      <Drawer
        open={Boolean(ledgerCustomer)}
        onClose={() => setLedgerCustomer(null)}
        title={ledgerCustomer ? `${ledgerCustomer.name} — account` : "Account"}
        subtitle="Credit balance, payments, and history."
      >
        {ledger && (
          <div className="space-y-5">
            <div className="rounded border border-paper-line bg-paper/60 p-3">
              <p className="field-label">Balance owed</p>
              <p className={`font-mono text-2xl font-semibold ${ledger.balance > 0.005 ? "text-clay" : "text-ink"}`}>
                {money(ledger.balance)}
              </p>
              {ledger.balance < -0.005 && <p className="text-xs text-ink-soft">In credit (business owes the customer).</p>}
              {ledgerCustomer?.creditLimit != null && (
                <p className="text-xs text-ink-soft">Credit limit: {money(ledgerCustomer.creditLimit)}</p>
              )}
            </div>

            <form onSubmit={recordPayment} className="space-y-3 rounded border border-paper-line p-3">
              <p className="field-label">Record a payment</p>
              <div className="flex gap-2">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={payAmount}
                  onChange={(event) => setPayAmount(event.target.value)}
                  placeholder="Amount"
                  className={inputClass}
                />
                <select value={payMethod} onChange={(event) => setPayMethod(event.target.value)} className={inputClass}>
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="transfer">Transfer</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <button type="submit" disabled={ledgerBusy} className="btn-solid btn-solid-primary btn-solid-sm">
                {ledgerBusy ? "Saving…" : "Record payment"}
              </button>
            </form>

            <div>
              <p className="field-label mb-2">Recent activity</p>
              {ledger.entries.length === 0 ? (
                <p className="text-sm text-ink-soft">No account activity yet.</p>
              ) : (
                <div className="divide-y divide-paper-line">
                  {ledger.entries.map((entry) => (
                    <div key={entry.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <span>
                        <span className="text-ink">{ENTRY_LABEL[entry.entryType] || entry.entryType}</span>
                        <span className="block font-mono text-xs text-ink-soft">{dateTime(entry.createdAt)}</span>
                      </span>
                      <span className="text-right">
                        <span className={`font-mono ${entry.amount > 0 ? "text-clay" : "text-teal"}`}>
                          {entry.amount > 0 ? "+" : ""}
                          {money(entry.amount)}
                        </span>
                        <span className="block font-mono text-xs text-ink-soft">bal {money(entry.balanceAfter)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
