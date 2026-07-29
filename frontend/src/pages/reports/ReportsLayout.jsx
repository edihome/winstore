/**
 * ============================================================
 * File: ReportsLayout.jsx
 * Module: Reports
 *
 * Description:
 * The Reports shell: a report selector dropdown, a shared filter bar
 * (branch + date range) that persists across reports, and a Print button.
 * The selected report renders in the <Outlet/>; it reads the filters and
 * registers a print "model" through the Outlet context, which this layout
 * turns into a branded, printable document.
 * ============================================================
 */

import { useCallback, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useDialog, useToast } from "../../context/ToastContext";
import apiClient from "../../api/client";
import { useFormat, toDateInputValue } from "../../utils/format";
import { buildBrandedDocumentHtml, esc } from "../../utils/printDocument";

const REPORTS = [
  { path: "overview", label: "Branch overview" },
  { path: "profit", label: "Profit & margin" },
  { path: "sales-by-staff", label: "Sales by staff" },
  { path: "cash-up", label: "Payments & cash-up" },
  { path: "profit-loss", label: "Profit & Loss (P&L)" },
  { path: "expiry", label: "Expiry" },
  { path: "inventory-value", label: "Inventory valuation" },
  { path: "sales-by-category", label: "Sales by category" },
  { path: "branch-comparison", label: "Branch comparison" },
  { path: "tax", label: "VAT / tax" },
  { path: "discounts", label: "Discounts given" },
  { path: "customers", label: "Top customers" },
  { path: "receivables", label: "Receivables (owed to us)" },
];

const defaultFrom = () => toDateInputValue(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
const defaultTo = () => toDateInputValue(new Date());

export default function ReportsLayout() {
  const { user, activeBranch } = useAuth();
  const dialog = useDialog();
  const toast = useToast();
  const { date, dateTime } = useFormat();
  const navigate = useNavigate();
  const location = useLocation();
  const accessibleBranches = user?.accessibleBranches || [];

  // Full data export is the owner's own backup — super_admin (or developer) only.
  const canExport = user?.role === "super_admin" || user?.role === "developer";
  const [exporting, setExporting] = useState(false);
  const downloadExport = async () => {
    setExporting(true);
    try {
      const res = await apiClient.get("/data-export", { responseType: "blob" });
      const match = (res.headers["content-disposition"] || "").match(/filename="?([^"]+)"?/);
      const filename = match ? match[1] : `winstore-export-${toDateInputValue()}.xlsx`;
      const url = URL.createObjectURL(res.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success("Your data export has downloaded.");
    } catch {
      toast.error("Could not export your data. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  // Applied filters (persist across report switches — this layout stays
  // mounted while the Outlet child changes).
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [branchId, setBranchId] = useState(activeBranch.id);
  // Draft date inputs, committed on "Apply".
  const [fromInput, setFromInput] = useState(from);
  const [toInput, setToInput] = useState(to);
  // The print model the current report registered (or null).
  const [printModel, setPrintModel] = useState(null);

  const registerPrint = useCallback((model) => setPrintModel(model), []);

  const current = location.pathname.split("/reports/")[1]?.split("/")[0] || "overview";
  const reportBranch = accessibleBranches.find((b) => b.id === branchId) || activeBranch;

  const applyRange = (event) => {
    event.preventDefault();
    setFrom(fromInput);
    setTo(toInput);
  };

  const handlePrint = () => {
    if (!printModel) return;

    const kpisHtml = (printModel.tiles || []).length
      ? `<div class="kpis">${printModel.tiles
          .map((t) => `<div class="kpi"><div class="label">${esc(t.label)}</div><div class="value">${esc(String(t.value))}</div></div>`)
          .join("")}</div>`
      : "";

    const sectionsHtml = (printModel.sections || [])
      .map((sec) => {
        if (!sec.rows || sec.rows.length === 0) {
          return `<p class="section">${esc(sec.title)}</p><p>No data.</p>`;
        }
        const head = `<tr>${sec.columns.map((c) => `<th class="${c.align === "right" ? "num" : ""}">${esc(c.label)}</th>`).join("")}</tr>`;
        const body = sec.rows
          .map((r) => `<tr>${r.map((cell, i) => `<td class="${sec.columns[i].align === "right" ? "num" : ""}">${esc(String(cell))}</td>`).join("")}</tr>`)
          .join("");
        return `<p class="section">${esc(sec.title)}</p><table><thead>${head}</thead><tbody>${body}</tbody></table>`;
      })
      .join("");

    dialog.print(
      buildBrandedDocumentHtml({
        title: printModel.title,
        subtitle: `${reportBranch?.name || ""}${printModel.subtitle ? ` · ${printModel.subtitle}` : ` · ${date(from)} — ${date(to)}`}`,
        bodyHtml: kpisHtml + sectionsHtml,
        organization: user?.organization,
        branch: reportBranch,
        settings: user?.settings || {},
        footerNote: `Generated ${dateTime(new Date())}`,
      })
    );
  };

  const inputClass =
    "rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal";

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="field-label text-teal">Reports</span>
          <div className="mt-1">
            <select
              value={current}
              onChange={(event) => navigate(`/dashboard/reports/${event.target.value}`)}
              className="rounded border border-paper-line bg-white px-3 py-2 font-display text-lg font-semibold text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal"
              aria-label="Choose a report"
            >
              {REPORTS.map((r) => (
                <option key={r.path} value={r.path}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {canExport && (
          <button
            type="button"
            onClick={downloadExport}
            disabled={exporting}
            title="Download all your business data as an Excel workbook"
            className="btn-solid btn-solid-primary btn-solid-sm"
          >
            {exporting ? "Preparing…" : "⭳ Export data"}
          </button>
        )}
      </div>

      <form onSubmit={applyRange} className="mb-6 flex flex-wrap items-end gap-2">
        {accessibleBranches.length > 1 && (
          <div>
            <label htmlFor="reportBranch" className="field-label mb-1 block">
              Branch
            </label>
            <select id="reportBranch" value={branchId} onChange={(e) => setBranchId(e.target.value)} className={inputClass}>
              {accessibleBranches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="from" className="field-label mb-1 block">
            From
          </label>
          <input id="from" type="date" value={fromInput} onChange={(e) => setFromInput(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="to" className="field-label mb-1 block">
            To
          </label>
          <input id="to" type="date" value={toInput} onChange={(e) => setToInput(e.target.value)} className={inputClass} />
        </div>
        <button type="submit" className="btn-solid btn-solid-primary btn-solid-sm">
          Apply
        </button>
        <button type="button" onClick={handlePrint} disabled={!printModel} className="btn-chip btn-chip-neutral">
          🖨 Print
        </button>
      </form>

      <Outlet context={{ from, to, branchId, registerPrint }} />
    </div>
  );
}
