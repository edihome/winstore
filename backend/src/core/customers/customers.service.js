/**
 * ============================================================
 * File: customers.service.js
 * Module: Core Customers
 *
 * Description:
 * Business logic for customer management.
 * ============================================================
 */

const crypto = require("crypto");
const AppError = require("../../utils/AppError");
const { validateCreateCustomer, validateUpdateCustomer } = require("./customers.validation");
const customersRepository = require("./customers.repository");
const { hardDelete } = require("../../utils/hardDelete");
const { conflictError, expectedVersionOf } = require("../../utils/optimisticLock");
const { totalFromRows } = require("../../utils/pagination");

const toCustomerResponse = (row) => {
    if (!row) {
        return null;
    }

    return {
        id: row.id,
        organizationId: row.organization_id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        status: row.status,
        creditLimit: row.credit_limit === null || row.credit_limit === undefined ? null : Number(row.credit_limit),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        version: row.version,
    };
};

// A customer's credit limit as a number, or null (no limit). Empty string /
// null / undefined all clear to "no limit"; a non-negative number sets it.
const parseCreditLimit = (value) => {
    if (value === undefined || value === null || value === "") {
        return null;
    }
    const limit = Number(value);
    return Number.isFinite(limit) && limit >= 0 ? Math.round(limit * 100) / 100 : null;
};

const listCustomers = async (filters = {}) => {
    const rows = await customersRepository.listCustomers(filters);
    const items = rows.map(toCustomerResponse);
    // When paginating, hand back the total (COUNT(*) OVER()) alongside the page.
    if (filters.pagination) {
        return { items, total: totalFromRows(rows) };
    }
    return items;
};

const createCustomer = async (payload) => {
    const validationErrors = validateCreateCustomer(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    const existing = await customersRepository.findCustomerByEmail(payload.organizationId, payload.email.trim());
    if (existing) {
        throw new AppError("A customer with this email already exists.", 409);
    }

    const customer = await customersRepository.createCustomer({
        id: crypto.randomUUID(),
        organizationId: payload.organizationId,
        name: payload.name.trim(),
        email: payload.email.trim(),
        phone: payload.phone.trim(),
        status: payload.status,
        creditLimit: parseCreditLimit(payload.creditLimit),
    });

    return toCustomerResponse(customer);
};

const updateCustomer = async (id, organizationId, payload) => {
    const validationErrors = validateUpdateCustomer(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    const existing = await customersRepository.findCustomerById(id, organizationId);
    if (!existing) {
        throw new AppError("Customer not found.", 404);
    }

    if (payload.email !== undefined && payload.email.trim().toLowerCase() !== existing.email.toLowerCase()) {
        const emailOwner = await customersRepository.findCustomerByEmail(organizationId, payload.email.trim());
        if (emailOwner) {
            throw new AppError("A customer with this email already exists.", 409);
        }
    }

    const customer = await customersRepository.updateCustomer(
        id,
        organizationId,
        {
            name: payload.name !== undefined ? String(payload.name).trim() : undefined,
            email: payload.email !== undefined ? String(payload.email).trim() : undefined,
            phone: payload.phone !== undefined ? String(payload.phone).trim() : undefined,
            status: payload.status,
            // Provided → set (parseCreditLimit turns "" into null = no limit);
            // absent → leave the existing limit untouched.
            creditLimit: parseCreditLimit(payload.creditLimit),
            creditLimitProvided: payload.creditLimit !== undefined,
        },
        expectedVersionOf(payload)
    );

    // Existed a moment ago, so an empty result means the version guard caught
    // a concurrent change.
    if (!customer) {
        throw conflictError();
    }

    return toCustomerResponse(customer);
};

/**
 * Developer-only hard delete — see backend/src/utils/hardDelete.js.
 * Every other role only ever gets activate/deactivate via updateCustomer.
 */
const deleteCustomer = async (id, organizationId, force = false) => {
    const existing = await customersRepository.findCustomerById(id, organizationId);
    if (!existing) {
        throw new AppError("Customer not found.", 404);
    }

    await hardDelete({ table: "customers", id, force });
};

module.exports = {
    listCustomers,
    createCustomer,
    updateCustomer,
    deleteCustomer,
};
