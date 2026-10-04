# Winstore Desktop

A self-contained desktop build of Winstore (Windows / macOS / Linux) via Electron.

The desktop consumes the existing backend and built frontend. On a **host PC** it:

1. starts a **bundled PostgreSQL** (via `embedded-postgres`) on loopback,
2. runs the backend's **own migrations** (`node-pg-migrate`, the backend's copy),
3. spawns the **unmodified** `backend/src/server.js` in `production` mode with
   `FRONTEND_DIST` pointed at `frontend/dist` — so the backend serves the API
   **and** the built React app on one `http://127.0.0.1` origin,
4. opens an Electron window to that origin,
5. optionally serves other store PCs through a separate encrypted LAN gateway.

A **connected PC** opens the host's app after checking the host's saved certificate
identity. It runs no local database, migrations, backend, or head-office sync.

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

On a new installation, choose **Host this store** on the main PC or **Connect to
this store** on each other PC. A host then asks how the business is managed:

- **Standalone business:** initialize a local database, then register your
  organization on the login screen. Sync remains disabled.
- **Head-office branch:** initialize a local database, then paste the single
  **branch setup code** generated when an administrator adds the branch on the
  web. The code includes the head-office address and expires after 24 hours.
  Verification and initial synchronization download the selected branch's
  data; sign in online with a head-office account once to cache its credentials
  for later offline sign-ins. Each account signs in online once on this device.
  Background sync runs when head office is reachable. The installed branch is
  saved across restarts and becomes the active branch for local transactions.
- **Cancel:** exit before starting the database or creating settings.

A connected PC asks for the **store connection code** copied from the host's
Business profile. It verifies the encrypted connection, shows the store name for
confirmation, saves the host address and certificate pin, and opens staff sign-in.
Store connection codes begin with `ws1:`. They are separate from the branch setup
codes used to enroll a host with head office.

The role and settings are saved in `<userData>/desktop-config.json` and reused on restart.
Older installations with existing database files or a JWT secret retain
their local host; saved standalone or branch modes are preserved, with sharing
disabled on upgrade. They are not asked to link their business to another
organization. This setup does not convert an existing business into a branch or
a connected PC; use a fresh installation with no existing Winstore database for
either role change. Uninstalling alone does not remove that database. Invalid saved settings stop
startup so they can be restored from a backup.

## Several PCs in one store

1. Finish business registration or branch setup on the host PC and sign in as
   the owner (Super Admin).
2. Open **Administration → Business profile → Host this store**. If the PC has
   multiple private network addresses, choose the store's network, then select
   **Enable store sharing**.
3. Approve the Windows administrator prompt. Winstore creates or updates a
   firewall rule for its executable on **TCP 51124**, restricted to the
   **Private** network profile and **LocalSubnet** remote addresses. A denied
   prompt leaves sharing off and reports the failure. Set the store's trusted
   network to Private in Windows; the app does not change network profiles.
4. Select **Show connection code**, copy it, and paste it into **Connect to this
   store** on each other PC. Confirm the store name and sign in with that
   cashier's staff account. Connected PCs cannot register another business or
   enroll the host with head office.

The gateway uses HTTPS with a per-install certificate. Connected PCs pin its
SHA-256 fingerprint and verify its host identity; they reject a changed
certificate or a different host. PostgreSQL (`54329`) and the backend (`51123`)
remain bound to loopback and are not opened by the firewall rule. The owner must
sign in on the host to enable/stop sharing, reveal its code, or change startup
settings. Account checks happen against the local backend for each action.

Closing the host window while sharing is enabled keeps Winstore serving in the
system tray. Reopen it from the tray or its shortcut. **Stop sharing** disconnects
the other tills while this PC continues to work. **Quit Winstore** in the tray
offers a **Stop store server** confirmation and then shuts down the host; other
tills cannot check out until it starts again. A second launch reopens the running
instance.

The optional **Start Winstore at Windows sign-in** setting is available in the
installed Windows app. It applies to the current Windows user and starts the
host in the background when that user signs in; it is not a Windows service and
does not make the store available before sign-in. Previously enabled sharing
resumes without another firewall prompt.

Checkout needs the host PC and local network to stay running. Internet can be
unavailable while the store works locally. For a head-office branch, only the
host synchronizes and caches staff credentials; connected PCs use the host's
accounts and data. If the host or local network becomes unavailable, connected
PCs show reconnection and **Change connection** options rather than creating
separate stock records. A changed host identity requires a new verified code.

Reserve the host's private IPv4 address in the router's DHCP settings to keep
connections stable. If its address changes, select the current store network
on the host, enable sharing again, and copy a new code to the other PCs using
**Change connection**. Stop sharing first when deliberately switching an active
host to a different network address. Share connection codes directly with the
staff setting up the store's PCs.

Automatic firewall setup currently supports Windows. Do not expose the desktop
gateway to the internet; use the cloud/server deployment for remote access.

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

These tests use isolated temporary directories, simulated PostgreSQL lifecycle
calls, and real loopback HTTP/HTTPS connections for authorization and encrypted
sharing checks. Firewall and Windows startup actions are injected test doubles;
tests do not request administrator elevation or access the app's user data.

For a real component smoke test without opening a window:

```bash
npm --prefix desktop run smoke:runtime
```

This starts the bundled PostgreSQL 17 in a new `desktop/.smoke-*` directory,
runs migrations and the backend using Electron's Node runtime, registers a test
business and a 123.45 budget, then verifies both after a database/backend restart.
It also checks enrollment status on a separate fresh branch. It uses temporary
TLS clients to check two cashier sessions, permissions, simultaneous last-item
sales, unavailable-host recovery and restart persistence with a saved host pin.
It uses temporary
loopback ports, contacts no head office, and removes its checked temporary data
after its processes exit. Run it from a normal desktop terminal if a restricted
Windows execution environment cannot resolve the OS user account.

For real Electron renderer verification against an isolated TLS gateway and the
built frontend, run `npm --prefix desktop run smoke:ui`. It uses hidden offscreen
windows, checks the pairing form and staff sign-in/recovery screens, and saves
review captures under `desktop/dist/verification`. It opens no business database
and changes no firewall or Windows startup setting.

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
| Store identity and TLS key (created when sharing is enabled) | `<userData>/store-identity.json` |
| Encrypted store gateway (private LAN address) | `51124` |
| Backend port (loopback) | `51123` |
| Postgres port (loopback) | `54329` |

`<userData>` is `%APPDATA%/winstore-desktop` (Windows),
`~/Library/Application Support/winstore-desktop` (macOS), or
`~/.config/winstore-desktop` (Linux). The folder follows the packaged application's
`name` (`winstore-desktop`), while its displayed product name is Winstore.
Uninstalling the app leaves this in place, so the business's data survives a
reinstall unless they delete it. To back up this folder, select **Quit Winstore**
in the host's system tray and confirm **Stop store server** first, then copy the
entire folder including its desktop settings, JWT secret, and store identity.
Closing a sharing host's window alone leaves it running. Keep its saved store
identity when restoring so connected PCs continue to recognize the host.
For database backups while the app runs, follow
[the backup and restore instructions](../backend/backups/README.md) using the
desktop database connection. Reports → Export data produces spreadsheets for
reviewing business records; use the folder copy or database dump for recovery.

## Notes & caveats

- **One store database with multiple staff accounts.** The bundled DB user is the Postgres
  superuser, so Row-Level Security is effectively bypassed on the desktop. That's
  used for one business hosted on the main PC (the app's `WHERE organization_id`
  filters still scope every query). If you ever want the full RLS trust boundary
  on the desktop (e.g. more than one org on one box), create a **non-superuser
  app role** that connects instead, and run migrations so the tables aren't owned
  by the connecting role — mirroring the cloud setup. Left out here to keep the
  desktop deployment simple. Connected staff use their own app permissions.
- **Fixed ports.** The local backend/database use `51123`/`54329`; the store
  gateway uses `51124` on a selected private network address. A port conflict
  reports an error; keep these ports available for Winstore.
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
  screen on restart until linking completes. Connected PCs never start sync.
- Automated checks cover encrypted loopback sharing and component startup.
  Verify the packaged first-run, Windows administrator prompt, tray/startup,
  two-PC checkout, reconnect, clean install, and upgrade flows on actual store
  PCs before rollout. These manual checks are tracked in `../COMPLETION.md`.

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
