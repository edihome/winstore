/**
 * ============================================================
 * File: products.repository.js
 * Module: Core Products
 *
 * Description:
 * SQL repository methods for product management.
 * ============================================================
 */

const pool = require("../../config/db");
const { orderByClause, limitOffsetClause } = require("../../utils/pagination");

const PRODUCT_SORTS = { name: "p.name", sku: "p.sku", price: "p.price", status: "p.status", createdAt: "p.created_at" };

const listProducts = async (filters = {}, client = pool) => {
    const { organizationId = "", categoryId = "", includeInactive = false, search = "", pagination = null, sort = null } = filters;

    const params = [organizationId, categoryId, includeInactive, search];
    const order = orderByClause(sort, PRODUCT_SORTS, "p.name ASC");
    const { clause, params: pageParams } = limitOffsetClause(pagination, params.length + 1);

    const result = await client.query(
        `
            SELECT p.id, p.organization_id, p.category_id, p.name, p.sku, p.barcode, p.price, p.cost,
                   p.status, p.created_at, p.updated_at, p.xmin::text AS version,
                   c.name AS category_name, COUNT(*) OVER() AS total_count
            FROM products p
            LEFT JOIN categories c ON c.id = p.category_id
            WHERE ($1::text = '' OR p.organization_id = $1::uuid)
              AND ($2::text = '' OR p.category_id = $2::uuid)
              AND ($3::boolean = true OR p.status = 'active')
              AND ($4::text = '' OR p.name ILIKE '%' || $4 || '%' OR p.sku ILIKE '%' || $4 || '%'
                   OR COALESCE(p.barcode, '') ILIKE '%' || $4 || '%' OR COALESCE(c.name, '') ILIKE '%' || $4 || '%')
            ${order}${clause}
        `,
        [...params, ...pageParams]
    );

    return result.rows;
};

const findProductById = async (id, organizationId, client = pool) => {
    const result = await client.query(
        `
            SELECT id, organization_id, category_id, name, sku, barcode, price, cost, status, created_at, updated_at, xmin::text AS version
            FROM products
            WHERE id = $1 AND organization_id = $2
            LIMIT 1
        `,
        [id, organizationId]
    );

    return result.rows[0] || null;
};

const findProductBySku = async (organizationId, sku, client = pool) => {
    const result = await client.query(
        `
            SELECT id, organization_id, category_id, name, sku, barcode, price, cost, status, created_at, updated_at
            FROM products
            WHERE organization_id = $1 AND sku = $2
            LIMIT 1
        `,
        [organizationId, sku]
    );

    return result.rows[0] || null;
};

const findProductByBarcode = async (organizationId, barcode, client = pool) => {
    const result = await client.query(
        `
            SELECT id, organization_id, category_id, name, sku, barcode, price, cost, status, created_at, updated_at
            FROM products
            WHERE organization_id = $1 AND barcode = $2
            LIMIT 1
        `,
        [organizationId, barcode]
    );

    return result.rows[0] || null;
};

const createProduct = async (productData, client = pool) => {
    const result = await client.query(
        `
            INSERT INTO products (id, organization_id, category_id, name, sku, barcode, price, cost, status, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
            RETURNING id, organization_id, category_id, name, sku, barcode, price, cost, status, created_at, updated_at, xmin::text AS version
        `,
        [
            productData.id,
            productData.organizationId,
            productData.categoryId || null,
            productData.name,
            productData.sku,
            productData.barcode || null,
            productData.price || 0,
            productData.cost || 0,
            productData.status || "active",
        ]
    );

    return result.rows[0];
};

const updateProduct = async (id, organizationId, changes, expectedVersion = null, client = pool) => {
    // Optimistic lock: when the caller passes the version they loaded, the
    // update only matches if the row hasn't changed since (see
    // utils/optimisticLock). Omitted → updates as before.
    const params = [
        id,
        organizationId,
        changes.categoryId ?? null,
        changes.name ?? null,
        changes.barcode ?? null,
        changes.price ?? null,
        changes.cost ?? null,
        changes.status ?? null,
    ];
    let versionClause = "";
    if (expectedVersion !== null) {
        params.push(expectedVersion);
        versionClause = ` AND xmin = $${params.length}::xid`;
    }

    const result = await client.query(
        `
            UPDATE products
            SET
                category_id = COALESCE($3, category_id),
                name = COALESCE($4, name),
                barcode = COALESCE($5, barcode),
                price = COALESCE($6, price),
                cost = COALESCE($7, cost),
                status = COALESCE($8, status),
                updated_at = NOW()
            WHERE id = $1 AND organization_id = $2${versionClause}
            RETURNING id, organization_id, category_id, name, sku, barcode, price, cost, status, created_at, updated_at, xmin::text AS version
        `,
        params
    );

    return result.rows[0] || null;
};

module.exports = {
    listProducts,
    findProductById,
    findProductBySku,
    findProductByBarcode,
    createProduct,
    updateProduct,
};
