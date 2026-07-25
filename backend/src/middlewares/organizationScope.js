/**
 * ============================================================
 * File: organizationScope.js
 * Module: Middlewares
 *
 * Description:
 * Enforces organization-level data isolation for protected routes.
 * ============================================================
 */

/**
 * Ensure requests cannot read or write data for another organization.
 *
 * @param {object} req Express request.
 * @param {object} res Express response.
 * @param {Function} next Express next callback.
 * @returns {object|undefined} JSON response when blocked.
 */
const enforceOrganizationScope = (req, res, next) => {
    const userOrganizationId = req.user?.organizationId;

    if (!userOrganizationId) {
        return res.status(403).json({
            success: false,
            message: "Organization scope is required for this request.",
            errors: [],
        });
    }

    const queryOrganizationId = req.query?.organizationId;
    if (queryOrganizationId && queryOrganizationId !== userOrganizationId) {
        return res.status(403).json({
            success: false,
            message: "You cannot access data outside your organization.",
            errors: [],
        });
    }

    if (req.body && typeof req.body === "object") {
        const bodyOrganizationId = req.body.organizationId;
        if (bodyOrganizationId && bodyOrganizationId !== userOrganizationId) {
            return res.status(403).json({
                success: false,
                message: "You cannot modify data outside your organization.",
                errors: [],
            });
        }

        req.body.organizationId = userOrganizationId;
    }

    // Express 5 made req.query a read-only getter (no setter) — unlike
    // Express 4, a plain `req.query.organizationId = value` assignment
    // silently no-ops. This one line being broken meant every GET list
    // endpoint across the app was receiving an empty organizationId,
    // while POST/PATCH endpoints (which mutate req.body, still a plain
    // writable object in Express 5) worked fine. Redefining the property
    // is the supported workaround: req.query remains configurable even
    // though it has no setter.
    Object.defineProperty(req, "query", {
        value: { ...req.query, organizationId: userOrganizationId },
        writable: true,
        configurable: true,
        enumerable: true,
    });

    return next();
};

module.exports = {
    enforceOrganizationScope,
};
