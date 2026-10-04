const AppError = require("../../utils/AppError");
const env = require("../../config/env");

const normalizeHubUrl = (value) => {
    let url;
    try { url = new URL(value); } catch { throw new AppError("A valid head-office API address is required.", 400); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
        throw new AppError("The head-office API address must be an http(s) origin without credentials or a path.", 400);
    }
    return url.origin;
};

const hubUrlFromRequest = (req) => normalizeHubUrl(env.SYNC_PUBLIC_URL || `${req.protocol}://${req.get("host")}`);
const encodeSetupCode = (hubUrl, token) => `WSB1.${Buffer.from(JSON.stringify({ hubUrl: normalizeHubUrl(hubUrl), token })).toString("base64url")}`;
const decodeSetupCode = (code) => {
    if (typeof code !== "string" || code.length > 8192 || !/^WSB1\.[A-Za-z0-9_-]+$/.test(code.trim())) {
        throw new AppError("Enter a valid branch setup code from head office.", 400);
    }
    let payload;
    try { payload = JSON.parse(Buffer.from(code.trim().slice(5), "base64url").toString("utf8")); }
    catch { throw new AppError("Enter a valid branch setup code from head office.", 400); }
    if (!payload || typeof payload.hubUrl !== "string" || typeof payload.token !== "string" || !/^[A-Za-z0-9_-]{32}$/.test(payload.token)) {
        throw new AppError("Enter a valid branch setup code from head office.", 400);
    }
    return { hubUrl: normalizeHubUrl(payload.hubUrl), code: payload.token };
};

module.exports = { hubUrlFromRequest, encodeSetupCode, decodeSetupCode };
