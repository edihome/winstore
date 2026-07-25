/**
 * ============================================================
 * File: users.validation.js
 * Module: Core Users
 *
 * Description:
 * Validation rules for user endpoints.
 * ============================================================
 */

const { isNonEmptyString, isValidEmail } = require("../../utils/validators");

const validateBranchIds = (branchIds) => {
    const errors = [];

    if (branchIds === undefined) {
        return errors;
    }

    if (!Array.isArray(branchIds) || branchIds.some((id) => !isNonEmptyString(String(id || "")))) {
        errors.push("branchIds must be an array of branch IDs.");
    }

    return errors;
};

const validateCreateUser = (payload = {}) => {
    const errors = [];
    const firstName = String(payload.firstName || "").trim();
    const lastName = String(payload.lastName || "").trim();
    const email = String(payload.email || "").trim();
    const password = String(payload.password || "").trim();
    const organizationId = String(payload.organizationId || "").trim();

    if (!isNonEmptyString(firstName)) {
        errors.push("First name is required.");
    }

    if (!isNonEmptyString(lastName)) {
        errors.push("Last name is required.");
    }

    if (!isValidEmail(email)) {
        errors.push("A valid email is required.");
    }

    if (!isNonEmptyString(password) || password.length < 8) {
        errors.push("Password must be at least 8 characters long.");
    }

    if (!isNonEmptyString(organizationId)) {
        errors.push("Organization ID is required.");
    }

    errors.push(...validateBranchIds(payload.branchIds));

    return errors;
};

const validateUpdateUser = (payload = {}) => {
    const errors = [];

    if (payload.firstName !== undefined && !isNonEmptyString(String(payload.firstName).trim())) {
        errors.push("First name cannot be empty.");
    }

    if (payload.lastName !== undefined && !isNonEmptyString(String(payload.lastName).trim())) {
        errors.push("Last name cannot be empty.");
    }

    if (payload.isActive !== undefined && typeof payload.isActive !== "boolean") {
        errors.push("isActive must be true or false.");
    }

    // HR/"vital data" shape checks (only meaningful when a super_admin
    // sends them; the service ignores them otherwise). Salary must be a
    // non-negative number; the two dates must parse.
    if (payload.salary !== undefined && payload.salary !== null && payload.salary !== "") {
        const salary = Number(payload.salary);
        if (!Number.isFinite(salary) || salary < 0) {
            errors.push("Salary must be a non-negative number.");
        }
    }
    for (const [key, label] of [["employmentDate", "Employment date"], ["dateOfBirth", "Date of birth"]]) {
        if (payload[key] !== undefined && payload[key] !== null && payload[key] !== "" && Number.isNaN(Date.parse(payload[key]))) {
            errors.push(`${label} must be a valid date.`);
        }
    }

    errors.push(...validateBranchIds(payload.branchIds));

    return errors;
};

const validateResetPassword = (payload = {}) => {
    const errors = [];
    const newPassword = String(payload.newPassword || "").trim();

    if (!isNonEmptyString(newPassword) || newPassword.length < 8) {
        errors.push("New password must be at least 8 characters long.");
    }

    return errors;
};

module.exports = {
    validateCreateUser,
    validateUpdateUser,
    validateResetPassword,
};
