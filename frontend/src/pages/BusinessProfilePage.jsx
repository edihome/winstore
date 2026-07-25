/**
 * ============================================================
 * File: BusinessProfilePage.jsx
 * Module: Administration (Business Profile)
 *
 * Description:
 * Where an organization sets what prints at the top and bottom of its
 * receipts: a logo, its address and contact details, and a custom
 * message to customers (returns policy, thank-you, tagline). Stored as
 * organization settings and picked up by the receipt immediately after
 * saving (see utils/receipt.js and the profile refresh below).
 *
 * The logo is resized down in the browser before upload so it stays a
 * small inline image — right for a narrow thermal receipt and small
 * enough to store as a data URI in settings.
 * ============================================================
 */

import { useEffect, useRef, useState } from "react";
import apiClient from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { resizeToDataUri } from "../utils/image";

const ACCENT_STYLE = { "--card-accent": "var(--color-cobalt)", "--card-glow": "rgba(53, 80, 143, 0.35)" };

const initialForm = {
  business_address: "",
  business_phone: "",
  business_email: "",
  receipt_message: "",
  logo: "",
};

export default function BusinessProfilePage() {
  const { user, refreshProfile } = useAuth();
  const toast = useToast();
  const fileRef = useRef(null);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await apiClient.get("/settings");
        const map = Object.fromEntries(res.data.data.map((row) => [row.keyName || row.key_name, row.value]));
        setForm({
          business_address: map.business_address || "",
          business_phone: map.business_phone || "",
          business_email: map.business_email || "",
          receipt_message: map.receipt_message || "",
          logo: map.logo || "",
        });
      } catch (err) {
        toast.error(err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = (event) => {
    setForm((prev) => ({ ...prev, [event.target.name]: event.target.value }));
  };

  const handleLogo = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const dataUri = await resizeToDataUri(file);
      setForm((prev) => ({ ...prev, logo: dataUri }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await apiClient.patch("/settings", form);
      await refreshProfile(); // receipts pick up the new branding at once
      toast.success("Business profile saved.");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    "w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal";

  return (
    <div>
      <div className="mb-6">
        <span className="field-label text-cobalt">Administration</span>
        <h2 className="font-display text-xl font-semibold text-ink">Business profile</h2>
        <p className="mt-1 text-sm text-ink-soft">
          What prints on your receipts — logo, address, contacts, and a message to customers.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-ink-soft">Loading…</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <form onSubmit={handleSubmit} className="ledger-card space-y-4 py-6 pr-6 lg:col-span-2 min-w-0" style={ACCENT_STYLE}>
            <div>
              <p className="field-label mb-1">Logo</p>
              <div className="flex items-center gap-4">
                <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded border border-paper-line bg-paper">
                  {form.logo ? (
                    <img src={form.logo} alt="Logo preview" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <span className="text-xs text-ink-soft">None</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => fileRef.current?.click()} className="btn-chip btn-chip-primary">
                    {form.logo ? "Replace logo" : "Upload logo"}
                  </button>
                  {form.logo && (
                    <button type="button" onClick={() => setForm((prev) => ({ ...prev, logo: "" }))} className="btn-chip btn-chip-danger">
                      Remove
                    </button>
                  )}
                  <input ref={fileRef} type="file" accept="image/*" onChange={handleLogo} className="hidden" />
                </div>
              </div>
              <p className="mt-1 text-xs text-ink-soft">Prints at the top of every receipt. It's resized automatically.</p>
            </div>

            <div>
              <label htmlFor="business_address" className="field-label mb-1 block">
                Address
              </label>
              <textarea
                id="business_address"
                name="business_address"
                rows={2}
                value={form.business_address}
                onChange={handleChange}
                placeholder="e.g. 37 Adekunle Fajuyi Road, Dugbe, Ibadan"
                className={inputClass}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="business_phone" className="field-label mb-1 block">
                  Phone
                </label>
                <input
                  id="business_phone"
                  name="business_phone"
                  value={form.business_phone}
                  onChange={handleChange}
                  placeholder="e.g. 08012345678, 08087654321"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="business_email" className="field-label mb-1 block">
                  Email
                </label>
                <input
                  id="business_email"
                  name="business_email"
                  type="email"
                  value={form.business_email}
                  onChange={handleChange}
                  placeholder="e.g. shop@business.com"
                  className={inputClass}
                />
              </div>
            </div>

            <div>
              <label htmlFor="receipt_message" className="field-label mb-1 block">
                Message to customers <span className="normal-case text-ink-soft">(prints at the bottom)</span>
              </label>
              <textarea
                id="receipt_message"
                name="receipt_message"
                rows={3}
                value={form.receipt_message}
                onChange={handleChange}
                placeholder="e.g. Goods bought in good condition are unreturnable. Thanks for your patronage."
                className={inputClass}
              />
            </div>

            <button type="submit" disabled={saving} className="btn-solid btn-solid-primary">
              {saving ? "Saving…" : "Save profile"}
            </button>
          </form>

          {/* Live receipt-header preview so the layout is obvious. */}
          <div className="lg:col-span-1 min-w-0">
            <p className="field-label mb-2">Receipt preview</p>
            <div className="mx-auto max-w-[16rem] rounded border border-paper-line bg-white px-4 py-4 text-center font-mono text-xs text-ink">
              {form.logo && <img src={form.logo} alt="" className="mx-auto mb-2 max-h-16 object-contain" />}
              <p className="font-display text-sm font-semibold uppercase">{user?.organization?.name}</p>
              {form.business_address && <p className="mt-1 text-[0.7rem] text-ink-soft">{form.business_address}</p>}
              {(form.business_phone || form.business_email) && (
                <p className="text-[0.7rem] text-ink-soft">
                  {[form.business_phone, form.business_email].filter(Boolean).join(" | ")}
                </p>
              )}
              <div className="my-2 border-t border-dashed border-paper-line" />
              <p className="text-[0.7rem] text-ink-soft">RECEIPT No: …</p>
              <p className="text-[0.7rem] text-ink-soft">items · totals · payment</p>
              {form.receipt_message && (
                <>
                  <div className="my-2 border-t border-dashed border-paper-line" />
                  <p className="text-[0.7rem] text-ink-soft">{form.receipt_message}</p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
