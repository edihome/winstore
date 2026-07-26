/**
 * ============================================================
 * File: sync.routes.js
 * Module: Core Sync
 *
 * Three access patterns, so auth is applied per-route rather than at the mount:
 *   - PUBLIC   /enroll ....... a branch redeems a one-time code (no session yet;
 *                              the code is the credential).
 *   - PROTOCOL /status|changes|apply|run|snapshot ... a USER (the "Sync now"
 *                              button) OR a branch NODE token. Org-scoped by RLS,
 *                              open to any staff member — sync is operational.
 *   - ADMIN    /branches* .... managing offline branches (mint code, list,
 *                              revoke) — a normal user session, admin-gated.
 * ============================================================
 */

const express = require("express");
const { authenticate } = require("../../middlewares/auth");
const { enforceOrgDbContext } = require("../../middlewares/orgContext");
const { enforceActiveSession } = require("../../middlewares/sessionGuard");
const { authenticateSyncPrincipal, requireSessionUnlessNode } = require("../../middlewares/syncAuth");
const controller = require("./sync.controller");

const router = express.Router();

// PUBLIC — the enrollment code authenticates these. /enroll is called BY a
// branch ON the hub; /link is called ON a branch (first-run) to enroll itself.
router.post("/enroll", controller.enroll);
router.post("/token", controller.issueToken); // refresh secret → short access token
router.post("/link", controller.link);
router.get("/link-status", controller.linkStatus);

// PROTOCOL — user OR branch node.
const protocol = [authenticateSyncPrincipal, enforceOrgDbContext, requireSessionUnlessNode];
router.get("/status", protocol, controller.getStatus);
router.get("/changes", protocol, controller.getChanges);
router.post("/apply", protocol, controller.applyChanges);
router.post("/run", protocol, controller.run);
router.get("/snapshot", protocol, controller.snapshot);
router.post("/credential", protocol, controller.verifyCredential);

// ADMIN — a person managing their org's offline branches.
const admin = [authenticate, enforceOrgDbContext, enforceActiveSession];
router.post("/branches/code", admin, controller.createEnrollCode);
router.get("/branches", admin, controller.listBranches);
router.get("/rejections", admin, controller.listRejections);
router.post("/branches/:nodeId/revoke", admin, controller.revokeBranch);

module.exports = router;
