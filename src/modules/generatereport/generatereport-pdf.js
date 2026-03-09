/**
 * Build Owner Report PDF (same layout as legacy html1/html2).
 * Uses pdfkit; rows: [{ no, description, amount }], propertyName, billPeriod.
 */

const PDFDocument = require('pdfkit');

const LOGO_URL = 'https://static.wixstatic.com/media/98390b_e17e7b6b5ad4441ab6924603af7550f6~mv2.jpg';

/**
 * @param {Array<{ no?: string, description?: string, amount?: string }>} rows
 * @param {string} propertyName
 * @param {string} billPeriod
 * @param {Object} opts - { includeLogo?: boolean }
 * @returns {Promise<Buffer>}
 */
function buildOwnerReportPdfBuffer(rows, propertyName, billPeriod, opts = {}) {
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

    // Header: logo placeholder (pdfkit can't fetch URL easily, use text or skip)
    doc.fontSize(10);
    doc.text('Coliving Management Sdn Bhd', { continued: false });
    doc.text(propertyName || 'Unknown Property', { continued: false });
    doc.fontSize(9).font('Helvetica-Oblique');
    doc.text(`Bill Period: ${billPeriod || 'N/A'}`, { continued: false });
    doc.font('Helvetica');
    doc.moveDown(2);

    doc.fontSize(16).font('Helvetica-Bold');
    doc.text('Owner Report', { align: 'center' });
    doc.moveDown(1.5);
    doc.fontSize(10).font('Helvetica');

    const tableTop = doc.y;
    const colWidths = [30, doc.page.width - 40 - 30 - 100, 100];
    const headerHeight = 22;
    const rowHeight = 20;

    // Table header
    doc.rect(40, tableTop, doc.page.width - 80, headerHeight).fill('#eeeeee');
    doc.fillColor('black');
    doc.font('Helvetica-Bold');
    doc.fontSize(10);
    doc.text('No', 40 + 5, tableTop + 6, { width: colWidths[0] - 10, align: 'center' });
    doc.text('Description', 40 + colWidths[0] + 5, tableTop + 6, { width: colWidths[1] - 10 });
    doc.text('Amount', 40 + colWidths[0] + colWidths[1] + 5, tableTop + 6, { width: colWidths[2] - 10, align: 'right' });
    doc.font('Helvetica');

    let y = tableTop + headerHeight;
    doc.moveTo(40, tableTop + headerHeight).lineTo(doc.page.width - 40, tableTop + headerHeight).stroke();

    rows.forEach((row) => {
      const desc = clean(row.description);
      const no = clean(row.no);
      const amount = clean(row.amount);

      const isGross = /Gross Income/i.test(desc);
      const isTotal = /Total Income|Total Expenses/i.test(desc);
      const isPayout = /^Owner Payout$/i.test(desc);

      if (isGross || isTotal || isPayout) doc.font('Helvetica-Bold');
      if (isPayout) doc.fontSize(12);
      else doc.fontSize(10);

      const textY = y + 4;
      doc.text(no, 40 + 5, textY, { width: colWidths[0] - 10, align: 'center' });
      doc.text(desc, 40 + colWidths[0] + 5, textY, { width: colWidths[1] - 10 });
      doc.text(amount, 40 + colWidths[0] + colWidths[1] + 5, textY, { width: colWidths[2] - 10, align: 'right' });

      doc.font('Helvetica').fontSize(10);
      y += rowHeight;

      if (isGross || isTotal || isPayout) {
        doc.moveTo(40, y).lineTo(doc.page.width - 40, y).stroke();
      }
    });

    doc.moveTo(40, y).lineTo(doc.page.width - 40, y).stroke();
    doc.end();
  });
}

module.exports = { buildOwnerReportPdfBuffer };
