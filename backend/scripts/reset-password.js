/**
 * ============================================================
 * File: reset-password.js
 * Module: Scripts
 *
 * Description:
 * Machine-side password reset — the recovery path when a user (including
 * the organization OWNER / super_admin) is locked out and no one else can
 * reset them from inside the app. Run by whoever operates the deployment,
 * directly on the server; never exposed as an HTTP endpoint. Works fully
 * offline (no email/SMS), which is why it exists: the offline-first shapes
 * can't depend on a delivery channel for a reset link.
 *
 * It sets a random temporary password, forces a change at next login, and
 * signs out every existing session for that user.
 *
 *   node scripts/reset-password.js <user-email>
 *   (or: npm run reset-password -- <user-email>)
 * ============================================================
 */

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const pool = require("../src/config/db");
const authRepository = require("../src/core/auth/auth.repository");
const usersRepository = require("../src/core/users/users.repository");

const run = async () => {
    const email = process.argv[2];
    if (!email) {
        console.error("Usage: node scripts/reset-password.js <user-email>");
        process.exitCode = 1;
        return;
    }

    // Runs standalone with no HTTP request context; it looks a user up by
    // email across orgs and rewrites their credentials, so it bypasses row
    // level security (see config/db.runPrivileged).
    await pool.runPrivileged(async () => {
        const user = await authRepository.findUserByEmail(email);
        if (!user) {
            console.error(`No user found with email "${email}".`);
            process.exitCode = 1;
            return;
        }

        // url-safe, ~12 chars — easy to read out over the phone, still random.
        const temporaryPassword = crypto.randomBytes(9).toString("base64url");
        const passwordHash = await bcrypt.hash(temporaryPassword, 12);

        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            await usersRepository.updatePasswordHash(user.id, user.organization_id, passwordHash, client);
            // Sign out any sessions the account still has (see sessionGuard).
            await usersRepository.bumpTokenVersion(user.id, user.organization_id, client);
            await client.query("COMMIT");
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }

        console.log(`Temporary password for ${email}:  ${temporaryPassword}`);
        console.log("They must change it at next login. All their existing sessions have been signed out.");
    });
};

run()
    .catch((error) => {
        console.error("Failed to reset password:", error);
        process.exitCode = 1;
    })
    .finally(() => {
        pool.end();
    });
