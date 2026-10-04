const crypto = require("node:crypto");

const certificateMatches = (pem, fingerprint, now = Date.now()) => {
    try {
        const cert = new crypto.X509Certificate(pem);
        return cert.fingerprint256.replaceAll(":", "").toLowerCase() === fingerprint
            && Date.parse(cert.validFrom) <= now && now <= Date.parse(cert.validTo);
    } catch { return false; }
};

const configureStoreSession = (session, connection) => {
    const origin = connection.origin;
    const hostname = new URL(origin).hostname;
    session.setCertificateVerifyProc((request, callback) => {
        callback(request.hostname === hostname && certificateMatches(request.certificate.data, connection.fingerprint) ? 0 : -2);
    });
    // A pinned host cannot redirect requests to another server or to local files.
    session.webRequest.onBeforeRequest((details, callback) => {
        let allowed = false;
        try { allowed = new URL(details.url).origin === origin; } catch { /* malformed URL */ }
        callback({ cancel: !allowed });
    });
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false);
};

const restrictWindow = (window, allowedUrls) => {
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    const allowed = (url) => allowedUrls.some((base) => {
        try { return new URL(url).origin === new URL(base).origin && new URL(base).protocol !== "file:"; }
        catch { return false; }
    });
    window.webContents.on("will-navigate", (event, url) => { if (!allowed(url)) event.preventDefault(); });
    window.webContents.on("will-redirect", (event, url) => { if (!allowed(url)) event.preventDefault(); });
    window.webContents.on("will-attach-webview", (event) => event.preventDefault());
};

module.exports = { certificateMatches, configureStoreSession, restrictWindow };
