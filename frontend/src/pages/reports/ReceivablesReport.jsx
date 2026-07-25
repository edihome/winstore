/** Receivables — who owes the business, from the customer credit ledger. */
import { useFormat } from "../../utils/format";
import { TileSkeleton } from "../../components/Skeleton";
import { ReportTiles, ReportTable, useReports, useReportData, useRegisterPrint } from "./reportsKit";

export default function ReceivablesReport() {
  const { registerPrint } = useReports();
  const { money, date } = useFormat();
  // A current snapshot — receivables ignore the date range.
  const { data, loading, error } = useReportData("/reports/receivables", {});

  const customers = data?.customers || [];
  const tiles = data
    ? [
        { label: "Customers owing", value: customers.length, initial: "C", tone: "clay" },
        { label: "Total outstanding", value: money(data.totalOutstanding), initial: "₦", tone: "clay" },
      ]
    : [];

  useRegisterPrint(
    registerPrint,
    data
      ? {
          title: "Receivables (owed to us)",
          tiles: tiles.map((x) => ({ label: x.label, value: x.value })),
          sections: [
            {
              title: "Outstanding balances",
              columns: [{ label: "Customer" }, { label: "Phone" }, { label: "Balance", align: "right" }, { label: "Last activity" }],
              rows: customers.map((c) => [c.name, c.phone || "—", money(c.balance), date(c.lastActivity)]),
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
      <p className="field-label mb-2">Outstanding customer balances</p>
      <ReportTable
        accent="var(--color-clay)"
        empty="No outstanding balances — nobody owes on account right now."
        columns={[
          { key: "name", label: "Customer" },
          { key: "phone", label: "Phone", render: (r) => r.phone || "—" },
          { key: "balance", label: "Balance", align: "right", render: (r) => money(r.balance) },
          { key: "lastActivity", label: "Last activity", render: (r) => date(r.lastActivity) },
        ]}
        rows={customers}
      />
    </>
  );
}
