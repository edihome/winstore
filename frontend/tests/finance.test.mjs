import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import {
  MAX_MONEY_CENTS,
  moneyInputToCents,
  buildBudgetPayload,
  buildCashRegisterPayload,
  cashBalanceAfter,
  buildCashTransactionPayload,
  sumMoneyAmounts,
} from "../src/utils/finance.js";

const require = createRequire(import.meta.url);
const { moneyToCents } = require("../../backend/src/utils/money.js");
const { validateCreateBudget } = require("../../backend/src/core/budgets/budgets.validation.js");
const { validateCreateCashRegister, validateCreateCashTransaction } = require("../../backend/src/core/cash-register/cash-register.validation.js");

test("money parsing preserves cents and the database's exact upper bound", () => {
  assert.equal(moneyInputToCents(" 12.30 "), 1230);
  assert.equal(moneyInputToCents("0.01"), 1);
  assert.equal(moneyInputToCents("9999999999.99"), MAX_MONEY_CENTS);
  assert.equal(moneyInputToCents(0, { allowZero: true }), 0);
  for (const value of ["", " ", "-1", "0", "0.00", "0.001", "1.234", "1e3", "Infinity", "NaN", "1,000", "9999999999.999", "10000000000", null, undefined]) {
    assert.throws(() => moneyInputToCents(value), Error, String(value));
  }
});

test("budgets submit trimmed names, validated positive amounts, and supported statuses", () => {
  assert.deepEqual(buildBudgetPayload({ name: "  Stock  ", amount: "1750.25", status: "inactive" }), { name: "Stock", amount: 1750.25, status: "inactive" });
  assert.equal(buildBudgetPayload({ name: "Expenses", amount: "1" }).status, "active");
  assert.throws(() => buildBudgetPayload({ name: " ", amount: "1" }), /name is required/);
  assert.throws(() => buildBudgetPayload({ name: "Stock", amount: "-1" }), /Amount/);
  assert.throws(() => buildBudgetPayload({ name: "Stock", amount: "1", status: "closed" }), /active or inactive/);
  for (const status of [null, false, 0, "", ["active"], { toString: () => "active" }]) {
    assert.throws(() => buildBudgetPayload({ name: "Stock", amount: "1", status }), /active or inactive/);
  }
  assert.throws(() => buildBudgetPayload({ name: "x".repeat(256), amount: "1" }), /255/);
});

test("register creation always requires a branch and supports an empty opening float", () => {
  assert.deepEqual(buildCashRegisterPayload({ name: " Till 1 ", branchId: " branch-a ", openingBalance: "" }), { name: "Till 1", branchId: "branch-a", openingBalance: 0 });
  assert.equal(buildCashRegisterPayload({ name: "Till", branchId: "branch-a", openingBalance: "10.25" }).openingBalance, 10.25);
  assert.throws(() => buildCashRegisterPayload({ name: "Till", branchId: "", openingBalance: "0" }), /Choose a branch/);
  assert.throws(() => buildCashRegisterPayload({ name: "Till", branchId: "branch-a", openingBalance: "-0.01" }), /Opening balance/);
  assert.throws(() => buildCashRegisterPayload({ name: "Till", branchId: "branch-a", openingBalance: [1] }), /Opening balance/);
});

test("movement previews calculate decimal balances exactly and prevent overdrawing or overflow", () => {
  assert.equal(cashBalanceAfter("0.10", "inflow", "0.20"), 0.3);
  assert.equal(cashBalanceAfter("0.30", "outflow", "0.20"), 0.1);
  assert.equal(cashBalanceAfter("0.30", "outflow", "0.30"), 0);
  assert.equal(cashBalanceAfter("9999999999.98", "inflow", "0.01"), 9999999999.99);
  assert.throws(() => cashBalanceAfter("0.30", "outflow", "0.31"), /cannot exceed/);
  assert.throws(() => cashBalanceAfter("9999999999.99", "inflow", "0.01"), /maximum balance/);
  assert.throws(() => cashBalanceAfter("1", "refund", "0.01"), /money in or money out/);
});

test("movement payloads bind to the selected open register and retain a clean reference", () => {
  const register = { id: "register-a", currentBalance: "15.50", status: "open" };
  const form = { transactionType: "outflow", amount: "3.50", reference: " Voucher 17 ", notes: " Petty cash " };
  assert.deepEqual(buildCashTransactionPayload(form, register), {
    cashRegisterId: "register-a", transactionType: "outflow", amount: 3.5, reference: "Voucher 17", notes: "Petty cash",
  });
  assert.throws(() => buildCashTransactionPayload(form, null), /Select a register/);
  assert.throws(() => buildCashTransactionPayload(form, { ...register, status: "closed" }), /open register/);
  assert.throws(() => buildCashTransactionPayload({ ...form, amount: "15.51" }, register), /cannot exceed/);
  assert.throws(() => buildCashTransactionPayload({ ...form, reference: "x".repeat(151) }, register), /150/);
  const empty = buildCashTransactionPayload({ ...form, reference: "", notes: " " }, register);
  assert.equal(empty.reference, undefined);
  assert.equal(empty.notes, undefined);
});

test("budget and register summary totals sum cents rather than binary fractions", () => {
  assert.equal(sumMoneyAmounts(["0.10", 0.2, "0.30"]), 0.6);
  assert.equal(sumMoneyAmounts([]), 0);
  assert.equal(sumMoneyAmounts([0, "12.34", "100.01"]), 112.35);
});

test("summary totals retain signed historic budgets without allowing negative new amounts", () => {
  assert.equal(sumMoneyAmounts([100, -25.50]), 74.5);
  assert.equal(sumMoneyAmounts(["100.00", " -25.50 "]), 74.5);
  assert.equal(sumMoneyAmounts(["0.30", "-0.20"]), 0.1);
  for (const value of [-25.50, "-25.50"]) {
    assert.throws(() => moneyInputToCents(value));
    assert.throws(() => buildBudgetPayload({ name: "New budget", amount: value }));
  }
  for (const value of [-Infinity, NaN, "-1.234", "-1e3", null, [1]]) {
    assert.throws(() => sumMoneyAmounts([value]));
  }
});

test("frontend money inputs and create payloads satisfy the backend validator contract", () => {
  for (const value of ["0", 0, "0.01", "100.25", "9999999999.99"]) {
    assert.equal(moneyInputToCents(value, { allowZero: true }), moneyToCents(value));
  }
  for (const value of [null, undefined, true, [1], {}, "0.001", "1e2", "10000000000"]) {
    assert.equal(moneyToCents(value), null);
    assert.throws(() => moneyInputToCents(value, { allowZero: true }));
  }
  const organizationId = "organization-a";
  const budget = buildBudgetPayload({ name: "Operations", amount: "150.25", status: "active" });
  const register = buildCashRegisterPayload({ name: "Front counter", branchId: "branch-a", openingBalance: "10.50" });
  const movement = buildCashTransactionPayload({ transactionType: "outflow", amount: "1.25", reference: "Voucher 1" }, { id: "register-a", status: "open", currentBalance: 10.5 });
  assert.deepEqual(validateCreateBudget({ ...budget, organizationId }), []);
  assert.deepEqual(validateCreateCashRegister({ ...register, organizationId }), []);
  assert.deepEqual(validateCreateCashTransaction({ ...movement, organizationId }), []);
});
