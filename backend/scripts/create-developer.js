/**
 * ============================================================
 * File: create-developer.js
 * Module: Scripts
 *
 * Description:
 * Promotes an existing user to the reserved "developer" role: full
 * super_admin-equivalent access (see utils/isPrivilegedRole.js),
 * plus cross-organization CRUD on /organizations (see routes/index.js).
 * "developer" is a reserved role name and can't be created through the
 * regular Roles UI/API (see roles.validation.js's RESERVED_ROLE_NAMES),
 * so this script — run directly against the database by whoever
 * operates this deployment, never exposed as an HTTP endpoint — is the
 * only way to provision one.
 *
 * Usage: node scripts/create-developer.js <user-email>
 * ============================================================
 */

const crypto = require("crypto");
const pool = require("../src/config/db");
const authRepository = require("../src/core/auth/auth.repository");
const rolesRepository = require("../src/core/roles/roles.repository");
const permissionsRepository = require("../src/core/permissions/permissions.repository");
const { MODULE_RESOURCE_VALUES } = require("../src/core/permissions/permissions.catalog");

const DEVELOPER_ROLE_NAME = "developer";

const run = async () => {
    const email = process.argv[2];
    if (!email) {
        console.error("Usage: node scripts/create-developer.js <user-email>");
        process.exitCode = 1;
        return;
    }

    // Runs standalone against the DB with no HTTP request context; it reads a
    // user by email across orgs and writes roles/permissions, so it bypasses
    // row level security (see config/db.runPrivileged).
    await pool.runPrivileged(async () => {
    const user = await authRepository.findUserByEmail(email);
    if (!user) {
        console.error(`No user found with email "${email}".`);
        process.exitCode = 1;
        return;
    }

    if (user.role_name === DEVELOPER_ROLE_NAME) {
        console.log(`"${email}" is already a developer.`);
        return;
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const existingRoles = await rolesRepository.listRoles({ organizationId: user.organization_id }, client);
        let developerRole = existingRoles.find((role) => role.name === DEVELOPER_ROLE_NAME);

        if (!developerRole) {
            developerRole = await rolesRepository.createRole(
                {
                    id: crypto.randomUUID(),
                    organizationId: user.organization_id,
                    name: DEVELOPER_ROLE_NAME,
                    description: "Platform operator — full access plus cross-organization CRUD on /organizations.",
                    isSystem: true,
                },
                client
            );

            // Cosmetic only — the role-name bypass in isPrivilegedRole.js
            // doesn't actually consult these rows, but granting them keeps
            // the Roles UI's "N modules granted" count truthful instead of
            // showing 0 for a role that in practice grants everything.
            const permissions = await permissionsRepository.findPermissionsByResources(
                user.organization_id,
                MODULE_RESOURCE_VALUES,
                "manage",
                client
            );
            await rolesRepository.setRolePermissions(
                developerRole.id,
                permissions.map((permission) => permission.id),
                client
            );
        }

        await client.query(`UPDATE users SET role_id = $1, updated_at = NOW() WHERE id = $2`, [
            developerRole.id,
            user.id,
        ]);

        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }

    console.log(`"${email}" is now a developer.`);
    console.log("They must log out and back in — the role name is embedded in their session token and only refreshes at login.");
    });
};

run()
    .catch((error) => {
        console.error("Failed to create developer:", error);
        process.exitCode = 1;
    })
    .finally(() => {
        pool.end();
    });
