/**
 * ============================================================
 * File: ProductsPage.jsx
 * Module: Inventory (Products)
 *
 * Description:
 * Product catalog in the app's modern list pattern: full-width
 * sortable, paginated, searchable table; "+ Add product" in a
 * slide-over drawer (with inline category creation, so setting up a
 * catalog from scratch doesn't need a separate screen); toasts for
 * outcomes; prices in the organization's own currency.
 * ============================================================
 */

import { useEffect, useState } from "react";
import apiClient from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useFormat } from "../utils/format";
import BulkImportControls from "../components/BulkImportControls";
import DeleteButton from "../components/DeleteButton";
import Drawer from "../components/Drawer";
import EmptyState from "../components/EmptyState";
import StatusChip from "../components/StatusChip";
import ConfirmAction from "../components/ConfirmAction";
import { TableSkeleton } from "../components/Skeleton";
import { useServerTable, SortableTh, TablePager } from "../components/tableKit";

const initialProductForm = {
  name: "",
  sku: "",
  barcode: "",
  categoryId: "",
  price: "",
  cost: "",
  reorderLevel: "",
  openingStock: "",
  openingStockExpiryDate: "",
};

// Inventory's card/panel accent (shared with StockPage).
const ACCENT_STYLE = { "--card-accent": "var(--color-moss)", "--card-glow": "rgba(111, 125, 46, 0.35)" };

export default function ProductsPage() {
  const { activeBranch, user } = useAuth();
  const toast = useToast();
  const { money, currency } = useFormat();
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [productForm, setProductForm] = useState(initialProductForm);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [addingCategory, setAddingCategory] = useState(false);

  const kit = useServerTable(
    ({ page, limit, sortKey, sortDir, search: q }) =>
      apiClient.get("/products", { params: { page, limit, sortKey, sortDir, search: q || undefined } }),
    { pageSize: 12, defaultSort: { key: "name", dir: "asc" }, search: debouncedSearch }
  );

  // Categories feed the create form's dropdown — a small, bounded list loaded
  // once (and refreshed when a category is added), separate from the paged table.
  const loadCategories = async () => {
    try {
      const res = await apiClient.get("/categories");
      setCategories(res.data.data);
    } catch {
      /* the products table surfaces load errors; the dropdown can stay empty */
    }
  };

  useEffect(() => {
    loadCategories();
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timeout);
  }, [search]);

  // Refresh both the table and the category dropdown after a change.
  const loadAll = () => {
    kit.reload();
    loadCategories();
  };

  const handleProductChange = (event) => {
    setProductForm((prev) => ({ ...prev, [event.target.name]: event.target.value }));
  };

  const handleAddCategory = async (event) => {
    event.preventDefault();
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

  const handleProductSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await apiClient.post("/products", {
        name: productForm.name,
        sku: productForm.sku,
        barcode: productForm.barcode || undefined,
        categoryId: productForm.categoryId || undefined,
        price: Number(productForm.price),
        cost: Number(productForm.cost || 0),
        reorderLevel: productForm.reorderLevel !== "" ? Number(productForm.reorderLevel) : undefined,
        openingStock: productForm.openingStock !== "" ? Number(productForm.openingStock) : undefined,
        openingStockExpiryDate: productForm.openingStockExpiryDate || undefined,
        branchId: activeBranch?.id,
      });
      toast.success(`${productForm.name} added to the catalog.`);
      setProductForm(initialProductForm);
      setDrawerOpen(false);
      await loadAll();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (product) => {
    try {
      await apiClient.patch(`/products/${product.id}`, {
        status: product.status === "active" ? "inactive" : "active",
      });
      toast.success(`${product.name} ${product.status === "active" ? "deactivated" : "activated"}.`);
      await loadAll();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const inputClass =
    "w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal";

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="field-label text-moss">Inventory</span>
          <h2 className="font-display text-xl font-semibold text-ink">Product catalog</h2>
        </div>
        <div className="flex items-center gap-2">
          <BulkImportControls resource="products" label="products" onImported={loadAll} />
          <button type="button" onClick={() => setDrawerOpen(true)} className="btn-solid btn-solid-primary btn-solid-sm">
            + Add product
          </button>
        </div>
      </div>

      {kit.error && (
        <p role="alert" className="mb-4 rounded border border-clay/30 bg-clay-soft px-3 py-2 text-sm text-clay">
          {kit.error}
        </p>
      )}

      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search by name, SKU, barcode, or category…"
        aria-label="Search products"
        className={`mb-3 max-w-md ${inputClass}`}
      />

      {kit.loading && kit.visible.length === 0 ? (
        <TableSkeleton rows={8} />
      ) : kit.total === 0 ? (
        debouncedSearch ? (
          <EmptyState icon="🔍" title="No products match your search" hint="Try a different name, SKU, or barcode." />
        ) : (
          <EmptyState
            icon="📦"
            title="No products yet"
            hint="Products you add here become sellable at checkout and tracked per branch on the Stock page."
            actionLabel="Add your first product"
            onAction={() => setDrawerOpen(true)}
          />
        )
      ) : (
        <>
          <div className="panel" style={ACCENT_STYLE}>
            <table className="w-full text-left text-sm">
              <thead className="border-b border-paper-line bg-paper">
                <tr>
                  <SortableTh kit={kit} sortKey="name">Name</SortableTh>
                  <SortableTh kit={kit} sortKey="sku">SKU</SortableTh>
                  <th className="hidden px-4 py-2 font-medium text-ink-soft md:table-cell">Barcode</th>
                  <SortableTh kit={kit} sortKey="categoryName" className="hidden sm:table-cell">Category</SortableTh>
                  <SortableTh kit={kit} sortKey="price">Price</SortableTh>
                  <th className="px-4 py-2 font-medium text-ink-soft">Status</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {kit.visible.map((product) => (
                  <tr key={product.id} className="border-b border-paper-line last:border-0">
                    <td className="px-4 py-2 text-ink">{product.name}</td>
                    <td className="px-4 py-2 font-mono text-xs text-ink-soft">{product.sku}</td>
                    <td className="hidden px-4 py-2 font-mono text-xs text-ink-soft md:table-cell">
                      {product.barcode || "—"}
                    </td>
                    <td className="hidden px-4 py-2 text-ink-soft sm:table-cell">{product.categoryName || "—"}</td>
                    <td className="px-4 py-2 font-mono text-xs text-ink">{money(product.price)}</td>
                    <td className="px-4 py-2">
                      <StatusChip tone={product.status === "active" ? "success" : "neutral"}>
                        {product.status}
                      </StatusChip>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        {product.status === "active" ? (
                          <ConfirmAction label="Deactivate" onConfirm={() => toggleActive(product)} />
                        ) : (
                          <button type="button" onClick={() => toggleActive(product)} className="btn-link btn-link-success">
                            Activate
                          </button>
                        )}
                        {user?.role === "developer" && (
                          <DeleteButton resource="products" id={product.id} label={product.name} onDeleted={loadAll} />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePager kit={kit} noun="products" />
        </>
      )}

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Add a product"
        subtitle="Products become sellable at checkout and tracked per branch."
      >
        <form onSubmit={handleProductSubmit} className="space-y-4">
          <div>
            <label htmlFor="name" className="field-label mb-1 block">
              Name
            </label>
            <input
              id="name"
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
                Price ({currency})
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
                Cost <span className="normal-case text-ink-soft">(optional)</span>
              </label>
              <input
                id="cost"
                name="cost"
                type="number"
                min="0"
                step="0.01"
                value={productForm.cost}
                onChange={handleProductChange}
                className={inputClass}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="reorderLevel" className="field-label mb-1 block">
                Reorder level <span className="normal-case text-ink-soft">(optional)</span>
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
            <div>
              <label htmlFor="openingStock" className="field-label mb-1 block">
                Opening stock <span className="normal-case text-ink-soft">(optional)</span>
              </label>
              <input
                id="openingStock"
                name="openingStock"
                type="number"
                min="0"
                step="1"
                value={productForm.openingStock}
                onChange={handleProductChange}
                placeholder="e.g. 50"
                className={inputClass}
              />
            </div>
          </div>

          {Number(productForm.openingStock) > 0 && (
            <div>
              <label htmlFor="openingStockExpiryDate" className="field-label mb-1 block">
                Opening stock expiry date <span className="normal-case text-ink-soft">(optional)</span>
              </label>
              <input
                id="openingStockExpiryDate"
                name="openingStockExpiryDate"
                type="date"
                value={productForm.openingStockExpiryDate}
                onChange={handleProductChange}
                className={inputClass}
              />
            </div>
          )}

          {productForm.openingStock !== "" && Number(productForm.openingStock) > 0 && !activeBranch?.id && (
            <p className="text-xs text-clay">Opening stock needs an active branch — switch branches in the header first.</p>
          )}

          <button type="submit" disabled={submitting} className="btn-solid btn-solid-primary">
            {submitting ? "Adding…" : "Add product"}
          </button>
        </form>
      </Drawer>
    </div>
  );
}
