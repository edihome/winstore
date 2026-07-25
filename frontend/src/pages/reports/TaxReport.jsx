/** VAT / tax — tax collected over the period, for filing. */
import { useFormat } from "../../utils/format";
import { TileSkeleton } from "../../components/Skeleton";
import { ReportTiles, ReportTable, useReports, useReportData, useRegisterPrint } from "./reportsKit";

export default function TaxReport() {
  const { from, to, branchId, registerPrint } = useReports();
  const { money, date } = useFormat();
  const { data, loading, error } = useReportData("/reports/tax", { from, to, branchId });

  const tiles = data
    ? [
        { label: "VAT collected", value: money(data.taxCollected), initial: "T", tone: "cobalt" },
        { label: "Taxable sales", value: money(data.taxableBase), initial: "B", tone: "sky" },
        { label: "Effective rate", value: `${data.effectiveRate}%`, initial: "%", tone: "amber" },
        { label: "Sales", value: data.saleCount, initial: "#", tone: "sky" },
      ]
    : [];
  // Only days with activity, to keep the table readable.
  const activeDays = (data?.daily || []).filter((d) => d.taxCollected > 0 || d.taxableBase > 0);

  useRegisterPrint(
    registerPrint,
    data
      ? {
          title: "VAT / tax",
          tiles: tiles.map((x) => ({ label: x.label, value: x.value })),
          sections: [
            {
              title: "Daily",
              columns: [{ label: "Day" }, { label: "Taxable sales", align: "right" }, { label: "VAT", align: "right" }],
              rows: activeDays.map((d) => [date(d.day), money(d.taxableBase), money(d.taxCollected)]),
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
      <p className="field-label mb-2">Daily</p>
      <ReportTable
        accent="var(--color-cobalt)"
        empty="No taxable sales in this range."
        columns={[
          { key: "day", label: "Day", render: (r) => date(r.day) },
          { key: "taxableBase", label: "Taxable sales", align: "right", render: (r) => money(r.taxableBase) },
          { key: "taxCollected", label: "VAT collected", align: "right", render: (r) => money(r.taxCollected) },
        ]}
        rows={activeDays}
      />
    </>
  );
}
