const test = require("node:test");
const assert = require("node:assert/strict");

const { buildTemplateBuffer, parseUploadedWorkbook } = require("../src/utils/bulkImport");

test("buildTemplateBuffer + parseUploadedWorkbook round-trip a template's example row", async () => {
  const headers = ["Name", "Email", "Phone"];
  const exampleRows = [{ Name: "Jane Doe", Email: "jane@example.com", Phone: "555-0100" }];

  const buffer = await buildTemplateBuffer(headers, exampleRows);
  assert.ok(Buffer.isBuffer(buffer) || buffer instanceof Uint8Array);

  const rows = await parseUploadedWorkbook(Buffer.from(buffer));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Name, "Jane Doe");
  assert.equal(rows[0].Email, "jane@example.com");
  assert.equal(rows[0].Phone, "555-0100");
});

test("parseUploadedWorkbook skips fully blank rows but keeps partially-filled ones", async () => {
  const headers = ["Name", "Amount"];
  // A blank row in the middle (simulating a user leaving a gap while editing).
  const buffer = await buildTemplateBuffer(headers, [
    { Name: "Row One", Amount: 10 },
    { Name: "", Amount: "" },
    { Name: "Row Three", Amount: "" },
  ]);

  const rows = await parseUploadedWorkbook(Buffer.from(buffer));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].Name, "Row One");
  assert.equal(rows[1].Name, "Row Three");
});

test("parseUploadedWorkbook returns an empty array for a workbook with only a header row", async () => {
  const buffer = await buildTemplateBuffer(["Name", "Email"], []);
  const rows = await parseUploadedWorkbook(Buffer.from(buffer));
  assert.equal(rows.length, 0);
});

test("parseUploadedWorkbook preserves numeric values as numbers, not strings", async () => {
  const buffer = await buildTemplateBuffer(["Name", "Price"], [{ Name: "Widget", Price: 12.5 }]);
  const rows = await parseUploadedWorkbook(Buffer.from(buffer));
  assert.equal(typeof rows[0].Price, "number");
  assert.equal(rows[0].Price, 12.5);
});
