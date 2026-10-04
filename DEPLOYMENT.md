# Deploying Winstore

In production the Winstore backend serves both the API and the built web app
from the same origin. Run it directly as a server, or use the desktop installer
on a host and its connected store PCs:

| Shape | Where it runs | Reached at | Internet |
| --- | --- | --- | --- |
| **Desktop / shared store** | installed host PC; other installed PCs connect to it | host app; verified HTTPS store connection on `51124` | not required for local work |
| **Server / single PC** | one shop computer | `http://localhost:5000` on that PC | not required |
| **Server / shop LAN** | one "server" PC; tablets/PCs connect to it | `http://<server-ip>:5000` | not required |
| **Cloud** | a cloud VM behind a reverse proxy | `https://your-domain` | required |

Because the frontend calls the API on whatever origin served it, there is
**nothing per-machine to rebuild** — the same `frontend/dist` works on
localhost, a LAN IP, or a domain.

---

## Prerequisites (server deployments)

- **Node.js 22.13+ or 24+** and **PostgreSQL 14+** installed. Node 24 is used
  for local verification. The desktop package supplies its own runtime and PG17.
- A database and a DB user for the app (not a superuser — that's the point of
  the row-level-security isolation).

## First-time setup (server deployments)

From the `backend/` folder:

```bash
# 1. Install API dependencies
npm install

# 2. Configure the environment (copy the example and edit it)
cp .env.example .env
#    Then set at minimum:
#      DATABASE_URL   → your Postgres connection string
#      NODE_ENV=production
#      JWT_SECRET     → run: npm run generate-secret   (paste the output)
#    (FRONTEND_URL / TRUST_PROXY only matter for cloud — see below.)

# 3. Create the schema
npm run migrate

# 4. Build the web app (installs + builds ../frontend into frontend/dist)
npm run build:web

# 5. Start it
npm start
```

Then open the app (see the table above), click **Register**, and create the
first organization — its first user is the owner (Super Admin).

> To promote someone to the platform **developer** role later:
> `node scripts/create-developer.js <their-email>` (run on the server).

---

## Per-shape configuration

### Single PC (direct server deployment)
Nothing extra. Leave `FRONTEND_URL` and `TRUST_PROXY` blank. The app is
reached at `http://localhost:5000`. Set `HOST=127.0.0.1` to restrict connections
to this PC. Works fully offline. The [desktop app](desktop/README.md) sets this
automatically and offers **Host this store** or **Connect to this store**.
A host then chooses standalone or head-office-linked branch setup.

### Desktop host and connected PCs

Install Winstore on the main PC and choose **Host this store**. Complete local
business registration or head-office branch enrollment and sign in as the
owner (Super Admin). Open **Administration → Business profile → Host this
store**, select the store network if several private IPv4 addresses are
available, and choose **Enable store sharing**.

On Windows this owner action invokes an administrator prompt to allow Winstore's
**TCP 51124** gateway for the **Private** network profile and **LocalSubnet**
connections. Denied administrator access leaves sharing off and reports an
error. The backend (`127.0.0.1:51123`) and PostgreSQL (`127.0.0.1:54329`) remain
private to the host. The app does not enable access for Public networks.

Choose **Show connection code** on the host. On each other fresh PC installation,
choose **Connect to this store**, paste the `ws1:` code, confirm the verified
store name, and sign in with the staff member's existing account. The code
contains the host's HTTPS address and certificate identity. Clients save the
host's certificate pin and reject a different identity. They run no local
database, migrations, backend, or head-office synchronization. A store
connection code is separate from a head-office branch setup code.

Closing a sharing host's window leaves it running in the system tray. Use
**Quit Winstore → Stop store server** to shut it down; connected tills lose access
until the host starts again. **Stop sharing** in Business profile stops LAN
access while the host remains usable. The owner can optionally enable **Start
Winstore at Windows sign-in** in the installed Windows app. This applies to the
current Windows user and requires sign-in; the desktop does not run as a boot
service.

Internet outages permit local checkout while the host and network remain
available. Host/network outages pause connected checkout and show reconnect or
**Change connection** options. Reserve the host's private IP address in the
router to avoid address changes. If it changes, select the new address on the
host, restart sharing, and copy a new verified code to the other PCs. Stop
sharing first before switching an active host to another network address.

Upgrades preserve existing local databases and standalone/branch modes, with
sharing disabled for legacy installations. An existing local database cannot
be converted into a client. Use a fresh installation with no existing Winstore
data; uninstalling alone preserves that data. See [desktop setup and operation](desktop/README.md)
for backup details and the packaged Windows checks required before rollout.

### Shop LAN (direct server deployment)
Same as single PC. The LAN-safe CORS allows any device on a private network
(`192.168.x`, `10.x`, `172.16–31.x`) with **no configuration**. Point the
other devices' browsers at `http://<server-ip>:5000`. Allow port **5000**
through the server PC's firewall. Works fully offline.
Leave `HOST` blank or bind it to the server's LAN address. This is the original
Node/server deployment on port **5000**, separate from the installed desktop's
encrypted gateway on **51124**. Browsers need a trusted TLS reverse proxy for
encrypted direct-server LAN access; desktop clients handle their own host pin.

### Cloud (internet-facing)
Put a reverse proxy (nginx / Caddy) in front that terminates **HTTPS**, then:

```
NODE_ENV=production
HOST=127.0.0.1                      # bind locally when the proxy is on this host
FRONTEND_URL=https://your-domain     # the public origin (CORS allowlist)
TRUST_PROXY=true                     # so client IPs / rate limiting are correct behind the proxy
```

TLS is **mandatory** here — without it, passwords and tokens travel in
cleartext. Single-PC loopback HTTP stays on that PC. Direct-server LAN HTTP is
unencrypted; use a TLS proxy when staff connect over a network. Desktop sharing
already uses encrypted HTTPS with a verified host identity.

### Head office for offline branches

For head office to serve offline branches, also set `SYNC_ENABLED=true` and
`SYNC_NODE_KIND=hub`, and `SYNC_PUBLIC_URL=https://your-head-office-domain`, then
restart the backend. Apply migration `067_sync_branch_binding` along with the
other pending migrations before running the updated backend. The public URL is
the API origin reachable from branch desktops, including a port when needed;
it contains no `/api/v1` path. Set it explicitly behind a reverse proxy or when
the frontend and API use different domains. Without it, codes use the API
request's protocol and host.

On the web, open Branches, click **Add Branch**, enter its name/details, and
submit. Copy the generated **branch setup code**. Choose Host this store, then Head-office branch on
a fresh desktop installation and paste that code while online. The code already
contains the head-office address. The desktop verifies it, downloads reference
data and the selected branch's inventory, and commits the local data and link
together. Sign in once while connected to cache your account for offline use.
Each account needs its first sign-in on that device while online.

Setup codes expire after 24 hours and can be used once. Branches offers **Setup
code** to generate a replacement; this expires older unused codes for that
branch. The short Reference value in the branch list identifies a branch for
imports and is separate from its setup credential. Branch installs use head-office
accounts and refuse local business registration. Standalone desktops leave sync
disabled; use the server deployment for a head-office hub.

### Setting up HTTPS (cloud only)

TLS is terminated by a **reverse proxy** in front of the app — the Node
process keeps speaking plain HTTP on `localhost:5000`. This is why HTTPS needs
**no app code change**: the frontend already calls a relative `/api/v1`, so it
inherits `https://` automatically. You need a **domain** (a DNS A record →
your server's IP) and one of the proxies below (both auto-renew the
certificate). Point the domain at the server, then:

**Option A — Caddy (simplest; automatic Let's Encrypt).** `/etc/caddy/Caddyfile`:

```
app.your-domain.com {
    reverse_proxy localhost:5000
    header Strict-Transport-Security "max-age=31536000; includeSubDomains"
}
```

That's it — Caddy fetches and renews the cert on its own.

**Option B — nginx + certbot.** A minimal server block, then run
`certbot --nginx -d app.your-domain.com` to obtain the cert and rewrite this
to listen on 443:

```nginx
server {
    server_name app.your-domain.com;
    location / {
        proxy_pass http://localhost:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
}
```

**Option C — a managed platform** (Render, Railway, Fly.io, an AWS/GCP load
balancer): the platform terminates TLS for you; you don't run a proxy. Just
set the env vars below.

**Firewall:** open **443** (and **80** for the HTTP→HTTPS redirect and the
cert challenge); keep **5000 internal** — never expose it publicly. Then set:

```
NODE_ENV=production
JWT_SECRET=<strong — npm run generate-secret>
FRONTEND_URL=https://app.your-domain.com
TRUST_PROXY=true
```

> HSTS (the `Strict-Transport-Security` header above) belongs **at the proxy**,
> never in the app. It must only ever be sent by a deployment that is actually
> on HTTPS — a single-PC / LAN box runs `NODE_ENV=production` over plain HTTP,
> and HSTS there would make the browser refuse to load it.

---

## Keeping it running

- **Windows (single PC / LAN):** run it as a service so it starts on boot and
  restarts on crash — e.g. [NSSM](https://nssm.cc/) pointing at
  `node backend/src/server.js` with the working directory set to `backend/`,
  or `pm2 start src/server.js --name winstore` + `pm2 save` + `pm2 startup`.
- **Linux (cloud):** a `systemd` unit or `pm2` as above.

The server shuts down gracefully on stop/restart (finishes in-flight requests,
then closes the DB pool), so a reboot won't sever a checkout mid-transaction.

## Backups (do this before real use)

The backup script supports the app's own database role using the existing
RLS bypass with a visibility preflight; a superuser or BYPASSRLS role also works.
Install PostgreSQL client tools (`pg_dump` and `pg_restore`) on the backup host;
the embedded desktop database does not include them. Set `PG_DUMP` if the
executable is not on PATH. Schedule
`npm run backup` daily (copy-paste `schtasks`/cron commands provided), copy the
folder off the machine, and **test a restore once** — all in
[backend/backups/README.md](backend/backups/README.md).

## Recovering a locked-out account

Staff who forget their password are reset from inside the app by an admin
(Staff page → Reset password). The **owner** (super admin), or anyone when no
admin is available, is recovered from the server instead — no email required,
so it works on an offline box too:

```bash
npm run reset-password -- owner@their-email.com
```

It prints a temporary password, forces a change at next login, and signs out
the user's existing sessions. Hand the temporary password to them; they set a
new one on first login. (Provisioning the platform developer role is the
separate `npm run create-developer`.)

## Upgrades

```bash
git pull
cd backend && npm install && npm run migrate && npm run build:web
# then restart the service
```
