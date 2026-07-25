/**
 * ============================================================
 * File: products.validation.js
 * Module: Core Products
 *
 * Description:
 * Validation rules and constants for product endpoints.
 * ============================================================
 */

const { isNonEmptyString } = require("../../utils/validators");

const PRODUCT_STATUSES = Object.freeze({
    ACTIVE: "active",
    INACTIVE: "inactive",
});

const PRODUCT_STATUS_VALUES = Object.freeze(Object.values(PRODUCT_STATUSES));

const validateCreateProduct = (payload = {}) => {
    const errors = [];
    const name = String(payload.name || "").trim();
    const sku = String(payload.sku || "").trim();
    const organizationId = String(payload.organizationId || "").trim();

    if (!isNonEmptyString(name)) {
        errors.push("Product name is required.");
    }

    if (!isNonEmptyString(sku)) {
        errors.push("Product SKU is required.");
    }

    if (!isNonEmptyString(organizationId)) {
        errors.push("Organization ID is required.");
    }

    if (payload.price !== undefined && (!Number.isFinite(Number(payload.price)) || Number(payload.price) < 0)) {
        errors.push("Price must be a non-negative number.");
    }

    if (payload.cost !== undefined && (!Number.isFinite(Number(payload.cost)) || Number(payload.cost) < 0)) {
        errors.push("Cost must be a non-negative number.");
    }

    if (payload.barcode !== undefined && payload.barcode !== null && String(payload.barcode).trim() !== "" &&
        !/^[0-9A-Za-z-]{1,64}$/.test(String(payload.barcode).trim())) {
        errors.push("Barcode must be 1-64 letters, numbers, or hyphens.");
    }

    if (payload.openingStock !== undefined && payload.openingStock !== null && String(payload.openingStock).trim() !== "" &&
        (!Number.isInteger(Number(payload.openingStock)) || Number(payload.openingStock) < 0)) {
        errors.push("Opening stock must be a non-negative whole number.");
    }

    return errors;
};

const validateUpdateProduct = (payload = {}) => {
    const errors = [];

    if (payload.name !== undefined && !isNonEmptyString(String(payload.name).trim())) {
        errors.push("Product name cannot be empty.");
    }

    if (payload.price !== undefined && (!Number.isFinite(Number(payload.price)) || Number(payload.price) < 0)) {
        errors.push("Price must be a non-negative number.");
    }

    if (payload.cost !== undefined && (!Number.isFinite(Number(payload.cost)) || Number(payload.cost) < 0)) {
        errors.push("Cost must be a non-negative number.");
    }

    if (payload.barcode !== undefined && payload.barcode !== null && String(payload.barcode).trim() !== "" &&
        !/^[0-9A-Za-z-]{1,64}$/.test(String(payload.barcode).trim())) {
        errors.push("Barcode must be 1-64 letters, numbers, or hyphens.");
    }

    if (payload.status !== undefined && !PRODUCT_STATUS_VALUES.includes(payload.status)) {
        errors.push(`Status must be one of: ${PRODUCT_STATUS_VALUES.join(", ")}.`);
    }

    return errors;
};

module.exports = {
    PRODUCT_STATUSES,
    PRODUCT_STATUS_VALUES,
    validateCreateProduct,
    validateUpdateProduct,
};
