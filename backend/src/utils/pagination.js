/**
 * ============================================================
 * File: pagination.js
 * Module: Shared Utilities
 *
 * Description:
 * Server-side pagination + sorting helpers for list endpoints. Designed to
 * be OPT-IN and backward compatible: if a request sends no page/limit, list
 * endpoints return everything exactly as before, so nothing that hasn't been
 * wired to paginate breaks. When `page`/`limit` are present:
 *   - `parsePagination` yields { page, limit, offset } (limit capped),
 *   - `limitOffsetClause` appends LIMIT/OFFSET to the query,
 *   - `orderByClause` builds a SAFE ORDER BY from a per-endpoint whitelist
 *     (never interpolates client input directly), and
 *   - `buildPageMeta` produces the { page, limit, total, totalPages } meta.
 *
 * Repositories add `COUNT(*) OVER() AS total_count` to the SELECT so the
 * total comes back in the same query (no second round-trip); the service
 * reads it off the first row.
 * ============================================================
 */

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

/**
 * @param {object} query Express req.query.
 * @returns {{page:number, limit:number, offset:number}|null} null when the
 *   caller didn't ask to paginate (→ return the full list, as before).
 */
const parsePagination = (query = {}) => {
    const rawLimit = query.limit ?? query.perPage ?? query.pageSize;
    const rawPage = query.page;
    if (rawLimit === undefined && rawPage === undefined) {
        return null;
    }
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(rawLimit ?? DEFAULT_LIMIT, 10) || DEFAULT_LIMIT));
    const page = Math.max(1, Number.parseInt(rawPage ?? 1, 10) || 1);
    return { page, limit, offset: (page - 1) * limit };
};

/**
 * The requested sort, if any, from the query (sortKey/sortDir).
 *
 * @param {object} query Express req.query.
 * @returns {{key:string, dir:"asc"|"desc"}|null}
 */
const parseSort = (query = {}) => {
    if (!query.sortKey) {
        return null;
    }
    return { key: String(query.sortKey), dir: query.sortDir === "desc" ? "desc" : "asc" };
};

/**
 * Build a SAFE `ORDER BY` clause. The client's sort key is only ever used to
 * look up a column expression in `allowed` — it is never placed into SQL
 * directly — so this can't be an injection vector.
 *
 * @param {{key:string,dir:string}|null} sort From parseSort.
 * @param {Object<string,string>} allowed Map of apiKey → SQL column/expression.
 * @param {string} fallback SQL used when no valid sort is requested (e.g. "name ASC").
 * @returns {string} e.g. "ORDER BY name DESC".
 */
const orderByClause = (sort, allowed, fallback) => {
    if (sort && sort.key && Object.prototype.hasOwnProperty.call(allowed, sort.key)) {
        const dir = sort.dir === "desc" ? "DESC" : "ASC";
        return `ORDER BY ${allowed[sort.key]} ${dir}`;
    }
    return `ORDER BY ${fallback}`;
};

/**
 * LIMIT/OFFSET clause + its params, starting at the given placeholder index.
 *
 * @param {{limit:number,offset:number}|null} pagination
 * @param {number} startIndex Next positional-param index (e.g. params.length + 1).
 * @returns {{clause:string, params:number[]}}
 */
const limitOffsetClause = (pagination, startIndex) => {
    if (!pagination) {
        return { clause: "", params: [] };
    }
    return {
        clause: ` LIMIT $${startIndex} OFFSET $${startIndex + 1}`,
        params: [pagination.limit, pagination.offset],
    };
};

/**
 * @param {{page:number,limit:number}} pagination
 * @param {number} total Total rows matching the filter (from COUNT(*) OVER()).
 * @returns {{page:number,limit:number,total:number,totalPages:number}}
 */
const buildPageMeta = (pagination, total) => ({
    page: pagination.page,
    limit: pagination.limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / pagination.limit)),
});

/**
 * Read the total off a paginated result set (COUNT(*) OVER() AS total_count
 * lives on every row; 0 when there are none).
 *
 * @param {object[]} rows
 * @returns {number}
 */
const totalFromRows = (rows) => (rows.length ? Number(rows[0].total_count) : 0);

module.exports = {
    parsePagination,
    parseSort,
    orderByClause,
    limitOffsetClause,
    buildPageMeta,
    totalFromRows,
};
