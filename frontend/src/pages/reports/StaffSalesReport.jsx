/** Sales by staff — each cashier's sales, revenue, refunds, and average sale. */
import { useFormat } from "../../utils/format";
import { TileSkeleton } from "../../components/Skeleton";
import { ReportTiles, ReportTable, useReports, useReportData, useRegisterPrint } from "./reportsKit";

export default function StaffSalesReport() {
  const { from, to, branchId, registerPrint } = useReports();
  const { money } = useFormat();
  const { data, loading, error } = useReportData("/reports/sales-by-staff", { from, to, branchId });

  const staff = data?.staff || [];
  const totalRevenue = staff.reduce((sum, s) => sum + s.revenue, 0);
  const totalSales = staff.reduce((sum, s) => sum + s.saleCount, 0);
  const tiles = data
    ? [
        { label: "Staff selling", value: staff.length, initial: "S", tone: "sky" },
        { label: "Total sales", value: totalSales, initial: "#", tone: "sky" },
        { label: "Total revenue", value: money(totalRevenue), initial: "R", tone: "teal" },
      ]
    : [];

  useRegisterPrint(
    registerPrint,
    data
      ? {
          title: "Sales by staff",
          tiles: tiles.map((x) => ({ label: x.label, value: x.value })),
          sections: [
            {
              title: "Per staff member",
              columns: [
                { label: "Staff" },
                { label: "Sales", align: "right" },
                { label: "Revenue", align: "right" },
                { label: "Refunded", align: "right" },
                { label: "Net", align: "right" },
                { label: "Avg sale", align: "right" },
              ],
              rows: staff.map((s) => [s.name, s.saleCount, money(s.revenue), money(s.refunded), money(s.netRevenue), money(s.averageSale)]),
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
      <p className="field-label mb-2">Per staff member</p>
      <ReportTable
        accent="var(--color-sky)"
        empty="No sales in this range."
        columns={[
          { key: "name", label: "Staff" },
          { key: "saleCount", label: "Sales", align: "right" },
          { key: "revenue", label: "Revenue", align: "right", render: (r) => money(r.revenue) },
          { key: "refunded", label: "Refunded", align: "right", render: (r) => money(r.refunded) },
          { key: "netRevenue", label: "Net", align: "right", render: (r) => money(r.netRevenue) },
          { key: "averageSale", label: "Avg sale", align: "right", render: (r) => money(r.averageSale) },
        ]}
        rows={staff}
      />
    </>
  );
}
