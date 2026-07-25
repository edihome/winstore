/**
 * ============================================================
 * File: bulkImportHandlers.js
 * Module: Shared Utilities
 *
 * Description:
 * Generic Express handlers for a resource's "download template" /
 * "bulk import" pair of endpoints. Each resource supplies only what's
 * specific to it — its headers, an example row, and how to turn one
 * spreadsheet row into the payload its own service.createX already
 * expects — so an imported row goes through the exact same validation
 * a manually-submitted form does, with zero duplicated validation logic.
 * ============================================================
 */

const asyncHandler = require("./asyncHandler");
const AppError = require("./AppError");
const { success } = require("./response");
const { buildTemplateBuffer, parseUploadedWorkbook } = require("./bulkImport");

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * @param {string} filename Downloaded file name, e.g. "customers-template.xlsx".
 * @param {string[]} headers Column headers, in order.
 * @param {object[]} exampleRows Example row(s) shown in the template.
 * @returns {Function} Express handler.
 */
const createTemplateHandler = (filename, headers, exampleRows) =>
    asyncHandler(async (req, res) => {
        const buffer = await buildTemplateBuffer(headers, exampleRows);
        res.setHeader("Content-Type", XLSX_CONTENT_TYPE);
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.send(Buffer.from(buffer));
    });

/**
 * @param {Function} mapRow (row, req) => payload for createOne. May be
 *   async (e.g. resolving a branch code or category name to an id) and
 *   may throw to reject the row with a specific message — the thrown
 *   error's `.message` is what shows up next to that row number.
 * @param {Function} createOne (payload, req) => Promise — the resource's
 *   own existing service.createX, so validation is never duplicated.
 *   Its resolved value is included in the per-row result when truthy
 *   and not itself an error, letting e.g. a generated temp password be
 *   surfaced back to whoever ran the import.
 * @returns {Function} Express handler.
 */
const createBulkImportHandler = (mapRow, createOne) =>
    asyncHandler(async (req, res) => {
        if (!req.file) {
            throw new AppError("No file uploaded — attach an .xlsx file as 'file'.", 400);
        }

        const rows = await parseUploadedWorkbook(req.file.buffer);
        if (rows.length === 0) {
            throw new AppError("The uploaded file has no data rows.", 400);
        }

        const failed = [];
        const created = [];

        for (let index = 0; index < rows.length; index += 1) {
            const rowNumber = index + 2; // header is row 1, data starts at row 2
            try {
                const payload = await mapRow(rows[index], req);
                const result = await createOne(payload, req);
                created.push({ row: rowNumber, result });
            } catch (error) {
                failed.push({ row: rowNumber, error: error.message || "Unknown error." });
            }
        }

        const total = rows.length;
        return success(
            res,
            `Imported ${created.length} of ${total} row${total === 1 ? "" : "s"}.`,
            { createdCount: created.length, total, created, failed },
            failed.length > 0 && created.length === 0 ? 400 : 200
        );
    });

module.exports = {
    createTemplateHandler,
    createBulkImportHandler,
};
