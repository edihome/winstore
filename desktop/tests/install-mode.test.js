const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { CONFIG_FILE, resolveInstallMode } = require("../src/install-mode");
const { setup } = require("../src/setup");

const fixture = async (t) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "winstore-desktop-test-"));
    t.after(async () => {
        assert.equal(path.dirname(tempDir), path.resolve(os.tmpdir()));
        assert.ok(path.basename(tempDir).startsWith("winstore-desktop-test-"));
        await fs.rm(tempDir, { recursive: true, force: true });
    });
    const userData = path.join(tempDir, "user-data");
    const pgDataDir = path.join(userData, "pgdata");
    const configFile = path.join(userData, CONFIG_FILE);
    return { userData, pgDataDir, configFile };
};
const noChoice = () => { assert.fail("existing installations must not be offered a new mode"); };
const exists = async (file) => fs.access(file).then(() => true, (error) => {
    if (error.code === "ENOENT") return false;
    throw error;
});

for (const [response, mode] of [[0, "standalone"], [1, "branch"]]) {
    test(`first-run setup persists an explicit ${mode} choice before database startup`, async (t) => {
        const files = await fixture(t);
        let dialogs = 0;
        assert.equal(await setup({ ...files, dialog: { showMessageBox: async (options) => {
            dialogs++;
            assert.deepEqual(options.buttons, ["Standalone business", "Head-office branch", "Cancel"]);
            assert.equal(options.cancelId, 2);
            return { response };
        } } }), mode);
        assert.equal(dialogs, 1);
        assert.deepEqual(JSON.parse(await fs.readFile(files.configFile, "utf8")), { version: 1, mode });
        assert.equal(await exists(files.pgDataDir), false, "selection does not create or migrate business data");
        assert.equal(await resolveInstallMode({ ...files, chooseMode: noChoice }), mode);
    });
}

test("cancelling setup leaves the installation unconfigured", async (t) => {
    const files = await fixture(t);
    assert.equal(await setup({ ...files, dialog: { showMessageBox: async () => ({ response: 2 }) } }), null);
    assert.equal(await exists(files.configFile), false);
    assert.equal(await exists(files.pgDataDir), false);
    assert.equal(await resolveInstallMode({ ...files, chooseMode: async () => "branch" }), "branch");
});

test("an existing cluster retains standalone mode and its files during an upgrade", async (t) => {
    const files = await fixture(t);
    await fs.mkdir(files.pgDataDir, { recursive: true });
    await fs.writeFile(path.join(files.pgDataDir, "PG_VERSION"), "17\n");
    await fs.writeFile(path.join(files.pgDataDir, "business-data"), "retain existing orders");
    assert.equal(await resolveInstallMode({ ...files, chooseMode: noChoice }), "standalone");
    assert.equal(await fs.readFile(path.join(files.pgDataDir, "business-data"), "utf8"), "retain existing orders");
    assert.equal(await fs.readFile(path.join(files.pgDataDir, "PG_VERSION"), "utf8"), "17\n");
});

test("a partial legacy cluster also defaults to standalone without touching its data", async (t) => {
    const files = await fixture(t);
    await fs.mkdir(files.pgDataDir, { recursive: true });
    await fs.writeFile(path.join(files.pgDataDir, "partial-data"), "retain partial initialization");
    assert.equal(await resolveInstallMode({ ...files, chooseMode: noChoice }), "standalone");
    assert.equal(await fs.readFile(path.join(files.pgDataDir, "partial-data"), "utf8"), "retain partial initialization");
});

test("a legacy JWT secret preserves standalone behavior even if pgdata is missing", async (t) => {
    const files = await fixture(t);
    await fs.mkdir(files.userData);
    const secretFile = path.join(files.userData, "jwt-secret");
    await fs.writeFile(secretFile, "legacy-secret-retained");
    assert.equal(await resolveInstallMode({ ...files, chooseMode: noChoice }), "standalone");
    assert.equal(await fs.readFile(secretFile, "utf8"), "legacy-secret-retained");
});

test("an empty pgdata directory can still choose branch mode", async (t) => {
    const files = await fixture(t);
    await fs.mkdir(files.pgDataDir, { recursive: true });
    assert.equal(await resolveInstallMode({ ...files, chooseMode: async () => "branch" }), "branch");
    assert.deepEqual(await fs.readdir(files.pgDataDir), []);
});

test("a configured branch keeps its mode and data on restart", async (t) => {
    const files = await fixture(t);
    await resolveInstallMode({ ...files, chooseMode: async () => "branch" });
    const settings = await fs.readFile(files.configFile, "utf8");
    await fs.mkdir(files.pgDataDir);
    await fs.writeFile(path.join(files.pgDataDir, "business-data"), "branch orders");
    assert.equal(await setup({ ...files, dialog: { showMessageBox: noChoice } }), "branch");
    assert.equal(await fs.readFile(files.configFile, "utf8"), settings);
    assert.equal(await fs.readFile(path.join(files.pgDataDir, "business-data"), "utf8"), "branch orders");
});

for (const contents of ["{", "null", '{"version":2,"mode":"branch"}', '{"version":1,"mode":"hub"}']) {
    test(`invalid persisted settings (${contents}) stop startup without replacing the file`, async (t) => {
        const files = await fixture(t);
        await fs.mkdir(files.userData);
        await fs.writeFile(files.configFile, contents);
        await assert.rejects(resolveInstallMode({ ...files, chooseMode: noChoice }), /desktop settings file/);
        assert.equal(await fs.readFile(files.configFile, "utf8"), contents);
    });
}

test("a settings read error is not treated as a new installation", async (t) => {
    const files = await fixture(t);
    await fs.mkdir(files.configFile, { recursive: true });
    await assert.rejects(resolveInstallMode({ ...files, chooseMode: noChoice }));
    assert.ok((await fs.stat(files.configFile)).isDirectory());
});

test("an unreadable cluster path stops mode selection and remains unchanged", async (t) => {
    const files = await fixture(t);
    await fs.mkdir(files.userData);
    await fs.writeFile(files.pgDataDir, "existing non-directory data");
    await assert.rejects(resolveInstallMode({ ...files, chooseMode: noChoice }));
    assert.equal(await fs.readFile(files.pgDataDir, "utf8"), "existing non-directory data");
    assert.equal(await exists(files.configFile), false);
});

test("business files appearing during the dialog prevent conversion to branch", async (t) => {
    const files = await fixture(t);
    await assert.rejects(resolveInstallMode({ ...files, chooseMode: async () => {
        await fs.mkdir(files.pgDataDir, { recursive: true });
        await fs.writeFile(path.join(files.pgDataDir, "business-data"), "concurrent orders");
        return "branch";
    } }), /existing Winstore installation/);
    assert.equal(await exists(files.configFile), false);
    assert.equal(await fs.readFile(path.join(files.pgDataDir, "business-data"), "utf8"), "concurrent orders");
});

test("a conflicting saved choice is never overwritten", async (t) => {
    const files = await fixture(t);
    const saved = '{"version":1,"mode":"standalone"}';
    await assert.rejects(resolveInstallMode({ ...files, chooseMode: async () => {
        await fs.mkdir(files.userData);
        await fs.writeFile(files.configFile, saved);
        return "branch";
    } }), /already configured differently/);
    assert.equal(await fs.readFile(files.configFile, "utf8"), saved);
});

test("an invalid selection cannot create persisted settings", async (t) => {
    const files = await fixture(t);
    await assert.rejects(resolveInstallMode({ ...files, chooseMode: async () => "hub" }), /valid desktop mode/);
    assert.equal(await exists(files.configFile), false);
});
