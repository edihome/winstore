# Deploying Winstore

Winstore ships as **one process**: in production the backend serves both the
API and the built web app from the same origin. That single build runs
identically in all three deployment shapes — only a few environment variables
and how you *reach* it differ:

| Shape | Where it runs | Reached at | Internet |
| --- | --- | --- | --- |
| **Single PC** | one shop computer | `http://localhost:5000` on that PC | not required |
| **Shop LAN** | one "server" PC; tablets/PCs connect to it | `http://<server-ip>:5000` | not required |
| **Cloud** | a cloud VM behind a reverse proxy | `https://your-domain` | required |

Because the frontend calls the API on whatever origin served it, there is
**nothing per-machine to rebuild** — the same `frontend/dist` works on
localhost, a LAN IP, or a domain.

---

## Prerequisites (all shapes)

- **Node.js 18+** and **PostgreSQL 14+** installed.
- A database and a DB user for the app (not a superuser — that's the point of
  the row-level-security isolation).

## First-time setup

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

### Single PC
Nothing extra. Leave `FRONTEND_URL` and `TRUST_PROXY` blank. The app is
reached at `http://localhost:5000`. Works fully offline.

### Shop LAN
Same as single PC. The LAN-safe CORS allows any device on a private network
(`192.168.x`, `10.x`, `172.16–31.x`) with **no configuration**. Point the
other devices' browsers at `http://<server-ip>:5000`. Allow port **5000**
through the server PC's firewall. Works fully offline.

### Cloud (internet-facing)
Put a reverse proxy (nginx / Caddy) in front that terminates **HTTPS**, then:

```
NODE_ENV=production
FRONTEND_URL=https://your-domain     # the public origin (CORS allowlist)
TRUST_PROXY=true                     # so client IPs / rate limiting are correct behind the proxy
```

TLS is **mandatory** here — without it, passwords and tokens travel in
cleartext. (On a single PC / LAN the traffic never leaves the local network,
so plain HTTP is acceptable.)

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

Backups must run as a **superuser / BYPASSRLS** role (the app's own role is
deliberately blocked from bulk-reading by row-level security). Schedule
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
