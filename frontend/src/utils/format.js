/**
 * ============================================================
 * File: format.js
 * Module: Shared Utilities
 *
 * Description:
 * Money and date formatting driven by the organization's own settings
 * (currency, timezone — created at registration, returned by
 * GET /auth/me) instead of hardcoded dollars and the browser's locale.
 * Every page formats through here so a Lagos business sees ₦ and Lagos
 * time everywhere, not $ and UTC.
 *
 * The formatting LOCALE is derived from the org's currency (see
 * CURRENCY_LOCALES) rather than the viewer's browser, because the
 * browser locale decides whether a currency renders as its symbol
 * (₦1,234.50) or its code ("NGN 1,234.50"). Deriving it keeps the
 * symbol correct per organization regardless of who's looking.
 * ============================================================
 */

import { useAuth } from "../context/AuthContext";

// Which locale renders each currency the way its users expect (symbol,
// grouping, date order). Falls back to the viewer's browser locale for
// anything not listed.
const CURRENCY_LOCALES = {
  NGN: "en-NG",
  USD: "en-US",
  GBP: "en-GB",
  EUR: "de-DE",
  GHS: "en-GH",
  KES: "en-KE",
  ZAR: "en-ZA",
};

const localeForCurrency = (currency) => CURRENCY_LOCALES[currency] || undefined;

export const formatMoney = (value, currency = "USD", locale = localeForCurrency(currency)) => {
  const amount = Number(value) || 0;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
  } catch {
    // Unknown/legacy currency code in settings — degrade to "CODE 12.00".
    return `${currency} ${amount.toFixed(2)}`;
  }
};

const safeDateTimeFormat = (options, timeZone, locale) => {
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone });
  } catch {
    // Invalid timezone in settings — fall back to the browser's.
    return new Intl.DateTimeFormat(locale, options);
  }
};

export const formatDate = (value, timeZone, locale) =>
  value ? safeDateTimeFormat({ dateStyle: "medium" }, timeZone, locale).format(new Date(value)) : "—";

export const formatDateTime = (value, timeZone, locale) =>
  value ? safeDateTimeFormat({ dateStyle: "medium", timeStyle: "short" }, timeZone, locale).format(new Date(value)) : "—";

export const formatTime = (value, timeZone, locale) =>
  value ? safeDateTimeFormat({ timeStyle: "short" }, timeZone, locale).format(new Date(value)) : "—";

/**
 * YYYY-MM-DD for <input type="date">, in LOCAL time. The old
 * `toISOString().slice(0, 10)` returned the UTC date — which is
 * yesterday for any user west of UTC in the evening, silently
 * shifting every default date range.
 */
export const toDateInputValue = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

/**
 * Formatters bound to the signed-in organization's settings — the
 * one-line way pages get org-aware `money()` / `date()` / `dateTime()`.
 */
export function useFormat() {
  const { user } = useAuth();
  const currency = user?.settings?.currency || "USD";
  const locale = localeForCurrency(currency);
  const timeZone = user?.settings?.timezone && user.settings.timezone !== "UTC" ? user.settings.timezone : undefined;

  return {
    currency,
    money: (value) => formatMoney(value, currency, locale),
    date: (value) => formatDate(value, timeZone, locale),
    dateTime: (value) => formatDateTime(value, timeZone, locale),
    time: (value) => formatTime(value, timeZone, locale),
  };
}
