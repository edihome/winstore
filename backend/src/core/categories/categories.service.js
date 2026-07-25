/**
 * ============================================================
 * File: categories.service.js
 * Module: Core Categories
 *
 * Description:
 * Business logic for category management.
 * ============================================================
 */

const crypto = require("crypto");
const AppError = require("../../utils/AppError");
const { CATEGORY_STATUSES, validateCreateCategory } = require("./categories.validation");
const categoriesRepository = require("./categories.repository");

const slugify = (value) =>
    String(value)
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "category";

/**
 * Map a category database row into an API-safe response object.
 *
 * @param {object|null} row Category database row.
 * @returns {object|null} API-safe category object.
 */
const toCategoryResponse = (row) => {
    if (!row) {
        return null;
    }

    return {
        id: row.id,
        organizationId: row.organization_id,
        name: row.name,
        slug: row.slug,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
};

/**
 * List categories using optional filters.
 *
 * @param {object} filters Query filters.
 * @returns {Promise<object[]>} API-safe category records.
 */
const listCategories = async (filters = {}) => {
    const categories = await categoriesRepository.listCategories(filters);
    return categories.map(toCategoryResponse);
};

/**
 * Create a category.
 *
 * @param {object} payload Request body.
 * @returns {Promise<object>} API-safe category record.
 */
const createCategory = async (payload) => {
    const validationErrors = validateCreateCategory(payload);
    if (validationErrors.length > 0) {
        throw new AppError(validationErrors.join(" "), 400);
    }

    const slug = slugify(payload.slug || payload.name);
    const existingCategory = await categoriesRepository.findCategoryBySlug(payload.organizationId, slug);
    if (existingCategory) {
        throw new AppError("A category with this slug already exists.", 409);
    }

    const category = await categoriesRepository.createCategory({
        id: crypto.randomUUID(),
        organizationId: payload.organizationId,
        name: payload.name.trim(),
        slug,
        status: payload.status || CATEGORY_STATUSES.ACTIVE,
    });

    return toCategoryResponse(category);
};

module.exports = {
    listCategories,
    createCategory,
};
