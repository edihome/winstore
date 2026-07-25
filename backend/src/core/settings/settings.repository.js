/**
 * ============================================================
 * File: settings.repository.js
 * Module: Core Settings
 *
 * Description:
 * SQL repository methods for settings management.
 * ============================================================
 */

const pool = require("../../config/db");

const listSettings = async (filters = {}, client = pool) => {
    const { organizationId = "" } = filters;
    const result = await client.query(
        `
            SELECT id, organization_id, key_name, value, created_at, updated_at
            FROM settings
            WHERE ($1::text = '' OR organization_id = $1::uuid)
            ORDER BY created_at DESC
        `,
        [organizationId]
    );

    return result.rows;
};

const createSetting = async (settingData, client = pool) => {
    const result = await client.query(
        `
            INSERT INTO settings (id, organization_id, key_name, value, created_at, updated_at)
            VALUES ($1, $2, $3, $4, NOW(), NOW())
            RETURNING id, organization_id, key_name, value, created_at, updated_at
        `,
        [settingData.id, settingData.organizationId, settingData.key, settingData.value || ""]
    );

    return result.rows[0];
};

/**
 * Set (create or overwrite) one setting for an organization. Relies on
 * the UNIQUE (organization_id, key_name) constraint so a key is updated
 * in place rather than duplicated. The row id defaults from the schema.
 *
 * @param {string} organizationId Owning organization.
 * @param {string} key Setting key_name.
 * @param {string} value New value (stored verbatim).
 * @param {object} client Optional pg client.
 * @returns {Promise<object>} { key_name, value }.
 */
const upsertSetting = async (organizationId, key, value, client = pool) => {
    const result = await client.query(
        `
            INSERT INTO settings (organization_id, key_name, value, created_at, updated_at)
            VALUES ($1, $2, $3, NOW(), NOW())
            ON CONFLICT (organization_id, key_name)
            DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
            RETURNING key_name, value
        `,
        [organizationId, key, value ?? ""]
    );

    return result.rows[0];
};

module.exports = {
    listSettings,
    createSetting,
    upsertSetting,
};
