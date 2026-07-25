/** Profit & margin — revenue vs cost of goods sold, per product. */
import { useFormat } from "../../utils/format";
import { TileSkeleton } from "../../components/Skeleton";
import { ReportTiles, ReportTable, useReports, useReportData, useRegisterPrint } from "./reportsKit";

export default function ProfitReport() {
  const { from, to, branchId, registerPrint } = useReports();
  const { money } = useFormat();
  const { data, loading, error } = useReportData("/reports/profit", { from, to, branchId });

  const t = data?.totals;
  const tiles = t
    ? [
        { label: "Revenue", value: money(t.revenue), initial: "R", tone: "teal" },
        { label: "Cost of goods", value: money(t.cogs), initial: "C", tone: "clay" },
        { label: "Gross profit", value: money(t.grossProfit), initial: "₦", tone: "signal" },
        { label: "Margin", value: `${t.marginPct}%`, initial: "%", tone: "sky" },
      ]
    : [];
  const products = data?.products || [];

  useRegisterPrint(
    registerPrint,
    t
      ? {
          title: "Profit & margin",
          tiles: tiles.map((x) => ({ label: x.label, value: x.value })),
          sections: [
            {
              title: "Profit by product",
              columns: [
                { label: "Product" },
                { label: "Qty", align: "right" },
                { label: "Revenue", align: "right" },
                { label: "Cost", align: "right" },
                { label: "Profit", align: "right" },
                { label: "Margin", align: "right" },
              ],
              rows: products.map((p) => [p.name, p.quantity, money(p.revenue), money(p.cost), money(p.profit), `${p.marginPct}%`]),
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
      <p className="field-label mb-2">Profit by product</p>
      <ReportTable
        accent="var(--color-signal)"
        empty="No product sales in this range."
        columns={[
          { key: "name", label: "Product" },
          { key: "sku", label: "SKU" },
          { key: "quantity", label: "Qty", align: "right" },
          { key: "revenue", label: "Revenue", align: "right", render: (r) => money(r.revenue) },
          { key: "cost", label: "Cost", align: "right", render: (r) => money(r.cost) },
          {
            key: "profit",
            label: "Profit",
            align: "right",
            render: (r) => <span style={{ color: r.profit >= 0 ? "var(--color-signal)" : "var(--color-clay)" }}>{money(r.profit)}</span>,
          },
          { key: "marginPct", label: "Margin", align: "right", render: (r) => `${r.marginPct}%` },
        ]}
        rows={products}
      />
    </>
  );
}
