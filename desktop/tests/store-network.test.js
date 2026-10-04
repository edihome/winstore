const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const crypto = require("node:crypto");
const {
    IDENTITY_PATH, createStoreNetwork, decodeConnectionCode, verifyConnection, requestPinned,
    validateConnection, discoverPrivateAddresses, isPrivateIPv4,
} = require("../src/store-network");

const temporaryStore = async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "winstore-network-test-"));
    t.after(async () => {
        assert.equal(path.dirname(directory), os.tmpdir());
        await fs.rm(directory, { recursive: true, force: true });
    });
    return directory;
};

const createFixture = async (t, { respond } = {}) => {
    const directory = await temporaryStore(t);
    const received = [];
    const backend = http.createServer((request, response) => {
        const chunks = [];
        request.on("data", (chunk) => chunks.push(chunk));
        request.on("end", () => {
            received.push({ method: request.method, url: request.url, headers: request.headers, body: Buffer.concat(chunks).toString() });
            if (respond) { respond(response, received.at(-1)); return; }
            response.writeHead(200, { "Content-Type": "application/json" });
            response.end(JSON.stringify({ success: true, version: "1.0.0", latest: received.at(-1) }));
        });
    });
    await new Promise((resolve) => backend.listen(0, "127.0.0.1", resolve));
    const backendUrl = `http://127.0.0.1:${backend.address().port}`;
    const network = await createStoreNetwork({ userData: directory, backendUrl, port: 0, allowLoopback: true });
    let backendClosed = false;
    const stopBackend = async () => {
        if (backendClosed) return;
        await new Promise((resolve, reject) => backend.close((error) => error ? reject(error) : resolve()));
        backendClosed = true;
    };
    t.after(async () => {
        await network.stop();
        await stopBackend();
    });
    await network.start({ address: "127.0.0.1", storeName: "Market Store" });
    const connection = decodeConnectionCode(network.getConnectionCode(), { allowLoopback: true });
    return { directory, network, connection, received, backendUrl, stopBackend };
};

test("address discovery uses private IPv4 interfaces and requires a deliberate choice with multiple networks", () => {
    const interfaces = {
        Wifi: [{ address: "192.168.1.20", family: "IPv4", internal: false }],
        VPN: [{ address: "10.0.0.4", family: 4, internal: false }],
        Loopback: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
        Public: [{ address: "8.8.8.8", family: "IPv4", internal: false }],
        IPv6: [{ address: "fd00::1", family: "IPv6", internal: false }],
    };
    assert.deepEqual(discoverPrivateAddresses(interfaces), ["10.0.0.4", "192.168.1.20"]);
    for (const address of ["10.1.2.3", "172.16.1.2", "172.31.1.2", "192.168.1.2"]) assert.equal(isPrivateIPv4(address), true);
    for (const address of ["0.0.0.0", "127.0.0.1", "172.32.1.2", "169.254.1.2", "example.com"]) assert.equal(isPrivateIPv4(address), false);
});

test("connection codes reject public addresses, credentials, paths and missing pins", () => {
    const base = { version: 1, origin: "https://192.168.1.10:51124", fingerprint: "a".repeat(64), hostId: crypto.randomUUID() };
    assert.equal(validateConnection(base).origin, base.origin);
    for (const origin of ["http://192.168.1.10:51124", "https://8.8.8.8", "https://127.0.0.1", "https://user:pass@192.168.1.10", "https://192.168.1.10/path", "https://192.168.1.10/?password=secret", "https://192.168.1.10/#fragment"]) {
        assert.throws(() => validateConnection({ ...base, origin }), /private IPv4/);
    }
    assert.throws(() => validateConnection({ ...base, fingerprint: undefined }), /invalid/);
    assert.throws(() => decodeConnectionCode("ws1:" + Buffer.from(JSON.stringify({ ...base, version: 2 })).toString("base64url")), /unsupported version/);
});

test("TLS-pinned clients verify the store and forward authenticated methods, query and request body", async (t) => {
    const { network, connection, received } = await createFixture(t);
    await requestPinned(connection, IDENTITY_PATH, { allowLoopback: true });
    assert.equal(received.length, 0, "store identity contains no backend data");
    const verified = await verifyConnection(network.getConnectionCode(), { allowLoopback: true });
    assert.equal(verified.storeName, "Market Store");
    assert.equal(verified.hostId, connection.hostId);
    assert.deepEqual(received.map((request) => request.url), ["/api/v1/health"]);
    assert.equal(received[0].headers.authorization, undefined, "availability checks do not send staff credentials");
    received.length = 0;
    const body = JSON.stringify({ quantity: 2 });
    const response = await requestPinned(verified, "/api/v1/sales?branchId=abc", {
        allowLoopback: true, method: "POST", headers: { Authorization: "Bearer staff-session", "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), "X-Forwarded-For": "attacker" }, body,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(received[0].method, "POST");
    assert.equal(received[0].url, "/api/v1/sales?branchId=abc");
    assert.equal(received[0].body, body);
    assert.equal(received[0].headers.authorization, "Bearer staff-session");
    assert.equal(received[0].headers["x-forwarded-for"], "127.0.0.1", "a client cannot spoof the forwarded peer address");
    assert.equal(received[0].headers["x-forwarded-proto"], "https");
});

test("a mismatched certificate is rejected before transmitting credentials or reaching the backend", async (t) => {
    const { connection, received } = await createFixture(t);
    await assert.rejects(requestPinned({ ...connection, fingerprint: "0".repeat(64) }, "/api/v1/auth/login", {
        allowLoopback: true, method: "POST", body: '{"password":"must-not-transmit"}',
    }), /certificate does not match/);
    assert.equal(received.length, 0);
    await assert.rejects(verifyConnection({ ...connection, hostId: crypto.randomUUID() }, { allowLoopback: true }), /not the Winstore host/);
});

test("connection verification rejects a live gateway after its backend stops", async (t) => {
    const { network, connection, stopBackend } = await createFixture(t);
    await verifyConnection(connection, { allowLoopback: true });
    await stopBackend();
    assert.equal(network.getStatus().running, true);
    assert.equal((await requestPinned(connection, IDENTITY_PATH, { allowLoopback: true })).statusCode, 200);
    await assert.rejects(verifyConnection(connection, { allowLoopback: true }), /Winstore service is unavailable/);
});

test("a gateway returning unexpected backend health data is not considered connected", async (t) => {
    const { connection } = await createFixture(t, { respond: (response) => {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end('{"success":false,"version":"1.0.0"}');
    } });
    await assert.rejects(verifyConnection(connection, { allowLoopback: true }), /Winstore service is unavailable/);
});

test("LAN registration and branch enrollment remain blocked including encoded and case-variant paths", async (t) => {
    const { connection, received } = await createFixture(t);
    for (const requestPath of [
        "/api/v1/auth/register", "/API/V1/AUTH/REGISTER/", "/api/v1/auth/%72egister", "/api/v1/auth/%2572egister",
        "/api/v1/sync/link", "/api/v1/sync/link-status", "/api/v1/sync/enroll", "/api/v1/sync/branches/code", "/register",
    ]) {
        const response = await requestPinned(connection, requestPath, { allowLoopback: true, method: "POST", body: "{}" });
        assert.equal(response.statusCode, 403, requestPath);
    }
    assert.equal(received.length, 0);
});

test("sharing selects only this host's private address and preserves identity across gateway restarts", async (t) => {
    const { network, connection } = await createFixture(t);
    await network.stop();
    assert.equal(network.getStatus().running, false);
    assert.throws(() => network.getConnectionCode(), /Start store sharing/);
    await assert.rejects(network.start({ address: "0.0.0.0" }), /private IPv4/);
    await network.start({ address: "127.0.0.1" });
    assert.equal(network.getStatus().hostId, connection.hostId);
    assert.equal(network.getStatus().fingerprint, connection.fingerprint);
    await assert.rejects(network.start({ address: "127.0.0.1" }), /already running/);
    const multiple = await createStoreNetwork({
        userData: await temporaryStore(t), backendUrl: "http://127.0.0.1:51123",
        networkInterfaces: () => ({ Wifi: [{ address: "192.168.1.4", family: "IPv4", internal: false }], VPN: [{ address: "10.0.0.5", family: "IPv4", internal: false }] }),
    });
    assert.deepEqual(multiple.getStatus().addresses, [
        { address: "10.0.0.5", name: "10.0.0.5" }, { address: "192.168.1.4", name: "192.168.1.4" },
    ]);
    await assert.rejects(multiple.start(), /more than one private network/);
    await assert.rejects(multiple.start({ address: "192.168.1.200" }), /belonging to this host/);
});

test("stopping sharing waits for an active sale response and rejects competing starts", async (t) => {
    let release;
    let notifyReceived;
    const received = new Promise((resolve) => { notifyReceived = resolve; });
    const { network, connection } = await createFixture(t, { respond: (response) => {
        release = () => { response.writeHead(200); response.end('{"sale":"saved"}'); };
        notifyReceived();
    } });
    const sale = requestPinned(connection, "/api/v1/sales", { allowLoopback: true, method: "POST", body: "{}" });
    await received;
    const stopped = network.stop();
    await assert.rejects(network.start({ address: "127.0.0.1" }), /shutting down/);
    release();
    assert.equal((await sale).body, '{"sale":"saved"}');
    await stopped;
    assert.equal(network.getStatus().running, false);
});
