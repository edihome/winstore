/**
 * ============================================================
 * File: stock-movements.controller.js
 * Module: Core Stock Movements
 *
 * Description:
 * HTTP controller for stock movement endpoints.
 * ============================================================
 */

const stockMovementsService = require("./stock-movements.service");
const { success, paginated } = require("../../utils/response");
const { parsePagination, parseSort, buildPageMeta } = require("../../utils/pagination");
const AppError = require("../../utils/AppError");
const { userHasPermission } = require("../../middlewares/permission");
const { createTemplateHandler, createBulkImportHandler } = require("../../utils/bulkImportHandlers");
const { resolveBranchIdByCode } = require("../../utils/resolveBranchIdByCode");
const { isPrivilegedRole } = require("../../utils/isPrivilegedRole");
const productsRepository = require("../products/products.repository");

const IMPORT_HEADERS = [
    "Product SKU",
    "Branch Code",
    "Movement Type (in/out/adjustment)",
    "Quantity",
    "Reason",
    "Expiry Date (for stock-in only)",
];
const IMPORT_EXAMPLE_ROWS = [
    {
        "Product SKU": "SHM-500",
        "Branch Code": "MAIN",
        "Movement Type (in/out/adjustment)": "in",
        Quantity: 20,
        Reason: "Supplier delivery",
        "Expiry Date (for stock-in only)": "",
    },
];

const resolveProductIdBySku = async (sku, req) => {
    const trimmedSku = String(sku || "").trim();
    if (!trimmedSku) {
        throw new AppError("Product SKU is required.", 400);
    }

    const product = await productsRepository.findProductBySku(req.user.organizationId, trimmedSku);
    if (!product) {
        throw new AppError(`No product found with SKU "${trimmedSku}".`, 400);
    }
    return product.id;
};

const mapImportRow = async (row, req) => ({
    productId: await resolveProductIdBySku(row["Product SKU"], req),
    branchId: await resolveBranchIdByCode(row["Branch Code"], req),
    movementType: String(row["Movement Type (in/out/adjustment)"] || "").trim().toLowerCase(),
    quantity: row.Quantity,
    reason: row.Reason || undefined,
    expiryDate: row["Expiry Date (for stock-in only)"] || undefined,
    organizationId: req.user.organizationId,
});

/**
 * Handle stock movement listing requests.
 *
 * @param {object} req Express request.
 * @param {object} res Express response.
 * @returns {Promise<object>} JSON response.
 */
const listStockMovements = async (req, res) => {
    const pagination = parsePagination(req.query);
    const result = await stockMovementsService.listStockMovements({
        organizationId: req.query.organizationId,
        branchId: req.query.branchId,
        productId: req.query.productId,
        pagination,
        sort: parseSort(req.query),
    });
    if (pagination) {
        return paginated(res, "Stock movements fetched successfully.", result.items, buildPageMeta(pagination, result.total));
    }
    return success(res, "Stock movements fetched successfully.", result, 200);
};

/**
 * Handle stock movement creation requests.
 *
 * @param {object} req Express request.
 * @param {object} res Express response.
 * @returns {Promise<object>} JSON response.
 */
const createStockMovement = async (req, res) => {
    // A stock ADJUSTMENT (arbitrary correction) is a separate permission on top
    // of recording ordinary in/out movements. "manage" is accepted (it isn't
    // baseline for this module), so Admin/Supervisor and anyone granted Stock
    // Adjustment qualify; a plain create grant does not.
    if (
        String(req.body.movementType).toLowerCase() === "adjustment" &&
        !userHasPermission(req.user, ["stock_movements:stock_adjustment", "stock_movements:manage"])
    ) {
        throw new AppError("You do not have permission to make stock adjustments.", 403);
    }
    const movement = await stockMovementsService.createStockMovement(req.body);
    return success(res, "Stock movement created successfully.", movement, 201);
};

/**
 * Handle stock transfer requests (move a product between branches).
 *
 * @param {object} req Express request.
 * @param {object} res Express response.
 * @returns {Promise<object>} JSON response.
 */
const transferStock = async (req, res) => {
    // Privileged callers (owner/developer) may transfer between any branch in
    // their org; everyone else is confined to their accessible branches,
    // resolved onto req.user by the branch-scope middleware.
    const accessibleBranchIds = isPrivilegedRole(req.user.role) ? null : req.user.accessibleBranchIds || [];

    const result = await stockMovementsService.transferStock(
        {
            organizationId: req.user.organizationId,
            productId: req.body.productId,
            fromBranchId: req.body.fromBranchId,
            toBranchId: req.body.toBranchId,
            quantity: req.body.quantity,
            reason: req.body.reason,
        },
        accessibleBranchIds
    );

    return success(res, "Stock transferred successfully.", result, 201);
};

const downloadImportTemplate = createTemplateHandler(
    "stock-movements-template.xlsx",
    IMPORT_HEADERS,
    IMPORT_EXAMPLE_ROWS
);

const bulkImportStockMovements = createBulkImportHandler(mapImportRow, stockMovementsService.createStockMovement);

module.exports = {
    listStockMovements,
    createStockMovement,
    transferStock,
    downloadImportTemplate,
    bulkImportStockMovements,
};
