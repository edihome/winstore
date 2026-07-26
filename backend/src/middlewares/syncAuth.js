/**
 * ============================================================
 * File: syncAuth.js
 * Module: Middlewares — offline-sync node authentication
 *
 * Description:
 * The /sync protocol endpoints are reached by TWO kinds of caller:
 *   - a logged-in PERSON (the "Sync now" button) → a normal user JWT;
 *   - an unattended BRANCH daemon → a durable "sync-node" token issued at
 *     enrollment (see sync enroll). A node isn't a user, so it can't carry a
 *     user session — its liveness is the node row (is_active + token_version).
 *
 * `authenticateSyncPrincipal` accepts either and normalizes req.user; the
 * standard `orgContext` then pins the tenant exactly as for a user (RLS is
 * still the whole boundary). `requireSessionUnlessNode` applies the user
 * session guard for people and the node-liveness check for branches.
 *
 * The node token is deliberately a DISTINCT token type (`typ: "sync-node"`),
 * so it can never be used as a user session, nor a user JWT as a node.
 * ============================================================
 */

const jwt = require("jsonwebtoken");
const env = require("../config/env");
const { authenticate } = require("./auth");
const { enforceActiveSession } = require("./sessionGuard");
const syncRepository = require("../core/sync/sync.repository");

const bearer = (req) => {
    const header = req.headers?.authorization || "";
    return header.startsWith("Bearer ") ? header.slice(7) : "";
};

const authenticateSyncPrincipal = (req, res, next) => {
    const token = bearer(req);
    if (!token) {
        return res.status(401).json({ success: false, message: "Authentication token is required." });
    }

    let decoded;
    try {
        decoded = jwt.verify(token, env.JWT_SECRET);
    } catch {
        return res.status(401).json({ success: false, message: "Invalid or expired token." });
    }

    if (decoded.typ === "sync-node") {
        req.isNode = true;
        req.syncNode = { nodeId: decoded.sub, organizationId: decoded.organizationId, tokenVersion: decoded.tokenVersion ?? 0 };
        req.user = { id: null, role: "sync-node", organizationId: decoded.organizationId, branchId: null, permissions: [], nodeId: decoded.sub };
        return next();
    }

    // A normal user token — hand off to the standard user authenticator.
    return authenticate(req, res, next);
};

// After orgContext has pinned the tenant: enforce the user session for people,
// and the node's liveness (not revoked, token not rotated) for branches.
const requireSessionUnlessNode = async (req, res, next) => {
    if (!req.isNode) {
        return enforceActiveSession(req, res, next);
    }
    try {
        const node = await syncRepository.getNodeById(req.user.nodeId);
        if (!node || node.is_active !== true || node.token_version !== req.syncNode.tokenVersion) {
            return res.status(401).json({ success: false, message: "This branch has been disconnected. Re-enroll to continue syncing." });
        }
        // Stash the node so downstream can enforce branch scope on pushes.
        req.syncNodeRow = node;
        // Best-effort liveness stamp; never block the request on it.
        syncRepository.touchNode(req.user.nodeId).catch(() => {});
        return next();
    } catch (error) {
        return next(error);
    }
};

module.exports = { authenticateSyncPrincipal, requireSessionUnlessNode };
