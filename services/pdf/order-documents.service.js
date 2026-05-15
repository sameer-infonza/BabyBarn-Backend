import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function addrLines(json) {
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

function collectPdfBuffer(doc) {
  const chunks = [];
  return new Promise((resolve, reject) => {
    doc.on('data', (d) => chunks.push(d));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

export async function renderInvoicePdfBuffer(order) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 48 });
  const done = collectPdfBuffer(doc);
  doc.fontSize(18).text('MyBABY BARN — Invoice', { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor('#333');
  doc.text(`Order: ${order.publicId}`);
  doc.text(`Date: ${new Date(order.createdAt).toLocaleString()}`);
  doc.text(`Payment: ${order.paymentStatus}`);
  doc.text(`Status: ${order.status}`);
  if (order.fulfillmentStatus) doc.text(`Fulfillment: ${order.fulfillmentStatus}`);
  doc.moveDown();
  doc.fontSize(11).fillColor('#000').text('Bill to / Ship to', { underline: true });
  addrLines(order.shippingAddressJson).forEach((ln) => doc.fontSize(10).text(ln));
  doc.moveDown();
  doc.fontSize(11).text('Lines', { underline: true });
  let sub = 0;
  for (const li of order.orderItems || []) {
    const name = li.product?.name || 'Item';
    const line = `${li.quantity} x ${name} @ ${money(li.price)} = ${money(li.quantity * li.price)}`;
    sub += li.quantity * li.price;
    doc.fontSize(10).text(line);
  }
  doc.moveDown();
  doc.fontSize(10).text(`Subtotal: ${money(sub)}`);
  doc.text(`Shipping: ${money(order.shippingCost)}`);
  doc.fontSize(12).text(`Total: ${money(order.totalAmount)}`, { continued: false });
  if (order.trackingNumber) {
    doc.moveDown();
    doc.fontSize(10).text(`Tracking: ${order.trackingNumber} (${order.shippingCarrier || 'UPS'})`);
    try {
      const url = await QRCode.toDataURL(String(order.trackingNumber), { margin: 1, width: 120 });
      const base64 = url.replace(/^data:image\/png;base64,/, '');
      doc.image(Buffer.from(base64, 'base64'), doc.page.width - 180, 120, { width: 100 });
    } catch {
      /* ignore QR failures */
    }
  }
  doc.end();
  return done;
}

export async function renderPackingSlipPdfBuffer(order) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 48 });
  const done = collectPdfBuffer(doc);
  doc.fontSize(16).text('Packing slip', { underline: true });
  doc.fontSize(10).text(`Order ${order.publicId}`);
  doc.moveDown();
  addrLines(order.shippingAddressJson).forEach((ln) => doc.text(ln));
  doc.moveDown();
  for (const li of order.orderItems || []) {
    doc.fontSize(11).text(`[ ] ${li.quantity} x ${li.product?.name || 'Item'} — SKU ${li.product?.sku || li.productVariant?.sku || '—'}`);
  }
  doc.moveDown();
  doc.fontSize(10).text(`Method: ${order.selectedRateServiceLevel || '—'} | Carrier: ${order.shippingCarrier || 'UPS'}`);
  doc.end();
  return done;
}

export async function renderShippingSummaryPdfBuffer(order) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 48 });
  const done = collectPdfBuffer(doc);
  doc.fontSize(16).text('Shipping summary', { underline: true });
  doc.fontSize(10).text(`Order ${order.publicId}`);
  doc.text(`Shipping paid: ${money(order.shippingCost)}`);
  doc.text(`Selected service: ${order.selectedRateServiceLevel || '—'}`);
  doc.text(`Tracking: ${order.trackingNumber || '—'}`);
  doc.text(`Label: ${order.shippingLabelUrl || '—'}`);
  doc.end();
  return done;
}

export async function renderPickupListPdfBuffer({ title, orders }) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 42 });
  const done = collectPdfBuffer(doc);
  doc.fontSize(16).text(title || 'Pickup list', { underline: true });
  doc.fontSize(10).text(`Generated ${new Date().toLocaleString()}`);
  doc.moveDown();
  for (let i = 0; i < orders.length; i += 1) {
    const o = orders[i];
    if (i > 0) doc.addPage({ margin: 42 });
    doc.fontSize(14).text(`Order ${o.publicId}`, { underline: true });
    const u = o.user || {};
    doc.fontSize(10).text(`Customer: ${[u.firstName, u.lastName].filter(Boolean).join(' ') || '—'} (${u.email || '—'})`);
    doc.text(`Payment: ${o.paymentStatus} | Fulfillment: ${o.fulfillmentStatus || '—'}`);
    doc.moveDown(0.3);
    doc.fontSize(11).text('Ship to');
    addrLines(o.shippingAddressJson).forEach((ln) => doc.fontSize(10).text(ln));
    doc.moveDown();
    doc.text('Items checklist');
    for (const li of o.orderItems || []) {
      doc.fontSize(10).text(`[ ] ${li.quantity} x ${li.product?.name || 'Item'}`);
    }
    doc.moveDown();
    doc.text(`Shipping method: ${o.selectedRateServiceLevel || '—'}`);
  }
  doc.end();
  return done;
}
