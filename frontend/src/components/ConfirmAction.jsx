/**
 * ============================================================
 * File: ConfirmAction.jsx
 * Module: Shared Components
 *
 * Description:
 * A button whose action is guarded by a confirmation MODAL — used for
 * consequential-but-reversible actions (Deactivate a staff member,
 * Cancel an order, Deactivate an organization). One misclick should
 * never fire the action; the modal makes the user acknowledge it first.
 * The prop shape is unchanged from the old inline version, so every
 * page that uses it gets the modal automatically.
 * ============================================================
 */

import { useState } from "react";
import { useDialog } from "../context/ToastContext";

export default function ConfirmAction({
  label,
  prompt = "Are you sure?",
  title = "Please confirm",
  confirmLabel,
  onConfirm,
  className = "btn-link btn-link-danger",
  disabled = false,
}) {
  const { confirm } = useDialog();
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    const ok = await confirm({ title, message: prompt, confirmLabel: confirmLabel || label, tone: "danger" });
    if (!ok) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" onClick={handleClick} disabled={disabled || busy} className={className}>
      {busy ? "…" : label}
    </button>
  );
}
