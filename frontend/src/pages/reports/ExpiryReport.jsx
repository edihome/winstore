/** Expiry — stock batches at or near their expiry date (branch-scoped). */
import { useState } from "react";
import { useFormat } from "../../utils/format";
import { TileSkeleton } from "../../components/Skeleton";
import StatusChip from "../../components/StatusChip";
import { ReportTiles, ReportTable, useReports, useReportData, useRegisterPrint } from "./reportsKit";

const TONE = { expired: "danger", critical: "warning", warning: "neutral" };

export default function ExpiryReport() {
  const { branchId, registerPrint } = useReports();
  const { money, date } = useFormat();
  const [withinDays, setWithinDays] = useState(90);
  const { data, loading, error } = useReportData("/reports/expiry", { branchId, withinDays });

  const items = data?.items || [];
  const tiles = data
    ? [
        { label: "Value at risk", value: money(data.totalAtRisk), initial: "⚠", tone: "amber" },
        { label: "Already expired", value: money(data.expiredValue), initial: "✕", tone: "clay" },
        { label: "Batches", value: items.length, initial: "#", tone: "sky" },
      ]
    : [];

  useRegisterPrint(
    registerPrint,
    data
      ? {
          title: `Expiry (next ${withinDays} days)`,
          subtitle: `within ${withinDays} days`,
          tiles: tiles.map((x) => ({ label: x.label, value: x.value })),
          sections: [
            {
              title: "Expiring / expired batches",
              columns: [
                { label: "Product" },
                { label: "Branch" },
                { label: "Expires" },
                { label: "Days left", align: "right" },
                { label: "Qty", align: "right" },
                { label: "Value", align: "right" },
              ],
              rows: items.map((i) => [i.productName, i.branchName, date(i.expiryDate), i.daysLeft, i.quantity, money(i.valueAtRisk)]),
            },
          ],
        }
      : null,
    [data, withinDays]
  );

  const selectClass = "rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal";

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <label htmlFor="withinDays" className="field-label">
          Expiring within
        </label>
        <select id="withinDays" value={withinDays} onChange={(e) => setWithinDays(Number(e.target.value))} className={selectClass}>
          <option value={30}>30 days</option>
          <option value={60}>60 days</option>
          <option value={90}>90 days</option>
          <option value={180}>180 days</option>
        </select>
      </div>

      {loading && !data ? (
        <TileSkeleton count={3} />
      ) : error ? (
        <p className="rounded border border-clay/30 bg-clay-soft px-3 py-2 text-sm text-clay">{error}</p>
      ) : (
        <>
          <ReportTiles tiles={tiles} />
          <p className="field-label mb-2">Expiring / expired batches</p>
          <ReportTable
            accent="var(--color-amber-dark)"
            empty="Nothing expiring in this window."
            columns={[
              { key: "productName", label: "Product" },
              { key: "productSku", label: "SKU" },
              { key: "branchName", label: "Branch" },
              { key: "expiryDate", label: "Expires", render: (r) => date(r.expiryDate) },
              { key: "daysLeft", label: "Days left", align: "right", render: (r) => (r.daysLeft < 0 ? `${-r.daysLeft}d ago` : r.daysLeft) },
              { key: "quantity", label: "Qty", align: "right" },
              { key: "valueAtRisk", label: "Value", align: "right", render: (r) => money(r.valueAtRisk) },
              { key: "status", label: "", render: (r) => <StatusChip tone={TONE[r.status]}>{r.status}</StatusChip> },
            ]}
            rows={items}
          />
        </>
      )}
    </>
  );
}
