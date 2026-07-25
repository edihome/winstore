/**
 * ============================================================
 * File: suppliers.repository.js
 * Module: Core Suppliers
 *
 * Description:
 * SQL repository methods for supplier management.
 * ============================================================
 */

const pool = require("../../config/db");
const { orderByClause, limitOffsetClause } = require("../../utils/pagination");

const SUPPLIER_SORTS = { name: "name", email: "email", status: "status", createdAt: "created_at" };

const listSuppliers = async (filters = {}, client = pool) => {
    const { organizationId = "", search = "", includeInactive = false, pagination = null, sort = null } = filters;

    const params = [organizationId, includeInactive, search];
    const order = orderByClause(sort, SUPPLIER_SORTS, "name ASC");
    const { clause, params: pageParams } = limitOffsetClause(pagination, params.length + 1);

    const result = await client.query(
        `
            SELECT id, organization_id, name, email, phone, status, created_at, updated_at,
                   COUNT(*) OVER() AS total_count
            FROM suppliers
            WHERE ($1::text = '' OR organization_id = $1::uuid)
              AND ($2::boolean = true OR status = 'active')
              AND ($3::text = '' OR name ILIKE '%' || $3 || '%' OR email ILIKE '%' || $3 || '%')
            ${order}${clause}
        `,
        [...params, ...pageParams]
    );

    return result.rows;
};

const findSupplierById = async (id, organizationId, client = pool) => {
    const result = await client.query(
        `
            SELECT id, organization_id, name, email, phone, status, created_at, updated_at
            FROM suppliers
            WHERE id = $1 AND organization_id = $2
            LIMIT 1
        `,
        [id, organizationId]
    );

    return result.rows[0] || null;
};

const findSupplierByEmail = async (organizationId, email, client = pool) => {
    const result = await client.query(
        `
            SELECT id, organization_id, name, email, phone, status, created_at, updated_at
            FROM suppliers
            WHERE organization_id = $1 AND LOWER(email) = LOWER($2)
            LIMIT 1
        `,
        [organizationId, email]
    );

    return result.rows[0] || null;
};

const createSupplier = async (supplierData, client = pool) => {
    const result = await client.query(
        `
            INSERT INTO suppliers (id, organization_id, name, email, phone, status, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
            RETURNING id, organization_id, name, email, phone, status, created_at, updated_at
        `,
        [
            supplierData.id,
            supplierData.organizationId,
            supplierData.name,
            supplierData.email,
            supplierData.phone,
            supplierData.status || "active",
        ]
    );

    return result.rows[0];
};

const updateSupplier = async (id, organizationId, changes, client = pool) => {
    const result = await client.query(
        `
            UPDATE suppliers
            SET
                name = COALESCE($3, name),
                email = COALESCE($4, email),
                phone = COALESCE($5, phone),
                status = COALESCE($6, status),
                updated_at = NOW()
            WHERE id = $1 AND organization_id = $2
            RETURNING id, organization_id, name, email, phone, status, created_at, updated_at
        `,
        [
            id,
            organizationId,
            changes.name ?? null,
            changes.email ?? null,
            changes.phone ?? null,
            changes.status ?? null,
        ]
    );

    return result.rows[0] || null;
};

module.exports = {
    listSuppliers,
    findSupplierById,
    findSupplierByEmail,
    createSupplier,
    updateSupplier,
};
