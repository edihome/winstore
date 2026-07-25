/**
 * ============================================================
 * File: OrganizationsPage.jsx
 * Module: Platform (Developer only)
 *
 * Description:
 * Cross-organization CRUD for whoever operates this deployment —
 * list every organization registered on the software, create new
 * ones, rename/re-slug them, deactivate/reactivate, manage their
 * subscription (expiration date, login-alert lead time, and grace/
 * extension days after expiring), or permanently delete one (cascades
 * to every branch, user, and business record it ever created — see
 * components/DeleteButton.jsx).
 *
 * A row is tinted red when that tenant has under 30 days of
 * subscription left — a flat, always-the-same-30 visual rule,
 * independent of whatever alert lead time is configured for that
 * tenant (see backend organizations.service.computeSubscriptionStanding's
 * isExpiringSoon).
 *
 * Only reachable by the reserved "developer" role — see
 * backend/scripts/create-developer.js for how that role is granted,
 * and routes/index.js for how /organizations is gated to it.
 * ============================================================
 */

import { Fragment, useEffect, useState } from "react";
import apiClient from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import DeleteButton from "../components/DeleteButton";
import StatusChip from "../components/StatusChip";
import ConfirmAction from "../components/ConfirmAction";
import { TableSkeleton } from "../components/Skeleton";

const initialForm = { name: "", slug: "" };
const initialEditForm = {
  name: "",
  slug: "",
  subscriptionExpiresAt: "",
  alertThresholdDays: "30",
  extensionDays: "0",
};
const initialPaymentForm = { amount: "", currency: "USD", daysGranted: "30", reference: "", notes: "" };

// Platform/Administration's card accent (cobalt — same "structure and
// authority" color as Administration, since this is the developer's own
// cross-organization admin screen). See index.css's .ledger-card/.panel
// --card-accent/--card-glow.
const ACCENT_STYLE = { "--card-accent": "var(--color-cobalt)", "--card-glow": "rgba(53, 80, 143, 0.35)" };

const slugify = (value) =>
  String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// <input type="date"> wants YYYY-MM-DD; the API returns a full ISO timestamp (or null).
const toDateInputValue = (isoString) => (isoString ? isoString.slice(0, 10) : "");

const SUBSCRIPTION_STATUS_STYLES = {
  active: "text-ink-soft",
  expiring_soon: "text-amber-dark",
  in_grace: "text-clay",
  expired: "text-clay",
};

const describeSubscription = (subscription) => {
  if (!subscription) {
    return "Not set";
  }
  if (subscription.status === "expiring_soon" || subscription.status === "active") {
    return `Expires in ${subscription.daysRemaining} day${subscription.daysRemaining === 1 ? "" : "s"}`;
  }
  if (subscription.status === "in_grace") {
    return `Expired — ${subscription.graceDaysRemaining} grace day${subscription.graceDaysRemaining === 1 ? "" : "s"} left`;
  }
  return "Expired — grace period over";
};

export default function OrganizationsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [organizations, setOrganizations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(initialForm);
  const [slugTouched, setSlugTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(initialEditForm);
  const [savingSubscription, setSavingSubscription] = useState(false);
  // Billing panel state: which org's payment history is open, its rows,
  // and the record-payment form. Only one panel open at a time — same
  // single-expansion pattern the Update flow uses.
  const [billingId, setBillingId] = useState(null);
  const [payments, setPayments] = useState([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [paymentForm, setPaymentForm] = useState(initialPaymentForm);
  const [recordingPayment, setRecordingPayment] = useState(false);

  const loadOrganizations = async (searchTerm = "") => {
    setLoading(true);
    setError("");
    try {
      const response = await apiClient.get("/organizations", { params: { search: searchTerm || undefined } });
      setOrganizations(response.data.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrganizations();
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => loadOrganizations(search), 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const handleNameChange = (event) => {
    const name = event.target.value;
    setForm((prev) => ({ ...prev, name, slug: slugTouched ? prev.slug : slugify(name) }));
  };

  const handleSlugChange = (event) => {
    setSlugTouched(true);
    setForm((prev) => ({ ...prev, slug: event.target.value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await apiClient.post("/organizations", { name: form.name, slug: form.slug || undefined });
      setForm(initialForm);
      setSlugTouched(false);
      await loadOrganizations(search);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const startEditing = (organization) => {
    setBillingId(null);
    setEditingId(organization.id);
    setEditForm({
      name: organization.name,
      slug: organization.slug,
      subscriptionExpiresAt: toDateInputValue(organization.subscription?.expiresAt),
      alertThresholdDays: String(organization.subscription?.alertThresholdDays ?? 30),
      extensionDays: String(organization.subscription?.extensionDays ?? 0),
    });
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditForm(initialEditForm);
  };

  const saveEditing = async (organizationId) => {
    setError("");
    setSavingSubscription(true);
    try {
      await apiClient.patch(`/organizations/${organizationId}`, {
        name: editForm.name,
        slug: editForm.slug,
        // An empty date input means "clear it" — sent as null, not
        // omitted, since the backend distinguishes "field not sent" from
        // "explicitly cleared" for this one field (see
        // organizations.repository.updateOrganization).
        subscriptionExpiresAt: editForm.subscriptionExpiresAt || null,
        alertThresholdDays: Number(editForm.alertThresholdDays),
        extensionDays: Number(editForm.extensionDays),
      });
      setEditingId(null);
      toast.success("Organization updated.");
      await loadOrganizations(search);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingSubscription(false);
    }
  };

  const openBilling = async (organization) => {
    setError("");
    setEditingId(null);
    setBillingId(organization.id);
    setPaymentForm(initialPaymentForm);
    setPaymentsLoading(true);
    try {
      const response = await apiClient.get(`/organizations/${organization.id}/payments`);
      setPayments(response.data.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setPaymentsLoading(false);
    }
  };

  const closeBilling = () => {
    setBillingId(null);
    setPayments([]);
    setPaymentForm(initialPaymentForm);
  };

  const recordPayment = async (organizationId) => {
    setError("");
    setRecordingPayment(true);
    try {
      await apiClient.post(`/organizations/${organizationId}/payments`, {
        amount: Number(paymentForm.amount),
        currency: paymentForm.currency.trim() || undefined,
        daysGranted: Number(paymentForm.daysGranted),
        reference: paymentForm.reference.trim() || undefined,
        notes: paymentForm.notes.trim() || undefined,
      });
      setPaymentForm(initialPaymentForm);
      toast.success("Payment recorded — subscription extended.");
      const response = await apiClient.get(`/organizations/${organizationId}/payments`);
      setPayments(response.data.data);
      // The org row's "Subscription" column just changed too.
      await loadOrganizations(search);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRecordingPayment(false);
    }
  };

  const toggleStatus = async (organization) => {
    setError("");
    try {
      await apiClient.patch(`/organizations/${organization.id}`, {
        status: organization.status === "active" ? "inactive" : "active",
      });
      toast.success(
        organization.status === "active"
          ? `${organization.name} deactivated — their staff are locked out as of their next request.`
          : `${organization.name} reactivated.`
      );
      await loadOrganizations(search);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const inputClass =
    "w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal";
  const editInputClass =
    "w-full rounded border border-paper-line bg-white px-2 py-1.5 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal";

  return (
    <div>
      <div className="mb-6">
        <span className="field-label text-cobalt">Platform</span>
        <h2 className="font-display text-xl font-semibold text-ink">Organizations</h2>
      </div>

      {error && (
        <p className="mb-4 rounded border border-clay/30 bg-clay-soft px-3 py-2 text-sm text-clay">
          {error}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <form onSubmit={handleSubmit} className="ledger-card space-y-3 py-6 pr-6 lg:col-span-1 min-w-0" style={ACCENT_STYLE}>
          <p className="field-label">Add an organization</p>

          <div>
            <label htmlFor="name" className="field-label mb-1 block">
              Name
            </label>
            <input id="name" required value={form.name} onChange={handleNameChange} className={inputClass} />
          </div>

          <div>
            <label htmlFor="slug" className="field-label mb-1 block">
              Slug <span className="normal-case text-ink-soft">(auto-filled from name)</span>
            </label>
            <input id="slug" value={form.slug} onChange={handleSlugChange} className={inputClass} />
          </div>

          <button type="submit" disabled={submitting} className="btn-solid btn-solid-primary">
            {submitting ? "Adding…" : "Add organization"}
          </button>

          <p className="text-xs text-ink-soft">
            New organizations start with no subscription expiration set. Use "Update" on a
            row below once you've reviewed the tenant and decided on their plan.
          </p>
        </form>

        <div className="lg:col-span-2 min-w-0">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name…"
            className={`mb-3 ${inputClass}`}
          />

          {loading ? (
            <TableSkeleton rows={6} />
          ) : organizations.length === 0 ? (
            <p className="text-sm text-ink-soft">
              {search ? "No organizations match your search." : "No organizations yet."}
            </p>
          ) : (
            <div className="panel" style={ACCENT_STYLE}>
              <table className="w-full text-left text-sm">
                <thead className="border-b border-paper-line bg-paper">
                  <tr>
                    <th className="px-4 py-2 font-medium text-ink-soft">Name</th>
                    <th className="hidden px-4 py-2 font-medium text-ink-soft sm:table-cell">Slug</th>
                    <th className="px-4 py-2 font-medium text-ink-soft">Status</th>
                    <th className="px-4 py-2 font-medium text-ink-soft">Subscription</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {organizations.map((organization) => (
                    <Fragment key={organization.id}>
                    {editingId === organization.id ? (
                      <tr className="border-b border-paper-line last:border-0 bg-cobalt-soft/30">
                        <td colSpan={5} className="px-4 py-4">
                          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            <div>
                              <label className="field-label mb-1 block">Name</label>
                              <input
                                value={editForm.name}
                                onChange={(event) => setEditForm((prev) => ({ ...prev, name: event.target.value }))}
                                className={editInputClass}
                              />
                            </div>
                            <div>
                              <label className="field-label mb-1 block">Slug</label>
                              <input
                                value={editForm.slug}
                                onChange={(event) => setEditForm((prev) => ({ ...prev, slug: event.target.value }))}
                                className={editInputClass}
                              />
                            </div>
                            <div>
                              <label className="field-label mb-1 block">
                                Subscription expires <span className="normal-case text-ink-soft">(optional)</span>
                              </label>
                              <input
                                type="date"
                                value={editForm.subscriptionExpiresAt}
                                onChange={(event) =>
                                  setEditForm((prev) => ({ ...prev, subscriptionExpiresAt: event.target.value }))
                                }
                                className={editInputClass}
                              />
                            </div>
                            <div>
                              <label className="field-label mb-1 block">Alert lead time (days)</label>
                              <input
                                type="number"
                                min="0"
                                value={editForm.alertThresholdDays}
                                onChange={(event) =>
                                  setEditForm((prev) => ({ ...prev, alertThresholdDays: event.target.value }))
                                }
                                className={editInputClass}
                              />
                              <p className="mt-1 text-xs text-ink-soft">
                                Their super_admin starts seeing a login alert this many days before expiring.
                              </p>
                            </div>
                            <div>
                              <label className="field-label mb-1 block">Extension / grace days</label>
                              <input
                                type="number"
                                min="0"
                                value={editForm.extensionDays}
                                onChange={(event) =>
                                  setEditForm((prev) => ({ ...prev, extensionDays: event.target.value }))
                                }
                                className={editInputClass}
                              />
                              <p className="mt-1 text-xs text-ink-soft">
                                Days of continued access granted automatically after the expiration date.
                              </p>
                            </div>
                          </div>
                          <div className="mt-4 flex gap-2">
                            <button
                              type="button"
                              onClick={() => saveEditing(organization.id)}
                              disabled={savingSubscription}
                              className="btn-solid btn-solid-sm btn-solid-primary"
                            >
                              {savingSubscription ? "Saving…" : "Save"}
                            </button>
                            <button type="button" onClick={cancelEditing} className="btn-link btn-link-neutral">
                              Cancel
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr
                        className={`border-b border-paper-line last:border-0 ${
                          organization.subscription?.isExpiringSoon ? "bg-clay-soft" : ""
                        }`}
                      >
                        <td className="px-4 py-2 text-ink">
                          {organization.name}
                          <span className="block font-mono text-xs text-ink-soft sm:hidden">{organization.slug}</span>
                        </td>
                        <td className="hidden px-4 py-2 font-mono text-xs text-ink-soft sm:table-cell">
                          {organization.slug}
                        </td>
                        <td className="px-4 py-2">
                          <StatusChip tone={organization.status === "active" ? "success" : "danger"}>
                            {organization.status}
                          </StatusChip>
                        </td>
                        <td className={`px-4 py-2 text-xs ${SUBSCRIPTION_STATUS_STYLES[organization.subscription?.status] || "text-ink-soft"}`}>
                          {describeSubscription(organization.subscription)}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <div className="flex flex-wrap justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => startEditing(organization)}
                              className="btn-link btn-link-primary"
                            >
                              Update
                            </button>
                            <button
                              type="button"
                              onClick={() => (billingId === organization.id ? closeBilling() : openBilling(organization))}
                              className="btn-link btn-link-primary"
                            >
                              {billingId === organization.id ? "Close billing" : "Billing"}
                            </button>
                            {organization.status === "active" ? (
                              <ConfirmAction
                                label="Deactivate"
                                prompt="Lock out this tenant?"
                                onConfirm={() => toggleStatus(organization)}
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() => toggleStatus(organization)}
                                className="btn-link btn-link-success"
                              >
                                Activate
                              </button>
                            )}
                            {organization.id !== user?.organizationId && (
                              <DeleteButton
                                resource="organizations"
                                id={organization.id}
                                label={organization.name}
                                onDeleted={() => loadOrganizations(search)}
                              />
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                    {billingId === organization.id && (
                      <tr className="border-b border-paper-line last:border-0 bg-cobalt-soft/30">
                        <td colSpan={5} className="px-4 py-4">
                          <div className="grid gap-4 lg:grid-cols-2">
                            <div className="min-w-0">
                              <p className="field-label mb-2">Renewal history</p>
                              {paymentsLoading ? (
                                <p className="text-sm text-ink-soft">Loading payments…</p>
                              ) : payments.length === 0 ? (
                                <p className="text-sm text-ink-soft">No payments recorded yet.</p>
                              ) : (
                                <table className="w-full text-left text-xs">
                                  <thead className="border-b border-paper-line">
                                    <tr>
                                      <th className="py-1 pr-3 font-medium text-ink-soft">Recorded</th>
                                      <th className="py-1 pr-3 font-medium text-ink-soft">Amount</th>
                                      <th className="py-1 pr-3 text-right font-medium text-ink-soft">Days</th>
                                      <th className="py-1 pr-3 font-medium text-ink-soft">New expiry</th>
                                      <th className="py-1 font-medium text-ink-soft">By</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {payments.map((payment) => (
                                      <tr key={payment.id} className="border-b border-paper-line last:border-0">
                                        <td className="py-1.5 pr-3 font-mono text-ink-soft">
                                          {new Date(payment.createdAt).toLocaleDateString()}
                                        </td>
                                        <td className="py-1.5 pr-3 text-ink">
                                          {payment.currency} {Number(payment.amount).toFixed(2)}
                                        </td>
                                        <td className="py-1.5 pr-3 text-right font-mono text-ink-soft">{payment.daysGranted}</td>
                                        <td className="py-1.5 pr-3 font-mono text-ink-soft">
                                          {new Date(payment.newExpiresAt).toLocaleDateString()}
                                        </td>
                                        <td className="py-1.5 text-ink-soft">{payment.recordedByName || "—"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                            <div>
                              <p className="field-label mb-2">Record a payment</p>
                              <div className="grid gap-3 sm:grid-cols-2">
                                <div>
                                  <label className="field-label mb-1 block">Amount</label>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={paymentForm.amount}
                                    onChange={(event) => setPaymentForm((prev) => ({ ...prev, amount: event.target.value }))}
                                    className={editInputClass}
                                  />
                                </div>
                                <div>
                                  <label className="field-label mb-1 block">Currency</label>
                                  <input
                                    value={paymentForm.currency}
                                    onChange={(event) => setPaymentForm((prev) => ({ ...prev, currency: event.target.value }))}
                                    className={editInputClass}
                                  />
                                </div>
                                <div>
                                  <label className="field-label mb-1 block">Days granted</label>
                                  <input
                                    type="number"
                                    min="1"
                                    value={paymentForm.daysGranted}
                                    onChange={(event) => setPaymentForm((prev) => ({ ...prev, daysGranted: event.target.value }))}
                                    className={editInputClass}
                                  />
                                  <p className="mt-1 text-xs text-ink-soft">
                                    Extends from the current expiry (or today if already lapsed).
                                  </p>
                                </div>
                                <div>
                                  <label className="field-label mb-1 block">
                                    Reference <span className="normal-case text-ink-soft">(optional)</span>
                                  </label>
                                  <input
                                    value={paymentForm.reference}
                                    onChange={(event) => setPaymentForm((prev) => ({ ...prev, reference: event.target.value }))}
                                    placeholder="e.g. bank transfer ref"
                                    className={editInputClass}
                                  />
                                </div>
                                <div className="sm:col-span-2">
                                  <label className="field-label mb-1 block">
                                    Notes <span className="normal-case text-ink-soft">(optional)</span>
                                  </label>
                                  <input
                                    value={paymentForm.notes}
                                    onChange={(event) => setPaymentForm((prev) => ({ ...prev, notes: event.target.value }))}
                                    className={editInputClass}
                                  />
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => recordPayment(organization.id)}
                                disabled={recordingPayment || paymentForm.amount === "" || !Number(paymentForm.daysGranted)}
                                className="btn-solid btn-solid-sm btn-solid-primary mt-3"
                              >
                                {recordingPayment ? "Recording…" : "Record payment"}
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
