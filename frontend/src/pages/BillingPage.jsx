/**
 * ============================================================
 * File: BillingPage.jsx
 * Module: Billing
 *
 * Description:
 * Manage the discounts and taxes applied at checkout. Taxes are
 * percentage rates — every active one applies to each sale.
 * Discounts are flat amounts picked per sale on the Sales page.
 * Records referenced by past sales can't be deleted, only
 * deactivated, so history stays intact.
 * ============================================================
 */

import { useEffect, useState } from "react";
import apiClient from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useFormat } from "../utils/format";
import BulkImportControls from "../components/BulkImportControls";
import DeleteButton from "../components/DeleteButton";
import StatusChip from "../components/StatusChip";
import ConfirmAction from "../components/ConfirmAction";
import { TableSkeleton } from "../components/Skeleton";

// Billing's card/panel accent. See index.css's .ledger-card/.panel
// --card-accent/--card-glow.
const ACCENT_STYLE = { "--card-accent": "var(--color-amber-dark)", "--card-glow": "rgba(201, 147, 44, 0.4)" };

export default function BillingPage() {
  const { user } = useAuth();
  const toast = useToast();
  const { money, currency } = useFormat();
  const [taxes, setTaxes] = useState([]);
  const [discounts, setDiscounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [taxForm, setTaxForm] = useState({ name: "", rate: "" });
  const [discountForm, setDiscountForm] = useState({ code: "", amount: "" });
  const [submitting, setSubmitting] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    setError("");
    try {
      const [taxesRes, discountsRes] = await Promise.all([
        apiClient.get("/taxes"),
        apiClient.get("/discounts"),
      ]);
      setTaxes(taxesRes.data.data);
      setDiscounts(discountsRes.data.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const addTax = async (event) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await apiClient.post("/taxes", { name: taxForm.name, rate: Number(taxForm.rate) });
      toast.success(`Tax "${taxForm.name}" added — it now applies to every sale.`);
      setTaxForm({ name: "", rate: "" });
      await loadAll();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const addDiscount = async (event) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await apiClient.post("/discounts", {
        code: discountForm.code,
        amount: Number(discountForm.amount),
      });
      toast.success(`Discount "${discountForm.code}" added.`);
      setDiscountForm({ code: "", amount: "" });
      await loadAll();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleStatus = async (kind, record) => {
    try {
      await apiClient.patch(`/${kind}/${record.id}`, {
        status: record.status === "active" ? "inactive" : "active",
      });
      toast.success(`${record.name || record.code} ${record.status === "active" ? "deactivated" : "activated"}.`);
      await loadAll();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const statusBadge = (status) => (
    <StatusChip tone={status === "active" ? "success" : "neutral"}>{status}</StatusChip>
  );

  return (
    <div>
      <div className="mb-6">
        <span className="field-label text-amber-dark">Billing</span>
        <h2 className="font-display text-xl font-semibold text-ink">Discounts &amp; taxes</h2>
      </div>

      {error && (
        <p className="mb-4 rounded border border-clay/30 bg-clay-soft px-3 py-2 text-sm text-clay">
          {error}
        </p>
      )}

      {loading ? (
        <TableSkeleton rows={6} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="min-w-0 space-y-4">
            <BulkImportControls resource="taxes" label="taxes" onImported={loadAll} />

            <form onSubmit={addTax} className="ledger-card space-y-3 py-6 pr-6" style={ACCENT_STYLE}>
              <p className="field-label">Add a tax</p>
              <p className="text-xs text-ink-soft">
                Every active tax is applied to each sale's discounted subtotal.
              </p>

              <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                <div>
                  <label htmlFor="taxName" className="field-label mb-1 block">
                    Name
                  </label>
                  <input
                    id="taxName"
                    required
                    value={taxForm.name}
                    onChange={(event) => setTaxForm((prev) => ({ ...prev, name: event.target.value }))}
                    placeholder="e.g. VAT"
                    className="w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal"
                  />
                </div>
                <div>
                  <label htmlFor="taxRate" className="field-label mb-1 block">
                    Rate %
                  </label>
                  <input
                    id="taxRate"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    required
                    value={taxForm.rate}
                    onChange={(event) => setTaxForm((prev) => ({ ...prev, rate: event.target.value }))}
                    className="w-24 rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal"
                  />
                </div>
              </div>

              <button type="submit" disabled={submitting} className="btn-solid btn-solid-primary">
                Add tax
              </button>
            </form>

            {taxes.length === 0 ? (
              <p className="text-sm text-ink-soft">No taxes yet — sales are untaxed.</p>
            ) : (
              <div className="panel" style={ACCENT_STYLE}>
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-paper-line bg-paper">
                    <tr>
                      <th className="px-4 py-2 font-medium text-ink-soft">Name</th>
                      <th className="px-4 py-2 font-medium text-ink-soft">Rate</th>
                      <th className="px-4 py-2 font-medium text-ink-soft">Status</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {taxes.map((tax) => (
                      <tr key={tax.id} className="border-b border-paper-line last:border-0">
                        <td className="px-4 py-2 text-ink">{tax.name}</td>
                        <td className="px-4 py-2 font-mono text-xs text-ink">{tax.rate}%</td>
                        <td className="px-4 py-2">{statusBadge(tax.status)}</td>
                        <td className="px-4 py-2 text-right">
                          <div className="flex justify-end gap-2">
                            {tax.status === "active" ? (
                              <ConfirmAction label="Deactivate" onConfirm={() => toggleStatus("taxes", tax)} />
                            ) : (
                              <button type="button" onClick={() => toggleStatus("taxes", tax)} className="btn-link btn-link-success">
                                Activate
                              </button>
                            )}
                            {user?.role === "developer" && (
                              <DeleteButton resource="taxes" id={tax.id} label={tax.name} onDeleted={loadAll} />
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="min-w-0 space-y-4">
            <BulkImportControls resource="discounts" label="discounts" onImported={loadAll} />

            <form onSubmit={addDiscount} className="ledger-card space-y-3 py-6 pr-6" style={ACCENT_STYLE}>
              <p className="field-label">Add a discount</p>
              <p className="text-xs text-ink-soft">
                A flat amount off the subtotal, applied per sale from the Sales page.
              </p>

              <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                <div>
                  <label htmlFor="discountCode" className="field-label mb-1 block">
                    Code
                  </label>
                  <input
                    id="discountCode"
                    required
                    value={discountForm.code}
                    onChange={(event) => setDiscountForm((prev) => ({ ...prev, code: event.target.value }))}
                    placeholder="e.g. LOYAL10"
                    className="w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal"
                  />
                </div>
                <div>
                  <label htmlFor="discountAmount" className="field-label mb-1 block">
                    Amount ({currency})
                  </label>
                  <input
                    id="discountAmount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    value={discountForm.amount}
                    onChange={(event) => setDiscountForm((prev) => ({ ...prev, amount: event.target.value }))}
                    className="w-24 rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal"
                  />
                </div>
              </div>

              <button type="submit" disabled={submitting} className="btn-solid btn-solid-primary">
                Add discount
              </button>
            </form>

            {discounts.length === 0 ? (
              <p className="text-sm text-ink-soft">No discounts yet.</p>
            ) : (
              <div className="panel" style={ACCENT_STYLE}>
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-paper-line bg-paper">
                    <tr>
                      <th className="px-4 py-2 font-medium text-ink-soft">Code</th>
                      <th className="px-4 py-2 font-medium text-ink-soft">Amount</th>
                      <th className="px-4 py-2 font-medium text-ink-soft">Status</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {discounts.map((discount) => (
                      <tr key={discount.id} className="border-b border-paper-line last:border-0">
                        <td className="px-4 py-2 font-mono text-xs text-ink">{discount.code}</td>
                        <td className="px-4 py-2 font-mono text-xs text-ink">{money(discount.amount)}</td>
                        <td className="px-4 py-2">{statusBadge(discount.status)}</td>
                        <td className="px-4 py-2 text-right">
                          <div className="flex justify-end gap-2">
                            {discount.status === "active" ? (
                              <ConfirmAction label="Deactivate" onConfirm={() => toggleStatus("discounts", discount)} />
                            ) : (
                              <button type="button" onClick={() => toggleStatus("discounts", discount)} className="btn-link btn-link-success">
                                Activate
                              </button>
                            )}
                            {user?.role === "developer" && (
                              <DeleteButton
                                resource="discounts"
                                id={discount.id}
                                label={discount.code}
                                onDeleted={loadAll}
                              />
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
