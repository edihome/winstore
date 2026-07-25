/**
 * ============================================================
 * File: attendance.repository.js
 * Module: Core Attendance
 *
 * Description:
 * SQL repository methods for staff movement tracking. Each row is one
 * in-store session: opened by a check-in, closed by a check-out. A row
 * with no check_out_time is still open — the staff member is currently
 * in the store.
 * ============================================================
 */

const pool = require("../../config/db");

const listAttendance = async (filters = {}, client = pool) => {
    const { organizationId = "", userId = "", from = "", to = "", branchIds = null } = filters;

    const result = await client.query(
        `
            SELECT
                a.id, a.organization_id, a.user_id, a.check_in_time, a.check_out_time, a.status, a.created_at,
                u.first_name, u.last_name
            FROM attendance a
            LEFT JOIN users u ON u.id = a.user_id
            WHERE ($1::text = '' OR a.organization_id = $1::uuid)
              AND ($2::text = '' OR a.user_id = $2::uuid)
              AND ($3::text = '' OR a.created_at >= $3::date)
              AND ($4::text = '' OR a.created_at < ($4::date + INTERVAL '1 day'))
              AND ($5::uuid[] IS NULL OR u.branch_id = ANY($5::uuid[]))
            ORDER BY a.created_at DESC
        `,
        [organizationId, userId, from, to, branchIds]
    );

    return result.rows;
};

const findAttendanceById = async (id, organizationId, client = pool) => {
    const result = await client.query(
        `
            SELECT
                a.id, a.organization_id, a.user_id, a.check_in_time, a.check_out_time, a.status, a.created_at,
                u.branch_id AS user_branch_id
            FROM attendance a
            LEFT JOIN users u ON u.id = a.user_id
            WHERE a.id = $1 AND a.organization_id = $2
            LIMIT 1
        `,
        [id, organizationId]
    );

    return result.rows[0] || null;
};

/**
 * Fetch the most recent attendance entry for a user, restricted to today.
 * Used by the kiosk toggle to decide whether the next action is a
 * check-in (no row yet, or the latest row is already closed) or a
 * check-out (the latest row has no check_out_time — still open).
 */
const findLatestAttendanceForToday = async (userId, client = pool) => {
    const result = await client.query(
        `
            SELECT id, organization_id, user_id, check_in_time, check_out_time, status, created_at
            FROM attendance
            WHERE user_id = $1
              AND created_at >= date_trunc('day', NOW())
            ORDER BY created_at DESC
            LIMIT 1
        `,
        [userId]
    );

    return result.rows[0] || null;
};

const createAttendance = async (attendanceData, client = pool) => {
    const result = await client.query(
        `
            INSERT INTO attendance (id, organization_id, user_id, check_in_time, check_out_time, status, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW())
            RETURNING id, organization_id, user_id, check_in_time, check_out_time, status, created_at
        `,
        [
            attendanceData.id,
            attendanceData.organizationId,
            attendanceData.userId,
            attendanceData.checkInTime || null,
            attendanceData.checkOutTime || null,
            attendanceData.status || "checked_in",
        ]
    );

    return result.rows[0];
};

/**
 * Close an open session: set its check-out time. Used by both the kiosk
 * toggle (staff closing their own open session) and an admin manually
 * closing a session someone forgot to check out of.
 */
const closeAttendance = async (id, checkOutTime, client = pool) => {
    const result = await client.query(
        `
            UPDATE attendance
            SET check_out_time = $2, status = 'checked_out', updated_at = NOW()
            WHERE id = $1
            RETURNING id, organization_id, user_id, check_in_time, check_out_time, status, created_at
        `,
        [id, checkOutTime]
    );

    return result.rows[0] || null;
};

module.exports = {
    listAttendance,
    findAttendanceById,
    findLatestAttendanceForToday,
    createAttendance,
    closeAttendance,
};
