import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { hasPermissionForUser, isAdministrativeUser } from "../src/utils/permissions.js";

const staff = (permissions = []) => ({ role: "staff", permissions });
const require = createRequire(import.meta.url);
const { userHasPermission } = require("../../backend/src/middlewares/permission.js");

test("granular grants allow only the requested action", () => {
  for (const action of ["view", "create", "edit", "delete"]) {
    const user = staff([`expenses:${action}`]);
    for (const requested of ["view", "create", "edit", "delete", "manage"]) {
      assert.equal(hasPermissionForUser(user, "expenses", requested), action === requested);
    }
  }
  assert.equal(hasPermissionForUser(staff(["reports:view"]), "reports"), true);
});

test("read grants allow viewing without allowing writes", () => {
  const user = staff(["inventory:read"]);
  assert.equal(hasPermissionForUser(user, "inventory"), true);
  for (const action of ["create", "edit", "delete", "manage"]) {
    assert.equal(hasPermissionForUser(user, "inventory", action), false);
  }
});

test("legacy manage and privileged roles retain access", () => {
  for (const action of ["view", "create", "edit", "delete", "manage", "stock_adjustment"]) {
    assert.equal(hasPermissionForUser(staff(["stock_movements:manage"]), "stock_movements", action), true);
    for (const role of ["super_admin", "developer"]) {
      assert.equal(hasPermissionForUser({ role }, "expenses", action), true);
    }
  }
  assert.equal(hasPermissionForUser(null, "products"), false);
});

test("arrays require one matching grant for the requested action", () => {
  const user = staff(["expenses:edit"]);
  assert.equal(hasPermissionForUser(user, ["suppliers", "expenses"], "edit"), true);
  assert.equal(hasPermissionForUser(user, ["suppliers", "expenses"], "create"), false);
  assert.equal(hasPermissionForUser(user, [], "edit"), false);
});

test("baseline capabilities work without materialized session grants", () => {
  const user = staff();
  for (const resource of ["customers", "sales", "appointments"]) {
    for (const action of ["view", "create", "edit", "delete"]) {
      assert.equal(hasPermissionForUser(user, resource, action), true);
    }
  }
  for (const resource of ["products", "services", "discounts", "taxes", "users"]) {
    assert.equal(hasPermissionForUser(user, resource), true);
    for (const action of ["create", "edit", "delete", "manage"]) {
      assert.equal(hasPermissionForUser(user, resource, action), false);
    }
  }
  assert.equal(hasPermissionForUser(user, "reports"), false);
});

test("refund requires the explicit action and admin rules retain manage gates", () => {
  assert.equal(hasPermissionForUser(staff(["sales:manage"]), "sales", "refund"), false);
  assert.equal(hasPermissionForUser(staff(["sales:refund"]), "sales", "refund"), true);
  assert.equal(hasPermissionForUser({ role: "super_admin" }, "sales", "refund"), true);
  assert.equal(isAdministrativeUser(staff(["users:view", "roles:edit"])), false);
  assert.equal(isAdministrativeUser(staff(["roles:manage"])), true);
});

test("frontend checks agree with the API across baseline and custom CRUD grants", () => {
  const users = [
    staff(),
    staff(["expenses:view", "products:create", "inventory:edit", "suppliers:delete"]),
    staff(["expenses:read", "stock_movements:manage"]),
    { role: "super_admin" },
    { role: "developer" },
  ];
  for (const user of users) {
    for (const resource of ["expenses", "products", "inventory", "suppliers", "stock_movements", "customers", "sales", "appointments", "services", "discounts", "taxes", "users"]) {
      for (const action of ["view", "create", "edit", "delete"]) {
        const accepted = [`${resource}:${action}`, `${resource}:manage`];
        if (action === "view") accepted.push(`${resource}:read`);
        assert.equal(
          hasPermissionForUser(user, resource, action),
          userHasPermission(user, accepted),
          `${user.role} ${resource}:${action}`,
        );
      }
    }
  }
});
