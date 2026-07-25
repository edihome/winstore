/**
 * ============================================================
 * File: reportsKit.jsx
 * Module: Reports
 *
 * Description:
 * Shared building blocks for the report pages: the semantic tile palette,
 * a KPI tile grid, a simple table, a data-fetching hook, and the
 * useReports() accessor for the shared filter/print context provided by
 * ReportsLayout. Keeps each report page short and consistent.
 * ============================================================
 */

import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import apiClient from "../../api/client";

// Tile colors are SEMANTIC: money in = teal, activity = sky, money out =
// clay, adjustments = amber/cobalt, service = berry, growth/net = signal.
// eslint-disable-next-line react-refresh/only-export-components
export const TILE_ACCENTS = {
  teal: { accent: "var(--color-teal)", soft: "var(--color-teal-soft)", glow: "rgba(15, 111, 99, 0.4)" },
  sky: { accent: "var(--color-sky)", soft: "var(--color-sky-soft)", glow: "rgba(31, 111, 168, 0.4)" },
  berry: { accent: "var(--color-berry)", soft: "var(--color-berry-soft)", glow: "rgba(156, 56, 101, 0.4)" },
  amber: { accent: "var(--color-amber-dark)", soft: "var(--color-amber-soft)", glow: "rgba(201, 147, 44, 0.45)" },
  clay: { accent: "var(--color-clay)", soft: "var(--color-clay-soft)", glow: "rgba(163, 69, 43, 0.4)" },
  signal: { accent: "var(--color-signal)", soft: "var(--color-signal-soft)", glow: "rgba(47, 125, 91, 0.4)" },
  cobalt: { accent: "var(--color-cobalt)", soft: "var(--color-cobalt-soft)", glow: "rgba(53, 80, 143, 0.4)" },
};

/** Filter values + print registration provided by ReportsLayout. */
// eslint-disable-next-line react-refresh/only-export-components
export function useReports() {
  return useOutletContext();
}

/**
 * Fetch a report whenever the filters change.
 *
 * @param {string} path e.g. "/reports/profit".
 * @param {object} params Query params (from/to/branchId/…).
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useReportData(path, params) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const key = JSON.stringify(params);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    apiClient
      .get(path, { params })
      .then((res) => !cancelled && setData(res.data.data))
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key]);

  return { data, loading, error };
}

/** KPI tile grid. tiles: [{ label, value, initial, tone }]. */
export function ReportTiles({ tiles }) {
  return (
    <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
      {tiles.map((tile) => {
        const a = TILE_ACCENTS[tile.tone] || TILE_ACCENTS.teal;
        return (
          <div
            key={tile.label}
            className="stat-tile py-4 pr-4 pl-4"
            style={{ "--tile-accent": a.accent, "--tile-soft": a.soft, "--tile-glow": a.glow }}
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="stat-tile-chip">{tile.initial}</span>
              <p className="field-label">{tile.label}</p>
            </div>
            <p className="stat-tile-value font-display text-2xl font-semibold">{tile.value}</p>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Simple report table.
 * columns: [{ key, label, align?, render?(row) }]. rows: array of objects.
 */
export function ReportTable({ columns, rows, empty = "No data for this range.", accent = "var(--color-cobalt)" }) {
  if (!rows || rows.length === 0) {
    return <p className="text-sm text-ink-soft">{empty}</p>;
  }
  return (
    <div className="panel overflow-x-auto" style={{ "--card-accent": accent, "--card-glow": "rgba(53, 80, 143, 0.35)" }}>
      <table className="w-full text-left text-sm">
        <thead className="border-b border-paper-line bg-paper">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-4 py-2 font-medium text-ink-soft ${col.align === "right" ? "text-right" : ""}`}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id || row.productId || index} className="border-b border-paper-line last:border-0">
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={`px-4 py-2 ${col.align === "right" ? "text-right font-mono text-xs" : "text-ink"}`}
                >
                  {col.render ? col.render(row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Small helper: register a print model when data is ready, clear on unmount. */
// eslint-disable-next-line react-refresh/only-export-components
export function useRegisterPrint(registerPrint, model, deps) {
  useEffect(() => {
    registerPrint(model || null);
    return () => registerPrint(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
