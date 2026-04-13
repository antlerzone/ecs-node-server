/**
 * Operator Portal: PDF for a single creditlogs spending row (no Bukku invoice).
 * Monthly room charge: bordered table No. | Property | Unit number | Room name + total.
 */

const fs = require('fs');
const PDFDocument = require('pdfkit');
const pool = require('../../config/db');
const { utcDatetimeFromDbToMalaysiaDateOnly } = require('../../utils/dateMalaysia');

const FONT_CANDIDATES = [
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
  '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/dejavu/DejaVuSans.ttf'
];

function pickBodyFont(doc) {
  for (const p of FONT_CANDIDATES) {
    if (!p || !fs.existsSync(p)) continue;
    try {
      doc.registerFont('ReportBody', p);
      return 'ReportBody';
    } catch (_) {
      /* TTC / font unreadable — try next path */
    }
  }
  return 'Helvetica';
}

/** Operator-facing date (Malaysia calendar). */
function formatPostedDateMalaysia(v) {
  if (v == null) return '—';
  const ymd = utcDatetimeFromDbToMalaysiaDateOnly(v);
  if (ymd) return ymd;
  try {
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toISOString().slice(0, 10);
  } catch {
    return String(v);
  }
}

function cellText(s) {
  if (s == null) return '—';
  const t = String(s).trim();
  return t === '' ? '—' : t;
}

/**
 * @param {string|null|undefined} payload
 * @returns {{ lines: Array<{ property: string, unitNumber: string, roomName: string }>, creditPerRoom: number } | null}
 */
function parseActiveRoomMonthlyPayload(payload) {
  if (payload == null || String(payload).trim() === '') return null;
  try {
    const o = JSON.parse(String(payload));
    if (!o || o.source !== 'active_room_monthly' || !Array.isArray(o.lines) || o.lines.length === 0) return null;
    const creditPerRoom = Number(o.creditPerRoom) > 0 ? Number(o.creditPerRoom) : 10;
    const lines = o.lines.map((l) => ({
      property: cellText(l.property),
      unitNumber: cellText(l.unitNumber),
      roomName: cellText(l.roomName)
    }));
    return { lines, creditPerRoom };
  } catch {
    return null;
  }
}

/**
 * Same billable-room set as monthly cron, using Malaysia calendar day `refDay` (e.g. YYYY-MM-01).
 */
async function fetchMonthlyRoomLinesForPdf(clientId, yearMonth) {
  const refDay = `${String(yearMonth).trim()}-01`;
  const [roomRows] = await pool.query(
    `SELECT
       COALESCE(NULLIF(TRIM(p.shortname), ''), NULLIF(TRIM(p.apartmentname), ''), '—') AS property_label,
       COALESCE(NULLIF(TRIM(p.unitnumber), ''), '—') AS unit_number,
       COALESCE(NULLIF(TRIM(r.roomname), ''), NULLIF(TRIM(r.title_fld), ''), 'Room') AS room_name
     FROM roomdetail r
     LEFT JOIN propertydetail p ON p.id = r.property_id
     WHERE r.client_id = ?
       AND (
         r.active = 1
         OR EXISTS (
           SELECT 1 FROM tenancy t
           WHERE t.room_id = r.id
             AND (t.client_id = r.client_id OR t.client_id IS NULL)
             AND t.begin IS NOT NULL AND t.\`end\` IS NOT NULL
             AND DATE(t.begin) <= ? AND DATE(t.\`end\`) >= ?
         )
       )
     ORDER BY property_label, unit_number, room_name`,
    [clientId, refDay, refDay]
  );
  return (roomRows || []).map((r) => ({
    property: r.property_label || '—',
    unitNumber: r.unit_number || '—',
    roomName: r.room_name || 'Room'
  }));
}

/**
 * Lines for PDF: from payload, or DB backfill for legacy "Active room monthly (YYYY-MM)" rows.
 * @param {{ payload?: string|null, title?: string|null, client_id?: string|null }} row
 * @returns {Promise<{ lines: Array<{ property: string, unitNumber: string, roomName: string }>, creditPerRoom: number } | null>}
 */
async function getMonthlyRoomLinesBundleForRow(row) {
  const parsed = parseActiveRoomMonthlyPayload(row.payload);
  if (parsed?.lines?.length) return parsed;

  const t = String(row.title || '');
  const m = t.match(/Active room monthly\s*\((\d{4}-\d{2})\)/i);
  const cid = row.client_id != null ? String(row.client_id).trim() : '';
  if (!m || !cid) return null;

  const lines = await fetchMonthlyRoomLinesForPdf(cid, m[1]);
  if (!lines.length) return null;
  return { lines, creditPerRoom: 10 };
}

/**
 * Bordered table: No. | Property | Unit number | Room name + total row (full-width cell).
 */
function drawRoomBreakdownTable(doc, bodyFont, lines, creditPerRoom, totalCredits, margin) {
  const tableWidth = doc.page.width - 2 * margin;
  const wNo = 34;
  const rest = tableWidth - wNo;
  const wProp = Math.floor(rest * 0.38);
  const wUnit = Math.floor(rest * 0.22);
  const wRoom = rest - wProp - wUnit;
  const x0 = margin;
  const xProp = x0 + wNo;
  const xUnit = xProp + wProp;
  const xRoom = xUnit + wUnit;
  const tableW = wNo + wProp + wUnit + wRoom;
  const textPad = 6;
  let y = doc.y + 4;
  const pageBottom = doc.page.height - margin;
  const borderColor = '#374151';
  const innerBorder = '#9ca3af';

  function ensureSpace(need) {
    if (y + need > pageBottom) {
      doc.addPage();
      y = margin;
    }
  }

  doc.font(bodyFont).fontSize(10).fillColor('#333');
  const titleH = doc.heightOfString('Room breakdown', { width: tableWidth });
  ensureSpace(titleH + 4);
  doc.text('Room breakdown', x0, y, { width: tableWidth });
  y += titleH + 10;

  const headerH = 24;
  ensureSpace(headerH + 4);
  doc.lineWidth(0.75).strokeColor(borderColor);
  doc.fillColor('#f3f4f6').rect(x0, y, tableW, headerH).fill();
  doc.rect(x0, y, tableW, headerH).stroke();
  doc.moveTo(xProp, y).lineTo(xProp, y + headerH).stroke();
  doc.moveTo(xUnit, y).lineTo(xUnit, y + headerH).stroke();
  doc.moveTo(xRoom, y).lineTo(xRoom, y + headerH).stroke();

  doc.fillColor('#374151').font(bodyFont).fontSize(9);
  doc.text('No.', x0 + 4, y + 7, { width: wNo - 8, align: 'center' });
  doc.text('Property', xProp + textPad, y + 7, { width: wProp - textPad * 2 });
  doc.text('Unit number', xUnit + textPad, y + 7, { width: wUnit - textPad * 2 });
  doc.text('Room name', xRoom + textPad, y + 7, { width: wRoom - textPad * 2 });
  y += headerH;

  doc.strokeColor(innerBorder).lineWidth(0.5);
  doc.fillColor('#111');

  for (let idx = 0; idx < lines.length; idx += 1) {
    const ln = lines[idx];
    const p = ln.property;
    const u = ln.unitNumber;
    const r = ln.roomName;
    const noStr = String(idx + 1);
    doc.font(bodyFont).fontSize(9);
    const innerWNo = wNo - 8;
    const innerWProp = wProp - textPad * 2;
    const innerWUnit = wUnit - textPad * 2;
    const innerWRoom = wRoom - textPad * 2;
    const h0 = doc.heightOfString(noStr, { width: innerWNo });
    const h1 = doc.heightOfString(p, { width: innerWProp });
    const h2 = doc.heightOfString(u, { width: innerWUnit });
    const h3 = doc.heightOfString(r, { width: innerWRoom });
    const rowH = Math.max(h0, h1, h2, h3, 14) + textPad * 2;
    ensureSpace(rowH + 2);

    doc.strokeColor(borderColor).lineWidth(0.6);
    doc.fillColor('#ffffff').rect(x0, y, tableW, rowH).fill();
    doc.rect(x0, y, tableW, rowH).stroke();
    doc.strokeColor(innerBorder).lineWidth(0.5);
    doc.moveTo(xProp, y).lineTo(xProp, y + rowH).stroke();
    doc.moveTo(xUnit, y).lineTo(xUnit, y + rowH).stroke();
    doc.moveTo(xRoom, y).lineTo(xRoom, y + rowH).stroke();

    doc.fillColor('#111');
    doc.text(noStr, x0 + 4, y + textPad, { width: innerWNo, align: 'center' });
    doc.text(p, xProp + textPad, y + textPad, { width: innerWProp });
    doc.text(u, xUnit + textPad, y + textPad, { width: innerWUnit });
    doc.text(r, xRoom + textPad, y + textPad, { width: innerWRoom });
    y += rowH;
  }

  const totalLine = `Total: ${lines.length} room(s) × ${creditPerRoom} credits = ${totalCredits} credits`;
  doc.font(bodyFont).fontSize(10);
  const totalBodyH = doc.heightOfString(totalLine, { width: tableW - textPad * 2 });
  const totalH = Math.max(totalBodyH + textPad * 2, 28);
  ensureSpace(totalH + 8);
  doc.strokeColor(borderColor).lineWidth(0.75);
  doc.fillColor('#e5e7eb').rect(x0, y, tableW, totalH).fill();
  doc.rect(x0, y, tableW, totalH).stroke();
  doc.fillColor('#111').font(bodyFont).fontSize(10);
  doc.text(totalLine, x0 + textPad, y + textPad, { width: tableW - textPad * 2 });
  y += totalH + 16;
  return y;
}

/**
 * @param {{ title?: string, amount: number, reference_number?: string, remark?: string|null, payload?: string|null, created_at?: string|Date, companyTitle: string, pdfLines?: Array<{ property: string, unitNumber: string, roomName: string }>|null, pdfCreditPerRoom?: number }} row
 * @returns {Promise<Buffer>}
 */
function buildCreditLogDeductionReportPdf(row) {
  return new Promise((resolve, reject) => {
    const margin = 48;
    const doc = new PDFDocument({
      size: 'A4',
      margin,
      info: { Title: 'Credit deduction' }
    });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const bodyFont = pickBodyFont(doc);
    const amt = Number(row.amount) || 0;
    const credits = Math.abs(amt);
    const parsed = parseActiveRoomMonthlyPayload(row.payload);
    const lines =
      row.pdfLines && row.pdfLines.length
        ? row.pdfLines
        : parsed?.lines && parsed.lines.length
          ? parsed.lines
          : [];
    const creditPerRoom = row.pdfCreditPerRoom ?? parsed?.creditPerRoom ?? 10;

    doc.font(bodyFont).fontSize(18).fillColor('#111').text('Credit deduction', { align: 'left' });
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('#000').text(row.companyTitle || '—', { width: 500 });
    doc.moveDown(0.9);

    doc.font(bodyFont).fontSize(10).fillColor('#333').text('Description', { width: 500 });
    doc.font(bodyFont).fontSize(11).fillColor('#000').text((row.title || '—').toString(), { width: 500 });
    doc.moveDown(0.6);

    doc.font(bodyFont).fontSize(10).fillColor('#333').text('Date (Malaysia)', { width: 500 });
    doc.font(bodyFont).fontSize(11).fillColor('#000').text(formatPostedDateMalaysia(row.created_at), { width: 500 });
    doc.moveDown(0.6);

    if (row.reference_number && String(row.reference_number).trim()) {
      doc.font(bodyFont).fontSize(10).fillColor('#333').text('Reference', { width: 500 });
      doc.font(bodyFont).fontSize(10).fillColor('#000').text(String(row.reference_number).trim(), { width: 500 });
      doc.moveDown(0.6);
    }

    if (lines.length) {
      doc.font(bodyFont).fontSize(10).fillColor('#333').text('Credits deducted', { width: 500 });
      doc.font(bodyFont).fontSize(12).fillColor('#000').text(String(credits), { width: 500 });
      doc.moveDown(0.5);
      const endY = drawRoomBreakdownTable(doc, bodyFont, lines, creditPerRoom, credits, margin);
      doc.y = endY;
    } else {
      doc.font(bodyFont).fontSize(10).fillColor('#333').text('Credits deducted', { width: 500 });
      doc.font(bodyFont).fontSize(20).fillColor('#111').text(String(credits), { width: 500 });
      doc.moveDown(0.8);
      const remark = row.remark != null && String(row.remark).trim() ? String(row.remark) : '';
      if (remark) {
        doc.font(bodyFont).fontSize(10).fillColor('#333').text('Breakdown', { width: 500 });
        doc.moveDown(0.2);
        doc.font(bodyFont).fontSize(9).fillColor('#222').text(remark, { width: 500, lineGap: 2 });
      }
    }

    doc.moveDown(1);
    doc.fontSize(8).fillColor('#666').text(
      'Summary for your records only. Not a tax invoice.',
      { width: 500 }
    );

    doc.end();
  });
}

module.exports = {
  buildCreditLogDeductionReportPdf,
  getMonthlyRoomLinesBundleForRow,
  fetchMonthlyRoomLinesForPdf,
  parseActiveRoomMonthlyPayload
};
