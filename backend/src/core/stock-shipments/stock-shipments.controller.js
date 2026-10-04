/**
 * ============================================================
 * File: stock-shipments.controller.js
 * Module: Core Stock Shipments
 * ============================================================
 */

const stockShipmentsService = require("./stock-shipments.service");
const { success } = require("../../utils/response");
const { canAccessAllBranches } = require("../../utils/isPrivilegedRole");

// Privileged callers (owner/developer) act across any branch; everyone else is
// confined to the branches the branch-scope middleware resolved onto req.user.
const scopeOf = (req) => (canAccessAllBranches(req.user.role) ? null : req.user.accessibleBranchIds || []);

const listShipments = async (req, res) => {
    const result = await stockShipmentsService.listShipments(
        { organizationId: req.user.organizationId, status: req.query.status },
        scopeOf(req)
    );
    return success(res, "Shipments fetched.", result, 200);
};

const shipStock = async (req, res) => {
    const shipment = await stockShipmentsService.shipStock(
        {
            organizationId: req.user.organizationId,
            productId: req.body.productId,
            fromBranchId: req.body.fromBranchId,
            toBranchId: req.body.toBranchId,
            quantity: req.body.quantity,
            reason: req.body.reason,
            shippedBy: req.user.id,
        },
        scopeOf(req)
    );
    return success(res, "Shipment created.", shipment, 201);
};

const receiveShipment = async (req, res) => {
    const shipment = await stockShipmentsService.receiveShipment(
        req.params.id,
        { organizationId: req.user.organizationId, receivedBy: req.user.id },
        scopeOf(req)
    );
    return success(res, "Shipment received.", shipment, 200);
};

const cancelShipment = async (req, res) => {
    const shipment = await stockShipmentsService.cancelShipment(
        req.params.id,
        { organizationId: req.user.organizationId },
        scopeOf(req)
    );
    return success(res, "Shipment cancelled.", shipment, 200);
};

module.exports = { listShipments, shipStock, receiveShipment, cancelShipment };
