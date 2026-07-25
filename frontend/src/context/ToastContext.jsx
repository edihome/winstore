/**
 * ============================================================
 * File: ToastContext.jsx
 * Module: Shared Context
 *
 * Description:
 * The app's feedback layer. Two channels, one provider:
 *   - toasts: brief, non-blocking confirmations of success (a sale
 *     completed, a customer saved).
 *   - modals: everything that should interrupt and be acknowledged —
 *     errors and information (dialog.alert / toast.error), yes/no
 *     confirmations (dialog.confirm), and print previews (dialog.print).
 *
 * `useToast()` keeps its original API ({ success, info, error }); error
 * now opens a modal so it can't be missed. `useDialog()` exposes the
 * modal helpers ({ confirm, alert, print }). Only one modal shows at a
 * time.
 * ============================================================
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

const FeedbackContext = createContext(null);

const DISMISS_MS = 3800;

const TONE_STYLES = {
  error: { accent: "var(--color-clay)", chip: "bg-clay-soft text-clay", glyph: "!" },
  danger: { accent: "var(--color-clay)", chip: "bg-clay-soft text-clay", glyph: "!" },
  warning: { accent: "var(--color-amber-dark)", chip: "bg-amber-soft text-amber-dark", glyph: "!" },
  success: { accent: "var(--color-signal)", chip: "bg-signal-soft text-signal", glyph: "✓" },
  info: { accent: "var(--color-teal)", chip: "bg-teal-soft text-teal", glyph: "i" },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [modal, setModal] = useState(null);
  const nextId = useRef(1);
  const iframeRef = useRef(null);

  // ---- toasts (success / info) ----
  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback(
    (tone, message) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, tone, message }]);
      setTimeout(() => dismissToast(id), DISMISS_MS);
    },
    [dismissToast]
  );

  // ---- modals (confirm / alert / print) ----
  const closeModal = useCallback((result) => {
    setModal((current) => {
      current?.resolve?.(result);
      return null;
    });
  }, []);

  const confirm = useCallback(
    (options = {}) =>
      new Promise((resolve) => {
        setModal({
          type: "confirm",
          tone: "danger",
          title: "Please confirm",
          confirmLabel: "Confirm",
          cancelLabel: "Cancel",
          ...(typeof options === "string" ? { message: options } : options),
          resolve,
        });
      }),
    []
  );

  const alert = useCallback(
    (options = {}) =>
      new Promise((resolve) => {
        setModal({
          type: "alert",
          tone: "info",
          title: "Notice",
          confirmLabel: "OK",
          ...(typeof options === "string" ? { message: options } : options),
          resolve,
        });
      }),
    []
  );

  const print = useCallback((options = {}) => {
    setModal({ type: "print", title: options.title || "Print", html: options.html || "" });
  }, []);

  // error is an information modal, so a failure is never missed.
  const error = useCallback(
    (message) => alert({ tone: "error", title: "Something went wrong", message: String(message || "Please try again.") }),
    [alert]
  );

  const toast = useMemo(
    () => ({
      success: (message) => pushToast("success", message),
      info: (message) => pushToast("info", message),
      error,
    }),
    [pushToast, error]
  );

  const value = useMemo(() => ({ ...toast, confirm, alert, print }), [toast, confirm, alert, print]);

  // Escape closes the modal (confirm resolves false, others resolve/undefined).
  useEffect(() => {
    if (!modal) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") closeModal(modal.type === "confirm" ? false : undefined);
    };
    window.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [modal, closeModal]);

  const printIframe = () => {
    const frame = iframeRef.current;
    if (frame?.contentWindow) {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    }
  };

  const tone = TONE_STYLES[modal?.tone] || TONE_STYLES.info;

  return (
    <FeedbackContext.Provider value={value}>
      {children}

      {/* Toast stack (success / info) */}
      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {toasts.map((entry) => (
          <div key={entry.id} className={`toast toast-${entry.tone}`} role="status">
            <span aria-hidden="true" className="mt-0.5 text-xs">
              {entry.tone === "success" ? "✓" : "•"}
            </span>
            <p className="min-w-0 flex-1">{entry.message}</p>
            <button
              type="button"
              onClick={() => dismissToast(entry.id)}
              aria-label="Dismiss"
              className="shrink-0 text-ink-soft transition hover:text-ink"
            >
              &times;
            </button>
          </div>
        ))}
      </div>

      {/* Modal (alert / confirm / print) */}
      {modal && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-ink/50 px-4 py-6"
          onMouseDown={(event) => {
            // Backdrop click closes (confirm → cancel).
            if (event.target === event.currentTarget) closeModal(modal.type === "confirm" ? false : undefined);
          }}
        >
          {modal.type === "print" ? (
            <div role="dialog" aria-modal="true" aria-label={modal.title} className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-paper-line px-5 py-3">
                <h3 className="font-display text-base font-semibold text-ink">{modal.title}</h3>
                <button type="button" onClick={() => closeModal()} aria-label="Close" className="rounded p-1 text-ink-soft hover:bg-paper hover:text-ink">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto bg-paper p-4">
                <iframe
                  ref={iframeRef}
                  title={modal.title}
                  srcDoc={modal.html}
                  className="mx-auto block h-[62vh] w-full max-w-[420px] rounded border border-paper-line bg-white"
                />
              </div>
              <div className="flex justify-end gap-2 border-t border-paper-line px-5 py-3">
                <button type="button" onClick={() => closeModal()} className="btn-chip btn-chip-neutral">
                  Close
                </button>
                <button type="button" onClick={printIframe} className="btn-solid btn-solid-primary btn-solid-sm">
                  🖨 Print
                </button>
              </div>
            </div>
          ) : (
            <div
              role={modal.type === "confirm" ? "alertdialog" : "dialog"}
              aria-modal="true"
              aria-label={modal.title}
              className="w-full max-w-sm overflow-hidden rounded-lg bg-white shadow-2xl"
              style={{ borderTop: `4px solid ${tone.accent}` }}
            >
              <div className="px-6 py-5">
                <div className="mb-3 flex items-center gap-3">
                  <span className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${tone.chip}`} aria-hidden="true">
                    {tone.glyph}
                  </span>
                  <h3 className="font-display text-base font-semibold text-ink">{modal.title}</h3>
                </div>
                {modal.message && <p className="whitespace-pre-line text-sm text-ink-soft">{modal.message}</p>}
              </div>
              <div className="flex justify-end gap-2 border-t border-paper-line px-6 py-3">
                {modal.type === "confirm" && (
                  <button type="button" onClick={() => closeModal(false)} className="btn-link btn-link-neutral px-2">
                    {modal.cancelLabel}
                  </button>
                )}
                <button
                  type="button"
                  autoFocus
                  onClick={() => closeModal(modal.type === "confirm" ? true : undefined)}
                  className={`btn-solid btn-solid-sm ${modal.tone === "danger" || modal.tone === "error" ? "btn-solid-danger" : "btn-solid-primary"}`}
                >
                  {modal.confirmLabel}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </FeedbackContext.Provider>
  );
}

const useFeedback = () => {
  const context = useContext(FeedbackContext);
  if (!context) {
    throw new Error("useToast/useDialog must be used within a ToastProvider");
  }
  return context;
};

// Backward-compatible: existing pages import { useToast } and call
// success/info/error. error now opens a modal.
// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const { success, info, error } = useFeedback();
  return { success, info, error };
}

// Modal helpers: confirmations and print previews.
// eslint-disable-next-line react-refresh/only-export-components
export function useDialog() {
  const { confirm, alert, print } = useFeedback();
  return { confirm, alert, print };
}
