/**
 * ============================================================
 * File: attendance.routes.js
 * Module: Core Attendance
 *
 * Description:
 * Attendance routes.
 * ============================================================
 */

const express = require("express");
const attendanceController = require("./attendance.controller");

const router = express.Router();

router.get("/", attendanceController.listAttendance);
router.post("/", attendanceController.createAttendance);
router.patch("/:id/close", attendanceController.closeAttendance);

module.exports = router;
