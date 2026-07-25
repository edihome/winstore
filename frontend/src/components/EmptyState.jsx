/**
 * ============================================================
 * File: EmptyState.jsx
 * Module: Shared Components
 *
 * Description:
 * What renders where a table would be when there's no data yet: a
 * glyph, one line of context, and (when the viewer can act on it) a
 * primary call to action — the moment where onboarding actually
 * happens, instead of a bare "No staff yet." line.
 * ============================================================
 */

export default function EmptyState({ icon = "📄", title, hint, actionLabel, onAction }) {
  return (
    <div className="pattern-paper rounded border border-dashed border-paper-line px-6 py-12 text-center">
      <div aria-hidden="true" className="mb-3 text-3xl">
        {icon}
      </div>
      <p className="font-display text-base font-semibold text-ink">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-md text-sm text-ink-soft">{hint}</p>}
      {actionLabel && onAction && (
        <button type="button" onClick={onAction} className="btn-solid btn-solid-primary btn-solid-sm mt-4">
          {actionLabel}
        </button>
      )}
    </div>
  );
}
