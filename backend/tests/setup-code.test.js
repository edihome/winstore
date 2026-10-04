const test = require("node:test");
const assert = require("node:assert/strict");
const { encodeSetupCode, decodeSetupCode } = require("../src/core/sync/setup-code");
test("setup code keeps the API origin and token, including its port", () => {
    const token = "a".repeat(32);
    assert.deepEqual(decodeSetupCode(encodeSetupCode("https://head-office.example:8443/", token)), { hubUrl: "https://head-office.example:8443", code: token });
});
test("malformed codes and addresses are rejected before network access", () => {
    for (const value of [null, {}, "", "WSB2.e30", "WSB1.e30", "WSB1." + "a".repeat(9000)]) assert.throws(() => decodeSetupCode(value));
    for (const url of ["file:///secret", "https://user:password@example.com", "https://example.com/path", "https://example.com?q=1"]) assert.throws(() => encodeSetupCode(url, "a".repeat(32)));
});
