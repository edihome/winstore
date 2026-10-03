const test = require("node:test");
const assert = require("node:assert/strict");
const { validateCreateReturn } = require("../src/core/sales/sales.validation");

test("a return accepts distinct sale items and numeric quantities", () => {
    assert.deepEqual(validateCreateReturn({
        items: [{ saleItemId: "first", quantity: 1 }, { saleItemId: "second", quantity: "2" }],
        refundMethod: "credit",
    }), []);
});

test("repeated sale items are rejected even when each quantity is individually valid", () => {
    const errors = validateCreateReturn({
        items: [{ saleItemId: "first", quantity: 1 }, { saleItemId: "first", quantity: 1 }],
    });
    assert.match(errors.join(" "), /only appear once/);
});

test("malformed return lines are rejected without throwing", () => {
    for (const item of [null, false, [], "first", {}, { saleItemId: "  ", quantity: 1 }]) {
        assert.ok(validateCreateReturn({ items: [item] }).length > 0, JSON.stringify(item));
    }
});

test("return quantities reject zero, negative, fractional, unsafe and nonnumeric values", () => {
    for (const quantity of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "bad", true, [1], {}, { valueOf: 1, toString: 1 }, null]) {
        const errors = validateCreateReturn({ items: [{ saleItemId: "first", quantity }] });
        assert.match(errors.join(" "), /positive whole number/, JSON.stringify(quantity));
    }
});

test("returns require items and a supported refund method", () => {
    assert.ok(validateCreateReturn({ items: [] }).length > 0);
    assert.match(validateCreateReturn({
        items: [{ saleItemId: "first", quantity: 1 }], refundMethod: "invalid",
    }).join(" "), /refundMethod/);
});
