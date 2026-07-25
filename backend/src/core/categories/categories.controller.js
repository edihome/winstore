/**
 * ============================================================
 * File: categories.controller.js
 * Module: Core Categories
 *
 * Description:
 * HTTP controller for category endpoints.
 * ============================================================
 */

const categoriesService = require("./categories.service");
const { success } = require("../../utils/response");

/**
 * Handle category listing requests.
 *
 * @param {object} req Express request.
 * @param {object} res Express response.
 * @returns {Promise<object>} JSON response.
 */
const listCategories = async (req, res) => {
    const categories = await categoriesService.listCategories(req.query);
    return success(res, "Categories fetched successfully.", categories, 200);
};

/**
 * Handle category creation requests.
 *
 * @param {object} req Express request.
 * @param {object} res Express response.
 * @returns {Promise<object>} JSON response.
 */
const createCategory = async (req, res) => {
    const category = await categoriesService.createCategory(req.body);
    return success(res, "Category created successfully.", category, 201);
};

module.exports = {
    listCategories,
    createCategory,
};
