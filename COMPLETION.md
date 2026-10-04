# Winstore completion checklist

This is the current checklist. README slice entries describe the feature history;
they do not replace release verification. Last reviewed: 2026-10-04.

## Implemented

- [x] Desktop roles: Host this store or Connect to this store, saved across
  restarts. Business setup (standalone or head-office branch) belongs to the host.
  Existing installations retain their data and business mode with sharing off.
- [x] Owner-managed encrypted LAN sharing with pinned host identity and a
  `ws1:` connection code. Connected tills share the host's database, use staff
  accounts, and never initialize a local business or run their own sync worker.
  Registration and sync/setup routes are refused through the LAN gateway.
- [x] Private IPv4 interface selection, per-till rate limits, Windows firewall
  helper restricted to the application/private profile/local subnet, host tray
  operation, optional startup at Windows sign-in, and client recovery screens.
  PostgreSQL and the backend remain bound to loopback.
- [x] First-run desktop choice between standalone business and head-office-linked
  branch, saved across restarts. Existing installations preserve standalone mode.
- [x] Head-office branches show single-code setup. Standalone installs
  keep sync disabled. Desktop binds the backend to loopback.
- [x] Branch linking requires an empty branch installation. All snapshot pages and
  the durable link commit together; a failed download rolls back local data.
  Branch registration is refused; accounts are managed at head office. If a
  failure follows code redemption, obtain a new one-time enrollment code.
- [x] Add Branch generates its short reference and a unique, one-time, 24-hour
  desktop setup code. The code contains the API origin and is bound to that branch;
  replacements invalidate older unused codes. Database storage contains only
  the secret's hash. Web lists do not expose saved setup credentials.
- [x] Desktop activation downloads reference data and the selected branch's
  inventory, saves its branch binding across restarts, and defaults sessions and
  transactions to that branch. First online sign-in caches each account's
  credential for later offline use. Sibling-branch writes are refused locally.
- [x] Initial snapshot stores the first page's sync watermark with the local
  link so earlier stock movements cannot overwrite checkout after setup.
- [x] Budgets page: organization-wide plans, totals, search, sorting, status filters,
  and creation. No spending tracking or budget-period features are implied.
- [x] Cash Register page: branch selection, opening float, register balances,
  transaction history, and money-in/money-out forms. Movements are manual; sale
  payments are not automatically posted to a register. There is no closing API yet.
- [x] Financial API permissions, tenant/branch checks, exact-cent arithmetic,
  two-decimal validation, amount bounds, and concurrent withdrawal protection.
- [x] Earlier fixes: refund locking/duplicate validation, action-specific UI
  permissions, safe PostgreSQL restart/initialization, production migration CLI.
- [x] Desktop packages exclude environment files, backups, logs, and tests.

## Verification for this change

- [x] Targeted branch setup, validation and enrollment integration: 69 passed.
- [x] Final focused checks: 48 passed, including expired codes, concurrent
  one-time redemption and credential caching restricted to assigned staff.
- [x] Frontend lint and production build passed.
- [x] Full backend regression suite: 193 passed, none skipped, including the
  single-code creation/replacement permissions and existing sync protocol.
- [x] Final frontend tests: 27 passed, including connected-till sign-in,
  branch signup, setup-probe guards,
  and historic signed budget amounts.
- [x] Final desktop test suite: 129 passed. Includes config/data preservation,
  client isolation, scoped IPC, exact certificate pin/date checks, real TLS
  proxy behavior, owner authorization, mutation/shutdown races, backend child
  ownership, and production migration CLI. Firewall and sign-in startup actions
  use test doubles; no real Windows firewall or login settings were changed.
- [x] Real embedded PostgreSQL 17.10 and Electron 33.4.11 / Node 20.18.3:
  65 migrations, built frontend, registration/login/budget, two staff sessions,
  permissions, concurrent last-item checkout (201 + 409), encrypted pairing,
  unavailable-host rejection, and database/backend restart persistence passed.
  Run `npm --prefix desktop run smoke:runtime` from an ordinary Windows terminal;
  the sandbox cannot resolve the Windows account. This run completed outside
  the sandbox and removed its owned temporary data after stopping processes.
- [x] Real Electron UI smoke: connection form and verified store confirmation,
  TLS-pinned React staff sign-in without registration/enrollment, renderer
  isolation, blocked foreign navigation, recovery screen, and usable tray icon.
  Run `npm --prefix desktop run smoke:ui`. Hidden offscreen screenshots were
  inspected under `desktop/dist/verification`. No real business was opened.
- [x] Real branch/hub HTTP enrollment, upstream/downstream sync, role replication,
  scheduled sync, cross-branch shipments, and revocation.
- [x] Real single-code setup across separate branch/hub instances: Add Branch,
  code verification, inventory download before a sync run, persisted branch
  binding, sibling-branch rejection, first checkout and sync with stock unchanged
  by historical replay, then offline login and checkout with the
  hub process stopped. Run `node tests/integration/sync-e2e.smoke.js --branch-setup`
  from backend. This smoke clears only its dedicated test schemas.
- [x] Backup and restore round trip: two organizations, two budgets, two registers,
  three cash movements and timestamps preserved; balances reconcile. The backup
  used an ordinary tenant-restricted role and verified the RLS bypass.
- [x] Updated Windows unpacked application built and inspected: desktop code, backend,
  migrations, and current frontend match source; production migration CLI is
  present; backend environment files and private/development artifacts excluded.
  Verified 25 desktop files, 258 backend/migration files, 12 frontend files,
  and the LAN certificate dependency in the current build.
  The packaged executable also generated a valid certificate in Electron's
  Node mode without opening business data or starting local services.
  Bundled PostgreSQL executables match the installed binaries; inherited Electron
  diagnostic log removed and an after-pack cleanup hook added.
  Artifact: `desktop/dist/win-unpacked/Winstore.exe`. This review build is unsigned
  and skipped Windows executable signing/metadata editing through a command
  override; the normal release signing configuration is unchanged.

## Before distributing to users

- [ ] Test two physical Windows PCs: owner enable sharing/UAC, Private network
  firewall reachability, client checkout/reconnect, host tray, and startup at
  Windows sign-in. Automated TLS checks ran on one machine; they do not prove
  a customer's router/firewall configuration or installed login-item behavior.
- [ ] Visually verify first-run standalone/branch/cancel dialogs in Electron.
- [ ] Exercise Add Branch, setup-code copying/replacement, and fresh desktop
  activation in the browser/Electron UI. Follow DEPLOYMENT.md to enable the hub
  and configure its publicly reachable API origin before connecting devices.
- [ ] In a browser, exercise Budgets and Cash Register as owner, view-only staff,
  and staff with access to two branches; inspect errors and responsive layout.
- [ ] Run the installer on a clean target Windows machine, then upgrade it and
  confirm the existing business is retained.
- [ ] Configure scheduled backups and an off-machine copy for the deployed business.
- [ ] Provide release signing credentials if a signed installer is required.

The Electron pairing, client sign-in and recovery screens were inspected through
offscreen captures. Native first-run role dialogs and the financial screens still
need the manual checks above. Frontend build reports one JavaScript chunk above
500KB.

## Deferred product decisions

PIN/badge attendance, advanced budget periods/spending integration, register
closing/reconciliation, automatic till posting, desktop multi-organization RLS,
transactional multi-row spreadsheet imports, and additional hard-delete targets
remain separate feature work.
