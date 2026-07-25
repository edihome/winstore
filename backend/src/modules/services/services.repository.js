/**
 * ============================================================
 * File: services.repository.js
 * Module: Services
 *
 * Description:
 * SQL repository methods for the service catalog — any service a
 * business offers (a haircut, a house cleaning, a consulting hour),
 * not specific to any one industry. Repositories contain ONLY SQL —
 * no business logic.
 * ============================================================
 */

const pool = require("../../config/db");
const { orderByClause, limitOffsetClause } = require("../../utils/pagination");

const SERVICE_SORTS = { name: "name", price: "price", duration: "duration_minutes", createdAt: "created_at" };

const listServices = async (filters = {}, client = pool) => {
    const { organizationId = "", branchId = "", includeInactive = false, search = "", pagination = null, sort = null } = filters;

    const params = [organizationId, branchId || null, includeInactive, search];
    const order = orderByClause(sort, SERVICE_SORTS, "name ASC");
    const { clause, params: pageParams } = limitOffsetClause(pagination, params.length + 1);

    const result = await client.query(
        `
            SELECT id, organization_id, branch_id, name, description,
                   duration_minutes, price, is_active, created_at, updated_at,
                   COUNT(*) OVER() AS total_count
            FROM services
            WHERE organization_id = $1
              AND ($2::uuid IS NULL OR branch_id = $2 OR branch_id IS NULL)
              AND ($3::boolean = true OR is_active = true)
              AND ($4::text = '' OR name ILIKE '%' || $4 || '%' OR COALESCE(description, '') ILIKE '%' || $4 || '%')
            ${order}${clause}
        `,
        [...params, ...pageParams]
    );

    return result.rows;
};

const findServiceById = async (id, organizationId, client = pool) => {
    const result = await client.query(
        `
            SELECT id, organization_id, branch_id, name, description,
                   duration_minutes, price, is_active, created_at, updated_at
            FROM services
            WHERE id = $1 AND organization_id = $2
            LIMIT 1
        `,
        [id, organizationId]
    );

    return result.rows[0] || null;
};

const createService = async (data, client = pool) => {
    const result = await client.query(
        `
            INSERT INTO services
                (id, organization_id, branch_id, name, description, duration_minutes, price, is_active, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
            RETURNING id, organization_id, branch_id, name, description,
                      duration_minutes, price, is_active, created_at, updated_at
        `,
        [
            data.id,
            data.organizationId,
            data.branchId || null,
            data.name,
            data.description || null,
            data.durationMinutes,
            data.price,
            data.isActive !== false,
        ]
    );

    return result.rows[0];
};

const updateService = async (id, organizationId, changes, client = pool) => {
    const result = await client.query(
        `
            UPDATE services
            SET
                name = COALESCE($3, name),
                description = COALESCE($4, description),
                duration_minutes = COALESCE($5, duration_minutes),
                price = COALESCE($6, price),
                is_active = COALESCE($7, is_active),
                updated_at = NOW()
            WHERE id = $1 AND organization_id = $2
            RETURNING id, organization_id, branch_id, name, description,
                      duration_minutes, price, is_active, created_at, updated_at
        `,
        [
            id,
            organizationId,
            changes.name ?? null,
            changes.description ?? null,
            changes.durationMinutes ?? null,
            changes.price ?? null,
            changes.isActive ?? null,
        ]
    );

    return result.rows[0] || null;
};

module.exports = {
    listServices,
    findServiceById,
    createService,
    updateService,
};
