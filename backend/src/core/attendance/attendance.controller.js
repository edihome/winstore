/**
 * ============================================================
 * File: attendance.controller.js
 * Module: Core Attendance
 *
 * Description:
 * HTTP controller for attendance endpoints.
 * ============================================================
 */

const asyncHandler = require("../../utils/asyncHandler");
const { success } = require("../../utils/response");
const attendanceService = require("./attendance.service");

const listAttendance = asyncHandler(async (req, res) => {
    const records = await attendanceService.listAttendance(
        {
            organizationId: req.query.organizationId,
            userId: req.query.userId,
            from: req.query.from,
            to: req.query.to,
        },
        req.user
    );
    return success(res, "Attendance fetched successfully.", records, 200);
});

const createAttendance = asyncHandler(async (req, res) => {
    const record = await attendanceService.createAttendance(req.body, req.user);
    return success(res, "Attendance created successfully.", record, 201);
});

const closeAttendance = asyncHandler(async (req, res) => {
    const record = await attendanceService.closeAttendance(req.params.id, req.user.organizationId, req.user);
    return success(res, "Attendance session closed.", record, 200);
});

// Unauthenticated — see routes/index.js for why this is mounted publicly
// (before the protected /attendance router) instead of living here.
const kioskToggle = asyncHandler(async (req, res) => {
    const result = await attendanceService.kioskToggle(req.body);
    const message = result.action === "checked_in" ? "Checked in successfully." : "Checked out successfully.";
    return success(res, message, result, 200);
});

module.exports = {
    listAttendance,
    createAttendance,
    closeAttendance,
    kioskToggle,
};
