import { getBrandTokens } from '../lib/tokens.js';

export function getPdfBrand() {
  return getBrandTokens();
}

const FONT = 'Helvetica';
const FONT_BOLD = 'Helvetica-Bold';

/** Shared page geometry — every branded doc uses LETTER + these margins. */
export const PDF_PAGE = {
  size: 'LETTER',
  margins: { top: 44, left: 48, right: 48, bottom: 74 },
};

/**
 * Palette derived from the brand tokens so every document shares one look.
 * @param {object} brand
 */
function palette(brand) {
  const c = brand.colors;
  return {
    ink: c.ink,
    inkSoft: c.inkSoft,
    inkMuted: c.inkMuted,
    purple: c.purple,
    mint: c.mint,
    sage: c.sage,
    sageLight: c.sageLight,
    cream: c.cream,
    creamDark: c.creamDark,
    border: c.border,
    borderLight: c.borderLight,
    body: brand.pdf.bodyColor,
    muted: brand.pdf.mutedColor,
    zebra: '#F6F5FB',
    headerText: '#FFFFFF',
    headerSubtle: '#C9C4D6',
  };
}

function contentWidth(doc) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

/** Ensure `needed` px are available below `y`; add a page and return the new y if not. */
export function pdfEnsureSpace(doc, y, needed) {
  const limit = doc.page.height - doc.page.margins.bottom;
  if (y + needed > limit) {
    doc.addPage();
    return doc.page.margins.top;
  }
  return y;
}

/**
 * Branded header band + optional meta strip. Returns the y where content should begin.
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} [opts.subtitle]
 * @param {string} [opts.docType]
 * @param {{label:string,value:string}[]} [opts.meta]
 */
export function pdfDrawHeader(doc, { title, subtitle, docType, meta = [] } = {}) {
  const brand = getPdfBrand();
  const p = palette(brand);
  const margin = doc.page.margins.left;
  const pageW = doc.page.width;
  const bandH = 100;

  doc.save();
  doc.rect(0, 0, pageW, bandH).fill(p.ink);
  doc.rect(0, bandH - 5, pageW, 5).fill(p.mint);

  doc
    .fillColor(p.headerText)
    .font(FONT_BOLD)
    .fontSize(19)
    .text(brand.name.display, margin, 26, { lineBreak: false });
  doc
    .font(FONT)
    .fontSize(9)
    .fillColor(p.mint)
    .text(brand.name.tagline, margin, 51, { lineBreak: false });
  doc
    .fillColor(p.headerSubtle)
    .fontSize(8)
    .text(brand.contact.supportEmail, margin, 65, { lineBreak: false });

  const rightW = 240;
  const rightX = pageW - margin - rightW;
  if (docType) {
    doc
      .fillColor(p.mint)
      .font(FONT_BOLD)
      .fontSize(9)
      .text(String(docType).toUpperCase(), rightX, 28, {
        width: rightW,
        align: 'right',
        characterSpacing: 1.5,
      });
  }
  doc
    .fillColor(p.headerText)
    .font(FONT_BOLD)
    .fontSize(23)
    .text(title, rightX, 44, { width: rightW, align: 'right', lineBreak: false });
  doc.restore();

  let y = bandH + 22;

  if (subtitle) {
    doc.font(FONT).fontSize(10).fillColor(p.inkSoft).text(subtitle, margin, y, {
      width: contentWidth(doc),
      lineBreak: false,
    });
    y += 18;
  }

  if (meta.length) {
    y = drawMetaStrip(doc, meta.filter((m) => m && m.value != null && String(m.value).trim() !== ''), y);
  }

  doc.font(FONT).fillColor(p.body);
  doc.y = y;
  return y;
}

/** Full-width light strip split into evenly sized label/value columns. */
function drawMetaStrip(doc, meta, y) {
  if (!meta.length) return y;
  const brand = getPdfBrand();
  const p = palette(brand);
  const margin = doc.page.margins.left;
  const w = contentWidth(doc);
  const h = 48;
  const n = meta.length;
  const colW = w / n;

  doc.save();
  doc.roundedRect(margin, y, w, h, 8).fill(p.sageLight);
  meta.forEach((m, i) => {
    const x = margin + i * colW;
    if (i > 0) {
      doc
        .strokeColor(p.border)
        .lineWidth(0.5)
        .moveTo(x, y + 9)
        .lineTo(x, y + h - 9)
        .stroke();
    }
    doc
      .fillColor(p.inkMuted)
      .font(FONT)
      .fontSize(7.5)
      .text(String(m.label).toUpperCase(), x + 14, y + 11, {
        width: colW - 20,
        characterSpacing: 0.6,
        lineBreak: false,
      });
    doc
      .fillColor(p.ink)
      .font(FONT_BOLD)
      .fontSize(11.5)
      .text(String(m.value), x + 14, y + 25, { width: colW - 20, ellipsis: true, lineBreak: false });
  });
  doc.restore();
  return y + h + 20;
}

/**
 * Row of equal-width info cards (e.g. Billed to / Ship to).
 * @param {{title:string, lines:string[]}[]} cards
 */
export function pdfInfoCards(doc, cards, startY) {
  const brand = getPdfBrand();
  const p = palette(brand);
  const margin = doc.page.margins.left;
  const w = contentWidth(doc);
  const gap = 16;
  const n = cards.length;
  const cardW = (w - gap * (n - 1)) / n;
  const pad = 13;
  const titleH = 17;
  const lineH = 13.5;

  const maxLines = cards.reduce((m, c) => Math.max(m, (c.lines || []).filter(Boolean).length), 0);
  const cardH = pad * 2 + titleH + maxLines * lineH;

  let y = startY != null ? startY : doc.y;
  y = pdfEnsureSpace(doc, y, cardH + 20);

  cards.forEach((card, i) => {
    const x = margin + i * (cardW + gap);
    doc.save();
    doc.roundedRect(x, y, cardW, cardH, 9).fillAndStroke(p.cream, p.border);
    doc.restore();
    doc
      .fillColor(p.purple)
      .font(FONT_BOLD)
      .fontSize(8.5)
      .text(String(card.title).toUpperCase(), x + pad, y + pad, {
        width: cardW - pad * 2,
        characterSpacing: 0.6,
        lineBreak: false,
      });
    let ly = y + pad + titleH;
    (card.lines || []).filter(Boolean).forEach((ln, idx) => {
      const strong = idx === 0;
      doc
        .font(strong ? FONT_BOLD : FONT)
        .fontSize(9.5)
        .fillColor(strong ? p.ink : p.body)
        .text(String(ln), x + pad, ly, { width: cardW - pad * 2, ellipsis: true, lineBreak: false });
      ly += lineH;
    });
  });

  doc.y = y + cardH + 22;
  return doc.y;
}

/** Small uppercase section label with a short accent underline. */
export function pdfSectionLabel(doc, label, startY) {
  const brand = getPdfBrand();
  const p = palette(brand);
  const margin = doc.page.margins.left;
  let y = startY != null ? startY : doc.y;
  y = pdfEnsureSpace(doc, y, 26);
  doc
    .fillColor(p.ink)
    .font(FONT_BOLD)
    .fontSize(10.5)
    .text(String(label).toUpperCase(), margin, y, { characterSpacing: 0.6, lineBreak: false });
  doc
    .save()
    .strokeColor(p.mint)
    .lineWidth(2)
    .moveTo(margin, y + 16)
    .lineTo(margin + 34, y + 16)
    .stroke()
    .restore();
  doc.y = y + 24;
  return doc.y;
}

/**
 * Reusable data table with header band, zebra striping, wrapping cells and page breaks.
 * columns: { key, label, width?, align?, strong?, bold?, subKey? }
 *   width: fraction (<=1) of content width or absolute px; omit / 0 for the flex column.
 * @returns {number} bottom y
 */
export function pdfTable(doc, { columns, rows, startY, zebra = true }) {
  const brand = getPdfBrand();
  const p = palette(brand);
  const margin = doc.page.margins.left;
  const w = contentWidth(doc);
  const padX = 10;
  const topPad = 8;
  const minRowH = 24;
  const headerH = 28;

  const cols = columns.map((c) => ({ ...c }));
  let used = 0;
  let flex = null;
  for (const c of cols) {
    if (!c.width) flex = c;
    else {
      c._w = c.width <= 1 ? w * c.width : c.width;
      used += c._w;
    }
  }
  if (flex) flex._w = Math.max(90, w - used);

  let y = startY != null ? startY : doc.y;

  const drawHead = () => {
    doc.save();
    doc.roundedRect(margin, y, w, headerH, 4).fill(p.ink);
    doc.restore();
    let x = margin;
    doc.font(FONT_BOLD).fontSize(8.5).fillColor('#FFFFFF');
    for (const c of cols) {
      doc.text(String(c.label).toUpperCase(), x + padX, y + 9.5, {
        width: c._w - padX * 2,
        align: c.align || 'left',
        characterSpacing: 0.5,
        lineBreak: false,
      });
      x += c._w;
    }
    y += headerH;
  };

  const measureRow = (row) => {
    let h = 0;
    for (const c of cols) {
      const main = String(row[c.key] ?? '');
      doc.font(c.bold ? FONT_BOLD : FONT).fontSize(9.5);
      let cellH = doc.heightOfString(main, { width: c._w - padX * 2 });
      if (c.subKey && row[c.subKey]) {
        doc.font(FONT).fontSize(7.5);
        cellH += doc.heightOfString(String(row[c.subKey]), { width: c._w - padX * 2 }) + 2;
      }
      h = Math.max(h, cellH);
    }
    return Math.max(minRowH, h + topPad * 2);
  };

  y = pdfEnsureSpace(doc, y, headerH + minRowH);
  drawHead();

  const bottomLimit = doc.page.height - doc.page.margins.bottom;

  rows.forEach((row, ri) => {
    const rowH = measureRow(row);
    if (y + rowH > bottomLimit) {
      doc.addPage();
      y = doc.page.margins.top;
      drawHead();
    }
    if (zebra && ri % 2 === 1) {
      doc.save();
      doc.rect(margin, y, w, rowH).fill(p.zebra);
      doc.restore();
    }
    let x = margin;
    for (const c of cols) {
      const main = String(row[c.key] ?? '');
      doc
        .font(c.bold ? FONT_BOLD : FONT)
        .fontSize(9.5)
        .fillColor(c.strong ? p.ink : p.body)
        .text(main, x + padX, y + topPad, { width: c._w - padX * 2, align: c.align || 'left' });
      if (c.subKey && row[c.subKey]) {
        const mh = doc.heightOfString(main, { width: c._w - padX * 2 });
        doc
          .font(FONT)
          .fontSize(7.5)
          .fillColor(p.muted)
          .text(String(row[c.subKey]), x + padX, y + topPad + mh + 1, {
            width: c._w - padX * 2,
            align: c.align || 'left',
            lineBreak: false,
            ellipsis: true,
          });
      }
      x += c._w;
    }
    doc
      .save()
      .strokeColor(p.borderLight)
      .lineWidth(0.5)
      .moveTo(margin, y + rowH)
      .lineTo(margin + w, y + rowH)
      .stroke()
      .restore();
    y += rowH;
  });

  doc.y = y;
  return y;
}

/**
 * Right-aligned totals block with a highlighted grand-total row.
 * @param {{label:string,value:string}[]} rows
 * @param {{label:string,value:string}} total
 */
export function pdfTotals(doc, { rows, total, startY }) {
  const brand = getPdfBrand();
  const p = palette(brand);
  const margin = doc.page.margins.left;
  const pageW = doc.page.width;
  const boxW = 250;
  const x = pageW - margin - boxW;
  const lineH = 20;
  const totalH = 36;
  const needed = rows.length * lineH + totalH + 24;

  let y = (startY != null ? startY : doc.y) + 18;
  y = pdfEnsureSpace(doc, y, needed);

  doc.font(FONT).fontSize(10);
  rows.forEach((r) => {
    doc.fillColor(p.inkMuted).text(r.label, x, y, { width: boxW * 0.52, lineBreak: false });
    doc
      .fillColor(p.body)
      .text(r.value, x + boxW * 0.52, y, { width: boxW * 0.48, align: 'right', lineBreak: false });
    y += lineH;
  });

  doc
    .save()
    .strokeColor(p.border)
    .lineWidth(0.75)
    .moveTo(x, y + 3)
    .lineTo(x + boxW, y + 3)
    .stroke()
    .restore();
  y += 11;

  doc.save();
  doc.roundedRect(x, y, boxW, totalH, 7).fill(p.purple);
  doc.restore();
  doc
    .fillColor('#FFFFFF')
    .font(FONT_BOLD)
    .fontSize(10.5)
    .text(String(total.label).toUpperCase(), x + 14, y + 13, {
      width: boxW * 0.5,
      characterSpacing: 0.6,
      lineBreak: false,
    });
  doc
    .fontSize(15)
    .text(String(total.value), x + boxW * 0.45 - 14, y + 10, {
      width: boxW * 0.55,
      align: 'right',
      lineBreak: false,
    });

  doc.y = y + totalH + 10;
  return doc.y;
}

/**
 * Subtle rounded note / thank-you block.
 * @param {{title?:string, body:string|string[], startY?:number, width?:number, accent?:string}} opts
 */
export function pdfNoteBlock(doc, { title, body, startY, width, accent } = {}) {
  const brand = getPdfBrand();
  const p = palette(brand);
  const margin = doc.page.margins.left;
  const w = width || contentWidth(doc);
  const lines = Array.isArray(body) ? body.filter(Boolean) : [body].filter(Boolean);
  const pad = 13;
  const titleH = title ? 16 : 0;
  const innerW = w - pad * 2 - 6;

  doc.font(FONT).fontSize(9.5);
  const bodyH = lines.reduce((h, ln) => h + doc.heightOfString(String(ln), { width: innerW }) + 2, 0);
  const boxH = pad * 2 + titleH + bodyH;

  let y = startY != null ? startY : doc.y;
  y = pdfEnsureSpace(doc, y, boxH + 12);

  doc.save();
  doc.roundedRect(margin, y, w, boxH, 9).fillAndStroke(p.sageLight, p.border);
  doc.rect(margin, y + 8, 4, boxH - 16).fill(accent || p.mint);
  doc.restore();

  let ly = y + pad;
  if (title) {
    doc
      .fillColor(p.purple)
      .font(FONT_BOLD)
      .fontSize(8.5)
      .text(String(title).toUpperCase(), margin + pad + 6, ly, {
        width: innerW,
        characterSpacing: 0.6,
        lineBreak: false,
      });
    ly += titleH;
  }
  doc.font(FONT).fontSize(9.5).fillColor(p.body);
  lines.forEach((ln) => {
    doc.text(String(ln), margin + pad + 6, ly, { width: innerW });
    ly += doc.heightOfString(String(ln), { width: innerW }) + 2;
  });

  doc.y = y + boxH + 14;
  return doc.y;
}

/** Vertical checklist card (packing slip). items: string[] */
export function pdfChecklist(doc, { items, startY }) {
  const brand = getPdfBrand();
  const p = palette(brand);
  const margin = doc.page.margins.left;
  const w = contentWidth(doc);
  const rowH = 26;
  let y = startY != null ? startY : doc.y;

  items.forEach((item, i) => {
    y = pdfEnsureSpace(doc, y, rowH);
    if (i % 2 === 1) {
      doc.save();
      doc.rect(margin, y, w, rowH).fill(p.zebra);
      doc.restore();
    }
    doc.save();
    doc.roundedRect(margin + 8, y + 6, 14, 14, 3).lineWidth(1).stroke(p.sage);
    doc.restore();
    doc
      .font(FONT)
      .fontSize(10.5)
      .fillColor(p.body)
      .text(String(item), margin + 32, y + 7, { width: w - 42, lineBreak: false, ellipsis: true });
    doc
      .save()
      .strokeColor(p.borderLight)
      .lineWidth(0.5)
      .moveTo(margin, y + rowH)
      .lineTo(margin + w, y + rowH)
      .stroke()
      .restore();
    y += rowH;
  });

  doc.y = y;
  return y;
}

/** Two-column key/value card grid (shipping summary). pairs: {label,value}[] */
export function pdfDetailGrid(doc, pairs, startY) {
  const brand = getPdfBrand();
  const p = palette(brand);
  const margin = doc.page.margins.left;
  const w = contentWidth(doc);
  const gap = 16;
  const colW = (w - gap) / 2;
  const cellH = 44;
  const rows = Math.ceil(pairs.length / 2);
  let y = startY != null ? startY : doc.y;
  y = pdfEnsureSpace(doc, y, rows * (cellH + 10));

  pairs.forEach((pair, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = margin + col * (colW + gap);
    const cy = y + row * (cellH + 10);
    doc.save();
    doc.roundedRect(x, cy, colW, cellH, 8).fillAndStroke(p.cream, p.border);
    doc.restore();
    doc
      .fillColor(p.inkMuted)
      .font(FONT)
      .fontSize(7.5)
      .text(String(pair.label).toUpperCase(), x + 12, cy + 9, {
        width: colW - 24,
        characterSpacing: 0.6,
        lineBreak: false,
      });
    doc
      .fillColor(p.ink)
      .font(FONT_BOLD)
      .fontSize(11)
      .text(String(pair.value ?? '—'), x + 12, cy + 23, {
        width: colW - 24,
        ellipsis: true,
        lineBreak: false,
      });
  });

  doc.y = y + rows * (cellH + 10) + 6;
  return doc.y;
}

/** Draw the branded footer (support + page numbers) on every buffered page. Call before doc.end(). */
export function pdfRenderFooters(doc) {
  const brand = getPdfBrand();
  const p = palette(brand);
  let range;
  try {
    range = doc.bufferedPageRange();
  } catch {
    return;
  }
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    const margin = doc.page.margins.left;
    const pageW = doc.page.width;
    const y = doc.page.height - doc.page.margins.bottom + 18;
    doc.save();
    doc
      .strokeColor(p.border)
      .lineWidth(0.5)
      .moveTo(margin, y)
      .lineTo(pageW - margin, y)
      .stroke();
    doc.font(FONT).fontSize(8).fillColor(p.muted);
    doc.text(`${brand.name.legal}  ·  ${brand.contact.supportEmail}`, margin, y + 8, {
      width: (pageW - margin * 2) * 0.75,
      align: 'left',
      lineBreak: false,
    });
    doc.text(`Page ${i + 1} of ${range.count}`, margin, y + 8, {
      width: pageW - margin * 2,
      align: 'right',
      lineBreak: false,
    });
    doc.restore();
  }
}

/* ------------------------------------------------------------------ */
/* Legacy helpers (kept for backward compatibility)                    */
/* ------------------------------------------------------------------ */

export function pdfDrawFooter(doc) {
  pdfRenderFooters(doc);
}

export function pdfSectionTitle(doc, label) {
  return pdfSectionLabel(doc, label);
}

export function pdfKeyValue(doc, pairs) {
  const c = getPdfBrand().pdf;
  for (const { label, value } of pairs) {
    if (value == null || String(value).trim() === '') continue;
    doc.fontSize(9).fillColor(c.mutedColor).text(`${label}: `, { continued: true });
    doc.fillColor(c.bodyColor).fontSize(10).text(String(value));
  }
}

export function moneyUsd(n) {
  const value = Number(n || 0);
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function addressLines(json) {
  if (!json || typeof json !== 'object') return ['—'];
  const a = json;
  const l1 = String(a.addressLine1 || a.street1 || '').trim();
  const l2 = String(a.addressLine2 || a.street2 || '').trim();
  const city = String(a.city || '').trim();
  const st = String(a.state || '').trim();
  const zip = String(a.zipCode || a.zip || '').trim();
  const ctry = String(a.country || '').trim();
  const phone = String(a.phoneNumber || a.phone || '').trim();
  const lines = [[l1, l2].filter(Boolean).join(', '), [city, st, zip].filter(Boolean).join(', '), ctry];
  if (phone) lines.push(`Phone: ${phone}`);
  return lines.filter(Boolean).length ? lines : ['—'];
}

/** Build the "name / email / address" lines used inside info cards. */
export function contactCardLines(json, { name, email } = {}) {
  const lines = [];
  if (name && String(name).trim()) lines.push(String(name).trim());
  if (email && String(email).trim()) lines.push(String(email).trim());
  return [...lines, ...addressLines(json)];
}

export function collectPdfBuffer(doc) {
  const chunks = [];
  return new Promise((resolve, reject) => {
    doc.on('data', (d) => chunks.push(d));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}
