/**
 * ============================================================
 * File: purchases.validation.js
 * Module: Core Purchases
 *
 * Description:
 * Validation rules and constants for purchase endpoints. Unlike
 * sales, unit costs ARE taken from the client — a purchase price
 * is negotiated with the supplier, not read from the catalog —
 * so they're validated as non-negative numbers here.
 * ============================================================
 */

const { isNonEmptyString } = require("../../utils/validators");

const PURCHASE_STATUSES = Object.freeze({
    PENDING: "pending",
    RECEIVED: "received",
    CANCELLED: "cancelled",
});

const PURCHASE_STATUS_VALUES = Object.freeze(Object.values(PURCHASE_STATUSES));

const validateCreatePurchase = (payload = {}) => {
    const errors = [];

    if (!isNonEmptyString(String(payload.supplierId || ""))) {
        errors.push("Supplier ID is required.");
    }

    if (!isNonEmptyString(String(payload.branchId || ""))) {
        errors.push("Branch ID is required.");
    }

    if (!isNonEmptyString(String(payload.organizationId || ""))) {
        errors.push("Organization ID is required.");
    }

    if (!Array.isArray(payload.items) || payload.items.length === 0) {
        errors.push("At least one item is required on a purchase.");
        return errors;
    }

    payload.items.forEach((item, index) => {
        if (!isNonEmptyString(String(item.productId || ""))) {
            errors.push(`Item ${index + 1}: productId is required.`);
        }

        const quantity = Number(item.quantity);
        if (!Number.isInteger(quantity) || quantity <= 0) {
            errors.push(`Item ${index + 1}: quantity must be a positive whole number.`);
        }

        const unitCost = Number(item.unitCost);
        const unitCostProvided = isNonEmptyString(String(item.unitCost ?? ""));
        if (!unitCostProvided || !Number.isFinite(unitCost) || unitCost < 0) {
            errors.push(`Item ${index + 1}: unitCost must be a non-negative number.`);
        }

        if (item.expiryDate && Number.isNaN(Date.parse(item.expiryDate))) {
            errors.push(`Item ${index + 1}: expiryDate must be a valid date.`);
        }
    });

    return errors;
};

const validateUpdatePurchaseStatus = (payload = {}) => {
    const errors = [];

    // Only the two outcomes are settable; a purchase is born "pending".
    if (![PURCHASE_STATUSES.RECEIVED, PURCHASE_STATUSES.CANCELLED].includes(payload.status)) {
        errors.push(`Status must be one of: ${PURCHASE_STATUSES.RECEIVED}, ${PURCHASE_STATUSES.CANCELLED}.`);
    }

    return errors;
};

module.exports = {
    PURCHASE_STATUSES,
    PURCHASE_STATUS_VALUES,
    validateCreatePurchase,
    validateUpdatePurchaseStatus,
};
