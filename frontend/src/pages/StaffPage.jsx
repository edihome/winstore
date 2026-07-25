/**
 * ============================================================
 * File: StaffPage.jsx
 * Module: Administration
 *
 * Description:
 * Staff management in the app's modern list pattern: full-width
 * sortable, paginated, searchable table; create/edit in a slide-over
 * drawer; toasts for outcomes; a two-step confirm before deactivating
 * an account. Deactivating blocks the user's next login but keeps
 * their history intact. The Developer role additionally gets a
 * permanent Delete (see components/DeleteButton.jsx).
 *
 * Role/branch guards mirror the backend's (users.service): only a
 * super admin may hand out a system role, only a developer the
 * reserved developer role, and non-privileged admins must place staff
 * in one of their own branches (the /branches list is already
 * server-filtered to those).
 * ============================================================
 */

import { useEffect, useMemo, useState } from "react";
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

// HR/"vital data" fields, super-admin-only (see the guarded section in
// the drawer). Kept flat in the same form object for simplicity.
const initialHr = {
  position: "",
  employmentDate: "",
  phone: "",
  address: "",
  dateOfBirth: "",
  gender: "",
  nextOfKin: "",
  nextOfKinPhone: "",
  nationalId: "",
  bankName: "",
  bankAccountNumber: "",
  salary: "",
  benefits: "",
};

const initialForm = { firstName: "", lastName: "", email: "", password: "", branchId: "", roleId: "", branchIds: [], ...initialHr };

// Access tiers shown when adding staff. Names match the roles the backend
// seeds per org (see permissions.catalog ROLE_TIERS); super_admin is the owner.
const TIER_NAMES = ["staff", "supervisor", "admin", "super_admin"];
const TIER_META = [
  { name: "staff", label: "Staff", hint: "Sell, book appointments, and serve customers." },
  { name: "supervisor", label: "Supervisor", hint: "Staff, plus inventory, purchasing, expenses, and reports." },
  { name: "admin", label: "Admin", hint: "Full management — staff, roles, branches, and settings." },
  { name: "super_admin", label: "Super Admin", hint: "The organization owner — full, unrestricted access." },
];
const TIER_LABEL = Object.fromEntries(TIER_META.map((t) => [t.name, t.label]));
// Friendly display for a role name (tiers get a proper label; custom roles show as-is).
const roleLabel = (name) => (name ? TIER_LABEL[name] || name : "—");

const asDateInput = (value) => (value ? String(value).slice(0, 10) : "");

// One label/value line in the read-only details view. Renders nothing
// when the value is blank, so an unfilled HR field doesn't clutter it.
function DetailRow({ label, value }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex justify-between gap-4 border-b border-paper-line py-1.5 last:border-0">
      <span className="field-label">{label}</span>
      <span className="text-right text-sm text-ink">{value}</span>
    </div>
  );
}

// Administration's card/panel accent.
const ACCENT_STYLE = { "--card-accent": "var(--color-cobalt)", "--card-glow": "rgba(53, 80, 143, 0.35)" };

export default function StaffPage() {
  const { user: currentUser } = useAuth();
  const toast = useToast();
  const { currency, money, date } = useFormat();
  const isPrivileged = currentUser?.role === "super_admin" || currentUser?.role === "developer";
  const canAssignRole = (role) => {
    if (role.name === "developer") return currentUser?.role === "developer";
    if (role.isSystem) return isPrivileged;
    return true;
  };

  const [branches, setBranches] = useState([]);
  const [roles, setRoles] = useState([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [viewUser, setViewUser] = useState(null);
  const [editingId, setEditingId] = useState(null);
  // The record version loaded into the edit form, sent back on save so a
  // concurrent edit is caught instead of silently overwritten (409).
  const [editingVersion, setEditingVersion] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [resettingId, setResettingId] = useState(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  // Whether the drawer is assigning a custom (granular) role instead of a tier.
  const [useCustomRole, setUseCustomRole] = useState(false);

  // The four access tiers this admin may assign (Super Admin only if they're
  // privileged), each paired with its seeded role; plus any custom roles.
  const roleByName = useMemo(() => Object.fromEntries(roles.map((r) => [r.name, r])), [roles]);
  const tierOptions = useMemo(
    () => TIER_META.map((meta) => ({ ...meta, role: roleByName[meta.name] })).filter((t) => t.role && canAssignRole(t.role)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roleByName]
  );
  const customRoles = useMemo(
    () => roles.filter((r) => !TIER_NAMES.includes(r.name) && canAssignRole(r)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roles]
  );
  const staffRoleId = roleByName.staff?.id || "";

  const kit = useServerTable(
    ({ page, limit, sortKey, sortDir, search: q }) =>
      apiClient.get("/users", { params: { page, limit, sortKey, sortDir, search: q || undefined } }),
    { pageSize: 12, defaultSort: { key: "firstName", dir: "asc" }, search: debouncedSearch }
  );

  // Branches + roles feed the create/edit form (dropdowns, tier mapping) — a
  // small, bounded fetch, separate from the paged staff table.
  const loadRefs = async () => {
    try {
      const [branchesRes, rolesRes] = await Promise.all([apiClient.get("/branches"), apiClient.get("/roles")]);
      setBranches(branchesRes.data.data);
      setRoles(rolesRes.data.data);
    } catch {
      /* the staff table surfaces load errors; empty dropdowns are recoverable */
    }
  };

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    loadRefs();
  }, []);

  const handleChange = (event) => {
    setForm((prev) => ({ ...prev, [event.target.name]: event.target.value }));
  };

  const openCreate = () => {
    setEditingId(null);
    setEditingVersion(null);
    setUseCustomRole(false);
    // Default new staff to the Staff tier (baseline access).
    setForm({ ...initialForm, roleId: staffRoleId });
    setDrawerOpen(true);
  };

  const openEdit = (user) => {
    setEditingId(user.id);
    setEditingVersion(user.version || null);
    // Show the custom-role picker if their current role isn't one of the tiers.
    setUseCustomRole(Boolean(user.roleName && !TIER_NAMES.includes(user.roleName)));
    // user.hr only arrives for a super_admin/developer viewer.
    const hr = user.hr || {};
    setForm({
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      password: "",
      branchId: user.branchId || "",
      roleId: user.roleId || staffRoleId,
      branchIds: user.accessibleBranchIds || [],
      position: hr.position || "",
      employmentDate: asDateInput(hr.employmentDate),
      phone: hr.phone || "",
      address: hr.address || "",
      dateOfBirth: asDateInput(hr.dateOfBirth),
      gender: hr.gender || "",
      nextOfKin: hr.nextOfKin || "",
      nextOfKinPhone: hr.nextOfKinPhone || "",
      nationalId: hr.nationalId || "",
      bankName: hr.bankName || "",
      bankAccountNumber: hr.bankAccountNumber || "",
      salary: hr.salary === null || hr.salary === undefined ? "" : String(hr.salary),
      benefits: hr.benefits || "",
    });
    setDrawerOpen(true);
  };

  const toggleBranchAccess = (branchId) => {
    setForm((prev) => ({
      ...prev,
      branchIds: prev.branchIds.includes(branchId)
        ? prev.branchIds.filter((id) => id !== branchId)
        : [...prev.branchIds, branchId],
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      if (editingId) {
        const payload = {
          firstName: form.firstName,
          lastName: form.lastName,
          branchId: form.branchId || undefined,
          roleId: form.roleId || undefined,
          branchIds: form.branchIds,
          expectedVersion: editingVersion || undefined,
        };
        // HR/vital data is sent only by a super_admin (the backend ignores
        // it from anyone else regardless, but there's no reason to send it).
        if (isPrivileged) {
          Object.assign(payload, {
            position: form.position,
            employmentDate: form.employmentDate || null,
            phone: form.phone,
            address: form.address,
            dateOfBirth: form.dateOfBirth || null,
            gender: form.gender,
            nextOfKin: form.nextOfKin,
            nextOfKinPhone: form.nextOfKinPhone,
            nationalId: form.nationalId,
            bankName: form.bankName,
            bankAccountNumber: form.bankAccountNumber,
            salary: form.salary === "" ? null : Number(form.salary),
            benefits: form.benefits,
          });
        }
        await apiClient.patch(`/users/${editingId}`, payload);
        toast.success(`${form.firstName} ${form.lastName} updated.`);
      } else {
        await apiClient.post("/users", {
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          password: form.password,
          branchId: form.branchId || undefined,
          roleId: form.roleId || undefined,
          branchIds: form.branchIds,
        });
        toast.success(`${form.firstName} ${form.lastName} added.`);
      }
      setDrawerOpen(false);
      kit.reload();
    } catch (err) {
      toast.error(err.message);
      // A concurrent edit (409): close the stale form and refresh so the
      // next attempt starts from the current data.
      if (err.status === 409) {
        setDrawerOpen(false);
        kit.reload();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (user) => {
    try {
      await apiClient.patch(`/users/${user.id}`, { isActive: !user.isActive });
      toast.success(`${user.firstName} ${user.lastName} ${user.isActive ? "deactivated" : "activated"}.`);
      kit.reload();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const startResetPassword = (user) => {
    setResettingId(user.id);
    setResetPasswordValue("");
  };

  const submitResetPassword = async (user) => {
    try {
      await apiClient.patch(`/users/${user.id}/password`, { newPassword: resetPasswordValue });
      toast.success(`Password reset for ${user.firstName} ${user.lastName}. They must change it at next login.`);
      setResettingId(null);
      setResetPasswordValue("");
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
          <span className="field-label text-cobalt">Administration</span>
          <h2 className="font-display text-xl font-semibold text-ink">Staff</h2>
        </div>
        <div className="flex items-center gap-2">
          <BulkImportControls resource="users" label="staff" onImported={kit.reload} />
          <button type="button" onClick={openCreate} className="btn-solid btn-solid-primary btn-solid-sm">
            + Add staff
          </button>
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
        aria-label="Search staff"
        className={`mb-3 max-w-md ${inputClass}`}
      />

      {kit.loading && kit.visible.length === 0 ? (
        <TableSkeleton rows={8} />
      ) : kit.total === 0 ? (
        debouncedSearch ? (
          <EmptyState icon="🔍" title="No staff match your search" hint="Try a different name or email." />
        ) : (
          <EmptyState
            icon="🪪"
            title="No staff yet"
            hint="Add your team here and assign each person a branch and a role."
            actionLabel="Add your first staff member"
            onAction={openCreate}
          />
        )
      ) : (
        <>
          <div className="panel" style={ACCENT_STYLE}>
            <table className="w-full text-left text-sm">
              <thead className="border-b border-paper-line bg-paper">
                <tr>
                  <SortableTh kit={kit} sortKey="firstName">Name</SortableTh>
                  <SortableTh kit={kit} sortKey="email" className="hidden md:table-cell">Email</SortableTh>
                  <SortableTh kit={kit} sortKey="branchName" className="hidden sm:table-cell">Branch</SortableTh>
                  <SortableTh kit={kit} sortKey="roleName">Role</SortableTh>
                  <th className="px-4 py-2 font-medium text-ink-soft">Status</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {kit.visible.map((user) => (
                  <tr key={user.id} className="border-b border-paper-line last:border-0">
                    <td className="px-4 py-2 text-ink">
                      {user.firstName} {user.lastName}
                    </td>
                    <td className="hidden px-4 py-2 text-ink-soft md:table-cell">{user.email}</td>
                    <td className="hidden px-4 py-2 text-ink-soft sm:table-cell">{user.branchName || "—"}</td>
                    <td className="px-4 py-2 text-ink-soft">{roleLabel(user.roleName)}</td>
                    <td className="px-4 py-2">
                      <span className="inline-flex flex-wrap items-center gap-1">
                        <StatusChip tone={user.isActive ? "success" : "danger"}>
                          {user.isActive ? "active" : "deactivated"}
                        </StatusChip>
                        {user.mustChangePassword && (
                          <StatusChip tone="warning">temp password</StatusChip>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <button type="button" onClick={() => setViewUser(user)} className="btn-link btn-link-neutral">
                          View
                        </button>
                        <button type="button" onClick={() => openEdit(user)} className="btn-link btn-link-primary">
                          Edit
                        </button>
                        {!user.roleIsSystem &&
                          (resettingId === user.id ? null : (
                            <button
                              type="button"
                              onClick={() => startResetPassword(user)}
                              className="btn-link btn-link-warning"
                            >
                              Reset password
                            </button>
                          ))}
                        {user.isActive ? (
                          <ConfirmAction label="Deactivate" onConfirm={() => toggleActive(user)} />
                        ) : (
                          <button type="button" onClick={() => toggleActive(user)} className="btn-link btn-link-success">
                            Activate
                          </button>
                        )}
                        {currentUser?.role === "developer" && !user.roleIsSystem && user.id !== currentUser.id && (
                          <DeleteButton
                            resource="users"
                            id={user.id}
                            label={`${user.firstName} ${user.lastName}`}
                            onDeleted={kit.reload}
                          />
                        )}
                      </div>
                      {resettingId === user.id && (
                        <div className="mt-2 flex items-center justify-end gap-2">
                          <input
                            type="password"
                            autoFocus
                            minLength={8}
                            value={resetPasswordValue}
                            onChange={(event) => setResetPasswordValue(event.target.value)}
                            placeholder="New password (8+ chars)"
                            className="w-52 rounded border border-paper-line bg-white px-2 py-1.5 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal"
                          />
                          <button
                            type="button"
                            onClick={() => submitResetPassword(user)}
                            disabled={resetPasswordValue.length < 8}
                            className="btn-solid btn-solid-sm btn-solid-warning"
                          >
                            Set
                          </button>
                          <button type="button" onClick={() => setResettingId(null)} className="btn-link btn-link-neutral">
                            Cancel
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePager kit={kit} noun="staff" />
        </>
      )}

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editingId ? "Edit staff member" : "Add staff"}
        subtitle={editingId ? undefined : "New accounts must change this password at first login."}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="firstName" className="field-label mb-1 block">
                First name
              </label>
              <input id="firstName" name="firstName" required autoFocus value={form.firstName} onChange={handleChange} className={inputClass} />
            </div>
            <div>
              <label htmlFor="lastName" className="field-label mb-1 block">
                Last name
              </label>
              <input id="lastName" name="lastName" required value={form.lastName} onChange={handleChange} className={inputClass} />
            </div>
          </div>

          <div>
            <label htmlFor="email" className="field-label mb-1 block">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              disabled={Boolean(editingId)}
              value={form.email}
              onChange={handleChange}
              className={`${inputClass} disabled:bg-paper disabled:text-ink-soft`}
            />
          </div>

          {!editingId && (
            <div>
              <label htmlFor="password" className="field-label mb-1 block">
                Temporary password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                minLength={8}
                value={form.password}
                onChange={handleChange}
                placeholder="At least 8 characters"
                className={inputClass}
              />
            </div>
          )}

          <div>
            <label htmlFor="branchId" className="field-label mb-1 block">
              Primary branch
            </label>
            <select id="branchId" name="branchId" required={!isPrivileged} value={form.branchId} onChange={handleChange} className={inputClass}>
              {/* Only privileged roles may leave staff branchless — an
                  admin must place staff in one of their own branches. */}
              <option value="" disabled={!isPrivileged}>
                {isPrivileged ? "No branch" : "Select a branch"}
              </option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </div>

          {branches.length > 1 && (
            <div>
              <p className="field-label mb-1">Branch access</p>
              <p className="mb-1 text-xs text-ink-soft">
                Their primary branch is always included — check any others they should be able to act as.
              </p>
              <div className="space-y-1">
                {branches.map((branch) => (
                  <label key={branch.id} className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={form.branchIds.includes(branch.id) || form.branchId === branch.id}
                      disabled={form.branchId === branch.id}
                      onChange={() => toggleBranchAccess(branch.id)}
                      className="h-4 w-4 rounded border-paper-line text-teal focus:ring-teal disabled:opacity-60"
                    />
                    {branch.name}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="field-label mb-1 block">Access level</label>
            <div className="space-y-2">
              {tierOptions.map((tier) => {
                const selected = !useCustomRole && form.roleId === tier.role.id;
                return (
                  <label
                    key={tier.name}
                    className={`flex cursor-pointer items-start gap-3 rounded border p-3 transition ${
                      selected ? "border-teal bg-teal/5" : "border-paper-line hover:border-teal/50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="accessTier"
                      className="mt-0.5"
                      checked={selected}
                      onChange={() => {
                        setUseCustomRole(false);
                        setForm((prev) => ({ ...prev, roleId: tier.role.id }));
                      }}
                    />
                    <span>
                      <span className="block text-sm font-medium text-ink">{tier.label}</span>
                      <span className="block text-xs text-ink-soft">{tier.hint}</span>
                    </span>
                  </label>
                );
              })}
            </div>

            {/* Custom (granular) roles remain available for anyone who built
                one on the Roles page — kept alongside the tiers. */}
            {customRoles.length > 0 && (
              <div className="mt-2">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-soft">
                  <input
                    type="checkbox"
                    checked={useCustomRole}
                    onChange={(event) => {
                      const on = event.target.checked;
                      setUseCustomRole(on);
                      setForm((prev) => ({ ...prev, roleId: on ? customRoles[0]?.id || "" : staffRoleId }));
                    }}
                  />
                  Use a custom role instead
                </label>
                {useCustomRole && (
                  <select name="roleId" value={form.roleId} onChange={handleChange} className={`mt-1 ${inputClass}`}>
                    <option value="">Select a custom role…</option>
                    {customRoles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>

          {/* HR / vital data — super-admin only, and only when editing an
              existing staff member (per the "click Update to add vital
              data" flow). The backend enforces this too: it never returns
              these fields to, nor accepts them from, an ordinary admin. */}
          {isPrivileged && editingId && (
            <div className="space-y-3 rounded border border-paper-line bg-paper/60 p-3">
              <div>
                <p className="field-label">Vital data (HR)</p>
                <p className="text-xs text-ink-soft">Only super admins can see or change this.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="position" className="field-label mb-1 block">Position</label>
                  <input id="position" name="position" value={form.position} onChange={handleChange} placeholder="e.g. Cashier" className={inputClass} />
                </div>
                <div>
                  <label htmlFor="employmentDate" className="field-label mb-1 block">Employment date</label>
                  <input id="employmentDate" name="employmentDate" type="date" value={form.employmentDate} onChange={handleChange} className={inputClass} />
                </div>
                <div>
                  <label htmlFor="phone" className="field-label mb-1 block">Phone</label>
                  <input id="phone" name="phone" value={form.phone} onChange={handleChange} className={inputClass} />
                </div>
                <div>
                  <label htmlFor="dateOfBirth" className="field-label mb-1 block">Date of birth</label>
                  <input id="dateOfBirth" name="dateOfBirth" type="date" value={form.dateOfBirth} onChange={handleChange} className={inputClass} />
                </div>
                <div>
                  <label htmlFor="gender" className="field-label mb-1 block">Gender</label>
                  <select id="gender" name="gender" value={form.gender} onChange={handleChange} className={inputClass}>
                    <option value="">—</option>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="nationalId" className="field-label mb-1 block">National ID / BVN</label>
                  <input id="nationalId" name="nationalId" value={form.nationalId} onChange={handleChange} className={inputClass} />
                </div>
              </div>

              <div>
                <label htmlFor="address" className="field-label mb-1 block">Address</label>
                <textarea id="address" name="address" rows={2} value={form.address} onChange={handleChange} className={inputClass} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="nextOfKin" className="field-label mb-1 block">Next of kin</label>
                  <input id="nextOfKin" name="nextOfKin" value={form.nextOfKin} onChange={handleChange} className={inputClass} />
                </div>
                <div>
                  <label htmlFor="nextOfKinPhone" className="field-label mb-1 block">Next of kin phone</label>
                  <input id="nextOfKinPhone" name="nextOfKinPhone" value={form.nextOfKinPhone} onChange={handleChange} className={inputClass} />
                </div>
                <div>
                  <label htmlFor="bankName" className="field-label mb-1 block">Bank</label>
                  <input id="bankName" name="bankName" value={form.bankName} onChange={handleChange} className={inputClass} />
                </div>
                <div>
                  <label htmlFor="bankAccountNumber" className="field-label mb-1 block">Account number</label>
                  <input id="bankAccountNumber" name="bankAccountNumber" value={form.bankAccountNumber} onChange={handleChange} className={inputClass} />
                </div>
              </div>

              <div>
                <label htmlFor="salary" className="field-label mb-1 block">Salary ({currency})</label>
                <input id="salary" name="salary" type="number" min="0" step="0.01" value={form.salary} onChange={handleChange} className={inputClass} />
              </div>

              <div>
                <label htmlFor="benefits" className="field-label mb-1 block">Benefits</label>
                <textarea id="benefits" name="benefits" rows={2} value={form.benefits} onChange={handleChange} placeholder="e.g. HMO, transport allowance, leave" className={inputClass} />
              </div>
            </div>
          )}

          <button type="submit" disabled={submitting} className="btn-solid btn-solid-primary">
            {submitting ? "Saving…" : editingId ? "Save changes" : "Add staff"}
          </button>
        </form>
      </Drawer>

      {/* Read-only staff details. The HR block only appears when the
          record actually carries HR data — i.e. for a super_admin viewer,
          since the backend never sends those fields to anyone else. */}
      <Drawer
        open={Boolean(viewUser)}
        onClose={() => setViewUser(null)}
        title={viewUser ? `${viewUser.firstName} ${viewUser.lastName}` : "Staff details"}
        subtitle={viewUser?.email}
      >
        {viewUser && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip tone={viewUser.isActive ? "success" : "danger"}>
                {viewUser.isActive ? "active" : "deactivated"}
              </StatusChip>
              {viewUser.mustChangePassword && <StatusChip tone="warning">temp password</StatusChip>}
            </div>

            <div>
              <DetailRow label="Role" value={roleLabel(viewUser.roleName)} />
              <DetailRow label="Primary branch" value={viewUser.branchName || "—"} />
              <DetailRow
                label="Branch access"
                value={
                  (viewUser.accessibleBranchIds || [])
                    .map((id) => branches.find((b) => b.id === id)?.name)
                    .filter(Boolean)
                    .join(", ") || "—"
                }
              />
            </div>

            {viewUser.hr ? (
              <div>
                <p className="field-label mb-2">Vital data (HR)</p>
                <DetailRow label="Position" value={viewUser.hr.position} />
                <DetailRow label="Employment date" value={viewUser.hr.employmentDate ? date(viewUser.hr.employmentDate) : ""} />
                <DetailRow label="Phone" value={viewUser.hr.phone} />
                <DetailRow label="Address" value={viewUser.hr.address} />
                <DetailRow label="Date of birth" value={viewUser.hr.dateOfBirth ? date(viewUser.hr.dateOfBirth) : ""} />
                <DetailRow label="Gender" value={viewUser.hr.gender} />
                <DetailRow label="Next of kin" value={viewUser.hr.nextOfKin} />
                <DetailRow label="Next of kin phone" value={viewUser.hr.nextOfKinPhone} />
                <DetailRow label="National ID / BVN" value={viewUser.hr.nationalId} />
                <DetailRow label="Bank" value={viewUser.hr.bankName} />
                <DetailRow label="Account number" value={viewUser.hr.bankAccountNumber} />
                <DetailRow label="Salary" value={viewUser.hr.salary === null || viewUser.hr.salary === undefined ? "" : money(viewUser.hr.salary)} />
                <DetailRow label="Benefits" value={viewUser.hr.benefits} />
                {!viewUser.hr.position && viewUser.hr.salary === null && !viewUser.hr.phone && (
                  <p className="text-sm text-ink-soft">No vital data recorded yet — add it from Edit.</p>
                )}
              </div>
            ) : (
              <p className="text-xs text-ink-soft">Vital data (salary, bank, etc.) is visible to super admins only.</p>
            )}

            <button type="button" onClick={() => { setViewUser(null); openEdit(viewUser); }} className="btn-solid btn-solid-primary btn-solid-sm">
              Edit this staff
            </button>
          </div>
        )}
      </Drawer>
    </div>
  );
}
