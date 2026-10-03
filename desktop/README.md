# Winstore Desktop

A self-contained desktop build of Winstore (Windows / macOS / Linux) via Electron.

**It changes nothing in `../backend` or `../frontend`.** This folder is a *wrapper*
that consumes them as artifacts:

1. starts a **bundled PostgreSQL** (via `embedded-postgres`) on loopback,
2. runs the backend's **own migrations** (`node-pg-migrate`, the backend's copy),
3. spawns the **unmodified** `backend/src/server.js` in `production` mode with
   `FRONTEND_DIST` pointed at `frontend/dist` — so the backend serves the API
   **and** the built React app on one `http://127.0.0.1` origin,
4. opens an Electron window to that origin.

All local state (database, desktop mode, and JWT secret) lives in the OS user-data
dir, never in the repo.

---

## Prerequisites (once)

Building requires Node.js and npm. `node-pg-migrate` requires Node.js 20.11 or
newer; use a Node.js version supported by the frontend build tools as well.
The packaged desktop uses Electron's bundled Node for migrations and the backend,
so end users do not need to install Node.js or PostgreSQL.

The wrapper runs the backend and frontend as-is, so they must be present and built:

```bash
# from the repo root
npm --prefix backend install          # backend deps (incl. node-pg-migrate, pg)
npm --prefix frontend install
npm --prefix frontend run build        # produces frontend/dist that the backend serves
```

Then install the desktop deps:

```bash
npm --prefix desktop install           # electron, electron-builder, embedded-postgres
```

> `embedded-postgres` pulls a platform-specific PostgreSQL 17 binary on install
> (on Windows: `@embedded-postgres/windows-x64`) — needs internet the first time.
> It's what lets the app run with **no separate Postgres install**.
>
> Note: this package currently publishes only pre-release ("beta") versions, so the
> dependency is **pinned to an exact version** (`17.10.0-beta.17`) rather than a
> caret range. It's also ESM-only, which is why `src/postgres.js` loads it via a
> dynamic `import()`. Bump the pin as newer builds land.

## Run it (development)

```bash
npm --prefix desktop start
```

On a new installation, the first-run dialog asks how this device will be used:

- **Standalone business:** initialize a local database, then register your
  organization on the login screen. Sync remains disabled.
- **Head-office branch:** initialize a local database, then enter the head-office
  address and one-time enrollment code on the existing link screen. An
  administrator creates that code at head office. Linking downloads the branch's
  data; sign in online with a head-office account once to cache its credentials
  for later offline sign-ins. Background sync runs when head office is reachable.
- **Cancel:** exit before starting the database or creating settings.

The mode is saved in `<userData>/desktop-config.json` and reused on restart.
Older installations with existing database files or a JWT secret retain
standalone behavior without being asked to link their business to another
organization. This setup does not convert an existing business into a branch;
use a fresh installation for branch enrollment. Invalid saved mode settings stop
startup so they can be restored from a backup.

Database initialization takes a few seconds; the splash shows
"Starting your local database…" before opening Winstore.

Subsequent launches reuse the PostgreSQL 17 cluster identified by `pgdata/PG_VERSION`.
An incomplete, unrecognized, or incompatible cluster stops startup and leaves
its files intact. A database with an encoding other than UTF8 also stops startup
without being dropped; back it up and migrate it to UTF8 before restarting.

Run the setup, backend environment, database lifecycle, and production migration
checks without Electron:

```bash
npm --prefix desktop test
```

These tests use isolated temporary directories and simulated PostgreSQL lifecycle
calls; they do not access the app's user data.

For a real component smoke test without opening a window:

```bash
npm --prefix desktop run smoke:runtime
```

This starts the bundled PostgreSQL 17 in a new `desktop/.smoke-*` directory,
runs migrations and the backend using Electron's Node runtime, registers a test
business and a 123.45 budget, then verifies both after a database/backend restart.
It also checks enrollment status on a separate fresh branch. It uses temporary
loopback ports, contacts no head office, and removes its checked temporary data
after its processes exit. Run it from a normal desktop terminal if a restricted
Windows execution environment cannot resolve the OS user account.

## Package installers

```bash
npm --prefix desktop run dist          # → desktop/dist/ (nsis / dmg / AppImage)
# or, for a quick unpacked folder to smoke-test:
npm --prefix desktop run dist:dir
# inspect the unpacked Windows resources without opening the app:
node desktop/scripts/verify-package.js
```

`electron-builder` bundles `../backend` and `../frontend/dist` under the app's
`resources/` (see the `build.extraResources` field in `package.json`).
Backend environment files, backups, logs, tests, smoke scripts, and coverage
artifacts are excluded from those resources.

**Slim the build:** before packaging, prune the backend to production deps so its
`node_modules` (which gets bundled) is smaller:

```bash
npm --prefix backend prune --omit=dev
```

`node-pg-migrate` and its runtime dependencies are backend production dependencies,
so they remain available after pruning. Run `npm --prefix desktop test` before
packaging to verify the migration CLI can load from a production-only dependency
tree. Restore development dependencies with `npm --prefix backend ci --include=dev`
when returning to backend development.

---

## Where things live

| What | Path |
|---|---|
| Database files | `<userData>/pgdata` |
| Desktop mode | `<userData>/desktop-config.json` |
| JWT secret (generated once) | `<userData>/jwt-secret` |
| Backend port (loopback) | `51123` |
| Postgres port (loopback) | `54329` |

`<userData>` is `%APPDATA%/winstore-desktop` (Windows),
`~/Library/Application Support/winstore-desktop` (macOS), or
`~/.config/winstore-desktop` (Linux). The folder follows the packaged application's
`name` (`winstore-desktop`), while its displayed product name is Winstore.
Uninstalling the app leaves this in place, so the business's data survives a
reinstall unless they delete it. To back up this folder, fully close Winstore
first, then copy the entire folder including its desktop settings and JWT secret.
For database backups while the app runs, follow
[the backup and restore instructions](../backend/backups/README.md) using the
desktop database connection. Reports → Export data produces spreadsheets for
reviewing business records; use the folder copy or database dump for recovery.

## Notes & caveats

- **Single-org / single-user model.** The bundled DB user is the Postgres
  superuser, so Row-Level Security is effectively bypassed on the desktop. That's
  fine for one business on its own machine (the app's `WHERE organization_id`
  filters still scope every query). If you ever want the full RLS trust boundary
  on the desktop (e.g. more than one org on one box), create a **non-superuser
  app role** that connects instead, and run migrations so the tables aren't owned
  by the connecting role — mirroring the cloud setup. Left out here to keep the
  first build simple.
- **Fixed loopback ports.** If `51123`/`54329` are taken, change them in
  `src/config.js` (or add port discovery).
- **Shutdown order.** The desktop waits for the backend to exit before stopping
  PostgreSQL. A backend that does not finish within five seconds is force-killed;
  shutdown reports a failure if it still has not exited after another five seconds.
- **Icons.** `build/icon.png` (1024×1024) is the app icon — electron-builder
  auto-derives the Windows `.ico` and macOS `.icns` from it. It ships with a
  generated placeholder (teal tile + "W"); replace it with your real logo at the
  same path (or edit + rerun `npm run make-icon`).
- **Desktop sync follows its saved mode.** Standalone uses `SYNC_ENABLED=false`;
  head-office branch uses `SYNC_ENABLED=true` and `SYNC_NODE_KIND=branch`.
  Enrollment stores the hub address and refresh secret in the local PostgreSQL
  database. The desktop clears inherited `SYNC_HUB_URL` / `SYNC_HUB_TOKEN` values
  so they cannot override that stored link. Unlinked branches show the enrollment
  screen on restart until linking completes.
- The Electron app itself hasn't been launch-tested in CI here; run
  `npm --prefix desktop start` on a real desktop to smoke-test the first-run flow.

---

## Code signing

An **unsigned** installer works, but Windows SmartScreen shows a "unknown
publisher" warning (and macOS Gatekeeper blocks it). Signing removes that. You
need a certificate — the app config is already signing-ready; you just supply the
cert via environment variables and electron-builder signs automatically.

### Windows

Get a code-signing certificate, then pick the method that matches it:

**A. Standard OV certificate as a `.pfx` file** (simplest; ~$100–300/yr)

```powershell
$env:CSC_LINK = "C:\path\to\your-cert.pfx"   # or a base64 string of the .pfx
$env:CSC_KEY_PASSWORD = "your-pfx-password"
npm --prefix desktop run dist                 # electron-builder signs the .exe automatically
```

Nothing else to configure — electron-builder detects `CSC_LINK` / `CSC_KEY_PASSWORD`.
(An OV cert still needs reputation to build before SmartScreen goes quiet; an **EV**
cert is trusted immediately but lives on a hardware token — see below.)

**B. Azure Trusted Signing** (modern, cheap ~US$10/mo, no hardware token) — set
`build.win.azureSignOptions` in `package.json` with your endpoint/account/profile
and authenticate via the Azure env vars. See electron-builder's
"Code Signing → Windows → Azure Trusted Signing" docs.

**C. EV certificate on a USB/HSM token** — signing can't be fully automated
(the token prompts for a PIN). Use a custom sign hook (`build.win.sign` pointing
at a script that calls the token's `signtool`), or sign the built `.exe`
manually with `signtool` after `dist`.

### macOS

Sign + **notarize** (required for distribution outside the App Store):

```bash
export CSC_LINK="/path/to/DeveloperIDApp.p12"
export CSC_KEY_PASSWORD="p12-password"
# notarization (electron-builder ≥ 24 uses @electron/notarize):
export APPLE_ID="you@apple.id"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="YOURTEAMID"
npm --prefix desktop run dist
```

`build.mac.hardenedRuntime` is already on (a notarization prerequisite).

### Keep certs out of the repo

Never commit `.pfx`/`.p12` files or passwords. Use the env vars above (locally or
in CI secrets). `CSC_LINK` also accepts a **base64** blob, which is convenient for
CI without checking a file in.
