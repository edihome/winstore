/**
 * ============================================================
 * File: tableKit.jsx
 * Module: Shared Components
 *
 * Description:
 * The list-page toolkit: one hook that gives any already-fetched row
 * array search, column sorting, and pagination, plus the two UI pieces
 * that render them (a sortable header cell and a pager bar). Keeps
 * per-page wiring to a few lines so every table in the app behaves the
 * same way.
 *
 * Client-side by design for now: lists arrive whole from the API, so
 * filtering/sorting/paging here adds zero backend round-trips. When a
 * deployment outgrows that, the same hook API can swap to server-side
 * params without touching the pages.
 * ============================================================
 */

import { useCallback, useEffect, useMemo, useState } from "react";

const compareValues = (a, b) => {
  if (a === b) return 0;
  if (a === null || a === undefined || a === "") return 1;
  if (b === null || b === undefined || b === "") return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return a === b ? 0 : a ? -1 : 1;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
};

/**
 * @param {Array} rows The full fetched list.
 * @param {object} options
 *   pageSize   — rows per page (default 10).
 *   searchText — current query; pass "" to disable search.
 *   searchFn   — (row) => string haystack to match searchText against.
 *   defaultSort — { key, dir } initial sort (key must exist on rows).
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useTableKit(rows, { pageSize = 10, searchText = "", searchFn, defaultSort = null } = {}) {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState(defaultSort);

  const filtered = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query || !searchFn) return rows;
    return rows.filter((row) => searchFn(row).toLowerCase().includes(query));
  }, [rows, searchText, searchFn]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const next = [...filtered].sort((a, b) => compareValues(a[sort.key], b[sort.key]));
    return sort.dir === "desc" ? next.reverse() : next;
  }, [filtered, sort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visible = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  const toggleSort = (key) => {
    setSort((prev) => (prev?.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
    setPage(1);
  };

  return {
    visible,
    total: sorted.length,
    page: safePage,
    totalPages,
    setPage,
    sort,
    toggleSort,
  };
}

/**
 * Server-side sibling of useTableKit: same return shape (so SortableTh and
 * TablePager work unchanged), but the current page, sort, and search are sent
 * to the API and only one page of rows is fetched at a time. Use this for
 * lists that grow without bound (sales, customers, …).
 *
 * @param {Function} fetchPage async ({ page, limit, sortKey, sortDir, search })
 *   => a response whose body is { data: rows, pagination: { total, ... } }.
 *   Axios responses (res.data) and plain bodies are both accepted.
 * @param {object} options
 *   pageSize    — rows per page (default 25).
 *   search      — current query string (changing it resets to page 1).
 *   defaultSort — { key, dir } initial server sort.
 *   deps        — extra values that should re-trigger a fetch (e.g. active branch).
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useServerTable(fetchPage, { pageSize = 25, search = "", defaultSort = null, deps = [] } = {}) {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState(defaultSort);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);

  const depsKey = JSON.stringify(deps);
  const sortKey = sort ? `${sort.key}:${sort.dir}` : "";

  // A new query, sort, or dependency starts back at page 1.
  useEffect(() => {
    setPage(1);
  }, [search, sortKey, depsKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.resolve(fetchPage({ page, limit: pageSize, sortKey: sort?.key, sortDir: sort?.dir, search }))
      .then((res) => {
        if (cancelled) return;
        const body = res && res.data && res.data.data !== undefined ? res.data : res;
        setRows((body && body.data) || []);
        setTotal((body && body.pagination && body.pagination.total) ?? ((body && body.data && body.data.length) || 0));
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Failed to load.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // fetchPage is intentionally excluded (a fresh closure each render); `deps`
    // captures anything it reads that should re-fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, sortKey, search, refreshTick, depsKey]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const toggleSort = useCallback((key) => {
    setSort((prev) => (prev?.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }, []);
  const reload = useCallback(() => setRefreshTick((t) => t + 1), []);

  return {
    visible: rows,
    total,
    page: Math.min(page, totalPages),
    totalPages,
    setPage,
    sort,
    toggleSort,
    loading,
    error,
    reload,
  };
}

/** Sortable <th>: click cycles asc/desc; shows an arrow when active. */
export function SortableTh({ kit, sortKey, children, className = "", align = "left" }) {
  const active = kit.sort?.key === sortKey;
  const arrow = active ? (kit.sort.dir === "asc" ? "↑" : "↓") : "";
  return (
    <th className={`px-4 py-2 font-medium text-ink-soft ${className}`}>
      <button
        type="button"
        onClick={() => kit.toggleSort(sortKey)}
        className={`inline-flex w-full items-center gap-1 font-medium transition hover:text-ink ${
          align === "right" ? "justify-end" : ""
        } ${active ? "text-ink" : ""}`}
        aria-label={`Sort by ${typeof children === "string" ? children : sortKey}`}
      >
        {children}
        <span aria-hidden="true" className="text-[0.65rem]">{arrow}</span>
      </button>
    </th>
  );
}

/** Pager bar rendered under a table whenever there's more than one page. */
export function TablePager({ kit, noun = "rows" }) {
  if (kit.totalPages <= 1) {
    return null;
  }
  return (
    <div className="mt-3 flex items-center justify-between text-xs text-ink-soft">
      <span>
        {kit.total} {noun}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => kit.setPage(kit.page - 1)}
          disabled={kit.page === 1}
          className="btn-chip btn-chip-neutral"
        >
          ← Prev
        </button>
        <span className="font-mono">
          {kit.page} / {kit.totalPages}
        </span>
        <button
          type="button"
          onClick={() => kit.setPage(kit.page + 1)}
          disabled={kit.page === kit.totalPages}
          className="btn-chip btn-chip-neutral"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
