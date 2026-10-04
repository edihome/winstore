/** Inspect unpacked resources without launching Electron or opening app data. */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const asar = require("@electron/asar");

const desktopDir = path.resolve(__dirname, "..");
const packageDir = path.resolve(process.argv[2] || path.join(desktopDir, "dist/win-unpacked"));
const resources = path.join(packageDir, "resources");

const filesUnder = async (directory) => {
    const result = [];
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) result.push(...await filesUnder(file));
        else if (entry.isFile()) result.push(file);
    }
    return result;
};

const absent = async (file) => {
    await assert.rejects(fs.access(file), (error) => error.code === "ENOENT", `${file} must not be packaged`);
};

(async () => {
    const manifest = JSON.parse(asar.extractFile(path.join(resources, "app.asar"), "package.json").toString("utf8"));
    console.log(`Packaged manifest: name=${manifest.name}; productName=${manifest.productName || "(absent)"}.`);
    await absent(path.join(packageDir, "debug.log"));
    const appFiles = ["main.js", "preload.js", "loading.html", "setup.html", "reconnect.html", "icon.png", ...await filesUnder(path.join(desktopDir, "src"))
        .then((files) => files.map((file) => path.relative(desktopDir, file)))];
    for (const file of appFiles) {
        assert.ok(asar.extractFile(path.join(resources, "app.asar"), file).equals(await fs.readFile(path.join(desktopDir, file))), `stale desktop resource: ${file}`);
    }
    assert.equal(manifest.dependencies.selfsigned, "5.5.0", "LAN certificate runtime dependency must be packaged");
    assert.ok(asar.extractFile(path.join(resources, "app.asar"), path.join("node_modules", "selfsigned", "index.js")).length > 0);

    const sourceBackend = path.resolve(desktopDir, "../backend");
    const packagedBackend = path.join(resources, "backend");
    const backendFiles = [...await filesUnder(path.join(sourceBackend, "src")), ...await filesUnder(path.join(sourceBackend, "database/migrations"))];
    for (const file of backendFiles) {
        const relative = path.relative(sourceBackend, file);
        assert.ok((await fs.readFile(path.join(packagedBackend, relative))).equals(await fs.readFile(file)), `stale backend resource: ${relative}`);
    }
    const backendManifest = JSON.parse(await fs.readFile(path.join(packagedBackend, "package.json"), "utf8"));
    assert.ok(backendManifest.dependencies["node-pg-migrate"], "migration CLI must remain a production dependency");
    await fs.access(path.join(packagedBackend, "node_modules/node-pg-migrate/bin/node-pg-migrate.js"));
    for (const name of ["backups", "logs", "tests", "coverage", ".nyc_output", ".git"]) await absent(path.join(packagedBackend, name));
    for (const name of await fs.readdir(packagedBackend)) assert.equal(name.startsWith(".env"), false, `environment file packaged: ${name}`);
    for (const name of await fs.readdir(path.join(packagedBackend, "scripts"))) assert.equal(/^smoke-.*\.js$/.test(name), false, `development smoke script packaged: ${name}`);

    const sourceFrontend = path.resolve(desktopDir, "../frontend/dist");
    const frontendFiles = await filesUnder(sourceFrontend);
    for (const file of frontendFiles) {
        const relative = path.relative(sourceFrontend, file);
        assert.ok((await fs.readFile(path.join(resources, "frontend/dist", relative))).equals(await fs.readFile(file)), `stale frontend resource: ${relative}`);
    }
    assert.ok((await fs.stat(path.join(packageDir, "Winstore.exe"))).size > 0);
    for (const binary of ["postgres.exe", "initdb.exe", "pg_ctl.exe"]) {
        const relative = path.join("node_modules/@embedded-postgres/windows-x64/native/bin", binary);
        assert.ok((await fs.readFile(path.join(resources, "app.asar.unpacked", relative))).equals(await fs.readFile(path.join(desktopDir, relative))), `missing or stale bundled PostgreSQL binary: ${binary}`);
    }
    console.log(`Package verified: ${appFiles.length} desktop files, ${backendFiles.length} backend/migration files, ${frontendFiles.length} current frontend files, 3 unpacked PostgreSQL binaries; production migration CLI present; output debug.log and backend private/development artifacts excluded.`);
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
