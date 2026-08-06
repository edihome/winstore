# Database backups

Winstore stores everything (sales, stock, customers, staff) in PostgreSQL, so a
backup of that database is a backup of the business. This folder is where
`npm run backup` writes them.

## Taking a backup

```
npm run backup
```

This writes a compressed `winstore-<timestamp>.dump` here and prunes old ones
(keeps the most recent `BACKUP_RETAIN`, default 14). No special credentials
needed — the app's own `DATABASE_URL` is enough.

### How it works around Row Level Security

The app enforces tenant isolation with **forced Row Level Security** on its own
database role, which normally stops that role bulk-reading table data with
`pg_dump`. Rather than demand a superuser for a routine backup, the script runs
`pg_dump --enable-row-security` with `app.bypass_rls=on` set for the session —
the same bypass the policies already grant `runPrivileged`. The result is a
**complete** dump: every row of every table, across all tenants.

Because `--enable-row-security` would otherwise dump only *visible* rows if that
bypass ever stopped working, the script preflights it and refuses to write a
backup it can't see rows through. A superuser or `BYPASSRLS` role still works
unchanged if you prefer one — point `BACKUP_DATABASE_URL` at it.

## Scheduling (so it actually happens)

**Windows (a shop PC)** — one `schtasks` command registers a daily 2am backup
(run it once, as an admin). A small wrapper keeps the working directory right
so the script picks up `backend\.env`:

```bat
:: backend\run-backup.bat
@echo off
cd /d C:\path\to\winstore\backend
node scripts\backup-db.js
```

```bat
schtasks /Create /TN "Winstore Backup" /TR "C:\path\to\winstore\backend\run-backup.bat" /SC DAILY /ST 02:00 /RL HIGHEST
```

**Linux/server** — a cron entry (`crontab -e`):

```cron
0 2 * * *  cd /path/to/winstore/backend && /usr/bin/node scripts/backup-db.js
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
| `BACKUP_DATABASE_URL` | Connection to dump (optional; a superuser/BYPASSRLS role also works) | `DATABASE_URL`     |
| `BACKUP_DIR`          | Output folder                                       | `backend/backups`  |
| `BACKUP_RETAIN`       | How many dumps to keep                              | `14`               |
| `PG_DUMP`             | Path to the `pg_dump` binary                        | `pg_dump` (PATH)   |
