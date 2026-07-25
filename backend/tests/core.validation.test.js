const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateCreateOrganization,
  validateUpdateOrganization,
} = require("../src/core/organizations/organizations.validation");
const { validateLogin, validateChangePassword } = require("../src/core/auth/auth.validation");
const { validateCreateBranch, validateUpdateBranch } = require("../src/core/branches/branches.validation");
const { assertBranchAccessible } = require("../src/utils/assertBranchAccessible");
const { isPrivilegedRole } = require("../src/utils/isPrivilegedRole");
const AppError = require("../src/utils/AppError");
const { validateCreateRole } = require("../src/core/roles/roles.validation");
const { validateCreatePermission } = require("../src/core/permissions/permissions.validation");
const { validateCreateUser, validateResetPassword } = require("../src/core/users/users.validation");
const { validateCreateSetting } = require("../src/core/settings/settings.validation");
const { validateCreateAuditLog } = require("../src/core/audit/audit.validation");
const { validateCreateNotification } = require("../src/core/notifications/notifications.validation");
const { validateCreateAttendance, validateKioskToggle } = require("../src/core/attendance/attendance.validation");
const { validateCreateCustomer } = require("../src/core/customers/customers.validation");
const { validateCreateSupplier } = require("../src/core/suppliers/suppliers.validation");
const { validateReportRange } = require("../src/core/reports/reports.validation");
const { validateCreatePurchase } = require("../src/core/purchases/purchases.validation");
const { validateCreateSale } = require("../src/core/sales/sales.validation");
const { validateCreateProduct } = require("../src/core/products/products.validation");
const { validateCreateExpense } = require("../src/core/expenses/expenses.validation");
const { validateCreatePayment } = require("../src/core/payments/payments.validation");
const { validateCreateBudget } = require("../src/core/budgets/budgets.validation");
const { validateCreateTax } = require("../src/core/taxes/taxes.validation");
const { validateCreateDiscount } = require("../src/core/discounts/discounts.validation");
const { validateCreateCategory } = require("../src/core/categories/categories.validation");
const { validateCreateStockMovement } = require("../src/core/stock-movements/stock-movements.validation");
const {
  validateCreateCashRegister,
  validateCreateCashTransaction,
} = require("../src/core/cash-register/cash-register.validation");

test("validateCreateOrganization flags a missing name but not a missing slug (auto-derived)", () => {
  const errors = validateCreateOrganization({ name: "", slug: "" });

  assert.equal(errors.length > 0, true);
  assert.match(errors.join(" "), /name/i);
  assert.doesNotMatch(errors.join(" "), /slug/i);
});

test("validateCreateOrganization rejects a malformed slug when one is explicitly given", () => {
  const errors = validateCreateOrganization({ name: "Acme Co", slug: "Not A Slug!" });

  assert.match(errors.join(" "), /slug/i);
});

test("validateUpdateOrganization rejects blank name, bad slug, and an unknown status", () => {
  const errors = validateUpdateOrganization({ name: "  ", slug: "Not A Slug!", status: "banned" });

  assert.equal(errors.length, 3);
  assert.match(errors.join(" "), /name/i);
  assert.match(errors.join(" "), /slug/i);
  assert.match(errors.join(" "), /status/i);

  const valid = validateUpdateOrganization({ status: "inactive" });
  assert.equal(valid.length, 0);
});

test("isPrivilegedRole recognizes super_admin and developer only", () => {
  assert.equal(isPrivilegedRole("super_admin"), true);
  assert.equal(isPrivilegedRole("developer"), true);
  assert.equal(isPrivilegedRole("cashier"), false);
  assert.equal(isPrivilegedRole(undefined), false);
});

test("validateLogin requires an email and password", () => {
  const errors = validateLogin({ email: "", password: "" });

  assert.equal(errors.length > 0, true);
  assert.match(errors.join(" "), /email/i);
  assert.match(errors.join(" "), /password/i);
});

test("validateChangePassword requires the current password and an 8+ char new one", () => {
  const errors = validateChangePassword({ currentPassword: "", newPassword: "short" });

  assert.equal(errors.length > 0, true);
  assert.match(errors.join(" "), /current password/i);
  assert.match(errors.join(" "), /8 characters/i);

  const valid = validateChangePassword({ currentPassword: "old-password", newPassword: "new-password-123" });
  assert.equal(valid.length, 0);
});

test("validateCreateBranch requires a name, code, and organization id", () => {
  const errors = validateCreateBranch({ name: "", code: "", organizationId: "" });

  assert.equal(errors.length > 0, true);
  assert.match(errors.join(" "), /name/i);
  assert.match(errors.join(" "), /code/i);
  assert.match(errors.join(" "), /organization/i);
});

test("validateUpdateBranch rejects blank name/code and a non-boolean isHeadquarters", () => {
  const errors = validateUpdateBranch({ name: "  ", code: "  ", isHeadquarters: "yes" });

  assert.equal(errors.length, 3);
  assert.match(errors.join(" "), /name/i);
  assert.match(errors.join(" "), /code/i);
  assert.match(errors.join(" "), /isHeadquarters/i);

  const valid = validateUpdateBranch({ name: "Main St" });
  assert.equal(valid.length, 0);

  const empty = validateUpdateBranch({});
  assert.equal(empty.length, 0);
});

test("assertBranchAccessible throws only when the branch isn't in the accessible list", () => {
  assert.throws(() => assertBranchAccessible("branch-b", ["branch-a"], "Sale not found."), AppError);
  assert.doesNotThrow(() => assertBranchAccessible("branch-a", ["branch-a"], "Sale not found."));
  // A null accessibleBranchIds means "unrestricted" (super_admin callers).
  assert.doesNotThrow(() => assertBranchAccessible("branch-b", null, "Sale not found."));
});

test("validateCreateRole requires a name and organization id", () => {
  const errors = validateCreateRole({ name: "", organizationId: "" });

  assert.equal(errors.length > 0, true);
  assert.match(errors.join(" "), /name/i);
  assert.match(errors.join(" "), /organization/i);
});

test("validateCreateRole rejects the reserved super_admin name and unknown modules", () => {
  const reserved = validateCreateRole({ name: "Super_Admin", organizationId: "org-1" });
  assert.equal(reserved.length > 0, true);
  assert.match(reserved.join(" "), /reserved/i);

  const reservedDeveloper = validateCreateRole({ name: "Developer", organizationId: "org-1" });
  assert.equal(reservedDeveloper.length > 0, true);
  assert.match(reservedDeveloper.join(" "), /reserved/i);

  const unknownModule = validateCreateRole({ name: "Cashier", organizationId: "org-1", resources: ["not_a_module"] });
  assert.equal(unknownModule.length > 0, true);
  assert.match(unknownModule.join(" "), /unknown module/i);

  const valid = validateCreateRole({ name: "Cashier", organizationId: "org-1", resources: ["sales", "customers"] });
  assert.equal(valid.length, 0);
});

test("validateCreatePermission requires a name, resource, action, and organization id", () => {
  const errors = validateCreatePermission({ name: "", resource: "", action: "", organizationId: "" });

  assert.equal(errors.length > 0, true);
  assert.match(errors.join(" "), /name/i);
  assert.match(errors.join(" "), /resource/i);
  assert.match(errors.join(" "), /action/i);
  assert.match(errors.join(" "), /organization/i);
});

test("validateResetPassword requires an 8+ character new password", () => {
  const errors = validateResetPassword({ newPassword: "short" });

  assert.equal(errors.length > 0, true);
  assert.match(errors.join(" "), /8 characters/i);

  const valid = validateResetPassword({ newPassword: "a-valid-new-password" });
  assert.equal(valid.length, 0);
});

test("validateCreateUser requires core identity fields and a password", () => {
  const errors = validateCreateUser({ firstName: "", lastName: "", email: "", password: "", organizationId: "" });

  assert.equal(errors.length > 0, true);
  assert.match(errors.join(" "), /first/i);
  assert.match(errors.join(" "), /last/i);
  assert.match(errors.join(" "), /email/i);
  assert.match(errors.join(" "), /password/i);
  assert.match(errors.join(" "), /organization/i);
});

test("validateCreateUser rejects a non-array branchIds", () => {
  const errors = validateCreateUser({
    firstName: "A", lastName: "B", email: "a@b.com", password: "password123",
    organizationId: "org-1", branchIds: "not-an-array",
  });

  assert.equal(errors.length > 0, true);
  assert.match(errors.join(" "), /branchIds/i);

  const valid = validateCreateUser({
    firstName: "A", lastName: "B", email: "a@b.com", password: "password123",
    organizationId: "org-1", branchIds: ["branch-1", "branch-2"],
  });
  assert.equal(valid.length, 0);
});

test("validateCreateSetting requires a key and organization id", () => {
  const errors = validateCreateSetting({ key: "", organizationId: "" });

  assert.equal(errors.length > 0, true);
  assert.match(errors.join(" "), /key/i);
  assert.match(errors.join(" "), /organization/i);
});

test("validateCreateAuditLog requires an action and organization id", () => {
  const errors = validateCreateAuditLog({ action: "", organizationId: "" });

  assert.equal(errors.length > 0, true);
  assert.match(errors.join(" "), /action/i);
  assert.match(errors.join(" "), /organization/i);
});

test("validateCreateNotification requires a message and organization id", () => {
  const errors = validateCreateNotification({ message: "", organizationId: "" });

  assert.equal(errors.length > 0, true);
  assert.match(errors.join(" "), /message/i);
  assert.match(errors.join(" "), /organization/i);
});

test("validateCreateAttendance requires a user id and organization id", () => {
  const errors = validateCreateAttendance({ userId: "", organizationId: "" });

  assert.equal(errors.length > 0, true);
  assert.match(errors.join(" "), /user/i);
  assert.match(errors.join(" "), /organization/i);
});

test("validateKioskToggle requires an email and password", () => {
  const errors = validateKioskToggle({ email: "", password: "" });

  assert.equal(errors.length > 0, true);
  assert.match(errors.join(" "), /email/i);
  assert.match(errors.join(" "), /password/i);

  const valid = validateKioskToggle({ email: "staff@example.com", password: "hunter22" });
  assert.equal(valid.length, 0);
});

test("validateCreateCustomer requires core identity fields", () => {
  const errors = validateCreateCustomer({ name: "", email: "", phone: "", organizationId: "" });

  assert.equal(errors.length > 0, true);
  assert.match(errors.join(" "), /name/i);
  assert.match(errors.join(" "), /email/i);
  assert.match(errors.join(" "), /phone/i);
  assert.match(errors.join(" "), /organization/i);
});

test("validateCreateSupplier requires core identity fields", () => {
  const errors = validateCreateSupplier({ name: "", email: "", phone: "", organizationId: "" });

  assert.equal(errors.length > 0, true);
  assert.match(errors.join(" "), /name/i);
  assert.match(errors.join(" "), /email/i);
  assert.match(errors.join(" "), /phone/i);
  assert.match(errors.join(" "), /organization/i);
});

test("validateReportRange rejects malformed and inverted date ranges", () => {
  const malformed = validateReportRange({ from: "not-a-date" });
  assert.equal(malformed.length > 0, true);
  assert.match(malformed.join(" "), /from/i);

  const inverted = validateReportRange({ from: "2026-02-01", to: "2026-01-01" });
  assert.equal(inverted.length > 0, true);
  assert.match(inverted.join(" "), /before/i);

  const valid = validateReportRange({ from: "2026-01-01", to: "2026-02-01" });
  assert.equal(valid.length, 0);
});

test("validateCreatePurchase requires a supplier id, branch id, and at least one item", () => {
  const errors = validateCreatePurchase({ supplierId: "", branchId: "", organizationId: "", items: [] });

  assert.equal(errors.length > 0, true);
  assert.match(errors.join(" "), /supplier/i);
  assert.match(errors.join(" "), /branch/i);
  assert.match(errors.join(" "), /item/i);
  assert.match(errors.join(" "), /organization/i);
});

test("validateCreateSale requires a branch id and at least one item, but not a customer", () => {
  const errors = validateCreateSale({ branchId: "", items: [] });

  assert.equal(errors.length > 0, true);
  assert.match(errors.join(" "), /branch/i);
  assert.match(errors.join(" "), /item/i);
  assert.doesNotMatch(errors.join(" "), /customer/i);
});

test("validateCreateSale rejects a blank customerId but accepts an omitted one (walk-in)", () => {
  const blank = validateCreateSale({ customerId: "", branchId: "b1", items: [{ itemType: "product", productId: "p1", quantity: 1 }] });
  assert.match(blank.join(" "), /customer/i);

  const omitted = validateCreateSale({ branchId: "b1", items: [{ itemType: "product", productId: "p1", quantity: 1 }] });
  assert.equal(omitted.length, 0);
});

test("validateCreateProduct requires a name, sku, and organization id", () => {
  const errors = validateCreateProduct({ name: "", sku: "", organizationId: "" });

  assert.equal(errors.length > 0, true);
  assert.match(errors.join(" "), /name/i);
  assert.match(errors.join(" "), /sku/i);
  assert.match(errors.join(" "), /organization/i);
});

test("validateCreateProduct rejects a malformed barcode but accepts a well-formed one", () => {
  const base = { name: "Widget", sku: "W-1", organizationId: "org1" };

  const malformed = validateCreateProduct({ ...base, barcode: "not a barcode!" });
  assert.match(malformed.join(" "), /barcode/i);

  const valid = validateCreateProduct({ ...base, barcode: "6009999999995" });
  assert.equal(valid.length, 0);
});

test("validateCreateProduct rejects a negative or fractional opening stock", () => {
  const base = { name: "Widget", sku: "W-1", organizationId: "org1" };

  const negative = validateCreateProduct({ ...base, openingStock: -5 });
  assert.match(negative.join(" "), /opening stock/i);

  const fractional = validateCreateProduct({ ...base, openingStock: 2.5 });
  assert.match(fractional.join(" "), /opening stock/i);

  const valid = validateCreateProduct({ ...base, openingStock: 50 });
  assert.equal(valid.length, 0);
});

test("validateCreatePurchase rejects an item with a malformed expiryDate", () => {
  const errors = validateCreatePurchase({
    supplierId: "s1",
    branchId: "b1",
    organizationId: "org1",
    items: [{ productId: "p1", quantity: 5, unitCost: 10, expiryDate: "not-a-date" }],
  });

  assert.match(errors.join(" "), /expiryDate/i);
});

test("validateCreateExpense requires a description, amount, branch id, and organization id", () => {
  const errors = validateCreateExpense({ description: "", amount: "", branchId: "", organizationId: "" });

  assert.equal(errors.length > 0, true);
  assert.match(errors.join(" "), /description/i);
  assert.match(errors.join(" "), /amount/i);
  assert.match(errors.join(" "), /branch/i);
  assert.match(errors.join(" "), /organization/i);
});

test("validateCreatePayment requires a sale id, amount, and organization id", () => {
  const errors = validateCreatePayment({ saleId: "", amount: "", organizationId: "" });

  assert.equal(errors.length > 0, true);
  assert.match(errors.join(" "), /sale/i);
  assert.match(errors.join(" "), /amount/i);
  assert.match(errors.join(" "), /organization/i);
});

test("validateCreateBudget requires a name, amount, and organization id", () => {
  const errors = validateCreateBudget({ name: "", amount: "", organizationId: "" });

  assert.equal(errors.length > 0, true);
  assert.match(errors.join(" "), /name/i);
  assert.match(errors.join(" "), /amount/i);
  assert.match(errors.join(" "), /organization/i);
});

test("validateCreateTax requires a name, rate, and organization id", () => {
  const errors = validateCreateTax({ name: "", rate: "", organizationId: "" });

  assert.equal(errors.length > 0, true);
  assert.match(errors.join(" "), /name/i);
  assert.match(errors.join(" "), /rate/i);
  assert.match(errors.join(" "), /organization/i);
});

test("validateCreateDiscount requires a code, amount, and organization id", () => {
  const errors = validateCreateDiscount({ code: "", amount: "", organizationId: "" });

  assert.equal(errors.length > 0, true);
  assert.match(errors.join(" "), /code/i);
  assert.match(errors.join(" "), /amount/i);
  assert.match(errors.join(" "), /organization/i);
});

test("validateCreateCategory requires a name and organization id", () => {
  const errors = validateCreateCategory({ name: "", organizationId: "" });

  assert.equal(errors.length > 0, true);
  assert.match(errors.join(" "), /name/i);
  assert.match(errors.join(" "), /organization/i);
});

test("validateCreateStockMovement requires product, branch, type, quantity, and organization id", () => {
  const errors = validateCreateStockMovement({
    productId: "",
    branchId: "",
    movementType: "",
    quantity: "",
    organizationId: "",
  });

  assert.equal(errors.length > 0, true);
  assert.match(errors.join(" "), /product/i);
  assert.match(errors.join(" "), /branch/i);
  assert.match(errors.join(" "), /type/i);
  assert.match(errors.join(" "), /quantity/i);
  assert.match(errors.join(" "), /organization/i);
});

test("validateCreateStockMovement rejects a malformed expiry date on a stock-in", () => {
  const errors = validateCreateStockMovement({
    productId: "p1",
    branchId: "b1",
    movementType: "in",
    quantity: 10,
    organizationId: "org1",
    expiryDate: "not-a-date",
  });

  assert.match(errors.join(" "), /expiry date/i);
});

test("validateCreateCashRegister requires a name and organization id", () => {
  const errors = validateCreateCashRegister({ name: "", organizationId: "" });

  assert.equal(errors.length > 0, true);
  assert.match(errors.join(" "), /name/i);
  assert.match(errors.join(" "), /organization/i);
});

test("validateCreateCashTransaction requires register, type, amount, and organization id", () => {
  const errors = validateCreateCashTransaction({
    cashRegisterId: "",
    transactionType: "",
    amount: "",
    organizationId: "",
  });

  assert.equal(errors.length > 0, true);
  assert.match(errors.join(" "), /cash register/i);
  assert.match(errors.join(" "), /type/i);
  assert.match(errors.join(" "), /amount/i);
  assert.match(errors.join(" "), /organization/i);
});
