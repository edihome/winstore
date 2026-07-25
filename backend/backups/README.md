# Database backups

Winstore stores everything (sales, stock, customers, staff) in PostgreSQL, so a
backup of that database is a backup of the business. This folder is where
`npm run backup` writes them.

## Taking a backup

```
BACKUP_DATABASE_URL=postgresql://postgres:PASSWORD@localhost:5432/winstore_db npm run backup
```

This writes a compressed `winstore-<timestamp>.dump` here and prunes old ones
(keeps the most recent `BACKUP_RETAIN`, default 14).

### Why a superuser / privileged role?

The app enforces tenant isolation with **forced Row Level Security** on its own
database role. A useful side effect is that the *app* role cannot bulk-read
table data with `pg_dump` — so backups must run as a **superuser** (e.g.
`postgres`) or a role created with **BYPASSRLS**. Point `BACKUP_DATABASE_URL` at
that role. If you run it as the app role you'll get a clear "row-level security"
error telling you the same thing.

## Scheduling (so it actually happens)

**Windows (a shop PC)** — one `schtasks` command registers a daily 2am backup
(run it once, in the `backend` folder, as an admin). Put the privileged URL in
a small wrapper so it isn't stored in the task arguments:

```bat
:: backend\run-backup.bat
@echo off
set BACKUP_DATABASE_URL=postgresql://postgres:PASSWORD@localhost:5432/winstore_db
node scripts\backup-db.js
```

```bat
schtasks /Create /TN "Winstore Backup" /TR "C:\path\to\winstore\backend\run-backup.bat" /SC DAILY /ST 02:00 /RL HIGHEST
```

**Linux/server** — a cron entry (`crontab -e`):

```cron
0 2 * * *  BACKUP_DATABASE_URL=postgresql://postgres:PASSWORD@localhost:5432/winstore_db /usr/bin/node /path/to/winstore/backend/scripts/backup-db.js
```

**Keep a copy off the machine.** A backup on the same disk that dies with it
isn't a backup — copy this folder to a USB drive, network share, or cloud
storage regularly (e.g. add a second line to the wrapper/cron that copies the
newest `*.dump` to your off-site location).

## Restoring

Into an existing (empty) database, as a privileged role:

```
pg_restore --clean --if-exists --no-owner -d postgresql://postgres:PASSWORD@localhost:5432/winstore_db winstore-<timestamp>.dump
```

## Test your restore (do this once, before you rely on it)

An untested backup isn't a backup. Prove a dump actually restores by loading
it into a throwaway database — this touches nothing in production:

```bash
# 1. create a scratch database (as a superuser)
psql -U postgres -c "CREATE DATABASE winstore_restore_test;"

# 2. restore the newest dump into it
pg_restore --no-owner -d postgresql://postgres:PASSWORD@localhost:5432/winstore_restore_test backups/winstore-<timestamp>.dump

# 3. sanity-check it has data, then throw it away
psql -U postgres -d winstore_restore_test -c "SELECT count(*) FROM organizations;"
psql -U postgres -c "DROP DATABASE winstore_restore_test;"
```

If step 3 shows a sensible row count, your backup + restore path works. Repeat
after any major upgrade.

## Environment variables

| Variable              | Purpose                                            | Default            |
| --------------------- | -------------------------------------------------- | ------------------ |
| `BACKUP_DATABASE_URL` | Connection to dump (use a superuser/BYPASSRLS role) | `DATABASE_URL`     |
| `BACKUP_DIR`          | Output folder                                       | `backend/backups`  |
| `BACKUP_RETAIN`       | How many dumps to keep                              | `14`               |
| `PG_DUMP`             | Path to the `pg_dump` binary                        | `pg_dump` (PATH)   |
