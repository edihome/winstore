/**
 * Verify backup-db.js + pg_restore against a fresh embedded PostgreSQL cluster.
 * Requires installed desktop dependencies and pg_dump/pg_restore on PATH (or
 * PG_DUMP/PG_RESTORE). Never reads DATABASE_URL or an existing application DB.
 */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
const { Client } = require("pg");
const { createPostgresManager } = require("../../desktop/src/postgres-lifecycle");

const backendDir = path.resolve(__dirname, "..");
const desktopDir = path.resolve(backendDir, "../desktop");
const id = crypto.randomBytes(8).toString("hex");
const sourceDatabase = `winstore_backup_smoke_${id}_source`;
const restoredDatabase = `winstore_backup_smoke_${id}_restored`;
const dumpRole = `winstore_backup_smoke_${id}_dump`;
const password = crypto.randomBytes(24).toString("hex");
const dumpPassword = crypto.randomBytes(24).toString("hex");
const clients = new Set();
let postgres;
let pgPort;
let tempDir;
let postgresLog = "";

const safeIdentifier = (value) => {
    assert.match(value, new RegExp(`^winstore_backup_smoke_${id}_(source|restored|dump)$`));
    return `"${value}"`;
};
const redact = (text) => String(text).replaceAll(password, "[redacted]").replaceAll(dumpPassword, "[redacted]");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
        const port = server.address().port;
        server.close((error) => error ? reject(error) : resolve(port));
    });
});
const portIsOpen = (port) => new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.setTimeout(1000);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => { socket.destroy(); resolve(false); });
    socket.once("timeout", () => { socket.destroy(); resolve(true); });
});
const command = (binary, args, env = {}) => new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
        cwd: backendDir, env: { ...process.env, ...env }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let failed = false;
    let timeoutError;
    const capture = (chunk) => { output = (output + chunk.toString()).slice(-20000); };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    const timer = setTimeout(() => {
        timeoutError = new Error(`${path.basename(binary)} timed out.`);
        child.kill();
    }, 90000);
    child.once("error", (error) => { clearTimeout(timer); failed = true; reject(error); });
    child.once("close", (code) => {
        clearTimeout(timer);
        if (failed) return;
        if (timeoutError) reject(timeoutError);
        else if (code === 0) resolve(output);
        else reject(new Error(`${path.basename(binary)} exited ${code}:\n${redact(output)}`));
    });
});
const pgTool = async (envName, name) => {
    if (process.env[envName]) return process.env[envName];
    if (process.platform === "win32") {
        const candidate = path.join(process.env.ProgramFiles || "C:\\Program Files", "PostgreSQL", "18", "bin", `${name}.exe`);
        try { await fs.access(candidate); return candidate; } catch { /* use PATH */ }
    }
    return name;
};
const connect = async (database, user = "winstore", secret = password) => {
    assert.ok(database === "postgres" || database === sourceDatabase || database === restoredDatabase);
    const client = new Client({ host: "127.0.0.1", port: pgPort, user, password: secret, database });
    await client.connect();
    clients.add(client);
    return client;
};
const close = async (client) => { await client.end(); clients.delete(client); };
const tables = ["organizations", "branches", "budgets", "cash_registers", "cash_register_transactions"];
const financialRows = async (client) => {
    const snapshot = {};
    for (const table of tables) {
        const { rows } = await client.query(`SELECT row_to_json(t) AS record FROM (SELECT * FROM ${table} ORDER BY id) t`);
        snapshot[table] = rows.map((row) => row.record);
    }
    return snapshot;
};

const seed = async (client) => {
    const at = "2026-10-03T12:00:00.000Z";
    await client.query("BEGIN");
    try {
        for (let index = 0; index < 2; index += 1) {
            const org = crypto.randomUUID();
            const branch = crypto.randomUUID();
            const till = crypto.randomUUID();
            await client.query("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)",
                [org, `Backup shop ${index + 1} ₦`, `backup-${org}`, at]);
            await client.query("INSERT INTO branches (id, organization_id, name, code, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)",
                [branch, org, "Main branch", `MAIN${index}`, at]);
            await client.query("INSERT INTO budgets (id, organization_id, name, amount, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)",
                [crypto.randomUUID(), org, "Operating budget", index === 0 ? "1250.50" : "800.25", at]);
            await client.query("INSERT INTO cash_registers (id, organization_id, branch_id, name, opening_balance, current_balance, opened_at, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $7)",
                [till, org, branch, "Front till", index === 0 ? "100.00" : "0.00", index === 0 ? "85.00" : "50.00", at]);
            const movements = index === 0 ? [["inflow", "25.00", "125.00"], ["outflow", "40.00", "85.00"]] : [["inflow", "50.00", "50.00"]];
            for (const [type, amount, balance] of movements) {
                await client.query("INSERT INTO cash_register_transactions (id, organization_id, cash_register_id, transaction_type, amount, balance_after, reference, notes, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
                    [crypto.randomUUID(), org, till, type, amount, balance, "RESTORE-SMOKE", "Preserve money and tenant ownership ₦", at]);
            }
        }
        await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
};

async function main() {
    const pgDump = await pgTool("PG_DUMP", "pg_dump");
    const pgRestore = await pgTool("PG_RESTORE", "pg_restore");
    await command(pgDump, ["--version"]);
    await command(pgRestore, ["--version"]);
    tempDir = await fs.mkdtemp(path.join(backendDir, ".smoke-backup-"));
    pgPort = await freePort();
    postgres = createPostgresManager({
        config: { pgDataDir: path.join(tempDir, "pgdata"), PG_PORT: pgPort, DB_NAME: sourceDatabase, DB_USER: "winstore", DB_PASSWORD: password },
        Client,
        loadEmbeddedPostgres: async () => {
            const entry = require.resolve("embedded-postgres", { paths: [desktopDir] });
            const { default: EmbeddedPostgres } = await import(pathToFileURL(entry).href);
            return { default: class extends EmbeddedPostgres {
                constructor(options) {
                    const capture = (message) => { postgresLog = (postgresLog + String(message)).slice(-10000); };
                    super({ ...options, onLog: capture, onError: capture });
                }
            } };
        },
    });
    await postgres.start();
    console.log("Started isolated PostgreSQL cluster; creating scratch backup fixtures.");
    const admin = await connect("postgres");
    await admin.query(`CREATE DATABASE ${safeIdentifier(restoredDatabase)} WITH ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`);
    const sourceUrl = `postgresql://winstore:${password}@127.0.0.1:${pgPort}/${sourceDatabase}`;
    const baseEnv = { DATABASE_URL: sourceUrl, BACKUP_DATABASE_URL: sourceUrl, NODE_ENV: "test", SYNC_ENABLED: "false", PGOPTIONS: "" };
    await command(process.execPath, [path.join(backendDir, "node_modules/node-pg-migrate/bin/node-pg-migrate.js"), "up", "-m", "database/migrations", "--no-check-order"], baseEnv);
    const source = await connect(sourceDatabase);
    await seed(source);
    const before = await financialRows(source);
    assert.equal(before.organizations.length, 2);
    assert.equal(before.budgets.length, 2);
    assert.equal(before.cash_register_transactions.length, 3);

    // An ordinary role proves the backup session's app.bypass_rls=on works.
    await admin.query(`CREATE ROLE ${safeIdentifier(dumpRole)} LOGIN PASSWORD '${dumpPassword}' NOSUPERUSER NOBYPASSRLS`);
    await source.query(`GRANT USAGE ON SCHEMA public TO ${safeIdentifier(dumpRole)}`);
    await source.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${safeIdentifier(dumpRole)}`);
    await source.query(`GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO ${safeIdentifier(dumpRole)}`);
    const ordinary = await connect(sourceDatabase, dumpRole, dumpPassword);
    assert.equal((await ordinary.query("SELECT COUNT(*)::int AS count FROM organizations")).rows[0].count, 0, "ordinary role is tenant restricted before bypass");
    await close(ordinary);
    const dumpUrl = `postgresql://${dumpRole}:${dumpPassword}@127.0.0.1:${pgPort}/${sourceDatabase}`;
    const backupDir = path.join(tempDir, "backups");
    await command(process.execPath, [path.join(__dirname, "backup-db.js")], {
        ...baseEnv, DATABASE_URL: dumpUrl, BACKUP_DATABASE_URL: dumpUrl, BACKUP_DIR: backupDir, BACKUP_RETAIN: "1", PG_DUMP: pgDump,
    });
    const dumps = (await fs.readdir(backupDir)).filter((name) => /^winstore-.*\.dump$/.test(name));
    assert.equal(dumps.length, 1);
    assert.ok((await fs.stat(path.join(backupDir, dumps[0]))).size > 0);
    console.log("Actual backup-db.js captured both tenants through the RLS-constrained role.");
    await command(pgRestore, ["--clean", "--if-exists", "--no-owner", "--no-privileges", "--exit-on-error", "-h", "127.0.0.1", "-p", String(pgPort), "-U", "winstore", "-d", restoredDatabase, path.join(backupDir, dumps[0])], { PGPASSWORD: password, PGOPTIONS: "" });
    const restored = await connect(restoredDatabase);
    assert.deepEqual(await financialRows(restored), before, "restored tenant, budget, register, movement and timestamp records are identical");
    const { rows: balances } = await restored.query(`
        SELECT r.id, r.current_balance = r.opening_balance + COALESCE(SUM(
            CASE WHEN t.transaction_type = 'inflow' THEN t.amount ELSE -t.amount END
        ), 0) AS reconciled
        FROM cash_registers r LEFT JOIN cash_register_transactions t ON t.cash_register_id = r.id
        GROUP BY r.id
    `);
    assert.equal(balances.length, 2);
    assert.ok(balances.every((row) => row.reconciled));
    for (const client of [...clients]) if (client !== admin) await close(client);
    await admin.query(`DROP DATABASE ${safeIdentifier(sourceDatabase)}`);
    await admin.query(`DROP DATABASE ${safeIdentifier(restoredDatabase)}`);
    await admin.query(`DROP ROLE ${safeIdentifier(dumpRole)}`);
    await close(admin);
    console.log("Backup/restore roundtrip passed: 2 organizations, 2 budgets, 2 registers, 3 movements; balances reconcile.");
}

async function cleanup() {
    for (const client of [...clients]) await close(client).catch(() => {});
    if (postgres) await postgres.stop();
    if (pgPort) {
        const deadline = Date.now() + 10000;
        while (await portIsOpen(pgPort)) {
            if (Date.now() >= deadline) throw new Error(`Scratch PostgreSQL is still running; preserved ${tempDir}.`);
            await delay(100);
        }
    }
    if (tempDir) {
        const resolved = path.resolve(tempDir);
        assert.equal(path.dirname(resolved), backendDir);
        assert.match(path.basename(resolved), /^\.smoke-backup-[A-Za-z0-9_-]+$/);
        await fs.rm(resolved, { recursive: true, force: true });
        console.log("Stopped the isolated cluster and removed its validated scratch directory.");
    }
}

(async () => {
    try { await main(); }
    catch (error) {
        process.exitCode = 1;
        console.error(redact(`Backup/restore smoke failed: ${error.message}`));
        if (postgresLog) console.error(redact(postgresLog));
    } finally {
        try { await cleanup(); }
        catch (error) { process.exitCode = 1; console.error(redact(`Cleanup failed: ${error.message}`)); }
    }
    // embedded-postgres's beforeExit hook uses zero; preserve smoke failures.
    process.exit(process.exitCode || 0);
})();
