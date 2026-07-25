/**
 * ============================================================
 * File: appointments.service.js
 * Module: Appointments
 *
 * Description:
 * Business logic for booking and managing service appointments —
 * generic to any service-based business, not any one industry.
 * ============================================================
 */

const crypto = require("crypto");
const AppError = require("../../utils/AppError");
const { assertBranchAccessible } = require("../../utils/assertBranchAccessible");
const appointmentsRepository = require("./appointments.repository");
const { totalFromRows } = require("../../utils/pagination");
const servicesRepository = require("../services/services.repository");
const customersRepository = require("../../core/customers/customers.repository");
const usersRepository = require("../../core/users/users.repository");
const {
    validateCreateAppointment,
    validateUpdateAppointmentStatus,
} = require("./appointments.validation");

// Map of allowed status -> statuses it may transition to. Once an
// appointment reaches a terminal status (an empty array here), it can no
// longer transition.
const ALLOWED_STATUS_TRANSITIONS = {
    scheduled: ["completed", "cancelled", "no_show"],
    completed: [],
    cancelled: [],
    no_show: [],
};

/**
 * @param {object} row Raw appointments row, optionally joined with
 *   customer/provider/service names (from listAppointments).
 * @returns {object} API-shaped appointment.
 */
const toAppointmentResponse = (row) => {
    if (!row) {
        return null;
    }

    const mapped = {
        id: row.id,
        organizationId: row.organization_id,
        branchId: row.branch_id,
        customerId: row.customer_id,
        providerId: row.provider_id,
        serviceId: row.service_id,
        scheduledAt: row.scheduled_at,
        durationMinutes: row.duration_minutes,
        price: Number(row.price),
        status: row.status,
        notes: row.notes,
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };

    // These fields are only present when the row came from the joined
    // list query — keep them optional rather than forcing every caller
    // to pass placeholders.
    if (row.customer_name !== undefined) {
        mapped.customerName = row.customer_name;
    }
    if (row.provider_first_name !== undefined) {
        mapped.providerName = `${row.provider_first_name} ${row.provider_last_name}`.trim();
    }
    if (row.service_name !== undefined) {
        mapped.serviceName = row.service_name;
    }

    return mapped;
};

const listAppointments = async (filters = {}) => {
    const rows = await appointmentsRepository.listAppointments(filters);
    const items = rows.map(toAppointmentResponse);
    if (filters.pagination) {
        return { items, total: totalFromRows(rows) };
    }
    return items;
};

const createAppointment = async (payload, actingUserId) => {
    const validationErrors = validateCreateAppointment(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    // Snapshot duration/price from the service catalog at booking time —
    // see the comment on the appointments migration for why.
    const service = await servicesRepository.findServiceById(
        payload.serviceId,
        payload.organizationId
    );
    if (!service || !service.is_active) {
        throw new AppError("The selected service is not available.", 400);
    }

    // Customer and provider must belong to this organization too — the
    // service was already org-checked above, but these two references
    // were trusted straight from the request body, so a booking could
    // name another tenant's customer or a provider outside the org.
    const customer = await customersRepository.findCustomerById(payload.customerId, payload.organizationId);
    if (!customer) {
        throw new AppError("The selected customer was not found for this organization.", 400);
    }

    const provider = await usersRepository.findUserById(payload.providerId, payload.organizationId);
    if (!provider) {
        throw new AppError("The selected provider was not found for this organization.", 400);
    }

    const scheduledAt = new Date(payload.scheduledAt);

    // Enforce: a provider cannot be double-booked. This is the concrete
    // business rule this vertical slice is meant to prove out end-to-end.
    const conflict = await appointmentsRepository.findOverlappingAppointment({
        providerId: payload.providerId,
        scheduledAt,
        durationMinutes: service.duration_minutes,
    });
    if (conflict) {
        throw new AppError(
            "This provider already has an appointment that overlaps with the requested time.",
            409
        );
    }

    const row = await appointmentsRepository.createAppointment({
        id: crypto.randomUUID(),
        organizationId: payload.organizationId,
        branchId: payload.branchId,
        customerId: payload.customerId,
        providerId: payload.providerId,
        serviceId: payload.serviceId,
        scheduledAt,
        durationMinutes: service.duration_minutes,
        price: service.price,
        notes: payload.notes,
        createdBy: actingUserId,
    });

    return toAppointmentResponse(row);
};

const updateAppointmentStatus = async (id, organizationId, payload, accessibleBranchIds = null) => {
    const validationErrors = validateUpdateAppointmentStatus(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    const existing = await appointmentsRepository.findAppointmentById(id, organizationId);
    if (!existing) {
        throw new AppError("Appointment not found.", 404);
    }
    assertBranchAccessible(existing.branch_id, accessibleBranchIds, "Appointment not found.");

    const allowedNextStatuses = ALLOWED_STATUS_TRANSITIONS[existing.status] || [];
    if (!allowedNextStatuses.includes(payload.status)) {
        throw new AppError(
            `Cannot move an appointment from "${existing.status}" to "${payload.status}".`,
            409
        );
    }

    const row = await appointmentsRepository.updateAppointmentStatus(id, organizationId, payload.status);
    return toAppointmentResponse(row);
};

module.exports = {
    listAppointments,
    createAppointment,
    updateAppointmentStatus,
};
