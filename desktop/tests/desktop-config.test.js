const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { resolveDesktopConfig, readDesktopConfig, saveDesktopConfig, validateDesktopConfig, CONFIG_FILE } = require("../src/install-mode");
const { setup } = require("../src/setup");

const host = (mode = "standalone") => ({ version: 2, role: "host", mode, sharingEnabled: false, autoStart: false });
const connection = { origin: "https://192.168.1.20:51124", fingerprint: "a".repeat(64), hostId: "fcbf23f9-1e2c-44be-a00f-83507c1c22aa", storeName: "Market Street" };
const client = () => ({ version: 2, role: "client", connection: { ...connection } });
const fixture = async (t) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "winstore-config-test-"));
    t.after(async () => {
        assert.equal(path.dirname(tempDir), path.resolve(os.tmpdir()));
        assert.ok(path.basename(tempDir).startsWith("winstore-config-test-"));
        await fs.rm(tempDir, { recursive: true, force: true });
    });
    const userData = path.join(tempDir, "user-data");
    return { userData, pgDataDir: path.join(userData, "pgdata"), configFile: path.join(userData, CONFIG_FILE) };
};
const noChoice = () => assert.fail("existing settings must not prompt for another role");

for (const mode of ["standalone", "branch"]) {
    test(`legacy ${mode} upgrade retains the business files and keeps LAN sharing disabled`, async (t) => {
        const files = await fixture(t);
        await fs.mkdir(files.pgDataDir, { recursive: true });
        await fs.writeFile(path.join(files.pgDataDir, "orders"), "existing orders");
        await fs.writeFile(path.join(files.userData, "jwt-secret"), "existing secret");
        await fs.writeFile(files.configFile, JSON.stringify({ version: 1, mode }));
        assert.deepEqual(await readDesktopConfig(files.userData), host(mode));
        assert.equal(JSON.parse(await fs.readFile(files.configFile)).version, 1, "reading does not change settings");
        assert.deepEqual(await resolveDesktopConfig({ ...files, chooseConfig: noChoice }), host(mode));
        assert.deepEqual(JSON.parse(await fs.readFile(files.configFile)), host(mode));
        assert.equal(await fs.readFile(path.join(files.pgDataDir, "orders"), "utf8"), "existing orders");
        assert.equal(await fs.readFile(path.join(files.userData, "jwt-secret"), "utf8"), "existing secret");
        assert.deepEqual((await fs.readdir(files.userData)).sort(), [CONFIG_FILE, "jwt-secret", "pgdata"].sort());
    });
}

test("client setup saves only its verified connection and reuses it on restart", async (t) => {
    const files = await fixture(t);
    const expected = client();
    assert.deepEqual(await setup({ ...files, dialog: { showMessageBox: async () => ({ response: 1 }) }, chooseConnection: async () => ({ ...connection }) }), expected);
    assert.deepEqual(await setup({ ...files, dialog: { showMessageBox: noChoice }, chooseConnection: noChoice }), expected);
    assert.deepEqual(await fs.readdir(files.userData), [CONFIG_FILE], "client setup creates no database or JWT secret");
});

for (const choice of ["host", "client"]) {
    test(`cancelling ${choice} setup leaves no saved role or business files`, async (t) => {
        const files = await fixture(t);
        let dialogs = 0;
        assert.equal(await setup({ ...files,
            dialog: { showMessageBox: async () => ({ response: ++dialogs === 1 ? (choice === "host" ? 0 : 1) : 2 }) },
            chooseConnection: async () => null,
        }), null);
        await assert.rejects(fs.access(files.userData), { code: "ENOENT" });
    });
}

test("existing data cannot become a client when files appear during setup or a client config is directly saved", async (t) => {
    const files = await fixture(t);
    await assert.rejects(resolveDesktopConfig({ ...files, chooseConfig: async () => {
        await fs.mkdir(files.pgDataDir, { recursive: true });
        await fs.writeFile(path.join(files.pgDataDir, "orders"), "retain me");
        return client();
    } }), /existing Winstore installation/);
    await assert.rejects(saveDesktopConfig(files.userData, client()), /existing Winstore installation/);
    assert.equal(await fs.readFile(path.join(files.pgDataDir, "orders"), "utf8"), "retain me");
    await assert.rejects(fs.access(files.configFile), { code: "ENOENT" });
});

test("a client config alongside local business data stops startup without touching either", async (t) => {
    const files = await fixture(t);
    await saveDesktopConfig(files.userData, client());
    await fs.mkdir(files.pgDataDir);
    await fs.writeFile(path.join(files.pgDataDir, "orders"), "existing orders");
    const previous = await fs.readFile(files.configFile, "utf8");
    await assert.rejects(resolveDesktopConfig({ ...files, chooseConfig: noChoice }), /existing Winstore installation/);
    assert.equal(await fs.readFile(files.configFile, "utf8"), previous);
    assert.equal(await fs.readFile(path.join(files.pgDataDir, "orders"), "utf8"), "existing orders");
});

test("host settings preserve the owner-selected store and private network address through atomic updates", async (t) => {
    const files = await fixture(t);
    await saveDesktopConfig(files.userData, host());
    const shared = { ...host(), sharingEnabled: true, autoStart: true, storeName: "Market Street", organizationId: connection.hostId, sharingAddress: "192.168.1.20" };
    assert.deepEqual(await saveDesktopConfig(files.userData, shared), shared);
    assert.deepEqual(await readDesktopConfig(files.userData), shared);
    assert.deepEqual(await fs.readdir(files.userData), [CONFIG_FILE], "atomic saves leave no temporary files");
    const previous = await fs.readFile(files.configFile, "utf8");
    await assert.rejects(saveDesktopConfig(files.userData, { ...shared, sharingAddress: "8.8.8.8" }), /private IPv4/);
    assert.equal(await fs.readFile(files.configFile, "utf8"), previous);
});

for (const badConnection of [
    { ...connection, origin: "http://192.168.1.20:51124" },
    { ...connection, origin: "https://person:password@192.168.1.20:51124" },
    { ...connection, origin: "https://192.168.1.20:51124/api" },
    { ...connection, origin: "https://8.8.8.8:51124" },
    { ...connection, fingerprint: "bad" },
    { ...connection, hostId: "unknown" },
    { ...connection, storeName: "Fake\nstore" },
]) {
    test(`invalid client identity fails before settings are written (${JSON.stringify(badConnection)})`, async (t) => {
        const files = await fixture(t);
        await assert.rejects(resolveDesktopConfig({ ...files, chooseConfig: async () => ({ version: 2, role: "client", connection: badConnection }) }));
        await assert.rejects(fs.access(files.userData), { code: "ENOENT" });
    });
}

test("v2 settings reject missing roles, wrong flag types and unrelated role fields", () => {
    for (const settings of [{ version: 2, mode: "branch" }, { ...host(), autoStart: "yes" }, { ...client(), mode: "branch" }, { ...host(), connection }]) {
        assert.throws(() => validateDesktopConfig(settings));
    }
});

test("simultaneous setup cannot replace the winning device role", async (t) => {
    const files = await fixture(t);
    let choices = 0;
    let release;
    const ready = new Promise((resolve) => { release = resolve; });
    const choose = (settings) => async () => { if (++choices === 2) release(); await ready; return settings; };
    const results = await Promise.allSettled([
        resolveDesktopConfig({ ...files, chooseConfig: choose(host()) }),
        resolveDesktopConfig({ ...files, chooseConfig: choose(client()) }),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    const winner = results.find((result) => result.status === "fulfilled").value;
    assert.deepEqual(await readDesktopConfig(files.userData), winner);
    assert.deepEqual(await fs.readdir(files.userData), [CONFIG_FILE]);
});
