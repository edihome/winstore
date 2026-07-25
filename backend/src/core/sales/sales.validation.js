/**
 * ============================================================
 * File: sales.validation.js
 * Module: Core Sales
 *
 * Description:
 * Validation rules and constants for checkout. Prices are never
 * trusted from the client — only which items and quantities were
 * selected — so validation here checks shape, not amounts.
 * ============================================================
 */

const { isNonEmptyString } = require("../../utils/validators");

const SALE_ITEM_TYPE_VALUES = ["product", "service"];
// Methods stored on a payment row (money actually collected).
const PAYMENT_METHODS = ["cash", "card", "transfer", "other"];
// Valid tenders at checkout — the collected methods PLUS "credit" (put on the
// customer's account). A credit tender is never stored as a payment; it
// becomes a charge on the customer's ledger (see sales.service).
const TENDER_METHODS = [...PAYMENT_METHODS, "credit"];

const validateCreateSale = (payload = {}) => {
    const errors = [];

    if (payload.customerId !== undefined && !isNonEmptyString(String(payload.customerId || ""))) {
        errors.push("customerId must be a non-empty ID when provided.");
    }

    if (!isNonEmptyString(String(payload.branchId || ""))) {
        errors.push("branchId is required.");
    }

    if (payload.paymentMethod !== undefined && !TENDER_METHODS.includes(payload.paymentMethod)) {
        errors.push(`paymentMethod must be one of: ${TENDER_METHODS.join(", ")}.`);
    }

    // Split tender: an array of { method, amount } tenders. Deeper rules
    // (must cover the total, non-cash can't overpay, change) live in
    // sales.service.resolveTenders; here we just check the shape.
    let hasCredit = payload.paymentMethod === "credit";
    if (payload.payments !== undefined) {
        if (!Array.isArray(payload.payments) || payload.payments.length === 0) {
            errors.push("payments must be a non-empty array of tenders.");
        } else {
            payload.payments.forEach((tender, index) => {
                if (!TENDER_METHODS.includes(tender?.method)) {
                    errors.push(`Payment ${index + 1}: method must be one of ${TENDER_METHODS.join(", ")}.`);
                }
                if (tender?.method === "credit") {
                    hasCredit = true;
                }
                if (!Number.isFinite(Number(tender?.amount)) || Number(tender.amount) <= 0) {
                    errors.push(`Payment ${index + 1}: amount must be greater than zero.`);
                }
            });
        }
    }

    // Selling on credit puts the amount on someone's account — there must be
    // a customer to charge; you can't sell to a walk-in on credit.
    if (hasCredit && !isNonEmptyString(String(payload.customerId || ""))) {
        errors.push("A customer is required to sell on credit.");
    }

    if (payload.discountId !== undefined && !isNonEmptyString(String(payload.discountId || ""))) {
        errors.push("discountId must be a non-empty ID when provided.");
    }

    if (!Array.isArray(payload.items) || payload.items.length === 0) {
        errors.push("At least one item is required to check out.");
        return errors;
    }

    payload.items.forEach((item, index) => {
        if (!SALE_ITEM_TYPE_VALUES.includes(item.itemType)) {
            errors.push(`Item ${index + 1}: itemType must be one of: ${SALE_ITEM_TYPE_VALUES.join(", ")}.`);
            return;
        }

        if (item.itemType === "product") {
            if (!isNonEmptyString(String(item.productId || ""))) {
                errors.push(`Item ${index + 1}: productId is required for product items.`);
            }
            const quantity = Number(item.quantity);
            if (!Number.isInteger(quantity) || quantity <= 0) {
                errors.push(`Item ${index + 1}: quantity must be a positive whole number.`);
            }
        }

        if (item.itemType === "service") {
            // A service line is EITHER a completed appointment being billed
            // (appointmentId) OR a direct catalog service for a walk-in
            // (serviceId) — exactly one, never both.
            const hasAppointment = isNonEmptyString(String(item.appointmentId || ""));
            const hasService = isNonEmptyString(String(item.serviceId || ""));
            if (hasAppointment === hasService) {
                errors.push(
                    `Item ${index + 1}: a service item needs exactly one of appointmentId or serviceId.`
                );
            }
            if (hasService && item.quantity !== undefined) {
                const quantity = Number(item.quantity);
                if (!Number.isInteger(quantity) || quantity <= 0) {
                    errors.push(`Item ${index + 1}: quantity must be a positive whole number.`);
                }
            }
        }
    });

    return errors;
};

module.exports = {
    SALE_ITEM_TYPE_VALUES,
    PAYMENT_METHODS,
    TENDER_METHODS,
    validateCreateSale,
};
