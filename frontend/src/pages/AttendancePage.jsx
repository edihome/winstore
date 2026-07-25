/**
 * ============================================================
 * File: AttendancePage.jsx
 * Module: Administration (Attendance)
 *
 * Description:
 * Staff movement log: every check-in/check-out session, newest first.
 * Each row is one in-store session — opened by a check-in, closed by a
 * check-out. A row with no check-out time is still open; an admin can
 * close it by hand. The actual check-in/check-out action happens on
 * the login screen's "Attendance" tab, not here — this is the read side.
 *
 * Everyone can open this page: the backend scopes the list to the
 * caller (own records only, unless their role grants attendance —
 * then staff of their assigned branches). Manual corrections (the
 * "Close session" action) are only offered with that grant.
 * ============================================================
 */

import { useEffect, useState } from "react";
import apiClient from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useFormat, toDateInputValue } from "../utils/format";
import EmptyState from "../components/EmptyState";
import StatusChip from "../components/StatusChip";
import { TableSkeleton } from "../components/Skeleton";
import { useTableKit, SortableTh, TablePager } from "../components/tableKit";

const defaultFrom = () => toDateInputValue(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
const defaultTo = () => toDateInputValue(new Date());

// Administration's card/panel accent.
const ACCENT_STYLE = { "--card-accent": "var(--color-cobalt)", "--card-glow": "rgba(53, 80, 143, 0.35)" };

const formatDuration = (checkInTime, checkOutTime) => {
  const ms = new Date(checkOutTime).getTime() - new Date(checkInTime).getTime();
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
};

export default function AttendancePage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const { dateTime } = useFormat();
  // Mirrors the backend's scoping: with the attendance grant this page
  // is a branch log with corrections; without it, a personal read-only log.
  const canManage = hasPermission("attendance");
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [closingId, setClosingId] = useState(null);

  const kit = useTableKit(records, { pageSize: 14, defaultSort: { key: "checkInTime", dir: "desc" } });

  const loadAttendance = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await apiClient.get("/attendance", { params: { from, to } });
      setRecords(response.data.data);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAttendance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyRange = (event) => {
    event.preventDefault();
    loadAttendance();
  };

  const closeSession = async (record) => {
    setClosingId(record.id);
    try {
      await apiClient.patch(`/attendance/${record.id}/close`);
      toast.success(`Session closed for ${record.staffName || "staff member"}.`);
      await loadAttendance();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setClosingId(null);
    }
  };

  const inputClass =
    "rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal";

  const openCount = records.filter((record) => record.isOpen).length;

  return (
    <div>
      <div className="mb-5">
        <span className="field-label text-cobalt">Administration</span>
        <h2 className="font-display text-xl font-semibold text-ink">
          {canManage ? "Attendance" : "My attendance"}
        </h2>
        {!canManage && (
          <p className="mt-1 text-sm text-ink-soft">
            Your own check-ins and check-outs. Check in or out from the login screen&apos;s Attendance tab.
          </p>
        )}
      </div>

      {loadError && (
        <p role="alert" className="mb-4 rounded border border-clay/30 bg-clay-soft px-3 py-2 text-sm text-clay">
          {loadError}
        </p>
      )}

      <form onSubmit={applyRange} className="mb-5 flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="from" className="field-label mb-1 block">
            From
          </label>
          <input id="from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="to" className="field-label mb-1 block">
            To
          </label>
          <input id="to" type="date" value={to} onChange={(event) => setTo(event.target.value)} className={inputClass} />
        </div>
        <button type="submit" disabled={loading} className="btn-solid btn-solid-primary btn-solid-sm">
          {loading ? "Loading…" : "Apply"}
        </button>
        {openCount > 0 && (
          <StatusChip tone="warning">
            {openCount} still checked in
          </StatusChip>
        )}
      </form>

      {loading && records.length === 0 ? (
        <TableSkeleton rows={8} />
      ) : records.length === 0 ? (
        <EmptyState
          icon="🕐"
          title="No attendance in this range"
          hint={
            canManage
              ? "Sessions appear here as staff check in and out from the login screen."
              : "Your check-ins and check-outs from the login screen's Attendance tab will appear here."
          }
        />
      ) : (
        <>
          <div className="panel" style={ACCENT_STYLE}>
            <table className="w-full text-left text-sm">
              <thead className="border-b border-paper-line bg-paper">
                <tr>
                  {canManage && <SortableTh kit={kit} sortKey="staffName">Staff</SortableTh>}
                  <SortableTh kit={kit} sortKey="checkInTime">Checked in</SortableTh>
                  <th className="px-4 py-2 font-medium text-ink-soft">Checked out</th>
                  <th className="hidden px-4 py-2 font-medium text-ink-soft sm:table-cell">Duration</th>
                  <th className="px-4 py-2 font-medium text-ink-soft">Status</th>
                  {canManage && <th className="px-4 py-2"></th>}
                </tr>
              </thead>
              <tbody>
                {kit.visible.map((record) => (
                  <tr key={record.id} className="border-b border-paper-line last:border-0">
                    {canManage && <td className="px-4 py-2 text-ink">{record.staffName || "—"}</td>}
                    <td className="px-4 py-2 font-mono text-xs text-ink-soft">
                      {record.checkInTime ? dateTime(record.checkInTime) : "—"}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-ink-soft">
                      {record.checkOutTime ? dateTime(record.checkOutTime) : "—"}
                    </td>
                    <td className="hidden px-4 py-2 font-mono text-xs text-ink-soft sm:table-cell">
                      {record.checkOutTime ? formatDuration(record.checkInTime, record.checkOutTime) : "—"}
                    </td>
                    <td className="px-4 py-2">
                      {record.isOpen ? (
                        <StatusChip tone="warning">checked in</StatusChip>
                      ) : (
                        <StatusChip tone="success">checked out</StatusChip>
                      )}
                    </td>
                    {canManage && (
                      <td className="px-4 py-2 text-right">
                        {record.isOpen && (
                          <button
                            type="button"
                            onClick={() => closeSession(record)}
                            disabled={closingId === record.id}
                            className="btn-link btn-link-warning"
                          >
                            {closingId === record.id ? "Closing…" : "Close session"}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePager kit={kit} noun="sessions" />
        </>
      )}
    </div>
  );
}
