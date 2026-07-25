/**
 * ============================================================
 * File: DeleteButton.jsx
 * Module: Shared Components
 *
 * Description:
 * Developer-only hard delete control. Every other role only ever gets
 * Activate/Deactivate elsewhere on the page — this button doesn't even
 * render for them (callers gate it on user.role === "developer").
 *
 * A record still referenced by other data (e.g. a product with past
 * sales) is blocked by the backend with a specific message; this shows
 * that message and offers a "Delete anyway" retry that force-deletes
 * everything referencing it too, so the developer isn't left at a dead
 * end — see backend/src/utils/hardDelete.js.
 * ============================================================
 */

import { useState } from "react";
import apiClient from "../api/client";
import { useDialog } from "../context/ToastContext";

export default function DeleteButton({ resource, id, label, onDeleted }) {
  const { confirm } = useDialog();
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);

  const runDelete = async (force) => {
    setBusy(true);
    setError("");
    try {
      await apiClient.delete(`/${resource}/${id}`, { params: force ? { force: true } : undefined });
      setBlocked(false);
      onDeleted?.();
    } catch (err) {
      setError(err.message);
      setBlocked(Boolean(err.blockedByDependents));
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteClick = async () => {
    const ok = await confirm({
      title: "Permanent delete",
      message: `Permanently delete "${label}"? This cannot be undone.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (ok) runDelete(false);
  };

  const handleForceClick = async () => {
    const ok = await confirm({
      title: "Delete with dependents",
      message: `Delete "${label}" AND everything that references it? This cannot be undone.`,
      confirmLabel: "Delete everything",
      tone: "danger",
    });
    if (ok) runDelete(true);
  };

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button type="button" onClick={handleDeleteClick} disabled={busy} className="btn-link btn-link-danger">
        Delete
      </button>
      {error && (
        <span className="max-w-[16rem] text-right text-xs text-clay">
          {error}
          {blocked && (
            <>
              {" "}
              <button
                type="button"
                onClick={handleForceClick}
                disabled={busy}
                className="font-semibold underline"
              >
                Delete anyway
              </button>
            </>
          )}
        </span>
      )}
    </span>
  );
}
