/**
 * ============================================================
 * File: attendance.service.js
 * Module: Core Attendance
 *
 * Description:
 * Business logic for staff movement tracking. A staff member checks
 * out when stepping away from the store and checks back in on
 * returning — as many times a day as needed. The kiosk toggle (see
 * kioskToggle below) is the one flow that actually drives this: a
 * check-out with no following check-in simply means, in hindsight,
 * that was the staff member's last movement of the day — there's no
 * separate "close for the day" action, the log just reads that way.
 * ============================================================
 */

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const AppError = require("../../utils/AppError");
const { validateCreateAttendance, validateKioskToggle } = require("./attendance.validation");
const db = require("../../config/db");
const attendanceRepository = require("./attendance.repository");
const authRepository = require("../auth/auth.repository");
const usersRepository = require("../users/users.repository");
const branchesService = require("../branches/branches.service");
const { isPrivilegedRole } = require("../../utils/isPrivilegedRole");

const ATTENDANCE_MANAGE_PERMISSION = "attendance:manage";

/**
 * How much of the organization's attendance log the acting user may see
 * or correct — three tiers:
 *  - privileged (super_admin/developer): the whole organization;
 *  - attendance:manage holders (admins): staff of the branches assigned
 *    to them, nothing else;
 *  - everyone else: strictly their own records. Every staff member can
 *    read their own log without any role grant at all — GET /attendance
 *    is open to any authenticated member and it's THIS scoping, not the
 *    route, that decides what comes back (see routes/index.js).
 *
 * @param {object} actingUser req.user of whoever is asking.
 * @returns {Promise<{branchIds: string[]|null, selfOnly: boolean}>}
 */
const resolveAttendanceScope = async (actingUser) => {
    if (isPrivilegedRole(actingUser.role)) {
        return { branchIds: null, selfOnly: false };
    }

    if ((actingUser.permissions || []).includes(ATTENDANCE_MANAGE_PERMISSION)) {
        const primaryBranch = actingUser.branchId ? { id: actingUser.branchId } : null;
        const branches = await branchesService.getAccessibleBranchesForUser(actingUser.id, primaryBranch);
        return { branchIds: branches.map((branch) => branch.id), selfOnly: false };
    }

    return { branchIds: null, selfOnly: true };
};

const toAttendanceResponse = (row) => {
    if (!row) {
        return null;
    }

    return {
        id: row.id,
        organizationId: row.organization_id,
        userId: row.user_id,
        staffName: row.first_name || row.last_name ? `${row.first_name || ""} ${row.last_name || ""}`.trim() : null,
        checkInTime: row.check_in_time,
        checkOutTime: row.check_out_time,
        status: row.status,
        isOpen: Boolean(row.check_in_time) && !row.check_out_time,
        createdAt: row.created_at,
    };
};

const listAttendance = async (filters = {}, actingUser) => {
    const scope = await resolveAttendanceScope(actingUser);
    const scopedFilters = scope.selfOnly
        ? { ...filters, userId: actingUser.id }
        : { ...filters, branchIds: scope.branchIds };

    const rows = await attendanceRepository.listAttendance(scopedFilters);
    return rows.map(toAttendanceResponse);
};

/**
 * Admin-entered attendance record — a manual correction/backfill path,
 * distinct from the kiosk toggle staff use day-to-day.
 */
const createAttendance = async (payload, actingUser) => {
    const validationErrors = validateCreateAttendance(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    // The route already requires attendance:manage for writes; this keeps
    // an admin's corrections inside their own branches, same boundary as
    // the read side.
    const scope = await resolveAttendanceScope(actingUser);
    if (scope.selfOnly) {
        throw new AppError("You do not have permission to perform this action.", 403);
    }
    if (scope.branchIds !== null) {
        const targetUser = await usersRepository.findUserById(payload.userId, payload.organizationId);
        if (!targetUser) {
            throw new AppError("The selected staff member was not found.", 400);
        }
        if (!targetUser.branch_id || !scope.branchIds.includes(targetUser.branch_id)) {
            throw new AppError("You can only manage attendance for staff in branches assigned to you.", 403);
        }
    }

    const attendance = await attendanceRepository.createAttendance({
        id: crypto.randomUUID(),
        organizationId: payload.organizationId,
        userId: payload.userId,
        checkInTime: payload.checkInTime || null,
        checkOutTime: payload.checkOutTime || null,
        status: payload.status || "checked_in",
    });

    return toAttendanceResponse(attendance);
};

/**
 * Manually close an open session — an admin fixing a forgotten
 * check-out. Refuses to touch a session that's already closed or
 * doesn't belong to this organization.
 */
const closeAttendance = async (id, organizationId, actingUser) => {
    const existing = await attendanceRepository.findAttendanceById(id, organizationId);
    if (!existing) {
        throw new AppError("Attendance record not found.", 404);
    }
    if (existing.check_out_time) {
        throw new AppError("This session is already closed.", 409);
    }

    const scope = await resolveAttendanceScope(actingUser);
    if (scope.selfOnly) {
        throw new AppError("You do not have permission to perform this action.", 403);
    }
    if (
        scope.branchIds !== null &&
        (!existing.user_branch_id || !scope.branchIds.includes(existing.user_branch_id))
    ) {
        throw new AppError("You can only manage attendance for staff in branches assigned to you.", 403);
    }

    const closed = await attendanceRepository.closeAttendance(id, new Date());
    return toAttendanceResponse(closed);
};

/**
 * The kiosk check-in/out action from the login screen — no session is
 * established (no JWT is issued), so a shared front-desk device never
 * ends up "logged in" as whoever last used it. Credentials are verified
 * directly, the same way auth.service.login verifies them, purely to
 * confirm this really is that staff member before logging a movement
 * under their name.
 *
 * Toggle logic: if today's latest session for this user is still open
 * (checked in, no check-out yet), this closes it (check-out). Otherwise
 * — no session yet today, or the latest one is already closed — this
 * opens a new one (check-in). Staff can do this as many times a day as
 * they actually step out and back in.
 *
 * @param {object} payload { email, password }
 * @returns {Promise<object>} { action: "checked_in"|"checked_out", time, staffName }
 */
const kioskToggle = async (payload) => {
    const validationErrors = validateKioskToggle(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    // Public kiosk: identifies the staff member by email across all orgs
    // (no tenant context) and then writes their attendance, so it runs with
    // row level security bypassed (see config/db.runPrivileged).
    return db.runPrivileged(async () => {
        const user = await authRepository.findUserByEmail(payload.email);
        if (!user) {
            throw new AppError("Invalid email or password.", 401);
        }
        if (!user.is_active) {
            throw new AppError("This account has been deactivated.", 403);
        }

        const isPasswordValid = await bcrypt.compare(payload.password, user.password_hash);
        if (!isPasswordValid) {
            throw new AppError("Invalid email or password.", 401);
        }

        const staffName = `${user.first_name} ${user.last_name}`.trim();
        const latest = await attendanceRepository.findLatestAttendanceForToday(user.id);
        const isCurrentlyIn = Boolean(latest) && !latest.check_out_time;

        if (isCurrentlyIn) {
            const closed = await attendanceRepository.closeAttendance(latest.id, new Date());
            return { action: "checked_out", time: closed.check_out_time, staffName };
        }

        const created = await attendanceRepository.createAttendance({
            id: crypto.randomUUID(),
            organizationId: user.organization_id,
            userId: user.id,
            checkInTime: new Date(),
            checkOutTime: null,
            status: "checked_in",
        });
        return { action: "checked_in", time: created.check_in_time, staffName };
    });
};

module.exports = {
    listAttendance,
    createAttendance,
    closeAttendance,
    kioskToggle,
};
