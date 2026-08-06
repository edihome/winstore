/**
 * ============================================================
 * File: InventoryPage.jsx
 * Module: Inventory (Products & Stock — merged)
 *
 * Description:
 * One page for the catalog AND its quantities. Replaces the old split
 * between ProductsPage (what we sell) and StockPage (how many we have),
 * which forced staff to hold the same product in their head across two
 * screens and made "add a product, then go and stock it" a two-page job.
 *
 * The model this reflects: a product IS its stock. Creating a product
 * takes an opening quantity in the same form, so entering stock for the
 * first time is what brings the product into existence. After that the
 * quantity only ever moves through /stock-movements (never a direct
 * edit), so there is always an audit trail — and a product that sells
 * out stays on the list at quantity 0 rather than disappearing.
 * ============================================================
 */

import { useEffect, useState } from "react";
import apiClient from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useFormat } from "../utils/format";
import BulkImportControls from "../components/BulkImportControls";
import ConfirmAction from "../components/ConfirmAction";
import DeleteButton from "../components/DeleteButton";
import Drawer from "../components/Drawer";
import EmptyState from "../components/EmptyState";
import StatusChip from "../components/StatusChip";
import { TableSkeleton } from "../components/Skeleton";
import { useTableKit, useServerTable, SortableTh, TablePager } from "../components/tableKit";

const initialProductForm = {
  name: "",
  sku: "",
  barcode: "",
  categoryId: "",
  price: "",
  cost: "",
  reorderLevel: "",
  quantity: "",
  expiryDate: "",
};

const initialForm = { productId: "", movementType: "in", quantity: "", reason: "", expiryDate: "" };
const initialTransfer = { productId: "", toBranchId: "", quantity: "", reason: "" };

const DAY_MS = 24 * 60 * 60 * 1000;

const isExpiringSoon = (expiryDate) => {
  if (!expiryDate) return false;
  return new Date(expiryDate).getTime() - Date.now() <= 30 * DAY_MS;
};

// Inventory's card/panel accent. See index.css's .ledger-card/.panel.
const ACCENT_STYLE = { "--card-accent": "var(--color-moss)", "--card-glow": "rgba(111, 125, 46, 0.35)" };

const MOVEMENT_LABELS = {
  in: "Stock in",
  out: "Stock out",
  adjustment: "Adjustment",
};

const inputClass =
  "w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal";

export default function InventoryPage() {
  const { activeBranch, user, hasPermission } = useAuth();
  const toast = useToast();
  const { money, currency, date, dateTime } = useFormat();

  const [stock, setStock] = useState([]);
  const [categories, setCategories] = useState([]);
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [productForm, setProductForm] = useState(initialProductForm);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [creating, setCreating] = useState(false);

  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [savingReorderId, setSavingReorderId] = useState(null);
  const [transfer, setTransfer] = useState(initialTransfer);
  const [transferring, setTransferring] = useState(false);

  // Everyone who can read the catalog sees this page and its quantities; only
  // the matching grant can act. The three capabilities are deliberately kept
  // apart because the API gates them separately — hiding a control the server
  // would refuse anyway is the point, and lumping them would hide controls a
  // user actually holds.
  const canManageProducts = hasPermission("products"); // add/activate/deactivate/import
  const canMoveStock = hasPermission("stock_movements"); // receive, adjust, transfer
  const canSetReorderLevel = hasPermission("inventory"); // the reorder threshold

  // Branches stock can move to — every accessible branch except the one being
  // viewed (the transfer source).
  const otherBranches = (user?.accessibleBranches || []).filter((branch) => branch.id !== activeBranch.id);

  // One list drives both the table and the product pickers below it: since the
  // merge, /inventory returns every product for the branch (quantity 0 when it
  // has never been stocked), so there is no second /products fetch to keep in
  // step with this one.
  const stockKit = useTableKit(stock, {
    pageSize: 12,
    searchText: search,
    searchFn: (row) => `${row.productName} ${row.productSku} ${row.productBarcode || ""} ${row.categoryName || ""}`,
    defaultSort: { key: "productName", dir: "asc" },
  });

  // The movement ledger grows without bound — paged from the server. It lives
  // behind the stock_movements grant, so for a read-only viewer we resolve an
  // empty page rather than firing a request the API would 403.
  const movementsKit = useServerTable(
    ({ page, limit, sortKey, sortDir }) =>
      canMoveStock
        ? apiClient.get("/stock-movements", { params: { page, limit, sortKey, sortDir, branchId: activeBranch.id } })
        : Promise.resolve({ data: [], pagination: { total: 0 } }),
    { pageSize: 10, defaultSort: { key: "createdAt", dir: "desc" }, deps: [activeBranch.id, canMoveStock] }
  );

  const sellableProducts = stock.filter((row) => row.productStatus !== "inactive");

  // A product may never be priced below what it cost to buy — the server
  // refuses it either way, but catching it here means the user is told while
  // the wrong number is still in front of them, not after a round trip.
  // Equal is fine (selling at cost is a clearance price).
  const belowCost =
    productForm.price !== "" &&
    productForm.cost !== "" &&
    Number(productForm.price) < Number(productForm.cost);

  const loadAll = async () => {
    setLoading(true);
    setError("");
    try {
      const [stockRes, batchesRes] = await Promise.all([
        apiClient.get("/inventory", { params: { branchId: activeBranch.id } }),
        apiClient.get("/inventory/batches", { params: { branchId: activeBranch.id } }),
      ]);
      setStock(stockRes.data.data);
      setBatches(batchesRes.data.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }

    // Categories only feed the create drawer, and a read-only viewer may not
    // hold the categories grant — so this is a separate, swallowed request
    // rather than part of the Promise.all above, where a 403 would take the
    // stock list down with it.
    if (canManageProducts) {
      try {
        const categoriesRes = await apiClient.get("/categories");
        setCategories(categoriesRes.data.data);
      } catch {
        /* the drawer can fall back to "No category" */
      }
    }
  };

  useEffect(() => {
    loadAll();
    // Reload whenever the acting branch changes (header switcher), not just on
    // mount — quantities are per branch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBranch.id]);

  const handleProductChange = (event) => {
    setProductForm((prev) => ({ ...prev, [event.target.name]: event.target.value }));
  };

  const handleChange = (event) => {
    setForm((prev) => ({ ...prev, [event.target.name]: event.target.value }));
  };

  const handleTransferChange = (event) => {
    setTransfer((prev) => ({ ...prev, [event.target.name]: event.target.value }));
  };

  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) return;
    setAddingCategory(true);
    try {
      const response = await apiClient.post("/categories", { name: newCategoryName.trim() });
      setNewCategoryName("");
      setCategories((prev) => [...prev, response.data.data]);
      setProductForm((prev) => ({ ...prev, categoryId: response.data.data.id }));
      toast.success(`Category "${response.data.data.name}" added.`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setAddingCategory(false);
    }
  };

  // Create the product AND its opening stock in one submit — the whole point of
  // the merge. `openingStock` is recorded by the products module as a stock
  // movement, so a product that starts with 30 on the shelf has a movement
  // explaining where those 30 came from.
  const handleCreateProduct = async (event) => {
    event.preventDefault();
    setCreating(true);
    try {
      await apiClient.post("/products", {
        name: productForm.name,
        sku: productForm.sku,
        barcode: productForm.barcode || undefined,
        categoryId: productForm.categoryId || undefined,
        price: Number(productForm.price),
        cost: Number(productForm.cost || 0),
        reorderLevel: productForm.reorderLevel !== "" ? Number(productForm.reorderLevel) : undefined,
        openingStock: productForm.quantity !== "" ? Number(productForm.quantity) : undefined,
        openingStockExpiryDate: productForm.expiryDate || undefined,
        branchId: activeBranch?.id,
      });
      const opening = Number(productForm.quantity || 0);
      toast.success(
        opening > 0
          ? `${productForm.name} added with ${opening} in stock.`
          : `${productForm.name} added — out of stock until you receive some.`
      );
      setProductForm(initialProductForm);
      setDrawerOpen(false);
      await loadAll();
      movementsKit.reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCreating(false);
    }
  };

  const saveReorderLevel = async (row, rawValue) => {
    const reorderLevel = Number(rawValue);
    if (!Number.isInteger(reorderLevel) || reorderLevel < 0 || reorderLevel === row.reorderLevel) {
      return;
    }
    setError("");
    setSavingReorderId(row.productId);
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

  const toggleActive = async (row) => {
    try {
      await apiClient.patch(`/products/${row.productId}`, {
        status: row.productStatus === "active" ? "inactive" : "active",
      });
      toast.success(`${row.productName} ${row.productStatus === "active" ? "deactivated" : "activated"}.`);
      await loadAll();
    } catch (err) {
      toast.error(err.message);
    }
  };

  // Row shortcut: load this product into the movement form rather than making
  // the user find it again in a dropdown of hundreds.
  const receiveStockFor = (row) => {
    setForm({ ...initialForm, productId: row.productId, movementType: "in" });
    document.getElementById("stock-movement-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
    document.getElementById("quantity")?.focus({ preventScroll: true });
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

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="field-label text-moss">Inventory</span>
          <h2 className="font-display text-xl font-semibold text-ink">
            Products &amp; stock — {activeBranch.name || "your branch"}
          </h2>
        </div>
        {canManageProducts && (
          <div className="flex items-center gap-2">
            <BulkImportControls resource="products" label="products" onImported={loadAll} />
            <button type="button" onClick={() => setDrawerOpen(true)} className="btn-solid btn-solid-primary btn-solid-sm">
              + New product
            </button>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded border border-clay/30 bg-clay-soft px-3 py-2 text-sm text-clay">
          {error}
        </p>
      )}

      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search by name, SKU, barcode, or category…"
        aria-label="Search products"
        className={`mb-3 max-w-md ${inputClass}`}
      />

      {loading && stock.length === 0 ? (
        <TableSkeleton rows={8} />
      ) : stock.length === 0 ? (
        <EmptyState
          icon="📦"
          title="No products yet"
          hint={
            canManageProducts
              ? "Add a product with the quantity you have on the shelf — that first entry creates it and stocks it in one step."
              : "Nothing has been added to the catalog yet."
          }
          actionLabel={canManageProducts ? "Add your first product" : undefined}
          onAction={canManageProducts ? () => setDrawerOpen(true) : undefined}
        />
      ) : stockKit.visible.length === 0 ? (
        <EmptyState icon="🔍" title="No products match your search" hint="Try a different name, SKU, or barcode." />
      ) : (
        <>
          <div className="panel" style={ACCENT_STYLE}>
            <table className="w-full text-left text-sm">
              <thead className="border-b border-paper-line bg-paper">
                <tr>
                  <SortableTh kit={stockKit} sortKey="productName">Product</SortableTh>
                  <SortableTh kit={stockKit} sortKey="productSku">SKU</SortableTh>
                  <th className="hidden px-4 py-2 font-medium text-ink-soft lg:table-cell">Barcode</th>
                  <SortableTh kit={stockKit} sortKey="categoryName" className="hidden sm:table-cell">Category</SortableTh>
                  <SortableTh kit={stockKit} sortKey="productPrice">Price</SortableTh>
                  <SortableTh kit={stockKit} sortKey="quantity">In stock</SortableTh>
                  <th className="px-4 py-2 font-medium text-ink-soft">Reorder at</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {stockKit.visible.map((row) => (
                  <tr key={row.productId} className="border-b border-paper-line last:border-0">
                    <td className="px-4 py-2 text-ink">
                      {row.productName}
                      {row.productStatus === "inactive" && (
                        <span className="ml-2">
                          <StatusChip tone="neutral">inactive</StatusChip>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-ink-soft">{row.productSku}</td>
                    <td className="hidden px-4 py-2 font-mono text-xs text-ink-soft lg:table-cell">
                      {row.productBarcode || "—"}
                    </td>
                    <td className="hidden px-4 py-2 text-ink-soft sm:table-cell">{row.categoryName || "—"}</td>
                    <td className="px-4 py-2 font-mono text-xs text-ink">{money(row.productPrice)}</td>
                    <td className="px-4 py-2">
                      <span className="inline-flex items-center gap-1.5 font-mono text-xs text-ink">
                        {row.quantity}
                        {row.outOfStock ? (
                          <StatusChip tone="danger">out of stock</StatusChip>
                        ) : (
                          row.isLowStock && <StatusChip tone="warning">low</StatusChip>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      {canSetReorderLevel ? (
                        <input
                          key={`${row.productId}-${row.reorderLevel}`}
                          type="number"
                          min="0"
                          step="1"
                          aria-label={`Reorder level for ${row.productName}`}
                          defaultValue={row.reorderLevel}
                          disabled={savingReorderId === row.productId}
                          onBlur={(event) => saveReorderLevel(row, event.target.value)}
                          className="w-20 rounded border border-paper-line bg-white px-2 py-1 font-mono text-xs text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal"
                        />
                      ) : (
                        <span className="font-mono text-xs text-ink-soft">{row.reorderLevel}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        {canMoveStock && (
                          <button type="button" onClick={() => receiveStockFor(row)} className="btn-link btn-link-success">
                            Receive
                          </button>
                        )}
                        {canManageProducts &&
                          (row.productStatus === "active" ? (
                            <ConfirmAction label="Deactivate" onConfirm={() => toggleActive(row)} />
                          ) : (
                            <button type="button" onClick={() => toggleActive(row)} className="btn-link btn-link-success">
                              Activate
                            </button>
                          ))}
                        {user?.role === "developer" && (
                          <DeleteButton
                            resource="products"
                            id={row.productId}
                            label={row.productName}
                            onDeleted={loadAll}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePager kit={stockKit} noun="products" />
        </>
      )}

      <div className={`mt-8 grid gap-6 ${canMoveStock ? "lg:grid-cols-3" : ""}`}>
        {canMoveStock && (
        <div className="space-y-6 lg:col-span-1 min-w-0">
          <form
            id="stock-movement-form"
            onSubmit={handleSubmit}
            className="ledger-card space-y-3 py-6 pr-6 min-w-0"
            style={ACCENT_STYLE}
          >
            <p className="field-label">Record a stock movement</p>

            <div>
              <label htmlFor="productId" className="field-label mb-1 block">
                Product
              </label>
              <select id="productId" name="productId" required value={form.productId} onChange={handleChange} className={inputClass}>
                <option value="" disabled>
                  Select a product
                </option>
                {sellableProducts.map((row) => (
                  <option key={row.productId} value={row.productId}>
                    {row.productName} ({row.productSku}) — {row.quantity} on hand
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="movementType" className="field-label mb-1 block">
                Type
              </label>
              <select id="movementType" name="movementType" value={form.movementType} onChange={handleChange} className={inputClass}>
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
                className={inputClass}
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
                className={inputClass}
              />
            </div>

            {form.movementType === "in" && (
              <div>
                <label htmlFor="expiryDate" className="field-label mb-1 block">
                  Expiry date <span className="normal-case text-ink-soft">(optional)</span>
                </label>
                <input id="expiryDate" name="expiryDate" type="date" value={form.expiryDate} onChange={handleChange} className={inputClass} />
                <p className="mt-1 text-xs text-ink-soft">
                  Tracked as a batch and consumed first-expiry-first when this stock is sold or used.
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || sellableProducts.length === 0}
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
            {sellableProducts.length === 0 && !loading && (
              <p className="text-xs text-ink-soft">Add a product above first — it can start at any quantity.</p>
            )}
          </form>

          {otherBranches.length > 0 && (
            <form onSubmit={handleTransfer} className="ledger-card space-y-3 py-6 pr-6 min-w-0" style={ACCENT_STYLE}>
              <div>
                <p className="field-label">Transfer to another branch</p>
                <p className="mt-1 text-xs text-ink-soft">
                  Moves stock out of {activeBranch.name || "this branch"} and into another branch, carrying any tracked
                  expiry dates with it.
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
                  className={inputClass}
                >
                  <option value="" disabled>
                    Select a product
                  </option>
                  {sellableProducts.map((row) => (
                    <option key={row.productId} value={row.productId}>
                      {row.productName} ({row.productSku}) — {row.quantity} on hand
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
                  className={inputClass}
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
                  className={inputClass}
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
                  className={inputClass}
                />
              </div>

              <button type="submit" disabled={transferring || sellableProducts.length === 0} className="btn-solid">
                {transferring ? "Transferring…" : "Transfer stock"}
              </button>
            </form>
          )}
        </div>
        )}

        <div className={`space-y-6 min-w-0 ${canMoveStock ? "lg:col-span-2" : ""}`}>
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

          {canMoveStock && (
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
                          <td className="px-4 py-2 font-mono text-xs text-ink-soft">{dateTime(movement.createdAt)}</td>
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
          )}
        </div>
      </div>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="New product"
        subtitle="Enter what you have on the shelf — that first quantity creates the product and stocks it."
      >
        <form onSubmit={handleCreateProduct} className="space-y-4">
          <div>
            <label htmlFor="productName" className="field-label mb-1 block">
              Name
            </label>
            <input
              id="productName"
              name="name"
              required
              autoFocus
              value={productForm.name}
              onChange={handleProductChange}
              placeholder="Shampoo — 500ml"
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="sku" className="field-label mb-1 block">
                SKU
              </label>
              <input id="sku" name="sku" required value={productForm.sku} onChange={handleProductChange} placeholder="SHM-500" className={inputClass} />
            </div>
            <div>
              <label htmlFor="barcode" className="field-label mb-1 block">
                Barcode <span className="normal-case text-ink-soft">(optional)</span>
              </label>
              <input
                id="barcode"
                name="barcode"
                value={productForm.barcode}
                onChange={handleProductChange}
                placeholder="6009999999995"
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label htmlFor="categoryId" className="field-label mb-1 block">
              Category <span className="normal-case text-ink-soft">(optional)</span>
            </label>
            <select id="categoryId" name="categoryId" value={productForm.categoryId} onChange={handleProductChange} className={inputClass}>
              <option value="">No category</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <div className="mt-2 flex gap-2">
              <input
                value={newCategoryName}
                onChange={(event) => setNewCategoryName(event.target.value)}
                placeholder="New category name"
                className="w-full rounded border border-paper-line bg-white px-2 py-1.5 text-xs text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal"
              />
              <button
                type="button"
                onClick={handleAddCategory}
                disabled={addingCategory || !newCategoryName.trim()}
                className="btn-chip btn-chip-primary shrink-0"
              >
                {addingCategory ? "Adding…" : "+ Add"}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="price" className="field-label mb-1 block">
                Selling price ({currency})
              </label>
              <input
                id="price"
                name="price"
                type="number"
                min="0"
                step="0.01"
                required
                value={productForm.price}
                onChange={handleProductChange}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="cost" className="field-label mb-1 block">
                Cost price <span className="normal-case text-ink-soft">(optional)</span>
              </label>
              <input
                id="cost"
                name="cost"
                type="number"
                min="0"
                step="0.01"
                value={productForm.cost}
                onChange={handleProductChange}
                aria-invalid={belowCost || undefined}
                className={`${inputClass} ${belowCost ? "border-clay focus:border-clay focus:ring-clay" : ""}`}
              />
            </div>
          </div>

          {belowCost && (
            <p role="alert" className="rounded border border-clay/30 bg-clay-soft px-3 py-2 text-xs text-clay">
              The selling price ({money(productForm.price)}) is below the cost price ({money(productForm.cost)}). It must
              be the same or higher, or every profit report on this product will be wrong.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="productQuantity" className="field-label mb-1 block">
                Quantity in stock
              </label>
              <input
                id="productQuantity"
                name="quantity"
                type="number"
                min="0"
                step="1"
                value={productForm.quantity}
                onChange={handleProductChange}
                placeholder="e.g. 50"
                className={inputClass}
              />
              <p className="mt-1 text-xs text-ink-soft">Leave blank or 0 if none has arrived yet.</p>
            </div>
            <div>
              <label htmlFor="reorderLevel" className="field-label mb-1 block">
                Reorder at <span className="normal-case text-ink-soft">(optional)</span>
              </label>
              <input
                id="reorderLevel"
                name="reorderLevel"
                type="number"
                min="0"
                step="1"
                value={productForm.reorderLevel}
                onChange={handleProductChange}
                placeholder="e.g. 10"
                className={inputClass}
              />
            </div>
          </div>

          {Number(productForm.quantity) > 0 && (
            <div>
              <label htmlFor="productExpiryDate" className="field-label mb-1 block">
                Expiry date <span className="normal-case text-ink-soft">(optional)</span>
              </label>
              <input
                id="productExpiryDate"
                name="expiryDate"
                type="date"
                value={productForm.expiryDate}
                onChange={handleProductChange}
                className={inputClass}
              />
            </div>
          )}

          {Number(productForm.quantity) > 0 && !activeBranch?.id && (
            <p className="text-xs text-clay">Opening stock needs an active branch — switch branches in the header first.</p>
          )}

          <button type="submit" disabled={creating || belowCost} className="btn-solid btn-solid-primary">
            {creating ? "Adding…" : "Add product"}
          </button>
        </form>
      </Drawer>
    </div>
  );
}
