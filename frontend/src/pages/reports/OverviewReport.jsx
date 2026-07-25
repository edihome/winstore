/**
 * Branch overview — KPI summary, top items, and low stock (the original
 * Reports dashboard, now one report among several).
 */
import { useFormat } from "../../utils/format";
import { TileSkeleton } from "../../components/Skeleton";
import { ReportTiles, ReportTable, useReports, useReportData, useRegisterPrint } from "./reportsKit";

export default function OverviewReport() {
  const { from, to, branchId, registerPrint } = useReports();
  const { money } = useFormat();
  const params = { from, to, branchId };
  const summaryQ = useReportData("/reports/summary", params);
  const topQ = useReportData("/reports/top-items", params);
  const lowQ = useReportData("/reports/low-stock", { branchId });

  const s = summaryQ.data;
  const tiles = s
    ? [
        { label: "Revenue", value: money(s.sales.revenue), initial: "R", tone: "teal" },
        { label: "Refunds", value: money(s.returns?.total || 0), initial: "↩", tone: "clay" },
        { label: "Net revenue", value: money(s.netRevenue ?? s.sales.revenue), initial: "N", tone: "signal" },
        { label: "Sales", value: s.sales.count, initial: "S", tone: "sky" },
        { label: "Discounts given", value: money(s.sales.discountTotal), initial: "D", tone: "amber" },
        { label: "Tax collected", value: money(s.sales.taxTotal), initial: "T", tone: "cobalt" },
        { label: "Purchase spend", value: money(s.purchases.spend), initial: "P", tone: "clay" },
        { label: "Expenses (paid)", value: money(s.expenses.total), initial: "E", tone: "clay" },
        { label: "Appointments done", value: s.appointments.completed, initial: "A", tone: "berry" },
        { label: "New customers", value: s.newCustomers, initial: "C", tone: "signal" },
      ]
    : [];

  const topItems = topQ.data || [];
  const lowStock = lowQ.data || [];

  useRegisterPrint(
    registerPrint,
    s
      ? {
          title: "Branch overview",
          tiles: tiles.map((t) => ({ label: t.label, value: t.value })),
          sections: [
            {
              title: "Top items by revenue",
              columns: [{ label: "Item" }, { label: "Type" }, { label: "Qty", align: "right" }, { label: "Revenue", align: "right" }],
              rows: topItems.map((i) => [i.name, i.itemType, i.quantity, money(i.revenue)]),
            },
            {
              title: "Low stock (at or below reorder level)",
              columns: [{ label: "Product" }, { label: "SKU" }, { label: "Qty", align: "right" }, { label: "Reorder at", align: "right" }],
              rows: lowStock.map((r) => [r.productName, r.productSku, r.quantity, r.reorderLevel]),
            },
          ],
        }
      : null,
    [s, topQ.data, lowQ.data]
  );

  if (summaryQ.loading && !s) return <TileSkeleton count={8} />;
  if (summaryQ.error) return <p className="rounded border border-clay/30 bg-clay-soft px-3 py-2 text-sm text-clay">{summaryQ.error}</p>;

  return (
    <>
      <ReportTiles tiles={tiles} />
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="min-w-0">
          <p className="field-label mb-2">Top items by revenue</p>
          <ReportTable
            accent="var(--color-signal)"
            empty="No sales in this range yet."
            columns={[
              { key: "name", label: "Item" },
              { key: "itemType", label: "Type" },
              { key: "quantity", label: "Qty", align: "right" },
              { key: "revenue", label: "Revenue", align: "right", render: (r) => money(r.revenue) },
            ]}
            rows={topItems}
          />
        </div>
        <div className="min-w-0">
          <p className="field-label mb-2">Low stock (at or below reorder level)</p>
          <ReportTable
            accent="var(--color-clay)"
            empty="Nothing is low right now."
            columns={[
              { key: "productName", label: "Product" },
              { key: "productSku", label: "SKU" },
              { key: "quantity", label: "Qty", align: "right" },
              { key: "reorderLevel", label: "Reorder at", align: "right" },
            ]}
            rows={lowStock}
          />
        </div>
      </div>
    </>
  );
}
