/**
 * ============================================================
 * File: SubscriptionAlertBanner.jsx
 * Module: Shared Components
 *
 * Description:
 * The "your subscription is about to expire" banner shown to a
 * tenant's own super_admin — staff accounts and the developer
 * platform role never see this (see auth.service.buildSubscriptionAlert
 * on the backend, which only ever computes it for super_admin).
 *
 * Dismissible for the rest of the browser session (sessionStorage, not
 * localStorage — it should NOT persist forever once closed), but
 * AuthContext.login() clears that dismissal on every fresh login, so
 * the alert reliably reappears "at every login" even if a previous
 * session dismissed it.
 * ============================================================
 */

import { useState } from "react";
import { useAuth } from "../context/AuthContext";

// Shared with AuthContext.jsx's login() — kept as a matching literal
// there rather than an import, to avoid a context module reaching into
// a component module for one string constant.
export const SUBSCRIPTION_ALERT_DISMISSED_KEY = "winstore_subscription_alert_dismissed";

const LEVEL_STYLES = {
  warning: "border-amber/40 bg-amber-soft text-amber-dark",
  critical: "border-clay/50 bg-clay-soft text-clay",
  expired: "border-clay bg-clay text-paper",
};

export default function SubscriptionAlertBanner() {
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem(SUBSCRIPTION_ALERT_DISMISSED_KEY) === "true"
  );

  const alert = user?.subscriptionAlert;
  if (!alert || dismissed) {
    return null;
  }

  const dismiss = () => {
    sessionStorage.setItem(SUBSCRIPTION_ALERT_DISMISSED_KEY, "true");
    setDismissed(true);
  };

  return (
    <div
      role="alert"
      className={`mb-4 flex items-start justify-between gap-3 rounded border px-4 py-3 text-sm ${
        LEVEL_STYLES[alert.level] || LEVEL_STYLES.warning
      }`}
    >
      <p>{alert.message}</p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="shrink-0 text-lg leading-none opacity-70 transition hover:opacity-100"
      >
        &times;
      </button>
    </div>
  );
}
