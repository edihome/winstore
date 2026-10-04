const test = require("node:test");
const assert = require("node:assert/strict");
const { createLazyStoreNetwork } = require("../src/lazy-store-network");

const makeNetwork = (calls) => ({
    getStatus: () => ({ running: false, addresses: [] }),
    start: async (options) => { calls.push(["start", options]); return { running: true }; },
    stop: async () => { calls.push(["stop"]); },
    getConnectionCode: () => "ws1:verified-store-code",
});

test("status checks and shutdown do not create a certificate when sharing was never enabled", async () => {
    let created = 0;
    const lazy = createLazyStoreNetwork(async () => { created += 1; throw new Error("must not create a certificate"); });
    assert.equal(lazy.getStatus().running, false);
    assert.ok(Array.isArray(lazy.getStatus().addresses));
    assert.throws(() => lazy.getConnectionCode(), /Enable store sharing/);
    await lazy.stop();
    assert.equal(created, 0);
});

test("concurrent sharing requests reuse the same pending factory", async () => {
    let release;
    let created = 0;
    const calls = [];
    const underlying = makeNetwork(calls);
    const lazy = createLazyStoreNetwork(() => { created += 1; return new Promise((resolve) => { release = resolve; }); });
    const first = lazy.start({ address: "192.168.1.20" });
    const second = lazy.start({ address: "192.168.1.20" });
    assert.equal(created, 1);
    release(underlying);
    await Promise.all([first, second]);
    assert.equal(created, 1);
    assert.equal(calls.filter(([name]) => name === "start").length, 2);
    assert.equal(lazy.getConnectionCode(), "ws1:verified-store-code");
});

test("a failed identity creation can be retried explicitly", async () => {
    let created = 0;
    const calls = [];
    const lazy = createLazyStoreNetwork(async () => {
        created += 1;
        if (created === 1) throw new Error("identity not available");
        return makeNetwork(calls);
    });
    await assert.rejects(lazy.start(), /identity not available/);
    await lazy.start();
    assert.equal(created, 2);
    await lazy.stop();
    assert.deepEqual(calls, [["start", undefined], ["stop"]]);
});

test("shutdown waits for pending creation and startup before stopping the listener", async () => {
    let release;
    const calls = [];
    const lazy = createLazyStoreNetwork(() => new Promise((resolve) => { release = resolve; }));
    const started = lazy.start({ address: "192.168.1.20" });
    const stopped = lazy.stop();
    await assert.rejects(lazy.start({ address: "192.168.1.21" }), /shutting down/);
    release(makeNetwork(calls));
    await Promise.all([started, stopped]);
    assert.deepEqual(calls.map(([name]) => name), ["start", "stop"], "the listener must finish starting before shutdown stops it");
});
