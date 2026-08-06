# Winstore ERP

Offline-first, modular ERP platform built around two major offerings that
share one checkout: **product retail** (catalog, stock, purchasing) and
**service booking** (a generic service catalog + appointments — any
service any business offers, not tied to one industry). A single sale can
mix a product line and a completed service appointment on one invoice.
The core platform itself is industry-agnostic so further verticals
(pharmacy, restaurant, …) can plug in without modifying it.

Conventions in brief (the original Master Instructions doc has been removed):
- **Stack:** Node/Express + PostgreSQL (JavaScript, not TypeScript) backend;
  React + Vite + Tailwind + Axios frontend. UUID primary keys, never SERIAL.
- **Layering:** Controller → Service → Repository → PostgreSQL. SQL lives only
  in repositories and migrations; business logic only in services; validation
  in dedicated `.validation.js` files. Multi-write operations use transactions.
- **Tenancy:** Organization → Branches → Users. Every business record belongs
  to an organization, most also to a branch.
- **API envelope:** always `{ success, message, data }` on success and
  `{ success, message, errors }` on failure — never invent new shapes.
- **Offline plan (deferred):** each branch will eventually run a local
  database with a manual sync button, local-always-wins, cloud as sync
  target. Not built yet — but prefer append-only tables, app-generated UUIDs,
  and status flags over hard deletes so it stays retrofittable.

### Design update — deep teal + warm neutrals
The color palette was reworked to a deep teal + warm neutral system (no
purple/indigo anywhere), and the separate Login/Register pages were merged
into a single tabbed `AuthPage` (Sign in / Create account, matching the
referenced design) with a dark teal marketing panel alongside the form.
`/login` and `/register` are both still valid, directly-linkable URLs — the
tab just follows whichever one you're on and swaps client-side from there.

### File structure reconciliation
Every backend module now consistently has exactly 5 files —
`routes/controller/service/repository/validation` — instead of the split
that had built up: some modules had 8 files (`+ mapper/constants/index.js`),
most had 5. Rather than retrofitting the fuller pattern onto 15+ untouched
modules, the 11 modules that had the extra files (`cash-register`,
`categories`, `customers`, `inventory`, `organizations`, `payments`,
`products`, `sales`, `stock-movements`, `services`,
`appointments` — some only had 1 of the 3 extra files) were
collapsed to match the majority:
- Row→response mapping (snake_case → camelCase, casting Postgres's
  stringified `NUMERIC` columns to real numbers) is kept — it's load-bearing,
  not cruft — but now lives inline in `service.js` instead of a separate
  `mapper.js`.
- Constants live wherever they're actually used — `validation.js` when
  shared with `service.js` (e.g. appointments' status-transition map),
  otherwise inline in whichever single file needs them.
- `index.js` files are gone — nothing in the codebase ever actually
  imported a module through them; cross-module reads (e.g. `sales.service.js`
  reaching into `products`, `stock-movements`, `appointments`) always
  went straight to the specific file needed.
- Two genuinely dead constants were found and dropped in the process:
  `TERMINAL_STATUSES` in appointments and `SALE_STATUSES`/
  `SALE_ITEM_TYPES` in sales — declared, never referenced anywhere.

`core/` vs `modules/` remains a two-way split (platform/tenancy concerns
vs. everything else) — the master doc's third `shared/` folder was never
built and isn't planned; that distinction never mattered in practice.

### Maintenance pass — tests, config, lint
A later cleanup pass fixed drift that had accumulated across the slices:
- Both backend test files had gone stale against the slice 3/5 refactors
  (they still imported the removed `inventory.validation`, and tested the
  old shapes of sales/payments/stock-movement validation). Updated to the
  current signatures — `npm test` is green again (28 tests).
- All configuration now flows through the validated `config/env.js`, which
  loads dotenv itself — `db.js` and `errorHandler.js` no longer read
  `process.env` directly, and `server.js`/`db.js` no longer each call
  `dotenv.config()` themselves.
- Added the `backend/.env.example` the setup instructions had always
  referenced but which never existed; deleted the empty, never-imported
  `utils/logger.js`; dropped the noisy per-connection pool log (startup
  already logs connectivity once).
- Frontend `npm run lint` is green. The new react-hooks v7
  `set-state-in-effect` rule is disabled in `eslint.config.js` (see the
  comment there) — it flags the deliberate plain fetch-on-mount pattern
  every page uses, and adopting a data-fetching library just to satisfy it
  isn't worth the dependency. `AuthContext` did get a real fix: `loading`
  now starts as `Boolean(token)` instead of being set inside the effect.

## Status

**Vertical slice 1: Auth + Organization setup — complete, end-to-end.**
**Vertical slice 2: Salon Management (Services + Appointments) — complete, end-to-end** (later generalized into an industry-agnostic Services module — see Slice 18).
**Vertical slice 3: Inventory / Products — complete, end-to-end.**
**Vertical slice 4: Customers — complete, end-to-end.**
**Vertical slice 5: Sales / Checkout — complete, end-to-end.**
**Vertical slice 6: Discounts & Taxes in checkout — complete, end-to-end.**
**Vertical slice 7: Suppliers & Purchases — complete, end-to-end.**
**Vertical slice 8: Reports — complete, end-to-end.**
**Vertical slice 9: Expenses — complete, end-to-end.**
**Vertical slice 10: Roles, Permissions & Staff — complete, end-to-end.**
**Vertical slice 11: Password Reset — complete, end-to-end.**
**Vertical slice 12: Forced Password Change & Multi-Branch Access — complete, end-to-end.**
**Vertical slice 13: Branch Row-Level Enforcement & Branches UI — complete, end-to-end.**
**Vertical slice 14: Sales Page Redesign & Walk-in Checkout — complete, end-to-end.**
**Vertical slice 15: App Shell Redesign & Semantic Button Colors — complete, end-to-end.**
**Vertical slice 16: Role-Based Access Reflected on the Frontend — complete, end-to-end.**
**Vertical slice 17: Developer Role: Cross-Organization CRUD — complete, end-to-end.**
**Vertical slice 18: Generalize Salon → Services (industry-agnostic) — complete, end-to-end.**
**Vertical slice 19: Bulk Excel Import/Export — complete, end-to-end.**
**Vertical slice 20: Barcode, Reorder Level, Opening Stock, Expiry/Batch Tracking — complete, end-to-end.**
**Vertical slice 21: Developer-Only Hard Delete — complete, end-to-end.**
**Vertical slice 22: Staff Attendance (Kiosk Check-In/Out) — complete, end-to-end.**
**Vertical slice 23: Subscription / Tenant Billing — complete, end-to-end.**
**Vertical slice 24: Sale Returns, Change Given & Session Invalidation — complete, end-to-end.**
**Vertical slice 25: Staff Profiles, Photos & Nigerian Locale Defaults — complete, end-to-end.**
**Vertical slice 26: Row Level Security (DB-enforced tenant isolation) — complete, end-to-end.**
**Vertical slice 27: Reports Suite (13 reports) — complete, end-to-end.**
**Vertical slice 28: Customer Credit Ledger (selling on account) — complete, end-to-end.**
**Vertical slice 29: Access Tiers & Granular Permissions — complete, end-to-end.**
**Vertical slice 30: Server-Side Pagination — complete, end-to-end.**
**Vertical slice 31: Optimistic Locking — complete, end-to-end.**
**Vertical slice 32: Observability, Request Ids & Backups — complete, end-to-end.**
**Vertical slice 33: Production Hardening & Deployment Packaging — complete, end-to-end.**
**Vertical slice 34: Offline Sync Engine (branch ↔ head office) — complete, dormant unless `SYNC_ENABLED`.**
**Vertical slice 35: Cross-Branch Shipments — complete, end-to-end.**
**Vertical slice 36: Held / Parked Sales — complete, end-to-end.**
**Vertical slice 37: Desktop App (Electron + bundled Postgres) — complete.**

Every module listed above is wired end to end — real Postgres tables, a
real Express API, and a real React frontend calling it, with no mocked
data. (An earlier version of this section described Expenses, Budgets,
Taxes, Discounts, Suppliers, Purchases, Cash Register and Reports as
"backend-only scaffolding"; they have all since been completed.)

Tenant isolation is enforced by the database itself (Slice 26), not by
convention in the queries. The offline-sync engine (Slice 34) is built
and tested but **dormant** — nothing captures, ships, or schedules
anything unless `SYNC_ENABLED=true`, so a plain cloud or single-shop
install carries none of its cost.

### Slice 1 — what was fixed
See the earlier review for the full list. Highlights: permission-based
authorization was non-functional (JWT never carried permissions) — fixed via
a new `role_permissions` table; `settings`/`audit_logs` tables were queried
but never created — added; the documented auto check-in/out attendance rule
is now implemented; a crash bug in `attendance.controller.js` is fixed; JWT
secret now goes through validated `env.js` everywhere; added `helmet` +
rate limiting on `/auth/register` and `/auth/login`.

### Slice 2 — Salon Management
New industry module at `backend/src/modules/` (kept separate from `core/`
and the shared business modules, per the master doc's "Core Platform must
never contain salon-specific logic" rule):

- **`salon-services`** — service catalog (name, duration, price,
  active/inactive), scoped per organization and optionally per branch.
- **`salon-appointments`** — booking, with two real business rules, not just
  CRUD:
  - **Double-booking prevention**: a stylist cannot be booked for two
    overlapping appointments. Enforced server-side with a time-range
    overlap query, not just a UI nicety.
  - **Status lifecycle**: `scheduled → completed | cancelled | no_show`.
    Terminal statuses can't be changed again — enforced in the service
    layer, not just hidden in the UI.
  - Duration and price are **snapshotted onto the appointment** at booking
    time, so a later edit to a service's price doesn't rewrite history for
    appointments already booked.

Both modules follow the master doc's full file convention (`routes` /
`controller` / `service` / `repository` / `validation` / `mapper` /
`constants` / `index.js`) — this is a stricter standard than most of the
pre-existing shared modules, which are missing `mapper`/`constants`/
`index.js`. Worth retrofitting those later for consistency; not done here
to avoid touching code outside this slice's scope.

New migrations: `023_create_salon_services.sql`, `024_create_salon_appointments.sql`.

Frontend: a `Salon · Services` and `Salon · Appointments` page, reachable
from a new left-hand nav (`AppLayout`) that now wraps the dashboard. The
appointment form pulls real customers, real staff, and the real active
service list from the API — nothing hardcoded.

**Known simplification:** any active user in the organization can be picked
as a "stylist" — there's no dedicated staff/stylist role or specialty list
yet. Fine for this slice; worth a real Staff concept later if the business
needs to distinguish stylists from, say, back-office users.

**Renamed in Slice 18:** everything in this section is preserved as a
historical record of what was originally built — but the module, tables,
routes, and the "stylist" field described here were all later generalized
into an industry-agnostic Services module (`salon-services` → `services`,
`salon-appointments` → `appointments`, `stylist_id` → `provider_id`, and
the routes moved from `/salon/services`+`/salon/appointments` to
`/services`+`/appointments`). See Slice 18 for the full rename and why.

### Slice 3 — Inventory / Products
This one started with a real architectural bug, not just missing UI: the
pre-existing `products` table (catalog) and `inventory_items` table (stock
tracking) were completely disconnected — separate `name`/`sku` fields, no
foreign key between them, so the same item had to be entered twice with no
link. Worse, `inventory_items` had no `branch_id` at all, meaning stock
quantity was a single global number despite this being a multi-branch
platform by design.

Fixed by connecting stock tracking to the real catalog instead of patching
the disconnected table:
- `products` gained `category_id` (linked to the existing categories
  module), `cost`, a missing `organization_id` foreign key, and a
  `(organization_id, sku)` uniqueness constraint it never had.
- New `product_stock` table: one row per `(branch, product)`, so quantity
  is genuinely per-branch.
- `stock_movements` now references `product_id` instead of the removed
  `inventory_item_id`, and `branch_id` is mandatory. The transactional
  logic itself (row-locking with `FOR UPDATE`, refusing to let stock go
  negative) was already well-built in the original scaffolding — it's kept
  as-is, just retargeted at the right tables.
- `inventory_items` table dropped; the `inventory` module is now a
  read-only current-stock view (`GET /inventory`, joined with product and
  branch names). All quantity changes happen through
  `POST /stock-movements` — there's deliberately no "edit quantity"
  shortcut anywhere, so every change has an audit trail.

New migrations: `025_alter_products_add_category.sql`,
`026_create_product_stock.sql`, `027_migrate_stock_movements_to_products.sql`,
`028_drop_inventory_items.sql`.

Frontend: `Inventory · Products` (catalog, with inline category creation so
you're never stuck needing a curl command like the Customers gap in slice 2)
and `Inventory · Stock` (current stock levels + a movement-recording form
covering stock in / stock out / adjustment, with a running history and a
low-stock flag once quantity drops to or below the reorder level).

**Design note:** stock levels are scoped to the logged-in user's own
branch in the UI for now (same simplification pattern as the
appointments page) — a branch switcher for multi-branch staff is a
reasonable follow-up, not done here.

### Slice 4 — Customers
This closes the gap flagged in slice 2 (booking an appointment required a
curl command to create a customer first — there was no UI). Along the way,
`customers` got the same class of fix as `products` did in slice 3:

- Missing `organization_id` foreign key constraint — added.
- No uniqueness on email within an organization — added
  `(organization_id, email)` unique constraint, enforced with a friendly
  409 error rather than a raw duplicate-key crash.
- Added `PATCH /customers/:id` (there was create-and-list only before) and
  a `search` query param (matches name or email, case-insensitive).

New migration: `029_alter_customers.sql`.

Frontend: a `Customers` page — search-as-you-type, add form, inline edit,
and activate/deactivate. The Appointments page's customer dropdown now has
a real page to point people to instead of a curl command.

### Slice 5 — Sales / Checkout
This was the biggest gap of all: `sales` was just a flat `total_amount`
with no line items and no link to what was actually sold, and `payments`
had no connection to `sales` at all — no `sale_id` column. This directly
contradicted the platform's own stated goal, right there in the auth
screen's marketing copy: "one invoice for services and products." Nothing
in the codebase actually did that.

Fixed by building the real checkout transaction:
- `sales` gained `branch_id`, a real `subtotal`/`discount_amount`/
  `tax_amount`/`total_amount` breakdown, and missing `organization_id`/
  `customer_id` foreign keys.
- New `sale_items` table — the missing line-item link. Each row is either
  a `product` (deducts stock) or a `service` (a completed appointment
  being billed). A `CHECK` constraint enforces exactly one reference
  matches the type, and a `UNIQUE` constraint on `appointment_id` (renamed
  from `salon_appointment_id` in Slice 18) means an appointment can only
  ever be billed once — enforced at the database level, not just in
  application code.
- `payments` gained `sale_id` (now mandatory) and `method`.
- Checkout runs as one transaction: product prices are always read from
  the product catalog (never trusted from the client), and stock is
  deducted using the exact same row-locking logic `stock-movements`
  already used in slice 3 — reused directly, not reimplemented — so a
  sale and its stock deduction always succeed or fail together. A service
  line item must reference a `completed`, not-yet-billed appointment
  belonging to the *same customer* as the sale, and its price comes from
  the price already snapshotted on that appointment back in slice 2.

New migrations: `030_alter_sales.sql`, `031_create_sale_items.sql`,
`032_alter_payments.sql`. `appointments` also gained an `uninvoiced`
list filter so checkout can find billable appointments.

Frontend: a `Sales` page — pick a customer, add products and/or their
completed unbilled appointments to a cart, pick a payment method, and
complete the sale as one invoice. A recent-sales table underneath shows
customer, item count, and total for everything checked out so far.

**Deliberate scope boundary (closed by slice 6):** `discounts` and `taxes`
existed in the codebase but weren't wired into checkout at the time —
`subtotal === total_amount`. Slice 6 wired them in.

### Slice 6 — Discounts & Taxes in checkout
This closes slice 5's deliberate scope boundary: the `discounts` and
`taxes` scaffolding is now real and wired into the checkout math. Both
modules got the same hardening pass earlier slices gave customers/products
(migration `033_wire_discounts_and_taxes.sql`):

- Missing `organization_id` foreign keys — added to both tables.
- `(organization_id, code)` uniqueness on discounts (case-insensitive
  check with a friendly 409), and a `0–100` range check on tax rates.
- `sales` gained a nullable `discount_id` for traceability — but the
  *amount* is still snapshotted onto `sales.discount_amount` at checkout,
  so editing a discount later never rewrites past invoices (same
  snapshotting rule as appointment prices in slice 2).

The checkout rules, all computed server-side inside the same transaction:
- **Discount**: a flat amount selected per sale, looked up by id (must be
  active, must belong to the org), clamped to the subtotal so a large
  discount can't push a total negative.
- **Tax**: every *active* tax for the organization applies to the
  discounted subtotal; the summed amount is snapshotted onto the sale, so
  deactivating or re-rating a tax only affects future sales.
- `total = subtotal − discount + tax`, every figure rounded to 2 decimals,
  and the payment row is created for the final total.

Both modules also gained `PATCH /:id` for activate/deactivate — records
referenced by past sales can't be deleted, only deactivated, so history
stays intact.

Frontend: a `Billing · Discounts & Taxes` page (add/deactivate both), and
the Sales page now has a discount picker plus a live subtotal / discount /
tax / total breakdown that mirrors the server's math (the server's numbers
remain authoritative).

### Slice 7 — Suppliers & Purchases
This gives stock-in a real business origin: before this slice, the only
way stock entered the system was a manual "stock in" movement with no
record of where it came from or what it cost.

`suppliers` got the customers treatment (migration
`034_wire_suppliers_and_purchases.sql`): organization FK,
`(organization_id, email)` uniqueness with a friendly 409, a `search`
param, and `PATCH /suppliers/:id` for edits and activate/deactivate.

`purchases` got the sales treatment: it was a flat `total_amount` with no
line items, no branch, and no FKs. Now:
- New `purchase_items` table — product, quantity, and `unit_cost`
  **snapshotted at order time**. Unlike sales, unit costs ARE taken from
  the client: a purchase price is negotiated with the supplier, not read
  from the catalog — but they're validated as non-negative numbers and
  the total is still computed server-side.
- Status lifecycle `pending → received | cancelled`, both terminal (same
  rule as appointments). Orders can only be placed against active
  suppliers.
- **Receiving is the point of the slice**: marking an order received
  stocks in every line item through the exact same row-locking
  `product_stock` + `stock_movements` path sales uses on the way out —
  in one transaction, so an order can never be half-received. Each
  movement is logged with reason "Purchase received". Cancelling touches
  nothing.

Frontend: `Purchasing · Suppliers` (search/add/edit/deactivate, mirroring
Customers) and `Purchasing · Purchases` (pick a supplier, add products
with quantity + unit cost, place the order, then Receive or Cancel it
from the orders table — received stock shows up on `Inventory · Stock`
immediately).

### Slice 8 — Reports
The old `reports` table was the same wrong model `inventory_items` was in
slice 3: it stored a title/type/status row per "generated" report with no
content at all — nothing anyone could read back. Same fix as slice 3:
dropped the table (migration `035_drop_reports_table.sql`) and made the
module read-only and *computed* — every number is aggregated live from
the real tables at request time, so reports can never drift from the data
they summarize.

Three endpoints, all scoped by organization + optional branch and a
half-open `[from, to+1day)` date range (default: last 30 days):
- `GET /reports/summary` — sales count/subtotal/discounts/tax/revenue
  (paid sales), purchase spend (received orders, by `received_at`),
  appointments completed/scheduled/not-kept, and new customers.
- `GET /reports/top-items` — revenue ranking across *both* product and
  service line items, resolving real product/service names from the
  catalog (top 10).
- `GET /reports/low-stock` — products at or below their reorder level
  (not date-bound).

Frontend: a `Reports` page — date-range picker, a KPI tile row (revenue,
sales, discounts given, tax collected, purchase spend, appointments
completed, new customers), top items by revenue, and the low-stock list
for the user's branch.

### Slice 9 — Expenses
`expenses` had the same gap `purchases` had before slice 7: no
organization FK, no branch, and a `status` column nothing ever set beyond
its `pending` default. Wired to the same pattern as purchases (migration
`036_wire_expenses.sql`):

- Organization FK, mandatory `branch_id`, a free-text `category` (no new
  categories table — that one's product-specific; a plain indexed column
  is the simpler fit here), and `created_by`.
- Lifecycle `pending → paid | cancelled`, both terminal (same rule as
  purchase orders). `paid_at` is stamped when marked paid.
- Reports only count `paid` expenses as real spend — a cancelled expense
  never happened, same principle as a cancelled purchase never touching
  stock.

`GET /reports/summary` gained an `expenses: { count, total }` block (paid
only, within the date range), and the Reports page shows it as a new
"Expenses (paid)" tile alongside revenue and purchase spend.

Frontend: an `Expenses` page — record a description, category, and
amount for the branch; Mark paid or Cancel from the list once recorded.

### Slice 10 — Roles, Permissions & Staff
This closes the gap flagged back in slice 1: permission-based
authorization existed structurally (`role_permissions`, the
`requireAnyPermission` middleware) but nothing in the product let an
admin actually *use* it — registration only ever created 5 of the 26
protected modules as permissions (the admin-only ones), and `roles`/
`users` had no PATCH endpoints at all. A staff member could only ever be
fully privileged (the `super_admin` role-name bypass) or fully blocked.

**The permission model:** a new fixed catalog
(`permissions.catalog.js`) lists all 26 modules protected by
`useProtectedResource()` in `routes/index.js` — everything from Sales
and Customers to Roles and Users. Every organization is provisioned one
`<resource>:manage` permission per module (migration
`037_wire_roles_permissions_catalog.sql` backfills existing
organizations; `auth.service.register` provisions new ones). One
`manage` permission per module is sufficient — the existing
`authorizeResource` middleware already accepts `:manage` for both read
and write requests, so **one checkbox per module is enough**; there's no
separate read-only tier.

**Roles** (`POST/PATCH /roles`) now take a `resources: string[]` — the
checked module keys — and resolve them to that organization's existing
permission rows inside a transaction that replaces the role's
`role_permissions` set (never accumulates stale grants). Two guards
worth knowing about:
- Creating or renaming a role to `"super_admin"` is rejected. That exact
  role *name* — not the `is_system` flag — is what
  `middlewares/permission.js` checks for its full-access bypass, so a
  staff-created role with that name would have been a silent
  privilege-escalation bug.
- The system admin role (`is_system = true`, created at registration)
  can't be edited at all — 409. Renaming or reshaping it risks breaking
  the bootstrap admin's own access with no recovery path.
- `GET /roles/catalog` returns the static module list (grouped
  Administration / Business) for building the checkbox UI, gated behind
  the same `roles:manage` permission needed to use it.

**Users** (`POST/PATCH /users`) gained a real "add staff" flow: a
required password (min 8 characters, same rule as registration — the
old silent `"welcome123"` default is gone), a friendly 409 on duplicate
email, and validation that a submitted `roleId`/`branchId` actually
belongs to the same organization. `PATCH /users/:id` assigns a different
role/branch or toggles `isActive` — deactivating blocks the user's next
login (already-enforced in `auth.service.login`) without deleting
anything.

**A JWT carries the permissions it was issued with** — narrowing or
widening a role only takes effect the next time an affected user logs
in, not retroactively on tokens already issued. This is standard JWT
behavior, not a bug, and is worth remembering when testing role changes.

Frontend: an `Administration · Roles` page (name, description, and
checkboxes grouped by category; editing loads a role back into the same
form) and `Administration · Staff` page (add staff with branch + role
dropdowns; edit re-assigns branch/role; Activate/Deactivate).

**Known simplification:** access to these two pages isn't hidden in the
nav based on the viewer's own permissions — like every other page, the
link is always visible and the backend is the actual enforcement point,
so a staff member without `roles:manage`/`users:manage` sees the nav
entry but gets a 403 from the API. Consistent with how the rest of the
app already works (no page in the nav is conditionally hidden). Password
reset for existing staff isn't part of this slice either.

### Slice 11 — Password Reset
Closes the gap flagged at the end of slice 10. No email infrastructure
exists anywhere in this stack (no SMTP config, no mail dependency), and
the master doc's offline-first ambition doesn't assume constant email
access either — so rather than bolt on a "forgot password" email flow
that would need new infrastructure, this adds the two paths that fit an
admin-managed, no-email model:

- **Self-service** (`PATCH /auth/change-password`): any authenticated
  user changes their own password by providing their current one — the
  "I know it but want to change it" flow. Verified with `bcrypt.compare`
  against the stored hash before allowing the change.
- **Admin reset** (`PATCH /users/:id/password`): a `users:manage` holder
  sets a new password for a staff member directly, no current password
  needed — the "they forgot it" flow, gated by the same permission that
  already lets an admin create and edit staff.

**One guard worth knowing about, mirroring slice 10's system-role
protection:** admin reset is refused (409) for any user whose *role* is
the system admin role — not just the original bootstrap admin, but
anyone later assigned that role too. A lower-privileged holder of
`users:manage` (say, a custom role that only checked "Users" and not
"Roles") resetting a co-admin's password out from under them would be a
privilege-escalation path. The admin's own password always goes through
self-service instead, which proves they still know the current one.
There's deliberately no recovery path if an admin forgets their password
and can't log in at all — for a single-tenant, self-hosted app with no
email, that's an accepted limitation rather than a hole to route around.

Frontend: a `Change Password` page (available to every user regardless
of permissions — it's an identity action, not a business-module one;
it lives in the sidebar's Administration group for navigation purposes
only, not because it's admin-gated) and a `Reset password` action inline
on each row of the `Administration · Staff` table (hidden for rows whose
role is the system role, matching the backend guard).

### Slice 12 — Forced Password Change & Multi-Branch Access
Two admin-facing gaps closed together: staff accounts created (or
reset) by an admin now force a real password change before anything
else works, and a user can be granted more than one branch instead of
exactly one.

**Forced password change.** `users.must_change_password` (migration
`038_add_must_change_password.sql`, backfilled to `false` for every
existing user so nobody already using the app is suddenly locked out)
is set `true` whenever an admin creates a staff account or resets a
password — both are "someone else knows this password" situations — and
cleared only by the self-service change-password flow, which proves the
user now knows one only they do. Self-registered admins are never
forced; they chose their own password knowingly at registration.

This is enforced on the **backend**, not just hidden in the UI —
`middlewares/auth.js` rejects every route except `/auth/me` and
`/auth/change-password` with a 403 while the flag is set, reading it
from the JWT the same way permissions are read. That surfaced a real
bug before it shipped: a token issued at login carries whatever
`mustChangePassword` value it was signed with, so simply clearing the
flag in the database after a successful change wouldn't have been
enough — the *old* token would keep enforcing the stale claim until its
next login. `changePassword` now returns a **freshly signed token**
(same as slice 10's "permissions only update on next login" caveat, but
solved here rather than just documented) and the frontend swaps it in
immediately via `AuthContext.applyNewToken`, so a user isn't
paradoxically locked out by successfully completing the one thing that
was supposed to unlock them.

**Multi-branch access.** A new `user_branches` join table (migration
`039_create_user_branches.sql`) lets a user be granted more than the
single `users.branch_id` (kept as their primary/home branch). No
backfill was needed: `branches.service.getAccessibleBranchesForUser`
falls back to just the primary branch when a user has zero explicit
grants, so every existing user keeps working unchanged. `POST/PATCH
/users` accept a `branchIds` array (the "additional access" checkboxes
on the Staff form) which the backend **always unions with the primary
branch** before validating and persisting — the admin never needs to
remember to also check their own primary branch's box.

`GET /auth/me` and `/auth/login` now return `accessibleBranches`, and
the frontend gained a **branch switcher** in the header (only rendered
for users with more than one) — `AuthContext` tracks which branch the
user is currently "acting as", persisted per-user in localStorage. The
seven branch-scoped pages (Stock, Sales, Purchases, Expenses, Reports,
Appointments booking, and the Dashboard's own branch tile) now
read the *active* branch instead of always the user's primary one, and
reload automatically when the switcher changes.

**Originally shipped without:** row-level enforcement that a user can
only query branches they're actually granted — branch filtering was a
frontend-driven UI default, not a security boundary, so any
authenticated org member could pass a different `branchId` query param
or body field and read or write another branch's data. Closed in
slice 13 below, along with the missing Branches management UI.

### Slice 13 — Branch Row-Level Enforcement & Branches UI
Closed both gaps flagged at the end of slice 12.

**Branch row-level enforcement.** A new `middlewares/branchScope.js`,
applied the same way `organizationScope.js` already is, to the seven
genuinely branch-scoped resources (`sales`, `purchases`, `expenses`,
`reports`, `stock-movements`, `inventory`, `appointments`):
- An explicit `branchId` in the query string or body is rejected with
  403 unless it's in the caller's accessible set (their `user_branches`
  grants, or just their primary branch when they have none).
- A single-branch user who omits `branchId` entirely now gets it
  defaulted to their one accessible branch server-side, instead of the
  repository's old "blank means every branch in the org" default.
- A multi-branch user who omits it gets a 400 asking them to pick one —
  the frontend's branch switcher already always sends one, so this
  only affects direct API calls.
- The organization's owner (`role === "super_admin"`) is exempt, same
  as the existing permission-bypass rule — an owner sees every branch
  in their own org by design, not by a gap.

The five id-based fetch/status-update endpoints that don't take a
`branchId` filter at all (`GET /sales/:id`, `GET /purchases/:id`, and
the `expenses`/`purchases`/`appointments` status-update routes)
are guarded separately, inside each service, via the shared
`utils/assertBranchAccessible.js`: the record's own `branch_id` is
compared against the caller's accessible set and a 404 (not 403, so a
limited user can't distinguish "wrong branch" from "doesn't exist") is
thrown on mismatch.

**Deliberately still out of scope:**
- `services` (called `salon_services` before Slice 18's rename) — its
  `branch_id` is nullable by design (migration 023: null means "offered
  at every branch"), so it's an org-wide
  catalog with an optional branch tag, not an access boundary. Forcing
  branch-scope validation onto it would wrongly block a multi-branch
  admin from managing catalog entries and reject legitimate null-branch
  rows, so it stays under plain organization scoping.
- `cash-register` transactions key off `cashRegisterId`, not
  `branchId`, directly — resolving that to a branch would mean an
  extra lookup for a module with no frontend page yet, so it also
  stays under plain organization scoping rather than forcing an
  awkward `branchId` requirement onto an endpoint that never had one.

**Branches management UI.** `PATCH /branches/:id` (rename, recode, or
toggle `isHeadquarters`) plus a new `Administration · Branches` page —
list, create, and inline-edit, matching the Suppliers page's pattern.
No delete: a branch already referenced by sales, stock, staff, etc.
can't be safely removed, same reasoning as every other "deactivate,
don't delete" resource in this app (branches have no active flag to
deactivate either, so for now they're simply permanent once created).

### Slice 14 — Sales Page Redesign & Walk-in Checkout
Two changes to the checkout screen: a catalog-browsing layout, and a
customer is no longer required to complete a sale.

**Walk-in checkout.** `sales.customer_id` was `NOT NULL`; migration
`040_make_sale_customer_optional.sql` drops that constraint. A sale
with no `customerId` is a walk-in — `toSaleResponse` reports its name
as `"Walk-in"` rather than leaving it blank, and both sale list queries
switched from `INNER JOIN customers` to `LEFT JOIN` so walk-in sales
don't silently vanish from "Recent sales" or reports. A completed
appointment can still only be billed to the customer it was booked
under (that check was already in `resolveLineItem` and didn't need to
change) — a walk-in cart is products-only in practice, since the
appointments-to-bill list only ever loads once a customer is picked.

**Sales page layout.** Rebuilt around three fixed zones instead of a
single stacked form: a live search bar filtering the product catalog
by name/SKU, the catalog itself as a paginated table in the center
(click **Add** to add a line — a second click on the same product
merges into its existing cart line rather than duplicating it), and
cart + discount + totals + payment + **Complete sale** in a fixed
panel on the right. Customer selection moved into that right panel
and is explicitly labeled optional, defaulting to "Walk-in (no
customer)". A small `PaginationBar` (Previous / numbered pages with an
ellipsis for long runs / Next) is used for both the catalog table and
the "Recent sales" table below, client-side over data already being
fetched in full — there's no new paginated backend endpoint here, just
client-side slicing, since sales/product volumes don't yet justify a
server-side cursor.

**Still open / not touched by any slice so far:** the `notifications`
table is still missing (same gap as `settings`/`audit_logs` were before
slice 1).

### Slice 15 — App Shell Redesign & Semantic Button Colors
A full visual pass across every authenticated screen — no backend or
data changes, `frontend/src/index.css` and `AppLayout.jsx` plus a
button-class swap in all 16 page files.

**App shell.** `AppLayout` was a centered `max-w-6xl` column with a
light sidebar above the content. It's now a true full-bleed shell: a
dark teal sidebar (`--color-panel` → `--color-panel-deep` gradient,
already used for the Auth page's marketing panel — now shared) fixed
to the far left with a small hand-drawn icon per nav entry, and a
patterned dark header spanning the rest of the top edge — a radial dot
grid plus a diagonal sheen, both deliberately echoing the ledger-card's
own "punch holes" motif so the new dark chrome still reads as the same
design language, just inverted. Dropping the centered max-width means
a page's content genuinely reaches both edges now — which is what
makes Sales' cart panel actually sit flush against the right edge of
the window instead of just the right edge of a centered column. That
cart panel also gained `sticky`, so it stays in view while the catalog
list scrolls beneath it.

**Buttons now mean something by color**, consistently across every
page — `index.css` gained three reusable shapes (`.btn-solid` for
full-width form submissions, `.btn-link` for table-row actions,
`.btn-chip` for compact inline adds), each with `-primary` (teal:
create/save/submit), `-success` (green: activate, receive, mark paid,
complete), `-danger` (clay: deactivate, remove, cancel, void), and
`-warning` (new amber accent: reset password, mark a no-show, a stock
adjustment) variants. This also fixed a real, pre-existing bug: every
"Deactivate/Activate" toggle (Customers, Products, Suppliers, Staff,
Billing's taxes/discounts, Services) rendered in a single fixed
color regardless of which action the button actually performed at that
moment — so "Activate" looked exactly like "Deactivate". Every one of
those toggles is now conditional on the record's own status. Stock's
"Record movement" button goes further and changes color with the
selected movement type (green for in, clay for out, amber for
adjustment) — the clearest single example of a button's color tracking
its actual effect rather than just its position on the page.

### Slice 16 — Role-Based Access Reflected on the Frontend
Permissions were already enforced correctly on the backend (slice 10) —
a role without a module's permission got a 403 no matter what. But the
frontend never hid anything: every nav link and every page rendered
for every signed-in user regardless of their role, so a limited staff
member would see the full sidebar and only find out a module was off
limits by clicking into it and hitting "You do not have permission to
perform this action."

**The actual bug:** `GET /auth/login` has always returned `permissions`
in its response (they're embedded in the JWT itself), but `GET
/auth/me` — the endpoint `AuthContext` actually calls on every page
load and refresh — never did. So even a frontend permission check
would have had nothing to check against outside the few seconds
between login and the next refresh. Fixed by resolving the same
`role_id → permissions` lookup `login()` already does and including it
in `me()`'s response too.

**Frontend enforcement, two layers:**
- `AuthContext.hasPermission(resource)` — `true` unconditionally for
  `role === "super_admin"` (mirrors the backend's own bypass in
  `middlewares/permission.js`), otherwise checks `<resource>:manage`
  against the user's permissions. Accepts a single resource or an
  array (`hasPermission(["taxes", "discounts"])`) for a page built from
  more than one resource.
- `AppLayout`'s nav items each carry a `resource` field now; a link (or
  a whole group, if every child in it would be hidden) simply isn't
  rendered when `hasPermission` fails. `RequirePermission`, a new small
  route wrapper, backstops this in `App.jsx` on every gated route —
  nav hiding the link doesn't stop someone from typing the URL
  directly, so each route redirects to the dashboard if the permission
  isn't there, same silent-redirect pattern `ProtectedRoute` already
  uses for `mustChangePassword`.

**Deliberately not solved here:** the permission model is one grant per
module covering both read and write (documented already in
`permissions.catalog.js` — "no separate read-only tier"), and several
pages are genuinely built from more than one resource under the hood
(Sales also reads customers/products/discounts/taxes/appointments;
Purchases also reads suppliers/products; Stock reads both `inventory`
and `stock_movements`). This slice gates each page's nav link and route
on its one primary/most-representative resource, matching how the
route itself is protected in `routes/index.js` — a custom role narrow
enough to have the primary resource but not a secondary one used only
for a dropdown could still see a partial-page error. Untangling that
would mean either a second permission tier or per-field conditional
rendering inside already-built pages; flagged here as a known
boundary rather than expanded into, since in practice every role
created so far (including this slice's own test role) grants the
resources a page needs together.

### Slice 17 — Developer Role: Cross-Organization CRUD
A new reserved role, "developer" — everything a `super_admin` can do,
plus full CRUD (create, rename/re-slug, deactivate/reactivate, list)
across every organization registered on the software, not just the
developer's own. This is the first legitimate exception to the
organization-isolation rule every other resource in this app follows.

**Where the line is drawn.** A developer's cross-organization reach is
scoped specifically to the `organizations` table itself (its name,
slug, active/inactive status) — not a backdoor into every tenant's
private business data. `enforceOrganizationScope` is untouched for
everything else; a developer's own sales, customers, branches, etc.
still work exactly like any other organization's, scoped to their own
`organization_id`. `/organizations` itself was never conceptually
organization-scoped to begin with — organizations *are* the tenancy
root, so there's no "which organization does this organization belong
to" to enforce — it's now gated on the exact role `"developer"`
(`middlewares/permission.js`'s new `requireRole`) instead of the
generic per-org permission system.

**"Delete" is a status flip, not a cascade.** Same reasoning as every
other resource in this app (branches, staff, suppliers, products…),
except more so here: an organization already has its own branches,
users, and years of business records under it by the time anyone
would want to remove it, so `PATCH /organizations/:id` with
`{ "status": "inactive" }` is the only "delete" this needed.

**One shared bypass, not four copies of the same check.** Every place
that used to check `role === "super_admin"` literally (the permission
middleware, branch scoping, and four controllers' `assertBranchAccessible`
calls) now goes through `utils/isPrivilegedRole.js`'s `PRIVILEGED_ROLES`
list — adding "developer" once there, instead of hunting down every
scattered string comparison, is what makes "all the access a
super_admin has" actually true everywhere at once rather than in
whichever spots happened to get updated.

**Provisioning is deliberately not self-service.** "developer" joins
"super_admin" as a reserved role name (`roles.validation.js`) — a
regular organization can't create a role with this name and grant
itself platform-wide reach. The only way to create one is
`backend/scripts/create-developer.js <email>` (or `npm run
create-developer -- <email>`), run directly against the database by
whoever operates this deployment. This is a deliberate choice: exposing
this as an HTTP endpoint, even a permission-gated one, would turn "some
bug in the permission system" into "a stranger can make themselves a
platform operator" — a mistake worth avoiding by construction rather
than by hoping every other check stays correct forever. The promoted
user must log out and back in — same "permissions embedded in the JWT"
caveat this app has documented since slice 10.

**Frontend.** `AuthContext.hasPermission` bypasses for `developer` the
same way it already did for `super_admin`. A new "Organizations" nav
item — its own top-level entry, not nested under Administration, since
it's a platform concern rather than a tenant-administration one — and
its route are gated on a plain `user.role === "developer"` check
(`RequireDeveloper`), not a resource permission, since this isn't
something any organization ever grants itself. `OrganizationsPage`
follows the same list/create/inline-edit pattern as Branches/Staff/etc,
with the Deactivate/Activate toggle using the semantic button colors
from slice 15.

### Slice 18 — Generalize Salon → Services (Industry-Agnostic)
Winstore ERP is built around **two major offerings that share one
checkout**: product retail (catalog, stock, purchasing) and service
booking (a service catalog + appointments). Slice 2 built the second
half of that as "Salon Management" specifically — a haircut-and-stylist
model baked into the module name, the table names, and the field names.
This slice removes that assumption entirely: any service any business
offers (a house cleaning, a consulting hour, a tutoring session — a
haircut is just one example among many now) can be entered the same
way, and the person who performs it is a generic "provider," not
specifically a "stylist."

**What actually changed, not just what it's called:**
- Tables: `salon_services` → `services`, `salon_appointments` →
  `appointments` (migration `041_generalize_salon_to_services.sql` —
  `ALTER TABLE ... RENAME`, not a drop/recreate, so no data was lost).
- Columns: `appointments.stylist_id` → `provider_id`,
  `sale_items.salon_appointment_id` → `appointment_id`. Indexes and
  `CHECK` constraints tied to the old table names were explicitly
  renamed too — Postgres doesn't do that automatically just because the
  table did.
- Backend modules: `backend/src/modules/salon-services/` →
  `.../services/`, `backend/src/modules/salon-appointments/` →
  `.../appointments/` — all 5 files each, same layering convention as
  every other module.
- Routes: `/salon/services` → `/services`, `/salon/appointments` →
  `/appointments`.
- Permission resources: `salon_services` → `services`,
  `salon_appointments` → `appointments` in `permissions.catalog.js`.
  Existing organizations already had `permissions` rows under the old
  resource keys (provisioned at their own registration time) — the
  migration updates those rows in place rather than leaving them
  orphaned. `role_permissions` links by permission *id*, not by the
  resource string, so every existing role's grant carries forward
  automatically once the row it points to is renamed.
- Frontend: `SalonServicesPage`/`SalonAppointmentsPage` →
  `ServicesPage`/`AppointmentsPage`, the "Salon" nav group became
  "Services" with children "Catalog" and "Appointments" (not "Services
  → Services", which would've been confusing), and the booking form's
  "Stylist" field/label became "Provider" throughout.

**Deliberately not touched:** `services.branch_id`'s
nullable-means-"every-branch" design (documented in slice 13, back when
the table was still named `salon_services`) and the double-booking/
status-lifecycle business rules from slice 2 — none of that logic was
ever salon-specific, it just needed the generic name to match.
Marketing copy (`AuthPage`, `DashboardPage`) was also updated to
explicitly frame the platform's two offerings instead of leading with
salons specifically.

**Historical note kept as history, not rewritten:** slice 2's section
above still describes the module the way it was originally built
(`salon-services`, `stylist`, etc.) with a pointer down to this section
— rewriting it to retroactively say "services"/"provider" would make it
inaccurate as a record of what that slice actually shipped at the time.

### Slice 19 — Bulk Excel Import/Export
A "download a template, fill it in, upload it back" flow for the ten
resources where a spreadsheet actually maps cleanly to one row per
record: Customers, Suppliers, Products, Branches, Services, Expenses,
Discounts, Taxes, Staff, and Stock Movements — the last being the
literal example that prompted this slice ("upload an Excel file of
stock into the table").

**Deliberately not built:** Sales, Purchases, and Appointments are
multi-item/transactional (a sale is a cart of several lines plus a
payment, not one flat row), and Roles are checkbox-based permission
grants — none of these map onto a single spreadsheet row the way the
ten resources above do. Bulk-importing them would mean inventing a
multi-row-per-record spreadsheet convention (e.g. repeated purchase
IDs for each line item) that's a different, larger feature, not a
generalization of this one.

**One shared backend utility, not ten bespoke ones.**
`backend/src/utils/bulkImport.js` handles the spreadsheet ↔ plain-object
translation (`buildTemplateBuffer`/`parseUploadedWorkbook`, via
`exceljs` — not the more common `xlsx`/SheetJS package, which has two
long-standing unpatched CVEs, prototype pollution and ReDoS, exactly in
its untrusted-file-parsing path; `exceljs` has neither).
`backend/src/utils/bulkImportHandlers.js` turns that into a pair of
generic Express handlers: `createTemplateHandler` (headers + example
rows → downloadable `.xlsx`) and `createBulkImportHandler` (uploaded
file → parsed rows → **each row run through the resource's own existing
`service.createX`**, one at a time, collecting a per-row success/failure
result). That last point is the important one: an imported row is
validated exactly the way a manually-submitted form is, so there's no
second, drifting copy of each resource's validation rules to maintain.
Each resource supplies only what's specific to it — its column headers,
one example row, and (for Products/Expenses/Staff/Stock Movements) a
small row-mapper that resolves a human-typed name/code into the ID the
service actually expects.

**Row-level lookups, not IDs, in the spreadsheet.** Nobody filling in a
template knows a category's or branch's UUID, so:
- **Products** — a "Category" column resolves to an existing category by
  name, or **creates it** if this organization doesn't have one yet
  (mirrors the manual Products page's inline "+ Add category" field).
  Resolution happens sequentially per row (not `Promise.all`), so two
  rows naming the same new category don't race and create it twice.
- **Expenses** and **Stock Movements** — a "Branch Code" column
  resolves to a branch id, fetching the org's branch list **once per
  import request** (cached on `req`, not once per row) via the new
  `utils/resolveBranchIdByCode.js` — which also rejects a branch the
  caller doesn't actually have access to, the per-row equivalent of
  what `middlewares/branchScope.js` already enforces for a single
  request-level `branchId` (see slice 13). That middleware's own
  single-branchId enforcement is explicitly skipped for `/import` and
  `/import-template` paths now, since bulk import carries a branch per
  spreadsheet *row*, not one for the whole request.
- **Stock Movements** — a "Product SKU" column resolves to a product id
  the same way the manual Stock page's dropdown does.
- **Staff** — "Branch Code" and "Role Name" columns resolve the same
  way, but *without* the branch-access check Expenses/Stock Movements
  use: `/users` was never a branch-scoped resource, and the existing
  manual "Add staff" form has never restricted which branch an admin
  can assign a new hire to beyond it belonging to the same
  organization — bulk import shouldn't be stricter than the form it's
  replacing.

**Staff import generates passwords, it doesn't ask for them.** There's
deliberately no "Password" column — asking an admin to invent and type
real passwords into a spreadsheet is the opposite of good practice.
Each imported account gets a random generated password (and, same as
every admin-created account since slice 12, `mustChangePassword: true`
unconditionally) and the plaintext is surfaced *only* in that one
import response, next to the row that created it, for the importing
admin to hand off — the new hire is forced to replace it at first
login regardless.

**A known-vulnerable dependency was caught before it shipped.** `npm
install xlsx` was the first thing tried (it's the most common Excel
library), but `npm audit` immediately flagged two unpatched CVEs — a
prototype-pollution and a ReDoS vulnerability, both in SheetJS's own
file-parsing code, with "no fix available" via npm. Since this feature
parses files uploaded by authenticated users, shipping a parser with
known vulnerabilities in exactly that code path wasn't worth it when a
well-maintained alternative existed — swapped for `exceljs` before any
other code was written against it. Separately, `exceljs`'s own
dependency on an old `uuid` version triggered a moderate advisory;
pinned via a `package.json` `overrides` entry rather than downgrading
`exceljs` itself. `npm audit` reports zero vulnerabilities as shipped.

**Frontend.** One reusable component,
`frontend/src/components/BulkImportControls.jsx` — a "Download
template" / "Upload file" pair plus a results panel (success count,
a per-row error table when something didn't validate, and — Staff
only — a table of generated temporary passwords) — dropped into all
nine pages covering the ten resources (Billing hosts both Discounts
and Taxes, each with its own import). Downloading streams the
response as a `blob` and triggers a real browser download via an
`<a download>`; uploading posts a `FormData` with the file under the
same `"file"` field name `multer` expects server-side.

### Slice 20 — Barcode, Reorder Level, Opening Stock, Expiry/Batch Tracking
Four commonly-expected inventory fields, added additively — none of
them changed the shape or meaning of `product_stock.quantity`, which
stays the single authoritative aggregate everything else already
relies on.

**Barcode (EAN).** A plain optional column, `products.barcode`, unique
per organization (a partial unique index, since it's nullable — two
different orgs may legitimately sell the same manufacturer barcode).
Exposed on manual product create/update, the Products table, and as a
"Barcode (EAN)" column on the Products bulk-import template.

**Reorder level.** This already existed as a column
(`product_stock.reorder_level`, read via `GET /inventory` since
day one) but had **no write path anywhere** — not even on the manual
Stock page. Added `PATCH /inventory/reorder-level` (a single atomic
upsert, not a lock-then-update, since a threshold setting has no
concurrent read-modify-write race to protect against) plus an inline
editable input per row on the Stock page's current-stock table, and an
optional field at product-creation time.

**Opening stock.** Not a schema gap — a workflow convenience. An
optional quantity (and optional expiry date) on the product-creation
form fires the exact same audited stock-in movement a manual Stock
page entry would, for the branch creating the product, immediately
after the product itself is created. No new table, no new movement
type — `products.service.js` just calls
`stockMovementsService.createStockMovement()` when given one.

**Expiry date — real batch/lot tracking, not a column.** Expiry is a
property of a *received batch* of stock, not of the product itself
(the same SKU can have units with different expiry dates on the shelf
at once), so it needed its own table: `stock_batches` (quantity +
nullable `expiry_date`, per branch/product). It's a supplementary
FEFO (first-expiry-first-out) layer *on top of* the untouched
aggregate — populated only when an expiry date is actually supplied at
stock-in time, so existing stock and existing behavior are unaffected
if nobody ever uses it.
  - Added to `stock-movements.repository.js` (the file all three
    stock-mutating services already call into directly, so batch logic
    lives in exactly one place): `createStockBatch` (stock-in with a
    known expiry) and `consumeStockBatchesFEFO` (locks every candidate
    batch row for the `(branch, product)` pair within the caller's
    transaction, then draws down oldest-expiry-first, nulls last).
  - Wired into all three existing call sites with zero duplicated
    logic: manual stock-in/out (`stock-movements.service.js`, plus a
    new optional `expiryDate` field), purchase receiving
    (`purchases.service.js` — expiry is captured per line item at
    order time, on a new `purchase_items.expiry_date` column, and
    seeds a batch at the moment stock actually enters the branch), and
    sales (`sales.service.js`'s `resolveLineItem`, which now also
    calls `consumeStockBatchesFEFO` alongside its existing aggregate
    deduction).
  - **Batches are best-effort, not a hard ledger.** Stock received
    before this feature shipped (or received without an expiry date)
    has no batch row at all — that's expected, not an error. A
    stock-out simply consumes whatever batch coverage exists and lets
    the rest reduce the aggregate with no attributed expiry.
    `consumeStockBatchesFEFO` never throws for "insufficient batch
    coverage"; the pre-existing aggregate-quantity check is what
    guards against overselling.
  - New read endpoint, `GET /inventory/batches`, surfaces batches with
    remaining quantity soonest-expiry-first — the "what's expiring
    soon" view, shown on the Stock page with a visual flag for
    anything expiring within 30 days.

**Deliberately not built:** reorder level and opening stock were not
added to bulk-import templates for every resource that might touch
stock (only Products/Stock Movements gained the relevant optional
columns) — Branches/Services/etc. have no concept of stock at all, so
there was nothing to add. Expiry-per-batch reporting (e.g. a
dedicated "waste/expired stock" report) wasn't built either; the
`GET /inventory/batches` endpoint gives the raw data but no report
consumes it yet.

### Slice 21 — Developer-Only Hard Delete
Every resource in this app has always followed one rule: deactivate,
never delete — a status flag, not a destroyed row, so history (past
sales, reports, audit trails) never breaks. That rule still holds for
every role except one: the Developer role can now permanently delete
anything it can view — Customers, Suppliers, Products, Services,
Discounts, Taxes, Staff, and Organizations — not just deactivate it.
Every other role still only ever sees Activate/Deactivate.

**Blocked-with-a-clear-error, not a silent failure.** A record still
referenced by other data (a product with past sales, a supplier with a
purchase, a customer with an appointment) can't just vanish — the
referencing rows would be left pointing at nothing. So a plain delete
is blocked with a 409 naming exactly what's in the way ("This record is
still referenced by 1 sale(s), 2 stock movement(s)"), and the response
carries `blockedByDependents: true`.

**"Delete anyway" — the retry, not a dead end.** Blocked isn't the end
of the road: the same request retried with `force=true` cascades
through every dependent first, then deletes the record. On the Products
page, that flow looks like: click Delete → confirm → blocked message
appears inline with a "Delete anyway" link → click it → confirm again
→ everything's gone. The frontend's `DeleteButton` component
(`frontend/src/components/DeleteButton.jsx`) is the one reusable piece
behind all 7 pages that got this.

**Line items escalate to their parent, so force-delete never leaves a
partial invoice.** A sale/purchase's line item isn't a standalone
record — its parent's total was computed from every item, so deleting
just one and leaving the rest would make that sale or purchase
internally inconsistent (a $50 invoice with one $20 item and a
now-missing one). So force-deleting a product that's on a sale doesn't
just remove that one `sale_items` row — it removes the entire sale
(which, via the schema's existing `ON DELETE CASCADE`, takes its other
items and payments with it). Purchases work the same way. This is
configured per-table as an `escalateTo` entry in
`backend/src/utils/hardDelete.js`'s dependents map, not hardcoded
per-resource.

**Only what's genuinely non-cascading needs an entry at all.** Most
`organization_id` foreign keys in this schema are already
`ON DELETE CASCADE` — deleting an Organization, for instance, needs no
dependents list whatsoever; the database silently cascades through
every branch, user, product, sale, and everything else that
organization ever created. `hardDelete.js`'s dependents map only lists
the handful of relationships declared `ON DELETE RESTRICT` (a product
still on a sale, a customer still booked for an appointment, etc.) —
everything else "just works" with a plain `DELETE`, no special-casing.

**Two hard rules no `force` flag can override:** an account can't
delete itself (locking the acting user out mid-request), and a
Developer can't delete their own organization (same reason, one level
up — it would delete their own user row via cascade). A system-role
account (the org's own owner) is also protected from deletion, the
same way an admin reset of its password already was.

**Gated by role, not permission.** `requireRole("developer")` — already
built for `/organizations` in Slice 17 — gates every new `DELETE`
route. A `super_admin` (an organization's own owner) still can't hard
delete anything; only the reserved Developer role can, matching the
original ask precisely.

**Deliberately not built:** Branches, Roles, and Categories don't have
this — they never had an Activate/Deactivate pattern to begin with, so
there was no "not just deactivate" gap to close for them. Sales,
Purchases, and Appointments aren't directly hard-deletable either
(they're the things force-delete *cascades into* via `escalateTo`, not
top-level delete targets themselves) — deleting one directly wasn't
part of the ask and their own lifecycle (paid/received/completed)
already governs how they end.

### Slice 22 — Staff Attendance (Kiosk Check-In/Out)
A physical-presence log, distinct from signing into the software: a
staff member checks out when stepping away from the store and checks
back in on returning, as many times a day as they actually come and
go. There's no separate "close for the day" action — a check-out with
no following check-in simply *reads*, in hindsight, as that day's last
movement; the log doesn't need to know in the moment whether a
check-out is temporary or final.

**One row per session, not per event.** `attendance` (already existed
as a table from an earlier, half-built slice) stores one row per
in-store session: opened by a check-in, closed by a check-out. A row
with `check_out_time IS NULL` is still open. Three toggles in a day
(in → out → in) produce **two** rows — one closed session and one
still-open one — not three; the middle "out" event updates the first
row rather than creating its own. `findLatestAttendanceForToday` (kept
from the earlier version) decides which case applies: no row yet
today, or the latest row already closed → check in (new row); latest
row still open → check out (update that row).

**The kiosk toggle is a new, deliberately public endpoint —
`POST /attendance/kiosk-toggle`.** A shared front-desk device can't be
expected to stay logged in as any one staff member, so this verifies
credentials directly (same bcrypt check `auth.service.login` does) but
**never issues a JWT and never establishes a session** — the frontend
never touches `localStorage`, never calls `AuthContext.login`, and
never navigates off the login screen. It's mounted in
`routes/index.js` *before* the protected `/attendance` router, since
`router.use("/attendance", ...)` would otherwise swallow this path as
a prefix match — order matters here, not just presence. Rate-limited
with the same limiter `/auth/login` uses (extracted to
`middlewares/rateLimiters.js` so both share one definition): it's a
public endpoint that checks a password, so it needs the same
brute-force throttling.

**Replaces, not adds to, the old implicit behavior.** A half-built
"auto check-in on every login" side effect already existed in
`auth.service.login()` — undocumented to any actual UI, and its own
code comment described auto-checkout logic that was never actually
implemented (it only ever created rows, never closed one). That's
removed entirely: signing into the dashboard is administrative
software access, not a physical movement event, and conflating the two
would double-count attendance for anyone who both uses the kiosk
button *and* logs in to do admin work. The explicit "Attendance" tab
button is now the only thing that logs a movement.

**Frontend: a third tab on the login screen, not a new route.** The
existing Sign in / Create account pill bar became a 3-column tab bar
with an "Attendance" tab (`frontend/src/pages/AuthPage.jsx`) — chosen
over a separate URL since a kiosk action shouldn't need its own
bookmarkable page. It posts directly via `apiClient`, not through
`useAuth().login`, specifically so it can't accidentally establish a
session. A confirmation card ("Jane Doe — checked in, 2:40:38 PM")
replaces the form after submitting, with a "Done" button that resets
back to a blank form for the next person.

**Admin view: `frontend/src/pages/AttendancePage.jsx`**, new, under
Administration → Attendance (gated on the existing `attendance:manage`
permission, unchanged from the earlier half-built version). A
date-range-filtered table of every session — staff name, check-in,
check-out, computed duration, and an open/closed badge — plus a "Close
session" action (`PATCH /attendance/:id/close`) for an admin to fix a
forgotten checkout by hand. Uses the same module-color system as the
rest of Administration (cobalt accent).

**Deliberately not built:** no PIN-code or badge-scan alternative to
typing a password — the kiosk form reuses real account credentials
rather than adding a new, lighter-weight identity mechanism (a new
`pin` field on users, admin UI to set it, etc). That's a reasonable
follow-up if repeated password entry proves too slow for a busy
front desk, but wasn't part of what was asked for here. No branch
scoping on attendance rows either — the table has no `branch_id` and
none was added; every staff member's sessions are simply visible to
anyone with `attendance:manage` in the organization, matching how the
table already existed before this slice.

### Slice 23 — Subscription / Tenant Billing
Gives the platform operator (the `developer` role) a way to track and
enforce each tenant's paid-access window, and gives each tenant's own
`super_admin` visibility into it without anyone else in that
organization seeing it.

**Three new columns on `organizations`** (migration `043`):
`subscription_expires_at` (nullable — unset means no enforcement at
all, which is the state every organization starts in, including ones
that pre-date this slice), `alert_threshold_days` (defaults to 30 —
how many days before expiry that tenant's own super_admin starts
seeing a login warning), and `extension_days` (defaults to 0 — a
grace period of continued access automatically granted after
`subscription_expires_at` passes, before the tenant is actually
treated as expired).

**One pure function computes standing everywhere it's needed —
`computeSubscriptionStanding()`** in `organizations.service.js`. Given
a row's three subscription columns and the current time, it derives
`daysRemaining`, a `status` (`active` → `expiring_soon` → `in_grace` →
`expired`), and `graceDaysRemaining` once past expiry. This one
function backs both the developer's tenant-list row coloring and the
super_admin's login banner, so the two surfaces can never disagree
about where a tenant stands — there's no separate date math
duplicated on either side.

**The red-row rule is deliberately not the same threshold as the
alert.** "Red background for tenants with less than 30 days left" is
a flat, always-30 rule (`isExpiringSoon`), computed independently of
whatever `alertThresholdDays` that specific tenant has configured. A
developer could set a tenant's own alert lead time to 5 days, and its
row would still redden at the 30-day mark — the red row is the
developer's own operational view, not a mirror of what that tenant's
super_admin sees.

**Nullable-date updates use a tri-state pattern, not `COALESCE`.**
`organizations.repository.updateOrganization` needs to distinguish
"the developer didn't touch this field" (keep the existing value) from
"the developer explicitly cleared the date" (set it to `NULL`) —
`COALESCE(new, old)` can't tell those apart, since both send `null`
over the wire. A boolean parameter (`subscriptionExpiresAt !==
undefined`) drives a `CASE WHEN … THEN … ELSE subscription_expires_at
END` instead.

**The alert is computed server-side and gated to `super_admin` only**
— `auth.service.buildSubscriptionAlert()`, called from both `login()`
and `me()`, returns `null` outright for any other role, including the
`developer` platform role itself (which has no subscription of its
own to be warned about) and ordinary staff (who aren't the ones
responsible for renewing). It returns one of three shapes —
`warning` / `critical` / `expired` — matched to `expiring_soon` /
`in_grace` / `expired` status, each with its own message and color.

**"At every login" is enforced via `sessionStorage`, cleared on every
`login()` call.** `SubscriptionAlertBanner` is dismissible for the
rest of the browser session so it doesn't nag on every page
navigation, but `AuthContext.login()` clears that dismissal flag on
every successful login — so a super_admin who dismissed it yesterday
still sees it again today, while not seeing it re-appear on every
internal route change within one sitting.

**Not built in this slice (since superseded — see Slice 26):** no hard
lockout on expiry — an `expired` tenant's users could still sign in and
use the software; this slice was visibility (a login warning, a red row
for the developer) rather than enforcement. That changed once RLS landed
and the tenant boundary became something the server enforced per request:
`middlewares/subscriptionGuard.js` now 403s an expired **or** deactivated
organization on the very next request, with `/auth/*` and `/subscription`
deliberately left mounted so a locked owner can still sign in and renew.
No billing/payment integration — `subscription_expires_at` is a date the
developer sets by hand after being paid through whatever channel they
actually use outside this software, not something the app charges for
itself.

### Slice 24 — Sale Returns, Change Given & Session Invalidation
Closes the loop on a completed sale: goods come back, cash goes out, and
a compromised or demoted account can be cut off mid-session.

**Returns are their own append-only record, not an edit of the sale**
(migration `050`): `sale_returns` (branch, `sale_id`, `total_refund`,
`refund_method`, reason, who) plus `sale_return_items` (the lines and
quantities actually brought back). The original sale row is never
rewritten, so yesterday's takings don't silently change when a customer
returns something today — the return is a new event on a later date, and
every report that sums sales stays reconcilable against the till.
`ON DELETE RESTRICT` on `sale_id` means a sale with returns against it
can't be removed out from under them.

**`refund_method` matters more than it looks.** A cash refund reduces
today's cash; a refund *to account* on a credit sale reduces what the
customer owes and moves no cash at all (see Slice 28). Storing the method
on the return is what lets the cash-up report and the receivables report
disagree correctly.

**`change_given` is stored, not recomputed** (migration `051`). The till
knows what the cashier handed back; deriving it later from
`amount_paid − total` breaks the moment a sale is partially refunded or
settled across two tenders. Storing it makes the cash-up reconciliation
arithmetic rather than inference.

**`users.token_version` invalidates live sessions** (migration `045`). A
JWT is valid until it expires, so deactivating a user, changing their
role, or forcing a password change previously left their current session
running. The token carries the version it was minted with; bumping the
column invalidates every token issued before the bump, without any
server-side session store to keep in sync. The same mechanism is reused
later for branch node tokens (Slice 34).

### Slice 25 — Staff Profiles, Photos & Nigerian Locale Defaults
Turns the thin `users` row into an actual staff record, and stops
shipping American defaults to a Nigerian shop.

**Full HR detail on `users`** (migration `049`): position, employment
date, phone, address, date of birth, gender, next of kin (+ phone),
national id, bank name and account number, salary, and benefits. It
lives on `users` rather than a separate `staff` table because every one
of these fields is 1:1 with a login and would otherwise need a join on
every staff screen for no gain.

**Salary and bank details are `super_admin`/`developer`-only**, enforced
in `users.service.js` when the row is shaped for the response rather than
by hiding fields in the UI — an admin who can create staff still cannot
read what they're paid. The integration suite asserts this directly
("HR/salary is writable and readable only by a super_admin"), because a
permission that's only enforced in React isn't enforced.

**Photos are stored as a `TEXT` column** (migration `048`), not files on
disk or in object storage. That's a deliberate trade for the offline
story: a branch install has no S3, and a passport photo that lives in the
database is a photo that arrives with the enrollment snapshot and
survives a restore from a single `pg_dump`. The cost is row size, which
is bounded by the UI resizing before upload.

**Locale defaults are a data migration, not a code change** (migration
`047`): existing `settings` rows flip `USD → NGN`, `UTC → Africa/Lagos`,
and `YYYY-MM-DD → DD/MM/YYYY`. Each `UPDATE` is guarded by the *old*
value, so an organization that had already set its own currency or
timezone is left alone — the migration corrects the default nobody chose,
not a preference somebody did.

### Slice 26 — Row Level Security (the tenant boundary moves into the DB)
Until this slice, tenant isolation was a convention: every query was
expected to carry `WHERE organization_id = …`, and one forgotten clause
anywhere would leak another organization's data. Migration `052` makes
the database enforce it instead.

**Every tenant table gets `ENABLE` + `FORCE ROW LEVEL SECURITY` and a
`tenant_isolation` policy** reading a per-connection setting:
`organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid
OR current_setting('app.bypass_rls', true) = 'on'`. `FORCE` is the
important half — without it the policies wouldn't apply to the app's own
role, which owns the tables. A query that forgets its `WHERE` clause now
returns *nothing* rather than everything.

**The safe default is "see nothing".** With no org context set, the
policy matches no rows. So a code path that fails to establish context
fails closed — the opposite of the pre-RLS behavior, where a missing
filter failed wide open.

**`config/db.js` became a context-aware pool wrapper**, not a plain `pg`
Pool. `middlewares/orgContext.js` pins one connection per request with
the caller's org id; `db.query` routes to it via `AsyncLocalStorage` so
the whole app keeps calling `.query`/`.connect` unchanged. Transactions
are the subtle case: `pinContextAfterBegin` re-establishes the context
immediately after `BEGIN`, and sets **both** GUCs every time — a pooled
connection can carry a stale `bypass_rls` from a previous transaction,
so a non-bypass transaction must explicitly clear it. (A latent bug here
was found later by the sync work, which was the first code path to
INSERT rows belonging to an externally-supplied org.)

**`db.runPrivileged` is the narrow, deliberate escape hatch** — a
dedicated connection with `app.bypass_rls='on'` — for the handful of
operations that legitimately precede or cross a tenant: login (look a
user up by email across all orgs), registration (creates the
organization before any context exists), and the attendance kiosk.
Everything else is forced to a single tenant.

**Consequence worth knowing:** the app's own role can no longer bulk-read
its tables with `pg_dump`, which is why backups need special handling
(Slice 32).

### Slice 27 — Reports Suite
Replaces the single Reports page with a set of owner-grade reports behind
one dropdown, sharing filters and print styling.

**`ReportsLayout` + nested routes, one filter bar.** Each report is a
route under a shared layout that owns the date range, branch filter, and
print button, so a user switching from Profit to Cash-up keeps their
filters instead of re-entering them. Print styling lives in the layout
too — every report prints on the org's letterhead (logo, address,
contacts) without each page reimplementing it.

**Thirteen reports, each its own route** under `frontend/src/pages/reports/`:
Overview, Profit, Profit & Loss, Cash-up, Staff sales, Sales by category,
Branch comparison, Inventory valuation, Expiry, Receivables, Customers,
Discounts, and Tax. Shared presentation lives in `reportsKit.jsx` so a
new report is a query plus a table, not a new page framework. Cash-up is
the one that closes a till at end of day, which is why change given and
refund method had to be stored rather than derived (Slice 24);
Receivables is the credit-ledger view added in Slice 28.

**Reports read snapshotted values, never live catalog prices.** A sale
carries the price, tax, and discount it was made at, so re-running last
month's Profit report after a price rise still reports last month's
margin. This is the same property that later makes a stale branch catalog
safe under offline sync (Slice 34).

**Migration `053` is indexes only** — `(organization_id, created_at DESC)`
on `sales`, `purchases`, and `expenses` (the date-range scan every report
starts from), plus `sale_items (product_id)` for the per-product
roll-ups. No new columns: the reports are queries over data that already
existed, and the slice is mostly about making them fast enough to run on
a full year without a table scan.

### Slice 28 — Customer Credit Ledger (selling on account)
Lets a shop sell to a known customer on credit, take payments against
what they owe, and see who owes what — without inventing a second
accounting system alongside sales.

**One append-only ledger with signed amounts** (migration `054`):
`customer_ledger_entries` (customer, `entry_type` constrained to
`charge`/`payment`/`adjustment`, `amount`, `balance_after`, optional
`sale_id`, method, note, who). Nothing is ever updated or deleted — a
correction is another row. `balance_after` is written on each entry, so
a customer's balance is the newest row rather than a `SUM()` over their
whole history, and a statement can show the running balance as it stood
at each transaction.

**The charge is posted inside the sale's own transaction.** A credit
tender doesn't fire a second request after checkout: the sale, its items,
the stock movements, and the ledger charge are one transaction. There is
no window in which a sale exists but the debt doesn't.

**Credit needs a customer, by construction.** A walk-in sale has nobody
to bill, so selling on account without a `customerId` is rejected rather
than posted to some house account — asserted directly by the suite
("selling on credit without a customer is rejected").

**`customers.credit_limit` is nullable and means "no limit"**
(migration `055`), which is the state every existing customer starts in —
adding the column doesn't quietly cap anybody. A sale that would push the
balance past a set limit is refused at the point of sale. Setting a limit
is an admin action, dropped server-side for anyone else rather than
merely hidden, so a cashier cannot raise their own ceiling to push a sale
through ("a cashier cannot set a customer's credit limit").

**Refunds to account move no cash.** Refunding a credit sale lowers the
balance instead of opening the till — the case that makes `refund_method`
(Slice 24) load-bearing.

**Receivables is a report, not a table.** Who-owes-what derives from the
newest entry per customer, so a customer who pays off drops off the
report automatically with nothing to reconcile.

### Slice 29 — Access Tiers & Granular Permissions
Two layers over one permission catalog: a fast way to say "this person is
a supervisor", and a precise way to say exactly what a custom role may do.

**Tiers are seeded roles, not a new concept.** `ensureTierRoles` creates
Staff / Supervisor / Admin / Super Admin the first time an org needs them
(lazily, like every other bootstrap here), each filled from a resource
list in `permissions.catalog.js` — Supervisor gets an explicit subset,
Admin gets every module resource *except* `organizations` (that one is
the platform's, not a tenant's). The Staff page offers a tier picker for
the common case; hand-built custom roles are left untouched.

**Granular permissions are a per-action matrix**, not one "manage" flag:
View / Create / Edit / Delete per resource, plus the two actions that
aren't CRUD and can't be inferred — `Sales:Refund` and
`Stock:Adjustment`. `manage` stays a superset so existing roles keep
working, and middleware maps HTTP method to action (GET→View,
POST→Create, PATCH/PUT→Edit, DELETE→Delete), checking the specific action
or `manage`.

**Administration is gated on the group, not on one child.** A non-admin
must never see the Administration menu at all, so the whole group hides
behind `isAdmin` rather than behind whichever permission its first child
happens to need — otherwise one narrow grant would reveal the section.

**The regular-user baseline is resolved per request, not from the token.**
What ordinary staff can always do is derived from the role at request
time, so a permission change takes effect on refresh instead of requiring
a sign-out and back in.

### Slice 30 — Server-Side Pagination
Lists that were fine with 50 products are not fine with 50,000.

**Opt-in and backward-compatible by design.** `utils/pagination.js`
parses `page`/`limit`/`sort`/`order`; a request sending none of them gets
the old unpaginated array back exactly as before, and only a request that
pages gets the paginated envelope. That is what allowed converting the
lists one at a time — customers, suppliers, products first — rather than
as one breaking change across the whole app.

**Sorting is whitelisted per resource**, never interpolated from the
query string: an unrecognized `sort` falls back to the default order
rather than reaching the SQL.

**`useServerTable` puts page/sort/filters in the URL**, so refresh,
deep-link, and back all land on the same page of the same list.

### Slice 31 — Optimistic Locking (two admins, one record)
Two people editing the same product used to silently overwrite each
other. Now the second save fails loudly.

**Postgres `xmin` is the version — no migration, no new column.** Every
row already carries a system column that changes on each update, so reads
return it as `version` and the update says `WHERE id = $1 AND xmin = $2`.
Zero rows updated means somebody got there first, and the API returns a
conflict telling the user to reload rather than overwriting work they
never saw. Applied to products, customers, and users — the records two
admins actually edit at once.

**Why not a `version` integer:** it needs a migration per table, a
trigger or discipline to bump it, and it drifts the moment some code path
updates a row without going through the helper. `xmin` can't drift,
because Postgres maintains it.

**`utils/optimisticLock.js` keeps it to one line per repository**, which
is what makes extending it to another table cheap rather than a
copy-paste of conflict handling.

### Slice 32 — Observability, Request Ids & Backups
Makes a support call answerable ("what's the code on your error screen?")
and makes the database recoverable.

**A minimal structured logger, no new dependency.** `config/logger.js`
emits JSON-per-line in production, readable lines in development, and is
**silent under test** — which is what keeps the suite's output legible.
Stray `console.error` calls in the DB pool and the login path moved onto
it.

**Every request carries an id, end to end.** `attachRequestId` (mounted
first) gives each request a `req.id`, honoring an inbound `X-Request-Id`
so a reverse proxy's id wins, and echoes it as a response header.
Crucially the id is also included **in error response bodies** — the user
reads it off the screen, support greps one line, and there's no guessing
which of today's 4,000 requests they mean. `errorHandler` logs expected
4xx as `warn` without a stack and unexpected 5xx as `error` with one.

**Backups: `npm run backup`** writes a compressed, timestamped `-Fc` dump
to `backend/backups/` and prunes to `BACKUP_RETAIN` (default 14). The
password goes through `PGPASSWORD`, never argv, so it can't be read out
of `ps`.

**The RLS catch, and how it's handled.** Because Slice 26 FORCEs RLS on
the app's own role, a plain `pg_dump` as that role fails outright
("query would be affected by row-level security policy"). Rather than
require a superuser for a routine backup, the script runs
`pg_dump --enable-row-security` with `app.bypass_rls=on` set for the
session — the same bypass the policies already grant `runPrivileged` —
which produces a complete dump of every row of every table. Because that
flag would otherwise let a *broken* bypass yield a quietly partial dump
instead of a loud failure, the script preflights the bypass and refuses
to write a backup it can't see rows through. A superuser or `BYPASSRLS`
role still works via `BACKUP_DATABASE_URL`.

**Dumps are gitignored** (`backend/backups/*.dump`) — a dump is every
tenant's data in one file, and this repo has a remote.

### Slice 33 — Production Hardening & Deployment Packaging
One build that serves a single shop PC, a shop LAN, and a cloud tenant
without a different artifact for each.

**One process serves the app and the API on one origin.** `npm run
build:web` builds the frontend and the backend serves `frontend/dist`
with an SPA fallback, so there's no CORS in production, no second web
server, and no reverse proxy required for the simple case. The frontend's
API base is relative in production and `http://localhost:5000/api/v1` in
development, so the same bundle works in all three deployments.

**Hardening is env-driven so offline installs stay simple.**
`JWT_SECRET` is *enforced* in production (a weak or placeholder value
refuses to boot) but only warned about in development; CORS always allows
localhost and private LAN ranges, so a shop LAN needs no configuration at
all, while `FRONTEND_URL` adds public origins for a cloud deployment.
`TRUST_PROXY` defaults to off — enabling it blindly would let any client
spoof its IP through `X-Forwarded-For`.

**Graceful shutdown, because a restart shouldn't sever a checkout.**
On SIGTERM/SIGINT the server stops accepting connections, lets in-flight
requests finish, closes the pool, and gives up after 10 seconds rather
than hanging forever.

### Slice 34 — Offline Sync Engine (branch ↔ head office)
The big one: a branch keeps trading with no internet and reconciles when
it's back. Built across migrations `056`–`061`, `063`, `065`, and dormant
unless `SYNC_ENABLED=true`.

**The central node is the ordinary multi-tenant SaaS, not a per-org box.**
A branch authenticates *as its organization*; the RLS from Slice 26 is
the entire trust boundary. That decision is what keeps this from becoming
a second product.

**Offline is opt-in per organization, and must never tax the tenants who
don't want it.** Capture is gated on *both* the process-global
`SYNC_ENABLED` and a per-org `organizations.sync_enabled` flag
(migration `057`), so on the hub the outbox grows only for orgs that
actually enrolled a branch. A plain cloud tenant is byte-for-byte
unaffected and never sees sync UI.

**Change capture is app-level CDC via triggers, not logical replication.**
Postgres logical replication needs a live link and replicates a whole
database; this needs to survive days offline and ship one tenant's rows.
A `sync_capture` trigger on the syncable tables writes to `sync_outbox`
(`seq`, org, node, table, row id, op, `row_data` JSONB), reading the row
generically via `to_jsonb`. Deletes are captured as `op='D'`, which is
what avoids adding `deleted_at` columns to every table.

**Sync is asymmetric, and the hub enforces it.** Reference data (catalog,
prices, staff, roles, settings) is authored centrally and flows **down**;
transactions (sales, payments, returns, stock movements, ledger entries,
expenses, purchases, appointments, attendance) are branch-created,
immutable, and flow **up**. `BRANCH_PUSH_TABLES` is the whitelist, applied
both when a branch pushes and again on the hub — so a rogue branch that
tries to push a price change is dropped, not trusted. Customers are the
one bidirectional entity (created at the till or centrally). UUID keys
mean no cross-node collisions, and prices/tax already snapshot onto sales
(Slice 27), so a stale branch catalog cannot corrupt history.

**Enrollment is two credentials, not one long-lived key** (migrations
`058`, `065`): a one-time 15-minute enrollment **code**, redeemed
atomically (`UPDATE … WHERE used_at IS NULL … RETURNING`, so a race can't
redeem it twice), which returns a durable **refresh secret**; the branch
exchanges that for short-lived (24h) access tokens. Revoking a branch
(`is_active=false`) kills both the refresh and any outstanding token.

**Password hashes never cross the wire.** The enrollment snapshot strips
`password_hash`; offline login instead works by caching a hash on first
*online* login, where the hub returns it only to someone who already
proved the password. First login on a new branch must be online; every
one after can be offline.

**`/sync/link` is SSRF-guarded.** It resolves the hub host and refuses
loopback and link-local addresses (including cloud metadata endpoints)
while still allowing private LAN ranges, because a hub genuinely can be a
box in the back office. The vetted IP is then pinned for the connection
so DNS can't rebind it afterwards.

**Apply is resilient, and rejections are visible.** Each entry applies
inside a `SAVEPOINT`, so one poison row is quarantined and logged to
`sync_rejections` (migration `063`) while the rest of the batch lands.
The Offline Branches page shows how far each branch is behind, when it
was last seen, and what was ignored and why. Bootstrap snapshots stay
all-or-nothing — a half-seeded branch is worse than an unseeded one.

**The outbox is garbage-collected on confirmed delivery** (migration
`061`): a branch prunes its own after a successful push; the hub prunes
below the minimum confirmed watermark across *active* branch nodes, so an
offline branch's changes are kept for it. A permanently dead branch pins
that floor until it's revoked.

**A schema-version handshake fails fast** rather than half-applying
across mismatched builds: the branch checks the hub's version before
syncing, and the hub rejects a push whose version header disagrees.

### Slice 35 — Cross-Branch Shipments
Moving stock between branches when the two branches are separate offline
nodes and neither can see the other's database.

**A shipment is a two-step, asynchronous transfer** (migration `062`):
`stock_shipments` (product, from/to branch, quantity, status
`in_transit`/`received`/`cancelled`, batches, who and when for each
step). Ship deducts at the source; receive credits at the destination;
cancel returns it to the source. The pre-existing synchronous
same-database transfer is untouched — this is the version that survives
the two ends being days apart.

**Each half is authored by the node that performs it**, which is why the
table syncs bidirectionally without a real conflict: the source writes
the ship fields, the destination writes the receive fields.

**`product_stock` propagates on apply.** Branch stock levels are a
maintained aggregate, not a synced table, so applying a `stock_movements`
row also upserts `product_stock.quantity` from that row's
`quantity_after` (latest-by-seq wins, idempotent). Without this, head
office would show stale stock for every branch. Batches (FEFO/expiry
detail) sync too (migration `064`), since they're authoritative rather
than re-derivable.

### Slice 36 — Held / Parked Sales
A customer at the till realizes they forgot something; the queue behind
them shouldn't wait.

**A held sale is transient working state, deliberately not a sale**
(migration `066`): `pending_sales` stores the cart as JSONB with its
label, item count, total, and optional customer/discount. It is **not
synced** — a parked cart belongs to the till it was parked at — and it's
deleted the moment the sale completes or is cancelled, so it can never be
mistaken for revenue.

**Each cashier sees only their own held sales**, enforced in the query
(`created_by` is part of both the list filter and the delete predicate),
not by filtering in the UI.

**Resuming keeps the record until checkout succeeds.** The cart loads
back into the till and the held row is only removed once the sale is
actually completed — so a crash mid-checkout leaves the cart recoverable
rather than lost.

### Slice 37 — Desktop App (Electron + bundled Postgres)
A shop PC with no internet, no Docker, and nobody to run `npm`.

**`desktop/` is a wrapper, and changes nothing in `backend/` or
`frontend/`.** It starts a bundled PostgreSQL on loopback, runs the
backend's own migrations, spawns the unmodified `backend/src/server.js`
in production mode with `FRONTEND_DIST` pointed at the built frontend,
and opens a window at that origin. Because the backend already serves the
API and the app on one origin (Slice 33), there is nothing desktop-shaped
to special-case.

**All state lives in the OS user-data directory** — database and JWT
secret — never in the repo, so an install can be updated by replacing the
application without touching the shop's data.

**Packaged with `electron-builder`** for Windows (NSIS), macOS, and
Linux. This is the delivery vehicle for a branch node: install, paste the
enrollment code on the first-run link screen, and trade offline from
there.

## Prerequisites

- Node.js 20+
- Docker (for local Postgres) — or any Postgres 18 instance you already have

## 1. Start Postgres

```bash
docker run --name winstore-db \
  -e POSTGRES_USER=winstore \
  -e POSTGRES_PASSWORD=winstore \
  -e POSTGRES_DB=winstore_db \
  -p 5432:5432 \
  -d postgres:18
```

Check it's up: `docker logs winstore-db` should show `database system is ready to accept connections`.

## 2. Backend

```bash
cd backend
cp .env.example .env      # defaults already match the docker command above
npm install
npm run migrate           # runs every file in database/migrations in order
npm run dev                # starts on http://localhost:5000
```

Confirm it's alive: `curl http://localhost:5000/api/v1/health` should return
`{"success":true,...}`.

## 3. Frontend

```bash
cd frontend
cp .env.example .env       # VITE_API_URL=http://localhost:5000/api/v1
npm install
npm run dev                 # starts on http://localhost:5173
```

## 4. Try it

1. Open `http://localhost:5173` — you'll land on `/login`, then can navigate
   to **Create one** to register.
2. Fill in the registration form (organization, your name, email, password
   8+ chars). Submitting creates the organization, headquarters branch,
   admin role + permissions, your user, default settings, and an audit log
   entry — all in one DB transaction — then logs you straight in.
3. You should land on `/dashboard` showing your real organization, branch,
   and role, pulled live from `GET /api/v1/auth/me`.
4. Refresh the page — you should stay logged in (session is re-validated
   against `/auth/me` on load, not just trusted from localStorage).
5. Sign out, then sign back in with the same email/password on `/login`.
6. Check the database directly to see the full slice working:
   ```bash
   docker exec -it winstore-db psql -U winstore -d winstore_db \
     -c "SELECT action, entity_type, created_at FROM audit_logs ORDER BY created_at DESC;"
   docker exec -it winstore-db psql -U winstore -d winstore_db \
     -c "SELECT status, check_in_time, check_out_time FROM attendance ORDER BY created_at DESC;"
   ```
   You should see `organization.registered` and `user.login` audit rows, and
   an attendance row auto-created by each login.
7. Go to **Customers** and add one (e.g. "Jane Doe", jane@example.com,
   555-0100). Try adding the same email again — it should be rejected with
   a 409 instead of a raw database error. Search for "Jane" to confirm
   search works.
8. In the left nav, go to **Services · Catalog** and add a service (e.g.
   "Haircut & Style", 30 min, $45 — or something entirely non-salon, like
   "House Cleaning (2BR)", 90 min, $85, to see the catalog is genuinely
   generic). It should appear in the table immediately.
9. Go to **Services · Appointments**. Book an appointment for the customer
   you just added, picking yourself as the provider, then try booking a
   second appointment for the same provider at an overlapping time — it
   should be rejected with a 409 conflict message instead of silently
   double-booking.
10. Mark an appointment **Complete**, **No-show**, or **Cancel** — once set,
   those buttons disappear, since the status is terminal.
11. Go to **Inventory · Products**. Add a category inline (e.g. "Hair
    Care"), then add a product (e.g. "Shampoo — 500ml", SKU `SHM-500`,
    price 12.00). It should appear in the table immediately.
12. Go to **Inventory · Stock**. Record a "Stock in" movement of 20 for that
    product — it should appear in Current stock at quantity 20, and in
    Recent movements as `+20`.
13. Record a "Stock out" movement of 25 for the same product — it should be
    **rejected** (can't go negative). Try 15 instead — quantity should drop
    to 5, and since that's likely at or below a reorder level of 0, nothing
    will flag as low yet; that's expected with the default reorder level.
14. Mark the appointment from step 9 **Complete** (if you haven't already).
15. Go to **Sales**. Search the catalog for the shampoo product and click
    **Add** twice (it should merge into one line at quantity 2, not two
    separate lines), then pick the customer from step 7 in the right
    panel — the "Unbilled services for this customer" list should show
    the completed appointment. Add it too, pick a payment method, and
    **Complete sale**. You should see a confirmation and the sale in
    Recent sales. Try it again afterward leaving **Customer** on
    "Walk-in (no customer)" — checkout should still complete, and the
    sale should list as "Walk-in".
16. Confirm the cross-module effects actually happened:
    ```bash
    docker exec -it winstore-db psql -U winstore -d winstore_db \
      -c "SELECT quantity FROM product_stock;"
    docker exec -it winstore-db psql -U winstore -d winstore_db \
      -c "SELECT movement_type, quantity_change, reason FROM stock_movements ORDER BY created_at DESC LIMIT 3;"
    ```
    Stock should have dropped by 2 (from step 12's 5 down to 3), and the
    latest movement should show `out`, `-2`, `Sale`.
17. Go back to **Sales** and try adding that same appointment to a new
    cart — it should no longer appear in the unbilled list, since it's
    already been billed. If you try to book and complete a second
    appointment and bill it from a *different* customer than the one
    selected in the cart, the checkout should reject it.
18. Go to **Billing · Discounts & Taxes**. Add a tax (e.g. "VAT", 7.5%)
    and a discount (e.g. `LOYAL10`, $10). Try adding `loyal10` again —
    it should be rejected with a 409 (codes are unique per organization,
    case-insensitively).
19. Back on **Sales**, build a cart and pick `LOYAL10` in the Discount
    dropdown — the panel should show the subtotal, the discount, tax at
    7.5% of the *discounted* subtotal, and the final total. Complete the
    sale and check the receipt line shows the same breakdown.
20. Deactivate the tax on the Billing page and complete another sale —
    no tax should be applied, but the earlier sale's stored amounts are
    unchanged (snapshotted, not recomputed).
21. Go to **Purchasing · Suppliers** and add one (e.g. "Acme Wholesale").
    Adding the same email again should be rejected with a 409.
22. Go to **Purchasing · Purchases**. Pick the supplier, add a product
    with a quantity of 10 and the unit cost you're paying (e.g. $8.50),
    and place the order. It appears as **pending** — check
    **Inventory · Stock**: nothing has changed yet.
23. Back on Purchases, click **Receive**. Now Inventory · Stock should
    show +10, and Recent movements a `+10` with reason "Purchase
    received". The Receive/Cancel buttons are gone — received is
    terminal, same as cancelled.
24. Go to **Reports**. The KPI tiles should reflect everything you just
    did — revenue and tax from your sales, purchase spend from the
    received order, completed appointments, and new customers. Narrow
    the date range to before today and Apply — everything should drop
    to zero. Top items should rank your products and services by
    revenue, with their real names.
25. Go to **Expenses** and record one (e.g. "Electricity bill",
    category "utilities", $75). It appears **pending**. Click
    **Mark paid** — back on **Reports**, the "Expenses (paid)" tile
    should now include it. Record a second expense and **Cancel** it
    instead — it should never affect the Reports total.
26. Go to **Administration · Roles**. Create a role (e.g. "Cashier")
    and check only **Sales** and **Customers**. Try naming a role
    `super_admin` — it should be rejected (that name is reserved for
    the bootstrap admin role's own bypass).
27. Go to **Administration · Staff** and add a staff member with a real
    password (8+ characters), assigning them your branch and the
    Cashier role.
28. Sign out and log back in as that staff member. They should be able
    to reach **Sales** and **Customers**, but get a 403 (a
    "you do not have permission" error) if you navigate to **Products**
    or **Reports** directly.
29. Log back in as the admin, go back to **Administration · Roles**,
    edit Cashier, and uncheck **Customers**. The staff member's
    *current* session keeps working until they log out and back in —
    a JWT carries the permissions it was issued with, so a role change
    only takes effect on the next login, not retroactively.
30. On **Administration · Staff**, click **Deactivate** on that staff
    member. Confirm they can no longer log in at all (not just
    permission-blocked, fully rejected) — then **Activate** them again
    and confirm they can.
31. Go to **Administration · Change Password** and change your own
    password, supplying your current one. Sign out and back in with the
    new password to confirm it took.
32. On **Administration · Staff**, click **Reset password** next to
    your Cashier staff member and set a new one — no current password
    needed. Confirm the staff member can log in with the new password
    (and that their old one no longer works). Note there's no
    **Reset password** button next to your own row — that one only
    goes through **Administration · Change Password**.
33. Sign in as the Cashier staff member you just reset. You should be
    redirected straight to **Change Password** regardless of which link
    you try to click, with a note that your password was set by an
    administrator. Set a new one — you should land on the dashboard
    immediately afterward, no re-login needed.
34. Go to **Administration · Branches** and add a second one (e.g.
    "Second Branch" / `BR2`). Rename it inline to confirm editing
    works. Then on **Administration · Staff**, edit the Cashier member
    and check that branch under **Branch access**. Save.
35. Sign in as that staff member again — a branch switcher should now
    appear in the header next to Sign out. Switch it and confirm
    **Inventory · Stock** (or **Sales**) reloads showing the other
    branch's data.
36. While signed in as that same Cashier (granted only the two branches
    above), try calling the API directly for a third branch id they were
    never granted, e.g.:
    ```bash
    curl "http://localhost:5000/api/v1/sales?branchId=<some-other-branch-uuid>" \
      -H "Authorization: Bearer <cashier's token>"
    ```
    Expect a 403 "You do not have access to this branch." — confirms
    branch scoping is enforced server-side, not just hidden by the
    switcher in the UI.
37. As the admin, open a sale/purchase/appointment that belongs to a
    branch the Cashier doesn't have access to (grab its id from the
    database) and fetch it as the Cashier — expect a 404, proving the
    id-based endpoints are guarded too, not just the list/create ones.

## Notes

- If port 5432 is already taken locally, change the `-p` mapping in the
  docker command and update `DATABASE_URL` in `backend/.env` to match.
