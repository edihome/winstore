const test = require("node:test");
const assert = require("node:assert/strict");

// auth.service pulls in config/env — provide fallbacks so the suite also
// runs where no backend/.env exists (same pattern as middleware.test.js).
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test";

const { computeSubscriptionStanding } = require("../src/core/organizations/organizations.service");
const { resolveSubscriptionEnforcement } = require("../src/core/auth/auth.service");

const daysFromNow = (n) => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();

test("computeSubscriptionStanding returns null when no expiration is set", () => {
  const standing = computeSubscriptionStanding({ subscription_expires_at: null });
  assert.equal(standing, null);
});

test("computeSubscriptionStanding is 'active' well outside the alert window", () => {
  const standing = computeSubscriptionStanding({
    subscription_expires_at: daysFromNow(60),
    alert_threshold_days: 30,
    extension_days: 0,
  });
  assert.equal(standing.status, "active");
  assert.equal(standing.isExpiringSoon, false);
});

test("computeSubscriptionStanding is 'expiring_soon' inside the configured alert threshold", () => {
  const standing = computeSubscriptionStanding({
    subscription_expires_at: daysFromNow(10),
    alert_threshold_days: 30,
    extension_days: 0,
  });
  assert.equal(standing.status, "expiring_soon");
  assert.equal(standing.isExpiringSoon, true);
  assert.equal(standing.daysRemaining, 10);
});

test("computeSubscriptionStanding respects a custom alert threshold set by the developer", () => {
  const standing = computeSubscriptionStanding({
    subscription_expires_at: daysFromNow(10),
    alert_threshold_days: 5,
    extension_days: 0,
  });
  assert.equal(standing.status, "active", "10 days out is still active under a 5-day threshold");
});

test("computeSubscriptionStanding is 'in_grace' after expiry but within extension days", () => {
  const standing = computeSubscriptionStanding({
    subscription_expires_at: daysFromNow(-3),
    alert_threshold_days: 30,
    extension_days: 7,
  });
  assert.equal(standing.status, "in_grace");
  assert.equal(standing.graceDaysRemaining, 4);
});

test("computeSubscriptionStanding is 'expired' once past expiry and the grace period", () => {
  const standing = computeSubscriptionStanding({
    subscription_expires_at: daysFromNow(-10),
    alert_threshold_days: 30,
    extension_days: 7,
  });
  assert.equal(standing.status, "expired");
  assert.equal(standing.graceDaysRemaining, -3);
});

test("computeSubscriptionStanding's isExpiringSoon red-highlight rule is a flat 30 days regardless of alert threshold", () => {
  const standing = computeSubscriptionStanding({
    subscription_expires_at: daysFromNow(20),
    alert_threshold_days: 5, // configured threshold wouldn't flag this yet
    extension_days: 0,
  });
  assert.equal(standing.status, "active", "not yet inside the configured 5-day alert threshold");
  assert.equal(standing.isExpiringSoon, true, "but the flat 30-day red-highlight rule still applies");
});

// A user row as auth.repository.findUserByEmail/findUserById returns it,
// reduced to the fields resolveSubscriptionEnforcement reads.
const userRow = (roleName, overrides = {}) => ({
  role_name: roleName,
  organization_status: "active",
  subscription_expires_at: daysFromNow(-10),
  alert_threshold_days: 30,
  extension_days: 7, // 10 days past expiry, 7 grace days => "expired"
  ...overrides,
});

test("resolveSubscriptionEnforcement blocks staff once the subscription is past expiry and grace", () => {
  const enforcement = resolveSubscriptionEnforcement(userRow("Cashier"));
  assert.equal(enforcement.blocked, true);
  assert.equal(enforcement.locked, false);
});

test("resolveSubscriptionEnforcement locks (but admits) the super_admin when expired", () => {
  const enforcement = resolveSubscriptionEnforcement(userRow("super_admin"));
  assert.equal(enforcement.blocked, false);
  assert.equal(enforcement.locked, true, "owner gets in, but only to the renewal-info routes");
});

test("resolveSubscriptionEnforcement leaves everyone alone during the grace period", () => {
  const inGrace = { subscription_expires_at: daysFromNow(-3) }; // 3 days past, 7 grace days
  assert.deepEqual(resolveSubscriptionEnforcement(userRow("Cashier", inGrace)), {
    blocked: false,
    locked: false,
    message: null,
  });
  assert.equal(resolveSubscriptionEnforcement(userRow("super_admin", inGrace)).locked, false);
});

test("resolveSubscriptionEnforcement treats a deactivated organization exactly like an expired subscription", () => {
  const inactive = { organization_status: "inactive", subscription_expires_at: daysFromNow(60) };
  const staff = resolveSubscriptionEnforcement(userRow("Cashier", inactive));
  assert.equal(staff.blocked, true, "staff are refused at login");
  const owner = resolveSubscriptionEnforcement(userRow("super_admin", inactive));
  assert.equal(owner.blocked, false, "the owner still gets in");
  assert.equal(owner.locked, true, "…but only to the renewal-info routes");
});

test("resolveSubscriptionEnforcement never touches the developer platform role", () => {
  const enforcement = resolveSubscriptionEnforcement(
    userRow("developer", { organization_status: "inactive" })
  );
  assert.deepEqual(enforcement, { blocked: false, locked: false, message: null });
});

test("resolveSubscriptionEnforcement does nothing when no expiration is set", () => {
  const enforcement = resolveSubscriptionEnforcement(userRow("Cashier", { subscription_expires_at: null }));
  assert.equal(enforcement.blocked, false);
});
