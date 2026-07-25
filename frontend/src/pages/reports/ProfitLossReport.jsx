/** Profit & Loss — revenue − cost of goods − expenses = net profit. */
import { useFormat } from "../../utils/format";
import { TileSkeleton } from "../../components/Skeleton";
import { ReportTiles, ReportTable, useReports, useReportData, useRegisterPrint } from "./reportsKit";

export default function ProfitLossReport() {
  const { from, to, branchId, registerPrint } = useReports();
  const { money } = useFormat();
  const { data, loading, error } = useReportData("/reports/profit-loss", { from, to, branchId });

  const tiles = data
    ? [
        { label: "Revenue", value: money(data.revenue), initial: "R", tone: "teal" },
        { label: "Gross profit", value: money(data.grossProfit), initial: "G", tone: "sky" },
        { label: "Expenses", value: money(data.totalExpenses), initial: "E", tone: "clay" },
        { label: "Net profit", value: money(data.netProfit), initial: "₦", tone: data && data.netProfit >= 0 ? "signal" : "clay" },
      ]
    : [];

  // The P&L statement as ordered line items.
  const lines = data
    ? [
        { label: "Revenue", value: data.revenue, kind: "in" },
        { label: "Less: Cost of goods sold", value: -data.cogs, kind: "out" },
        { label: "Gross profit", value: data.grossProfit, kind: "sub" },
        { label: "Less: Expenses", value: -data.totalExpenses, kind: "out" },
        { label: "Net profit", value: data.netProfit, kind: "total" },
      ]
    : [];

  useRegisterPrint(
    registerPrint,
    data
      ? {
          title: "Profit & Loss",
          tiles: tiles.map((x) => ({ label: x.label, value: x.value })),
          sections: [
            { title: "Statement", columns: [{ label: "Line" }, { label: "Amount", align: "right" }], rows: lines.map((l) => [l.label, money(l.value)]) },
            {
              title: "Expenses by category",
              columns: [{ label: "Category" }, { label: "Count", align: "right" }, { label: "Total", align: "right" }],
              rows: (data.expenses || []).map((e) => [e.category, e.count, money(e.total)]),
            },
          ],
        }
      : null,
    [data]
  );

  if (loading && !data) return <TileSkeleton count={4} />;
  if (error) return <p className="rounded border border-clay/30 bg-clay-soft px-3 py-2 text-sm text-clay">{error}</p>;

  return (
    <>
      <ReportTiles tiles={tiles} />
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="min-w-0">
          <p className="field-label mb-2">Statement</p>
          <div className="panel" style={{ "--card-accent": "var(--color-signal)", "--card-glow": "rgba(47, 125, 91, 0.35)" }}>
            <table className="w-full text-left text-sm">
              <tbody>
                {lines.map((l) => (
                  <tr
                    key={l.label}
                    className={`border-b border-paper-line last:border-0 ${l.kind === "total" ? "font-semibold" : ""}`}
                  >
                    <td className={`px-4 py-2 ${l.kind === "sub" || l.kind === "total" ? "text-ink" : "text-ink-soft"}`}>{l.label}</td>
                    <td
                      className="px-4 py-2 text-right font-mono text-xs"
                      style={{ color: l.value < 0 ? "var(--color-clay)" : l.kind === "total" || l.kind === "sub" ? "var(--color-signal)" : "inherit" }}
                    >
                      {money(l.value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="min-w-0">
          <p className="field-label mb-2">Expenses by category</p>
          <ReportTable
            accent="var(--color-clay)"
            empty="No expenses in this range."
            columns={[
              { key: "category", label: "Category" },
              { key: "count", label: "Count", align: "right" },
              { key: "total", label: "Total", align: "right", render: (r) => money(r.total) },
            ]}
            rows={data?.expenses || []}
          />
        </div>
      </div>
    </>
  );
}
