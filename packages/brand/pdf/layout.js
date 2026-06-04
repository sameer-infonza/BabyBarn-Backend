import { getBrandTokens } from '../lib/tokens.js';

export function getPdfBrand() {
  return getBrandTokens();
}

/** Draw branded top bar + title on a pdfkit document. */
export function pdfDrawHeader(doc, { title, subtitle, docType }) {
  const brand = getPdfBrand();
  const c = brand.pdf;
  const margin = doc.page.margins.left;
  const pageW = doc.page.width;
  const barH = c.headerBarHeight;

  doc.save();
  doc.rect(0, 0, pageW, barH).fill(c.accentBar);
  doc.fillColor('#FFFFFF').fontSize(11).text(brand.name.display, margin, 16, { continued: false });
  doc.fontSize(8).text(brand.name.tagline, margin, 32);
  if (docType) {
    doc.fontSize(8).text(docType.toUpperCase(), pageW - margin - 120, 20, { width: 120, align: 'right' });
  }
  doc.restore();

  doc.y = barH + 20;
  doc.fillColor(c.titleColor).fontSize(20).text(title, margin, doc.y, { width: pageW - margin * 2 });
  doc.moveDown(0.3);
  if (subtitle) {
    doc.fillColor(c.mutedColor).fontSize(10).text(subtitle);
    doc.moveDown(0.5);
  }
  doc.fillColor(c.bodyColor);
}

export function pdfDrawFooter(doc) {
  const brand = getPdfBrand();
  const c = brand.pdf;
  const margin = doc.page.margins.left;
  const pageW = doc.page.width;
  const y = doc.page.height - doc.page.margins.bottom - 28;

  doc.save();
  doc.strokeColor(brand.colors.border).lineWidth(0.5).moveTo(margin, y).lineTo(pageW - margin, y).stroke();
  doc.fillColor(c.mutedColor).fontSize(8);
  const support = brand.contact.supportEmail;
  const line = `${brand.name.legal} · ${support} · ${brand.name.display}`;
  doc.text(line, margin, y + 8, { width: pageW - margin * 2, align: 'center' });
  doc.restore();
}

export function pdfSectionTitle(doc, label) {
  const c = getPdfBrand().pdf;
  doc.moveDown(0.4);
  doc.fillColor(c.titleColor).fontSize(11).text(label, { underline: true });
  doc.fillColor(c.bodyColor).moveDown(0.25);
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
  return `$${Number(n || 0).toFixed(2)}`;
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

export function collectPdfBuffer(doc) {
  const chunks = [];
  return new Promise((resolve, reject) => {
    doc.on('data', (d) => chunks.push(d));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}
