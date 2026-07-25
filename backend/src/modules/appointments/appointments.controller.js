/**
 * ============================================================
 * File: appointments.controller.js
 * Module: Appointments
 *
 * Description:
 * HTTP controller for service appointment endpoints.
 * ============================================================
 */

const asyncHandler = require("../../utils/asyncHandler");
const { success, paginated } = require("../../utils/response");
const { parsePagination, parseSort, buildPageMeta } = require("../../utils/pagination");
const { isPrivilegedRole } = require("../../utils/isPrivilegedRole");
const appointmentsService = require("./appointments.service");

const listAppointments = asyncHandler(async (req, res) => {
    const pagination = parsePagination(req.query);
    const result = await appointmentsService.listAppointments({
        organizationId: req.query.organizationId,
        branchId: req.query.branchId,
        providerId: req.query.providerId,
        customerId: req.query.customerId,
        status: req.query.status,
        from: req.query.from,
        to: req.query.to,
        uninvoiced: req.query.uninvoiced === "true",
        pagination,
        sort: parseSort(req.query),
    });
    if (pagination) {
        return paginated(res, "Appointments fetched successfully.", result.items, buildPageMeta(pagination, result.total));
    }
    return success(res, "Appointments fetched successfully.", result, 200);
});

const createAppointment = asyncHandler(async (req, res) => {
    const appointment = await appointmentsService.createAppointment(req.body, req.user.id);
    return success(res, "Appointment booked successfully.", appointment, 201);
});

const updateAppointmentStatus = asyncHandler(async (req, res) => {
    const accessibleBranchIds = isPrivilegedRole(req.user.role) ? null : req.user.accessibleBranchIds;
    const appointment = await appointmentsService.updateAppointmentStatus(
        req.params.id,
        req.user.organizationId,
        req.body,
        accessibleBranchIds
    );
    return success(res, "Appointment status updated successfully.", appointment, 200);
});

module.exports = {
    listAppointments,
    createAppointment,
    updateAppointmentStatus,
};
