/**
 * ============================================================
 * File: PurchasesPage.jsx
 * Module: Purchasing
 *
 * Description:
 * Purchase orders: pick a supplier, add products with a quantity
 * and the unit cost negotiated with that supplier, and place the
 * order as "pending". Receiving the order stocks every line item
 * in (visible on Inventory · Stock); cancelling leaves inventory
 * untouched. Both outcomes are terminal.
 * ============================================================
 */

import { useEffect, useState } from "react";
import apiClient from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useFormat } from "../utils/format";
import StatusChip from "../components/StatusChip";
import ConfirmAction from "../components/ConfirmAction";
import { TableSkeleton } from "../components/Skeleton";
import { useServerTable, SortableTh, TablePager } from "../components/tableKit";

// Purchasing's card/panel accent (shared with SuppliersPage/ExpensesPage).
// See index.css's .ledger-card/.panel --card-accent/--card-glow.
const ACCENT_STYLE = { "--card-accent": "var(--color-clay)", "--card-glow": "rgba(163, 69, 43, 0.35)" };

export default function PurchasesPage() {
  const { activeBranch } = useAuth();
  const toast = useToast();
  const { money, currency, dateTime } = useFormat();
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [supplierId, setSupplierId] = useState("");
  const [cart, setCart] = useState([]); // { key, productId, label, quantity, unitCost, lineTotal }
  const [selectedProductId, setSelectedProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitCost, setUnitCost] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const kit = useServerTable(
    ({ page, limit, sortKey, sortDir }) =>
      apiClient.get("/purchases", { params: { page, limit, sortKey, sortDir, branchId: activeBranch.id } }),
    { pageSize: 10, defaultSort: { key: "createdAt", dir: "desc" }, deps: [activeBranch.id] }
  );

  // Suppliers + products feed the "new purchase order" form — bounded, loaded
  // once (and on branch change), separate from the paged orders list.
  const loadBaseData = async () => {
    setError("");
    try {
      const [suppliersRes, productsRes] = await Promise.all([
        apiClient.get("/suppliers"),
        apiClient.get("/products"),
      ]);
      setSuppliers(suppliersRes.data.data);
      setProducts(productsRes.data.data);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    loadBaseData();
  }, [activeBranch.id]);

  const addToCart = () => {
    const product = products.find((p) => p.id === selectedProductId);
    const qty = Number(quantity);
    const cost = Number(unitCost);
    if (!product || !Number.isInteger(qty) || qty <= 0 || !Number.isFinite(cost) || cost < 0) return;

    setCart((prev) => [
      ...prev,
      {
        key: `${product.id}-${Date.now()}`,
        productId: product.id,
        label: `${product.name} × ${qty} @ $${cost.toFixed(2)}`,
        quantity: qty,
        unitCost: cost,
        lineTotal: Math.round(qty * cost * 100) / 100,
      },
    ]);
    setSelectedProductId("");
    setQuantity("1");
    setUnitCost("");
  };

  const removeFromCart = (key) => {
    setCart((prev) => prev.filter((c) => c.key !== key));
  };

  const total = Math.round(cart.reduce((sum, item) => sum + item.lineTotal, 0) * 100) / 100;

  const placeOrder = async () => {
    setError("");
    setNotice("");
    setSubmitting(true);
    try {
      await apiClient.post("/purchases", {
        supplierId,
        branchId: activeBranch.id,
        items: cart.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          unitCost: item.unitCost,
        })),
      });
      toast.success("Purchase order placed — receive it below when the delivery arrives.");
      setCart([]);
      setSupplierId("");
      await loadBaseData();
      kit.reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const setStatus = async (purchase, status) => {
    setError("");
    setNotice("");
    try {
      await apiClient.patch(`/purchases/${purchase.id}/status`, { status });
      toast.success(
        status === "received"
          ? `Received — stock for ${purchase.itemCount} item${purchase.itemCount === 1 ? "" : "s"} has been updated.`
          : "Purchase cancelled."
      );
      await loadBaseData();
      kit.reload();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const statusBadge = (status) => {
    const tone = status === "received" ? "success" : status === "pending" ? "warning" : "danger";
    return <StatusChip tone={tone}>{status}</StatusChip>;
  };

  const inputClass =
    "w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal";

  const activeSuppliers = suppliers.filter((s) => s.status === "active");

  return (
    <div>
      <div className="mb-6">
        <span className="field-label text-clay">Purchasing</span>
        <h2 className="font-display text-xl font-semibold text-ink">Purchase orders</h2>
      </div>

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

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="ledger-card space-y-4 py-6 pr-6 lg:col-span-2 min-w-0" style={ACCENT_STYLE}>
          <div>
            <label htmlFor="supplierId" className="field-label mb-1 block">
              Supplier
            </label>
            <select
              id="supplierId"
              value={supplierId}
              onChange={(event) => setSupplierId(event.target.value)}
              className={inputClass}
            >
              <option value="">Select a supplier</option>
              {activeSuppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
            {activeSuppliers.length === 0 && (
              <p className="mt-1 text-xs text-ink-soft">No active suppliers yet — add one on the Suppliers page.</p>
            )}
          </div>

          <div className="grid grid-cols-[1fr_auto_auto_auto] items-end gap-2">
            <div>
              <label htmlFor="productId" className="field-label mb-1 block">
                Add a product
              </label>
              <select
                id="productId"
                value={selectedProductId}
                onChange={(event) => setSelectedProductId(event.target.value)}
                className={inputClass}
              >
                <option value="">Select a product</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} ({product.sku})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="quantity" className="field-label mb-1 block">
                Qty
              </label>
              <input
                id="quantity"
                type="number"
                min="1"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                className="w-16 rounded border border-paper-line bg-white px-2 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal"
              />
            </div>
            <div>
              <label htmlFor="unitCost" className="field-label mb-1 block">
                Unit cost ({currency})
              </label>
              <input
                id="unitCost"
                type="number"
                min="0"
                step="0.01"
                value={unitCost}
                onChange={(event) => setUnitCost(event.target.value)}
                className="w-24 rounded border border-paper-line bg-white px-2 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal"
              />
            </div>
            <button
              type="button"
              onClick={addToCart}
              disabled={!selectedProductId || unitCost === ""}
              className="btn-chip btn-chip-primary py-2"
            >
              Add
            </button>
          </div>

          <div>
            <p className="field-label mb-1">Order items</p>
            {cart.length === 0 ? (
              <p className="text-sm text-ink-soft">No items yet.</p>
            ) : (
              <div className="space-y-1">
                {cart.map((item) => (
                  <div
                    key={item.key}
                    className="flex items-center justify-between rounded border border-paper-line px-3 py-2 text-sm"
                  >
                    <span className="text-ink">{item.label}</span>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs text-ink-soft">{money(item.lineTotal)}</span>
                      <button type="button" onClick={() => removeFromCart(item.key)} className="btn-link btn-link-danger">
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="ledger-card space-y-4 py-6 pr-6 lg:col-span-1 min-w-0" style={ACCENT_STYLE}>
          <div>
            <p className="field-label">Order total</p>
            <p className="font-display text-3xl font-semibold text-ink">{money(total)}</p>
          </div>

          <button
            type="button"
            onClick={placeOrder}
            disabled={submitting || !supplierId || cart.length === 0}
            className="btn-solid btn-solid-primary"
          >
            {submitting ? "Placing order…" : "Place order"}
          </button>
          <p className="text-xs text-ink-soft">
            Placing an order doesn't change stock — stock goes up when you mark the order received.
          </p>
        </div>
      </div>

      <div className="mt-8">
        <p className="field-label mb-2">Orders</p>
        {kit.loading && kit.visible.length === 0 ? (
          <TableSkeleton rows={5} />
        ) : kit.total === 0 ? (
          <p className="text-sm text-ink-soft">No purchase orders yet.</p>
        ) : (
          <>
          <div className="panel" style={ACCENT_STYLE}>
            <table className="w-full text-left text-sm">
              <thead className="border-b border-paper-line bg-paper">
                <tr>
                  <SortableTh kit={kit} sortKey="createdAt">When</SortableTh>
                  <SortableTh kit={kit} sortKey="supplierName">Supplier</SortableTh>
                  <th className="px-4 py-2 font-medium text-ink-soft">Items</th>
                  <SortableTh kit={kit} sortKey="totalAmount">Total</SortableTh>
                  <SortableTh kit={kit} sortKey="status">Status</SortableTh>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {kit.visible.map((purchase) => (
                  <tr key={purchase.id} className="border-b border-paper-line last:border-0">
                    <td className="px-4 py-2 font-mono text-xs text-ink-soft">
                      {dateTime(purchase.createdAt)}
                    </td>
                    <td className="px-4 py-2 text-ink">{purchase.supplierName}</td>
                    <td className="px-4 py-2 text-ink-soft">{purchase.itemCount}</td>
                    <td className="px-4 py-2 font-mono text-xs text-ink">{money(purchase.totalAmount)}</td>
                    <td className="px-4 py-2">{statusBadge(purchase.status)}</td>
                    <td className="px-4 py-2 text-right">
                      {purchase.status === "pending" && (
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setStatus(purchase, "received")}
                            className="btn-link btn-link-success"
                          >
                            Receive
                          </button>
                          <ConfirmAction label="Cancel" onConfirm={() => setStatus(purchase, "cancelled")} />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePager kit={kit} noun="orders" />
          </>
        )}
      </div>
    </div>
  );
}
