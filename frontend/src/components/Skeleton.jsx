/**
 * ============================================================
 * File: Skeleton.jsx
 * Module: Shared Components
 *
 * Description:
 * Loading placeholders that keep a page's shape while data arrives —
 * a table-shaped block and a KPI-tile row — instead of a bare
 * "Loading…" line that jumps into a full layout.
 * ============================================================
 */

export function TableSkeleton({ rows = 6 }) {
  return (
    <div className="panel px-4 py-3" aria-hidden="true">
      <div className="skeleton mb-3 h-6 w-full opacity-70" />
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="mb-2.5 flex items-center gap-3 last:mb-0">
          <div className="skeleton h-4 flex-[2]" />
          <div className="skeleton h-4 flex-[3]" />
          <div className="skeleton hidden h-4 flex-[2] sm:block" />
          <div className="skeleton h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

export function TileSkeleton({ count = 4 }) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4" aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="stat-tile p-4">
          <div className="skeleton mb-3 h-4 w-2/3" />
          <div className="skeleton h-7 w-1/2" />
        </div>
      ))}
    </div>
  );
}
