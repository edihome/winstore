/** Discounts given — total price given away, by discount code. */
import { useFormat } from "../../utils/format";
import { TileSkeleton } from "../../components/Skeleton";
import { ReportTiles, ReportTable, useReports, useReportData, useRegisterPrint } from "./reportsKit";

export default function DiscountsReport() {
  const { from, to, branchId, registerPrint } = useReports();
  const { money } = useFormat();
  const { data, loading, error } = useReportData("/reports/discounts", { from, to, branchId });

  const discounts = data?.discounts || [];
  const tiles = data
    ? [
        { label: "Total given away", value: money(data.totalGiven), initial: "D", tone: "amber" },
        { label: "Discount codes", value: discounts.length, initial: "#", tone: "sky" },
      ]
    : [];

  useRegisterPrint(
    registerPrint,
    data
      ? {
          title: "Discounts given",
          tiles: tiles.map((x) => ({ label: x.label, value: x.value })),
          sections: [
            {
              title: "By discount",
              columns: [{ label: "Code" }, { label: "Times used", align: "right" }, { label: "Total given", align: "right" }],
              rows: discounts.map((d) => [d.code, d.timesUsed, money(d.totalDiscount)]),
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
      <p className="field-label mb-2">By discount</p>
      <ReportTable
        accent="var(--color-amber-dark)"
        empty="No discounts given in this range."
        columns={[
          { key: "code", label: "Code" },
          { key: "timesUsed", label: "Times used", align: "right" },
          { key: "totalDiscount", label: "Total given", align: "right", render: (r) => money(r.totalDiscount) },
        ]}
        rows={discounts}
      />
    </>
  );
}
