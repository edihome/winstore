const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("the migration CLI runs with only its locked production dependencies", async (t) => {
    const backendDir = path.resolve(__dirname, "../../backend");
    const manifest = JSON.parse(await fs.readFile(path.join(backendDir, "package.json"), "utf8"));
    const lock = JSON.parse(await fs.readFile(path.join(backendDir, "package-lock.json"), "utf8"));
    assert.ok(manifest.dependencies["node-pg-migrate"], "desktop migrations must survive --omit=dev");
    assert.equal(lock.packages[""].dependencies["node-pg-migrate"], manifest.dependencies["node-pg-migrate"]);

    const resolvePackage = (from, name) => {
        let base = from;
        while (true) {
            const key = `${base ? `${base}/` : ""}node_modules/${name}`;
            if (lock.packages[key]) return key;
            if (!base) throw new Error(`No locked dependency ${name} from ${from}`);
            const parent = path.posix.dirname(base);
            base = parent === "." ? "" : parent;
        }
    };
    const productionPackages = new Set();
    const visit = (key) => {
        if (productionPackages.has(key)) return;
        const entry = lock.packages[key];
        assert.notEqual(entry.dev, true, `${key} would be removed by production pruning`);
        productionPackages.add(key);
        for (const name of Object.keys(entry.dependencies || {})) visit(resolvePackage(key, name));
    };
    // pg is the migrator's runtime peer; dotenv loads its CLI environment.
    for (const name of ["node-pg-migrate", "pg", "dotenv"]) visit(resolvePackage("", name));

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "winstore-desktop-test-"));
    t.after(async () => {
        assert.equal(path.dirname(tempDir), path.resolve(os.tmpdir()));
        assert.ok(path.basename(tempDir).startsWith("winstore-desktop-test-"));
        await fs.rm(tempDir, { recursive: true, force: true });
    });
    // Copy the existing installation into an isolated tree; no npm install,
    // pruning of the developer's modules, database connection, or GUI needed.
    for (const key of productionPackages) {
        const source = path.join(backendDir, key);
        await fs.cp(source, path.join(tempDir, key), {
            recursive: true,
            filter: (entry) => !path.relative(source, entry).split(path.sep).includes("node_modules"),
        });
    }
    const cli = path.join(tempDir, "node_modules/node-pg-migrate/bin/node-pg-migrate.js");
    const result = spawnSync(process.execPath, [cli, "--help"], { cwd: tempDir, encoding: "utf8", timeout: 15000, windowsHide: true });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /\[up\|down\|create\|redo\]/);
});
