/**
 * ============================================================
 * File: observability.test.js
 * Module: Integration Tests — request correlation
 *
 * Description:
 * Proves every response carries an X-Request-Id and that error responses
 * echo the same id in their body — so a user can quote it and support can
 * find the matching server-side log line — and that an inbound id is honored
 * for end-to-end tracing.
 * ============================================================
 */

require("./helpers"); // MUST be first — points the app at the test schema.
const assert = require("node:assert/strict");
const { api, itDb, useIntegrationDb } = require("./helpers");

useIntegrationDb();

itDb("every response carries a correlation id, and errors echo it in the body", async () => {
    const health = await api("GET", "/health");
    assert.ok(health.headers.get("x-request-id"), "responses carry an X-Request-Id header");

    // A deliberate validation error flows through the error handler.
    const bad = await api("POST", "/auth/login", { body: {} });
    assert.equal(bad.status, 400);
    assert.ok(bad.body.requestId, "error responses include a requestId in the body");
    assert.equal(bad.body.requestId, bad.headers.get("x-request-id"), "the body id matches the header");
});

itDb("an inbound X-Request-Id is honored for end-to-end tracing", async () => {
    const res = await api("GET", "/health", { headers: { "X-Request-Id": "trace-abc-123" } });
    assert.equal(res.headers.get("x-request-id"), "trace-abc-123");
});
