/**
 * Branded order PDFs — pdfkit/qrcode resolve from backend/node_modules.
 * Layout tokens/helpers live in packages/brand/pdf/layout.js.
 */
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import {
  addressLines,
  collectPdfBuffer,
  getPdfBrand,
  moneyUsd,
  pdfDrawFooter,
  pdfDrawHeader,
  pdfKeyValue,
  pdfSectionTitle,
} from '../../../packages/brand/pdf/layout.js';
import { renderPickupListLayout } from '../../../packages/brand/pdf/pickup-list.js';

function orderRef(order) {
  return order.orderNumber || order.publicId;
}

export async function renderInvoicePdfBuffer(order) {
  const brand = getPdfBrand();
  const doc = new PDFDocument({ size: 'LETTER', margin: 48 });
  const done = collectPdfBuffer(doc);

  pdfDrawHeader(doc, {
    title: 'Invoice',
    subtitle: `Order ${orderRef(order)}`,
    docType: 'Invoice',
  });

  pdfKeyValue(doc, [
    { label: 'Date', value: new Date(order.createdAt).toLocaleString() },
    { label: 'Payment', value: order.paymentStatus },
    { label: 'Status', value: order.status },
    ...(order.fulfillmentStatus ? [{ label: 'Fulfillment', value: order.fulfillmentStatus }] : []),
  ]);

  pdfSectionTitle(doc, 'Bill to / Ship to');
  addressLines(order.shippingAddressJson).forEach((ln) => doc.fontSize(10).text(ln));

  pdfSectionTitle(doc, 'Line items');
  let sub = 0;
  const margin = doc.page.margins.left;
  const tableW = doc.page.width - margin * 2;
  doc.fontSize(9).fillColor(brand.pdf.mutedColor);
  doc.text('Item', margin, doc.y, { width: tableW * 0.55, continued: true });
  doc.text('Qty', { width: tableW * 0.1, continued: true });
  doc.text('Unit', { width: tableW * 0.15, continued: true });
  doc.text('Total', { width: tableW * 0.2 });
  doc.moveDown(0.3);
  doc.fillColor(brand.pdf.bodyColor);

  for (const li of order.orderItems || []) {
    const name = li.product?.name || 'Item';
    const lineTotal = li.quantity * Number(li.price);
    sub += lineTotal;
    const y = doc.y;
    doc.fontSize(10).text(name, margin, y, { width: tableW * 0.55, continued: true });
    doc.text(String(li.quantity), { width: tableW * 0.1, continued: true });
    doc.text(moneyUsd(li.price), { width: tableW * 0.15, continued: true });
    doc.text(moneyUsd(lineTotal), { width: tableW * 0.2 });
    doc.moveDown(0.15);
  }

  doc.moveDown(0.5);
  doc.fontSize(10).text(`Subtotal: ${moneyUsd(sub)}`);
  doc.text(`Shipping: ${moneyUsd(order.shippingCost)}`);
  doc.fontSize(12).fillColor(brand.pdf.titleColor).text(`Total: ${moneyUsd(order.totalAmount)}`);

  if (order.trackingNumber) {
    doc.moveDown(0.5);
    doc.fillColor(brand.pdf.bodyColor).fontSize(10);
    doc.text(`Tracking: ${order.trackingNumber} (${order.shippingCarrier || 'UPS'})`);
    try {
      const url = await QRCode.toDataURL(String(order.trackingNumber), { margin: 1, width: 120 });
      const base64 = url.replace(/^data:image\/png;base64,/, '');
      doc.image(Buffer.from(base64, 'base64'), doc.page.width - 180, 120, { width: 100 });
    } catch {
      /* ignore */
    }
  }

  pdfDrawFooter(doc);
  doc.end();
  return done;
}

export async function renderPackingSlipPdfBuffer(order) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 48 });
  const done = collectPdfBuffer(doc);

  pdfDrawHeader(doc, {
    title: 'Packing slip',
    subtitle: `Order ${orderRef(order)}`,
    docType: 'Fulfillment',
  });

  pdfSectionTitle(doc, 'Ship to');
  addressLines(order.shippingAddressJson).forEach((ln) => doc.fontSize(10).text(ln));

  pdfSectionTitle(doc, 'Items');
  for (const li of order.orderItems || []) {
    doc
      .fontSize(11)
      .text(
        `[ ] ${li.quantity} × ${li.product?.name || 'Item'} — SKU ${li.product?.sku || li.productVariant?.sku || '—'}`
      );
  }

  doc.moveDown();
  doc.fontSize(10).text(
    `Method: ${order.selectedRateServiceLevel || '—'} | Carrier: ${order.shippingCarrier || 'UPS'}`
  );
  pdfDrawFooter(doc);
  doc.end();
  return done;
}

export async function renderShippingSummaryPdfBuffer(order) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 48 });
  const done = collectPdfBuffer(doc);

  pdfDrawHeader(doc, {
    title: 'Shipping summary',
    subtitle: `Order ${orderRef(order)}`,
    docType: 'Shipping',
  });

  pdfKeyValue(doc, [
    { label: 'Shipping paid', value: moneyUsd(order.shippingCost) },
    { label: 'Service', value: order.selectedRateServiceLevel || '—' },
    { label: 'Tracking', value: order.trackingNumber || '—' },
    { label: 'Label URL', value: order.shippingLabelUrl || '—' },
  ]);

  pdfDrawFooter(doc);
  doc.end();
  return done;
}

export async function renderPickupListPdfBuffer({ title, orders }) {
  const brand = getPdfBrand();
  const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 28 });
  const done = collectPdfBuffer(doc);
  renderPickupListLayout(doc, { brand, title, orders });
  doc.end();
  return done;
}
