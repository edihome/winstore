/**
 * ============================================================
 * File: ShipmentsPage.jsx
 * Module: Inventory — Cross-branch shipments
 *
 * Description:
 * Move stock to another branch as a two-step shipment: ship (stock leaves here
 * now, marked in transit) and receive (the destination confirms arrival). Works
 * across offline branches — the record and stock movements reconcile via sync.
 * Incoming shipments to the current branch can be received; outgoing ones still
 * in transit can be cancelled (the stock returns).
 * ============================================================
 */

import { useEffect, useState } from "react";
import apiClient from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useFormat } from "../utils/format";
import Drawer from "../components/Drawer";
import EmptyState from "../components/EmptyState";
import StatusChip from "../components/StatusChip";
import { TableSkeleton } from "../components/Skeleton";

const ACCENT_STYLE = { "--card-accent": "var(--color-teal)", "--card-glow": "rgba(15, 111, 99, 0.35)" };
const inputClass =
  "w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal";

const STATUS_TONE = { in_transit: "warning", received: "success", cancelled: "danger" };
const STATUS_LABEL = { in_transit: "In transit", received: "Received", cancelled: "Cancelled" };

export default function ShipmentsPage() {
  const { activeBranch, user } = useAuth();
  const toast = useToast();
  const { dateTime } = useFormat();

  const [shipments, setShipments] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form, setForm] = useState({ productId: "", toBranchId: "", quantity: "", reason: "" });
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const otherBranches = (user?.accessibleBranches || []).filter((b) => b.id !== activeBranch?.id);

  const load = async () => {
    setLoading(true);
    try {
      const [ship, prod] = await Promise.all([apiClient.get("/shipments"), apiClient.get("/products")]);
      setShipments(ship.data.data);
      setProducts(prod.data.data);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBranch?.id]);

  const openShip = () => {
    setForm({ productId: "", toBranchId: otherBranches[0]?.id || "", quantity: "", reason: "" });
    setDrawerOpen(true);
  };

  const submitShip = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await apiClient.post("/shipments", {
        productId: form.productId,
        fromBranchId: activeBranch.id,
        toBranchId: form.toBranchId,
        quantity: Number(form.quantity),
        reason: form.reason.trim() || undefined,
      });
      toast.success("Shipment sent — stock is in transit.");
      setDrawerOpen(false);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const act = async (shipment, action) => {
    setBusyId(shipment.id);
    try {
      await apiClient.post(`/shipments/${shipment.id}/${action}`);
      toast.success(action === "receive" ? "Shipment received." : "Shipment cancelled.");
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const branchName = (id) => (user?.accessibleBranches || []).find((b) => b.id === id)?.name;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="field-label text-teal">Inventory</span>
          <h2 className="font-display text-xl font-semibold text-ink">Shipments</h2>
          <p className="mt-0.5 text-sm text-ink-soft">
            {activeBranch?.name ? `Sending from ${activeBranch.name}. ` : ""}Stock leaves on ship and lands when the destination receives it.
          </p>
        </div>
        <button
          type="button"
          onClick={openShip}
          disabled={otherBranches.length === 0}
          title={otherBranches.length === 0 ? "You need access to another branch to ship stock" : undefined}
          className="btn-solid btn-solid-primary btn-solid-sm"
        >
          + Ship stock
        </button>
      </div>

      {loading && shipments.length === 0 ? (
        <TableSkeleton rows={4} />
      ) : shipments.length === 0 ? (
        <EmptyState
          icon="🚚"
          title="No shipments yet"
          hint="Ship stock to another branch — it moves in two steps so goods in transit are always accounted for."
          actionLabel={otherBranches.length ? "Ship stock" : undefined}
          onAction={otherBranches.length ? openShip : undefined}
        />
      ) : (
        <div className="panel" style={ACCENT_STYLE}>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-paper-line bg-paper">
              <tr>
                <th className="px-4 py-2 font-medium text-ink-soft">Product</th>
                <th className="px-4 py-2 font-medium text-ink-soft">Route</th>
                <th className="px-4 py-2 font-medium text-ink-soft">Qty</th>
                <th className="px-4 py-2 font-medium text-ink-soft">Status</th>
                <th className="px-4 py-2 font-medium text-ink-soft">Shipped</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {shipments.map((s) => {
                const incoming = s.to_branch_id === activeBranch?.id;
                const outgoing = s.from_branch_id === activeBranch?.id;
                return (
                  <tr key={s.id} className="border-b border-paper-line last:border-0">
                    <td className="px-4 py-2 text-ink">{s.product_name}</td>
                    <td className="px-4 py-2 text-ink-soft">
                      {s.from_branch_name || branchName(s.from_branch_id)} → {s.to_branch_name || branchName(s.to_branch_id)}
                    </td>
                    <td className="px-4 py-2 font-mono text-ink">{s.quantity}</td>
                    <td className="px-4 py-2">
                      <StatusChip tone={STATUS_TONE[s.status] || "neutral"}>{STATUS_LABEL[s.status] || s.status}</StatusChip>
                    </td>
                    <td className="px-4 py-2 text-ink-soft">{s.shipped_at ? dateTime(s.shipped_at) : "—"}</td>
                    <td className="px-4 py-2 text-right">
                      {s.status === "in_transit" && incoming && (
                        <button type="button" disabled={busyId === s.id} onClick={() => act(s, "receive")} className="btn-link btn-link-primary">
                          Receive
                        </button>
                      )}
                      {s.status === "in_transit" && outgoing && !incoming && (
                        <button type="button" disabled={busyId === s.id} onClick={() => act(s, "cancel")} className="btn-link text-clay hover:underline">
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title={`Ship from ${activeBranch?.name || "this branch"}`}>
        <form onSubmit={submitShip} className="space-y-4">
          <div>
            <label htmlFor="productId" className="field-label mb-1 block">
              Product
            </label>
            <select id="productId" required value={form.productId} onChange={(e) => setForm((p) => ({ ...p, productId: e.target.value }))} className={inputClass}>
              <option value="">Select a product…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="toBranchId" className="field-label mb-1 block">
              Destination branch
            </label>
            <select id="toBranchId" required value={form.toBranchId} onChange={(e) => setForm((p) => ({ ...p, toBranchId: e.target.value }))} className={inputClass}>
              {otherBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="quantity" className="field-label mb-1 block">
              Quantity
            </label>
            <input id="quantity" type="number" min="1" step="1" required value={form.quantity} onChange={(e) => setForm((p) => ({ ...p, quantity: e.target.value }))} className={inputClass} />
          </div>
          <div>
            <label htmlFor="reason" className="field-label mb-1 block">
              Reason <span className="normal-case text-ink-soft">(optional)</span>
            </label>
            <input id="reason" value={form.reason} onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))} className={inputClass} />
          </div>
          <button type="submit" disabled={submitting} className="btn-solid btn-solid-primary">
            {submitting ? "Shipping…" : "Ship stock"}
          </button>
        </form>
      </Drawer>
    </div>
  );
}
