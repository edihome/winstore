const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { createSharingController, readOwner } = require("../src/sharing-controller");

const ownerProfile = (overrides = {}) => ({
    id: "owner-1",
    role: "super_admin",
    organization: { id: "organization-1", name: "Test business" },
    branch: { name: "Main store" },
    ...overrides,
});

const localAuthServer = async (t) => {
    const requests = [];
    let reply = { status: 200, data: ownerProfile() };
    const server = http.createServer((request, response) => {
        requests.push({ method: request.method, url: request.url, authorization: request.headers.authorization });
        response.writeHead(reply.status, { "Content-Type": "application/json" });
        response.end(reply.body === undefined ? JSON.stringify({ data: reply.data }) : reply.body);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(async () => {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    });
    return {
        url: `http://127.0.0.1:${server.address().port}`,
        requests,
        setReply: (next) => { reply = next; },
    };
};

const controllerFixture = (backendUrl, configOverrides = {}) => {
    const events = [];
    const firewallAddresses = [];
    const saved = [];
    const controls = {};
    const live = { running: false, address: "", origin: "", addresses: [{ address: "192.168.1.20", name: "Ethernet" }] };
    let loginItem = false;
    const config = { version: 2, role: "host", mode: "standalone", sharingEnabled: false, autoStart: false, ...configOverrides };
    const network = {
        getStatus: () => ({ ...live }),
        start: async ({ address, storeName }) => {
            events.push("start");
            if (controls.startError) throw controls.startError;
            if (controls.beforeStart) await controls.beforeStart();
            live.running = true;
            live.address = address || "192.168.1.20";
            live.origin = `https://${live.address}:51124`;
            live.storeName = storeName;
        },
        stop: async () => {
            events.push("stop");
            if (controls.stopError) throw controls.stopError;
            live.running = false;
        },
        getConnectionCode: () => { events.push("code"); return "ws1:paired-host-identity"; },
    };
    const controller = createSharingController({
        config,
        backendUrl,
        network,
        saveConfig: async (next) => {
            events.push(next.sharingEnabled ? "save:on" : "save:off");
            if (controls.saveError) throw controls.saveError;
            saved.push(structuredClone(next));
        },
        configureFirewall: async (address) => {
            events.push("firewall");
            firewallAddresses.push(address);
            if (controls.firewallError) throw controls.firewallError;
            if (controls.beforeFirewall) await controls.beforeFirewall();
        },
        setLoginItem: async (enabled) => {
            events.push(`login:${enabled}`);
            if (controls.loginError) throw controls.loginError;
            if (controls.beforeLoginItem) await controls.beforeLoginItem();
            loginItem = enabled;
        },
    });
    return { controller, controls, events, firewallAddresses, live, saved, getLoginItem: () => loginItem };
};

test("owner verification uses the trusted loopback backend and accepts owner or developer accounts", async (t) => {
    const server = await localAuthServer(t);
    for (const role of ["super_admin", "developer"]) {
        server.setReply({ status: 200, data: ownerProfile({ role }) });
        assert.equal((await readOwner(server.url, "session-token")).role, role);
    }
    assert.deepEqual(server.requests, Array(2).fill({ method: "GET", url: "/api/v1/auth/me", authorization: "Bearer session-token" }));
});

test("owner verification refuses expired, restricted, inactive, or malformed sessions", async (t) => {
    const server = await localAuthServer(t);
    for (const reply of [
        { status: 401, data: ownerProfile() },
        { status: 403, data: ownerProfile() },
        { status: 200, data: ownerProfile({ role: "cashier" }) },
        { status: 200, data: ownerProfile({ mustChangePassword: true }) },
        { status: 200, data: ownerProfile({ subscriptionLocked: true }) },
        { status: 200, data: ownerProfile({ isActive: false }) },
        { status: 200, data: ownerProfile({ organization: null }) },
        { status: 200, data: null },
        { status: 200, body: "not JSON" },
        { status: 200, body: JSON.stringify({ data: { ...ownerProfile(), oversized: "x".repeat(140000) } }) },
    ]) {
        server.setReply(reply);
        await assert.rejects(readOwner(server.url, "expired-or-restricted"), /owner|verify/i);
    }
    const contacted = server.requests.length;
    for (const token of [null, "", "header\r\ninjection", "a".repeat(8193)]) {
        await assert.rejects(readOwner(server.url, token), /owner/i);
    }
    assert.equal(server.requests.length, contacted, "invalid bearer values never reach the HTTP backend");
});

test("every owner operation checks current authorization before changing network or Windows settings", async (t) => {
    const server = await localAuthServer(t);
    const fixture = controllerFixture(server.url);
    server.setReply({ status: 401, data: ownerProfile() });
    for (const action of [
        () => fixture.controller.enable("expired", "192.168.1.20"),
        () => fixture.controller.disable("expired"),
        () => fixture.controller.setAutoStart("expired", true),
        () => fixture.controller.getConnectionCode("expired"),
    ]) await assert.rejects(action(), /owner/i);
    assert.deepEqual(fixture.events, []);
    assert.equal(server.requests.length, 4);
    server.setReply({ status: 200, data: ownerProfile() });
    await fixture.controller.enable("valid", "192.168.1.20");
    server.setReply({ status: 401, data: ownerProfile() });
    await assert.rejects(fixture.controller.getConnectionCode("now-expired"), /owner/i);
    assert.equal(fixture.events.includes("code"), false, "an already enabled listener does not authorize revealing its code");
});

test("enable binds sharing to the owner's store and keeps connection codes out of public status", async (t) => {
    const server = await localAuthServer(t);
    const fixture = controllerFixture(server.url);
    assert.equal(fixture.controller.getStatus().enabled, false);
    const status = await fixture.controller.enable("valid", "192.168.1.20");
    assert.deepEqual(fixture.events, ["firewall", "start", "save:on"]);
    assert.deepEqual(fixture.firewallAddresses, ["192.168.1.20"], "the firewall is scoped to the chosen store interface");
    assert.equal(status.enabled, true);
    assert.equal(status.storeName, "Main store");
    assert.equal(status.address, "https://192.168.1.20:51124");
    assert.equal(fixture.controller.getConfig().organizationId, "organization-1");
    assert.equal(fixture.controller.getConfig().sharingAddress, "192.168.1.20");
    assert.equal(JSON.stringify(status).includes("ws1:"), false);
    assert.equal(await fixture.controller.getConnectionCode("valid"), "ws1:paired-host-identity");
    server.setReply({ status: 200, data: ownerProfile({ organization: { id: "another-store", name: "Another store" } }) });
    const eventCount = fixture.events.length;
    for (const action of [
        () => fixture.controller.enable("other-store"),
        () => fixture.controller.disable("other-store"),
        () => fixture.controller.setAutoStart("other-store", true),
        () => fixture.controller.getConnectionCode("other-store"),
    ]) await assert.rejects(action(), /different store/i);
    assert.equal(fixture.events.length, eventCount);
});

test("Windows permission denial and gateway failure cannot enable or persist sharing", async (t) => {
    const server = await localAuthServer(t);
    const permission = controllerFixture(server.url);
    permission.controls.firewallError = new Error("Administrator declined firewall change");
    await assert.rejects(permission.controller.enable("valid"), /declined/);
    assert.deepEqual(permission.events, ["firewall"]);
    assert.equal(permission.controller.getStatus().enabled, false);
    assert.equal(permission.saved.length, 0);
    const unavailable = controllerFixture(server.url);
    unavailable.controls.startError = new Error("Network address unavailable");
    await assert.rejects(unavailable.controller.enable("valid"), /address unavailable/);
    assert.deepEqual(unavailable.events, ["firewall", "start", "stop"]);
    assert.equal(unavailable.controller.getStatus().enabled, false);
    assert.equal(unavailable.controller.getConfig().sharingEnabled, false);
});

test("failed initial settings persistence stops the new listener and preserves the previous configuration", async (t) => {
    const server = await localAuthServer(t);
    const fixture = controllerFixture(server.url);
    const previous = structuredClone(fixture.controller.getConfig());
    fixture.controls.saveError = new Error("Settings directory is read-only");
    await assert.rejects(fixture.controller.enable("valid"), /read-only/);
    assert.deepEqual(fixture.events, ["firewall", "start", "save:on", "stop"]);
    assert.equal(fixture.live.running, false);
    assert.deepEqual(fixture.controller.getConfig(), previous);
    assert.match(fixture.controller.getStatus().error, /read-only/);
    fixture.controls.saveError = null;
    assert.equal((await fixture.controller.enable("valid")).enabled, true, "a rejected mutation does not poison later operations");
});

test("enable on a running host is idempotent and address changes require stopping sharing first", async (t) => {
    const server = await localAuthServer(t);
    const fixture = controllerFixture(server.url);
    await fixture.controller.enable("valid", "192.168.1.20");
    fixture.events.length = 0;
    fixture.controls.saveError = new Error("Subsequent persistence unavailable");
    assert.equal((await fixture.controller.enable("valid", "192.168.1.20")).enabled, true);
    assert.deepEqual(fixture.events, []);
    fixture.live.addresses.push({ address: "192.168.1.21", name: "Wi-Fi" });
    await assert.rejects(fixture.controller.enable("valid", "192.168.1.21"), /stop|disable/i);
    assert.deepEqual(fixture.events, []);
    assert.equal(fixture.live.running, true);
});

test("disable persists before stopping so a rejected settings write leaves the host available", async (t) => {
    const server = await localAuthServer(t);
    const fixture = controllerFixture(server.url);
    await fixture.controller.enable("valid");
    fixture.events.length = 0;
    fixture.controls.saveError = new Error("Cannot save desktop settings");
    await assert.rejects(fixture.controller.disable("valid"), /Cannot save/);
    assert.deepEqual(fixture.events, ["save:off"]);
    assert.equal(fixture.live.running, true);
    assert.equal(fixture.controller.getConfig().sharingEnabled, true);
    fixture.controls.saveError = null;
    fixture.events.length = 0;
    assert.equal((await fixture.controller.disable("valid")).enabled, false);
    assert.deepEqual(fixture.events, ["save:off", "stop"]);
    assert.equal(fixture.controller.getConfig().sharingEnabled, false);
    await assert.rejects(fixture.controller.getConnectionCode("valid"), /Enable store sharing/i);
});

test("a failed listener stop still leaves sharing disabled for the next startup", async (t) => {
    const server = await localAuthServer(t);
    const fixture = controllerFixture(server.url);
    await fixture.controller.enable("valid");
    fixture.controls.stopError = new Error("Listener did not stop");
    await assert.rejects(fixture.controller.disable("valid"), /did not stop/);
    assert.equal(fixture.controller.getConfig().sharingEnabled, false);
    assert.equal(fixture.saved.at(-1).sharingEnabled, false);
});

test("auto-start changes roll back the Windows login item when desktop settings cannot be saved", async (t) => {
    const server = await localAuthServer(t);
    const fixture = controllerFixture(server.url);
    fixture.controls.saveError = new Error("Unable to save startup choice");
    await assert.rejects(fixture.controller.setAutoStart("valid", true), /Unable to save/);
    assert.deepEqual(fixture.events, ["login:true", "save:off", "login:false"]);
    assert.equal(fixture.getLoginItem(), false);
    assert.equal(fixture.controller.getConfig().autoStart, false);
    fixture.controls.saveError = null;
    assert.equal((await fixture.controller.setAutoStart("valid", true)).autoStart, true);
    assert.equal(fixture.getLoginItem(), true);
    fixture.events.length = 0;
    await assert.rejects(fixture.controller.setAutoStart("valid", "true"), /Choose whether/i);
    assert.deepEqual(fixture.events, []);
});

test("queued owner mutations complete in order and leave durable settings matching the listener", async (t) => {
    const server = await localAuthServer(t);
    const fixture = controllerFixture(server.url);
    let releaseStart;
    let signalStart;
    const started = new Promise((resolve) => { signalStart = resolve; });
    const barrier = new Promise((resolve) => { releaseStart = resolve; });
    fixture.controls.beforeStart = async () => { signalStart(); await barrier; };
    const enabling = fixture.controller.enable("valid");
    await started;
    const disabling = fixture.controller.disable("valid");
    assert.deepEqual(fixture.events, ["firewall", "start"]);
    releaseStart();
    await Promise.all([enabling, disabling]);
    assert.deepEqual(fixture.events, ["firewall", "start", "save:on", "save:off", "stop"]);
    assert.equal(fixture.controller.getConfig().sharingEnabled, false);
    assert.equal(fixture.controller.getStatus().enabled, false);
});

test("resume starts saved hosting without a firewall prompt and reports unavailable addresses", async (t) => {
    const server = await localAuthServer(t);
    const fixture = controllerFixture(server.url, { sharingEnabled: true, sharingAddress: "192.168.1.20", storeName: "Saved store" });
    assert.equal((await fixture.controller.resume()).enabled, true);
    assert.deepEqual(fixture.events, ["start"]);
    assert.equal(server.requests.length, 0);
    const unavailable = controllerFixture(server.url, { sharingEnabled: true });
    unavailable.controls.startError = new Error("Saved address unavailable");
    const status = await unavailable.controller.resume();
    assert.equal(status.enabled, false);
    assert.match(status.error, /could not resume.*Saved address unavailable/i);
    assert.equal(unavailable.saved.length, 0);
});

test("connected clients cannot start hosting, reveal host codes, or alter host startup settings", async (t) => {
    const server = await localAuthServer(t);
    const fixture = controllerFixture(server.url, { role: "client", connection: { origin: "https://192.168.1.20:51124", storeName: "Shared store" } });
    assert.deepEqual(await fixture.controller.resume(), { role: "client", enabled: false, address: "https://192.168.1.20:51124", storeName: "Shared store", autoStart: false });
    for (const action of [
        () => fixture.controller.enable("valid"),
        () => fixture.controller.disable("valid"),
        () => fixture.controller.setAutoStart("valid", true),
        () => fixture.controller.getConnectionCode("valid"),
    ]) await assert.rejects(action(), /main store PC/i);
    assert.deepEqual(fixture.events, []);
    assert.equal(server.requests.length, 0);
});

test("shutdown during the Windows administrator prompt never starts or saves a new host listener", { timeout: 5000 }, async (t) => {
    const server = await localAuthServer(t);
    const fixture = controllerFixture(server.url);
    let releasePrompt;
    let signalPrompt;
    const promptOpened = new Promise((resolve) => { signalPrompt = resolve; });
    const prompt = new Promise((resolve) => { releasePrompt = resolve; });
    fixture.controls.beforeFirewall = async () => { signalPrompt(); await prompt; };
    const enabling = fixture.controller.enable("valid");
    // Attach the rejection assertion before releasing the pending owner action.
    const rejectedEnable = assert.rejects(enabling, /stopping|closing|shutdown/i);
    await promptOpened;
    let stopped = false;
    const stopping = fixture.controller.stop().then(() => { stopped = true; });
    t.after(async () => {
        releasePrompt();
        await Promise.allSettled([enabling, rejectedEnable, stopping]);
    });
    await Promise.resolve();
    assert.equal(stopped, false, "shutdown waits for the pending Windows consent result");
    assert.deepEqual(fixture.events, ["firewall"], "the network is not closed underneath a pending mutation");
    await assert.rejects(fixture.controller.enable("valid"), /stopping|closing|shutdown/i);
    releasePrompt();
    await Promise.all([stopping, rejectedEnable]);
    assert.equal(fixture.events.includes("start"), false);
    assert.equal(fixture.events.includes("save:on"), false);
    assert.equal(fixture.events.at(-1), "stop");
    assert.equal(fixture.live.running, false);
    assert.equal(fixture.controller.getConfig().sharingEnabled, false);
});

test("shutdown drains an accepted startup mutation before stopping the listener and backend", { timeout: 5000 }, async (t) => {
    const server = await localAuthServer(t);
    const fixture = controllerFixture(server.url, { sharingEnabled: true });
    fixture.live.running = true;
    let releaseLoginItem;
    let signalLoginItem;
    const loginStarted = new Promise((resolve) => { signalLoginItem = resolve; });
    const loginItemWrite = new Promise((resolve) => { releaseLoginItem = resolve; });
    fixture.controls.beforeLoginItem = async () => { signalLoginItem(); await loginItemWrite; };
    const updating = fixture.controller.setAutoStart("valid", true);
    await loginStarted;
    const stopping = fixture.controller.stop().then(() => fixture.events.push("backend-stop"));
    t.after(async () => {
        releaseLoginItem();
        await Promise.allSettled([updating, stopping]);
    });
    await Promise.resolve();
    assert.deepEqual(fixture.events, ["login:true"]);
    await assert.rejects(fixture.controller.setAutoStart("valid", false), /stopping|closing|shutdown/i);
    await assert.rejects(fixture.controller.disable("valid"), /stopping|closing|shutdown/i);
    await assert.rejects(fixture.controller.getConnectionCode("valid"), /stopping|closing|shutdown/i);
    releaseLoginItem();
    await Promise.all([updating, stopping]);
    assert.deepEqual(fixture.events, ["login:true", "save:on", "stop", "backend-stop"]);
    assert.equal(fixture.getLoginItem(), true);
    assert.equal(fixture.controller.getConfig().autoStart, true);
    assert.equal(fixture.live.running, false);
    await assert.rejects(fixture.controller.getConnectionCode("valid"), /stopping|closing|shutdown/i);
});
