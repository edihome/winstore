/**
 * ============================================================
 * File: StockPage.jsx
 * Module: Inventory (Stock)
 *
 * Description:
 * Shows current per-branch stock levels and lets staff record stock
 * movements (receive stock, sell/deduct, adjust). Every quantity
 * change goes through POST /stock-movements — there's no direct
 * "edit quantity" anywhere, so there's always an audit trail.
 * ============================================================
 */

import { useEffect, useState } from "react";
import apiClient from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useFormat } from "../utils/format";
import BulkImportControls from "../components/BulkImportControls";
import StatusChip from "../components/StatusChip";
import { TableSkeleton } from "../components/Skeleton";
import { useTableKit, useServerTable, TablePager } from "../components/tableKit";

const initialForm = { productId: "", movementType: "in", quantity: "", reason: "", expiryDate: "" };
const initialTransfer = { productId: "", toBranchId: "", quantity: "", reason: "" };

const DAY_MS = 24 * 60 * 60 * 1000;

const isExpiringSoon = (expiryDate) => {
  if (!expiryDate) return false;
  return new Date(expiryDate).getTime() - Date.now() <= 30 * DAY_MS;
};

// Inventory's card/panel accent (shared with ProductsPage). See
// index.css's .ledger-card/.panel --card-accent/--card-glow.
const ACCENT_STYLE = { "--card-accent": "var(--color-moss)", "--card-glow": "rgba(111, 125, 46, 0.35)" };

const MOVEMENT_LABELS = {
  in: "Stock in",
  out: "Stock out",
  adjustment: "Adjustment",
};

export default function StockPage() {
  const { activeBranch, user } = useAuth();
  const toast = useToast();
  const { date, dateTime } = useFormat();
  const [stock, setStock] = useState([]);
  const [products, setProducts] = useState([]);
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [savingReorderId, setSavingReorderId] = useState(null);
  const [transfer, setTransfer] = useState(initialTransfer);
  const [transferring, setTransferring] = useState(false);

  // Branches the user can move stock to — every accessible branch except the
  // one they're currently viewing (the transfer source). Only owners/admins
  // reach this page (Inventory is admin-only), and stock transfer needs at
  // least two branches to be meaningful.
  const otherBranches = (user?.accessibleBranches || []).filter((branch) => branch.id !== activeBranch.id);

  const stockKit = useTableKit(stock, { pageSize: 10, defaultSort: { key: "productName", dir: "asc" } });
  // The movement ledger grows without bound — paged from the server.
  const movementsKit = useServerTable(
    ({ page, limit, sortKey, sortDir }) =>
      apiClient.get("/stock-movements", { params: { page, limit, sortKey, sortDir, branchId: activeBranch.id } }),
    { pageSize: 10, defaultSort: { key: "createdAt", dir: "desc" }, deps: [activeBranch.id] }
  );

  const loadAll = async () => {
    setLoading(true);
    setError("");
    try {
      const [stockRes, productsRes, batchesRes] = await Promise.all([
        apiClient.get("/inventory", { params: { branchId: activeBranch.id } }),
        apiClient.get("/products"),
        apiClient.get("/inventory/batches", { params: { branchId: activeBranch.id } }),
      ]);
      setStock(stockRes.data.data);
      setProducts(productsRes.data.data);
      setBatches(batchesRes.data.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const saveReorderLevel = async (row, rawValue) => {
    const reorderLevel = Number(rawValue);
    if (!Number.isInteger(reorderLevel) || reorderLevel < 0 || reorderLevel === row.reorderLevel) {
      return;
    }
    setError("");
    setSavingReorderId(row.id);
    try {
      await apiClient.patch("/inventory/reorder-level", {
        branchId: activeBranch.id,
        productId: row.productId,
        reorderLevel,
      });
      toast.success(`Reorder level for ${row.productName} set to ${reorderLevel}.`);
      await loadAll();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingReorderId(null);
    }
  };

  useEffect(() => {
    loadAll();
    // Reload whenever the acting branch changes (header switcher), not
    // just on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBranch.id]);

  const handleChange = (event) => {
    setForm((prev) => ({ ...prev, [event.target.name]: event.target.value }));
  };

  const handleTransferChange = (event) => {
    setTransfer((prev) => ({ ...prev, [event.target.name]: event.target.value }));
  };

  const handleTransfer = async (event) => {
    event.preventDefault();
    setError("");
    setTransferring(true);
    try {
      const { data } = await apiClient.post("/stock-movements/transfer", {
        productId: transfer.productId,
        fromBranchId: activeBranch.id,
        toBranchId: transfer.toBranchId,
        quantity: Number(transfer.quantity),
        reason: transfer.reason || undefined,
      });
      const result = data.data;
      toast.success(
        `Transferred ${result.quantity} ${result.product.name} to ${result.toBranch.name}. ` +
          `${activeBranch.name} now has ${result.fromQuantityAfter}.`
      );
      setTransfer(initialTransfer);
      await loadAll();
      movementsKit.reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setTransferring(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await apiClient.post("/stock-movements", {
        branchId: activeBranch.id,
        productId: form.productId,
        movementType: form.movementType,
        quantity: Number(form.quantity),
        reason: form.reason || undefined,
        expiryDate: form.movementType === "in" ? form.expiryDate || undefined : undefined,
      });
      toast.success("Stock movement recorded.");
      setForm(initialForm);
      await loadAll();
      movementsKit.reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <span className="field-label text-moss">Inventory</span>
        <h2 className="font-display text-xl font-semibold text-ink">
          Stock — {activeBranch.name || "your branch"}
        </h2>
      </div>

      {error && (
        <p className="mb-4 rounded border border-clay/30 bg-clay-soft px-3 py-2 text-sm text-clay">
          {error}
        </p>
      )}

      <div className="mb-6">
        <BulkImportControls
          resource="stock-movements"
          label="stock movements"
          onImported={() => {
            loadAll();
            movementsKit.reload();
          }}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-1 min-w-0">
        <form onSubmit={handleSubmit} className="ledger-card space-y-3 py-6 pr-6 min-w-0" style={ACCENT_STYLE}>
          <p className="field-label">Record a stock movement</p>

          <div>
            <label htmlFor="productId" className="field-label mb-1 block">
              Product
            </label>
            <select
              id="productId"
              name="productId"
              required
              value={form.productId}
              onChange={handleChange}
              className="w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal"
            >
              <option value="" disabled>
                Select a product
              </option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} ({product.sku})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="movementType" className="field-label mb-1 block">
              Type
            </label>
            <select
              id="movementType"
              name="movementType"
              value={form.movementType}
              onChange={handleChange}
              className="w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal"
            >
              <option value="in">Stock in (receive)</option>
              <option value="out">Stock out (sell/use)</option>
              <option value="adjustment">Adjustment (+/-)</option>
            </select>
          </div>

          <div>
            <label htmlFor="quantity" className="field-label mb-1 block">
              {form.movementType === "adjustment" ? "Quantity change (+/-)" : "Quantity"}
            </label>
            <input
              id="quantity"
              name="quantity"
              type="number"
              step="1"
              required
              value={form.quantity}
              onChange={handleChange}
              placeholder={form.movementType === "adjustment" ? "e.g. -3" : "e.g. 10"}
              className="w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal"
            />
          </div>

          <div>
            <label htmlFor="reason" className="field-label mb-1 block">
              Reason <span className="normal-case text-ink-soft">(optional)</span>
            </label>
            <input
              id="reason"
              name="reason"
              value={form.reason}
              onChange={handleChange}
              placeholder="e.g. Supplier delivery"
              className="w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal"
            />
          </div>

          {form.movementType === "in" && (
            <div>
              <label htmlFor="expiryDate" className="field-label mb-1 block">
                Expiry date <span className="normal-case text-ink-soft">(optional)</span>
              </label>
              <input
                id="expiryDate"
                name="expiryDate"
                type="date"
                value={form.expiryDate}
                onChange={handleChange}
                className="w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal"
              />
              <p className="mt-1 text-xs text-ink-soft">
                Tracked as a batch and consumed first-expiry-first when this stock is sold or used.
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || products.length === 0}
            className={`btn-solid ${
              form.movementType === "out"
                ? "btn-solid-danger"
                : form.movementType === "adjustment"
                ? "btn-solid-warning"
                : "btn-solid-success"
            }`}
          >
            {submitting ? "Recording…" : "Record movement"}
          </button>
          {products.length === 0 && !loading && (
            <p className="text-xs text-ink-soft">Add a product first in the Products tab.</p>
          )}
        </form>

        {otherBranches.length > 0 && (
          <form onSubmit={handleTransfer} className="ledger-card space-y-3 py-6 pr-6 min-w-0" style={ACCENT_STYLE}>
            <div>
              <p className="field-label">Transfer to another branch</p>
              <p className="mt-1 text-xs text-ink-soft">
                Moves stock out of {activeBranch.name || "this branch"} and into another branch, carrying any
                tracked expiry dates with it.
              </p>
            </div>

            <div>
              <label htmlFor="transferProductId" className="field-label mb-1 block">
                Product
              </label>
              <select
                id="transferProductId"
                name="productId"
                required
                value={transfer.productId}
                onChange={handleTransferChange}
                className="w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal"
              >
                <option value="" disabled>
                  Select a product
                </option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} ({product.sku})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="toBranchId" className="field-label mb-1 block">
                Destination branch
              </label>
              <select
                id="toBranchId"
                name="toBranchId"
                required
                value={transfer.toBranchId}
                onChange={handleTransferChange}
                className="w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal"
              >
                <option value="" disabled>
                  Select a branch
                </option>
                {otherBranches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                    {branch.code ? ` (${branch.code})` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="transferQuantity" className="field-label mb-1 block">
                Quantity
              </label>
              <input
                id="transferQuantity"
                name="quantity"
                type="number"
                min="1"
                step="1"
                required
                value={transfer.quantity}
                onChange={handleTransferChange}
                placeholder="e.g. 10"
                className="w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal"
              />
            </div>

            <div>
              <label htmlFor="transferReason" className="field-label mb-1 block">
                Reason <span className="normal-case text-ink-soft">(optional)</span>
              </label>
              <input
                id="transferReason"
                name="reason"
                value={transfer.reason}
                onChange={handleTransferChange}
                placeholder="e.g. Restocking Branch B"
                className="w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal"
              />
            </div>

            <button type="submit" disabled={transferring || products.length === 0} className="btn-solid">
              {transferring ? "Transferring…" : "Transfer stock"}
            </button>
          </form>
        )}
        </div>

        <div className="space-y-6 lg:col-span-2 min-w-0">
          <div>
            <p className="field-label mb-2">Current stock</p>
            {loading ? (
              <TableSkeleton rows={6} />
            ) : stock.length === 0 ? (
              <p className="text-sm text-ink-soft">No stock recorded yet at this branch.</p>
            ) : (
              <>
              <div className="panel" style={ACCENT_STYLE}>
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-paper-line bg-paper">
                    <tr>
                      <th className="px-4 py-2 font-medium text-ink-soft">Product</th>
                      <th className="px-4 py-2 font-medium text-ink-soft">SKU</th>
                      <th className="px-4 py-2 font-medium text-ink-soft">Quantity</th>
                      <th className="px-4 py-2 font-medium text-ink-soft">Reorder level</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockKit.visible.map((row) => (
                      <tr key={row.id} className="border-b border-paper-line last:border-0">
                        <td className="px-4 py-2 text-ink">{row.productName}</td>
                        <td className="px-4 py-2 font-mono text-xs text-ink-soft">{row.productSku}</td>
                        <td className="px-4 py-2">
                          <span className="inline-flex items-center gap-1.5 font-mono text-xs text-ink-soft">
                            {row.quantity}
                            {row.isLowStock && <StatusChip tone={row.quantity === 0 ? "danger" : "warning"}>low</StatusChip>}
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          <input
                            key={`${row.id}-${row.reorderLevel}`}
                            type="number"
                            min="0"
                            step="1"
                            defaultValue={row.reorderLevel}
                            disabled={savingReorderId === row.id}
                            onBlur={(event) => saveReorderLevel(row, event.target.value)}
                            className="w-20 rounded border border-paper-line bg-white px-2 py-1 font-mono text-xs text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TablePager kit={stockKit} noun="products" />
              </>
            )}
          </div>

          {batches.length > 0 && (
            <div>
              <p className="field-label mb-2">Batches on hand (soonest expiry first)</p>
              <div className="panel" style={ACCENT_STYLE}>
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-paper-line bg-paper">
                    <tr>
                      <th className="px-4 py-2 font-medium text-ink-soft">Product</th>
                      <th className="px-4 py-2 font-medium text-ink-soft">Quantity</th>
                      <th className="px-4 py-2 font-medium text-ink-soft">Expiry date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map((batch) => (
                      <tr key={batch.id} className="border-b border-paper-line last:border-0">
                        <td className="px-4 py-2 text-ink">{batch.productName}</td>
                        <td className="px-4 py-2 font-mono text-xs text-ink-soft">{batch.quantity}</td>
                        <td className="px-4 py-2">
                          {batch.expiryDate ? (
                            <span
                              className={`font-mono text-xs ${
                                isExpiringSoon(batch.expiryDate) ? "font-semibold text-clay" : "text-ink-soft"
                              }`}
                            >
                              {date(batch.expiryDate)}
                              {isExpiringSoon(batch.expiryDate) && " · expiring soon"}
                            </span>
                          ) : (
                            <span className="text-xs text-ink-soft">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div>
            <p className="field-label mb-2">Recent movements</p>
            {movementsKit.loading && movementsKit.visible.length === 0 ? (
              <TableSkeleton rows={5} />
            ) : movementsKit.total === 0 ? (
              <p className="text-sm text-ink-soft">No movements recorded yet.</p>
            ) : (
              <>
              <div className="panel" style={ACCENT_STYLE}>
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-paper-line bg-paper">
                    <tr>
                      <th className="px-4 py-2 font-medium text-ink-soft">When</th>
                      <th className="px-4 py-2 font-medium text-ink-soft">Product</th>
                      <th className="px-4 py-2 font-medium text-ink-soft">Type</th>
                      <th className="px-4 py-2 font-medium text-ink-soft">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movementsKit.visible.map((movement) => (
                      <tr key={movement.id} className="border-b border-paper-line last:border-0">
                        <td className="px-4 py-2 font-mono text-xs text-ink-soft">
                          {dateTime(movement.createdAt)}
                        </td>
                        <td className="px-4 py-2 text-ink">{movement.productName}</td>
                        <td className="px-4 py-2 text-ink-soft">
                          {MOVEMENT_LABELS[movement.movementType] || movement.movementType}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs">
                          <span className={movement.quantityChange < 0 ? "text-clay" : "text-signal"}>
                            {movement.quantityChange > 0 ? "+" : ""}
                            {movement.quantityChange}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TablePager kit={movementsKit} noun="movements" />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
