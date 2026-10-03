/**
 * ============================================================
 * File: RolesPage.jsx
 * Module: Administration
 *
 * Description:
 * Create and edit CUSTOM roles with a fine-grained permission matrix: a
 * checkbox per action (View / Create / Edit / Delete, plus a few specials
 * like Sales → Refund and Inventory → Stock Adjustment) within each module.
 * The named access tiers (Staff / Supervisor / Admin / Super Admin) are
 * assigned on the Staff page and aren't listed here.
 * ============================================================
 */

import { useEffect, useState } from "react";
import apiClient from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { TableSkeleton } from "../components/Skeleton";

// Names of the seeded access tiers — hidden here, since they're managed as
// tiers on the Staff page, not edited as custom roles.
const TIER_NAMES = ["staff", "supervisor", "admin", "super_admin"];

const initialForm = { name: "", description: "", permissions: [] };

// Administration's card/panel accent (shared with StaffPage, BranchesPage,
// ChangePasswordPage, OrganizationsPage). See index.css's
// .ledger-card/.panel --card-accent/--card-glow.
const ACCENT_STYLE = { "--card-accent": "var(--color-cobalt)", "--card-glow": "rgba(53, 80, 143, 0.35)" };

export default function RolesPage() {
  const { user, hasPermission } = useAuth();
  const canCreate = hasPermission("roles", "create");
  const canEdit = hasPermission("roles", "edit");
  const toast = useToast();
  const [catalog, setCatalog] = useState([]);
  const [roles, setRoles] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const loadAll = async () => {
    setLoading(true);
    setError("");
    try {
      const [catalogRes, rolesRes] = await Promise.all([
        apiClient.get("/roles/catalog"),
        apiClient.get("/roles"),
      ]);
      setCatalog(catalogRes.data.data);
      setRoles(rolesRes.data.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const hasPerm = (resource, action) => form.permissions.includes(`${resource}:${action}`);

  const togglePermission = (resource, action) => {
    const key = `${resource}:${action}`;
    setForm((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(key)
        ? prev.permissions.filter((p) => p !== key)
        : [...prev.permissions, key],
    }));
  };

  // Tick / untick every action of a module at once.
  const toggleModule = (entry, on) => {
    const keys = entry.actions.map((a) => `${entry.resource}:${a.action}`);
    setForm((prev) => ({
      ...prev,
      permissions: on
        ? [...new Set([...prev.permissions, ...keys])]
        : prev.permissions.filter((p) => !keys.includes(p)),
    }));
  };

  const startCreate = () => {
    setEditingId(null);
    setForm(initialForm);
  };

  // Existing roles may carry legacy "<resource>:manage" grants; expand those
  // to the module's individual actions so they show as ticked in the matrix.
  const expandPermissions = (role) => {
    const result = new Set();
    for (const permission of role.permissions || []) {
      const [resource, action] = permission.split(":");
      if (action === "manage") {
        const entry = catalog.find((m) => m.resource === resource);
        (entry?.actions || []).forEach((a) => result.add(`${resource}:${a.action}`));
      } else {
        result.add(permission);
      }
    }
    return [...result];
  };

  const startEditing = (role) => {
    if (!canEdit) return;
    setEditingId(role.id);
    setForm({ name: role.name, description: role.description || "", permissions: expandPermissions(role) });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (editingId ? !canEdit : !canCreate) return;
    setError("");
    setSubmitting(true);
    try {
      if (editingId) {
        await apiClient.patch(`/roles/${editingId}`, form);
        toast.success(`Role "${form.name}" updated.`);
      } else {
        await apiClient.post("/roles", form);
        toast.success(`Role "${form.name}" created — assign it on the Staff page.`);
      }
      setEditingId(null);
      setForm(initialForm);
      await loadAll();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const groups = catalog.reduce((acc, entry) => {
    acc[entry.group] = acc[entry.group] || [];
    acc[entry.group].push(entry);
    return acc;
  }, {});

  // The tiers are managed on the Staff page; this screen is for custom roles.
  // The reserved "developer" (platform) role is only ever visible to a
  // developer — everyone else never sees it, mirroring the Staff page's
  // assign guard and the backend's role-name reservation.
  const customRoles = roles.filter(
    (role) => !TIER_NAMES.includes(role.name) && (role.name !== "developer" || user?.role === "developer")
  );

  const inputClass =
    "w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal";

  return (
    <div>
      <div className="mb-6">
        <span className="field-label text-cobalt">Administration</span>
        <h2 className="font-display text-xl font-semibold text-ink">Roles</h2>
      </div>

      {error && (
        <p className="mb-4 rounded border border-clay/30 bg-clay-soft px-3 py-2 text-sm text-clay">
          {error}
        </p>
      )}

      {loading ? (
        <TableSkeleton rows={6} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          {(editingId ? canEdit : canCreate) && <form onSubmit={handleSubmit} className="ledger-card space-y-4 py-6 pr-6 lg:col-span-2 min-w-0" style={ACCENT_STYLE}>
            <div className="flex items-center justify-between">
              <p className="field-label">{editingId ? "Edit role" : "Create a role"}</p>
              {editingId && (
                <button type="button" onClick={startCreate} className="btn-link btn-link-neutral">
                  Cancel edit
                </button>
              )}
            </div>

            <div>
              <label htmlFor="roleName" className="field-label mb-1 block">
                Name
              </label>
              <input
                id="roleName"
                required
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="e.g. Cashier"
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="roleDescription" className="field-label mb-1 block">
                Description
              </label>
              <input
                id="roleDescription"
                value={form.description}
                onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                placeholder="Optional"
                className={inputClass}
              />
            </div>

            <div>
              <p className="field-label mb-2">Permissions</p>
              <div className="space-y-4">
                {Object.entries(groups).map(([group, entries]) => (
                  <div key={group}>
                    <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-soft">{group}</p>
                    <div className="space-y-2">
                      {entries.map((entry) => {
                        const allOn = entry.actions.every((a) => hasPerm(entry.resource, a.action));
                        return (
                          <div key={entry.resource} className="rounded border border-paper-line p-2.5">
                            <div className="mb-1.5 flex items-center justify-between">
                              <span className="text-sm font-medium text-ink">{entry.label}</span>
                              <button
                                type="button"
                                onClick={() => toggleModule(entry, !allOn)}
                                className="btn-link btn-link-neutral text-xs"
                              >
                                {allOn ? "Clear" : "All"}
                              </button>
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1">
                              {entry.actions.map((a) => (
                                <label key={a.action} className="flex items-center gap-1.5 text-sm text-ink">
                                  <input
                                    type="checkbox"
                                    checked={hasPerm(entry.resource, a.action)}
                                    onChange={() => togglePermission(entry.resource, a.action)}
                                    className="h-4 w-4 rounded border-paper-line text-teal focus:ring-teal"
                                  />
                                  {a.label}
                                </label>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <button type="submit" disabled={submitting} className="btn-solid btn-solid-primary">
              {submitting ? "Saving…" : editingId ? "Save changes" : "Create role"}
            </button>
          </form>}

          <div className="lg:col-span-1 min-w-0">
            <p className="field-label mb-2">Custom roles</p>
            {customRoles.length === 0 ? (
              <p className="text-sm text-ink-soft">No custom roles yet. The Staff, Supervisor, Admin, and Super Admin tiers are on the Staff page.</p>
            ) : (
              <div className="space-y-2">
                {customRoles.map((role) => (
                  <div key={role.id} className="ledger-card py-3 pr-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-ink">
                        {role.name}
                        {role.isSystem && (
                          <span className="ml-2 rounded bg-paper px-1.5 py-0.5 text-xs text-ink-soft">system</span>
                        )}
                      </p>
                      {canEdit && !role.isSystem && (
                        <button type="button" onClick={() => startEditing(role)} className="btn-link btn-link-primary">
                          Edit
                        </button>
                      )}
                    </div>
                    {role.description && <p className="mt-0.5 text-xs text-ink-soft">{role.description}</p>}
                    <p className="mt-1 text-xs text-ink-soft">
                      {role.permissions.length === 0
                        ? "No permissions granted"
                        : `${role.permissions.length} permission${role.permissions.length === 1 ? "" : "s"} granted`}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
