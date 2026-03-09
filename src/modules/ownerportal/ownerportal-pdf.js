/**
 * Generate Owner Portal report PDFs (owner payout report & cost report).
 * Same layout as the legacy HTML/iframe + pdfmake: landscape, header, title, table.
 */

const PDFDocument = require('pdfkit');

const LOGO_URL = 'https://static.wixstatic.com/media/98390b_e17e7b6b5ad4441ab6924603af7550f6~mv2.jpg';

function stripHtml(str) {
  if (str == null) return '';
  const s = String(str);
  return s.replace(/<\/?[^>]+>/g, '').trim();
}

/**
 * Build PDF buffer: landscape, header (logo + property + bill period), title, table.
 * @param {Object} opts - { columns: [{ label, dataPath }], rows: Array<Object>, titleText, propertyName, billPeriod }
 * @returns {Promise<Buffer>}
 */
function buildTablePdf(opts) {
  const { columns = [], rows = [], titleText = 'Report', propertyName = 'Unknown Property', billPeriod = 'N/A' } = opts;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ layout: 'landscape', margin: 30, size: 'A4' });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colCount = Math.max(1, columns.length);
    const colWidth = pageWidth / colCount;
    const rowHeight = 22;
    const headerBg = '#eeeeee';

    // Header row: logo placeholder (text) + property + bill period
    doc.fontSize(12).font('Helvetica-Bold').text('Coliving Management Sdn Bhd', 30, 30);
    doc.fontSize(9).font('Helvetica').text(propertyName, 30, 45);
    doc.fontSize(9).font('Helvetica-Oblique').text(`Bill Period: ${billPeriod}`, 30, 58);

    // Title
    doc.fontSize(16).font('Helvetica-Bold').text(titleText || 'Report', 30, 85, { align: 'center', width: pageWidth });

    // Table header
    let y = 115;
    doc.rect(30, y, pageWidth, rowHeight).fill(headerBg);
    doc.fillColor('#000000').fontSize(10).font('Helvetica-Bold');
    columns.forEach((col, i) => {
      doc.text(col.label || col.dataPath || '', 30 + i * colWidth + 4, y + 6, { width: colWidth - 8, align: 'center' });
    });
    y += rowHeight;

    // Table body
    doc.font('Helvetica').fontSize(9);
    rows.forEach((row) => {
      if (y > doc.page.height - 60) {
        doc.addPage({ layout: 'landscape', size: 'A4', margin: 30 });
        y = 30;
        doc.rect(30, y, pageWidth, rowHeight).fill(headerBg);
        doc.fillColor('#000000').font('Helvetica-Bold').fontSize(10);
        columns.forEach((col, i) => {
          doc.text(col.label || col.dataPath || '', 30 + i * colWidth + 4, y + 6, { width: colWidth - 8, align: 'center' });
        });
        y += rowHeight;
        doc.font('Helvetica').fontSize(9);
      }
      columns.forEach((col, i) => {
        const raw = row[col.dataPath] != null ? row[col.dataPath] : row[col.id] != null ? row[col.id] : '';
        const text = stripHtml(String(raw));
        doc.text(text, 30 + i * colWidth + 4, y + 5, { width: colWidth - 8, align: 'center', lineBreak: false });
      });
      y += rowHeight;
    });

    doc.end();
  });
}

/**
 * Owner Payout Report PDF. Columns/rows match frontend: period, totalrental, totalutility, totalcollection, expenses, netpayout.
 */
async function generateOwnerReportPdf({ items = [], propertyName = 'Unknown Property', startDate, endDate }) {
  const formatMonth = (d) => {
    if (!d) return '';
    const date = new Date(d);
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  };
  const billPeriod = startDate && endDate
    ? `${formatMonth(startDate)} - ${formatMonth(endDate)}`
    : 'N/A';
  const columns = [
    { id: 'period', label: 'Period', dataPath: 'period' },
    { id: 'totalrental', label: 'Total Rental', dataPath: 'totalrental' },
    { id: 'totalutility', label: 'Total Utility', dataPath: 'totalutility' },
    { id: 'totalcollection', label: 'Gross Income', dataPath: 'totalcollection' },
    { id: 'expenses', label: 'Total Expenses', dataPath: 'expenses' },
    { id: 'netpayout', label: 'Owner Payout', dataPath: 'netpayout' }
  ];
  const rows = items.map((i) => ({
    period: formatMonth(i.period),
    totalrental: typeof i.totalrental === 'number' ? `RM ${i.totalrental.toLocaleString('en-MY')}` : (i.totalrental || ''),
    totalutility: typeof i.totalutility === 'number' ? `RM ${i.totalutility.toLocaleString('en-MY')}` : (i.totalutility || ''),
    totalcollection: typeof i.totalcollection === 'number' ? `RM ${i.totalcollection.toLocaleString('en-MY')}` : (i.totalcollection || ''),
    expenses: typeof i.expenses === 'number' ? `RM ${i.expenses.toLocaleString('en-MY')}` : (i.expenses || ''),
    netpayout: typeof i.netpayout === 'number' ? `RM ${i.netpayout.toLocaleString('en-MY')}` : (i.netpayout || '')
  }));
  return buildTablePdf({
    columns,
    rows,
    titleText: 'Owner Payout Report',
    propertyName,
    billPeriod
  });
}

/**
 * Cost (Utility Bills) Report PDF.
 */
async function generateCostPdf({ items = [], propertyName = 'Unknown Property' }) {
  const formatMonth = (d) => {
    if (!d) return '';
    const date = new Date(d);
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  };
  const columns = [
    { id: 'period', label: 'Period', dataPath: 'period' },
    { id: 'property', label: 'Property', dataPath: 'property' },
    { id: 'description', label: 'Description', dataPath: 'description' },
    { id: 'amount', label: 'Amount', dataPath: 'amount' }
  ];
  const rows = items.map((i) => ({
    period: formatMonth(i.period),
    property: i.listingTitle || (i.property && i.property.shortname) || '',
    description: i.description || '',
    amount: typeof i.amount === 'number' ? `${i.client?.currency || 'MYR'} ${i.amount}` : (i.amount || '')
  }));
  return buildTablePdf({
    columns,
    rows,
    titleText: 'Utility Bills Report',
    propertyName,
    billPeriod: ''
  });
}

module.exports = { generateOwnerReportPdf, generateCostPdf, buildTablePdf };
