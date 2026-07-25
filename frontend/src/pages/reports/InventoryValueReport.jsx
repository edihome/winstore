/** Inventory valuation — stock on hand valued at cost (and retail), a snapshot. */
import { useFormat } from "../../utils/format";
import { TileSkeleton } from "../../components/Skeleton";
import { ReportTiles, ReportTable, useReports, useReportData, useRegisterPrint } from "./reportsKit";

export default function InventoryValueReport() {
  const { branchId, registerPrint } = useReports();
  const { money } = useFormat();
  const { data, loading, error } = useReportData("/reports/inventory-value", { branchId });

  const items = data?.items || [];
  const tiles = data
    ? [
        { label: "Stock value (cost)", value: money(data.totalCostValue), initial: "₦", tone: "teal" },
        { label: "Retail value", value: money(data.totalRetailValue), initial: "R", tone: "sky" },
        { label: "Products in stock", value: data.skuCount, initial: "#", tone: "signal" },
      ]
    : [];

  useRegisterPrint(
    registerPrint,
    data
      ? {
          title: "Inventory valuation",
          subtitle: "current snapshot",
          tiles: tiles.map((x) => ({ label: x.label, value: x.value })),
          sections: [
            {
              title: "By product",
              columns: [
                { label: "Product" },
                { label: "Category" },
                { label: "Qty", align: "right" },
                { label: "Unit cost", align: "right" },
                { label: "Stock value", align: "right" },
              ],
              rows: items.map((i) => [i.name, i.categoryName, i.quantity, money(i.cost), money(i.costValue)]),
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
      <p className="field-label mb-2">By product</p>
      <ReportTable
        accent="var(--color-teal)"
        empty="No stock on hand."
        columns={[
          { key: "name", label: "Product" },
          { key: "categoryName", label: "Category" },
          { key: "quantity", label: "Qty", align: "right" },
          { key: "cost", label: "Unit cost", align: "right", render: (r) => money(r.cost) },
          { key: "costValue", label: "Stock value", align: "right", render: (r) => money(r.costValue) },
          { key: "retailValue", label: "Retail value", align: "right", render: (r) => money(r.retailValue) },
        ]}
        rows={items}
      />
    </>
  );
}
