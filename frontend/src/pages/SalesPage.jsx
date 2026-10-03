/**
 * ============================================================
 * File: SalesPage.jsx
 * Module: Sales (Checkout)
 *
 * Description:
 * Checkout: search the catalog, add products and/or completed service
 * appointments to a cart, and complete the sale as one invoice. This
 * is the screen that proves Customers, Services, Inventory, and Payments
 * are actually connected, not just four separate modules. A customer
 * is optional — a walk-in sale needs no name on file.
 * ============================================================
 */

import { useEffect, useMemo, useRef, useState } from "react";
import apiClient from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast, useDialog } from "../context/ToastContext";
import { useFormat } from "../utils/format";
import { buildReceiptHtml } from "../utils/receipt";
import Drawer from "../components/Drawer";
import StatusChip from "../components/StatusChip";

const GOODS_PAGE_SIZE = 8;
const SALES_PAGE_SIZE = 8;

// Sales' card/panel accent — signal green, matching the "positive/revenue"
// meaning that color already carries elsewhere in the app. See
// index.css's .ledger-card/.panel --card-accent/--card-glow.
const ACCENT_STYLE = { "--card-accent": "var(--color-signal)", "--card-glow": "rgba(47, 125, 91, 0.35)" };

// Compact page-number list with an ellipsis for long runs, e.g. 1 2 3 … 8 9 10.
const getPageNumbers = (current, total) => {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const keep = new Set([1, 2, 3, total - 2, total - 1, total, current - 1, current, current + 1]);
  const pages = [...keep].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b);

  const withEllipsis = [];
  pages.forEach((page, index) => {
    if (index > 0 && page - pages[index - 1] > 1) {
      withEllipsis.push("…");
    }
    withEllipsis.push(page);
  });
  return withEllipsis;
};

function PaginationBar({ page, totalPages, onChange }) {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <div className="flex items-center justify-between border-t border-paper-line px-4 py-3">
      <button
        type="button"
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page === 1}
        className="text-sm text-ink-soft transition hover:text-teal disabled:opacity-40"
      >
        ← Previous
      </button>
      <div className="flex items-center gap-1">
        {getPageNumbers(page, totalPages).map((entry, index) =>
          entry === "…" ? (
            <span key={`ellipsis-${index}`} className="px-1.5 text-sm text-ink-soft">
              …
            </span>
          ) : (
            <button
              key={entry}
              type="button"
              onClick={() => onChange(entry)}
              className={`h-7 w-7 rounded text-sm transition ${
                entry === page ? "bg-teal text-paper" : "text-ink-soft hover:bg-teal-soft hover:text-ink"
              }`}
            >
              {entry}
            </button>
          )
        )}
      </div>
      <button
        type="button"
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        disabled={page === totalPages}
        className="text-sm text-ink-soft transition hover:text-teal disabled:opacity-40"
      >
        Next →
      </button>
    </div>
  );
}

export default function SalesPage() {
  const { user, activeBranch, hasPermission } = useAuth();
  const canRefund = hasPermission("sales", "refund");
  const toast = useToast();
  const dialog = useDialog();
  const { money, dateTime } = useFormat();
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [services, setServices] = useState([]);
  const [billableAppointments, setBillableAppointments] = useState([]);
  const [sales, setSales] = useState([]);
  const [discounts, setDiscounts] = useState([]);
  const [activeTaxes, setActiveTaxes] = useState([]);

  // Which catalog the center panel is showing — physical goods or
  // services. Selling a service here (no appointment) is the walk-in
  // path: someone buys a service on the spot, same as buying a product.
  const [catalogTab, setCatalogTab] = useState("goods");

  const [customerId, setCustomerId] = useState("");
  const [cart, setCart] = useState([]); // { key, itemType, label, unitPrice, quantity, productId?, serviceId?, appointmentId? }
  // Tenders: how the customer is paying. One row by default; add more to
  // split. `amount` is a string (the input value). A single untouched
  // cash row auto-fills to the total (see the effect below).
  const [tenders, setTenders] = useState([{ method: "cash", amount: "", touched: false }]);
  const [discountId, setDiscountId] = useState("");

  const [search, setSearch] = useState("");
  const [goodsPage, setGoodsPage] = useState(1);
  const [salesPage, setSalesPage] = useState(1);
  // Recent sales is server-paginated (the list grows without bound); these
  // hold the current page's total-pages and a bump to force a reload after a
  // sale or refund.
  const [salesTotalPages, setSalesTotalPages] = useState(1);
  const [salesRefresh, setSalesRefresh] = useState(0);
  const [scanNotice, setScanNotice] = useState("");
  const searchInputRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [lastReceipt, setLastReceipt] = useState(null);

  // Returns/refunds: the sale being returned (fetched with its items +
  // remaining returnable quantities), and the per-line quantities chosen.
  const [returnSale, setReturnSale] = useState(null);
  const [returnItems, setReturnItems] = useState({});
  const [returnReason, setReturnReason] = useState("");
  const [returnMethod, setReturnMethod] = useState("cash");
  const [returnBusy, setReturnBusy] = useState(false);
  // Focus mode: the checkout takes over the whole viewport — no sidebar,
  // no header — for busy front-desk use. Escape exits.
  const [focusMode, setFocusMode] = useState(false);

  // Held / parked sales: the current cart can be saved to resume later.
  // `activePendingId` is the held sale currently loaded in the cart (if any),
  // deleted once that sale is completed.
  const [pending, setPending] = useState([]);
  const [activePendingId, setActivePendingId] = useState(null);
  const [holding, setHolding] = useState(false);

  useEffect(() => {
    if (!focusMode) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setFocusMode(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusMode]);

  const handlePrintReceipt = (sale) => {
    dialog.print(
      buildReceiptHtml({
        sale,
        organization: user?.organization,
        branch: activeBranch,
        settings: user?.settings || {},
        cashierName: sale.cashierName || `${user?.firstName || ""} ${user?.lastName || ""}`.trim(),
        money,
        dateTime,
      })
    );
  };

  const loadBaseData = async () => {
    setLoading(true);
    setError("");
    try {
      const [customersRes, productsRes, servicesRes, discountsRes, taxesRes] = await Promise.all([
        apiClient.get("/customers"),
        apiClient.get("/products"),
        apiClient.get("/services"),
        apiClient.get("/discounts", { params: { status: "active" } }),
        apiClient.get("/taxes", { params: { status: "active" } }),
      ]);
      setCustomers(customersRes.data.data);
      setProducts(productsRes.data.data);
      setServices(servicesRes.data.data.filter((s) => s.isActive));
      setDiscounts(discountsRes.data.data);
      setActiveTaxes(taxesRes.data.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadPending = () =>
    apiClient
      .get("/pending-sales", { params: { branchId: activeBranch.id } })
      .then((res) => setPending(res.data.data))
      .catch(() => setPending([]));

  useEffect(() => {
    setSalesPage(1);
    loadBaseData();
    loadPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBranch.id]);

  // Recent sales: one page at a time from the server (the list is unbounded).
  const loadSales = async (page) => {
    try {
      const res = await apiClient.get("/sales", {
        params: { branchId: activeBranch.id, page, limit: SALES_PAGE_SIZE },
      });
      setSales(res.data.data);
      setSalesTotalPages(res.data.pagination?.totalPages || 1);
    } catch (err) {
      setError((prev) => prev || err.message);
    }
  };

  useEffect(() => {
    loadSales(salesPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBranch.id, salesPage, salesRefresh]);

  // Keep the scanner-ready search box focused after the catalog (re)loads —
  // e.g. right after a sale completes — so a cashier can keep scanning
  // without having to click back into the field.
  useEffect(() => {
    if (!loading) {
      searchInputRef.current?.focus();
    }
  }, [loading]);

  useEffect(() => {
    if (!customerId) {
      setBillableAppointments([]);
      return;
    }
    apiClient
      .get("/appointments", {
        // branchId is required by the branch-scope middleware for anyone
        // with access to more than one branch — and a sale bills the
        // active branch's appointments anyway.
        params: { branchId: activeBranch.id, customerId, status: "completed", uninvoiced: true },
      })
      .then((res) => setBillableAppointments(res.data.data))
      .catch((err) => setError(err.message));
  }, [customerId, activeBranch.id]);

  const round2 = (value) => Math.round(value * 100) / 100;

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return products;
    return products.filter(
      (product) =>
        product.name.toLowerCase().includes(term) ||
        (product.sku || "").toLowerCase().includes(term) ||
        (product.barcode || "").toLowerCase().includes(term)
    );
  }, [products, search]);

  const goodsTotalPages = Math.max(1, Math.ceil(filteredProducts.length / GOODS_PAGE_SIZE));
  const pagedProducts = filteredProducts.slice(
    (goodsPage - 1) * GOODS_PAGE_SIZE,
    goodsPage * GOODS_PAGE_SIZE
  );

  const filteredServices = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return services;
    return services.filter((service) => service.name.toLowerCase().includes(term));
  }, [services, search]);


  const handleSearchChange = (event) => {
    setSearch(event.target.value);
    setGoodsPage(1);
    setScanNotice("");
  };

  // A barcode scanner is just a keyboard-wedge device: it "types" the
  // scanned digits into whatever's focused, then sends Enter. On Enter,
  // treat the field as a scan rather than free-text search — look for an
  // exact barcode/SKU match and add it straight to the cart, then clear
  // the box and keep focus so the next scan can land immediately with no
  // clicking required.
  const handleSearchKeyDown = (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();

    const term = search.trim().toLowerCase();
    if (!term) return;

    const match = products.find(
      (product) => (product.barcode || "").toLowerCase() === term || (product.sku || "").toLowerCase() === term
    );

    if (match) {
      addProductToCart(match);
      setSearch("");
      setGoodsPage(1);
      setScanNotice("");
    } else {
      setScanNotice(`No product found for "${search.trim()}".`);
    }
  };

  const addProductToCart = (product) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.itemType === "product" && item.productId === product.id);
      if (existing) {
        const quantity = existing.quantity + 1;
        return prev.map((item) =>
          item.key === existing.key
            ? { ...item, quantity, label: `${product.name} × ${quantity}`, lineTotal: round2(quantity * item.unitPrice) }
            : item
        );
      }
      return [
        ...prev,
        {
          key: `product-${product.id}`,
          itemType: "product",
          productId: product.id,
          label: `${product.name} × 1`,
          unitPrice: product.price,
          quantity: 1,
          lineTotal: product.price,
        },
      ];
    });
  };

  // A cart line's quantity can be adjusted when it's a product or a
  // direct (walk-in) service — both are priced per unit. A billed
  // appointment is a fixed one-off and has no +/- control.
  const isQuantityAdjustable = (item) => item.itemType === "product" || Boolean(item.serviceId);

  // Add a service directly to the cart (walk-in) — no appointment, priced
  // from the catalog, stackable by quantity like a product.
  const addServiceToCart = (service) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.serviceId === service.id);
      if (existing) {
        const quantity = existing.quantity + 1;
        return prev.map((item) =>
          item.key === existing.key
            ? { ...item, quantity, label: `${service.name} × ${quantity}`, lineTotal: round2(quantity * item.unitPrice) }
            : item
        );
      }
      return [
        ...prev,
        {
          key: `svc-${service.id}`,
          itemType: "service",
          serviceId: service.id,
          label: `${service.name} × 1`,
          unitPrice: service.price,
          quantity: 1,
          lineTotal: service.price,
        },
      ];
    });
  };

  const adjustCartQuantity = (key, delta) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.key !== key) return item;
          const quantity = item.quantity + delta;
          if (quantity <= 0) return null;
          const label = isQuantityAdjustable(item) ? `${item.label.split(" ×")[0]} × ${quantity}` : item.label;
          return { ...item, quantity, label, lineTotal: round2(quantity * item.unitPrice) };
        })
        .filter(Boolean)
    );
  };

  // Type an exact quantity (e.g. 500) instead of tapping + hundreds of times.
  // Empty/invalid input holds at 1; the − button still removes a line at 0.
  const setCartQuantity = (key, rawValue) => {
    const parsed = Math.floor(Number(rawValue));
    const quantity = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    setCart((prev) =>
      prev.map((item) => {
        if (item.key !== key) return item;
        const label = isQuantityAdjustable(item) ? `${item.label.split(" ×")[0]} × ${quantity}` : item.label;
        return { ...item, quantity, label, lineTotal: round2(quantity * item.unitPrice) };
      })
    );
  };

  const addAppointmentToCart = (appointment) => {
    setCart((prev) => [
      ...prev,
      {
        key: `service-${appointment.id}`,
        itemType: "service",
        appointmentId: appointment.id,
        label: `${appointment.serviceName} — ${appointment.customerName}`,
        unitPrice: appointment.price,
        quantity: 1,
        lineTotal: appointment.price,
      },
    ]);
    setBillableAppointments((prev) => prev.filter((a) => a.id !== appointment.id));
  };

  const removeFromCart = (key) => {
    const removed = cart.find((c) => c.key === key);
    setCart((prev) => prev.filter((c) => c.key !== key));
    // Put a removed APPOINTMENT back into the billable list so it isn't
    // lost (direct services just disappear — they can be re-added anytime).
    if (removed?.appointmentId) {
      apiClient
        .get("/appointments", { params: { customerId, status: "completed", uninvoiced: true } })
        .then((res) => setBillableAppointments(res.data.data))
        .catch(() => {});
    }
  };

  // Preview of the totals the server will compute — same rules: the flat
  // discount is clamped to the subtotal, every active tax applies to the
  // discounted subtotal. The server's numbers are authoritative.
  const subtotal = round2(cart.reduce((sum, item) => sum + item.lineTotal, 0));
  const selectedDiscount = discounts.find((d) => d.id === discountId);
  const discountAmount = selectedDiscount ? round2(Math.min(selectedDiscount.amount, subtotal)) : 0;
  const taxRate = activeTaxes.reduce((sum, tax) => sum + tax.rate, 0);
  const taxAmount = round2(((subtotal - discountAmount) * taxRate) / 100);
  const total = round2(subtotal - discountAmount + taxAmount);

  // Keep a single untouched cash tender in step with the total, so the
  // common "exact payment" case needs no typing at all.
  useEffect(() => {
    setTenders((prev) => {
      if (prev.length === 1 && prev[0].method === "cash" && !prev[0].touched) {
        const amt = total > 0 ? String(total) : "";
        return prev[0].amount === amt ? prev : [{ ...prev[0], amount: amt }];
      }
      return prev;
    });
  }, [total]);

  const totalTendered = round2(tenders.reduce((sum, t) => sum + (Number(t.amount) || 0), 0));
  const nonCashTendered = round2(
    tenders.filter((t) => t.method !== "cash").reduce((sum, t) => sum + (Number(t.amount) || 0), 0)
  );
  const changeDue = round2(Math.max(0, totalTendered - total));
  const balanceDue = round2(Math.max(0, total - totalTendered));
  // "credit" = put on the customer's account; it needs a customer to charge.
  const creditTendered = round2(
    tenders.filter((t) => t.method === "credit").reduce((sum, t) => sum + (Number(t.amount) || 0), 0)
  );
  const creditNeedsCustomer = creditTendered > 0 && !customerId;
  const canPay =
    cart.length > 0 && totalTendered >= total - 0.001 && nonCashTendered <= total + 0.001 && !creditNeedsCustomer;

  const updateTender = (index, patch) =>
    setTenders((prev) => prev.map((t, i) => (i === index ? { ...t, ...patch, touched: true } : t)));
  const addTender = () => setTenders((prev) => [...prev, { method: "cash", amount: "", touched: true }]);
  const removeTender = (index) => setTenders((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  const resetTenders = () => setTenders([{ method: "cash", amount: "", touched: false }]);

  const handleCheckout = async () => {
    setError("");
    setSubmitting(true);
    try {
      const response = await apiClient.post("/sales", {
        customerId: customerId || undefined,
        branchId: activeBranch.id,
        payments: tenders
          .map((t) => ({ method: t.method, amount: Number(t.amount) || 0 }))
          .filter((t) => t.amount > 0),
        discountId: discountId || undefined,
        items: cart.map((item) => {
          if (item.itemType === "product") {
            return { itemType: "product", productId: item.productId, quantity: item.quantity };
          }
          // A direct service carries serviceId + quantity; a billed
          // appointment carries appointmentId (fixed quantity 1).
          if (item.serviceId) {
            return { itemType: "service", serviceId: item.serviceId, quantity: item.quantity };
          }
          return { itemType: "service", appointmentId: item.appointmentId };
        }),
      });
      setLastReceipt(response.data.data);
      // Pop the receipt straight up on a completed sale — the cashier
      // prints (or closes) it without a second click. It's still
      // reprintable from the "Sale completed" panel afterwards.
      handlePrintReceipt(response.data.data);
      // If this cart was resumed from a held sale, that held record is now
      // completed — remove it.
      if (activePendingId) {
        apiClient.delete(`/pending-sales/${activePendingId}`).catch(() => {});
        setActivePendingId(null);
        loadPending();
      }
      setCart([]);
      setCustomerId("");
      setDiscountId("");
      resetTenders();
      setSalesPage(1);
      setSalesRefresh((n) => n + 1);
      const change = response.data.data.changeGiven;
      toast.success(
        `Sale completed — ${money(response.data.data.totalAmount)}${change > 0 ? ` · change ${money(change)}` : ""}.`
      );
      await loadBaseData();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // --- held / parked sales ---

  // Save the current cart as a held sale and clear the till for the next
  // customer. If this cart was itself resumed from a held sale, that record is
  // replaced (so it isn't duplicated).
  const holdSale = async () => {
    if (cart.length === 0) return;
    setHolding(true);
    try {
      const customerName = customers.find((c) => c.id === customerId)?.name;
      const label = customerName || cart[0]?.label || "Walk-in sale";
      const itemCount = cart.reduce((n, item) => n + Number(item.quantity || 0), 0);
      if (activePendingId) {
        await apiClient.delete(`/pending-sales/${activePendingId}`).catch(() => {});
      }
      await apiClient.post("/pending-sales", {
        branchId: activeBranch.id,
        label,
        itemCount,
        total,
        cart,
        customerId: customerId || null,
        discountId: discountId || null,
      });
      setCart([]);
      setCustomerId("");
      setDiscountId("");
      resetTenders();
      setActivePendingId(null);
      toast.success("Sale held — resume it from “Held sales”.");
      loadPending();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setHolding(false);
    }
  };

  // Resume a held sale: load its cart back into the till. The record stays until
  // the sale is completed (or cancelled).
  const continuePending = (held) => {
    if (cart.length > 0 && !window.confirm("This will replace the items currently in the cart. Continue?")) {
      return;
    }
    setCart(held.cart || []);
    setCustomerId(held.customer_id || "");
    setDiscountId(held.discount_id || "");
    resetTenders();
    setActivePendingId(held.id);
    toast.success("Held sale loaded into the cart.");
  };

  const cancelPending = async (held) => {
    if (!window.confirm("Cancel this held sale? Its items will be discarded.")) return;
    try {
      await apiClient.delete(`/pending-sales/${held.id}`);
      if (held.id === activePendingId) {
        setCart([]);
        setCustomerId("");
        setDiscountId("");
        setActivePendingId(null);
      }
      toast.success("Held sale cancelled.");
      loadPending();
    } catch (err) {
      toast.error(err.message);
    }
  };

  // --- returns / refunds ---
  const openReturn = async (saleSummary) => {
    try {
      const res = await apiClient.get(`/sales/${saleSummary.id}`);
      setReturnSale(res.data.data);
      setReturnItems({});
      setReturnReason("");
      setReturnMethod("cash");
    } catch (err) {
      toast.error(err.message);
    }
  };

  const setReturnQty = (item, value) => {
    const max = item.returnableQuantity ?? 0;
    const qty = Math.max(0, Math.min(max, Math.floor(Number(value) || 0)));
    setReturnItems((prev) => ({ ...prev, [item.id]: qty }));
  };

  const returnTotalQty = Object.values(returnItems).reduce((sum, q) => sum + q, 0);

  const processReturn = async () => {
    const items = Object.entries(returnItems)
      .filter(([, q]) => q > 0)
      .map(([saleItemId, quantity]) => ({ saleItemId, quantity }));
    if (items.length === 0) return;
    setReturnBusy(true);
    try {
      const res = await apiClient.post(`/sales/${returnSale.id}/returns`, {
        items,
        reason: returnReason || undefined,
        refundMethod: returnMethod,
      });
      toast.success(`Refund processed — ${money(res.data.data.refund.totalRefund)}.`);
      setReturnSale(null);
      setSalesRefresh((n) => n + 1);
      await loadBaseData();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setReturnBusy(false);
    }
  };

  const inputClass =
    "w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal";

  return (
    <div className={focusMode ? "fixed inset-0 z-50 overflow-y-auto bg-paper px-4 py-4 sm:px-6" : ""}>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="field-label text-signal">Sales</span>
          <h2 className="font-display text-xl font-semibold text-ink">
            Checkout
            {focusMode && activeBranch?.name && (
              <span className="ml-2 align-middle font-mono text-xs font-normal text-ink-soft">
                {activeBranch.name}
              </span>
            )}
          </h2>
        </div>
        <button
          type="button"
          onClick={() => setFocusMode((prev) => !prev)}
          className="btn-chip btn-chip-neutral"
          title={focusMode ? "Exit focus mode (Esc)" : "Fill the screen with just the checkout"}
        >
          {focusMode ? "✕ Exit focus mode" : "⛶ Focus mode"}
        </button>
      </div>

      {error && (
        <p className="mb-4 rounded border border-clay/30 bg-clay-soft px-3 py-2 text-sm text-clay">
          {error}
        </p>
      )}

      {lastReceipt && (
        <div className="mb-6 ledger-card py-5 pr-5" style={ACCENT_STYLE}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="field-label mb-1 text-signal">Sale completed</p>
              <p className="text-sm text-ink">
                {lastReceipt.customerName} — {money(lastReceipt.totalAmount)} ({lastReceipt.items.length} item
                {lastReceipt.items.length === 1 ? "" : "s"}), paid by{" "}
                {lastReceipt.payments[0]?.method || "cash"}.
              </p>
              {(lastReceipt.discountAmount > 0 || lastReceipt.taxAmount > 0) && (
                <p className="mt-1 font-mono text-xs text-ink-soft">
                  Subtotal {money(lastReceipt.subtotal)}
                  {lastReceipt.discountAmount > 0 &&
                    ` − discount ${lastReceipt.discountCode ? `(${lastReceipt.discountCode}) ` : ""}${money(lastReceipt.discountAmount)}`}
                  {lastReceipt.taxAmount > 0 && ` + tax ${money(lastReceipt.taxAmount)}`}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => handlePrintReceipt(lastReceipt)}
              className="btn-solid btn-solid-primary btn-solid-sm shrink-0"
            >
              🖨 Print receipt
            </button>
          </div>
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-3">
        {/* Center: search + goods catalog (and, if a customer is picked, their unbilled services) */}
        <div className="space-y-4 lg:col-span-2 min-w-0">
          <div>
            <input
              ref={searchInputRef}
              type="search"
              autoFocus
              value={search}
              onChange={handleSearchChange}
              onKeyDown={handleSearchKeyDown}
              placeholder={catalogTab === "goods" ? "Search by name/SKU, or scan a barcode…" : "Search services…"}
              className="w-full rounded border border-paper-line bg-white px-4 py-2.5 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal"
            />
            {scanNotice && catalogTab === "goods" && <p className="mt-1 text-xs text-clay">{scanNotice}</p>}
          </div>

          {/* Goods vs Services — a walk-in can buy either on the spot. */}
          <div className="inline-flex rounded-lg border border-paper-line bg-white p-1">
            {["goods", "services"].map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setCatalogTab(tab)}
                className={`rounded-md px-4 py-1.5 text-sm font-medium capitalize transition ${
                  catalogTab === tab ? "bg-signal text-paper" : "text-ink-soft hover:text-ink"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {customerId && (
            <div>
              <p className="field-label mb-1">Unbilled services for this customer</p>
              {billableAppointments.length === 0 ? (
                <p className="text-xs text-ink-soft">None right now.</p>
              ) : (
                <div className="space-y-1">
                  {billableAppointments.map((appointment) => (
                    <div
                      key={appointment.id}
                      className="flex items-center justify-between rounded border border-paper-line bg-white px-3 py-2 text-sm"
                    >
                      <span className="text-ink">
                        {appointment.serviceName} — {money(appointment.price)}
                      </span>
                      <button type="button" onClick={() => addAppointmentToCart(appointment)} className="btn-chip btn-chip-primary">
                        Add
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {catalogTab === "goods" ? (
            <div className="panel" style={ACCENT_STYLE}>
              <table className="w-full text-left text-sm">
                <thead className="border-b border-paper-line bg-paper">
                  <tr>
                    <th className="px-4 py-2 font-medium text-ink-soft">Product</th>
                    <th className="hidden px-4 py-2 font-medium text-ink-soft sm:table-cell">SKU</th>
                    <th className="px-4 py-2 text-right font-medium text-ink-soft">Price</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-sm text-ink-soft">
                        Loading products…
                      </td>
                    </tr>
                  ) : pagedProducts.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-sm text-ink-soft">
                        {search ? "No products match your search." : "No products yet."}
                      </td>
                    </tr>
                  ) : (
                    pagedProducts.map((product) => (
                      <tr key={product.id} className="border-b border-paper-line last:border-0">
                        <td className="px-4 py-2 text-ink">
                          {product.name}
                          <span className="block font-mono text-xs text-ink-soft sm:hidden">{product.sku}</span>
                        </td>
                        <td className="hidden px-4 py-2 font-mono text-xs text-ink-soft sm:table-cell">{product.sku}</td>
                        <td className="px-4 py-2 text-right font-mono text-xs text-ink-soft">
                          {money(product.price)}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <button type="button" onClick={() => addProductToCart(product)} className="btn-chip btn-chip-primary">
                            Add
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              <PaginationBar page={goodsPage} totalPages={goodsTotalPages} onChange={setGoodsPage} />
            </div>
          ) : (
            <div className="panel" style={ACCENT_STYLE}>
              <table className="w-full text-left text-sm">
                <thead className="border-b border-paper-line bg-paper">
                  <tr>
                    <th className="px-4 py-2 font-medium text-ink-soft">Service</th>
                    <th className="hidden px-4 py-2 font-medium text-ink-soft sm:table-cell">Duration</th>
                    <th className="px-4 py-2 text-right font-medium text-ink-soft">Price</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-sm text-ink-soft">
                        Loading services…
                      </td>
                    </tr>
                  ) : filteredServices.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-sm text-ink-soft">
                        {search ? "No services match your search." : "No active services yet."}
                      </td>
                    </tr>
                  ) : (
                    filteredServices.map((service) => (
                      <tr key={service.id} className="border-b border-paper-line last:border-0">
                        <td className="px-4 py-2 text-ink">{service.name}</td>
                        <td className="hidden px-4 py-2 font-mono text-xs text-ink-soft sm:table-cell">
                          {service.durationMinutes} min
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs text-ink-soft">
                          {money(service.price)}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <button type="button" onClick={() => addServiceToCart(service)} className="btn-chip btn-chip-primary">
                            Add
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Held sales — parked carts a cashier can resume or cancel. */}
          {pending.length > 0 && (
            <div className="mb-6">
              <p className="field-label mb-2">Held sales</p>
              <div className="panel" style={{ "--card-accent": "var(--color-amber)", "--card-glow": "rgba(176, 129, 47, 0.28)" }}>
                <div className="divide-y divide-paper-line">
                  {pending.map((held) => (
                    <div key={held.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-ink">{held.label || "Walk-in sale"}</span>
                          {held.id === activePendingId && <StatusChip tone="info">in cart</StatusChip>}
                        </div>
                        <div className="mt-0.5 text-xs text-ink-soft">
                          {held.item_count} item{held.item_count === 1 ? "" : "s"} · {money(held.total)}
                          {held.cashier_name ? ` · ${held.cashier_name}` : ""} · {dateTime(held.created_at)}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button type="button" onClick={() => continuePending(held)} className="btn-link btn-link-primary">
                          Continue
                        </button>
                        <button type="button" onClick={() => cancelPending(held)} className="btn-link btn-link-danger">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Recent sales — under the catalog, in the same (left) column. */}
          <div>
            <p className="field-label mb-2">Recent sales</p>
            {loading ? (
              <p className="text-sm text-ink-soft">Loading…</p>
            ) : sales.length === 0 ? (
              <p className="text-sm text-ink-soft">No sales yet.</p>
            ) : (
              <div className="panel" style={ACCENT_STYLE}>
                <div className="divide-y divide-paper-line">
                  {sales.map((sale) => (
                    <div key={sale.id} className="px-4 py-2.5 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-ink">{sale.customerName}</span>
                        <span className="shrink-0 font-mono text-xs text-ink">{money(sale.totalAmount)}</span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-ink-soft">
                        <span className="font-mono">{dateTime(sale.createdAt)}</span>
                        <span className="flex shrink-0 items-center gap-2">
                          {sale.returnStatus === "full" && <StatusChip tone="danger">returned</StatusChip>}
                          {sale.returnStatus === "partial" && <StatusChip tone="warning">part returned</StatusChip>}
                          {canRefund && sale.returnStatus !== "full" && (
                            <button type="button" onClick={() => openReturn(sale)} className="btn-link btn-link-warning">
                              Return
                            </button>
                          )}
                          <span>
                            {sale.itemCount} item{sale.itemCount === 1 ? "" : "s"}
                          </span>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <PaginationBar page={salesPage} totalPages={salesTotalPages} onChange={setSalesPage} />
              </div>
            )}
          </div>
        </div>

        {/* Right: the checkout rail — sticky, so it stays pinned while the
            catalog and the recent-sales list on the left scroll. */}
        <div className="space-y-6 lg:col-span-1 min-w-0">
          <div className="ledger-card sticky top-24 space-y-4 py-6 pr-6" style={ACCENT_STYLE}>
            <div>
              <label htmlFor="customerId" className="field-label mb-1 block">
                Customer <span className="normal-case text-ink-soft">(optional — leave blank for a walk-in)</span>
              </label>
              <select
                id="customerId"
                value={customerId}
                onChange={(event) => setCustomerId(event.target.value)}
                className="w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal"
              >
                <option value="">Walk-in (no customer)</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <p className="field-label mb-1">Cart</p>
              {cart.length === 0 ? (
                <p className="text-sm text-ink-soft">No items yet — add something from the catalog.</p>
              ) : (
                <div className="space-y-1">
                  {cart.map((item) => (
                    <div key={item.key} className="rounded border border-paper-line px-3 py-2 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-ink">{item.label}</span>
                        <button type="button" onClick={() => removeFromCart(item.key)} className="btn-link btn-link-danger shrink-0">
                          Remove
                        </button>
                      </div>
                      <div className="mt-1 flex items-center justify-between">
                        {isQuantityAdjustable(item) ? (
                          <div className="flex items-center gap-1.5">
                            {/* Finger-sized (44px-ish) targets — this cart is
                                used on touchscreens at the counter. */}
                            <button
                              type="button"
                              onClick={() => adjustCartQuantity(item.key, -1)}
                              aria-label="Decrease quantity"
                              className="h-9 w-9 rounded border border-paper-line text-base text-ink-soft hover:border-teal hover:text-teal"
                            >
                              −
                            </button>
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={item.quantity}
                              onChange={(event) => setCartQuantity(item.key, event.target.value)}
                              onFocus={(event) => event.target.select()}
                              aria-label="Quantity"
                              className="h-9 w-16 rounded border border-paper-line bg-white text-center font-mono text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal"
                            />
                            <button
                              type="button"
                              onClick={() => adjustCartQuantity(item.key, 1)}
                              aria-label="Increase quantity"
                              className="h-9 w-9 rounded border border-paper-line text-base text-ink-soft hover:border-teal hover:text-teal"
                            >
                              +
                            </button>
                          </div>
                        ) : (
                          <span />
                        )}
                        <span className="font-mono text-xs text-ink-soft">{money(item.lineTotal)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label htmlFor="discountId" className="field-label mb-1 block">
                Discount
              </label>
              <select
                id="discountId"
                value={discountId}
                onChange={(event) => setDiscountId(event.target.value)}
                className="w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal"
              >
                <option value="">No discount</option>
                {discounts.map((discount) => (
                  <option key={discount.id} value={discount.id}>
                    {discount.code} (−{money(discount.amount)})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1 text-sm">
              <div className="flex justify-between text-ink-soft">
                <span>Subtotal</span>
                <span className="font-mono">{money(subtotal)}</span>
              </div>
              {discountAmount > 0 && (
                <div className="flex justify-between text-ink-soft">
                  <span>Discount ({selectedDiscount.code})</span>
                  <span className="font-mono">−{money(discountAmount)}</span>
                </div>
              )}
              {taxRate > 0 && (
                <div className="flex justify-between text-ink-soft">
                  <span>Tax ({taxRate}%)</span>
                  <span className="font-mono">{money(taxAmount)}</span>
                </div>
              )}
            </div>

            <div>
              <p className="field-label">Total</p>
              <p className="font-display text-3xl font-semibold text-ink">{money(total)}</p>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <p className="field-label">Payment</p>
                <button type="button" onClick={addTender} className="btn-link btn-link-primary">
                  + Split
                </button>
              </div>
              <div className="space-y-2">
                {tenders.map((tender, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <select
                      value={tender.method}
                      onChange={(event) => updateTender(index, { method: event.target.value })}
                      className="rounded border border-paper-line bg-white px-2 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal"
                    >
                      <option value="cash">Cash</option>
                      <option value="card">Card</option>
                      <option value="transfer">Transfer</option>
                      <option value="other">Other</option>
                      <option value="credit">Credit (on account)</option>
                    </select>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={tender.amount}
                      onChange={(event) => updateTender(index, { amount: event.target.value })}
                      placeholder="Amount"
                      className="w-full rounded border border-paper-line bg-white px-2 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal"
                    />
                    {tenders.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeTender(index)}
                        aria-label="Remove payment"
                        className="shrink-0 rounded border border-paper-line px-2 py-1.5 text-ink-soft hover:border-clay hover:text-clay"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Tendered / change / balance — the till maths a cashier needs. */}
              <div className="mt-2 space-y-1 text-sm">
                <div className="flex justify-between text-ink-soft">
                  <span>Tendered</span>
                  <span className="font-mono">{money(totalTendered)}</span>
                </div>
                {changeDue > 0 && (
                  <div className="flex justify-between font-semibold text-signal">
                    <span>Change</span>
                    <span className="font-mono">{money(changeDue)}</span>
                  </div>
                )}
                {balanceDue > 0 && (
                  <div className="flex justify-between font-semibold text-clay">
                    <span>Balance due</span>
                    <span className="font-mono">{money(balanceDue)}</span>
                  </div>
                )}
                {creditTendered > 0 && (
                  <div className="flex justify-between font-semibold text-cobalt">
                    <span>On account</span>
                    <span className="font-mono">{money(creditTendered)}</span>
                  </div>
                )}
                {nonCashTendered > total + 0.001 && (
                  <p className="text-xs text-clay">Card/transfer/credit can't exceed the total — use cash for the change.</p>
                )}
                {creditNeedsCustomer && (
                  <p className="text-xs text-clay">Select a customer above to sell on credit.</p>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={handleCheckout}
              disabled={submitting || !canPay}
              className="btn-solid btn-solid-primary"
            >
              {submitting ? "Completing sale…" : "Complete sale"}
            </button>
            {cart.length > 0 && (
              <button
                type="button"
                onClick={holdSale}
                disabled={holding}
                className="w-full rounded border border-paper-line px-3 py-2 text-sm font-medium text-ink-soft hover:border-teal hover:text-teal disabled:opacity-60"
              >
                {holding ? "Holding…" : "Hold sale"}
              </button>
            )}
          </div>

        </div>
      </div>

      {/* Return / refund drawer — pick how many of each line to send back,
          a reason, and how the refund is paid. Products restock; services
          just refund. The refund total is computed server-side. */}
      <Drawer
        open={canRefund && Boolean(returnSale)}
        onClose={() => setReturnSale(null)}
        title="Return / refund"
        subtitle={returnSale ? `${returnSale.customerName} · ${money(returnSale.totalAmount)}` : undefined}
      >
        {returnSale && (
          <div className="space-y-4">
            {returnSale.items.every((i) => (i.returnableQuantity ?? 0) === 0) ? (
              <p className="text-sm text-ink-soft">Every item on this sale has already been returned.</p>
            ) : (
              <>
                <div className="space-y-2">
                  {returnSale.items.map((item) => {
                    const returnable = item.returnableQuantity ?? 0;
                    return (
                      <div key={item.id} className="rounded border border-paper-line px-3 py-2">
                        <div className="flex items-start justify-between gap-2 text-sm">
                          <span className="text-ink">{item.description}</span>
                          <span className="shrink-0 font-mono text-xs text-ink-soft">{money(item.unitPrice)}</span>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <span className="text-xs text-ink-soft">
                            Sold {item.quantity} · {returnable > 0 ? `${returnable} returnable` : "fully returned"}
                          </span>
                          <input
                            type="number"
                            min="0"
                            max={returnable}
                            disabled={returnable === 0}
                            value={returnItems[item.id] ?? 0}
                            onChange={(event) => setReturnQty(item, event.target.value)}
                            className="w-20 rounded border border-paper-line bg-white px-2 py-1 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal disabled:bg-paper"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div>
                  <label htmlFor="returnReason" className="field-label mb-1 block">
                    Reason <span className="normal-case text-ink-soft">(optional)</span>
                  </label>
                  <input
                    id="returnReason"
                    value={returnReason}
                    onChange={(event) => setReturnReason(event.target.value)}
                    placeholder="e.g. wrong item, damaged"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label htmlFor="returnMethod" className="field-label mb-1 block">
                    Refund method
                  </label>
                  <select id="returnMethod" value={returnMethod} onChange={(event) => setReturnMethod(event.target.value)} className={inputClass}>
                    <option value="cash">Cash</option>
                    <option value="card">Card</option>
                    <option value="transfer">Transfer</option>
                    <option value="other">Other</option>
                    {returnSale.customerId && <option value="credit">Credit (to account)</option>}
                  </select>
                </div>

                <p className="text-xs text-ink-soft">
                  Returning {returnTotalQty} item{returnTotalQty === 1 ? "" : "s"}. The refund amount is calculated
                  from the sale (discounts and tax included) and products are restocked automatically.
                </p>

                <button type="button" onClick={processReturn} disabled={returnBusy || returnTotalQty === 0} className="btn-solid btn-solid-warning">
                  {returnBusy ? "Processing…" : "Process return & refund"}
                </button>
              </>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
