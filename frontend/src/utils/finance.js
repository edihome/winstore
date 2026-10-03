// The database stores money as NUMERIC(12,2). Work in whole cents while
// validating or previewing a movement so decimal arithmetic stays exact.
export const MAX_MONEY_CENTS = 999_999_999_999;

export function moneyInputToCents(raw, { allowZero = false, label = "Amount" } = {}) {
  if (typeof raw !== "string" && typeof raw !== "number") {
    throw new Error(`${label} must be a number with no more than two decimal places.`);
  }
  const text = String(raw ?? "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
    throw new Error(`${label} must be a number with no more than two decimal places.`);
  }
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > MAX_MONEY_CENTS) {
    throw new Error(`${label} cannot exceed 9,999,999,999.99.`);
  }
  if (cents < 0 || (!allowZero && cents === 0)) {
    throw new Error(`${label} must be greater than zero.`);
  }
  return cents;
}

function requiredName(raw, label) {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name) throw new Error(`${label} is required.`);
  if (name.length > 255) throw new Error(`${label} cannot exceed 255 characters.`);
  return name;
}

export function buildBudgetPayload(form) {
  const name = requiredName(form.name, "Budget name");
  const amount = moneyInputToCents(form.amount) / 100;
  const status = form.status === undefined ? "active" : form.status;
  if (!["active", "inactive"].includes(status)) throw new Error("Choose an active or inactive budget.");
  return { name, amount, status };
}

export function buildCashRegisterPayload(form) {
  const name = requiredName(form.name, "Register name");
  const branchId = typeof form.branchId === "string" ? form.branchId.trim() : "";
  if (!branchId) throw new Error("Choose a branch for this register.");
  const openingInput = form.openingBalance === undefined || (typeof form.openingBalance === "string" && !form.openingBalance.trim()) ? 0 : form.openingBalance;
  const openingBalance = moneyInputToCents(openingInput, {
    allowZero: true,
    label: "Opening balance",
  }) / 100;
  return { name, branchId, openingBalance };
}

export function cashBalanceAfter(currentBalance, transactionType, amount) {
  if (!["inflow", "outflow"].includes(transactionType)) throw new Error("Choose money in or money out.");
  const balanceCents = moneyInputToCents(currentBalance, { allowZero: true, label: "Current balance" });
  const amountCents = moneyInputToCents(amount);
  const nextCents = balanceCents + (transactionType === "outflow" ? -amountCents : amountCents);
  if (nextCents < 0) throw new Error("Money out cannot exceed the register's current balance.");
  if (nextCents > MAX_MONEY_CENTS) throw new Error("This movement would exceed the register's maximum balance.");
  return nextCents / 100;
}

export function buildCashTransactionPayload(form, register) {
  if (!register?.id) throw new Error("Select a register first.");
  if (register.status !== "open") throw new Error("Choose an open register to record a movement.");
  cashBalanceAfter(register.currentBalance, form.transactionType, form.amount);
  const reference = String(form.reference || "").trim();
  if (reference.length > 150) throw new Error("Reference cannot exceed 150 characters.");
  return {
    cashRegisterId: register.id,
    transactionType: form.transactionType,
    amount: moneyInputToCents(form.amount) / 100,
    reference: reference || undefined,
    notes: String(form.notes || "").trim() || undefined,
  };
}

export function sumMoneyAmounts(values) {
  // Historic budgets can be negative; accepting them for display must not
  // relax the positive-amount validation used when creating new records.
  return values.reduce((total, value) => {
    const raw = typeof value === "string" ? value.trim() : value;
    const negative = (typeof raw === "string" && raw.startsWith("-")) || (typeof raw === "number" && raw < 0);
    const magnitude = negative ? (typeof raw === "string" ? raw.slice(1) : -raw) : raw;
    const cents = moneyInputToCents(magnitude, { allowZero: true });
    return total + (negative ? -cents : cents);
  }, 0) / 100;
}
