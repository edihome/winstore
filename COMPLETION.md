# Winstore completion checklist

This is the current checklist. README slice entries describe the feature history;
they do not replace release verification. Last reviewed: 2026-10-03.

## Implemented

- [x] First-run desktop choice between standalone business and head-office-linked
  branch, saved across restarts. Existing installations preserve standalone mode.
- [x] Head-office branches show the existing enrollment screen. Standalone installs
  keep sync disabled. Desktop binds the backend to loopback.
- [x] Branch linking requires an empty branch installation. All snapshot pages and
  the durable link commit together; a failed download rolls back local data.
  Branch registration is refused; accounts are managed at head office. If a
  failure follows code redemption, obtain a new one-time enrollment code.
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

- [x] Targeted backend validation and financial/enrollment integration: 75 passed.
- [x] Frontend lint and production build passed.
- [x] Full backend regression suite: 188 passed, including registration guards.
- [x] Final frontend tests: 21 passed, including branch signup, setup-probe guards,
  and historic signed budget amounts.
- [x] Final desktop test suite: 43 passed, including saved modes, inherited
  environment isolation, shutdown ordering, and production migration CLI.
- [ ] Real embedded PostgreSQL 17 and Electron Node runtime: migrate, start API,
  create data, restart, and verify persistence using an isolated temporary cluster.
  The script reached Electron 33.4.11 / Node 20.18.3, then Windows sandbox
  `os.userInfo()` failed with `uv_os_get_passwd ENOMEM`; the required permission
  request was canceled. Run `npm --prefix desktop run smoke:runtime` in an ordinary
  terminal to complete this check. Temporary data from the failed run was removed.
- [x] Real branch/hub HTTP enrollment, upstream/downstream sync, role replication,
  scheduled sync, cross-branch shipments, and revocation.
- [x] Backup and restore round trip: two organizations, two budgets, two registers,
  three cash movements and timestamps preserved; balances reconcile. The backup
  used an ordinary tenant-restricted role and verified the RLS bypass.
- [x] Windows unpacked application built and inspected: desktop code, backend,
  migrations, and current frontend match source; production migration CLI is
  present; backend environment files and private/development artifacts excluded.
  Bundled PostgreSQL executables match the installed binaries; inherited Electron
  diagnostic log removed and an after-pack cleanup hook added.
  Artifact: `desktop/dist/win-unpacked/Winstore.exe`. This review build is unsigned
  and skipped Windows executable signing/metadata editing through a command
  override; the normal release signing configuration is unchanged.

## Before distributing to users

- [ ] Visually verify first-run standalone/branch/cancel dialogs in Electron.
- [ ] In a browser, exercise Budgets and Cash Register as owner, view-only staff,
  and staff with access to two branches; inspect errors and responsive layout.
- [ ] Run the installer on a clean target Windows machine, then upgrade it and
  confirm the existing business is retained.
- [ ] Configure scheduled backups and an off-machine copy for the deployed business.
- [ ] Provide release signing credentials if a signed installer is required.

The browser-control runtime is unavailable in this session. Component/runtime
checks do not establish that the Electron dialogs or React layouts were visually
tested. Frontend build currently reports one JavaScript chunk above 500KB.

## Deferred product decisions

PIN/badge attendance, advanced budget periods/spending integration, register
closing/reconciliation, automatic till posting, desktop multi-organization RLS,
transactional multi-row spreadsheet imports, and additional hard-delete targets
remain separate feature work.
