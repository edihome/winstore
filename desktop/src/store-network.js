const crypto = require("node:crypto");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const os = require("node:os");
const tls = require("node:tls");
const { loadStoreIdentity, checkCertificateDates, certificateFingerprint } = require("./store-certificate");

const NETWORK_PORT = 51124;
const IDENTITY_PATH = "/api/v1/store-network/identity";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PIN = /^[0-9a-f]{64}$/;

const isPrivateIPv4 = (address) => {
    if (net.isIP(address) !== 4) return false;
    const [a, b] = address.split(".").map(Number);
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};
const allowedAddress = (address, allowLoopback) => isPrivateIPv4(address) || (allowLoopback && address === "127.0.0.1");

const discoverPrivateAddresses = (interfaces = os.networkInterfaces()) => {
    const addresses = new Set();
    for (const entries of Object.values(interfaces)) {
        for (const entry of entries || []) {
            if (!entry.internal && (entry.family === "IPv4" || entry.family === 4) && isPrivateIPv4(entry.address)) {
                addresses.add(entry.address);
            }
        }
    }
    return [...addresses].sort();
};

const storeLabel = (value) => {
    if (value === undefined || value === null || value === "") return "Winstore store";
    if (typeof value !== "string" || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) {
        throw new Error("Choose a store name with at most 200 characters and no control characters.");
    }
    return value.trim() || "Winstore store";
};

const validateConnection = (connection, { allowLoopback = false } = {}) => {
    if (!connection || (connection.version !== undefined && connection.version !== 1) ||
        typeof connection.origin !== "string" || !PIN.test(connection.fingerprint) || !UUID.test(connection.hostId)) {
        throw new Error("The store connection code is invalid. Copy a new code from the host computer.");
    }
    let url;
    try { url = new URL(connection.origin); } catch { throw new Error("The store address is invalid."); }
    if (url.protocol !== "https:" || !allowedAddress(url.hostname, allowLoopback) ||
        url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== "/") ||
        (url.port && (!Number.isInteger(Number(url.port)) || Number(url.port) < 1))) {
        throw new Error("The store address must be HTTPS on a private IPv4 address, without a path, password, or query.");
    }
    return {
        origin: url.origin,
        fingerprint: connection.fingerprint,
        hostId: connection.hostId.toLowerCase(),
        ...(connection.storeName !== undefined ? { storeName: storeLabel(connection.storeName) } : {}),
    };
};

const decodeConnectionCode = (input, options) => {
    if (typeof input !== "string" || input.length > 4096 || !/^ws1:[A-Za-z0-9_-]+$/.test(input.trim())) {
        throw new Error("Paste the store connection code beginning with ws1: from the host computer.");
    }
    let value;
    try { value = JSON.parse(Buffer.from(input.trim().slice(4), "base64url").toString("utf8")); }
    catch { throw new Error("The store connection code could not be read. Copy it again from the host computer."); }
    if (value.version !== 1) throw new Error("This store connection code uses an unsupported version.");
    return validateConnection(value, options);
};

const requestPinned = async (input, requestPath, {
    method = "GET", headers = {}, body, timeoutMs = 8000, maxBytes = 1024 * 1024, allowLoopback = false,
} = {}) => {
    const connection = validateConnection(input, { allowLoopback });
    if (typeof requestPath !== "string" || !requestPath.startsWith("/") || requestPath.startsWith("//") || /[\\\r\n]/.test(requestPath)) {
        throw new Error("The store request path is invalid.");
    }
    const url = new URL(requestPath, connection.origin);
    if (url.origin !== connection.origin) throw new Error("The store request must use the paired host.");
    return new Promise((resolve, reject) => {
        let complete = false;
        let socket;
        const agent = new https.Agent({ keepAlive: false });
        const finish = (error, result) => {
            if (complete) return;
            complete = true;
            clearTimeout(timer);
            agent.destroy();
            if (socket) socket.destroy();
            if (error) reject(error); else resolve(result);
        };
        // Only this socket uses self-signed validation. The HTTP request does
        // not receive a socket until its exact certificate pin has matched.
        agent.createConnection = (_options, callback) => {
            let delivered = false;
            const deliver = (error, connected) => {
                if (delivered) return;
                delivered = true;
                callback(error, connected);
            };
            socket = tls.connect({
                host: url.hostname,
                port: Number(url.port) || 443,
                rejectUnauthorized: false,
                minVersion: "TLSv1.2",
            });
            socket.once("error", (error) => deliver(error));
            socket.once("secureConnect", () => {
                try {
                    const certificate = checkCertificateDates(socket.getPeerCertificate().raw);
                    const actual = Buffer.from(certificateFingerprint(certificate), "hex");
                    const expected = Buffer.from(connection.fingerprint, "hex");
                    if (!crypto.timingSafeEqual(actual, expected)) {
                        throw new Error("The store certificate does not match the connection code. Reconnect using the code shown on the host computer.");
                    }
                    deliver(null, socket);
                } catch (error) {
                    deliver(error);
                    socket.destroy();
                }
            });
        };
        const timer = setTimeout(() => finish(new Error("The store host did not respond. Check that it is running and both computers are on the same network.")), timeoutMs);
        const request = https.request(url, { method, headers, agent }, (response) => {
            const chunks = [];
            let size = 0;
            response.on("data", (chunk) => {
                size += chunk.length;
                if (size > maxBytes) { finish(new Error("The store host returned an unexpectedly large response.")); return; }
                chunks.push(chunk);
            });
            response.once("error", (error) => finish(error));
            response.once("end", () => finish(null, {
                statusCode: response.statusCode,
                headers: response.headers,
                body: Buffer.concat(chunks).toString("utf8"),
            }));
        });
        request.once("error", (error) => finish(error));
        request.end(body);
    });
};

const verifyConnection = async (input, options = {}) => {
    const connection = typeof input === "string" ? decodeConnectionCode(input, options) : validateConnection(input, options);
    let response;
    try { response = await requestPinned(connection, IDENTITY_PATH, options); }
    catch (error) { throw new Error(`Could not connect to this store: ${error.message}`); }
    let identity;
    try { identity = JSON.parse(response.body); } catch { throw new Error("This address did not return a Winstore store identity."); }
    if (response.statusCode !== 200 || identity.app !== "winstore" || identity.version !== 1 || identity.hostId !== connection.hostId) {
        throw new Error("This address is not the Winstore host described by the connection code.");
    }
    let healthResponse;
    try { healthResponse = await requestPinned(connection, "/api/v1/health", options); }
    catch (error) { throw new Error(`Could not reach the store service: ${error.message}`); }
    let health;
    try { health = JSON.parse(healthResponse.body); } catch { /* unavailable or unexpected service */ }
    if (healthResponse.statusCode !== 200 || health?.success !== true || typeof health.version !== "string") {
        throw new Error("The store host is reachable, but its Winstore service is unavailable. Keep Winstore running on the host PC and try again.");
    }
    return { ...connection, storeName: storeLabel(identity.storeName) };
};

const canonicalPath = (rawPath) => {
    if (!rawPath.startsWith("/") || rawPath.startsWith("//")) throw new Error("Invalid request path.");
    let pathname = rawPath.split("?")[0];
    for (let i = 0; i < 5; i += 1) {
        const decoded = decodeURIComponent(pathname);
        if (decoded === pathname) break;
        pathname = decoded;
    }
    if (/%[0-9a-f]{2}/i.test(pathname) || /[\u0000-\u001f]/.test(pathname)) throw new Error("Invalid request path.");
    pathname = pathname.replace(/\\/g, "/");
    pathname = pathname.replace(/\/+/g, "/");
    return new URL(pathname, "http://winstore.invalid").pathname.toLowerCase().replace(/\/$/, "");
};

const blocksSetupPath = (pathname) => pathname === "/register" ||
    pathname === "/api/v1/auth/register" || pathname.startsWith("/api/v1/auth/register/") ||
    pathname === "/api/v1/sync" || pathname.startsWith("/api/v1/sync/");

const filterHeaders = (headers) => {
    const omit = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);
    for (const item of String(headers.connection || "").split(",")) omit.add(item.trim().toLowerCase());
    return Object.fromEntries(Object.entries(headers).filter(([key]) => !omit.has(key.toLowerCase()) && !key.toLowerCase().startsWith("x-forwarded-")));
};

const createStoreNetwork = async ({
    userData, backendUrl, port = NETWORK_PORT, getStoreName, networkInterfaces = os.networkInterfaces,
    allowLoopback = false, loadIdentity = loadStoreIdentity,
}) => {
    const backend = new URL(backendUrl);
    if (backend.protocol !== "http:" || backend.hostname !== "127.0.0.1" || backend.username || backend.password || backend.search || backend.hash || backend.pathname !== "/") {
        throw new Error("The store gateway requires a loopback-only Winstore backend.");
    }
    if (!Number.isInteger(port) || port < (allowLoopback ? 0 : 1) || port > 65535) throw new Error("The store network port is invalid.");
    const identity = await loadIdentity(userData);
    let server = null;
    let startTask = null;
    let stopTask = null;
    let address = null;
    let activePort = port;
    let storeName = "Winstore store";
    const connections = new Set();
    const getStatus = () => ({
        running: Boolean(server?.listening),
        address,
        port: activePort,
        origin: address && server?.listening ? `https://${address}:${activePort}` : null,
        storeName,
        addresses: discoverPrivateAddresses(networkInterfaces()).map((item) => ({ address: item, name: item })),
        hostId: identity.hostId,
        fingerprint: identity.fingerprint,
    });
    const getConnectionCode = () => {
        const status = getStatus();
        if (!status.running) throw new Error("Start store sharing before copying a connection code.");
        const code = { version: 1, origin: status.origin, fingerprint: identity.fingerprint, hostId: identity.hostId, storeName };
        return `ws1:${Buffer.from(JSON.stringify(code)).toString("base64url")}`;
    };
    const send = (response, statusCode, body) => {
        response.writeHead(statusCode, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        response.end(JSON.stringify(body));
    };
    const startInternal = async ({ address: selectedAddress, storeName: selectedName } = {}) => {
        const addresses = discoverPrivateAddresses(networkInterfaces());
        if (!selectedAddress) {
            if (addresses.length === 0) throw new Error("No private IPv4 network was found. Connect this computer to the store network and try again.");
            if (addresses.length > 1) throw new Error("This computer has more than one private network. Choose the address connected to the store's tills.");
            [selectedAddress] = addresses;
        }
        if (!allowedAddress(selectedAddress, allowLoopback) || (!addresses.includes(selectedAddress) && !(allowLoopback && selectedAddress === "127.0.0.1"))) {
            throw new Error("Choose a private IPv4 address belonging to this host computer.");
        }
        storeName = storeLabel(selectedName ?? (getStoreName ? await getStoreName() : undefined));
        const candidate = https.createServer({ key: identity.key, cert: identity.cert, minVersion: "TLSv1.2" }, (request, response) => {
            const peer = String(request.socket.remoteAddress || "").replace(/^::ffff:/, "");
            if (!allowedAddress(peer, allowLoopback)) { send(response, 403, { success: false, message: "Store sharing accepts private network connections only." }); return; }
            let pathname;
            try { pathname = canonicalPath(request.url); }
            catch { send(response, 400, { success: false, message: "Invalid request path." }); return; }
            if (pathname === IDENTITY_PATH) {
                if (request.method !== "GET") { send(response, 405, { success: false, message: "Use GET for store identity." }); return; }
                send(response, 200, { app: "winstore", version: 1, hostId: identity.hostId, storeName });
                return;
            }
            if (blocksSetupPath(pathname)) {
                send(response, 403, { success: false, message: "Store setup is available on the host computer only." });
                return;
            }
            const upstreamHeaders = filterHeaders(request.headers);
            upstreamHeaders.host = backend.host;
            // The backend trusts this loopback gateway, never client-supplied
            // forwarding headers. This preserves per-till rate limits.
            upstreamHeaders["x-forwarded-for"] = peer;
            upstreamHeaders["x-forwarded-proto"] = "https";
            const upstream = http.request({
                hostname: backend.hostname,
                port: Number(backend.port) || 80,
                path: request.url,
                method: request.method,
                headers: upstreamHeaders,
                agent: false,
            }, (upstreamResponse) => {
                response.writeHead(upstreamResponse.statusCode, filterHeaders(upstreamResponse.headers));
                upstreamResponse.once("error", () => response.destroy());
                upstreamResponse.pipe(response);
            });
            upstream.setTimeout(30000, () => upstream.destroy(new Error("The local Winstore service timed out.")));
            upstream.once("error", () => {
                if (!response.headersSent) send(response, 502, { success: false, message: "The store host is restarting or unavailable. Try again shortly." });
                else response.destroy();
            });
            request.once("aborted", () => upstream.destroy());
            response.once("close", () => { if (!response.writableFinished) upstream.destroy(); });
            request.pipe(upstream);
        });
        candidate.requestTimeout = 30000;
        candidate.headersTimeout = 10000;
        candidate.on("connection", (socket) => { connections.add(socket); socket.once("close", () => connections.delete(socket)); });
        await new Promise((resolve, reject) => {
            candidate.once("error", reject);
            candidate.listen(port, selectedAddress, () => { candidate.removeListener("error", reject); resolve(); });
        });
        server = candidate;
        address = selectedAddress;
        activePort = candidate.address().port;
        // Runtime listener errors are contained rather than becoming an
        // unhandled event that terminates the host's Electron process.
        candidate.on("error", () => {});
        return getStatus();
    };
    const start = async (options = {}) => {
        if (stopTask) throw new Error("Store sharing is shutting down. Try again shortly.");
        if (server || startTask) throw new Error("Store sharing is already running.");
        startTask = startInternal(options);
        try { return await startTask; }
        finally { startTask = null; }
    };
    const stopInternal = async () => {
        if (startTask) await startTask.catch(() => {});
        const current = server;
        if (!current) return;
        server = null;
        await new Promise((resolve, reject) => {
            // Allow in-flight sales to finish before shutting down the backend.
            const deadline = setTimeout(() => {
                for (const socket of connections) socket.destroy();
            }, 5000);
            current.close((error) => {
                clearTimeout(deadline);
                if (error) reject(error); else resolve();
            });
            current.closeIdleConnections?.();
        });
        connections.clear();
    };
    const stop = () => {
        if (stopTask) return stopTask;
        stopTask = stopInternal().finally(() => { stopTask = null; });
        return stopTask;
    };
    return { hostId: identity.hostId, fingerprint: identity.fingerprint, start, stop, getStatus, getConnectionCode };
};

module.exports = {
    NETWORK_PORT, IDENTITY_PATH, isPrivateIPv4, discoverPrivateAddresses, validateConnection,
    decodeConnectionCode, requestPinned, verifyConnection, createStoreNetwork,
};
