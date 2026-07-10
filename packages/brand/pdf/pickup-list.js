/**
 * Compact warehouse pick list — landscape table, optimized for print & scan.
 */

function orderRef(order) {
  return order.orderNumber || String(order.publicId || '—');
}

function flattenRows(orders) {
  const rows = [];
  let n = 0;
  for (const order of orders || []) {
    const u = order.user || {};
    const customer =
      [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || String(u.email || '—');
    const ref = orderRef(order);
    const items = order.orderItems?.length
      ? order.orderItems
      : [{ quantity: 0, product: { name: '(no items)' } }];
    for (const li of items) {
      n += 1;
      const pickedQty = Number(li.pickedQuantity ?? 0);
      const qty = Number(li.quantity) || 0;
      rows.push({
        n,
        orderRef: ref,
        customer,
        product: li.product?.name || 'Item',
        sku: li.productVariant?.sku || li.product?.sku || '—',
        qty,
        envelope: order.includeReturnEnvelope ? 'Yes' : '—',
        picked: pickedQty >= qty && qty > 0 ? 'Yes' : pickedQty > 0 ? `${pickedQty}/${qty}` : 'No',
      });
    }
  }
  return rows;
}

/** @param {import('pdfkit').PDFDocument} doc */
export function renderPickupListLayout(doc, { brand, title, orders }) {
  const c = brand.pdf;
  const colors = brand.colors;
  const margin = 28;
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const contentW = pageW - margin * 2;
  const generatedAt = new Date().toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const rows = flattenRows(orders);
  const orderCount = (orders || []).length;

  const cols = [
    { key: 'check', label: '', w: 26, align: 'center' },
    { key: 'n', label: '#', w: 22, align: 'right' },
    { key: 'orderRef', label: 'Order', w: 78, align: 'left' },
    { key: 'customer', label: 'Customer', w: 108, align: 'left' },
    { key: 'product', label: 'Product', w: 0, align: 'left' }, // flex
    { key: 'sku', label: 'SKU', w: 72, align: 'left' },
    { key: 'qty', label: 'Qty', w: 28, align: 'center' },
    { key: 'envelope', label: 'Envelope', w: 52, align: 'center' },
    { key: 'picked', label: 'Picked', w: 44, align: 'center' },
  ];
  const fixedW = cols.reduce((s, col) => s + (col.w || 0), 0);
  const flexCol = cols.find((col) => col.w === 0);
  if (flexCol) flexCol.w = Math.max(120, contentW - fixedW);

  const rowH = 20;
  const headerH = 22;
  const footerBlockH = 72;
  const tableTopStart = 88;

  const drawPageHeader = (pageNum, totalPages) => {
    doc.save();
    doc.rect(0, 0, pageW, 44).fill(c.accentBar);
    doc.fillColor('#FFFFFF').fontSize(12).text(brand.name.display, margin, 14);
    doc.fontSize(8).text('WAREHOUSE PICK LIST', pageW - margin - 130, 16, {
      width: 130,
      align: 'right',
    });
    doc.restore();

    let y = 52;
    doc.fillColor(c.titleColor).fontSize(16).text(title || 'Pick list', margin, y, {
      width: contentW * 0.55,
    });
    doc
      .fillColor(c.mutedColor)
      .fontSize(8)
      .text(`${generatedAt}  ·  Page ${pageNum} of ${totalPages}`, pageW - margin - 160, y + 4, {
        width: 160,
        align: 'right',
      });

    y += 22;
    const chips = [
      { label: 'Orders', value: String(orderCount) },
      { label: 'Lines', value: String(rows.length) },
      { label: 'Check each row', value: '☐' },
    ];
    let cx = margin;
    for (const chip of chips) {
      const chipW = 72;
      doc.roundedRect(cx, y, chipW, 20, 4).fill(colors.sageLight);
      doc.fillColor(c.mutedColor).fontSize(7).text(chip.label, cx + 8, y + 4, { width: chipW - 16 });
      doc.fillColor(c.titleColor).fontSize(10).text(chip.value, cx + 8, y + 10, { width: chipW - 16 });
      cx += chipW + 8;
    }

    doc.fillColor(c.mutedColor).fontSize(7).text(
      'Print → pick → return → Admin: Mark picked',
      cx,
      y + 6,
      { width: contentW - (cx - margin) }
    );

    return tableTopStart;
  };

  const drawTableHead = (y) => {
    doc.save();
    doc.rect(margin, y, contentW, headerH).fill(colors.sageLight);
    let x = margin;
    doc.fillColor(c.titleColor).fontSize(8);
    for (const col of cols) {
      doc.text(col.label, x + 4, y + 7, { width: col.w - 8, align: col.align });
      x += col.w;
    }
    doc.restore();
    return y + headerH;
  };

  const drawRow = (row, y, stripe) => {
    if (stripe) {
      doc.save();
      doc.rect(margin, y, contentW, rowH).fill('#FAFAF8');
      doc.restore();
    }
    doc.save();
    doc.strokeColor(colors.borderLight).lineWidth(0.5);
    doc.moveTo(margin, y + rowH).lineTo(margin + contentW, y + rowH).stroke();
    doc.restore();

    let x = margin;
    const ty = y + 6;
    doc.fillColor(c.bodyColor).fontSize(9);

    doc.strokeColor(colors.border).lineWidth(0.75);
    doc.rect(x + 6, y + 4, 12, 12).stroke();
    x += cols[0].w;

    const values = [
      null,
      String(row.n),
      row.orderRef,
      row.customer,
      row.product,
      row.sku,
      String(row.qty),
      row.envelope,
      row.picked,
    ];

    for (let i = 1; i < cols.length; i += 1) {
      const col = cols[i];
      if (i === 4) doc.font('Helvetica-Bold');
      doc.text(values[i], x + 4, ty, {
        width: col.w - 8,
        align: col.align,
        ellipsis: true,
        height: rowH - 4,
      });
      if (i === 4) doc.font('Helvetica');
      x += col.w;
    }
  };

  const drawSignOff = (y) => {
    const boxH = 56;
    if (y + boxH > pageH - margin - 24) {
      doc.addPage({ size: 'LETTER', layout: 'landscape', margin });
      y = margin;
    }
    doc.save();
    doc.roundedRect(margin, y, contentW, boxH, 6).stroke(colors.border);
    doc.fillColor(c.titleColor).fontSize(9).text('Picker sign-off', margin + 12, y + 10);
    doc.fillColor(c.bodyColor).fontSize(9);
    const fy = y + 26;
    doc.text('Picked by: ___________________________', margin + 12, fy);
    doc.text('Date: ______________', margin + 280, fy);
    doc.text('Returned to: ________________________', margin + 12, fy + 16);
    doc.text('Verified: ______________', margin + 280, fy + 16);
    doc.restore();
    return y + boxH + 8;
  };

  const pages = [];
  let batch = [];
  let y = tableTopStart + headerH;
  let rowBottom = pageH - margin - footerBlockH;

  for (const row of rows) {
    if (y + rowH > rowBottom && batch.length > 0) {
      pages.push(batch);
      batch = [];
      y = tableTopStart + headerH;
      rowBottom = pageH - margin - 36;
    }
    batch.push(row);
    y += rowH;
  }
  if (batch.length) pages.push(batch);
  if (!pages.length) pages.push([]);

  const pageCount = Math.max(1, pages.length);

  for (let p = 0; p < pageCount; p += 1) {
    if (p > 0) doc.addPage({ size: 'LETTER', layout: 'landscape', margin });
    drawPageHeader(p + 1, pageCount);
    let ry = drawTableHead(tableTopStart);
    const pageRows = pages[p] || [];
    for (let i = 0; i < pageRows.length; i += 1) {
      drawRow(pageRows[i], ry, i % 2 === 1);
      ry += rowH;
    }
    if (p === pageCount - 1) {
      drawSignOff(ry + 12);
      doc.fillColor(c.mutedColor).fontSize(7);
      const refs = [...new Set((orders || []).map(orderRef))].join(' · ');
      doc.text(`Orders: ${refs || '—'}`, margin, pageH - margin - 14, { width: contentW });
    }
  }

  if (!rows.length) {
    drawPageHeader(1, 1);
    let ry = drawTableHead(tableTopStart);
    doc.fillColor(c.mutedColor).fontSize(10).text('No line items on this pick list.', margin, ry + 12);
    drawSignOff(ry + 36);
  }
}
