import PDFDocument from 'pdfkit';
import { collectPdfBuffer, getPdfBrand } from '@babybarn/brand/pdf';
import { renderCode128Png } from '../../lib/code128.js';

const LABEL = { w: 252, h: 176, gapX: 14, gapY: 14, cols: 2 };

/**
 * Vendor label — Code 128 encodes the immutable BBP code; SKU/name/location are display-only.
 * @param {{ code: string, name: string, sku: string, variantLabel?: string | null, location?: string | null }[]} labels
 */
export async function renderBarcodeLabelPdf(labels) {
  const brand = getPdfBrand();
  const doc = new PDFDocument({
    size: 'LETTER',
    margin: 36,
    info: { Title: 'Baby Barn barcodes', Author: brand.name.display },
  });
  const done = collectPdfBuffer(doc);

  const margin = 36;
  let col = 0;
  let x = margin;
  let y = margin;

  for (const label of labels) {
    if (y + LABEL.h > doc.page.height - margin) {
      doc.addPage();
      col = 0;
      x = margin;
      y = margin;
    }

    doc.save();
    doc.roundedRect(x, y, LABEL.w, LABEL.h, 8).stroke(brand.colors.border);
    doc
      .fillColor(brand.colors.purple)
      .font('Helvetica-Bold')
      .fontSize(7)
      .text(brand.name.display.toUpperCase(), x + 10, y + 8, { width: LABEL.w - 20, lineBreak: false });
    doc
      .fillColor(brand.colors.ink)
      .font('Helvetica-Bold')
      .fontSize(9)
      .text(label.name || 'Product', x + 10, y + 20, { width: LABEL.w - 20, height: 24 });
    doc
      .fillColor(brand.colors.inkMuted)
      .font('Helvetica')
      .fontSize(7.5)
      .text(label.variantLabel ? `${label.sku} · ${label.variantLabel}` : `SKU ${label.sku}`, x + 10, y + 46, {
        width: LABEL.w - 20,
      });
    if (label.location) {
      doc.text(`Loc ${label.location}`, x + 10, y + 58, { width: LABEL.w - 20 });
    }
    doc.restore();

    try {
      const png = await renderCode128Png(label.code, { scale: 2, height: 14 });
      doc.image(png, x + 16, y + 78, { width: LABEL.w - 32, height: 52 });
    } catch {
      /* bars are best-effort; human-readable code is always printed */
    }

    doc
      .fillColor(brand.colors.ink)
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(label.code, x + 10, y + 140, { width: LABEL.w - 20, align: 'center' });

    col += 1;
    if (col >= LABEL.cols) {
      col = 0;
      x = margin;
      y += LABEL.h + LABEL.gapY;
    } else {
      x += LABEL.w + LABEL.gapX;
    }
  }

  doc.end();
  return done;
}
