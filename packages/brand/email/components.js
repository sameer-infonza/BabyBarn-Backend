import { escapeHtml } from '../lib/escape.js';
import { getBrandTokens } from '../lib/tokens.js';

function t() {
  return getBrandTokens();
}

/** Branded wordmark header (optional hosted logo URL). */
export function emailHeader(brand) {
  const tokens = t();
  const c = tokens.colors;
  const logoUrl = brand?.urls?.logo;
  const logoBlock = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(tokens.name.display)}" width="160" style="display:block;max-width:160px;height:auto;border:0;" />`
    : `<div style="font-size:28px;font-weight:800;color:${c.purple};letter-spacing:0.4px;line-height:1.1;">${escapeHtml(tokens.name.display)}</div>
       <div style="font-size:11px;color:${c.sage};margin-top:6px;letter-spacing:0.35px;font-weight:600;">${escapeHtml(tokens.name.tagline)}</div>`;

  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation">
    <tr>
      <td align="center" style="padding:28px 24px 8px;">
        <div style="display:inline-block;background:${tokens.email.headerBadgeBg};border-radius:14px;padding:20px 32px;border:1px solid ${c.sageMid};">
          ${logoBlock}
        </div>
      </td>
    </tr>
  </table>`;
}

export function emailFooter(brand) {
  const tokens = t();
  const c = tokens.colors;
  const year = new Date().getFullYear();
  const store = escapeHtml(brand?.urls?.store || 'https://babybarn.co');
  const support = escapeHtml(brand?.contact?.supportEmail || tokens.contact.supportEmail);

  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation">
    <tr>
      <td style="background:${tokens.colors.emailFooterBg};border-top:1px solid ${c.borderLight};padding:18px 22px;font-size:12px;color:${c.emailMuted};line-height:19px;text-align:center;">
        <div style="font-weight:700;color:${c.charcoal};margin-bottom:8px;font-size:13px;">${escapeHtml(tokens.name.display)}</div>
        <div style="margin-bottom:10px;">${escapeHtml(tokens.legal.automatedNotice)}</div>
        <div>
          <a href="${store}" style="color:${c.sage};text-decoration:none;font-weight:600;">Shop</a>
          &nbsp;·&nbsp;
          <a href="mailto:${support}" style="color:${c.sage};text-decoration:none;font-weight:600;">${support}</a>
          &nbsp;·&nbsp;
          <a href="${escapeHtml(brand?.urls?.privacy || store + '/privacy-policy')}" style="color:${c.sage};text-decoration:none;">Privacy</a>
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding:12px 18px 22px;text-align:center;font-size:11px;color:${c.inkMuted};line-height:17px;">
        © ${year} ${escapeHtml(tokens.legal.copyrightHolder)}. All rights reserved.<br />
        <span style="color:${c.inkMuted};">${escapeHtml(tokens.name.legal)}</span>
      </td>
    </tr>
  </table>`;
}

/** Primary / secondary CTA — matches storefront mint + purple secondary. */
export function emailCtaButton(url, label, variant = 'primary') {
  const tokens = t();
  const isPrimary = variant === 'primary';
  const bg = isPrimary ? tokens.email.ctaPrimaryBg : tokens.email.ctaSecondaryBg;
  const color = isPrimary ? tokens.email.ctaPrimaryText : tokens.email.ctaSecondaryText;
  return `<table cellpadding="0" cellspacing="0" role="presentation" style="margin:16px 0;">
    <tr>
      <td align="center" style="border-radius:${tokens.spacing.buttonRadius}px;background:${bg};">
        <a href="${escapeHtml(url)}" style="display:inline-block;text-decoration:none;background:${bg};color:${color};font-weight:700;font-size:14px;line-height:44px;height:44px;padding:0 28px;border-radius:${tokens.spacing.buttonRadius}px;border:0;font-family:${tokens.typography.emailFontStack};">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>`;
}

export function emailPanel(innerHtml, { title } = {}) {
  const tokens = t();
  const c = tokens.colors;
  const titleRow = title
    ? `<tr><td style="padding:14px 16px 0;font-size:13px;font-weight:700;color:${c.purple};text-transform:uppercase;letter-spacing:0.06em;">${escapeHtml(title)}</td></tr>`
    : '';
  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:16px 0;background:${c.cream};border:1px solid ${c.border};border-radius:${tokens.spacing.cardRadius}px;">
    ${titleRow}
    <tr><td style="padding:14px 16px 16px;font-size:14px;line-height:22px;color:${c.emailBody};">${innerHtml}</td></tr>
  </table>`;
}

export function emailDivider() {
  const c = t().colors;
  return `<table width="100%" role="presentation"><tr><td style="padding:8px 0;"><div style="height:1px;background:${c.border};line-height:1px;font-size:1px;">&nbsp;</div></td></tr></table>`;
}

export function emailStatusBadge(label, tone = 'neutral') {
  const tokens = t();
  const palettes = {
    success: { bg: tokens.colors.sageLight, fg: tokens.colors.sageDark },
    warning: { bg: '#FFF0DC', fg: tokens.colors.amber },
    danger: { bg: '#FCEAEA', fg: tokens.colors.rose },
    info: { bg: '#E8F2F7', fg: tokens.colors.sky },
    neutral: { bg: tokens.colors.creamDark, fg: tokens.colors.muted },
  };
  const p = palettes[tone] || palettes.neutral;
  return `<span style="display:inline-block;padding:4px 12px;border-radius:999px;background:${p.bg};color:${p.fg};font-size:12px;font-weight:700;letter-spacing:0.02em;">${escapeHtml(label)}</span>`;
}

export function emailInfoRows(rows) {
  return rows
    .filter((r) => r?.value != null && String(r.value).trim() !== '')
    .map(
      (r) =>
        `<tr>
          <td style="padding:4px 0;font-size:13px;color:${t().colors.inkMuted};width:38%;vertical-align:top;">${escapeHtml(r.label)}</td>
          <td style="padding:4px 0;font-size:14px;color:${t().colors.ink};font-weight:${r.bold ? 700 : 400};">${escapeHtml(r.value)}</td>
        </tr>`
    )
    .join('');
}

export function emailCustomerBlock({ name, email, phone }) {
  const rows = emailInfoRows([
    { label: 'Name', value: name },
    { label: 'Email', value: email },
    { label: 'Phone', value: phone },
  ]);
  return emailPanel(`<table width="100%" cellpadding="0" cellspacing="0">${rows}</table>`, { title: 'Customer' });
}

export function emailAddressBlock(title, lines) {
  const body = (lines || ['—'])
    .map((ln) => `<div style="margin:2px 0;color:${t().colors.emailBody};">${escapeHtml(ln)}</div>`)
    .join('');
  return emailPanel(body, { title });
}

export function emailOrderSummary({ orderId, lines = [], subtotal, shipping, total, extraRows = [] }) {
  const lineHtml = lines
    .map((li) => {
      const meta = li.meta
        ? `<div style="font-size:11px;line-height:16px;color:${t().colors.inkMuted};margin-top:2px;">${escapeHtml(li.meta)}</div>`
        : '';
      const qtyUnit =
        li.unitPrice != null
          ? `${escapeHtml(String(li.qty))} × ${escapeHtml(li.unitPrice)}`
          : `× ${escapeHtml(String(li.qty))}`;
      return `<tr>
          <td style="padding:8px 0;font-size:13px;color:${t().colors.emailBody};vertical-align:top;">
            <div style="font-weight:600;color:${t().colors.ink};">${escapeHtml(li.name)}</div>
            ${meta}
            <div style="font-size:12px;color:${t().colors.inkMuted};margin-top:2px;">${qtyUnit}</div>
          </td>
          <td align="right" style="padding:8px 0;font-size:13px;font-weight:600;color:${t().colors.ink};vertical-align:top;white-space:nowrap;">${escapeHtml(li.total || li.amount || '')}</td>
        </tr>`;
    })
    .join('');

  const totals = [
    subtotal != null ? { label: 'Subtotal', value: subtotal } : null,
    shipping != null ? { label: 'Shipping', value: shipping } : null,
    ...extraRows,
    total != null ? { label: 'Total', value: total, bold: true } : null,
  ].filter(Boolean);

  const totalsHtml = totals
    .map(
      (row, i) =>
        `<tr>
          <td style="padding:${i === totals.length - 1 ? '10px' : '4px'} 0 4px;font-size:${row.bold ? '15px' : '13px'};font-weight:${row.bold ? 700 : 400};color:${row.bold ? t().colors.purple : t().colors.inkMuted};">${escapeHtml(row.label)}</td>
          <td align="right" style="padding:${i === totals.length - 1 ? '10px' : '4px'} 0 4px;font-size:${row.bold ? '15px' : '13px'};font-weight:700;color:${t().colors.ink};">${escapeHtml(row.value)}</td>
        </tr>`
    )
    .join('');

  const header = orderId
    ? `<div style="margin-bottom:10px;font-size:13px;color:${t().colors.inkMuted};">Order <strong style="color:${t().colors.purple};">${escapeHtml(orderId)}</strong></div>`
    : '';

  return emailPanel(
    `${header}
     <table width="100%" cellpadding="0" cellspacing="0">${lineHtml}</table>
     ${lineHtml ? emailDivider() : ''}
     <table width="100%" cellpadding="0" cellspacing="0">${totalsHtml}</table>`,
    { title: 'Order summary' }
  );
}

/**
 * Full tax-invoice block for customer order confirmation (mirrors PDF invoice fields).
 * @param {{
 *   invoiceNumber?: string,
 *   issueDate?: string,
 *   paymentStatus?: string,
 *   orderStatus?: string,
 *   billToLines?: string[],
 *   shipToLines?: string[],
 *   lines?: Array<{ name: string, meta?: string, qty: number|string, unitPrice?: string, amount: string }>,
 *   subtotal?: string,
 *   shipping?: string,
 *   tax?: string|null,
 *   storeCredit?: string|null,
 *   accessMembership?: string|null,
 *   total?: string,
 *   paymentMethod?: string,
 *   shippingMethod?: string,
 * }} opts
 */
export function emailInvoiceBlock(opts = {}) {
  const c = t().colors;
  const tokens = t();
  const lines = Array.isArray(opts.lines) ? opts.lines : [];

  const metaRows = emailInfoRows([
    { label: 'Invoice no.', value: opts.invoiceNumber, bold: true },
    { label: 'Issue date', value: opts.issueDate },
    { label: 'Payment', value: opts.paymentStatus, bold: true },
    { label: 'Order status', value: opts.orderStatus },
    { label: 'Shipping method', value: opts.shippingMethod },
    { label: 'Payment method', value: opts.paymentMethod },
  ]);

  const addressCell = (title, addressLines) => {
    const body = (addressLines || []).filter(Boolean).length
      ? addressLines
          .filter(Boolean)
          .map(
            (ln) =>
              `<div style="margin:2px 0;font-size:13px;line-height:19px;color:${c.emailBody};">${escapeHtml(ln)}</div>`
          )
          .join('')
      : `<div style="font-size:13px;color:${c.inkMuted};">—</div>`;
    return `<td width="50%" valign="top" style="padding:0 8px 0 0;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${c.purple};margin-bottom:8px;">${escapeHtml(title)}</div>
      ${body}
    </td>`;
  };

  const itemRows = lines
    .map((li, ri) => {
      const bg = ri % 2 ? c.white : c.cream;
      const meta = li.meta
        ? `<div style="font-size:11px;line-height:16px;color:${c.inkMuted};margin-top:3px;">${escapeHtml(li.meta)}</div>`
        : '';
      return `<tr style="background:${bg};">
        <td style="padding:10px 8px;font-size:13px;color:${c.emailBody};border-bottom:1px solid ${c.border};vertical-align:top;">
          <div style="font-weight:600;color:${c.ink};">${escapeHtml(li.name)}</div>
          ${meta}
        </td>
        <td align="center" style="padding:10px 6px;font-size:13px;color:${c.ink};border-bottom:1px solid ${c.border};vertical-align:top;white-space:nowrap;">${escapeHtml(String(li.qty))}</td>
        <td align="right" style="padding:10px 6px;font-size:13px;color:${c.inkSoft};border-bottom:1px solid ${c.border};vertical-align:top;white-space:nowrap;">${escapeHtml(li.unitPrice || '')}</td>
        <td align="right" style="padding:10px 8px;font-size:13px;font-weight:700;color:${c.ink};border-bottom:1px solid ${c.border};vertical-align:top;white-space:nowrap;">${escapeHtml(li.amount || li.total || '')}</td>
      </tr>`;
    })
    .join('');

  const extraTotals = [
    opts.tax != null ? { label: 'Tax', value: opts.tax } : null,
    opts.storeCredit != null ? { label: 'Store credit', value: opts.storeCredit } : null,
    opts.accessMembership != null ? { label: 'ACCESS membership', value: opts.accessMembership } : null,
  ].filter(Boolean);

  const totals = [
    opts.subtotal != null ? { label: 'Subtotal', value: opts.subtotal } : null,
    opts.shipping != null ? { label: 'Shipping', value: opts.shipping } : null,
    ...extraTotals,
    opts.total != null ? { label: 'Total paid', value: opts.total, bold: true } : null,
  ].filter(Boolean);

  const totalsHtml = totals
    .map((row, i) => {
      const last = i === totals.length - 1;
      return `<tr>
        <td style="padding:${last ? '12px' : '4px'} 0 4px;font-size:${last ? '15px' : '13px'};font-weight:${last ? 700 : 400};color:${last ? c.purple : c.inkMuted};">${escapeHtml(row.label)}</td>
        <td align="right" style="padding:${last ? '12px' : '4px'} 0 4px;font-size:${last ? '15px' : '13px'};font-weight:700;color:${c.ink};">${escapeHtml(row.value)}</td>
      </tr>`;
    })
    .join('');

  return `
    ${emailPanel(`<table width="100%" cellpadding="0" cellspacing="0">${metaRows}</table>`, { title: 'Invoice' })}
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:16px 0;">
      <tr>
        ${addressCell('Billed to', opts.billToLines)}
        ${addressCell('Ship to', opts.shipToLines)}
      </tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:8px 0 16px;border:1px solid ${c.border};border-radius:${tokens.spacing.cardRadius}px;overflow:hidden;">
      <tr>
        <td colspan="4" style="padding:12px 14px;background:${c.cream};border-bottom:1px solid ${c.border};font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${c.purple};">Items</td>
      </tr>
      <tr style="background:${c.creamDark || c.cream};">
        <th align="left" style="padding:8px;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:${c.inkMuted};border-bottom:1px solid ${c.border};">Description</th>
        <th align="center" style="padding:8px 6px;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:${c.inkMuted};border-bottom:1px solid ${c.border};">Qty</th>
        <th align="right" style="padding:8px 6px;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:${c.inkMuted};border-bottom:1px solid ${c.border};">Unit</th>
        <th align="right" style="padding:8px;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:${c.inkMuted};border-bottom:1px solid ${c.border};">Amount</th>
      </tr>
      ${itemRows || `<tr><td colspan="4" style="padding:14px;font-size:13px;color:${c.inkMuted};">No items</td></tr>`}
      <tr>
        <td colspan="4" style="padding:8px 14px 14px;background:${c.white};">
          <table width="100%" cellpadding="0" cellspacing="0">${totalsHtml}</table>
        </td>
      </tr>
    </table>
  `;
}

export function emailDataTable(headers, rows) {
  const th = headers
    .map(
      (h) =>
        `<th align="left" style="padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:${t().colors.inkMuted};border-bottom:2px solid ${t().colors.border};">${escapeHtml(h)}</th>`
    )
    .join('');
  const body = rows
    .map(
      (cells, ri) =>
        `<tr style="background:${ri % 2 ? t().colors.white : t().colors.cream};">
          ${cells
            .map(
              (cell) =>
                `<td style="padding:8px 10px;font-size:13px;color:${t().colors.emailBody};border-bottom:1px solid ${t().colors.border};">${escapeHtml(cell)}</td>`
            )
            .join('')}
        </tr>`
    )
    .join('');
  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;margin:12px 0;">${th ? `<thead><tr>${th}</tr></thead>` : ''}<tbody>${body}</tbody></table>`;
}

export function emailHeroText(headline, subline) {
  const c = t().colors;
  return `<div style="text-align:center;margin:8px 0 20px;">
    <div style="font-size:22px;font-weight:800;color:${c.purple};line-height:1.25;margin-bottom:8px;">${escapeHtml(headline)}</div>
    ${subline ? `<div style="font-size:14px;color:${c.inkSoft};line-height:22px;">${escapeHtml(subline)}</div>` : ''}
  </div>`;
}

export function emailBodyParagraph(html) {
  return `<p style="margin:0 0 14px;font-size:15px;line-height:24px;color:${t().colors.emailBody};">${html}</p>`;
}

export function emailMutedNote(text) {
  return `<p style="margin:12px 0 0;font-size:12px;line-height:18px;color:${t().colors.inkMuted};">${escapeHtml(text)}</p>`;
}

export function emailLinkFallback(url) {
  if (!url) return '';
  const safe = escapeHtml(url);
  const c = t().colors;
  return `<p style="margin:12px 0 0;font-size:12px;line-height:18px;color:${c.inkMuted};">If the button does not work, copy and paste this link:<br /><a href="${safe}" style="color:${c.sage};word-break:break-all;font-weight:600;">${safe}</a></p>`;
}
