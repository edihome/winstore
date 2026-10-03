/**
 * ============================================================
 * File: SuppliersPage.jsx
 * Module: Purchasing
 *
 * Description:
 * Supplier directory in the app's modern list pattern: full-width
 * sortable, paginated table with search; create/edit in a slide-over
 * drawer; toasts for outcomes; two-step confirm before deactivating.
 * Purchases (purchase orders) are placed against active suppliers on
 * the Purchases page.
 * ============================================================
 */

import { useEffect, useState } from "react";
import apiClient from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import BulkImportControls from "../components/BulkImportControls";
import DeleteButton from "../components/DeleteButton";
import Drawer from "../components/Drawer";
import EmptyState from "../components/EmptyState";
import StatusChip from "../components/StatusChip";
import ConfirmAction from "../components/ConfirmAction";
import { TableSkeleton } from "../components/Skeleton";
import { useServerTable, SortableTh, TablePager } from "../components/tableKit";

const initialForm = { name: "", email: "", phone: "" };

// Purchasing's card/panel accent (shared with PurchasesPage/ExpensesPage —
// all three represent money leaving the business).
const ACCENT_STYLE = { "--card-accent": "var(--color-clay)", "--card-glow": "rgba(163, 69, 43, 0.35)" };

export default function SuppliersPage() {
  const { user, hasPermission } = useAuth();
  const canCreate = hasPermission("suppliers", "create");
  const canEdit = hasPermission("suppliers", "edit");
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);

  const kit = useServerTable(
    ({ page, limit, sortKey, sortDir, search: q }) =>
      apiClient.get("/suppliers", {
        params: { page, limit, sortKey, sortDir, search: q || undefined, includeInactive: true },
      }),
    { pageSize: 12, defaultSort: { key: "name", dir: "asc" }, search: debouncedSearch }
  );

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const openCreate = () => {
    if (!canCreate) return;
    setEditingId(null);
    setForm(initialForm);
    setDrawerOpen(true);
  };

  const openEdit = (supplier) => {
    if (!canEdit) return;
    setEditingId(supplier.id);
    setForm({ name: supplier.name, email: supplier.email, phone: supplier.phone });
    setDrawerOpen(true);
  };

  const handleChange = (event) => {
    setForm((prev) => ({ ...prev, [event.target.name]: event.target.value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (editingId ? !canEdit : !canCreate) return;
    setSubmitting(true);
    try {
      if (editingId) {
        await apiClient.patch(`/suppliers/${editingId}`, form);
        toast.success(`${form.name} updated.`);
      } else {
        await apiClient.post("/suppliers", form);
        toast.success(`${form.name} added.`);
      }
      setDrawerOpen(false);
      kit.reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (supplier) => {
    if (!canEdit) return;
    try {
      await apiClient.patch(`/suppliers/${supplier.id}`, {
        status: supplier.status === "active" ? "inactive" : "active",
      });
      toast.success(`${supplier.name} ${supplier.status === "active" ? "deactivated" : "activated"}.`);
      kit.reload();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const inputClass =
    "w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal";

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="field-label text-clay">Purchasing</span>
          <h2 className="font-display text-xl font-semibold text-ink">Suppliers</h2>
        </div>
        <div className="flex items-center gap-2">
          <BulkImportControls resource="suppliers" label="suppliers" onImported={() => kit.reload()} />
          {canCreate && <button type="button" onClick={openCreate} className="btn-solid btn-solid-primary btn-solid-sm">
            + Add supplier
          </button>}
        </div>
      </div>

      {kit.error && (
        <p role="alert" className="mb-4 rounded border border-clay/30 bg-clay-soft px-3 py-2 text-sm text-clay">
          {kit.error}
        </p>
      )}

      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search by name or email…"
        aria-label="Search suppliers"
        className={`mb-3 max-w-md ${inputClass}`}
      />

      {kit.loading && kit.visible.length === 0 ? (
        <TableSkeleton rows={8} />
      ) : kit.total === 0 ? (
        search ? (
          <EmptyState icon="🔍" title="No suppliers match your search" hint="Try a different name or email." />
        ) : (
          <EmptyState
            icon="🚚"
            title="No suppliers yet"
            hint="Purchase orders on the Purchases page are placed against suppliers you add here."
            actionLabel={canCreate ? "Add your first supplier" : undefined}
            onAction={canCreate ? openCreate : undefined}
          />
        )
      ) : (
        <>
          <div className="panel" style={ACCENT_STYLE}>
            <table className="w-full text-left text-sm">
              <thead className="border-b border-paper-line bg-paper">
                <tr>
                  <SortableTh kit={kit} sortKey="name">Name</SortableTh>
                  <SortableTh kit={kit} sortKey="email" className="hidden sm:table-cell">Email</SortableTh>
                  <th className="px-4 py-2 font-medium text-ink-soft">Phone</th>
                  <SortableTh kit={kit} sortKey="status">Status</SortableTh>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {kit.visible.map((supplier) => (
                  <tr key={supplier.id} className="border-b border-paper-line last:border-0">
                    <td className="px-4 py-2 text-ink">{supplier.name}</td>
                    <td className="hidden px-4 py-2 text-ink-soft sm:table-cell">{supplier.email}</td>
                    <td className="px-4 py-2 font-mono text-xs text-ink-soft">{supplier.phone}</td>
                    <td className="px-4 py-2">
                      <StatusChip tone={supplier.status === "active" ? "success" : "neutral"}>
                        {supplier.status}
                      </StatusChip>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        {canEdit && <button type="button" onClick={() => openEdit(supplier)} className="btn-link btn-link-primary">
                          Edit
                        </button>}
                        {canEdit && (supplier.status === "active" ? (
                          <ConfirmAction label="Deactivate" onConfirm={() => toggleActive(supplier)} />
                        ) : (
                          <button type="button" onClick={() => toggleActive(supplier)} className="btn-link btn-link-success">
                            Activate
                          </button>
                        ))}
                        {user?.role === "developer" && (
                          <DeleteButton
                            resource="suppliers"
                            id={supplier.id}
                            label={supplier.name}
                            onDeleted={() => kit.reload()}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePager kit={kit} noun="suppliers" />
        </>
      )}

      <Drawer
        open={drawerOpen && (editingId ? canEdit : canCreate)}
        onClose={() => setDrawerOpen(false)}
        title={editingId ? "Edit supplier" : "Add a supplier"}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="name" className="field-label mb-1 block">
              Name
            </label>
            <input id="name" name="name" required autoFocus value={form.name} onChange={handleChange} className={inputClass} />
          </div>
          <div>
            <label htmlFor="email" className="field-label mb-1 block">
              Email
            </label>
            <input id="email" name="email" type="email" required value={form.email} onChange={handleChange} className={inputClass} />
          </div>
          <div>
            <label htmlFor="phone" className="field-label mb-1 block">
              Phone
            </label>
            <input id="phone" name="phone" required value={form.phone} onChange={handleChange} className={inputClass} />
          </div>
          <button type="submit" disabled={submitting} className="btn-solid btn-solid-primary">
            {submitting ? "Saving…" : editingId ? "Save changes" : "Add supplier"}
          </button>
        </form>
      </Drawer>
    </div>
  );
}
