/**
 * ============================================================
 * File: DashboardPage.jsx
 * Module: Dashboard
 *
 * Description:
 * The answer to "how is the business doing right now": today's KPIs,
 * the week's revenue trend, who's checked in, and what's running low —
 * all live from the same reports/attendance endpoints the deeper pages
 * use. Sections degrade by permission: a cashier without the reports
 * grant gets their personal day (their attendance, quick actions)
 * instead of an empty error wall.
 * ============================================================
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import apiClient from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useFormat, toDateInputValue } from "../utils/format";
import Sparkline from "../components/Sparkline";
import StatusChip from "../components/StatusChip";
import { TileSkeleton } from "../components/Skeleton";

const greeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
};

// KPI colors are SEMANTIC, not decorative: money in = teal, activity =
// sky, money out = clay, growth = signal — the same meanings these
// colors carry everywhere else in the app.
const TILE_STYLES = {
  teal: { "--tile-accent": "var(--color-teal)", "--tile-soft": "var(--color-teal-soft)", "--tile-glow": "rgba(15, 111, 99, 0.4)" },
  sky: { "--tile-accent": "var(--color-sky)", "--tile-soft": "var(--color-sky-soft)", "--tile-glow": "rgba(31, 111, 168, 0.4)" },
  clay: { "--tile-accent": "var(--color-clay)", "--tile-soft": "var(--color-clay-soft)", "--tile-glow": "rgba(163, 69, 43, 0.4)" },
  signal: { "--tile-accent": "var(--color-signal)", "--tile-soft": "var(--color-signal-soft)", "--tile-glow": "rgba(47, 125, 91, 0.4)" },
  berry: { "--tile-accent": "var(--color-berry)", "--tile-soft": "var(--color-berry-soft)", "--tile-glow": "rgba(156, 56, 101, 0.4)" },
};

// Manual reconcile, open to every staff member (sync is operational, not
// administrative). On an install with no hub configured it simply reports
// "nothing to reconcile" — the button is always safe to press.
function SyncNowPanel({ dateTime }) {
  const [status, setStatus] = useState(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const loadStatus = () =>
    apiClient
      .get("/sync/status")
      .then((res) => setStatus(res.data.data))
      .catch(() => setStatus(null));

  useEffect(() => {
    loadStatus();
  }, []);

  const runSync = async () => {
    setRunning(true);
    setError("");
    setResult(null);
    try {
      const res = await apiClient.post("/sync/run");
      setResult(res.data.data);
      await loadStatus();
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  const pending = status?.pending ?? 0;
  const configured = status?.enabled && status?.hubConfigured;

  // Offline is opt-in per org: an ordinary cloud tenant never sees this panel.
  // Render nothing until we know, and nothing at all for a non-offline org.
  if (!status || !status.orgEnabled) {
    return null;
  }

  return (
    <div className="panel mb-6 p-4" style={{ "--card-accent": "var(--color-sky)", "--card-glow": "rgba(31, 111, 168, 0.3)" }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="field-label mb-1">Data sync</p>
          {!status ? (
            <p className="text-sm text-ink-soft">Checking…</p>
          ) : !configured ? (
            <p className="text-sm text-ink-soft">
              This install isn’t linked to a central server yet — nothing to sync.
            </p>
          ) : pending > 0 ? (
            <p className="text-sm text-ink">
              <span className="font-semibold text-sky">{pending}</span> change{pending === 1 ? "" : "s"} waiting to send.
            </p>
          ) : (
            <p className="text-sm text-ink-soft">All changes are up to date.</p>
          )}
          {result ? (
            <p className="mt-1 text-xs text-ink-soft">
              {result.message
                ? result.message
                : `Sent ${result.pushed}, received ${result.pulled} · ${dateTime(result.at)}`}
            </p>
          ) : (
            status?.lastSyncedAt && (
              <p className="mt-1 text-xs text-ink-soft">Last synced {dateTime(status.lastSyncedAt)}.</p>
            )
          )}
          {error && <p className="mt-1 text-xs text-clay">{error}</p>}
          {!error && status?.lastError && <p className="mt-1 text-xs text-clay">Last sync failed: {status.lastError}</p>}
        </div>
        <button type="button" onClick={runSync} disabled={running} className="btn-solid btn-solid-primary btn-solid-sm">
          {running ? "Syncing…" : "Sync now"}
        </button>
      </div>
    </div>
  );
}

function KpiTile({ label, value, sub, tone = "teal", initial }) {
  return (
    <div className="stat-tile p-4" style={TILE_STYLES[tone]}>
      <div className="mb-2 flex items-center gap-2">
        <span className="stat-tile-chip">{initial}</span>
        <p className="field-label">{label}</p>
      </div>
      <p className="stat-tile-value font-display text-2xl font-semibold">{value}</p>
      {sub && <p className="mt-1 text-xs text-ink-soft">{sub}</p>}
    </div>
  );
}

export default function DashboardPage() {
  const { user, activeBranch, hasPermission } = useAuth();
  const { money, time, date, dateTime } = useFormat();
  const navigate = useNavigate();

  const canSeeReports = hasPermission("reports");
  const [summary, setSummary] = useState(null);
  const [trend, setTrend] = useState(null);
  const [lowStock, setLowStock] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const today = toDateInputValue();
    const branchParams = activeBranch?.id ? { branchId: activeBranch.id } : {};

    const requests = [
      apiClient
        .get("/attendance", { params: { from: today, to: today } })
        .then((res) => setAttendance(res.data.data))
        .catch(() => setAttendance([])),
    ];

    if (canSeeReports) {
      requests.push(
        apiClient
          .get("/reports/summary", { params: { ...branchParams, from: today, to: today } })
          .then((res) => setSummary(res.data.data))
          .catch(() => setSummary(null)),
        apiClient
          .get("/reports/revenue-trend", { params: branchParams })
          .then((res) => setTrend(res.data.data))
          .catch(() => setTrend(null)),
        apiClient
          .get("/reports/low-stock", { params: branchParams })
          .then((res) => setLowStock(res.data.data))
          .catch(() => setLowStock([]))
      );
    }

    Promise.allSettled(requests).then(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBranch?.id, canSeeReports]);

  if (!user) {
    return null;
  }

  const checkedIn = attendance.filter((record) => record.isOpen);
  const myToday = attendance.filter((record) => record.userId === user.id);
  const trendTotal = (trend || []).reduce((sum, day) => sum + day.revenue, 0);

  const quickActions = [
    hasPermission("sales", "create") && { label: "New sale", to: "/dashboard/sales", primary: true },
    hasPermission("customers", "create") && { label: "Add customer", to: "/dashboard/customers" },
    hasPermission("appointments", "create") && { label: "Book appointment", to: "/dashboard/services/appointments" },
  ].filter(Boolean);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="field-label text-teal">{date(new Date())}</span>
          <h2 className="font-display text-2xl font-semibold text-ink">
            {greeting()}, {user.firstName}
          </h2>
          <p className="mt-0.5 text-sm text-ink-soft">
            {activeBranch?.name ? `Acting on ${activeBranch.name}` : user.organization.name}
            {user.role ? ` · ${user.role}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {quickActions.map((action) => (
            <button
              key={action.to}
              type="button"
              onClick={() => navigate(action.to)}
              className={action.primary ? "btn-solid btn-solid-primary btn-solid-sm" : "btn-chip btn-chip-primary"}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>

      {canSeeReports ? (
        loading && !summary ? (
          <TileSkeleton count={4} />
        ) : (
          summary && (
            <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
              <KpiTile label="Revenue today" value={money(summary.sales.revenue)} tone="teal" initial="R" />
              <KpiTile
                label="Sales today"
                value={summary.sales.count}
                sub={summary.appointments.completed > 0 ? `${summary.appointments.completed} appointment${summary.appointments.completed === 1 ? "" : "s"} completed` : undefined}
                tone="sky"
                initial="S"
              />
              <KpiTile label="Expenses today" value={money(summary.expenses.total)} tone="clay" initial="E" />
              <KpiTile label="New customers" value={summary.newCustomers} tone="signal" initial="C" />
            </div>
          )
        )
      ) : (
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <KpiTile label="My check-ins today" value={myToday.length} tone="sky" initial="A" />
          <KpiTile
            label="Status"
            value={myToday.some((r) => r.isOpen) ? "Checked in" : "Checked out"}
            tone={myToday.some((r) => r.isOpen) ? "signal" : "clay"}
            initial="●"
          />
          <KpiTile label="Branch" value={activeBranch?.name || "—"} tone="teal" initial="B" />
          <KpiTile label="Role" value={user.role || "—"} tone="berry" initial="R" />
        </div>
      )}

      <SyncNowPanel dateTime={dateTime} />

      <div className="grid gap-6 lg:grid-cols-3">
        {canSeeReports && (
          <div className="stat-tile p-5 lg:col-span-2" style={TILE_STYLES.teal}>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <p className="field-label">Revenue — last 7 days</p>
              <p className="font-display text-lg font-semibold text-teal">{money(trendTotal)}</p>
            </div>
            <Sparkline points={(trend || []).map((day) => day.revenue)} height={72} />
            {trend && (
              <div className="mt-1 flex justify-between font-mono text-[0.65rem] text-ink-soft">
                <span>{date(trend[0]?.day)}</span>
                <span>{date(trend[trend.length - 1]?.day)}</span>
              </div>
            )}
          </div>
        )}

        <div className="panel p-4" style={{ "--card-accent": "var(--color-signal)", "--card-glow": "rgba(47, 125, 91, 0.3)" }}>
          <p className="field-label mb-3">In the store right now</p>
          {checkedIn.length === 0 ? (
            <p className="text-sm text-ink-soft">Nobody is currently checked in.</p>
          ) : (
            <ul className="space-y-2">
              {checkedIn.slice(0, 8).map((record) => (
                <li key={record.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-ink">{record.staffName || "—"}</span>
                  <span className="shrink-0 font-mono text-xs text-ink-soft">since {time(record.checkInTime)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {canSeeReports && (
          <div className="panel p-4 lg:col-span-3" style={{ "--card-accent": "var(--color-clay)", "--card-glow": "rgba(163, 69, 43, 0.3)" }}>
            <div className="mb-3 flex items-center justify-between">
              <p className="field-label">Low stock — at or below reorder level</p>
              {lowStock.length > 0 && hasPermission("products") && (
                <button type="button" onClick={() => navigate("/dashboard/inventory/products")} className="btn-link btn-link-primary">
                  Go to stock →
                </button>
              )}
            </div>
            {lowStock.length === 0 ? (
              <p className="text-sm text-ink-soft">Nothing is low right now.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {lowStock.slice(0, 10).map((row) => (
                  <StatusChip key={`${row.productId}-${row.branchId}`} tone={row.quantity === 0 ? "danger" : "warning"}>
                    {row.productName} · {row.quantity} left
                  </StatusChip>
                ))}
                {lowStock.length > 10 && <span className="text-xs text-ink-soft">+{lowStock.length - 10} more</span>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
