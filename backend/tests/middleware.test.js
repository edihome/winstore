const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

// env.js validates required variables the moment it's first required (which
// happens inside auth.js below), so these must be set before that require.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";

const { authenticate } = require("../src/middlewares/auth");
const { requirePermission } = require("../src/middlewares/permission");

test("authenticate attaches a decoded user to req when a valid bearer token is provided", () => {
  const token = jwt.sign({ sub: "user-1", role: "admin", permissions: ["inventory:manage"] }, process.env.JWT_SECRET);
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = {};
  let nextCalled = false;

  authenticate(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(req.user.role, "admin");
  assert.deepEqual(req.user.permissions, ["inventory:manage"]);
});

test("requirePermission allows super admin users and explicitly granted permissions", () => {
  const req = { user: { role: "super_admin", permissions: [] } };
  const res = {};
  let nextCalled = false;

  const middleware = requirePermission("inventory:manage");
  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
});

test("requirePermission blocks users without the requested permission", () => {
  const req = { user: { role: "staff", permissions: ["customers:read"] } };
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
  let nextCalled = false;

  const middleware = requirePermission("inventory:manage");
  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.success, false);
});
