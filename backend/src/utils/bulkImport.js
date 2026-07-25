/**
 * ============================================================
 * File: bulkImport.js
 * Module: Shared Utilities
 *
 * Description:
 * Generic Excel (.xlsx) template generation and row parsing, shared
 * by every resource's bulk-import routes (see bulkImportHandlers.js).
 * Only handles the spreadsheet <-> plain-object translation — each
 * resource's own existing service.createX function still does the
 * actual validation and persistence, so an imported row is checked
 * exactly the same way a manually-submitted form is.
 * ============================================================
 */

const ExcelJS = require("exceljs");

/**
 * Build a downloadable .xlsx template: a bold header row plus whatever
 * example rows the caller supplies, showing the expected format.
 *
 * @param {string[]} headers Column headers, in order.
 * @param {object[]} exampleRows Example rows, keyed by header.
 * @returns {Promise<Buffer>} .xlsx file contents.
 */
const buildTemplateBuffer = async (headers, exampleRows = []) => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Template");

    worksheet.columns = headers.map((header) => ({
        header,
        key: header,
        width: Math.max(18, header.length + 4),
    }));
    worksheet.getRow(1).font = { bold: true };

    exampleRows.forEach((row) => worksheet.addRow(row));

    return workbook.xlsx.writeBuffer();
};

/**
 * Coerce an ExcelJS cell value into a plain string/number-friendly
 * value — cells can come back as Date objects, formula results, or
 * "rich text" objects depending on how the file was authored, not just
 * plain strings/numbers.
 *
 * @param {*} value Raw ExcelJS cell value.
 * @returns {*} Plain value.
 */
const plainCellValue = (value) => {
    if (value === null || value === undefined) {
        return "";
    }
    if (typeof value === "object") {
        if (Array.isArray(value.richText)) {
            return value.richText.map((part) => part.text).join("");
        }
        if (value.result !== undefined) {
            return value.result;
        }
        if (value instanceof Date) {
            return value;
        }
        if (value.text !== undefined) {
            return value.text;
        }
    }
    return value;
};

/**
 * Parse an uploaded .xlsx file's first worksheet into an array of plain
 * row objects, keyed by the header row. Fully blank rows are skipped.
 *
 * @param {Buffer} buffer Uploaded file contents.
 * @returns {Promise<object[]>} Parsed rows.
 */
const parseUploadedWorkbook = async (buffer) => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
        return [];
    }

    const headers = [];
    worksheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
        headers[colNumber] = String(plainCellValue(cell.value)).trim();
    });

    const rows = [];
    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) {
            return;
        }

        const parsed = {};
        let hasValue = false;
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            const header = headers[colNumber];
            if (!header) {
                return;
            }
            const value = plainCellValue(cell.value);
            if (value !== "" && value !== null && value !== undefined) {
                hasValue = true;
            }
            parsed[header] = value;
        });

        if (hasValue) {
            rows.push(parsed);
        }
    });

    return rows;
};

module.exports = {
    buildTemplateBuffer,
    parseUploadedWorkbook,
};
