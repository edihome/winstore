/**
 * ============================================================
 * File: SubscriptionPage.jsx
 * Module: Administration (Subscription)
 *
 * Description:
 * The tenant owner's view of their subscription: current standing
 * (expiry date, days remaining or grace days left) and the history of
 * renewals the platform operator has recorded. Read-only — payments
 * happen outside the software and are logged by the developer on the
 * Platform screen; this page is where a super_admin sees the result,
 * and the one page a subscription-locked session can still reach.
 * ============================================================
 */

import { useEffect, useState } from "react";
import apiClient from "../api/client";
import { useAuth } from "../context/AuthContext";

// Administration's card/panel accent. See index.css's .ledger-card/.panel
// --card-accent/--card-glow.
const ACCENT_STYLE = { "--card-accent": "var(--color-cobalt)", "--card-glow": "rgba(53, 80, 143, 0.35)" };

const STATUS_LABELS = {
  active: { text: "Active", className: "bg-signal-soft text-signal" },
  expiring_soon: { text: "Expiring soon", className: "bg-amber-soft text-amber-dark" },
  in_grace: { text: "In grace period", className: "bg-clay-soft text-clay" },
  expired: { text: "Expired", className: "bg-clay text-paper" },
};

const describeStanding = (standing) => {
  if (!standing) {
    return "No expiration date has been set for this organization yet.";
  }
  if (standing.status === "in_grace") {
    return `Your subscription expired — ${standing.graceDaysRemaining} grace day${standing.graceDaysRemaining === 1 ? "" : "s"} of access remain. Please renew now.`;
  }
  if (standing.status === "expired") {
    return "Your subscription and grace period have ended. Access stays limited until a renewal is recorded — please contact support.";
  }
  return `${standing.daysRemaining} day${standing.daysRemaining === 1 ? "" : "s"} remaining.`;
};

export default function SubscriptionPage() {
  const { user } = useAuth();
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const response = await apiClient.get("/subscription");
        setOverview(response.data.data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const money = (payment) => `${payment.currency} ${Number(payment.amount).toFixed(2)}`;
  const standing = overview?.standing;
  const statusLabel = standing ? STATUS_LABELS[standing.status] : null;

  return (
    <div>
      <div className="mb-6">
        <span className="field-label text-cobalt">Administration</span>
        <h2 className="font-display text-xl font-semibold text-ink">Subscription</h2>
      </div>

      {error && (
        <p className="mb-4 rounded border border-clay/30 bg-clay-soft px-3 py-2 text-sm text-clay">{error}</p>
      )}

      {user?.subscriptionLocked && (
        <p className="mb-4 rounded border border-clay bg-clay px-4 py-3 text-sm text-paper">
          {overview?.organization.status === "inactive"
            ? "Your organization's account has been deactivated, so access is limited to this page. Please contact support to reactivate it."
            : "Your subscription has expired, so access is limited to this page until a renewal is recorded. Please contact support to renew."}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-ink-soft">Loading subscription…</p>
      ) : overview ? (
        <>
          <div className="mb-8 grid gap-4 sm:grid-cols-3">
            <div
              className="stat-tile py-5 pl-5 pr-5"
              style={{ "--tile-accent": "var(--color-cobalt)", "--tile-soft": "var(--color-cobalt-soft)", "--tile-glow": "rgba(53, 80, 143, 0.4)" }}
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="stat-tile-chip">S</span>
                <p className="field-label">Status</p>
              </div>
              {statusLabel ? (
                <span className={`inline-block rounded px-2 py-0.5 text-sm font-semibold ${statusLabel.className}`}>
                  {statusLabel.text}
                </span>
              ) : (
                <p className="font-display text-lg font-semibold text-ink">Not set</p>
              )}
              <p className="mt-2 text-xs text-ink-soft">{describeStanding(standing)}</p>
            </div>

            <div
              className="stat-tile py-5 pl-5 pr-5"
              style={{ "--tile-accent": "var(--color-teal)", "--tile-soft": "var(--color-teal-soft)", "--tile-glow": "rgba(15, 111, 99, 0.4)" }}
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="stat-tile-chip">E</span>
                <p className="field-label">Expires</p>
              </div>
              <p className="font-display text-lg font-semibold text-ink">
                {standing ? new Date(standing.expiresAt).toLocaleDateString() : "—"}
              </p>
              {standing && (
                <p className="mt-1 text-xs text-ink-soft">
                  {standing.extensionDays} grace day{standing.extensionDays === 1 ? "" : "s"} after expiry
                </p>
              )}
            </div>

            <div
              className="stat-tile py-5 pl-5 pr-5"
              style={{ "--tile-accent": "var(--color-sky)", "--tile-soft": "var(--color-sky-soft)", "--tile-glow": "rgba(31, 111, 168, 0.4)" }}
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="stat-tile-chip">O</span>
                <p className="field-label">Organization</p>
              </div>
              <p className="font-display text-lg font-semibold text-ink">{overview.organization.name}</p>
              <p className="mt-1 text-xs text-ink-soft">Account {overview.organization.status}</p>
            </div>
          </div>

          <div className="mb-2 flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--color-cobalt)" }} />
            <p className="field-label">Renewal history</p>
          </div>
          {overview.payments.length === 0 ? (
            <p className="text-sm text-ink-soft">No renewals recorded yet.</p>
          ) : (
            <div className="panel" style={ACCENT_STYLE}>
              <table className="w-full text-left text-sm">
                <thead className="border-b border-paper-line bg-paper">
                  <tr>
                    <th className="px-4 py-2 font-medium text-ink-soft">Recorded</th>
                    <th className="px-4 py-2 font-medium text-ink-soft">Amount</th>
                    <th className="px-4 py-2 text-right font-medium text-ink-soft">Days</th>
                    <th className="px-4 py-2 font-medium text-ink-soft">New expiry</th>
                    <th className="hidden px-4 py-2 font-medium text-ink-soft sm:table-cell">Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.payments.map((payment) => (
                    <tr key={payment.id} className="border-b border-paper-line last:border-0">
                      <td className="px-4 py-2 font-mono text-xs text-ink-soft">
                        {new Date(payment.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-2 text-ink">{money(payment)}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-ink-soft">{payment.daysGranted}</td>
                      <td className="px-4 py-2 font-mono text-xs text-ink-soft">
                        {new Date(payment.newExpiresAt).toLocaleDateString()}
                      </td>
                      <td className="hidden px-4 py-2 text-xs text-ink-soft sm:table-cell">
                        {payment.reference || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
