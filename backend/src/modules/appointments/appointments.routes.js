/**
 * ============================================================
 * File: appointments.routes.js
 * Module: Appointments
 *
 * Description:
 * Routes for service appointments.
 * ============================================================
 */

const express = require("express");
const controller = require("./appointments.controller");

const router = express.Router();

router.get("/", controller.listAppointments);
router.post("/", controller.createAppointment);
router.patch("/:id/status", controller.updateAppointmentStatus);

module.exports = router;
