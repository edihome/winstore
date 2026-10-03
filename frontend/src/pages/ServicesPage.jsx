/**
 * ============================================================
 * File: ServicesPage.jsx
 * Module: Services (Catalog)
 *
 * Description:
 * Service catalog in the app's modern list pattern: full-width
 * sortable, paginated table; "+ Add service" in a slide-over drawer;
 * toasts for outcomes; prices in the organization's own currency.
 * Any service a business offers — a haircut, a house cleaning, a
 * consulting hour — not tied to any one industry.
 * ============================================================
 */

import { useState } from "react";
import apiClient from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useFormat } from "../utils/format";
import BulkImportControls from "../components/BulkImportControls";
import DeleteButton from "../components/DeleteButton";
import Drawer from "../components/Drawer";
import EmptyState from "../components/EmptyState";
import StatusChip from "../components/StatusChip";
import ConfirmAction from "../components/ConfirmAction";
import { TableSkeleton } from "../components/Skeleton";
import { useServerTable, SortableTh, TablePager } from "../components/tableKit";

const initialForm = { name: "", description: "", durationMinutes: "", price: "" };

// Services' card/panel accent (shared with AppointmentsPage).
const ACCENT_STYLE = { "--card-accent": "var(--color-berry)", "--card-glow": "rgba(156, 56, 101, 0.35)" };

export default function ServicesPage() {
  const { user, hasPermission } = useAuth();
  const canCreate = hasPermission("services", "create");
  const canEdit = hasPermission("services", "edit");
  const toast = useToast();
  const { money, currency } = useFormat();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);

  const kit = useServerTable(
    ({ page, limit, sortKey, sortDir }) => apiClient.get("/services", { params: { page, limit, sortKey, sortDir } }),
    { pageSize: 12, defaultSort: { key: "name", dir: "asc" } }
  );

  const handleChange = (event) => {
    setForm((prev) => ({ ...prev, [event.target.name]: event.target.value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await apiClient.post("/services", {
        name: form.name,
        description: form.description || undefined,
        durationMinutes: Number(form.durationMinutes),
        price: Number(form.price),
      });
      toast.success(`${form.name} added to the catalog.`);
      setForm(initialForm);
      setDrawerOpen(false);
      kit.reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (service) => {
    try {
      await apiClient.patch(`/services/${service.id}`, { isActive: !service.isActive });
      toast.success(`${service.name} ${service.isActive ? "deactivated" : "activated"}.`);
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
          <span className="field-label text-berry">Services</span>
          <h2 className="font-display text-xl font-semibold text-ink">Service catalog</h2>
        </div>
        <div className="flex items-center gap-2">
          <BulkImportControls resource="services" label="services" onImported={kit.reload} />
          {canCreate && <button type="button" onClick={() => setDrawerOpen(true)} className="btn-solid btn-solid-primary btn-solid-sm">
            + Add service
          </button>}
        </div>
      </div>

      {kit.error && (
        <p role="alert" className="mb-4 rounded border border-clay/30 bg-clay-soft px-3 py-2 text-sm text-clay">
          {kit.error}
        </p>
      )}

      {kit.loading && kit.visible.length === 0 ? (
        <TableSkeleton rows={6} />
      ) : kit.total === 0 ? (
        <EmptyState
          icon="✂️"
          title="No services yet"
          hint="Services you add here become bookable as appointments and billable at checkout."
          actionLabel={canCreate ? "Add your first service" : undefined}
          onAction={canCreate ? () => setDrawerOpen(true) : undefined}
        />
      ) : (
        <>
          <div className="panel" style={ACCENT_STYLE}>
            <table className="w-full text-left text-sm">
              <thead className="border-b border-paper-line bg-paper">
                <tr>
                  <SortableTh kit={kit} sortKey="name">Name</SortableTh>
                  <SortableTh kit={kit} sortKey="durationMinutes">Duration</SortableTh>
                  <SortableTh kit={kit} sortKey="price">Price</SortableTh>
                  <th className="px-4 py-2 font-medium text-ink-soft">Status</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {kit.visible.map((service) => (
                  <tr key={service.id} className="border-b border-paper-line last:border-0">
                    <td className="px-4 py-2 text-ink">
                      {service.name}
                      {service.description && (
                        <span className="block text-xs text-ink-soft">{service.description}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-ink-soft">{service.durationMinutes} min</td>
                    <td className="px-4 py-2 font-mono text-xs text-ink">{money(service.price)}</td>
                    <td className="px-4 py-2">
                      <StatusChip tone={service.isActive ? "success" : "neutral"}>
                        {service.isActive ? "active" : "inactive"}
                      </StatusChip>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        {canEdit && (service.isActive ? (
                          <ConfirmAction label="Deactivate" onConfirm={() => toggleActive(service)} />
                        ) : (
                          <button type="button" onClick={() => toggleActive(service)} className="btn-link btn-link-success">
                            Activate
                          </button>
                        ))}
                        {user?.role === "developer" && (
                          <DeleteButton resource="services" id={service.id} label={service.name} onDeleted={kit.reload} />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePager kit={kit} noun="services" />
        </>
      )}

      <Drawer open={canCreate && drawerOpen} onClose={() => setDrawerOpen(false)} title="Add a service">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="name" className="field-label mb-1 block">
              Name
            </label>
            <input
              id="name"
              name="name"
              required
              autoFocus
              value={form.name}
              onChange={handleChange}
              placeholder="Haircut & Style, House Cleaning, Consulting Hour…"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="description" className="field-label mb-1 block">
              Description <span className="normal-case text-ink-soft">(optional)</span>
            </label>
            <input id="description" name="description" value={form.description} onChange={handleChange} className={inputClass} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="durationMinutes" className="field-label mb-1 block">
                Duration (min)
              </label>
              <input
                id="durationMinutes"
                name="durationMinutes"
                type="number"
                min="5"
                required
                value={form.durationMinutes}
                onChange={handleChange}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="price" className="field-label mb-1 block">
                Price ({currency})
              </label>
              <input
                id="price"
                name="price"
                type="number"
                min="0"
                step="0.01"
                required
                value={form.price}
                onChange={handleChange}
                className={inputClass}
              />
            </div>
          </div>
          <button type="submit" disabled={submitting} className="btn-solid btn-solid-primary">
            {submitting ? "Adding…" : "Add service"}
          </button>
        </form>
      </Drawer>
    </div>
  );
}
