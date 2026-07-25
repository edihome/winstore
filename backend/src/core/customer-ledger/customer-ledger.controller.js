/**
 * ============================================================
 * File: customer-ledger.controller.js
 * Module: Core Customer Ledger
 *
 * Description:
 * HTTP handlers for a customer's credit ledger, mounted under
 * /customers/:id/ledger (see customers.routes.js).
 * ============================================================
 */

const asyncHandler = require("../../utils/asyncHandler");
const AppError = require("../../utils/AppError");
const { success } = require("../../utils/response");
const { parsePagination, parseSort, buildPageMeta } = require("../../utils/pagination");
const { isAdminUser } = require("../../utils/isAdminUser");
const ledgerService = require("./customer-ledger.service");

const getLedger = asyncHandler(async (req, res) => {
    const pagination = parsePagination(req.query);
    const statement = await ledgerService.getStatement(req.params.id, req.user.organizationId, {
        pagination,
        sort: parseSort(req.query),
    });
    const data = { balance: statement.balance, entries: statement.entries };
    if (pagination) {
        data.pagination = buildPageMeta(pagination, statement.total);
    }
    return success(res, "Customer ledger fetched successfully.", data, 200);
});

const recordEntry = asyncHandler(async (req, res) => {
    if (req.body.entryType === "adjustment" && !isAdminUser(req.user)) {
        throw new AppError("Only an admin can post a manual adjustment.", 403);
    }
    const entry = await ledgerService.recordManualEntry(
        req.params.id,
        req.user.organizationId,
        req.body,
        req.user.id
    );
    return success(res, "Ledger entry recorded successfully.", entry, 201);
});

module.exports = { getLedger, recordEntry };
