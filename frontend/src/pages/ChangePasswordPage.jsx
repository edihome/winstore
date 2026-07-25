/**
 * ============================================================
 * File: ChangePasswordPage.jsx
 * Module: Account
 *
 * Description:
 * Self-service password change for the logged-in user. Requires
 * the current password — this is the "I know it but want to
 * change it" flow. If a staff member has forgotten their password
 * entirely, an admin resets it from Administration · Staff instead.
 * ============================================================
 */

import { useState } from "react";
import apiClient from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

const initialForm = { currentPassword: "", newPassword: "", confirmPassword: "" };

// Administration's card accent (this page lives in that nav group). See
// index.css's .ledger-card/.panel --card-accent/--card-glow.
const ACCENT_STYLE = { "--card-accent": "var(--color-cobalt)", "--card-glow": "rgba(53, 80, 143, 0.35)" };

export default function ChangePasswordPage() {
  const { user, applyNewToken } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // One toggle reveals both new-password fields — typos are the whole
  // reason a "confirm" field exists, and seeing what you typed beats
  // typing it twice blind.
  const [showPasswords, setShowPasswords] = useState(false);

  const handleChange = (event) => {
    setForm((prev) => ({ ...prev, [event.target.name]: event.target.value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");

    if (form.newPassword !== form.confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await apiClient.patch("/auth/change-password", {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      setForm(initialForm);
      setNotice("Password changed successfully.");
      toast.success("Password changed.");
      // The response carries a freshly issued token with an updated
      // mustChangePassword claim — swap it in immediately so
      // ProtectedRoute stops confining the user here without requiring
      // a fresh login.
      await applyNewToken(response.data.data.token);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    "w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal";

  return (
    <div>
      <div className="mb-6">
        <span className="field-label text-cobalt">Account</span>
        <h2 className="font-display text-xl font-semibold text-ink">Change password</h2>
      </div>

      {user?.mustChangePassword && !notice && (
        <p className="mb-4 rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink-soft">
          Your password was set by an administrator — choose a new one only you know before continuing.
        </p>
      )}

      {error && (
        <p className="mb-4 rounded border border-clay/30 bg-clay-soft px-3 py-2 text-sm text-clay">
          {error}
        </p>
      )}

      {notice && (
        <p className="mb-4 rounded border border-paper-line bg-white px-3 py-2 text-sm text-teal">
          {notice}
        </p>
      )}

      <form onSubmit={handleSubmit} className="ledger-card max-w-sm space-y-3 py-6 pr-6" style={ACCENT_STYLE}>
        <div>
          <label htmlFor="currentPassword" className="field-label mb-1 block">
            Current password
          </label>
          <input
            id="currentPassword"
            name="currentPassword"
            type="password"
            required
            value={form.currentPassword}
            onChange={handleChange}
            className={inputClass}
          />
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label htmlFor="newPassword" className="field-label block">
              New password
            </label>
            <button
              type="button"
              onClick={() => setShowPasswords((prev) => !prev)}
              className="btn-link btn-link-neutral"
            >
              {showPasswords ? "Hide" : "Show"}
            </button>
          </div>
          <input
            id="newPassword"
            name="newPassword"
            type={showPasswords ? "text" : "password"}
            required
            minLength={8}
            value={form.newPassword}
            onChange={handleChange}
            placeholder="At least 8 characters"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="confirmPassword" className="field-label mb-1 block">
            Confirm new password
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type={showPasswords ? "text" : "password"}
            required
            minLength={8}
            value={form.confirmPassword}
            onChange={handleChange}
            className={inputClass}
          />
        </div>

        <button type="submit" disabled={submitting} className="btn-solid btn-solid-primary">
          {submitting ? "Changing…" : "Change password"}
        </button>
      </form>
    </div>
  );
}
