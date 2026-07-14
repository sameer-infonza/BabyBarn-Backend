/**
 * Branded order PDFs — pdfkit/qrcode resolve from backend/node_modules.
 * Layout tokens/helpers live in packages/brand/pdf/layout.js and are shared
 * across every document so invoices, packing slips and summaries look identical.
 */
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import {
  PDF_PAGE,
  collectPdfBuffer,
  contactCardLines,
  getPdfBrand,
  moneyUsd,
  pdfChecklist,
  pdfDetailGrid,
  pdfDrawHeader,
  pdfEnsureSpace,
  pdfInfoCards,
  pdfNoteBlock,
  pdfRenderFooters,
  pdfSectionLabel,
  pdfTable,
  pdfTotals,
  renderPickupListLayout,
} from '@babybarn/brand/pdf';

function orderRef(order) {
  return order.orderNumber || order.publicId;
}

function customerName(order) {
  const u = order.user || {};
  const a = order.shippingAddressJson || order.billingAddressJson || {};
  const fromUser = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  const fromAddr = [a.firstName, a.lastName].filter(Boolean).join(' ').trim() || String(a.name || '').trim();
  return fromUser || fromAddr || '';
}

function customerEmail(order) {
  return order.user?.email || order.contactEmail || '';
}

function formatDate(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return String(value);
  }
}

function titleCase(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/(^|[\s_-])(\w)/g, (_, sep, ch) => `${sep === '_' || sep === '-' ? ' ' : sep}${ch.toUpperCase()}`)
    .trim();
}

function lineItemMeta(li) {
  const parts = [];
  const sku = li.productVariant?.sku || li.product?.sku;
  if (sku) parts.push(`SKU ${sku}`);
  parts.push(li.product?.productType === 'REFURBISHED' ? 'Refurbished' : 'New');
  if (li.pricingTier === 'ACCESS') parts.push('ACCESS price');
  return parts.join('  ·  ');
}

/** Create a branded document sharing page geometry + buffered footer support. */
function createDoc(overrides = {}) {
  const doc = new PDFDocument({
    size: PDF_PAGE.size,
    margins: { ...PDF_PAGE.margins },
    bufferPages: true,
    ...overrides,
  });
  return { doc, done: collectPdfBuffer(doc) };
}

export async function renderInvoicePdfBuffer(order) {
  const { doc, done } = createDoc();

  let y = pdfDrawHeader(doc, {
    title: 'Invoice',
    docType: 'Tax invoice',
    meta: [
      { label: 'Invoice no.', value: orderRef(order) },
      { label: 'Issue date', value: formatDate(order.createdAt) },
      { label: 'Payment', value: titleCase(order.paymentStatus) || 'Paid' },
      { label: 'Order status', value: titleCase(order.status) || '—' },
    ],
  });

  const billTo = order.billingAddressJson || order.shippingAddressJson;
  y = pdfInfoCards(
    doc,
    [
      {
        title: 'Billed to',
        lines: contactCardLines(billTo, { name: customerName(order), email: customerEmail(order) }),
      },
      {
        title: 'Ship to',
        lines: contactCardLines(order.shippingAddressJson, { name: customerName(order) }),
      },
    ],
    y
  );

  y = pdfSectionLabel(doc, 'Items', y);

  let subtotal = 0;
  const rows = (order.orderItems || [])
    .filter((li) => !li.cancelledAt)
    .map((li) => {
      const lineTotal = li.quantity * Number(li.price);
      subtotal += lineTotal;
      return {
        desc: li.product?.name || 'Item',
        meta: lineItemMeta(li),
        qty: String(li.quantity),
        unit: moneyUsd(li.price),
        amount: moneyUsd(lineTotal),
      };
    });

  y = pdfTable(doc, {
    startY: y,
    columns: [
      { key: 'desc', label: 'Description', subKey: 'meta', bold: true, strong: true },
      { key: 'qty', label: 'Qty', width: 56, align: 'center' },
      { key: 'unit', label: 'Unit price', width: 92, align: 'right' },
      { key: 'amount', label: 'Amount', width: 100, align: 'right', bold: true, strong: true },
    ],
    rows,
  });

  const totalsRows = [{ label: 'Subtotal', value: moneyUsd(subtotal) }];
  if (Number(order.shippingCost) > 0) {
    totalsRows.push({ label: 'Shipping', value: moneyUsd(order.shippingCost) });
  }
  if (Number(order.taxAmount) > 0) {
    totalsRows.push({ label: 'Tax', value: moneyUsd(order.taxAmount) });
  }
  if (Number(order.storeCreditApplied) > 0) {
    totalsRows.push({ label: 'Store credit', value: `-${moneyUsd(order.storeCreditApplied)}` });
  }

  y = pdfTotals(doc, {
    startY: y,
    rows: totalsRows,
    total: { label: 'Total paid', value: moneyUsd(order.totalAmount) },
  });

  if (order.trackingNumber) {
    y = await renderTrackingCard(doc, order, y);
  }

  pdfNoteBlock(doc, {
    startY: y,
    title: 'Thank you',
    body: [
      `Thank you for shopping with ${getPdfBrand().name.display}. Keep this invoice for your records.`,
      `Questions about this order? Email ${getPdfBrand().contact.supportEmail} and reference invoice ${orderRef(order)}.`,
    ],
  });

  pdfRenderFooters(doc);
  doc.end();
  return done;
}

async function renderTrackingCard(doc, order, startY) {
  const brand = getPdfBrand();
  const margin = doc.page.margins.left;
  const w = doc.page.width - margin * 2;
  const boxH = 96;
  let y = pdfEnsureSpace(doc, startY + 6, boxH + 12);

  doc.save();
  doc.roundedRect(margin, y, w, boxH, 9).fillAndStroke(brand.colors.cream, brand.colors.border);
  doc.restore();

  doc
    .fillColor(brand.colors.purple)
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .text('SHIPMENT TRACKING', margin + 14, y + 14, { characterSpacing: 0.6, lineBreak: false });
  doc
    .fillColor(brand.pdf.titleColor)
    .font('Helvetica-Bold')
    .fontSize(13)
    .text(String(order.trackingNumber), margin + 14, y + 32, { width: w - 140, lineBreak: false });
  doc
    .fillColor(brand.pdf.mutedColor)
    .font('Helvetica')
    .fontSize(9.5)
    .text(
      `Carrier: ${order.shippingCarrier || 'UPS'}${
        order.selectedRateServiceLevel ? `  ·  ${order.selectedRateServiceLevel}` : ''
      }`,
      margin + 14,
      y + 54,
      { width: w - 140, lineBreak: false }
    );
  doc
    .fillColor(brand.pdf.mutedColor)
    .fontSize(8.5)
    .text('Scan to track your delivery', margin + 14, y + 70, { lineBreak: false });

  try {
    const url = await QRCode.toDataURL(String(order.trackingNumber), { margin: 0, width: 160 });
    const base64 = url.replace(/^data:image\/png;base64,/, '');
    doc.image(Buffer.from(base64, 'base64'), margin + w - 84, y + 14, { width: 68, height: 68 });
  } catch {
    /* QR is best-effort */
  }

  return y + boxH + 14;
}

export async function renderPackingSlipPdfBuffer(order) {
  const { doc, done } = createDoc();

  let y = pdfDrawHeader(doc, {
    title: 'Packing slip',
    docType: 'Fulfillment',
    meta: [
      { label: 'Order no.', value: orderRef(order) },
      { label: 'Order date', value: formatDate(order.createdAt) },
      { label: 'Carrier', value: order.shippingCarrier || 'UPS' },
      { label: 'Service', value: order.selectedRateServiceLevel || 'Standard' },
    ],
  });

  y = pdfInfoCards(
    doc,
    [
      {
        title: 'Ship to',
        lines: contactCardLines(order.shippingAddressJson, { name: customerName(order) }),
      },
      {
        title: 'Fulfillment',
        lines: [
          `Status: ${titleCase(order.fulfillmentStatus) || 'New order'}`,
          `Carrier: ${order.shippingCarrier || 'UPS'}`,
          `Service: ${order.selectedRateServiceLevel || 'Standard'}`,
        ],
      },
    ],
    y
  );

  y = pdfSectionLabel(doc, 'Items to pack', y);

  const items = (order.orderItems || [])
    .filter((li) => !li.cancelledAt)
    .map((li) => {
      const sku = li.productVariant?.sku || li.product?.sku || '—';
      return `${li.quantity} ×  ${li.product?.name || 'Item'}   —   SKU ${sku}`;
    });
  if (order.includeReturnEnvelope) {
    items.push('Include reusable return envelope (ACCESS member order)');
  }

  y = pdfChecklist(doc, { startY: y, items });

  pdfNoteBlock(doc, {
    startY: y + 4,
    title: 'Packer notes',
    body:
      order.manualShippingNotes ||
      'Verify each item and quantity against this slip before sealing the parcel. Tick every box as you pack.',
  });

  pdfRenderFooters(doc);
  doc.end();
  return done;
}

export async function renderShippingSummaryPdfBuffer(order) {
  const { doc, done } = createDoc();

  let y = pdfDrawHeader(doc, {
    title: 'Shipping summary',
    docType: 'Shipping',
    meta: [
      { label: 'Order no.', value: orderRef(order) },
      { label: 'Carrier', value: order.shippingCarrier || 'UPS' },
      { label: 'Tracking', value: order.trackingNumber || '—' },
    ],
  });

  y = pdfInfoCards(
    doc,
    [{ title: 'Ship to', lines: contactCardLines(order.shippingAddressJson, { name: customerName(order) }) }],
    y
  );

  y = pdfSectionLabel(doc, 'Shipment details', y);

  y = pdfDetailGrid(
    doc,
    [
      { label: 'Shipping paid', value: moneyUsd(order.shippingCost) },
      { label: 'Service level', value: order.selectedRateServiceLevel || '—' },
      { label: 'Carrier', value: order.shippingCarrier || 'UPS' },
      { label: 'Tracking number', value: order.trackingNumber || '—' },
      { label: 'Estimated days', value: order.selectedRateEstimatedDays != null ? String(order.selectedRateEstimatedDays) : '—' },
      { label: 'Fulfillment', value: titleCase(order.fulfillmentStatus) || '—' },
    ],
    y
  );

  if (order.shippingLabelUrl) {
    pdfNoteBlock(doc, {
      startY: y,
      title: 'Label',
      body: `Carrier label: ${order.shippingLabelUrl}`,
    });
  }

  pdfRenderFooters(doc);
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
