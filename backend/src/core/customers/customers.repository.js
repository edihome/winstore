/**
 * ============================================================
 * File: customers.repository.js
 * Module: Core Customers
 *
 * Description:
 * SQL repository methods for customer management.
 * ============================================================
 */

const pool = require("../../config/db");
const { orderByClause, limitOffsetClause } = require("../../utils/pagination");

const CUSTOMER_SORTS = { name: "name", email: "email", status: "status", createdAt: "created_at" };

const listCustomers = async (filters = {}, client = pool) => {
    const { organizationId = "", search = "", includeInactive = false, pagination = null, sort = null } = filters;

    const params = [organizationId, includeInactive, search];
    const order = orderByClause(sort, CUSTOMER_SORTS, "name ASC");
    const { clause, params: pageParams } = limitOffsetClause(pagination, params.length + 1);

    const result = await client.query(
        `
            SELECT id, organization_id, name, email, phone, status, created_at, updated_at, xmin::text AS version, credit_limit,
                   COUNT(*) OVER() AS total_count
            FROM customers
            WHERE ($1::text = '' OR organization_id = $1::uuid)
              AND ($2::boolean = true OR status = 'active')
              AND ($3::text = '' OR name ILIKE '%' || $3 || '%' OR email ILIKE '%' || $3 || '%')
            ${order}${clause}
        `,
        [...params, ...pageParams]
    );

    return result.rows;
};

const findCustomerById = async (id, organizationId, client = pool) => {
    const result = await client.query(
        `
            SELECT id, organization_id, name, email, phone, status, created_at, updated_at, xmin::text AS version, credit_limit
            FROM customers
            WHERE id = $1 AND organization_id = $2
            LIMIT 1
        `,
        [id, organizationId]
    );

    return result.rows[0] || null;
};

const findCustomerByEmail = async (organizationId, email, client = pool) => {
    const result = await client.query(
        `
            SELECT id, organization_id, name, email, phone, status, created_at, updated_at, xmin::text AS version, credit_limit
            FROM customers
            WHERE organization_id = $1 AND LOWER(email) = LOWER($2)
            LIMIT 1
        `,
        [organizationId, email]
    );

    return result.rows[0] || null;
};

const createCustomer = async (customerData, client = pool) => {
    const result = await client.query(
        `
            INSERT INTO customers (id, organization_id, name, email, phone, status, credit_limit, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
            RETURNING id, organization_id, name, email, phone, status, created_at, updated_at, xmin::text AS version, credit_limit
        `,
        [
            customerData.id,
            customerData.organizationId,
            customerData.name,
            customerData.email,
            customerData.phone,
            customerData.status || "active",
            customerData.creditLimit ?? null,
        ]
    );

    return result.rows[0];
};

const updateCustomer = async (id, organizationId, changes, expectedVersion = null, client = pool) => {
    // Optimistic lock — see utils/optimisticLock. Omitting expectedVersion
    // updates as before.
    const params = [
        id,
        organizationId,
        changes.name ?? null,
        changes.email ?? null,
        changes.phone ?? null,
        changes.status ?? null,
        // credit_limit can legitimately be set to NULL ("no limit"), so COALESCE
        // won't do — pass the value ($7) plus a "was it provided" flag ($8) and
        // only overwrite when provided.
        changes.creditLimit ?? null,
        changes.creditLimitProvided === true,
    ];
    let versionClause = "";
    if (expectedVersion !== null) {
        params.push(expectedVersion);
        versionClause = ` AND xmin = $${params.length}::xid`;
    }

    const result = await client.query(
        `
            UPDATE customers
            SET
                name = COALESCE($3, name),
                email = COALESCE($4, email),
                phone = COALESCE($5, phone),
                status = COALESCE($6, status),
                credit_limit = CASE WHEN $8::boolean THEN $7 ELSE credit_limit END,
                updated_at = NOW()
            WHERE id = $1 AND organization_id = $2${versionClause}
            RETURNING id, organization_id, name, email, phone, status, created_at, updated_at, xmin::text AS version, credit_limit
        `,
        params
    );

    return result.rows[0] || null;
};

module.exports = {
    listCustomers,
    findCustomerById,
    findCustomerByEmail,
    createCustomer,
    updateCustomer,
};
