/** Customer insights — top customers by spend (walk-ins excluded). */
import { useFormat } from "../../utils/format";
import { TileSkeleton } from "../../components/Skeleton";
import { ReportTiles, ReportTable, useReports, useReportData, useRegisterPrint } from "./reportsKit";

export default function CustomersReport() {
  const { from, to, branchId, registerPrint } = useReports();
  const { money, date } = useFormat();
  const { data, loading, error } = useReportData("/reports/customers", { from, to, branchId });

  const customers = data?.customers || [];
  const totalSpend = customers.reduce((s, c) => s + c.spend, 0);
  const tiles = data
    ? [
        { label: "Named customers", value: customers.length, initial: "C", tone: "berry" },
        { label: "Their spend", value: money(totalSpend), initial: "R", tone: "teal" },
      ]
    : [];

  useRegisterPrint(
    registerPrint,
    data
      ? {
          title: "Top customers",
          tiles: tiles.map((x) => ({ label: x.label, value: x.value })),
          sections: [
            {
              title: "By spend",
              columns: [{ label: "Customer" }, { label: "Orders", align: "right" }, { label: "Spend", align: "right" }, { label: "Last order" }],
              rows: customers.map((c) => [c.name, c.orderCount, money(c.spend), date(c.lastOrder)]),
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
      <p className="field-label mb-2">Top customers by spend</p>
      <ReportTable
        accent="var(--color-berry)"
        empty="No sales attributed to a named customer in this range (walk-ins aren't counted)."
        columns={[
          { key: "name", label: "Customer" },
          { key: "orderCount", label: "Orders", align: "right" },
          { key: "spend", label: "Spend", align: "right", render: (r) => money(r.spend) },
          { key: "lastOrder", label: "Last order", render: (r) => date(r.lastOrder) },
        ]}
        rows={customers}
      />
    </>
  );
}
