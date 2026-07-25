/** Payments & cash-up — money taken by method, and expected cash in the drawer. */
import { useFormat } from "../../utils/format";
import { TileSkeleton } from "../../components/Skeleton";
import { ReportTiles, ReportTable, useReports, useReportData, useRegisterPrint } from "./reportsKit";

const cap = (s) => String(s || "").replace(/^\w/, (c) => c.toUpperCase());

export default function CashUpReport() {
  const { from, to, branchId, registerPrint } = useReports();
  const { money } = useFormat();
  const { data, loading, error } = useReportData("/reports/cash-up", { from, to, branchId });

  const methods = data?.methods || [];
  const tiles = data
    ? [
        { label: "Total collected", value: money(data.total), initial: "T", tone: "teal" },
        { label: "Expected cash", value: money(data.expectedCash), initial: "₦", tone: "signal" },
      ]
    : [];

  useRegisterPrint(
    registerPrint,
    data
      ? {
          title: "Payments & cash-up",
          tiles: tiles.map((x) => ({ label: x.label, value: x.value })),
          sections: [
            {
              title: "By payment method",
              columns: [{ label: "Method" }, { label: "Payments", align: "right" }, { label: "Total", align: "right" }],
              rows: methods.map((m) => [cap(m.method), m.count, money(m.total)]),
            },
          ],
        }
      : null,
    [data]
  );

  if (loading && !data) return <TileSkeleton count={2} />;
  if (error) return <p className="rounded border border-clay/30 bg-clay-soft px-3 py-2 text-sm text-clay">{error}</p>;

  return (
    <>
      <ReportTiles tiles={tiles} />
      <p className="field-label mb-2">By payment method</p>
      <ReportTable
        accent="var(--color-teal)"
        empty="No payments in this range."
        columns={[
          { key: "method", label: "Method", render: (r) => cap(r.method) },
          { key: "count", label: "Payments", align: "right" },
          { key: "total", label: "Total", align: "right", render: (r) => money(r.total) },
        ]}
        rows={methods}
      />
      <p className="mt-3 text-xs text-ink-soft">
        Expected cash is the cash portion of sales (change already deducted) — reconcile it against what's physically in the drawer.
      </p>
    </>
  );
}
