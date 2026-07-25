/**
 * ============================================================
 * File: receipt.js
 * Module: Shared Utilities
 *
 * Description:
 * Printable sale receipt, branded per organization. Builds the receipt
 * HTML (80mm-thermal friendly: narrow column, monospace, no color) and
 * returns it for the print-preview modal to show and print. Contents:
 *   - the org's logo (if set), name, address, and contacts;
 *   - a receipt number, date/time, and cashier;
 *   - each line as "qty x ITEM @ unit" with its line total;
 *   - subtotal / discount / VAT / a prominent TOTAL;
 *   - the payment method and amount;
 *   - the org's custom message to customers.
 * Logo, address, contacts, and the message come from organization
 * settings (see the Business Profile page). No dependencies, no backend.
 * ============================================================
 */

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

// A short, human-friendly receipt number derived from the sale id — no
// sequence table, but stable and unique per sale (e.g. "R-9F3A2C10").
const receiptNumber = (sale) => `R-${String(sale.id).replace(/-/g, "").slice(0, 8).toUpperCase()}`;

/**
 * @param {object} params
 *   sale         — sale response (items, payments, cashierName).
 *   organization — { name }.
 *   branch       — { name, code }.
 *   settings     — org settings: { logo, business_address, business_phone,
 *                  business_email, receipt_message }.
 *   cashierName  — who served (falls back to sale.cashierName).
 *   money        — amount formatter (from useFormat).
 *   dateTime     — datetime formatter (from useFormat).
 */
export function buildReceiptHtml({ sale, organization, branch, settings = {}, cashierName, money, dateTime }) {
  const lines = (sale.items || [])
    .map((item) => {
      const qty = Number(item.quantity) || 1;
      const unit = money(item.unitPrice);
      // "3 x CADBURY @ 350.00" — qty and unit price, like a real till receipt.
      const desc = `${qty} &times; ${escapeHtml(item.description)}`;
      return `
        <tr>
          <td>${desc}<span class="unit">@ ${escapeHtml(unit)}</span></td>
          <td class="num">${escapeHtml(money(item.lineTotal))}</td>
        </tr>`;
    })
    .join("");

  const totalRow = (label, value, cls = "") => `
    <tr class="${cls}">
      <td>${label}</td>
      <td class="num">${escapeHtml(value)}</td>
    </tr>`;

  const payments = sale.payments || [];
  const cashier = cashierName || sale.cashierName;
  const cap = (s) => String(s || "").replace(/^\w/, (c) => c.toUpperCase());
  const contacts = [settings.business_phone, settings.business_email].filter(Boolean).join(" | ");
  // Anything not collected was put on the customer's account (payments only
  // record money taken, so total − collected = the credit portion).
  const paidTotal = payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const onAccount = Math.round((Number(sale.totalAmount) - paidTotal) * 100) / 100;

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Receipt ${escapeHtml(receiptNumber(sale))}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: "Courier New", ui-monospace, monospace; font-size: 12px; color: #000; width: 72mm; margin: 0 auto; padding: 4mm; }
  .logo { display: block; margin: 0 auto 4px; max-width: 40mm; max-height: 22mm; object-fit: contain; filter: grayscale(1); }
  h1 { font-size: 15px; text-align: center; text-transform: uppercase; letter-spacing: 0.05em; }
  .sub { text-align: center; font-size: 10.5px; margin-top: 2px; line-height: 1.35; }
  hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
  .meta { font-size: 11px; line-height: 1.5; }
  .meta .row { display: flex; justify-content: space-between; gap: 8px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 2px 0; vertical-align: top; }
  td.num { text-align: right; white-space: nowrap; padding-left: 8px; }
  .unit { display: block; font-size: 10px; color: #333; }
  tr.total td { font-weight: bold; font-size: 15px; border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 4px 0; }
  .msg { text-align: center; font-size: 11px; margin-top: 8px; font-weight: bold; text-transform: uppercase; line-height: 1.4; }
  .foot { text-align: center; font-size: 10px; margin-top: 8px; color: #333; }
  @media print { body { width: auto; } }
</style>
</head>
<body>
  ${settings.logo ? `<img class="logo" src="${escapeHtml(settings.logo)}" alt="" />` : ""}
  <h1>${escapeHtml(organization?.name || "Receipt")}</h1>
  ${settings.business_address ? `<p class="sub">${escapeHtml(settings.business_address)}</p>` : ""}
  ${contacts ? `<p class="sub">${escapeHtml(contacts)}</p>` : ""}
  ${branch?.name ? `<p class="sub">${escapeHtml(branch.name)}${branch.code ? ` (${escapeHtml(branch.code)})` : ""}</p>` : ""}
  <hr />
  <div class="meta">
    <div class="row"><span>Receipt No:</span><span>${escapeHtml(receiptNumber(sale))}</span></div>
    <div class="row"><span>Date:</span><span>${escapeHtml(dateTime(sale.createdAt))}</span></div>
    ${cashier ? `<div class="row"><span>Cashier:</span><span>${escapeHtml(cashier)}</span></div>` : ""}
    <div class="row"><span>Customer:</span><span>${escapeHtml(sale.customerName || "Walk-in")}</span></div>
  </div>
  <hr />
  <table>${lines}</table>
  <hr />
  <table>
    ${totalRow("Subtotal", money(sale.subtotal))}
    ${totalRow(`Discount${sale.discountCode ? ` (${escapeHtml(sale.discountCode)})` : ""}`, sale.discountAmount > 0 ? `-${money(sale.discountAmount)}` : money(0))}
    ${totalRow("VAT", money(sale.taxAmount))}
    ${totalRow("TOTAL", money(sale.totalAmount), "total")}
  </table>
  <div class="meta" style="margin-top:6px">
    ${payments.map((p) => `<div class="row"><span>${escapeHtml(cap(p.method))} paid</span><span>${escapeHtml(money(p.amount))}</span></div>`).join("")}
    ${onAccount > 0.005 ? `<div class="row"><span>On account (credit)</span><span>${escapeHtml(money(onAccount))}</span></div>` : ""}
    ${Number(sale.changeGiven) > 0 ? `<div class="row"><span>Change</span><span>${escapeHtml(money(sale.changeGiven))}</span></div>` : ""}
  </div>
  ${settings.receipt_message ? `<p class="msg">${escapeHtml(settings.receipt_message)}</p>` : ""}
  <p class="foot">${escapeHtml(receiptNumber(sale))} &middot; thank you</p>
</body>
</html>`;

  // Returned to the caller, which shows it in a print-preview modal
  // (see ToastContext dialog.print) — no popup window to be blocked.
  return { title: `Receipt ${receiptNumber(sale)}`, html };
}
