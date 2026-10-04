/**
 * ============================================================
 * File: products.controller.js
 * Module: Core Products
 *
 * Description:
 * HTTP controller for product endpoints.
 * ============================================================
 */

const asyncHandler = require("../../utils/asyncHandler");
const { success, paginated } = require("../../utils/response");
const { parsePagination, parseSort, buildPageMeta } = require("../../utils/pagination");
const { createTemplateHandler, createBulkImportHandler } = require("../../utils/bulkImportHandlers");
const { resolveAccessibleBranchIds } = require("../../middlewares/branchScope");
const { assertBranchAccessible } = require("../../utils/assertBranchAccessible");
const { canAccessAllBranches } = require("../../utils/isPrivilegedRole");
const productsService = require("./products.service");
const categoriesRepository = require("../categories/categories.repository");
const categoriesService = require("../categories/categories.service");

const IMPORT_HEADERS = [
    "Name",
    "SKU",
    "Barcode (EAN)",
    "Category",
    "Price",
    "Cost",
    "Reorder Level",
    "Opening Stock",
    "Opening Stock Expiry Date",
];
const IMPORT_EXAMPLE_ROWS = [
    {
        Name: "Shampoo — 500ml",
        SKU: "SHM-500",
        "Barcode (EAN)": "6009999999995",
        Category: "Hair Care",
        Price: 12,
        Cost: 6,
        "Reorder Level": 10,
        "Opening Stock": 50,
        "Opening Stock Expiry Date": "",
    },
];

const slugify = (value) =>
    String(value)
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "category";

/**
 * Resolve a category by name, creating it if this organization doesn't
 * already have one with that name — same "just type it and it exists"
 * convenience the manual Products page gives via its inline "+ Add"
 * category field, so bulk import doesn't force a separate prep step.
 *
 * @param {string} categoryName Category name from the spreadsheet row.
 * @param {string} organizationId Organization ID.
 * @returns {Promise<string|undefined>} Category ID, or undefined if no category was given.
 */
const resolveCategoryId = async (categoryName, organizationId) => {
    const name = String(categoryName || "").trim();
    if (!name) {
        return undefined;
    }

    const existing = await categoriesRepository.findCategoryBySlug(organizationId, slugify(name));
    if (existing) {
        return existing.id;
    }

    const created = await categoriesService.createCategory({ name, organizationId });
    return created.id;
};

const mapImportRow = async (row, req) => ({
    name: row.Name,
    sku: row.SKU,
    barcode: row["Barcode (EAN)"] ? String(row["Barcode (EAN)"]).trim() : undefined,
    categoryId: await resolveCategoryId(row.Category, req.user.organizationId),
    price: Number(row.Price),
    cost: row.Cost !== "" && row.Cost !== undefined ? Number(row.Cost) : 0,
    organizationId: req.user.organizationId,
    // Reorder level / opening stock are per-branch — bulk import always
    // applies them to the importing user's own branch, same simplification
    // as the Staff import's branch assignment.
    branchId: req.user.branchId || undefined,
    reorderLevel: row["Reorder Level"] !== "" && row["Reorder Level"] !== undefined
        ? Number(row["Reorder Level"])
        : undefined,
    openingStock: row["Opening Stock"] !== "" && row["Opening Stock"] !== undefined
        ? Number(row["Opening Stock"])
        : undefined,
    openingStockExpiryDate: row["Opening Stock Expiry Date"] || undefined,
});

const listProducts = asyncHandler(async (req, res) => {
    const pagination = parsePagination(req.query);
    const result = await productsService.listProducts({
        organizationId: req.query.organizationId,
        categoryId: req.query.categoryId,
        includeInactive: req.query.includeInactive === "true",
        search: req.query.search,
        pagination,
        sort: parseSort(req.query),
    });
    if (pagination) {
        return paginated(res, "Products fetched successfully.", result.items, buildPageMeta(pagination, result.total));
    }
    return success(res, "Products fetched successfully.", result, 200);
});

const createProduct = asyncHandler(async (req, res) => {
    const branchId = req.body.branchId || req.user.branchId || null;

    // /products isn't branch-scoped (a product isn't owned by one branch),
    // so unlike stock-movements/purchases/sales there's no enforceBranchScope
    // middleware guarding this branchId — check it ourselves, but only when
    // it's actually going to be used (opening stock / reorder level).
    const usesBranch = Number(req.body.openingStock) > 0 || req.body.reorderLevel !== undefined;
    if (usesBranch && branchId && !canAccessAllBranches(req.user.role)) {
        const accessibleBranchIds = await resolveAccessibleBranchIds(req);
        assertBranchAccessible(branchId, accessibleBranchIds, "You do not have access to this branch.");
    }

    const product = await productsService.createProduct({ ...req.body, branchId });
    return success(res, "Product created successfully.", product, 201);
});

const updateProduct = asyncHandler(async (req, res) => {
    const product = await productsService.updateProduct(req.params.id, req.user.organizationId, req.body);
    return success(res, "Product updated successfully.", product, 200);
});

const deleteProduct = asyncHandler(async (req, res) => {
    const force = req.query.force === "true" || req.body?.force === true;
    await productsService.deleteProduct(req.params.id, req.user.organizationId, force);
    return success(res, "Product deleted successfully.", null, 200);
});

const downloadImportTemplate = createTemplateHandler(
    "products-template.xlsx",
    IMPORT_HEADERS,
    IMPORT_EXAMPLE_ROWS
);

// Upsert on import: an existing SKU updates that product instead of failing,
// so re-uploading or overlapping catalog sheets is idempotent.
const bulkImportProducts = createBulkImportHandler(mapImportRow, productsService.importProduct);

module.exports = {
    listProducts,
    createProduct,
    updateProduct,
    deleteProduct,
    downloadImportTemplate,
    bulkImportProducts,
};
