/**
 * ============================================================
 * File: OfflineBranchesPage.jsx
 * Module: Administration — Offline branches
 *
 * Description:
 * Where an owner turns their org into an offline-capable business: generate a
 * one-time enrollment code for a shop install, see the branches that have
 * enrolled, and revoke any of them (which kills its node token immediately).
 * Generating the first code opts the org into offline sync; a plain cloud org
 * that never opens this page pays nothing for the sync engine.
 * ============================================================
 */

import { useEffect, useState } from "react";
import apiClient from "../api/client";
import { useToast } from "../context/ToastContext";
import { useFormat } from "../utils/format";
import EmptyState from "../components/EmptyState";
import StatusChip from "../components/StatusChip";
import Drawer from "../components/Drawer";
import { TableSkeleton } from "../components/Skeleton";

const ACCENT_STYLE = { "--card-accent": "var(--color-cobalt)", "--card-glow": "rgba(53, 80, 143, 0.35)" };
const inputClass =
  "w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal";

export default function OfflineBranchesPage() {
  const toast = useToast();
  const { dateTime } = useFormat();
  const [branches, setBranches] = useState([]);
  const [rejections, setRejections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [orgBranches, setOrgBranches] = useState([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [name, setName] = useState("");
  const [branchId, setBranchId] = useState("");
  const [generating, setGenerating] = useState(false);
  const [issued, setIssued] = useState(null); // { code, expiresAt } — shown once
  const [copied, setCopied] = useState(false);

  const loadBranches = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [b, r, br] = await Promise.all([apiClient.get("/sync/branches"), apiClient.get("/sync/rejections"), apiClient.get("/branches")]);
      setBranches(b.data.data);
      setRejections(r.data.data);
      setOrgBranches(br.data.data);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // A connected branch that hasn't checked in for over a week needs attention
  // (and, while it stays active, holds back outbox cleanup on the hub).
  // `now` is captured once at mount (a render-pure reference point).
  const [now] = useState(() => Date.now());
  const isStale = (node) =>
    node.is_active && node.last_seen_at && now - new Date(node.last_seen_at).getTime() > 7 * 24 * 3600 * 1000;

  useEffect(() => {
    loadBranches();
  }, []);

  const openGenerate = () => {
    setName("");
    setBranchId("");
    setIssued(null);
    setCopied(false);
    setDrawerOpen(true);
  };

  const generate = async (event) => {
    event.preventDefault();
    setGenerating(true);
    try {
      const res = await apiClient.post("/sync/branches/code", { name: name.trim() || undefined, branchId: branchId || undefined });
      setIssued(res.data.data);
      toast.success("Enrollment code generated.");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(issued.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the code is on screen to copy manually */
    }
  };

  const revoke = async (node) => {
    if (!window.confirm(`Disconnect “${node.name || "this branch"}”? It will stop syncing until re-enrolled.`)) {
      return;
    }
    try {
      await apiClient.post(`/sync/branches/${node.id}/revoke`);
      toast.success("Branch disconnected.");
      loadBranches();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="field-label text-cobalt">Administration</span>
          <h2 className="font-display text-xl font-semibold text-ink">Offline branches</h2>
          <p className="mt-0.5 max-w-xl text-sm text-ink-soft">
            Let a shop keep trading without internet and reconcile with this account when it reconnects. Generate a code, enter it once in the shop’s install, and it’s linked.
          </p>
        </div>
        <button type="button" onClick={openGenerate} className="btn-solid btn-solid-primary btn-solid-sm">
          + Generate enrollment code
        </button>
      </div>

      {loadError && (
        <p role="alert" className="mb-4 rounded border border-clay/30 bg-clay-soft px-3 py-2 text-sm text-clay">
          {loadError}
        </p>
      )}

      {loading && branches.length === 0 ? (
        <TableSkeleton rows={4} />
      ) : branches.length === 0 ? (
        <EmptyState
          icon="🛰️"
          title="No branches linked yet"
          hint="Generate an enrollment code and enter it in a shop install to connect your first offline branch."
          actionLabel="Generate enrollment code"
          onAction={openGenerate}
        />
      ) : (
        <div className="panel" style={ACCENT_STYLE}>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-paper-line bg-paper">
              <tr>
                <th className="px-4 py-2 font-medium text-ink-soft">Branch</th>
                <th className="px-4 py-2 font-medium text-ink-soft">Status</th>
                <th className="px-4 py-2 font-medium text-ink-soft">Sync</th>
                <th className="px-4 py-2 font-medium text-ink-soft">Last seen</th>
                <th className="px-4 py-2 font-medium text-ink-soft">Enrolled</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {branches.map((node) => (
                <tr key={node.id} className="border-b border-paper-line last:border-0">
                  <td className="px-4 py-2 text-ink">{node.name || "Branch"}</td>
                  <td className="px-4 py-2">
                    {node.is_active ? <StatusChip tone="success">Connected</StatusChip> : <StatusChip tone="danger">Disconnected</StatusChip>}
                  </td>
                  <td className="px-4 py-2">
                    {!node.is_active ? (
                      <span className="text-ink-soft">—</span>
                    ) : node.behind > 0 ? (
                      <span className="text-amber-dark">{node.behind} behind</span>
                    ) : (
                      <span className="text-ink-soft">Up to date</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-ink-soft">
                    {node.last_seen_at ? dateTime(node.last_seen_at) : "—"}
                    {isStale(node) && <StatusChip tone="warning">Stale</StatusChip>}
                  </td>
                  <td className="px-4 py-2 text-ink-soft">{node.created_at ? dateTime(node.created_at) : "—"}</td>
                  <td className="px-4 py-2 text-right">
                    {node.is_active && (
                      <button type="button" onClick={() => revoke(node)} className="btn-link text-clay hover:underline">
                        Disconnect
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rejections.length > 0 && (
        <div className="mt-6">
          <p className="field-label mb-2 text-clay">Changes the hub couldn’t accept</p>
          <p className="mb-3 max-w-2xl text-sm text-ink-soft">
            Reference data (products, prices, staff, settings) is managed here and pushed out — a branch can’t change it. Anything a branch couldn’t sync (a rejected reference edit, or a row that failed to apply) is listed here so it never silently disappears.
          </p>
          <div className="panel" style={{ "--card-accent": "var(--color-clay)", "--card-glow": "rgba(163, 69, 43, 0.3)" }}>
            <table className="w-full text-left text-sm">
              <thead className="border-b border-paper-line bg-paper">
                <tr>
                  <th className="px-4 py-2 font-medium text-ink-soft">Branch</th>
                  <th className="px-4 py-2 font-medium text-ink-soft">Change</th>
                  <th className="px-4 py-2 font-medium text-ink-soft">Reason</th>
                  <th className="px-4 py-2 font-medium text-ink-soft">When</th>
                </tr>
              </thead>
              <tbody>
                {rejections.slice(0, 20).map((r) => (
                  <tr key={r.id} className="border-b border-paper-line last:border-0">
                    <td className="px-4 py-2 text-ink">{r.node_name || "A branch"}</td>
                    <td className="px-4 py-2 text-ink-soft">{r.table_name.replace(/_/g, " ")}</td>
                    <td className="px-4 py-2 text-ink-soft">{r.reason}</td>
                    <td className="px-4 py-2 text-ink-soft">{dateTime(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Enroll an offline branch">
        {!issued ? (
          <form onSubmit={generate} className="space-y-4">
            <p className="text-sm text-ink-soft">
              Give this branch a name so you can recognize it later, then generate a one-time code. You’ll enter the code in the shop’s Winstore install to link it.
            </p>
            <div>
              <label htmlFor="branchName" className="field-label mb-1 block">
                Branch name <span className="text-ink-faint">(optional)</span>
              </label>
              <input id="branchName" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ikeja Shop" className={inputClass} />
            </div>
            <div>
              <label htmlFor="branchId" className="field-label mb-1 block">
                Bind to branch <span className="text-ink-faint">(recommended)</span>
              </label>
              <select id="branchId" value={branchId} onChange={(e) => setBranchId(e.target.value)} className={inputClass}>
                <option value="">Any branch (not recommended)</option>
                {orgBranches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-ink-soft">
                Binding locks this install to one branch — it can then only sync that branch’s records, so it can’t affect another branch even if compromised.
              </p>
            </div>
            <button type="submit" disabled={generating} className="btn-solid btn-solid-primary">
              {generating ? "Generating…" : "Generate code"}
            </button>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="rounded border border-signal/30 bg-signal-soft px-3 py-2 text-sm text-ink">
              This code is shown <strong>once</strong> and expires soon. Enter it in the shop install now — you can always generate a new one.
            </div>
            <div>
              <span className="field-label mb-1 block">Enrollment code</span>
              <div className="flex items-stretch gap-2">
                <code className="flex-1 break-all rounded border border-paper-line bg-paper px-3 py-2 font-mono text-xs text-ink">{issued.code}</code>
                <button type="button" onClick={copyCode} className="btn-solid btn-solid-primary btn-solid-sm shrink-0">
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
            {issued.expiresAt && <p className="text-xs text-ink-soft">Expires {dateTime(issued.expiresAt)}.</p>}
            <button
              type="button"
              onClick={() => {
                setDrawerOpen(false);
                loadBranches();
              }}
              className="btn-link btn-link-primary"
            >
              Done
            </button>
          </div>
        )}
      </Drawer>
    </div>
  );
}
