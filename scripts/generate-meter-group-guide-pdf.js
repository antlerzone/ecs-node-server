#!/usr/bin/env node
/**
 * Generate meter-group-guide.pdf from docs/readme/meter-group-guide.md content.
 * Output: coliving/next-app/public/meter-group-guide.pdf (so visitors can download at /meter-group-guide.pdf)
 * Run from repo root: node scripts/generate-meter-group-guide-pdf.js
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const OUT_PATH = path.join(__dirname, '..', 'coliving', 'next-app', 'public', 'meter-group-guide.pdf');

const sections = [
  { title: 'Meter Group Guide', body: 'This guide explains the three meter group types available when creating a meter group in Operator → Meter Setting. Detailed formulas: docs/meter-billing-spec.md.' },
  { title: 'Parent-Child (Auto Calculation)', body: '• One parent meter; one or more child meters. Usages from CNYIoT.\n• Shared usage = parent usage − sum of child usages (not below 0). That shared kWh is split per sharing mode. Each child: own child usage + share of shared usage (final usage).\n• Use case: Main meter + room sub-meters; allocate the gap between main and subs.\n• Sample: Parent 600 kWh; children 120 + 180 + 150 = 450 kWh. Shared = 600 − 450 = 150 kWh. Only this 150 kWh is split among the three children (not the full 600). Each child still has 120 / 180 / 150 from their own meter before their share of the 150.' },
  { title: 'Parent-Child (Manual Entry)', body: '• One parent; one or more children. Usages from CNYIoT.\n• Manual: shared pool = full parent usage (children are NOT subtracted first). Invoice uses TNB amount you enter; hybrid: own kWh at selling rate, shared at TNB unit cost (see docs/meter-billing-spec.md).\n• Use case: Bill must match the official TNB total.\n• Sample: Parent 500 kWh for the month. Shared pool = 500 kWh (not 500 − children). You enter e.g. RM 350 TNB; that splits across children per mode at TNB per kWh.' },
  { title: 'Brother Group (Equal Peers)', body: '• Peers only (no parent). Sum of peer usages = group total.\n• Splitting one money amount: Equal = even; By Usage = each peer\'s kWh ÷ group total kWh; By Percentage = your fixed %.\n• Sample: Peers 80 + 120 + 100 = 300 kWh. Amount RM 900. Equal → RM 300 each. By Usage → 80/300, 120/300, 100/300 of RM 900 → RM 240 / RM 360 / RM 300. By % e.g. 40% / 35% / 25% → RM 360 / RM 315 / RM 225 (total 100%).' },
  { title: 'Sharing modes', body: 'Equal Split — divide one amount equally.\nBy Usage — split by each meter\'s kWh share of total kWh in the group.\nBy Percentage — fixed % per meter (total 100%).\n\nSamples (split RM 600 across 3 meters):\n• Equal: RM 200 each.\n• By Usage: 100 + 200 + 100 = 400 kWh → RM 150 / RM 300 / RM 150.\n• By %: 40% / 35% / 25% → RM 240 / RM 210 / RM 150.\n\nFor Parent-Child (Auto), the split applies to the shared kWh/cost after parent − children, not the parent total alone.' },
];

function buildPdf() {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    let y = 50;
    const pageWidth = doc.page.width - 100;
    const lineHeight = 18;
    const titleSize = 16;
    const bodySize = 10;

    sections.forEach((sec, i) => {
      if (y > doc.page.height - 80) {
        doc.addPage({ size: 'A4', margin: 50 });
        y = 50;
      }
      doc.fontSize(i === 0 ? 20 : titleSize).font('Helvetica-Bold').text(sec.title, 50, y, { width: pageWidth });
      y += (i === 0 ? 24 : 22);
      doc.fontSize(bodySize).font('Helvetica').text(sec.body, 50, y, { width: pageWidth, lineGap: 4 });
      y += doc.heightOfString(sec.body, { width: pageWidth, lineGap: 4 }) + 20;
    });

    doc.fontSize(9).font('Helvetica-Oblique').fillColor('#666666')
      .text('Generated from docs/readme/meter-group-guide.md. For more on Meter Setting, see docs/readme/index.', 50, y, { width: pageWidth });
    doc.end();
  });
}

(async () => {
  try {
    const buf = await buildPdf();
    const dir = path.dirname(OUT_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(OUT_PATH, buf);
    console.log('Written:', OUT_PATH);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
