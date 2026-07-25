/**
 * ============================================================
 * File: appointments.repository.js
 * Module: Appointments
 *
 * Description:
 * SQL repository methods for service appointments — booking a
 * customer, a service from the catalog, and the staff member
 * ("provider") who will perform it. Repositories contain ONLY SQL —
 * no business logic.
 * ============================================================
 */

const pool = require("../../config/db");
const { orderByClause, limitOffsetClause } = require("../../utils/pagination");

const APPOINTMENT_SORTS = {
    scheduledAt: "a.scheduled_at",
    status: "a.status",
    customer: "c.name",
    service: "s.name",
    price: "a.price",
};

const listAppointments = async (filters = {}, client = pool) => {
    const {
        organizationId = "",
        branchId = "",
        providerId = "",
        customerId = "",
        status = "",
        from = "",
        to = "",
        uninvoiced = false,
        pagination = null,
        sort = null,
    } = filters;

    const params = [
        organizationId,
        branchId || null,
        providerId || null,
        status,
        from || null,
        to || null,
        customerId || null,
        uninvoiced,
    ];
    const order = orderByClause(sort, APPOINTMENT_SORTS, "a.scheduled_at ASC");
    const { clause, params: pageParams } = limitOffsetClause(pagination, params.length + 1);

    const result = await client.query(
        `
            SELECT
                a.id, a.organization_id, a.branch_id, a.customer_id, a.provider_id, a.service_id,
                a.scheduled_at, a.duration_minutes, a.price, a.status, a.notes,
                a.created_by, a.created_at, a.updated_at,
                c.name AS customer_name,
                u.first_name AS provider_first_name, u.last_name AS provider_last_name,
                s.name AS service_name,
                COUNT(*) OVER() AS total_count
            FROM appointments a
            INNER JOIN customers c ON c.id = a.customer_id
            INNER JOIN users u ON u.id = a.provider_id
            INNER JOIN services s ON s.id = a.service_id
            LEFT JOIN sale_items si ON si.appointment_id = a.id
            WHERE a.organization_id = $1
              AND ($2::uuid IS NULL OR a.branch_id = $2)
              AND ($3::uuid IS NULL OR a.provider_id = $3)
              AND ($4::text = '' OR a.status = $4)
              AND ($5::timestamptz IS NULL OR a.scheduled_at >= $5)
              AND ($6::timestamptz IS NULL OR a.scheduled_at <= $6)
              AND ($7::uuid IS NULL OR a.customer_id = $7)
              AND ($8::boolean = false OR si.id IS NULL)
            ${order}${clause}
        `,
        [...params, ...pageParams]
    );

    return result.rows;
};

const findAppointmentById = async (id, organizationId, client = pool) => {
    const result = await client.query(
        `
            SELECT id, organization_id, branch_id, customer_id, provider_id, service_id,
                   scheduled_at, duration_minutes, price, status, notes,
                   created_by, created_at, updated_at
            FROM appointments
            WHERE id = $1 AND organization_id = $2
            LIMIT 1
        `,
        [id, organizationId]
    );

    return result.rows[0] || null;
};

/**
 * Find any non-cancelled appointment for the given provider whose time
 * range overlaps [scheduledAt, scheduledAt + durationMinutes). Used to
 * block double-booking before a new appointment is confirmed.
 *
 * @param {object} params { providerId, scheduledAt, durationMinutes, excludeId }
 * @param {object} client Optional pg client.
 * @returns {Promise<object|null>} The conflicting appointment, or null.
 */
const findOverlappingAppointment = async ({ providerId, scheduledAt, durationMinutes, excludeId = null }, client = pool) => {
    const result = await client.query(
        `
            SELECT id, scheduled_at, duration_minutes
            FROM appointments
            WHERE provider_id = $1
              AND status = 'scheduled'
              AND ($4::uuid IS NULL OR id != $4)
              AND scheduled_at < ($2::timestamptz + ($3 || ' minutes')::interval)
              AND (scheduled_at + (duration_minutes || ' minutes')::interval) > $2::timestamptz
            LIMIT 1
        `,
        [providerId, scheduledAt, durationMinutes, excludeId]
    );

    return result.rows[0] || null;
};

const createAppointment = async (data, client = pool) => {
    const result = await client.query(
        `
            INSERT INTO appointments
                (id, organization_id, branch_id, customer_id, provider_id, service_id,
                 scheduled_at, duration_minutes, price, status, notes, created_by, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
            RETURNING id, organization_id, branch_id, customer_id, provider_id, service_id,
                      scheduled_at, duration_minutes, price, status, notes,
                      created_by, created_at, updated_at
        `,
        [
            data.id,
            data.organizationId,
            data.branchId,
            data.customerId,
            data.providerId,
            data.serviceId,
            data.scheduledAt,
            data.durationMinutes,
            data.price,
            data.status || "scheduled",
            data.notes || null,
            data.createdBy,
        ]
    );

    return result.rows[0];
};

const updateAppointmentStatus = async (id, organizationId, status, client = pool) => {
    const result = await client.query(
        `
            UPDATE appointments
            SET status = $3, updated_at = NOW()
            WHERE id = $1 AND organization_id = $2
            RETURNING id, organization_id, branch_id, customer_id, provider_id, service_id,
                      scheduled_at, duration_minutes, price, status, notes,
                      created_by, created_at, updated_at
        `,
        [id, organizationId, status]
    );

    return result.rows[0] || null;
};

module.exports = {
    listAppointments,
    findAppointmentById,
    findOverlappingAppointment,
    createAppointment,
    updateAppointmentStatus,
};
