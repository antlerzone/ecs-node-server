/**
 * Final agreement PDF: append a one-page "Execution & audit schedule" (signing metadata + hashes).
 * Main body comes from Google Docs export; this page is generated with pdf-lib merge.
 */

const PDFDocument = require('pdfkit');
const { PDFDocument: PdfLibDocument } = require('pdf-lib');

function formatDt(v) {
  if (v == null) return '—';
  if (v instanceof Date) return v.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const s = String(v).trim();
  if (!s) return '—';
  try {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  } catch (_) {}
  return s;
}

function formatModeDisplay(mode) {
  const m = String(mode ?? '').trim().toLowerCase();
  if (!m) return '—';
  if (m === 'tenant_operator') return 'tenant operator';
  if (m === 'owner_operator') return 'owner operator';
  if (m === 'owner_tenant') return 'tenant & owner';
  return mode;
}

/**
 * @param {object} meta
 * @returns {Promise<Buffer>}
 */
function buildSigningAuditPdfBuffer(meta) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: 'Execution & audit schedule' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(16).text('Execution & audit schedule', { underline: true });
    doc.moveDown(0.6);
    doc.fontSize(9).fillColor('#444').text('This page records signing metadata and integrity hashes for the contract on the preceding pages.', {
      align: 'left'
    });
    doc.moveDown(0.8);
    doc.fillColor('#000');

    const rows = [
      ['Agreement ID', meta.agreementId || '—'],
      ['Mode', formatModeDisplay(meta.mode)],
      ['Draft PDF hash (hash_draft)', meta.hashDraft || '—'],
      ['Main contract PDF SHA-256 (before this page)', meta.mainBodySha256 || '—'],
      ['Schedule generated at', formatDt(meta.generatedAt)]
    ];

    const mode = String(meta.mode || '').trim().toLowerCase();
    if (mode === 'tenant_operator') {
      rows.splice(
        4,
        0,
        ['Operator signed at', formatDt(meta.operatorSignedAt)],
        ['Operator sign audit hash', meta.operatorSignedHash || '—'],
        ['Operator sign IP', meta.operatorSignedIp || '—'],
        ['Tenant signed at', formatDt(meta.tenantSignedAt)],
        ['Tenant sign audit hash', meta.tenantSignedHash || '—'],
        ['Tenant sign IP (recorded)', meta.tenantSignedIp || '—']
      );
    } else if (mode === 'owner_operator') {
      rows.splice(
        4,
        0,
        ['Operator signed at', formatDt(meta.operatorSignedAt)],
        ['Operator sign audit hash', meta.operatorSignedHash || '—'],
        ['Operator sign IP', meta.operatorSignedIp || '—'],
        ['Owner signed at', formatDt(meta.ownerSignedAt)],
        ['Owner sign audit hash', meta.ownerSignedHash || '—'],
        ['Owner sign IP', meta.ownerSignedIp || '—']
      );
    } else if (mode === 'owner_tenant') {
      rows.splice(
        4,
        0,
        ['Owner signed at', formatDt(meta.ownerSignedAt)],
        ['Owner sign audit hash', meta.ownerSignedHash || '—'],
        ['Owner sign IP', meta.ownerSignedIp || '—'],
        ['Tenant signed at', formatDt(meta.tenantSignedAt)],
        ['Tenant sign audit hash', meta.tenantSignedHash || '—'],
        ['Tenant sign IP (recorded)', meta.tenantSignedIp || '—']
      );
    } else {
      rows.splice(
        4,
        0,
        ['Operator signed at', formatDt(meta.operatorSignedAt)],
        ['Operator sign audit hash', meta.operatorSignedHash || '—'],
        ['Operator sign IP', meta.operatorSignedIp || '—'],
        ['Owner signed at', formatDt(meta.ownerSignedAt)],
        ['Owner sign IP', meta.ownerSignedIp || '—'],
        ['Tenant sign IP (recorded)', meta.tenantSignedIp || '—']
      );
    }

    doc.fontSize(10);
    for (const [label, value] of rows) {
      const valStr = String(value).length > 200 ? `${String(value).slice(0, 197)}…` : String(value);
      doc.font('Helvetica-Bold').text(`${label}: `, { continued: true });
      doc.font('Helvetica').text(valStr);
      doc.moveDown(0.45);
    }

    doc.end();
  });
}

/**
 * @param {Buffer} mainPdfBuffer
 * @param {Buffer} appendixPdfBuffer
 * @returns {Promise<Buffer>}
 */
async function mergePdfBuffers(mainPdfBuffer, appendixPdfBuffer) {
  const merged = await PdfLibDocument.create();
  const main = await PdfLibDocument.load(mainPdfBuffer, { ignoreEncryption: true });
  const app = await PdfLibDocument.load(appendixPdfBuffer, { ignoreEncryption: true });

  const mainPages = await merged.copyPages(main, main.getPageIndices());
  mainPages.forEach((p) => merged.addPage(p));
  const appPages = await merged.copyPages(app, app.getPageIndices());
  appPages.forEach((p) => merged.addPage(p));

  const out = await merged.save();
  return Buffer.from(out);
}

module.exports = { buildSigningAuditPdfBuffer, mergePdfBuffers };
