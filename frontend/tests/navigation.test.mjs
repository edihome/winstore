import assert from "node:assert/strict";
import test from "node:test";
import { navItemMatchesPath } from "../src/utils/navigation.js";

test("new billing pages match their own navigation item and breadcrumb", () => {
  const items = [
    { to: "/dashboard/billing", label: "Discounts & Taxes", end: true },
    { to: "/dashboard/billing/budgets", label: "Budgets" },
    { to: "/dashboard/billing/cash-register", label: "Cash Register" },
  ];
  for (const item of items) {
    assert.equal(items.find((candidate) => navItemMatchesPath(candidate, item.to))?.label, item.label);
  }
  assert.equal(navItemMatchesPath(items[0], "/dashboard/billing/budgets"), false);
  assert.equal(navItemMatchesPath(items[1], "/dashboard/billing/budgets-other"), false);
  assert.equal(navItemMatchesPath({ to: "/dashboard/reports" }, "/dashboard/reports/profit"), true);
});
