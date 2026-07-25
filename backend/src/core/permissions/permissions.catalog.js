/**
 * ============================================================
 * File: permissions.catalog.js
 * Module: Core Permissions
 *
 * Description:
 * The fixed list of protectable modules — one entry per resource
 * name used by useProtectedResource() in routes/index.js. Every
 * organization is provisioned a "<resource>:manage" permission for
 * each entry at registration time (see auth.service.register), so
 * role creation only ever needs to link existing permission rows,
 * never create new ones.
 *
 * A single "manage" permission per module is sufficient: the
 * route-level authorizeResource() helper accepts "<resource>:manage"
 * for both read and write requests, so one checkbox per module in
 * the Roles UI is enough — there's no separate read-only tier.
 * ============================================================
 */

const MODULE_ACTION = "manage";

const MODULE_CATALOG = Object.freeze([
    // Administration — platform/tenancy concerns.
    { resource: "organizations", label: "Organizations", group: "Administration" },
    { resource: "branches", label: "Branches", group: "Administration" },
    { resource: "roles", label: "Roles", group: "Administration" },
    { resource: "permissions", label: "Permissions", group: "Administration" },
    { resource: "users", label: "Users", group: "Administration" },
    { resource: "settings", label: "Settings", group: "Administration" },
    { resource: "audit", label: "Audit Logs", group: "Administration" },
    { resource: "notifications", label: "Notifications", group: "Administration" },

    // Business — the vertical slices staff actually work in day to day.
    { resource: "attendance", label: "Attendance", group: "Business" },
    { resource: "customers", label: "Customers", group: "Business" },
    { resource: "suppliers", label: "Suppliers", group: "Business" },
    { resource: "purchases", label: "Purchases", group: "Business" },
    { resource: "products", label: "Products", group: "Business" },
    { resource: "categories", label: "Categories", group: "Business" },
    { resource: "inventory", label: "Inventory", group: "Business" },
    { resource: "stock_movements", label: "Stock Movements", group: "Business" },
    { resource: "sales", label: "Sales", group: "Business" },
    { resource: "payments", label: "Payments", group: "Business" },
    { resource: "discounts", label: "Discounts", group: "Business" },
    { resource: "taxes", label: "Taxes", group: "Business" },
    { resource: "expenses", label: "Expenses", group: "Business" },
    { resource: "budgets", label: "Budgets", group: "Business" },
    { resource: "cash_register", label: "Cash Register", group: "Business" },
    { resource: "reports", label: "Reports", group: "Business" },
    { resource: "services", label: "Services", group: "Business" },
    { resource: "appointments", label: "Appointments", group: "Business" },
]);

const MODULE_RESOURCE_VALUES = Object.freeze(MODULE_CATALOG.map((entry) => entry.resource));

// ---------------------------------------------------------------------------
// Fine-grained actions for CUSTOM roles. Most modules use the standard CRUD
// set; a couple add a domain-specific action. "manage" is NOT listed here as a
// tickable action — it stays a SUPERSET that is accepted for every action, so
// every existing role/tier (all granted "<resource>:manage") keeps doing
// everything and nothing breaks. Standard REST methods map to CRUD actions
// (see METHOD_ACTIONS); the specials are enforced on top in their controllers.
// ---------------------------------------------------------------------------
const STANDARD_ACTIONS = Object.freeze(["view", "create", "edit", "delete"]);
const RESOURCE_ACTION_OVERRIDES = Object.freeze({
    sales: ["view", "create", "edit", "delete", "refund"],
    stock_movements: ["view", "create", "edit", "delete", "stock_adjustment"],
});
const actionsForResource = (resource) => RESOURCE_ACTION_OVERRIDES[resource] || STANDARD_ACTIONS;

const ACTION_LABELS = Object.freeze({
    view: "View",
    create: "Create",
    edit: "Edit",
    delete: "Delete",
    refund: "Refund",
    stock_adjustment: "Stock Adjustment",
    manage: "Manage (all)",
});

// The CRUD action a standard HTTP method requires. "manage" is always also
// accepted (see middlewares/permission usage in routes/index.js).
const METHOD_ACTIONS = Object.freeze({
    GET: "view",
    HEAD: "view",
    OPTIONS: "view",
    POST: "create",
    PUT: "edit",
    PATCH: "edit",
    DELETE: "delete",
});

/**
 * Is "<resource>:<action>" a permission this catalog defines?
 *
 * @param {string} permission e.g. "customers:create" or "sales:refund".
 * @returns {boolean}
 */
const isValidPermission = (permission) => {
    const [resource, action] = String(permission || "").split(":");
    if (!MODULE_RESOURCE_VALUES.includes(resource)) {
        return false;
    }
    return action === "manage" || actionsForResource(resource).includes(action);
};

// The module catalog enriched with each module's available actions — what the
// Roles page renders its permission matrix from.
const MODULE_CATALOG_WITH_ACTIONS = Object.freeze(
    MODULE_CATALOG.map((entry) => ({
        ...entry,
        actions: actionsForResource(entry.resource).map((action) => ({ action, label: ACTION_LABELS[action] || action })),
    }))
);

// Modules every organization member can MANAGE regardless of their
// role's grants — the baseline job of everyone on the floor, per the
// product's stated rule ("every user should be able to add customers,
// make sales, book appointments"):
//   - customers   → add/edit customers
//   - sales       → ring up a sale
//   - appointments→ book and manage appointments (offering a service)
// Enforced independently of any role's saved grants (see
// middlewares/permission.js) so a role in the Roles UI can never have
// these taken away, and a baseline change needs no re-login.
const BASELINE_RESOURCES = Object.freeze(["customers", "sales", "appointments"]);

// Read-only access every member ALSO needs for those baseline jobs to
// actually work:
//   - services → book an appointment / sell a service by picking from the
//     catalog. MANAGING the catalog (create/edit/deactivate) is NOT
//     baseline — it lives under Inventory, which is admin-only.
//   - products/discounts/taxes → a sale reads the catalog and the active
//     discounts/taxes applied at checkout
//   - users → the appointment booking form needs the staff list to pick
//     a provider (any staff member can be one)
// Granted as "<resource>:read", which authorizeResource() honors for GET
// requests only — so a cashier can load these but still can't create or
// change services, products, discounts, taxes, or staff.
const BASELINE_READ_RESOURCES = Object.freeze(["services", "products", "discounts", "taxes", "users"]);

// The concrete permission strings the two lists above resolve to, as a
// fast lookup for the authorization layer. A "<resource>:manage" baseline
// covers both reading and writing that resource; a "<resource>:read"
// baseline covers reads only.
const BASELINE_PERMISSION_SET = new Set([
    ...BASELINE_RESOURCES.map((resource) => `${resource}:${MODULE_ACTION}`),
    ...BASELINE_READ_RESOURCES.map((resource) => `${resource}:read`),
]);

/**
 * Is this exact permission string one every organization member holds by
 * baseline? Used by the permission middleware to grant baseline access
 * without consulting the (per-login) token, so baseline capabilities can
 * never be missing from an already-issued session.
 *
 * @param {string} permission e.g. "appointments:manage" or "products:read".
 * @returns {boolean}
 */
const isBaselinePermission = (permission) => BASELINE_PERMISSION_SET.has(permission);

// ---------------------------------------------------------------------------
// Access tiers — the simple, named levels chosen when adding a staff member
// (instead of picking modules one by one). Each is seeded as a role for the
// org (see roles.service.ensureTierRoles); the module grants below are ON TOP
// of the baseline everyone already has, so "Staff" needs no explicit grants.
//   - Staff       → baseline only (sell, book appointments, serve customers)
//   - Supervisor  → shop-floor oversight: inventory, purchasing, expenses,
//                   discounts/taxes, cash register, reports
//   - Admin       → full management of the org: everything except the
//                   developer-only cross-organization "organizations" module
//   - Super Admin → the organization owner (the privileged super_admin role
//                   created at registration; not seeded here)
// ---------------------------------------------------------------------------
const SUPERVISOR_RESOURCES = Object.freeze([
    "products",
    "categories",
    "inventory",
    "stock_movements",
    "services",
    "suppliers",
    "purchases",
    "expenses",
    "budgets",
    "discounts",
    "taxes",
    "cash_register",
    "reports",
]);

const ADMIN_RESOURCES = Object.freeze(MODULE_RESOURCE_VALUES.filter((resource) => resource !== "organizations"));

// The three tiers seeded per organization (super_admin already exists). Each
// tier's `resources` are granted as "<resource>:manage" (the superset). A few
// domain-specific actions aren't covered by a baseline "manage" (notably
// sales:refund, because sales:manage is itself baseline — see below), so a
// tier can also list `extraPermissions` granted explicitly.
const ROLE_TIERS = Object.freeze([
    { name: "staff", label: "Staff", description: "Basic staff — sell, book appointments, and serve customers.", resources: [], extraPermissions: [] },
    {
        name: "supervisor",
        label: "Supervisor",
        description: "Shop-floor oversight: inventory, purchasing, expenses, and reports.",
        resources: SUPERVISOR_RESOURCES,
        // Supervisor manages stock_movements, so stock adjustment is covered by
        // that "manage"; no extras needed.
        extraPermissions: [],
    },
    {
        name: "admin",
        label: "Admin",
        description: "Full management of the business — staff, roles, branches, and settings.",
        resources: ADMIN_RESOURCES,
        // Refund is gated on the explicit sales:refund action (sales:manage is
        // baseline, so it can't gate refund); grant it to Admin outright.
        extraPermissions: ["sales:refund"],
    },
]);

// All four tier role names, ascending by privilege (super_admin is the owner).
const TIER_ROLE_NAMES = Object.freeze(["staff", "supervisor", "admin", "super_admin"]);

module.exports = {
    MODULE_ACTION,
    MODULE_CATALOG,
    MODULE_RESOURCE_VALUES,
    BASELINE_RESOURCES,
    BASELINE_READ_RESOURCES,
    isBaselinePermission,
    ROLE_TIERS,
    TIER_ROLE_NAMES,
    STANDARD_ACTIONS,
    actionsForResource,
    ACTION_LABELS,
    METHOD_ACTIONS,
    isValidPermission,
    MODULE_CATALOG_WITH_ACTIONS,
};
