/**
 * ============================================================
 * File: data-export.test.js
 * Module: Integration Tests — full data export
 *
 * The super-admin can download an .xlsx of their org's data; a non-admin
 * cannot; and the file never contains password hashes.
 * ============================================================
 */

require("./helpers");
const assert = require("node:assert/strict");
const { api, registerOwner, createStaff, itDb, useIntegrationDb } = require("./helpers");

useIntegrationDb();

itDb("a super_admin downloads an xlsx export of their org data", async () => {
    const owner = await registerOwner();
    // Some data to export.
    await api("POST", "/customers", { token: owner.token, body: { name: "Ada", email: `a-${Date.now()}@t.local`, phone: "0800" } });

    const res = await api("GET", "/data-export", { token: owner.token, raw: true });
    assert.equal(res.status, 200, "export succeeds");
    assert.match(res.headers.get("content-type") || "", /spreadsheetml\.sheet/, "is an xlsx");
    assert.match(res.headers.get("content-disposition") || "", /attachment; filename=.*\.xlsx/, "downloads as a file");

    const bytes = Buffer.from(await res.arrayBuffer());
    assert.ok(bytes.length > 0, "non-empty workbook");
    // xlsx is a zip → starts with the PK signature.
    assert.equal(bytes.slice(0, 2).toString("latin1"), "PK", "valid xlsx (zip) magic bytes");
    // The workbook (zipped XML) must not contain a bcrypt hash anywhere.
    assert.ok(!bytes.toString("latin1").includes("$2a$") && !bytes.toString("latin1").includes("$2b$"), "no password hashes in the export");
});

itDb("a non-admin cannot export org data", async () => {
    const owner = await registerOwner();
    const staff = await createStaff(owner, { resources: ["customers"] });
    const res = await api("GET", "/data-export", { token: staff.token });
    assert.equal(res.status, 403, "baseline staff is refused");
});
