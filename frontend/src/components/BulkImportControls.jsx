/**
 * ============================================================
 * File: BulkImportControls.jsx
 * Module: Shared Components
 *
 * Description:
 * "Download template" + "Upload file" pair used on every page that
 * supports bulk Excel import — download a pre-formatted .xlsx with
 * the right columns and an example row, fill it in, upload it back.
 * Each row is validated and created exactly the way the manual form
 * on that page would (see backend/src/utils/bulkImportHandlers.js),
 * so a row that's wrong shows up as a per-row error here instead of
 * silently succeeding with bad data.
 * ============================================================
 */

import { useRef, useState } from "react";
import apiClient from "../api/client";
import { useAuth } from "../context/AuthContext";

export default function BulkImportControls({ resource, label, onImported }) {
  const { hasPermission } = useAuth();
  const canImport = hasPermission(resource.replaceAll("-", "_"), "create");
  const fileInputRef = useRef(null);
  // Collapsed to a single chip until asked for — importing is an
  // occasional task and shouldn't permanently occupy a card of every
  // list page.
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const downloadTemplate = async () => {
    setError("");
    setDownloading(true);
    try {
      const response = await apiClient.get(`/${resource}/import-template`, { responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${resource}-template.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading(false);
    }
  };

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError("");
    setResult(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await apiClient.post(`/${resource}/import`, formData);
      setResult(response.data.data);
      if (response.data.data.createdCount > 0) {
        await onImported?.();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  };

  if (!canImport) return null;

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-chip btn-chip-neutral">
        ⇪ Import from Excel
      </button>
    );
  }

  return (
    <div className="ledger-card space-y-3 py-5 pr-5">
      <div className="flex items-start justify-between gap-2">
        <p className="field-label">Bulk import {label || resource}</p>
        <button type="button" onClick={() => setOpen(false)} className="btn-link btn-link-neutral">
          Close
        </button>
      </div>
      <p className="text-xs text-ink-soft">
        Download the template, fill in one row per {label ? label.replace(/s$/, "") : "record"}, and upload it
        back — instead of adding them one at a time.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={downloadTemplate} disabled={downloading} className="btn-chip btn-chip-primary">
          {downloading ? "Downloading…" : "Download template"}
        </button>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="btn-chip btn-chip-neutral"
        >
          {uploading ? "Uploading…" : "Upload file"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {error && (
        <p className="rounded border border-clay/30 bg-clay-soft px-3 py-2 text-sm text-clay">{error}</p>
      )}

      {result && (
        <div className="space-y-2 text-sm">
          <p className={result.createdCount > 0 ? "text-signal" : "text-clay"}>
            Imported {result.createdCount} of {result.total} row{result.total === 1 ? "" : "s"}.
          </p>

          {result.created.some((entry) => entry.result?.temporaryPassword) && (
            <div className="panel">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-paper-line bg-paper">
                  <tr>
                    <th className="px-3 py-1.5 font-medium text-ink-soft">Row</th>
                    <th className="px-3 py-1.5 font-medium text-ink-soft">Email</th>
                    <th className="px-3 py-1.5 font-medium text-ink-soft">Temporary password</th>
                  </tr>
                </thead>
                <tbody>
                  {result.created
                    .filter((entry) => entry.result?.temporaryPassword)
                    .map((entry) => (
                      <tr key={entry.row} className="border-b border-paper-line last:border-0">
                        <td className="px-3 py-1.5 text-ink-soft">{entry.row}</td>
                        <td className="px-3 py-1.5 text-ink">{entry.result.email}</td>
                        <td className="px-3 py-1.5 font-mono text-ink">{entry.result.temporaryPassword}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <p className="border-t border-paper-line px-3 py-1.5 text-xs text-ink-soft">
                Share these with each new hire — they'll be forced to set their own password at first login.
              </p>
            </div>
          )}

          {result.failed.length > 0 && (
            <div className="overflow-hidden rounded border border-clay/30 bg-white">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-paper-line bg-clay-soft">
                  <tr>
                    <th className="px-3 py-1.5 font-medium text-clay">Row</th>
                    <th className="px-3 py-1.5 font-medium text-clay">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {result.failed.map((entry) => (
                    <tr key={entry.row} className="border-b border-paper-line last:border-0">
                      <td className="px-3 py-1.5 text-ink-soft">{entry.row}</td>
                      <td className="px-3 py-1.5 text-clay">{entry.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
