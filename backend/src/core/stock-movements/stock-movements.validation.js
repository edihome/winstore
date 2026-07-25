/**
 * ============================================================
 * File: stock-movements.validation.js
 * Module: Core Stock Movements
 *
 * Description:
 * Validation rules and constants for stock movement endpoints.
 * ============================================================
 */

const { isNonEmptyString } = require("../../utils/validators");

const STOCK_MOVEMENT_TYPES = Object.freeze({
    IN: "in",
    OUT: "out",
    ADJUSTMENT: "adjustment",
});

const STOCK_MOVEMENT_TYPE_VALUES = Object.freeze(Object.values(STOCK_MOVEMENT_TYPES));

const toInteger = (value) => Number(value);

const isPositiveInteger = (value) => {
    const number = toInteger(value);
    return Number.isInteger(number) && number > 0;
};

const isNonZeroInteger = (value) => {
    const number = toInteger(value);
    return Number.isInteger(number) && number !== 0;
};

/**
 * Validate the payload used to create a stock movement.
 *
 * @param {object} payload Request body.
 * @returns {string[]} Validation error messages.
 */
const validateCreateStockMovement = (payload = {}) => {
    const errors = [];
    const organizationId = String(payload.organizationId || "").trim();
    const branchId = String(payload.branchId || "").trim();
    const productId = String(payload.productId || "").trim();
    const movementType = String(payload.movementType || "").trim();
    const quantityValue = payload.quantityChange ?? payload.quantity;

    if (!isNonEmptyString(organizationId)) {
        errors.push("Organization ID is required.");
    }

    if (!isNonEmptyString(branchId)) {
        errors.push("Branch ID is required.");
    }

    if (!isNonEmptyString(productId)) {
        errors.push("Product ID is required.");
    }

    if (!STOCK_MOVEMENT_TYPE_VALUES.includes(movementType)) {
        errors.push(`Stock movement type must be one of: ${STOCK_MOVEMENT_TYPE_VALUES.join(", ")}.`);
    }

    if (movementType === STOCK_MOVEMENT_TYPES.ADJUSTMENT) {
        if (!isNonZeroInteger(quantityValue)) {
            errors.push("Adjustment quantity change must be a non-zero whole number.");
        }
    } else if (!isPositiveInteger(quantityValue)) {
        errors.push("Stock movement quantity must be a positive whole number.");
    }

    if (payload.expiryDate && Number.isNaN(Date.parse(payload.expiryDate))) {
        errors.push("Expiry date must be a valid date.");
    }

    return errors;
};

/**
 * Validate the payload used to move stock from one branch to another.
 *
 * @param {object} payload Request body.
 * @returns {string[]} Validation error messages.
 */
const validateStockTransfer = (payload = {}) => {
    const errors = [];
    const organizationId = String(payload.organizationId || "").trim();
    const productId = String(payload.productId || "").trim();
    const fromBranchId = String(payload.fromBranchId || "").trim();
    const toBranchId = String(payload.toBranchId || "").trim();

    if (!isNonEmptyString(organizationId)) {
        errors.push("Organization ID is required.");
    }

    if (!isNonEmptyString(productId)) {
        errors.push("Product ID is required.");
    }

    if (!isNonEmptyString(fromBranchId)) {
        errors.push("Source branch is required.");
    }

    if (!isNonEmptyString(toBranchId)) {
        errors.push("Destination branch is required.");
    }

    if (fromBranchId && toBranchId && fromBranchId === toBranchId) {
        errors.push("Source and destination branches must be different.");
    }

    if (!isPositiveInteger(payload.quantity)) {
        errors.push("Transfer quantity must be a positive whole number.");
    }

    return errors;
};

module.exports = {
    STOCK_MOVEMENT_TYPES,
    STOCK_MOVEMENT_TYPE_VALUES,
    validateCreateStockMovement,
    validateStockTransfer,
};
