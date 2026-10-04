import assert from "node:assert/strict";
import test from "node:test";
import { buildBranchPayload, readBranchSetupCode, buildBranchLinkPayload, buildEnrollmentCodePayload } from "../src/utils/branchSetup.js";

test("new branches request an automatic reference while edits retain their existing reference", () => {
  const form = { name: "  Ikeja Shop  ", code: "OLD-REFERENCE", isHeadquarters: false };
  assert.deepEqual(buildBranchPayload(form), { name: "Ikeja Shop", isHeadquarters: false });
  assert.deepEqual(buildBranchPayload(form, { editing: true }), { name: "Ikeja Shop", code: "OLD-REFERENCE", isHeadquarters: false });
  assert.throws(() => buildBranchPayload({ name: " " }), /name is required/);
  assert.throws(() => buildBranchPayload({ name: "x".repeat(256) }), /255/);
  assert.throws(() => buildBranchPayload({ name: "Shop", code: "" }, { editing: true }), /reference is required/);
});

test("creation and regeneration responses provide complete codes without exposing legacy enrollment secrets", () => {
  const expiresAt = "2026-10-04T12:00:00.000Z";
  assert.deepEqual(readBranchSetupCode({ id: "branch-a", setupCode: " COMPLETE-CODE ", setupCodeExpiresAt: expiresAt }), {
    setupCode: "COMPLETE-CODE", expiresAt, branchId: "branch-a",
  });
  assert.deepEqual(readBranchSetupCode({ branchId: "branch-a", setupCode: "COMPLETE-CODE", expiresAt, code: "raw-secret" }), {
    setupCode: "COMPLETE-CODE", expiresAt, branchId: "branch-a",
  });
  for (const invalid of [null, {}, { code: "raw-secret" }, { setupCode: " " }, { setupCode: ["code"] }]) {
    assert.equal(readBranchSetupCode(invalid), null);
  }
});

test("desktop setup submits a single opaque code and requires no manually entered URL", () => {
  assert.deepEqual(buildBranchLinkPayload("  COMPLETE-CODE  "), { setupCode: "COMPLETE-CODE" });
  for (const invalid of ["", " ", null, undefined, {}, ["code"]]) {
    assert.throws(() => buildBranchLinkPayload(invalid), /Enter the branch setup code/);
  }
});

test("the offline branch code workflow always binds setup to a selected branch", () => {
  assert.deepEqual(buildEnrollmentCodePayload(" branch-a ", " Ikeja desktop "), { branchId: "branch-a", name: "Ikeja desktop" });
  assert.deepEqual(buildEnrollmentCodePayload("branch-a"), { branchId: "branch-a", name: undefined });
  for (const invalid of ["", " ", null, undefined, {}, ["branch-a"]]) {
    assert.throws(() => buildEnrollmentCodePayload(invalid), /Choose the branch/);
  }
});
