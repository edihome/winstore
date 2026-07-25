/** Sales by category — revenue, cost, and profit grouped by product category. */
import { useFormat } from "../../utils/format";
import { TileSkeleton } from "../../components/Skeleton";
import { ReportTiles, ReportTable, useReports, useReportData, useRegisterPrint } from "./reportsKit";

export default function SalesByCategoryReport() {
  const { from, to, branchId, registerPrint } = useReports();
  const { money } = useFormat();
  const { data, loading, error } = useReportData("/reports/sales-by-category", { from, to, branchId });

  const categories = data?.categories || [];
  const totalRevenue = categories.reduce((s, c) => s + c.revenue, 0);
  const totalProfit = categories.reduce((s, c) => s + c.profit, 0);
  const tiles = data
    ? [
        { label: "Categories sold", value: categories.length, initial: "#", tone: "sky" },
        { label: "Revenue", value: money(totalRevenue), initial: "R", tone: "teal" },
        { label: "Gross profit", value: money(totalProfit), initial: "₦", tone: "signal" },
      ]
    : [];

  useRegisterPrint(
    registerPrint,
    data
      ? {
          title: "Sales by category",
          tiles: tiles.map((x) => ({ label: x.label, value: x.value })),
          sections: [
            {
              title: "By category",
              columns: [
                { label: "Category" },
                { label: "Qty", align: "right" },
                { label: "Revenue", align: "right" },
                { label: "Profit", align: "right" },
                { label: "Margin", align: "right" },
              ],
              rows: categories.map((c) => [c.category, c.quantity, money(c.revenue), money(c.profit), `${c.marginPct}%`]),
            },
          ],
        }
      : null,
    [data]
  );

  if (loading && !data) return <TileSkeleton count={3} />;
  if (error) return <p className="rounded border border-clay/30 bg-clay-soft px-3 py-2 text-sm text-clay">{error}</p>;

  return (
    <>
      <ReportTiles tiles={tiles} />
      <p className="field-label mb-2">By category</p>
      <ReportTable
        accent="var(--color-signal)"
        empty="No product sales in this range."
        columns={[
          { key: "category", label: "Category" },
          { key: "quantity", label: "Qty", align: "right" },
          { key: "revenue", label: "Revenue", align: "right", render: (r) => money(r.revenue) },
          { key: "cost", label: "Cost", align: "right", render: (r) => money(r.cost) },
          { key: "profit", label: "Profit", align: "right", render: (r) => money(r.profit) },
          { key: "marginPct", label: "Margin", align: "right", render: (r) => `${r.marginPct}%` },
        ]}
        rows={categories}
      />
    </>
  );
}
