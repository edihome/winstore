// NUMERIC(12,2) amounts are validated before coercion and calculated in cents.
const MAX_MONEY_CENTS = 999999999999;

const moneyToCents = (value) => {
    if (typeof value !== "number" && typeof value !== "string") return null;
    const text = String(value).trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
    const [whole, fraction = ""] = text.split(".");
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    return Number.isSafeInteger(cents) && cents <= MAX_MONEY_CENTS ? cents : null;
};

module.exports = { moneyToCents, MAX_MONEY_CENTS };
