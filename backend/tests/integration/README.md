# Integration tests (the money paths)

These tests boot the **real** Express app in-process and drive it over HTTP,
so each one exercises the full stack — routes, auth/permission/branch/
subscription middleware, services, repositories, and real PostgreSQL
transactions. No mocks. They cover the flows that actually move money and
stock, where a silent regression would be most expensive:

- **`sales.test.js`** — checkout totals, payment reconciliation (single
  method, cash change, split tender), the insufficient-stock guard, stock
  deduction, and returns/refunds (full + proportional, VAT included).
- **`stock.test.js`** — stock in/out aggregates, the no-negative guard, and
  cross-branch transfers (atomic move + expiry-batch carry + guards).
- **`auth-rbac.test.js`** — baseline staff can sell but not manage
  inventory, an expired **or** deactivated subscription locks staff out on
  the next request, and HR/salary is writable/readable only by a super_admin.

## Isolation

Tests never touch development or production data. The whole app is redirected
onto a dedicated **`winstore_test` schema** by pinning the connection's
`search_path` to it (see `testdb.js`). Because the app's SQL is unqualified,
that one knob moves every query onto the test tables — no separate database
and **no `CREATE DATABASE`/superuser privilege required**. Each test starts
from a truncated schema.

## Running

```bash
npm run test:setup   # once: create + migrate the winstore_test schema
npm test             # runs unit + integration together
npm run test:reset   # drop and rebuild the test schema from scratch
```

`npm test` runs with `--test-concurrency=1` on purpose: the integration files
share the one test schema, so they must run one file at a time (a test file
truncates between cases).

If the test schema isn't set up (e.g. CI without a database), these tests
**skip cleanly** rather than failing — so `npm test` stays green anywhere.
Run `npm run test:setup` to enable them.

Override the location with `TEST_DATABASE_URL`; otherwise it derives from
`DATABASE_URL` (same server, `winstore_test` schema).
