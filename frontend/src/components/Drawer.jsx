/**
 * ============================================================
 * File: Drawer.jsx
 * Module: Shared Components
 *
 * Description:
 * Right-hand slide-over panel used for create/edit forms — tables get
 * the page's full width, and the form appears only when asked for
 * (the "+ Add" button in each page header) instead of permanently
 * occupying a third of the screen. Closes on backdrop click or Escape;
 * locks body scroll while open.
 * ============================================================
 */

import { useEffect } from "react";

export default function Drawer({ open, title, subtitle, onClose, children }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="drawer-panel" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-paper-line bg-white px-6 py-4">
          <div>
            <h3 className="font-display text-lg font-semibold text-ink">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-ink-soft">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-ink-soft transition hover:bg-paper hover:text-ink"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </aside>
    </>
  );
}
