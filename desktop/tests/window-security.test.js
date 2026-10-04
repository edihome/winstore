const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const { generateIdentity } = require("../src/store-certificate");
const { certificateMatches, configureStoreSession, restrictWindow } = require("../src/window-security");

let certificate, fingerprint;
test.before(async () => {
    const identity = await generateIdentity();
    certificate = new crypto.X509Certificate(identity.cert);
    fingerprint = certificate.fingerprint256.replaceAll(":", "").toLowerCase();
});

test("certificate trust requires the exact pin and a date inside the certificate's validity period", () => {
    const starts = Date.parse(certificate.validFrom), expires = Date.parse(certificate.validTo);
    const within = starts + Math.floor((expires - starts) / 2);
    assert.equal(certificateMatches(certificate.toString(), fingerprint, within), true);
    assert.equal(certificateMatches(certificate.toString(), "0".repeat(64), within), false);
    assert.equal(certificateMatches(certificate.toString(), fingerprint, starts - 1), false);
    assert.equal(certificateMatches(certificate.toString(), fingerprint, expires + 1), false);
    assert.equal(certificateMatches("invalid certificate", fingerprint, within), false);
});

test("a store session rejects foreign certificates/hosts, network origins and renderer permissions", () => {
    const handlers = {};
    const session = {
        setCertificateVerifyProc: (handler) => { handlers.certificate = handler; },
        webRequest: { onBeforeRequest: (handler) => { handlers.request = handler; } },
        setPermissionRequestHandler: (handler) => { handlers.permission = handler; },
        setPermissionCheckHandler: (handler) => { handlers.permissionCheck = handler; },
    };
    const origin = "https://192.168.1.20:51124";
    configureStoreSession(session, { origin, fingerprint });
    const trust = (hostname, pem) => {
        let result;
        handlers.certificate({ hostname, certificate: { data: pem } }, (value) => { result = value; });
        return result;
    };
    assert.equal(trust("192.168.1.20", certificate.toString()), 0);
    assert.equal(trust("192.168.1.21", certificate.toString()), -2);
    assert.equal(trust("192.168.1.20", "invalid certificate"), -2);
    for (const [url, allowed] of [
        [origin + "/api/v1/sales", true], [origin + "/assets/app.js", true],
        ["https://192.168.1.20:51125/api/v1/sales", false],
        ["http://192.168.1.20:51124/api/v1/sales", false],
        ["https://192.168.1.21:51124/api/v1/sales", false],
        ["https://192.168.1.20.attacker.example:51124/", false],
        ["file:///C:/private/file", false], ["not a URL", false],
    ]) {
        let result;
        handlers.request({ url }, (value) => { result = value; });
        assert.equal(result.cancel, !allowed, url);
    }
    let permitted;
    handlers.permission({}, "geolocation", (value) => { permitted = value; });
    assert.equal(permitted, false);
    assert.equal(handlers.permissionCheck({}, "notifications"), false);
});

test("main windows allow navigation only within the store origin and deny redirects, popups and webviews outside it", () => {
    const webContents = new EventEmitter();
    let newWindow;
    webContents.setWindowOpenHandler = (handler) => { newWindow = handler; };
    const origin = "https://192.168.1.20:51124";
    restrictWindow({ webContents }, [origin]);
    for (const eventName of ["will-navigate", "will-redirect"]) {
        for (const [url, blocked] of [
            [origin + "/sales", false], [origin + "/login?expired=1", false],
            ["https://192.168.1.20:51125/sales", true], ["http://192.168.1.20:51124/sales", true],
            ["https://foreign.example", true], ["file:///C:/private/file", true], ["javascript:alert(1)", true], ["invalid", true],
        ]) {
            let prevented = false;
            webContents.emit(eventName, { preventDefault: () => { prevented = true; } }, url);
            assert.equal(prevented, blocked, `${eventName} ${url}`);
        }
    }
    assert.deepEqual(newWindow({ url: origin }), { action: "deny" });
    let attached = true;
    webContents.emit("will-attach-webview", { preventDefault: () => { attached = false; } });
    assert.equal(attached, false);
});
