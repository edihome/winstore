const test = require("node:test");
const assert = require("node:assert/strict");
const { buildBackendEnvironment } = require("../src/backend-environment");

const settings = {
    databaseUrl: "postgresql://test@127.0.0.1:54329/winstore",
    port: 51123,
    jwtSecret: "isolated-test-secret",
    frontendDist: "test-frontend-dist",
};

test("branch mode enables enrollment and preserves only the desktop's local runtime settings", () => {
    const inheritedEnv = {
        PATH: "test-path",
        NODE_ENV: "development",
        PORT: "3000",
        HOST: "0.0.0.0",
        DATABASE_URL: "different-database",
        JWT_SECRET: "different-secret",
        FRONTEND_DIST: "different-dist",
        ELECTRON_RUN_AS_NODE: "0",
        SYNC_ENABLED: "false",
        SYNC_NODE_KIND: "hub",
        SYNC_HUB_URL: "https://unrelated-head-office.example",
        SYNC_HUB_TOKEN: "unrelated-token",
        TRUST_PROXY: "true",
    };
    const original = { ...inheritedEnv };
    const env = buildBackendEnvironment({ ...settings, mode: "branch", inheritedEnv });
    assert.equal(env.SYNC_ENABLED, "true");
    assert.equal(env.SYNC_NODE_KIND, "branch");
    assert.equal(env.SYNC_HUB_URL, "", "the stored enrollment chooses the hub");
    assert.equal(env.SYNC_HUB_TOKEN, "", "the stored branch credentials authenticate sync");
    assert.equal(env.TRUST_PROXY, "");
    assert.equal(env.PORT, "51123");
    assert.equal(env.HOST, "127.0.0.1");
    assert.equal(env.DATABASE_URL, settings.databaseUrl);
    assert.equal(env.JWT_SECRET, settings.jwtSecret);
    assert.equal(env.FRONTEND_DIST, settings.frontendDist);
    assert.equal(env.NODE_ENV, "production");
    assert.equal(env.ELECTRON_RUN_AS_NODE, "1");
    assert.equal(env.PATH, inheritedEnv.PATH);
    assert.deepEqual(inheritedEnv, original);
});

test("standalone mode keeps sync disabled even when the host enables it", () => {
    const env = buildBackendEnvironment({ ...settings, mode: "standalone", inheritedEnv: {
        SYNC_ENABLED: "true", SYNC_NODE_KIND: "hub", SYNC_HUB_URL: "https://other.example", SYNC_HUB_TOKEN: "host-token",
    } });
    assert.equal(env.SYNC_ENABLED, "false");
    assert.equal(env.SYNC_NODE_KIND, "branch");
    assert.equal(env.SYNC_HUB_URL, "");
    assert.equal(env.SYNC_HUB_TOKEN, "");
});

test("an unknown or missing desktop mode cannot spawn a configured backend", () => {
    for (const mode of [undefined, "hub", ""]) {
        assert.throws(() => buildBackendEnvironment({ ...settings, mode, inheritedEnv: {} }), /valid desktop mode/);
    }
});
