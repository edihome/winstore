/** Branch comparison — sales and revenue per branch, side by side (all branches). */
import { useFormat } from "../../utils/format";
import { TileSkeleton } from "../../components/Skeleton";
import { ReportTiles, ReportTable, useReports, useReportData, useRegisterPrint } from "./reportsKit";

export default function BranchComparisonReport() {
  const { from, to, registerPrint } = useReports();
  const { money } = useFormat();
  // Compares every branch, so the branch filter isn't applied here.
  const { data, loading, error } = useReportData("/reports/branch-comparison", { from, to });

  const branches = data?.branches || [];
  const totalRevenue = branches.reduce((s, b) => s + b.revenue, 0);
  const tiles = data
    ? [
        { label: "Branches", value: branches.length, initial: "#", tone: "sky" },
        { label: "Total revenue", value: money(totalRevenue), initial: "R", tone: "teal" },
      ]
    : [];

  useRegisterPrint(
    registerPrint,
    data
      ? {
          title: "Branch comparison",
          tiles: tiles.map((x) => ({ label: x.label, value: x.value })),
          sections: [
            {
              title: "By branch",
              columns: [
                { label: "Branch" },
                { label: "Sales", align: "right" },
                { label: "Revenue", align: "right" },
                { label: "Refunded", align: "right" },
                { label: "Net", align: "right" },
              ],
              rows: branches.map((b) => [b.name, b.saleCount, money(b.revenue), money(b.refunded), money(b.netRevenue)]),
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
      <p className="field-label mb-2">By branch (all branches, this date range)</p>
      <ReportTable
        accent="var(--color-sky)"
        empty="No branches yet."
        columns={[
          { key: "name", label: "Branch" },
          { key: "saleCount", label: "Sales", align: "right" },
          { key: "revenue", label: "Revenue", align: "right", render: (r) => money(r.revenue) },
          { key: "refunded", label: "Refunded", align: "right", render: (r) => money(r.refunded) },
          { key: "netRevenue", label: "Net", align: "right", render: (r) => money(r.netRevenue) },
        ]}
        rows={branches}
      />
    </>
  );
}
