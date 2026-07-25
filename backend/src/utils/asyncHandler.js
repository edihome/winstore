/**
 * ============================================================
 * File: asyncHandler.js
 * Module: Shared Utilities
 *
 * Description:
 * Wraps asynchronous route handlers and automatically forwards
 * any errors to Express' global error handler.
 *
 * This eliminates the need to write try...catch blocks in every
 * controller.
 *
 * Example:
 *
 * router.get("/", asyncHandler(async (req, res) => {
 *     const users = await UserService.getAll();
 *     res.json(users);
 * }));
 *
 * Author: Winstore Team
 * ============================================================
 */

/**
 * Wrap an async Express route handler.
 *
 * @param {Function} fn - Async controller function.
 * @returns {Function} Express middleware.
 */
 const asyncHandler = (fn) => {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};

module.exports = asyncHandler;