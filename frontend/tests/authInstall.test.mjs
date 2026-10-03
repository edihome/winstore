import assert from "node:assert/strict";
import test from "node:test";
import { getAuthInstallPolicy, getAuthMode } from "../src/utils/authInstall.js";

test("account creation waits for a valid successful device setup probe", () => {
  const pending = getAuthInstallPolicy(null);
  assert.deepEqual(pending, { stage: "checking", canRegister: false });
  assert.equal(getAuthMode("register", pending), "login");
  const failed = getAuthInstallPolicy(null, "Network unavailable");
  assert.deepEqual(failed, { stage: "unavailable", canRegister: false });
  assert.equal(getAuthMode("register", failed), "login");
  // An old successful result must not authorize signup after a failed retry.
  assert.equal(getAuthInstallPolicy({ branchInstall: false, linked: true }, "Unavailable").canRegister, false);
  for (const invalid of [false, [], {}, { branchInstall: false }, { branchInstall: "false", linked: true }, { branchInstall: false, linked: "true" }]) {
    assert.deepEqual(getAuthInstallPolicy(invalid), { stage: "unavailable", canRegister: false });
  }
});

test("linked branches offer sign-in and attendance without local account creation", () => {
  const policy = getAuthInstallPolicy({ branchInstall: true, linked: true });
  assert.deepEqual(policy, { stage: "ready", canRegister: false });
  assert.equal(getAuthMode("register", policy), "login");
  assert.equal(getAuthMode("login", policy), "login");
  assert.equal(getAuthMode("attendance", policy), "attendance");
});

test("unlinked branches require head-office enrollment rather than local signup", () => {
  const policy = getAuthInstallPolicy({ branchInstall: true, linked: false });
  assert.deepEqual(policy, { stage: "link", canRegister: false });
  assert.equal(getAuthMode("register", policy), "login");
});

test("confirmed standalone servers support local account creation regardless of enrollment state", () => {
  for (const linked of [true, false]) {
    const policy = getAuthInstallPolicy({ branchInstall: false, linked });
    assert.deepEqual(policy, { stage: "ready", canRegister: true });
    assert.equal(getAuthMode("register", policy), "register");
    assert.equal(getAuthMode("attendance", policy), "attendance");
  }
});
