const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { stopChild } = require("../src/stop-child");

class FakeChild extends EventEmitter {
    constructor(onKill = () => {}) {
        super();
        this.exitCode = null;
        this.signalCode = null;
        this.signals = [];
        this.onKill = onKill;
    }
    kill(signal) { this.signals.push(signal); this.onKill(signal, this); return true; }
}

test("already stopped or absent children require no signal", async () => {
    await stopChild(null);
    const child = new FakeChild();
    child.exitCode = 0;
    await stopChild(child);
    assert.deepEqual(child.signals, []);
});

test("shutdown remains pending until the child really exits", async () => {
    const child = new FakeChild();
    let resolved = false;
    const stopped = stopChild(child).then(() => { resolved = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(resolved, false);
    assert.deepEqual(child.signals, ["SIGTERM"]);
    child.emit("exit", 0);
    await stopped;
    assert.equal(resolved, true);
    assert.equal(child.listenerCount("exit"), 0);
    assert.equal(child.listenerCount("error"), 0);
});

test("a stalled graceful shutdown escalates and still awaits the exit", async () => {
    const child = new FakeChild((signal, instance) => {
        if (signal === "SIGKILL") setImmediate(() => instance.emit("exit", null, signal));
    });
    await stopChild(child, { gracefulMs: 1, forceMs: 1000 });
    assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
    assert.equal(child.listenerCount("exit"), 0);
});

test("failure to stop within both bounds rejects instead of claiming shutdown", async () => {
    const child = new FakeChild();
    await assert.rejects(stopChild(child, { gracefulMs: 1, forceMs: 1 }), /did not stop/);
    assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
    assert.equal(child.listenerCount("exit"), 0);
    assert.equal(child.listenerCount("error"), 0);
});

test("a signal failure is surfaced and listeners are removed", async () => {
    const child = new FakeChild(() => { throw new Error("signal rejected"); });
    await assert.rejects(stopChild(child), /signal rejected/);
    assert.equal(child.listenerCount("exit"), 0);
    assert.equal(child.listenerCount("error"), 0);
});
