/**
 * ============================================================
 * File: backup-db.js
 * Module: Scripts
 *
 * Description:
 * Writes a compressed, timestamped database backup to the local `backups/`
 * folder using pg_dump, and prunes old ones (keeps the most recent
 * BACKUP_RETAIN, default 14). Runs entirely locally — suitable for an
 * offline shop machine; copy the folder to a USB/network drive for an
 * off-site copy.
 *
 *   npm run backup
 *
 * IMPORTANT — must run as a PRIVILEGED database role. The app forces Row
 * Level Security on its own (owner) role, which makes pg_dump of table data
 * fail for that role. Point BACKUP_DATABASE_URL at a superuser or a role
 * with BYPASSRLS, e.g.:
 *
 *   BACKUP_DATABASE_URL=postgresql://postgres:PASSWORD@localhost:5432/winstore_db npm run backup
 *
 * Restore (also as a privileged role, into an existing empty database):
 *
 *   pg_restore --clean --if-exists --no-owner -d <connection-url> <file.dump>
 *
 * Env:
 *   BACKUP_DATABASE_URL  connection to dump (defaults to DATABASE_URL)
 *   BACKUP_DIR           output folder (defaults to backend/backups)
 *   BACKUP_RETAIN        how many dumps to keep (default 14)
 *   PG_DUMP              path to the pg_dump binary (default "pg_dump")
 * ============================================================
 */

require("dotenv").config({ quiet: true });
const path = require("node:path");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const url = process.env.BACKUP_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
    console.error("No BACKUP_DATABASE_URL or DATABASE_URL set — nothing to back up.");
    process.exit(1);
}

const backupDir = process.env.BACKUP_DIR || path.join(__dirname, "..", "backups");
const retain = Math.max(1, Number(process.env.BACKUP_RETAIN || 14));
const pgDump = process.env.PG_DUMP || "pg_dump";

fs.mkdirSync(backupDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outFile = path.join(backupDir, `winstore-${stamp}.dump`);

// Pass connection parts as flags and the password via the environment, so the
// password never appears in the process arguments (visible to `ps`).
const parsed = new URL(url);
const args = [
    "-h",
    parsed.hostname,
    "-p",
    parsed.port || "5432",
    "-U",
    decodeURIComponent(parsed.username),
    "-d",
    decodeURIComponent(parsed.pathname.slice(1)),
    "-Fc", // custom format: compressed, restorable with pg_restore
    "--no-owner",
    "--no-privileges",
    "-f",
    outFile,
];

const result = spawnSync(pgDump, args, {
    env: { ...process.env, PGPASSWORD: decodeURIComponent(parsed.password || "") },
    encoding: "utf8",
});

if (result.error && result.error.code === "ENOENT") {
    console.error(
        `Could not run "${pgDump}". Make sure PostgreSQL's bin folder is on PATH, ` +
            "or set PG_DUMP to the full path of pg_dump (e.g. " +
            'PG_DUMP="C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe").'
    );
    process.exit(1);
}

if (result.status !== 0) {
    const stderr = result.stderr || "";
    if (/row-level security/i.test(stderr)) {
        console.error(
            "Backup failed: the app's database role cannot read RLS-protected tables.\n" +
                "Run backups as a superuser or a role with BYPASSRLS by setting BACKUP_DATABASE_URL, e.g.\n" +
                "  BACKUP_DATABASE_URL=postgresql://postgres:PASSWORD@localhost:5432/winstore_db npm run backup"
        );
    } else {
        console.error(`Backup failed:\n${stderr}`);
    }
    // Don't leave a half-written file behind.
    fs.rmSync(outFile, { force: true });
    process.exit(result.status || 1);
}

console.log(`Backup written: ${outFile}`);

// Retention: keep the most recent `retain` dumps, delete the rest.
const dumps = fs
    .readdirSync(backupDir)
    .filter((name) => /^winstore-.*\.dump$/.test(name))
    .sort(); // timestamped names sort chronologically
const excess = dumps.slice(0, Math.max(0, dumps.length - retain));
for (const name of excess) {
    fs.rmSync(path.join(backupDir, name), { force: true });
    console.log(`Pruned old backup: ${name}`);
}
