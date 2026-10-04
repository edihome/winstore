/**
 * ============================================================
 * File: BranchesPage.jsx
 * Module: Administration
 *
 * Description:
 * Manage branches in the app's modern list pattern: full-width table,
 * create/edit in a slide-over drawer, toasts for outcomes. There's no
 * delete — a branch already referenced by sales, stock, staff, etc.
 * can't be safely removed, same "deactivate, don't delete" reasoning
 * as Suppliers/Staff.
 * ============================================================
 */

import { useEffect, useState } from "react";
import apiClient from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import BulkImportControls from "../components/BulkImportControls";
import Drawer from "../components/Drawer";
import BranchSetupCode from "../components/BranchSetupCode";
import EmptyState from "../components/EmptyState";
import StatusChip from "../components/StatusChip";
import { TableSkeleton } from "../components/Skeleton";
import { useTableKit, SortableTh, TablePager } from "../components/tableKit";
import { buildBranchPayload, readBranchSetupCode } from "../utils/branchSetup";

const initialForm = { name: "", code: "", isHeadquarters: false };

// Administration's card/panel accent.
const ACCENT_STYLE = { "--card-accent": "var(--color-cobalt)", "--card-glow": "rgba(53, 80, 143, 0.35)" };

export default function BranchesPage() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("branches", "create");
  const canEdit = hasPermission("branches", "edit");
  const toast = useToast();
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupBranch, setSetupBranch] = useState(null);
  const [issued, setIssued] = useState(null);
  const [setupError, setSetupError] = useState("");
  const [generatingId, setGeneratingId] = useState(null);

  const kit = useTableKit(branches, { pageSize: 12, defaultSort: { key: "name", dir: "asc" } });

  const loadBranches = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await apiClient.get("/branches");
      setBranches(response.data.data);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBranches();
  }, []);

  const handleChange = (event) => {
    const { name, type, checked, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
  };

  const openCreate = () => {
    if (!canCreate) return;
    setEditingId(null);
    setForm(initialForm);
    setFormError("");
    setDrawerOpen(true);
  };

  const openEdit = (branch) => {
    if (!canEdit) return;
    setEditingId(branch.id);
    setForm({ name: branch.name, code: branch.code, isHeadquarters: branch.isHeadquarters });
    setFormError("");
    setDrawerOpen(true);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting || (editingId ? !canEdit : !canCreate)) return;
    setFormError("");
    try {
      const payload = buildBranchPayload(form, { editing: Boolean(editingId) });
      setSubmitting(true);
      if (editingId) {
        await apiClient.patch(`/branches/${editingId}`, payload);
        toast.success(`${payload.name} updated.`);
      } else {
        const response = await apiClient.post("/branches", payload);
        const branch = response.data.data;
        const code = readBranchSetupCode(branch);
        setSetupBranch(branch);
        setIssued(code);
        setSetupError(code ? "" : "The branch was added, but its setup code was not returned. Generate a new code below.");
        setSetupOpen(true);
        toast.success(`${payload.name} added.`);
      }
      setDrawerOpen(false);
      await loadBranches();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const generateSetupCode = async (branch) => {
    if (!canCreate || generatingId || !branch?.id) return;
    setSetupBranch(branch);
    setIssued(null);
    setSetupError("");
    setSetupOpen(true);
    setGeneratingId(branch.id);
    try {
      const response = await apiClient.post(`/branches/${branch.id}/setup-code`, {});
      const code = readBranchSetupCode(response.data.data);
      if (!code) throw new Error("The server did not return a branch setup code. Please try again.");
      setIssued(code);
      toast.success("Branch setup code generated.");
    } catch (err) {
      setSetupError(err.message);
    } finally {
      setGeneratingId(null);
    }
  };

  const inputClass =
    "w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal";

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="field-label text-cobalt">Administration</span>
          <h2 className="font-display text-xl font-semibold text-ink">Branches</h2>
          <p className="mt-1 max-w-xl text-sm text-ink-soft">Add a branch to receive its desktop setup code. The short reference below identifies the branch in your records.</p>
        </div>
        <div className="flex items-center gap-2">
          <BulkImportControls resource="branches" label="branches" onImported={loadBranches} />
          {canCreate && <button type="button" onClick={openCreate} className="btn-solid btn-solid-primary btn-solid-sm">
            + Add branch
          </button>}
        </div>
      </div>

      {loadError && (
        <p role="alert" className="mb-4 rounded border border-clay/30 bg-clay-soft px-3 py-2 text-sm text-clay">
          {loadError}
        </p>
      )}

      {loading && branches.length === 0 ? (
        <TableSkeleton rows={5} />
      ) : branches.length === 0 ? (
        <EmptyState
          icon="🏬"
          title="No branches yet"
          hint="Each branch keeps its own stock, sales, and staff assignments."
          actionLabel={canCreate ? "Add your first branch" : undefined}
          onAction={canCreate ? openCreate : undefined}
        />
      ) : (
        <>
          <div className="panel" style={ACCENT_STYLE}>
            <table className="w-full text-left text-sm">
              <thead className="border-b border-paper-line bg-paper">
                <tr>
                  <SortableTh kit={kit} sortKey="name">Name</SortableTh>
                  <SortableTh kit={kit} sortKey="code">Reference</SortableTh>
                  <th className="px-4 py-2 font-medium text-ink-soft">Headquarters</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {kit.visible.map((branch) => (
                  <tr key={branch.id} className="border-b border-paper-line last:border-0">
                    <td className="px-4 py-2 text-ink">{branch.name}</td>
                    <td className="px-4 py-2 font-mono text-xs text-ink-soft">{branch.code}</td>
                    <td className="px-4 py-2">
                      {branch.isHeadquarters ? <StatusChip tone="info">HQ</StatusChip> : <span className="text-ink-soft">—</span>}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {canCreate && <button type="button" disabled={Boolean(generatingId)} onClick={() => generateSetupCode(branch)} className="btn-link btn-link-primary mr-3">
                        Generate setup code
                      </button>}
                      {canEdit && <button type="button" onClick={() => openEdit(branch)} className="btn-link btn-link-primary">
                        Edit
                      </button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePager kit={kit} noun="branches" />
        </>
      )}

      <Drawer open={drawerOpen && (editingId ? canEdit : canCreate)} onClose={() => !submitting && setDrawerOpen(false)} title={editingId ? "Edit branch" : "Add a branch"}>
        <form onSubmit={handleSubmit} className="space-y-4">
          {!editingId && <p className="text-sm text-ink-soft">A branch reference and one-time desktop setup code will be generated automatically.</p>}
          {formError && <p role="alert" className="rounded border border-clay/30 bg-clay-soft px-3 py-2 text-sm text-clay">{formError}</p>}
          <div>
            <label htmlFor="name" className="field-label mb-1 block">
              Name
            </label>
            <input id="name" name="name" required autoFocus maxLength={255} value={form.name} onChange={handleChange} className={inputClass} />
          </div>
          {editingId && <div>
            <label htmlFor="code" className="field-label mb-1 block">
              Reference
            </label>
            <input id="code" name="code" required value={form.code} onChange={handleChange} className={inputClass} />
          </div>}
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              name="isHeadquarters"
              checked={form.isHeadquarters}
              onChange={handleChange}
              className="h-4 w-4 rounded border-paper-line text-teal focus:ring-teal"
            />
            Headquarters
          </label>
          <button type="submit" disabled={submitting} className="btn-solid btn-solid-primary">
            {submitting ? "Saving…" : editingId ? "Save changes" : "Add branch"}
          </button>
        </form>
      </Drawer>

      <Drawer open={setupOpen && canCreate} onClose={() => !generatingId && setSetupOpen(false)} title="Set up the branch desktop" subtitle={setupBranch?.name}>
        {generatingId ? <p role="status" className="text-sm text-ink-soft">Generating a new branch setup code...</p> : (
          <div className="space-y-4">
            {setupError && <p role="alert" className="rounded border border-clay/30 bg-clay-soft px-3 py-2 text-sm text-clay">{setupError}</p>}
            {issued && <BranchSetupCode key={issued.setupCode} issued={issued} branchName={setupBranch?.name} />}
            <p className="text-xs text-ink-soft">Generating another code replaces any unused setup codes for this branch.</p>
            <div className="flex flex-wrap items-center gap-4">
              <button type="button" onClick={() => generateSetupCode(setupBranch)} className="btn-link btn-link-primary">Generate new code</button>
              <button type="button" onClick={() => setSetupOpen(false)} className="btn-solid btn-solid-primary btn-solid-sm">Done</button>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
