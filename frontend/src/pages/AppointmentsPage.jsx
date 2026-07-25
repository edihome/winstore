/**
 * ============================================================
 * File: AppointmentsPage.jsx
 * Module: Services (Appointments)
 *
 * Description:
 * Service checkout, laid out like the Sales page. Pick a customer, book
 * one or more services for them (each booking is its own appointment),
 * then work each booking through two steps: Complete it (the service was
 * delivered), which unlocks Add to cart; add it to the cart; repeat for
 * every service. Checking out bills all the added services as one paid
 * sale — the same invoice/payment path the Sales page uses.
 *
 * A walk-in with no named customer buys services directly on the Sales
 * page instead (Sales → Services tab); this page is for booking against
 * a customer on file.
 * ============================================================
 */

import { useEffect, useMemo, useState } from "react";
import apiClient from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast, useDialog } from "../context/ToastContext";
import { useFormat } from "../utils/format";
import { buildReceiptHtml } from "../utils/receipt";
import StatusChip from "../components/StatusChip";
import EmptyState from "../components/EmptyState";

const ACCENT_STYLE = { "--card-accent": "var(--color-berry)", "--card-glow": "rgba(156, 56, 101, 0.35)" };

const STATUS_TONES = { scheduled: "info", completed: "success", cancelled: "danger", no_show: "warning" };

// datetime-local wants "YYYY-MM-DDTHH:mm" in LOCAL time.
const toLocalDateTimeInput = (date = new Date()) => {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const initialBooking = { serviceId: "", providerId: "", scheduledAt: toLocalDateTimeInput(), notes: "" };

export default function AppointmentsPage() {
  const { user, activeBranch } = useAuth();
  const toast = useToast();
  const dialog = useDialog();
  const { money, dateTime } = useFormat();

  const [customers, setCustomers] = useState([]);
  const [services, setServices] = useState([]);
  const [providers, setProviders] = useState([]);
  const [discounts, setDiscounts] = useState([]);
  const [activeTaxes, setActiveTaxes] = useState([]);

  const [customerId, setCustomerId] = useState("");
  const [bookings, setBookings] = useState([]); // this customer's scheduled + completed, unbilled
  const [booking, setBooking] = useState(initialBooking);
  const [cart, setCart] = useState([]); // completed appointments staged for checkout

  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [discountId, setDiscountId] = useState("");

  const [loading, setLoading] = useState(true);
  const [booksLoading, setBooksLoading] = useState(false);
  const [bookingBusy, setBookingBusy] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [lastReceipt, setLastReceipt] = useState(null);

  const round2 = (value) => Math.round(value * 100) / 100;

  const loadBaseData = async () => {
    setLoading(true);
    try {
      const [customersRes, servicesRes, usersRes, discountsRes, taxesRes] = await Promise.all([
        apiClient.get("/customers"),
        apiClient.get("/services"),
        apiClient.get("/users"),
        apiClient.get("/discounts", { params: { status: "active" } }),
        apiClient.get("/taxes", { params: { status: "active" } }),
      ]);
      setCustomers(customersRes.data.data);
      setServices(servicesRes.data.data.filter((s) => s.isActive));
      setProviders(usersRes.data.data.filter((u) => u.isActive !== false));
      setDiscounts(discountsRes.data.data);
      setActiveTaxes(taxesRes.data.data);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBaseData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBranch.id]);

  // Whenever the selected customer changes, load their unbilled bookings.
  const loadBookings = async (forCustomerId) => {
    if (!forCustomerId) {
      setBookings([]);
      return;
    }
    setBooksLoading(true);
    try {
      const res = await apiClient.get("/appointments", {
        params: { branchId: activeBranch.id, customerId: forCustomerId, uninvoiced: true },
      });
      // Only scheduled (to complete) and completed (to bill) are actionable.
      setBookings(res.data.data.filter((a) => a.status === "scheduled" || a.status === "completed"));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBooksLoading(false);
    }
  };

  useEffect(() => {
    loadBookings(customerId);
    setCart([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, activeBranch.id]);

  const handleBookingChange = (event) => {
    setBooking((prev) => ({ ...prev, [event.target.name]: event.target.value }));
  };

  const bookService = async (event) => {
    event.preventDefault();
    if (!customerId) return;
    setBookingBusy(true);
    try {
      await apiClient.post("/appointments", {
        branchId: activeBranch.id,
        customerId,
        providerId: booking.providerId,
        serviceId: booking.serviceId,
        scheduledAt: new Date(booking.scheduledAt).toISOString(),
        notes: booking.notes || undefined,
      });
      const serviceName = services.find((s) => s.id === booking.serviceId)?.name || "Service";
      toast.success(`${serviceName} booked.`);
      setBooking({ ...initialBooking, scheduledAt: toLocalDateTimeInput() });
      await loadBookings(customerId);
    } catch (err) {
      // Surfaces the backend's double-booking conflict (409) as-is.
      toast.error(err.message);
    } finally {
      setBookingBusy(false);
    }
  };

  // Step 1 of the two-button flow: mark the delivered service completed,
  // which is what unlocks "Add to cart" for that booking.
  const completeBooking = async (appointment) => {
    setBusyId(appointment.id);
    try {
      await apiClient.patch(`/appointments/${appointment.id}/status`, { status: "completed" });
      toast.success(`${appointment.serviceName} completed — ready to add to cart.`);
      await loadBookings(customerId);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const inCart = (appointmentId) => cart.some((c) => c.appointmentId === appointmentId);

  // Step 2: stage the completed booking for checkout.
  const addToCart = (appointment) => {
    if (inCart(appointment.id)) return;
    setCart((prev) => [
      ...prev,
      {
        appointmentId: appointment.id,
        label: appointment.serviceName,
        unitPrice: Number(appointment.price),
      },
    ]);
  };

  const removeFromCart = (appointmentId) => {
    setCart((prev) => prev.filter((c) => c.appointmentId !== appointmentId));
  };

  const subtotal = round2(cart.reduce((sum, item) => sum + item.unitPrice, 0));
  const selectedDiscount = discounts.find((d) => d.id === discountId);
  const discountAmount = selectedDiscount ? round2(Math.min(selectedDiscount.amount, subtotal)) : 0;
  const taxRate = activeTaxes.reduce((sum, tax) => sum + tax.rate, 0);
  const taxAmount = round2(((subtotal - discountAmount) * taxRate) / 100);
  const total = round2(subtotal - discountAmount + taxAmount);

  const checkout = async () => {
    setSubmitting(true);
    try {
      const response = await apiClient.post("/sales", {
        customerId,
        branchId: activeBranch.id,
        paymentMethod,
        discountId: discountId || undefined,
        items: cart.map((item) => ({ itemType: "service", appointmentId: item.appointmentId })),
      });
      setLastReceipt(response.data.data);
      // Pop the receipt straight up on a completed sale (reprintable
      // from the "Sale completed" panel afterwards).
      handlePrintReceipt(response.data.data);
      setCart([]);
      setDiscountId("");
      toast.success(`Sale completed — ${money(response.data.data.totalAmount)}.`);
      await loadBookings(customerId);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

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

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === customerId),
    [customers, customerId]
  );

  const inputClass =
    "w-full rounded border border-paper-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal";

  return (
    <div>
      <div className="mb-6">
        <span className="field-label text-berry">Services</span>
        <h2 className="font-display text-xl font-semibold text-ink">Appointments</h2>
      </div>

      {lastReceipt && (
        <div className="mb-6 ledger-card py-5 pr-5" style={ACCENT_STYLE}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="field-label mb-1 text-berry">Sale completed</p>
              <p className="text-sm text-ink">
                {lastReceipt.customerName} — {money(lastReceipt.totalAmount)} ({lastReceipt.items.length} service
                {lastReceipt.items.length === 1 ? "" : "s"}), paid by {lastReceipt.payments[0]?.method || "cash"}.
              </p>
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
        {/* Left: pick a customer, book services, work each booking. */}
        <div className="space-y-5 lg:col-span-2 min-w-0">
          <div>
            <label htmlFor="customerId" className="field-label mb-1 block">
              Customer
            </label>
            <select
              id="customerId"
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
              className={inputClass}
            >
              <option value="">Select a customer to book for…</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-ink-soft">
              Serving a walk-in with no account? Sell the service directly on the Sales page (Services tab).
            </p>
          </div>

          {customerId && (
            <form onSubmit={bookService} className="ledger-card space-y-3 py-5 pr-5" style={ACCENT_STYLE}>
              <p className="field-label">Book a service for {selectedCustomer?.name}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="serviceId" className="field-label mb-1 block">
                    Service
                  </label>
                  <select id="serviceId" name="serviceId" required value={booking.serviceId} onChange={handleBookingChange} className={inputClass}>
                    <option value="" disabled>Select a service</option>
                    {services.map((service) => (
                      <option key={service.id} value={service.id}>
                        {service.name} ({service.durationMinutes} min, {money(service.price)})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="providerId" className="field-label mb-1 block">
                    Provider
                  </label>
                  <select id="providerId" name="providerId" required value={booking.providerId} onChange={handleBookingChange} className={inputClass}>
                    <option value="" disabled>Select a provider</option>
                    {providers.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.firstName} {provider.lastName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="scheduledAt" className="field-label mb-1 block">
                    Date &amp; time
                  </label>
                  <input
                    id="scheduledAt"
                    name="scheduledAt"
                    type="datetime-local"
                    required
                    value={booking.scheduledAt}
                    onChange={handleBookingChange}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="notes" className="field-label mb-1 block">
                    Notes <span className="normal-case text-ink-soft">(optional)</span>
                  </label>
                  <input id="notes" name="notes" value={booking.notes} onChange={handleBookingChange} className={inputClass} />
                </div>
              </div>
              <button type="submit" disabled={bookingBusy || services.length === 0} className="btn-solid btn-solid-primary btn-solid-sm">
                {bookingBusy ? "Booking…" : "Book service"}
              </button>
              {services.length === 0 && (
                <p className="text-xs text-ink-soft">Add an active service under Inventory → Services first.</p>
              )}
            </form>
          )}

          {customerId && (
            <div>
              <p className="field-label mb-2">Bookings for {selectedCustomer?.name}</p>
              {booksLoading ? (
                <p className="text-sm text-ink-soft">Loading bookings…</p>
              ) : bookings.length === 0 ? (
                <p className="text-sm text-ink-soft">No open bookings — book a service above.</p>
              ) : (
                <div className="space-y-2">
                  {bookings.map((appt) => {
                    const isCompleted = appt.status === "completed";
                    const added = inCart(appt.id);
                    return (
                      <div key={appt.id} className="panel flex flex-wrap items-center justify-between gap-3 px-4 py-3" style={ACCENT_STYLE}>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ink">
                            {appt.serviceName} — {money(appt.price)}
                          </p>
                          <p className="font-mono text-xs text-ink-soft">
                            {dateTime(appt.scheduledAt)} · {appt.providerName}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusChip tone={STATUS_TONES[appt.status] || "neutral"}>
                            {appt.status.replace("_", " ")}
                          </StatusChip>
                          {/* Two-button flow: Complete first, which unlocks Add to cart. */}
                          {!isCompleted && (
                            <button
                              type="button"
                              onClick={() => completeBooking(appt)}
                              disabled={busyId === appt.id}
                              className="btn-solid btn-solid-sm btn-solid-success"
                            >
                              {busyId === appt.id ? "…" : "Complete"}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => addToCart(appt)}
                            disabled={!isCompleted || added}
                            className="btn-solid btn-solid-sm btn-solid-primary"
                            title={!isCompleted ? "Complete the service first" : added ? "Already in cart" : "Add to cart"}
                          >
                            {added ? "In cart ✓" : "Add to cart"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {!customerId && !loading && (
            <EmptyState
              icon="📅"
              title="Pick a customer to begin"
              hint="Book their services, complete each as it's delivered, then add them to the cart and check out."
            />
          )}
        </div>

        {/* Right: cart + checkout (sticky), mirroring the Sales page. */}
        <div className="lg:col-span-1 min-w-0">
          <div className="ledger-card sticky top-24 space-y-4 py-6 pr-6" style={ACCENT_STYLE}>
            <div>
              <p className="field-label mb-1">Cart</p>
              {cart.length === 0 ? (
                <p className="text-sm text-ink-soft">
                  {customerId ? "Complete a booking, then add it here." : "Select a customer to start."}
                </p>
              ) : (
                <div className="space-y-1">
                  {cart.map((item) => (
                    <div key={item.appointmentId} className="flex items-center justify-between rounded border border-paper-line px-3 py-2 text-sm">
                      <span className="min-w-0 truncate text-ink">{item.label}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="font-mono text-xs text-ink-soft">{money(item.unitPrice)}</span>
                        <button type="button" onClick={() => removeFromCart(item.appointmentId)} className="btn-link btn-link-danger">
                          Remove
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label htmlFor="discountId" className="field-label mb-1 block">
                Discount
              </label>
              <select id="discountId" value={discountId} onChange={(event) => setDiscountId(event.target.value)} className={inputClass}>
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
              <label htmlFor="paymentMethod" className="field-label mb-1 block">
                Payment method
              </label>
              <select id="paymentMethod" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} className={inputClass}>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="transfer">Transfer</option>
                <option value="other">Other</option>
              </select>
            </div>

            <button type="button" onClick={checkout} disabled={submitting || cart.length === 0} className="btn-solid btn-solid-primary">
              {submitting ? "Completing sale…" : "Complete sale"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
