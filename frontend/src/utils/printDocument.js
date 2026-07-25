/**
 * ============================================================
 * File: printDocument.js
 * Module: Shared Utilities
 *
 * Description:
 * Build ANY document out of the software under the organization's
 * letterhead — logo, business name, address, and contact details from
 * the Business Profile, followed by the document's own content —
 * returning HTML for the print-preview modal (see ToastContext
 * dialog.print). The receipt has its own tuned thermal layout
 * (utils/receipt.js); this is for full-page documents like reports, so
 * every paper that leaves the software carries the same branding.
 * ============================================================
 */

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

/**
 * @param {object} params
 *   title        — document heading (e.g. "Branch report").
 *   subtitle     — optional line under the title (e.g. the date range).
 *   bodyHtml     — the document's inner HTML (already escaped by caller).
 *   organization — { name }.
 *   branch       — { name, code }.
 *   settings     — org profile: { logo, business_address, business_phone, business_email }.
 *   footerNote   — optional line printed at the very bottom (e.g. generated timestamp).
 * @returns {boolean} false if the print window was blocked.
 */
export function buildBrandedDocumentHtml({ title, subtitle, bodyHtml, organization, branch, settings = {}, footerNote }) {
  const contacts = [settings.business_phone, settings.business_email].filter(Boolean).join(" &nbsp;|&nbsp; ");

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title || organization?.name || "Document")}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, "Segoe UI", Roboto, Arial, sans-serif; color: #211d1a; margin: 0; padding: 24px 28px; font-size: 13px; }
  .brand { text-align: center; border-bottom: 2px solid #0f6f63; padding-bottom: 12px; margin-bottom: 16px; }
  .brand img { max-height: 60px; max-width: 200px; object-fit: contain; margin-bottom: 6px; }
  .brand h1 { font-size: 20px; margin: 0; text-transform: uppercase; letter-spacing: 0.03em; }
  .brand p { margin: 2px 0 0; font-size: 11.5px; color: #6b6157; }
  .doc-title { margin: 4px 0 2px; font-size: 16px; font-weight: 600; }
  .doc-sub { margin: 0 0 14px; font-size: 12px; color: #6b6157; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 16px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e6e1d8; font-size: 12px; }
  th { background: #f3f1ec; text-transform: uppercase; letter-spacing: 0.04em; font-size: 10.5px; color: #6b6157; }
  td.num, th.num { text-align: right; }
  .kpis { display: flex; flex-wrap: wrap; gap: 10px; margin: 8px 0 16px; }
  .kpi { flex: 1 1 130px; border: 1px solid #e6e1d8; border-top: 3px solid #0f6f63; border-radius: 6px; padding: 8px 10px; }
  .kpi .label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; color: #6b6157; }
  .kpi .value { font-size: 17px; font-weight: 600; margin-top: 2px; }
  .section { font-size: 13px; font-weight: 600; margin: 14px 0 4px; }
  .foot { margin-top: 20px; border-top: 1px solid #e6e1d8; padding-top: 8px; font-size: 11px; color: #6b6157; text-align: center; }
</style>
</head>
<body>
  <div class="brand">
    ${settings.logo ? `<img src="${escapeHtml(settings.logo)}" alt="" />` : ""}
    <h1>${escapeHtml(organization?.name || "")}</h1>
    ${settings.business_address ? `<p>${escapeHtml(settings.business_address)}</p>` : ""}
    ${contacts ? `<p>${contacts}</p>` : ""}
    ${branch?.name ? `<p>${escapeHtml(branch.name)}${branch.code ? ` (${escapeHtml(branch.code)})` : ""}</p>` : ""}
  </div>
  ${title ? `<p class="doc-title">${escapeHtml(title)}</p>` : ""}
  ${subtitle ? `<p class="doc-sub">${escapeHtml(subtitle)}</p>` : ""}
  ${bodyHtml || ""}
  <div class="foot">${escapeHtml(footerNote || "")}</div>
</body>
</html>`;

  return { title: title || organization?.name || "Document", html };
}

// Small helper so callers can build body tables without re-escaping.
export const esc = escapeHtml;
