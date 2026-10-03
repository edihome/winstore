const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createPostgresManager } = require("../src/postgres-lifecycle");

const fixture = async (t, { encoding = null, initError = null } = {}) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "winstore-desktop-test-"));
    t.after(async () => {
        assert.equal(path.dirname(tempDir), path.resolve(os.tmpdir()));
        assert.ok(path.basename(tempDir).startsWith("winstore-desktop-test-"));
        await fs.rm(tempDir, { recursive: true, force: true });
    });
    const pgDataDir = path.join(tempDir, "pgdata");
    const calls = { initialise: 0, start: 0, stop: 0, queries: [], clientsEnded: 0, options: [] };
    let databaseEncoding = encoding;
    class EmbeddedPostgres {
        constructor(options) { calls.options.push(options); }
        async initialise() {
            calls.initialise++;
            await fs.mkdir(pgDataDir, { recursive: true });
            if (initError) {
                await fs.writeFile(path.join(pgDataDir, "partial-data"), "keep this");
                throw initError;
            }
            await fs.writeFile(path.join(pgDataDir, "PG_VERSION"), "17\n");
        }
        async start() { calls.start++; }
        async stop() { calls.stop++; }
    }
    class Client {
        async connect() {}
        async query(sql, parameters) {
            calls.queries.push({ sql, parameters });
            if (sql.startsWith("SELECT")) return { rows: databaseEncoding ? [{ enc: databaseEncoding }] : [] };
            if (sql.startsWith("CREATE DATABASE")) databaseEncoding = "UTF8";
            return { rows: [] };
        }
        async end() { calls.clientsEnded++; }
    }
    const manager = () => createPostgresManager({
        config: { pgDataDir, PG_PORT: 54329, DB_NAME: "winstore", DB_USER: "winstore", DB_PASSWORD: "test-password" },
        Client,
        loadEmbeddedPostgres: async () => ({ default: EmbeddedPostgres }),
    });
    return { pgDataDir, calls, manager };
};

test("first launch initializes a missing cluster and creates a UTF8 database", async (t) => {
    const { pgDataDir, calls, manager } = await fixture(t);
    const postgres = manager();
    await postgres.start();
    assert.equal(calls.initialise, 1);
    assert.equal(calls.start, 1);
    assert.equal(await fs.readFile(path.join(pgDataDir, "PG_VERSION"), "utf8"), "17\n");
    assert.match(calls.queries[1].sql, /CREATE DATABASE "winstore" WITH ENCODING 'UTF8'.*TEMPLATE template0/);
    assert.equal(calls.options[0].persistent, true);
    assert.deepEqual(calls.options[0].postgresFlags, ["-c", "listen_addresses=127.0.0.1"]);
    await postgres.stop();
    assert.equal(calls.stop, 1);
});

test("an existing empty directory can be initialized", async (t) => {
    const { pgDataDir, calls, manager } = await fixture(t);
    await fs.mkdir(pgDataDir);
    const postgres = manager();
    await postgres.start();
    assert.equal(calls.initialise, 1);
    await postgres.stop();
});

test("a new app instance reuses the cluster and preserves business data on restart", async (t) => {
    const { pgDataDir, calls, manager } = await fixture(t);
    const first = manager();
    await first.start();
    const businessData = path.join(pgDataDir, "business-data");
    await fs.writeFile(businessData, "customer orders must survive restart");
    await first.stop();
    calls.queries.length = 0;

    const restarted = manager();
    await restarted.start();
    assert.equal(calls.initialise, 1);
    assert.equal(calls.start, 2);
    assert.equal(await fs.readFile(businessData, "utf8"), "customer orders must survive restart");
    assert.equal(calls.queries.length, 1, "existing UTF8 database requires no schema changes");
    assert.equal(calls.clientsEnded, 2);
    await restarted.stop();
    await restarted.stop();
    assert.equal(calls.stop, 2);
});

test("failed initialization leaves files intact and prevents automatic reinitialization", async (t) => {
    const { pgDataDir, calls, manager } = await fixture(t, { initError: new Error("initdb failed") });
    const first = manager();
    await assert.rejects(first.start(), /initdb failed/);
    await first.stop();
    await assert.rejects(manager().start(), /not empty but has no PG_VERSION/);
    assert.equal(calls.initialise, 1);
    assert.equal(calls.start, 0);
    assert.equal(await fs.readFile(path.join(pgDataDir, "partial-data"), "utf8"), "keep this");
});

test("an unknown nonempty directory is left unchanged", async (t) => {
    const { pgDataDir, calls, manager } = await fixture(t);
    await fs.mkdir(pgDataDir);
    await fs.writeFile(path.join(pgDataDir, "unknown-file"), "valuable data");
    await assert.rejects(manager().start(), /Existing files were left unchanged/);
    assert.equal(calls.options.length, 0);
    assert.equal(await fs.readFile(path.join(pgDataDir, "unknown-file"), "utf8"), "valuable data");
});

for (const version of ["16", "", "invalid"]) {
    test(`an incompatible or invalid PG_VERSION (${JSON.stringify(version)}) is preserved`, async (t) => {
        const { pgDataDir, calls, manager } = await fixture(t);
        await fs.mkdir(pgDataDir);
        await fs.writeFile(path.join(pgDataDir, "PG_VERSION"), version);
        await assert.rejects(manager().start(), /Existing data was left unchanged/);
        assert.equal(calls.options.length, 0);
        assert.equal(await fs.readFile(path.join(pgDataDir, "PG_VERSION"), "utf8"), version);
    });
}

test("a version-marker read failure is never interpreted as first launch", async (t) => {
    const { pgDataDir, calls, manager } = await fixture(t);
    await fs.mkdir(path.join(pgDataDir, "PG_VERSION"), { recursive: true });
    await assert.rejects(manager().start(), (error) => Boolean(error.code && error.code !== "ENOENT"));
    assert.equal(calls.options.length, 0);
    assert.ok((await fs.stat(path.join(pgDataDir, "PG_VERSION"))).isDirectory());
});

test("a file at the cluster path is preserved instead of overwritten", async (t) => {
    const { pgDataDir, calls, manager } = await fixture(t);
    await fs.writeFile(pgDataDir, "keep existing file");
    await assert.rejects(manager().start());
    assert.equal(calls.options.length, 0);
    assert.equal(await fs.readFile(pgDataDir, "utf8"), "keep existing file");
});

test("a non-UTF8 database is never dropped or recreated", async (t) => {
    const { pgDataDir, calls, manager } = await fixture(t, { encoding: "WIN1252" });
    await fs.mkdir(pgDataDir);
    await fs.writeFile(path.join(pgDataDir, "PG_VERSION"), "17\n");
    const postgres = manager();
    await assert.rejects(postgres.start(), /uses WIN1252 instead of UTF8.*Existing data was left unchanged/);
    assert.equal(calls.initialise, 0);
    assert.equal(calls.queries.length, 1, "only the encoding lookup is allowed");
    assert.equal(calls.clientsEnded, 1);
    await postgres.stop();
    assert.equal(calls.stop, 1);
});
