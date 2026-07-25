/**
 * ============================================================
 * File: index.js
 * Module: Application Routes
 *
 * Description:
 * Central router for the Winstore API (v1).
 *
 * Every module registers its routes here. Except for /health
 * and /auth, every route is registered through
 * useProtectedResource, which applies authentication,
 * organization isolation, and permission checks.
 * ============================================================
 */

 const express = require("express");

 const { authenticate } = require("../middlewares/auth");
 const { enforceOrgDbContext } = require("../middlewares/orgContext");
 const { enforceActiveSession } = require("../middlewares/sessionGuard");
 const { enforceOrganizationScope } = require("../middlewares/organizationScope");
 const { enforceActiveSubscription } = require("../middlewares/subscriptionGuard");
 const { enforceBranchScope } = require("../middlewares/branchScope");
 const { requireAnyPermission, requireRole, requireAnyRole } = require("../middlewares/permission");
 const { METHOD_ACTIONS } = require("../core/permissions/permissions.catalog");
 const { authRateLimiter } = require("../middlewares/rateLimiters");

 const authRoutes = require("../core/auth/auth.routes");
 const organizationsRoutes = require("../core/organizations/organizations.routes");
 const branchesRoutes = require("../core/branches/branches.routes");
 const rolesRoutes = require("../core/roles/roles.routes");
 const permissionsRoutes = require("../core/permissions/permissions.routes");
 const usersRoutes = require("../core/users/users.routes");
 const settingsRoutes = require("../core/settings/settings.routes");
 const auditRoutes = require("../core/audit/audit.routes");
 const notificationsRoutes = require("../core/notifications/notifications.routes");
 const attendanceRoutes = require("../core/attendance/attendance.routes");
 const attendanceController = require("../core/attendance/attendance.controller");
 const customersRoutes = require("../core/customers/customers.routes");
 const suppliersRoutes = require("../core/suppliers/suppliers.routes");
 const inventoryRoutes = require("../core/inventory/inventory.routes");
 const reportsRoutes = require("../core/reports/reports.routes");
 const purchasesRoutes = require("../core/purchases/purchases.routes");
 const salesRoutes = require("../core/sales/sales.routes");
 const productsRoutes = require("../core/products/products.routes");
 const expensesRoutes = require("../core/expenses/expenses.routes");
 const paymentsRoutes = require("../core/payments/payments.routes");
 const budgetsRoutes = require("../core/budgets/budgets.routes");
 const taxesRoutes = require("../core/taxes/taxes.routes");
 const discountsRoutes = require("../core/discounts/discounts.routes");
 const categoriesRoutes = require("../core/categories/categories.routes");
 const stockMovementsRoutes = require("../core/stock-movements/stock-movements.routes");
 const cashRegisterRoutes = require("../core/cash-register/cash-register.routes");
 const syncRoutes = require("../core/sync/sync.routes");
 const subscriptionRoutes = require("../core/subscription/subscription.routes");
 const servicesRoutes = require("../modules/services/services.routes");
 const appointmentsRoutes = require("../modules/appointments/appointments.routes");

 const router = express.Router();

 const READ_METHODS = ["GET", "HEAD", "OPTIONS"];

 /**
  * Build authorization middleware for a protected resource.
  *
  * @param {string} resource Permission resource name.
  * @returns {Function} Express middleware.
  */
 const authorizeResource = (resource) => (req, res, next) => {
     // Map the HTTP method to the fine-grained action (GET→view, POST→create,
     // PATCH→edit, DELETE→delete). "manage" is always accepted as a superset,
     // and "read" is accepted for view — so every existing role/tier (granted
     // "<resource>:manage") and baseline read still works unchanged, while
     // custom roles can now grant individual actions. Domain-specific actions
     // (sales:refund, stock_movements:stock_adjustment) are enforced on top,
     // in their controllers.
     const action = METHOD_ACTIONS[req.method] || "manage";
     const accepted = [`${resource}:${action}`, `${resource}:manage`];
     if (action === "view") {
         accepted.push(`${resource}:read`);
     }
     return requireAnyPermission(accepted)(req, res, next);
 };

 /**
  * Register routes behind authentication, organization isolation, and authorization.
  *
  * @param {string} path Route path.
  * @param {string} resource Permission resource name.
  * @param {object} routeHandler Express router.
  * @returns {void}
  */
 const useProtectedResource = (path, resource, routeHandler) => {
     router.use(
         path,
         authenticate,
         enforceOrgDbContext,
         enforceActiveSession,
         enforceOrganizationScope,
         enforceActiveSubscription,
         authorizeResource(resource),
         routeHandler
     );
 };

 /**
  * Authorization for resources whose READ side belongs to every
  * authenticated organization member and only writes need the module
  * grant. Used for attendance (every staff member may view their own
  * log — the service scopes what actually comes back) and branches
  * (names/codes feed dropdowns everywhere; the service filters the
  * list to the caller's accessible branches).
  *
  * @param {string} resource Permission resource name.
  * @returns {Function} Express middleware.
  */
 const authorizeWritesOnly = (resource) => (req, res, next) => {
     if (READ_METHODS.includes(req.method)) {
         return next();
     }
     const action = METHOD_ACTIONS[req.method] || "manage";
     return requireAnyPermission([`${resource}:${action}`, `${resource}:manage`])(req, res, next);
 };

 /**
  * Same as useProtectedResource, plus branch-level data isolation — for
  * resources whose rows belong to a specific branch (sales, purchases,
  * stock, etc). See middlewares/branchScope.js.
  *
  * @param {string} path Route path.
  * @param {string} resource Permission resource name.
  * @param {object} routeHandler Express router.
  * @returns {void}
  */
 const useBranchScopedResource = (path, resource, routeHandler) => {
     router.use(
         path,
         authenticate,
         enforceOrgDbContext,
         enforceActiveSession,
         enforceOrganizationScope,
         enforceActiveSubscription,
         authorizeResource(resource),
         enforceBranchScope(),
         routeHandler
     );
 };

 /**
  * ------------------------------------------------------------
  * Health Check
  * ------------------------------------------------------------
  * Used to verify that the API is online.
  */
 router.get("/health", (req, res) => {
     res.status(200).json({
         success: true,
         message: "Winstore API is running.",
         version: "1.0.0",
         timestamp: new Date(),
     });
 });

 router.use("/auth", authRoutes);
 // Kiosk check-in/out from the login screen — deliberately public (no
 // JWT), since it exists precisely so a shared front-desk device never
 // has to be logged in as anyone. Credentials are still verified inside
 // attendanceService.kioskToggle, same as a real login, just without
 // issuing a session. Rate-limited the same as /auth/login for the same
 // reason: it's a public endpoint that checks a password.
 //
 // MUST be registered before useProtectedResource("/attendance", ...)
 // below — that call uses router.use("/attendance", ...), which matches
 // this path as a prefix. Express dispatches middleware/routes in
 // registration order, so this exact route has to come first or the
 // protected router's `authenticate` would intercept it and 401 before
 // this handler is ever reached.
 router.post("/attendance/kiosk-toggle", authRateLimiter, attendanceController.kioskToggle);
 // Not organization-scoped — organizations ARE the tenancy root, so
 // enforceOrganizationScope doesn't conceptually apply to them the way it
 // does to every business resource nested under one. Gated on the exact
 // "developer" role (a platform operator) rather than a per-org permission
 // grant, since this is the one place in the app with legitimate
 // cross-organization reach — see utils/isPrivilegedRole.js and
 // scripts/create-developer.js.
 // Offline-sync engine. Authenticated + org-scoped (RLS is the whole trust
 // boundary) but NOT permission-gated — triggering a reconcile is operational,
 // open to any staff member (the "Sync now" button on Overview).
 router.use("/sync", authenticate, enforceOrgDbContext, enforceActiveSession, syncRoutes);
 router.use("/organizations", authenticate, enforceOrgDbContext, enforceActiveSession, requireRole("developer"), organizationsRoutes);
 // The tenant-facing read side of subscription management: an org's own
 // super_admin (or a developer) checking their standing and recorded
 // renewals. Role-gated rather than permission-gated — renewal is the
 // owner's concern, never a grantable staff module. Deliberately
 // reachable by a subscription-locked session (see middlewares/auth.js's
 // SUBSCRIPTION_LOCKED_ALLOWLIST): that's the page a locked owner is
 // sent to. Organization scoping is inherent — the controller only ever
 // reads req.user.organizationId.
 router.use("/subscription", authenticate, enforceOrgDbContext, enforceActiveSession, requireAnyRole(["super_admin", "developer"]), subscriptionRoutes);
 router.use("/branches", authenticate, enforceOrgDbContext, enforceActiveSession, enforceOrganizationScope, enforceActiveSubscription, authorizeWritesOnly("branches"), branchesRoutes);
 useProtectedResource("/roles", "roles", rolesRoutes);
 useProtectedResource("/permissions", "permissions", permissionsRoutes);
 useProtectedResource("/users", "users", usersRoutes);
 useProtectedResource("/settings", "settings", settingsRoutes);
 useProtectedResource("/audit", "audit", auditRoutes);
 useProtectedResource("/notifications", "notifications", notificationsRoutes);
 router.use("/attendance", authenticate, enforceOrgDbContext, enforceActiveSession, enforceOrganizationScope, enforceActiveSubscription, authorizeWritesOnly("attendance"), attendanceRoutes);
 useProtectedResource("/customers", "customers", customersRoutes);
 useProtectedResource("/suppliers", "suppliers", suppliersRoutes);
 useBranchScopedResource("/inventory", "inventory", inventoryRoutes);
 useBranchScopedResource("/reports", "reports", reportsRoutes);
 useBranchScopedResource("/purchases", "purchases", purchasesRoutes);
 useBranchScopedResource("/sales", "sales", salesRoutes);
 useProtectedResource("/products", "products", productsRoutes);
 useBranchScopedResource("/expenses", "expenses", expensesRoutes);
 useProtectedResource("/payments", "payments", paymentsRoutes);
 useProtectedResource("/budgets", "budgets", budgetsRoutes);
 useProtectedResource("/taxes", "taxes", taxesRoutes);
 useProtectedResource("/discounts", "discounts", discountsRoutes);
 useProtectedResource("/categories", "categories", categoriesRoutes);
 useBranchScopedResource("/stock-movements", "stock_movements", stockMovementsRoutes);
 // Not branch-scoped: cash-register transactions key off cashRegisterId,
 // not branchId directly, and this module has no frontend page yet.
 useProtectedResource("/cash-register", "cash_register", cashRegisterRoutes);
 // Not branch-scoped: services.branch_id is nullable — null means
 // "offered at every branch" (see migration 023), so it's an org-wide
 // catalog with an optional branch tag, not an access boundary.
 useProtectedResource("/services", "services", servicesRoutes);
 useBranchScopedResource("/appointments", "appointments", appointmentsRoutes);
 
 module.exports = router;
