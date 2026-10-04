/**
 * ============================================================
 * File: branches.service.js
 * Module: Core Branches
 *
 * Description:
 * Business logic for branch management.
 * ============================================================
 */

const crypto = require("crypto");
const AppError = require("../../utils/AppError");
const { validateCreateBranch, validateUpdateBranch } = require("./branches.validation");
const branchesRepository = require("./branches.repository");
const { isPrivilegedRole, canAccessAllBranches } = require("../../utils/isPrivilegedRole");
const db = require("../../config/db");
const syncService = require("../sync/sync.service");
const syncConfig = require("../sync/sync.config");
const { encodeSetupCode } = require("../sync/setup-code");

const toBranchResponse = (row) => {
    if (!row) {
        return null;
    }

    return {
        id: row.id,
        organizationId: row.organization_id,
        name: row.name,
        code: row.code,
        isHeadquarters: row.is_headquarters,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
};

const listBranches = async (filters = {}, actingUser) => {
    const branches = await branchesRepository.listBranches(filters);

    // A non-privileged caller only ever sees the branches assigned to
    // them — GET /branches is open to every authenticated member (it
    // feeds dropdowns), so the boundary lives here, not on the route.
    // Callers that pass no actingUser (internal lookups like bulk-import
    // code resolution) keep the unfiltered organization list.
    if (actingUser && !canAccessAllBranches(actingUser.role)) {
        const accessible = await getAccessibleBranchesForUser(
            actingUser.id,
            actingUser.branchId ? { id: actingUser.branchId } : null, actingUser.role
        );
        const accessibleIds = new Set(accessible.map((branch) => branch.id));
        return branches.filter((branch) => accessibleIds.has(branch.id)).map(toBranchResponse);
    }

    return branches.map(toBranchResponse);
};

/**
 * The full set of branches a user can act as: their explicit grants via
 * user_branches, or — when none have been set, which is the common case
 * for a single-branch user — just their primary branch. Never empty as
 * long as the user has a primary branch.
 *
 * @param {string} userId User ID.
 * @param {object|null} primaryBranch { id, name, code } for the user's
 *   own branch_id, or null if they have none.
 * @returns {Promise<Array>} { id, name, code } rows.
 */
const getAccessibleBranchesForUser = async (userId, primaryBranch, role) => {
    const granted = await branchesRepository.listAccessibleBranchesForUser(userId);
    const installed = syncConfig.get();
    if (installed?.branchId) {
        const allowed = granted.length ? granted : primaryBranch ? [primaryBranch] : [];
        if (!isPrivilegedRole(role) && !allowed.some((branch) => branch.id === installed.branchId)) return [];
        const branch = await branchesRepository.findBranchById(installed.branchId, installed.organizationId);
        return branch ? [{ id: branch.id, name: branch.name, code: branch.code }] : [];
    }
    if (granted.length > 0) {
        return granted;
    }
    return primaryBranch ? [primaryBranch] : [];
};

const createBranch = async (payload, options = {}) => {
    const validationErrors = validateCreateBranch(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    const client = await db.connect();
    try {
        await client.query("BEGIN");
        const branch = await branchesRepository.createBranch({
            id: crypto.randomUUID(),
            organizationId: payload.organizationId,
            name: payload.name.trim(),
            code: payload.code === undefined ? `BR-${crypto.randomBytes(8).toString("hex").toUpperCase()}` : payload.code.trim(),
            isHeadquarters: payload.isHeadquarters || false,
        }, client);

        const response = toBranchResponse(branch);
        if (options.hubUrl) {
            const enrollment = await syncService.createEnrollCode(payload.organizationId, {
                branchId: branch.id, name: branch.name, createdBy: options.createdBy,
                expiresInMs: 24 * 60 * 60 * 1000, client,
            });
            response.setupCode = encodeSetupCode(options.hubUrl, enrollment.code);
            response.setupCodeExpiresAt = enrollment.expiresAt;
        }
        await client.query("COMMIT");
        return response;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally { client.release(); }
};

const createSetupCode = async (id, organizationId, actingUser, hubUrl) => {
    if (!canAccessAllBranches(actingUser.role)) {
        const accessible = await getAccessibleBranchesForUser(actingUser.id, actingUser.branchId ? { id: actingUser.branchId } : null, actingUser.role);
        if (!accessible.some((branch) => branch.id === id)) throw new AppError("You do not have access to this branch.", 403);
    }
    const enrollment = await syncService.createEnrollCode(organizationId, {
        branchId: id, createdBy: actingUser.id, expiresInMs: 24 * 60 * 60 * 1000, replaceUnused: true,
    });
    return { setupCode: encodeSetupCode(hubUrl, enrollment.code), expiresAt: enrollment.expiresAt, branchId: id };
};

const updateBranch = async (id, organizationId, payload, actingUser) => {
    const validationErrors = validateUpdateBranch(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    // branches:manage lets an admin edit branches, but only ones assigned
    // to them — the same boundary every other branch-scoped write has.
    if (actingUser && !canAccessAllBranches(actingUser.role)) {
        const accessible = await getAccessibleBranchesForUser(
            actingUser.id,
            actingUser.branchId ? { id: actingUser.branchId } : null, actingUser.role
        );
        if (!accessible.some((branch) => branch.id === id)) {
            throw new AppError("You do not have access to this branch.", 403);
        }
    }

    const branch = await branchesRepository.updateBranch(id, organizationId, {
        name: payload.name !== undefined ? String(payload.name).trim() : undefined,
        code: payload.code !== undefined ? String(payload.code).trim() : undefined,
        isHeadquarters: payload.isHeadquarters,
    });

    if (!branch) {
        throw new AppError("Branch not found.", 404);
    }

    return toBranchResponse(branch);
};

module.exports = {
    listBranches,
    createBranch,
    createSetupCode,
    updateBranch,
    getAccessibleBranchesForUser,
};
