/**
 * Build Owner Report PDF (same layout as legacy html1/html2).
 * Uses pdfkit; rows: [{ no, description, amount }], propertyName, billPeriod.
 */

const PDFDocument = require('pdfkit');
const axios = require('axios');
const sharp = require('sharp');

const LOGO_URL = 'https://static.wixstatic.com/media/98390b_e17e7b6b5ad4441ab6924603af7550f6~mv2.jpg';

/**
 * @param {Array<{ no?: string, description?: string, amount?: string }>} rows
 * @param {string} propertyName
 * @param {string} billPeriod
 * @param {Object} opts - { includeLogo?: boolean }
 * @returns {Promise<Buffer>}
 */
async function buildOwnerReportPdfBuffer(rows, propertyName, billPeriod, opts = {}) {
  const companyName = opts.companyName || 'Coliving Management Sdn Bhd';
  const companyLogoUrl = opts.companyLogoUrl || null;

  let logoBuffer = null;
  let logoScaledHeight = 0;
  if (companyLogoUrl) {
    try {
      const resp = await axios.get(companyLogoUrl, { responseType: 'arraybuffer', timeout: 15000 });
      logoBuffer = Buffer.from(resp.data);
      // Read image dimensions to scale it nicely and avoid overlapping header text.
      const meta = await sharp(logoBuffer).metadata();
      const targetWidth = 55;
      if (meta?.width && meta?.height) {
        logoScaledHeight = (meta.height * targetWidth) / meta.width;
      } else {
        logoScaledHeight = 20; // safe fallback
      }
    } catch (e) {
      // If logo download fails, still generate the PDF without it.
      console.warn('[generatereport-pdf] failed to load company logo:', e?.message || e);
      logoBuffer = null;
      logoScaledHeight = 0;
    }
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const clean = (raw) => {
      if (raw == null) return '';
      const s = String(raw).replace(/<\/?[^>]+>/g, '').trim();
      return s;
    };

    // Header: logo (optional) + company name
    const leftMargin = doc.page.margins.left;
    const headerY = doc.y;
    const logoWidth = 66; // 55 * 1.2
    if (logoBuffer) {
      doc.image(logoBuffer, leftMargin, headerY, { width: logoWidth });
      const textX = leftMargin + logoWidth + 8;
      const companyY = headerY + 2;
      const propertyY = companyY + 20;
      const billY = propertyY + 16;

      // Header typography:
      // - company name: bold
      // - bill period: normal (no italic)
      doc.fontSize(10).font('Helvetica-Bold');
      doc.text(companyName, textX, companyY, { continued: false });
      doc.font('Helvetica');
      doc.text(propertyName || 'Unknown Property', textX, propertyY, { continued: false });
      doc.fontSize(9).font('Helvetica');
      doc.text(`Bill Period: ${billPeriod || 'N/A'}`, textX, billY, { continued: false });

      // Keep next section below both logo and right-side text block.
      const textBottomY = billY + 16;
      doc.y = Math.max(headerY + logoScaledHeight, textBottomY);
    } else {
      doc.fontSize(10).font('Helvetica-Bold');
      doc.text(companyName, { continued: false });
      doc.font('Helvetica');
      doc.text(propertyName || 'Unknown Property', { continued: false });
      doc.fontSize(9).font('Helvetica');
      doc.text(`Bill Period: ${billPeriod || 'N/A'}`, { continued: false });
    }
    doc.font('Helvetica');
    doc.moveDown(2);

    doc.fontSize(16).font('Helvetica-Bold');
    // Force centered title within full table width (pdfkit can otherwise center relative to current x).
    const rightMarginForTitle = doc.page.margins.right;
    const tableWidthForTitle = doc.page.width - leftMargin - rightMarginForTitle;
    doc.text('Owner Report', leftMargin, doc.y, { align: 'center', width: tableWidthForTitle });
    doc.moveDown(1.5);
    doc.fontSize(10).font('Helvetica');

    const tableTop = doc.y;
    // Table layout
    const rightMargin = doc.page.margins.right;
    const tableWidth = doc.page.width - leftMargin - rightMargin;

    // Column widths: No=30, Description=flex, Amount=120.
    // Important: compute strictly within the tableWidth so Amount never draws outside the table box.
    const amountColWidth = 120;
    const noColWidth = 30;
    const descColWidth = tableWidth - noColWidth - amountColWidth;
    const tableRight = leftMargin + tableWidth;

    // (No need to keep colWidths; kept here for clarity / future tuning)
    const colWidths = [noColWidth, descColWidth, amountColWidth];
    const amountCellLeft = leftMargin + noColWidth + descColWidth;
    const headerHeight = 22;
    const rowHeight = 20;

    // Table header
    doc.rect(leftMargin, tableTop, tableWidth, headerHeight).fill('#eeeeee');
    doc.fillColor('black');
    doc.font('Helvetica-Bold');
    doc.fontSize(10);
    doc.text('No', leftMargin + 5, tableTop + 6, { width: noColWidth - 10, align: 'center' });
    doc.text('Description', leftMargin + noColWidth + 5, tableTop + 6, { width: descColWidth - 10 });
    doc.text('Amount', amountCellLeft + 5, tableTop + 6, { width: amountColWidth - 10, align: 'right' });
    doc.font('Helvetica');

    let y = tableTop + headerHeight;
    doc.moveTo(leftMargin, tableTop + headerHeight).lineTo(tableRight, tableTop + headerHeight).stroke();

    rows.forEach((row) => {
      const desc = clean(row.description);
      const noRaw = clean(row.no);
      const amount = clean(row.amount);

      const isGross = /Gross Income/i.test(desc);
      const isTotal = /Total Income|Total Expenses/i.test(desc);
      const isPayout = /^Owner Payout$/i.test(desc);
      const isManagementRow = /^management\s+fees?\b/i.test(desc);

      if (isGross || isTotal || isPayout) doc.font('Helvetica-Bold');
      if (isPayout) doc.fontSize(12);
      else doc.fontSize(10);

      const textY = y + 4;
      // Management Fee(s) must not show numbering in the "No" column.
      const noForPdf = isManagementRow ? '' : noRaw;
      doc.text(noForPdf, leftMargin + 5, textY, { width: noColWidth - 10, align: 'center' });
      doc.text(desc, leftMargin + noColWidth + 5, textY, { width: descColWidth - 10 });
      // Amount: draw in its own cell, right-aligned, with enough width so it doesn't overflow
      doc.text(amount, amountCellLeft + 5, textY, { width: amountColWidth - 10, align: 'right', lineBreak: false });

      doc.font('Helvetica').fontSize(10);
      y += rowHeight;

      if (isGross || isTotal || isPayout) {
        doc.moveTo(leftMargin, y).lineTo(tableRight, y).stroke();
      }
    });

    doc.moveTo(leftMargin, y).lineTo(tableRight, y).stroke();
    doc.end();
  });
}

module.exports = { buildOwnerReportPdfBuffer };
