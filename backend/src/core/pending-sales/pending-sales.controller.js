/**
 * ============================================================
 * File: pending-sales.controller.js
 * Module: Core Pending Sales
 * ============================================================
 */

const asyncHandler = require("../../utils/asyncHandler");
const AppError = require("../../utils/AppError");
const { success } = require("../../utils/response");
const repository = require("./pending-sales.repository");

const list = asyncHandler(async (req, res) => {
    const rows = await repository.list(req.user.organizationId, req.query.branchId, req.user.id);
    return success(res, "Held sales fetched.", rows, 200);
});

const hold = asyncHandler(async (req, res) => {
    const { branchId, cart } = req.body;
    if (!branchId) {
        throw new AppError("A branch is required.", 400);
    }
    if (!Array.isArray(cart) || cart.length === 0) {
        throw new AppError("The cart is empty — there is nothing to hold.", 400);
    }
    const row = await repository.create({
        organizationId: req.user.organizationId,
        branchId,
        createdBy: req.user.id,
        label: req.body.label,
        itemCount: req.body.itemCount,
        total: req.body.total,
        cart,
        customerId: req.body.customerId,
        discountId: req.body.discountId,
    });
    return success(res, "Sale held.", row, 201);
});

const remove = asyncHandler(async (req, res) => {
    const ok = await repository.remove(req.params.id, req.user.id);
    if (!ok) {
        throw new AppError("Held sale not found.", 404);
    }
    return success(res, "Held sale removed.", { id: req.params.id }, 200);
});

module.exports = { list, hold, remove };
