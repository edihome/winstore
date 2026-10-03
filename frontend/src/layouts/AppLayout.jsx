/**
 * ============================================================
 * File: AppLayout.jsx
 * Module: Layout
 *
 * Description:
 * Shared shell for authenticated screens: a dark teal sidebar, a
 * patterned dark header (org identity, branch switcher, sign-out),
 * and the page content filling the remaining full-bleed space.
 *
 * Responsive: at `lg:` and up the sidebar is permanently docked (the
 * original desktop behavior, unchanged). Below `lg:` it's an
 * off-canvas drawer — hidden by default, opened with the header's
 * hamburger button, closed by its own backdrop, the Escape key, or
 * just navigating (route changes auto-close it). A breadcrumb trail
 * under the header gives mobile users their "where am I" context that
 * the now-hidden sidebar would otherwise have provided.
 * ============================================================
 */

import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { resizeToDataUri } from "../utils/image";
import apiClient from "../api/client";
import { navItemMatchesPath } from "../utils/navigation";
import SubscriptionAlertBanner from "../components/SubscriptionAlertBanner";

const NAV_ICONS = {
  Overview: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8.2" r="3.2" />
      <path d="M5 20c0-4 3-6.5 7-6.5s7 2.5 7 6.5" />
    </svg>
  ),
  Customers: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8.5" r="3" />
      <circle cx="17" cy="9.5" r="2.3" />
      <path d="M3 20c0-3.8 2.7-6 6-6s6 2.2 6 6" />
      <path d="M15 14.3c2.3.4 4 2.2 4 5.7" />
    </svg>
  ),
  Appointments: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
      <path d="M8 13l2.5 2.5L15.5 12" />
    </svg>
  ),
  Inventory: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l8 4.2v9.6L12 21l-8-4.2V7.2z" />
      <path d="M4 7.2L12 11.4l8-4.2" />
      <path d="M12 11.4V21" />
    </svg>
  ),
  Purchasing: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="8" width="11" height="8" rx="1" />
      <path d="M13.5 10.5h3.5l3 3v2.5h-6.5z" />
      <circle cx="6.5" cy="18.3" r="1.5" />
      <circle cx="16.5" cy="18.3" r="1.5" />
    </svg>
  ),
  Sales: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5h2l1.7 10.2a2 2 0 0 0 2 1.7h6.7a2 2 0 0 0 2-1.6L20 8H7.2" />
      <circle cx="9.5" cy="19.8" r="1.3" />
      <circle cx="17" cy="19.8" r="1.3" />
    </svg>
  ),
  Billing: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h12v18l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3z" />
      <path d="M8.5 8h7M8.5 11.5h7M8.5 15h4" />
    </svg>
  ),
  Expenses: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10.5h18" />
      <circle cx="16.8" cy="14.5" r="1.3" />
    </svg>
  ),
  Reports: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20V11M10.5 20V6M17 20v-6M3 20h18" />
    </svg>
  ),
  Administration: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l7 3v5.5c0 4.6-3 7.7-7 9-4-1.3-7-4.4-7-9V6z" />
      <path d="M9 12.2l2 2 4-4.2" />
    </svg>
  ),
  Organizations: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="9" width="7" height="12" />
      <rect x="13" y="4" width="8" height="17" />
      <path d="M5.5 13h2M5.5 17h2M16 8h2M16 12h2M16 16h2" />
    </svg>
  ),
};

// `resource` is the permission key checked against hasPermission() before
// a link (or a whole group) is shown at all — see AuthContext.hasPermission.
// No `resource` means always visible. Personal items (my attendance,
// change password) live in the header's avatar menu, not here —
// they're self-service, not navigation.
const navItems = [
  { to: "/dashboard", label: "Overview", end: true },
  { to: "/dashboard/customers", label: "Customers", resource: "customers" },
  { to: "/dashboard/services/appointments", label: "Appointments", resource: "appointments" },
  {
    label: "Inventory",
    // Viewing the catalog is baseline; each page gates its write controls
    // separately so custom view grants never enable catalog changes.
    children: [
      // Products and Stock used to be two links; they're one page now (a
      // product IS its stock). Gated on `products` so anyone who can read the
      // catalog can look up stock; the page itself hides the controls their
      // grants don't cover.
      { to: "/dashboard/inventory/products", label: "Products & stock", resource: "products" },
      { to: "/dashboard/inventory/shipments", label: "Shipments", resource: "stock_movements" },
      { to: "/dashboard/services/catalog", label: "Services", resource: "services" },
    ],
  },
  {
    label: "Purchasing",
    children: [
      { to: "/dashboard/purchasing/suppliers", label: "Suppliers", resource: "suppliers" },
      { to: "/dashboard/purchasing/purchases", label: "Purchases", resource: "purchases" },
    ],
  },
  { to: "/dashboard/sales", label: "Sales", resource: "sales" },
  {
    label: "Billing",
    children: [
      { to: "/dashboard/billing", label: "Discounts & Taxes", resource: ["taxes", "discounts"], end: true },
      { to: "/dashboard/billing/budgets", label: "Budgets", resource: "budgets" },
      { to: "/dashboard/billing/cash-register", label: "Cash Register", resource: "cash_register" },
    ],
  },
  { to: "/dashboard/expenses", label: "Expenses", resource: "expenses" },
  { to: "/dashboard/reports", label: "Reports", resource: "reports" },
  {
    label: "Administration",
    // Show only the individual pages the user can view. A custom role may
    // have a settings/roles view grant without any administrative manage grant.
    children: [
      { to: "/dashboard/administration/branches", label: "Branches", resource: "branches" },
      // Offline branches: gated to admins (same set the backend's isAdminUser
      // allows), since generating a code opts the whole org into offline sync.
      { to: "/dashboard/administration/offline", label: "Offline Branches", resource: ["users", "roles", "branches"], action: "manage" },
      { to: "/dashboard/administration/roles", label: "Roles", resource: "roles" },
      { to: "/dashboard/administration/staff", label: "Staff", resource: "users" },
      // Receipt branding: logo, address, contacts, custom message.
      { to: "/dashboard/administration/business-profile", label: "Business Profile", resource: "settings" },
      // Management view of the whole branch log; a staff member's own
      // log lives in the avatar menu ("My attendance") instead.
      { to: "/dashboard/administration/attendance", label: "Attendance", resource: "attendance", action: "manage" },
      // Owner-only (role check, not a resource permission): subscription
      // renewal is the organization owner's concern, never a grantable
      // staff module — mirrors the backend's /subscription role gate.
      { to: "/dashboard/administration/subscription", label: "Subscription", requireSuperAdmin: true },
    ],
  },
  // Not a resource permission — "developer" is a reserved platform role
  // with cross-organization reach, not a per-organization grant (see
  // backend/utils/isPrivilegedRole.js). requireDeveloper is checked
  // directly against user.role, same as RequireDeveloper on the route.
  { to: "/dashboard/organizations", label: "Organizations", requireDeveloper: true },
];

const isGroupActive = (group, pathname) => group.children.some((child) => navItemMatchesPath(child, pathname));

/**
 * Resolve the current route into a breadcrumb trail: [] for the
 * dashboard root, [{label}] for a standalone top-level page, or
 * [{label: group}, {label: child}] for a page inside a nav group.
 * Walks the same `navItems` the sidebar renders, so the trail can
 * never name a page the sidebar itself wouldn't show.
 *
 * @param {string} pathname Current location.pathname.
 * @returns {{label: string}[]} Breadcrumb segments, root excluded.
 */
const getBreadcrumbTrail = (pathname) => {
  for (const item of navItems) {
    if (item.children) {
      const child = item.children.find((child) => navItemMatchesPath(child, pathname));
      if (child) {
        return [{ label: item.label }, { label: child.label }];
      }
    } else if (item.to && item.to !== "/dashboard" && navItemMatchesPath(item, pathname)) {
      return [{ label: item.label }];
    }
  }
  return [];
};

export default function AppLayout() {
  const { user, logout, activeBranch, setActiveBranchId, hasPermission, refreshProfile } = useAuth();
  const toast = useToast();
  const photoInputRef = useRef(null);

  // Self-service passport photo: resize in the browser, save, refresh the
  // profile so the avatar updates immediately.
  const handlePhotoUpload = async (event) => {
    const file = event.target.files?.[0];
    if (file) {
      try {
        const dataUri = await resizeToDataUri(file, 256);
        await apiClient.patch("/auth/photo", { photo: dataUri });
        await refreshProfile();
        toast.success("Photo updated.");
      } catch (err) {
        toast.error(err.message);
      }
    }
    if (photoInputRef.current) photoInputRef.current.value = "";
  };
  const location = useLocation();
  const navigate = useNavigate();

  // Only show a link (or a whole group, if it would otherwise be empty)
  // for a resource this user's role actually grants — mirrors the
  // backend's own permission checks so the nav never dangles an action
  // that would just 403 if clicked. See navItems' `resource` fields above.
  // `requireDeveloper` is a separate, stricter check: a role check, not a
  // resource permission, since "developer" isn't something a regular
  // organization ever grants itself.
  // A subscription-locked session (expired past grace — super_admin only,
  // staff can't log in at all in that state) is cut down to the pages the
  // backend still serves it: profile and the Subscription page (password
  // stays reachable via the avatar menu). See middlewares/auth.js's
  // SUBSCRIPTION_LOCKED_ALLOWLIST.
  const LOCKED_NAV_LABELS = ["Overview", "Subscription"];

  const canSeeItem = (item) => {
    if (user?.subscriptionLocked && !LOCKED_NAV_LABELS.includes(item.label)) return false;
    if (item.requireDeveloper) return user?.role === "developer";
    if (item.requireSuperAdmin) return user?.role === "super_admin" || user?.role === "developer";
    return !item.resource || hasPermission(item.resource, item.action || "view");
  };
  const visibleNavItems = navItems
    .map((item) => (item.children ? { ...item, children: item.children.filter(canSeeItem) } : item))
    .filter((item) => item.children ? item.children.length > 0 : canSeeItem(item));

  const [openGroups, setOpenGroups] = useState(() => {
    const initial = {};
    visibleNavItems.forEach((item) => {
      if (item.children) {
        initial[item.label] = isGroupActive(item, location.pathname);
      }
    });
    return initial;
  });

  // Off-canvas sidebar state — irrelevant at `lg:` and up, where the
  // sidebar is permanently docked regardless of this flag (see the
  // `lg:translate-x-0` on .app-sidebar below).
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Avatar menu (top-right): personal, non-navigational actions — my
  // attendance, change password, sign out. Closes on outside click,
  // Escape, or navigating.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onPointerDown = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  // Auto-expand whichever group contains the current route (e.g. after a
  // redirect) without forcibly collapsing groups the user opened by hand.
  useEffect(() => {
    visibleNavItems.forEach((item) => {
      if (item.children && isGroupActive(item, location.pathname)) {
        setOpenGroups((prev) => (prev[item.label] ? prev : { ...prev, [item.label]: true }));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // A route change means the user just navigated somewhere — on mobile
  // that's exactly when the drawer (and the avatar menu) should get out
  // of the way.
  useEffect(() => {
    setSidebarOpen(false);
    setMenuOpen(false);
  }, [location.pathname]);

  // Escape closes the drawer, same as clicking the backdrop.
  useEffect(() => {
    if (!sidebarOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sidebarOpen]);

  const toggleGroup = (label) => {
    setOpenGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  if (!user) {
    return null;
  }

  const navLinkClass = ({ isActive }) => `app-nav-link ${isActive ? "is-active" : ""}`;
  const breadcrumb = getBreadcrumbTrail(location.pathname);

  return (
    <div className="pattern-paper min-h-screen">
      {/* Backdrop — mobile/tablet only, and only while the drawer is open. */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-ink/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`app-sidebar fixed inset-y-0 left-0 z-40 w-64 overflow-y-auto px-3 py-5 transition-transform duration-200 ease-out lg:z-20 lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-6 flex items-center justify-between px-2">
          <div>
            <span className="field-label text-paper/50">Point of Sale</span>
            <p className="font-display text-lg font-semibold text-paper">Winstore</p>
          </div>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
            className="rounded p-1 text-paper/60 hover:bg-paper/10 hover:text-paper lg:hidden"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <nav className="space-y-1">
          {visibleNavItems.map((item) =>
            item.children ? (
              <div key={item.label}>
                <button
                  type="button"
                  onClick={() => toggleGroup(item.label)}
                  aria-expanded={Boolean(openGroups[item.label])}
                  className={`app-nav-group-btn ${isGroupActive(item, location.pathname) ? "is-active" : ""}`}
                >
                  <span className="flex items-center gap-2.5">
                    <span className="h-[18px] w-[18px] shrink-0">{NAV_ICONS[item.label]}</span>
                    {item.label}
                  </span>
                  <span
                    className={`text-xs transition-transform ${openGroups[item.label] ? "rotate-90" : ""}`}
                    aria-hidden="true"
                  >
                    &#8250;
                  </span>
                </button>
                {openGroups[item.label] && (
                  <div className="ml-[26px] mt-1 space-y-1 border-l border-paper/15 pl-3">
                    {item.children.map((child) => (
                      <NavLink key={child.to} to={child.to} end={child.end} className={navLinkClass}>
                        {child.label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass}>
                <span className="h-[18px] w-[18px] shrink-0">{NAV_ICONS[item.label]}</span>
                {item.label}
              </NavLink>
            )
          )}
        </nav>
      </aside>

      <header className="app-header fixed inset-x-0 top-0 z-10 h-20 lg:pl-64">
        <div className="relative flex h-full items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
              className="shrink-0 rounded border border-paper/25 p-1.5 text-paper/80 hover:border-paper hover:text-paper lg:hidden"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div className="min-w-0">
              <span className="hidden field-label text-paper/60 sm:block">Winstore</span>
              <h1 className="truncate font-display text-base font-semibold text-paper">{user.organization.name}</h1>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {user.accessibleBranches?.length > 1 && (
              <div className="flex items-center gap-2 rounded border border-paper/25 bg-panel-deep/40 px-2 py-1">
                <label
                  htmlFor="branchSwitcher"
                  className="hidden font-mono text-[0.6rem] uppercase tracking-wider text-paper/60 sm:block"
                >
                  Branch
                </label>
                <select
                  id="branchSwitcher"
                  value={activeBranch?.id || ""}
                  onChange={(event) => setActiveBranchId(event.target.value)}
                  className="max-w-[9rem] bg-transparent py-0.5 text-sm font-medium text-paper outline-none sm:max-w-[14rem]"
                  title="Switch which branch you're acting as"
                >
                  {user.accessibleBranches.map((branch) => (
                    <option key={branch.id} value={branch.id} className="text-ink">
                      {branch.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="relative" ref={menuRef}>
              <input ref={photoInputRef} type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
              <button
                type="button"
                onClick={() => setMenuOpen((prev) => !prev)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label="Account menu"
                className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border border-paper/30 bg-paper/10 font-display text-base font-semibold text-paper transition hover:border-paper/60 hover:bg-paper/20"
              >
                {user.photo ? (
                  <img src={user.photo} alt="" className="h-full w-full object-cover" />
                ) : (
                  `${user.firstName?.[0] || ""}${user.lastName?.[0] || ""}`.toUpperCase() || "•"
                )}
              </button>

              {/* Positioned `fixed`, not `absolute`: the .app-header has
                  overflow:hidden (to contain its decorative pattern/sheen
                  layers), which would otherwise clip this dropdown — it
                  extends below the 64px header — leaving it invisible and
                  its Sign out unreachable. A fixed element is laid out
                  against the viewport, escaping the header's clip; the
                  right offsets track the header's own responsive padding
                  so it stays under the avatar. It remains a DOM descendant
                  of menuRef, so outside-click still closes it. */}
              {menuOpen && (
                <div
                  role="menu"
                  className="fixed right-4 top-20 z-50 w-64 overflow-hidden rounded-lg border border-paper-line bg-white shadow-xl sm:right-6 lg:right-8"
                >
                  <div className="flex items-center gap-3 border-b border-paper-line bg-paper px-4 py-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-paper-line bg-white font-display text-base font-semibold text-teal">
                      {user.photo ? (
                        <img src={user.photo} alt="" className="h-full w-full object-cover" />
                      ) : (
                        `${user.firstName?.[0] || ""}${user.lastName?.[0] || ""}`.toUpperCase() || "•"
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">
                        {user.firstName} {user.lastName}
                      </p>
                      <p className="truncate font-mono text-xs text-ink-soft">{user.email}</p>
                      <p className="mt-0.5 font-mono text-[0.65rem] uppercase tracking-wider text-teal">{user.role}</p>
                    </div>
                  </div>
                  <nav className="py-1 text-sm text-ink">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => photoInputRef.current?.click()}
                      className="block w-full px-4 py-2 text-left transition hover:bg-teal-soft"
                    >
                      {user.photo ? "Change photo" : "Add photo"}
                    </button>
                    <NavLink
                      to="/dashboard/administration/attendance"
                      role="menuitem"
                      className="block px-4 py-2 transition hover:bg-teal-soft"
                    >
                      My attendance
                    </NavLink>
                    <NavLink
                      to="/dashboard/administration/change-password"
                      role="menuitem"
                      className="block px-4 py-2 transition hover:bg-teal-soft"
                    >
                      Change password
                    </NavLink>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={logout}
                      className="block w-full px-4 py-2 text-left text-clay transition hover:bg-clay-soft"
                    >
                      Sign out
                    </button>
                  </nav>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="min-w-0 px-4 pb-8 pt-28 sm:px-6 lg:ml-64 lg:px-8">
        <SubscriptionAlertBanner />
        {breadcrumb.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-4 flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
            <button type="button" onClick={() => navigate("/dashboard")} className="hover:text-teal">
              Dashboard
            </button>
            {breadcrumb.map((segment, index) => (
              <span key={segment.label} className="flex items-center gap-1.5">
                <span aria-hidden="true">/</span>
                <span className={index === breadcrumb.length - 1 ? "text-ink" : ""}>{segment.label}</span>
              </span>
            ))}
          </nav>
        )}
        <Outlet />
      </main>
    </div>
  );
}
