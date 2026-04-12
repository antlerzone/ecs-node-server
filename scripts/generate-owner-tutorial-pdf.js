/**
 * Generate Owner Tutorial PDF from docs/tutorial/owner-tutorial.md.
 * Embeds images from docs/tutorial/screenshots/ (paths like ./screenshots/owner.png).
 * Usage: node scripts/generate-owner-tutorial-pdf.js
 * Output: docs/tutorial/owner-tutorial.pdf
 */

const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

const TUTORIAL_DIR = path.join(__dirname, '..', 'docs', 'tutorial');
const MD_FILE = path.join(TUTORIAL_DIR, 'owner-tutorial.md');
const OUT_FILE = path.join(TUTORIAL_DIR, 'owner-tutorial.pdf');
const SCREENSHOTS_DIR = path.join(TUTORIAL_DIR, 'screenshots');

const MARGIN = 50;
const PAGE_WIDTH = 595;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const IMAGE_MAX_WIDTH = CONTENT_WIDTH;
const LINE_HEIGHT = 1.25;

function stripMarkdownBold(s) {
  return s.replace(/\*\*([^*]+)\*\*/g, '$1');
}

function addParagraph(doc, text, opts = {}) {
  if (doc.y > doc.page.height - 80) {
    doc.addPage();
    doc.y = MARGIN;
  }
  const font = opts.bold ? 'Helvetica-Bold' : 'Helvetica';
  doc.font(font).fontSize(opts.size || 10);
  const str = stripMarkdownBold(text);
  const h = doc.heightOfString(str, { width: CONTENT_WIDTH });
  doc.text(str, MARGIN, doc.y, { width: CONTENT_WIDTH });
  doc.y += h + (opts.spaceAfter || 6);
}

function addHeading(doc, text, level) {
  if (doc.y > MARGIN + 50) doc.y += 10;
  if (doc.y > doc.page.height - 100) {
    doc.addPage();
    doc.y = MARGIN;
  }
  doc.font('Helvetica-Bold');
  if (level === 1) doc.fontSize(18);
  else if (level === 2) doc.fontSize(14);
  else doc.fontSize(12);
  doc.text(stripMarkdownBold(text), MARGIN, doc.y, { width: CONTENT_WIDTH });
  doc.y += doc.currentLineHeight() * LINE_HEIGHT + 4;
}

function addImage(doc, imagePath) {
  const fullPath = path.isAbsolute(imagePath) ? imagePath : path.join(TUTORIAL_DIR, imagePath.replace(/^\.\//, ''));
  if (!fs.existsSync(fullPath)) {
    addParagraph(doc, `[Image: ${path.basename(fullPath)} not found]`, { size: 9 });
    return;
  }
  try {
    doc.addPage();
    doc.y = MARGIN;
    const img = doc.openImage(fullPath);
    const pageH = doc.page.height - MARGIN * 2;
    const pageW = CONTENT_WIDTH;
    let w = img.width;
    let h = img.height;
    if (w <= 0 || h <= 0) {
      doc.text('[Image invalid]', MARGIN, doc.y);
      return;
    }
    const scale = Math.min(pageW / w, pageH / h);
    w = w * scale;
    h = h * scale;
    doc.image(fullPath, MARGIN + (pageW - w) / 2, MARGIN + (pageH - h) / 2, { width: w, height: h });
    doc.y = doc.page.height - MARGIN;
  } catch (e) {
    addParagraph(doc, `[Image error: ${path.basename(fullPath)}]`, { size: 9 });
  }
}

function parseAndWrite(doc, md) {
  const lines = md.split(/\r?\n/);
  let inTable = false;
  let tableRows = [];
  let inBlockquote = false;
  let blockquoteLines = [];

  function flushBlockquote() {
    if (blockquoteLines.length) {
      doc.font('Helvetica').fontSize(10);
      for (const line of blockquoteLines) {
        if (doc.y > doc.page.height - 80) { doc.addPage(); doc.y = MARGIN; }
        const imgMatch = line.match(/!\[([^\]]*)\]\((\.\/screenshots\/[^)]+)\)/);
        if (imgMatch) {
          addImage(doc, imgMatch[2]);
        } else {
          const caption = line.match(/\*\s*(.+)\s*\*/);
          if (caption) {
            doc.fontSize(9).fillColor('#444444').text(stripMarkdownBold(caption[1]), MARGIN, doc.y, { width: CONTENT_WIDTH });
            doc.y += doc.currentLineHeight() + 2;
            doc.fillColor('#000000');
          }
        }
      }
      doc.y += 6;
      blockquoteLines = [];
    }
    inBlockquote = false;
  }

  function flushTable() {
    if (tableRows.length < 2) { tableRows = []; inTable = false; return; }
    doc.font('Helvetica').fontSize(9);
    const cols = tableRows[0].length;
    // Proportional widths: first column narrower for "Area" / "Step" / "Problem"
    const ratios = cols === 2 ? [0.28, 0.72] : cols === 3 ? [0.18, 0.38, 0.44] : null;
    const colWidths = ratios ? ratios.map(r => CONTENT_WIDTH * r) : Array(cols).fill(CONTENT_WIDTH / cols);
    const pad = 6;
    const dataRows = tableRows.filter((row, idx) => {
      const isSep = row.every(c => /^[-:|\s]+$/.test(String(c)));
      return !isSep;
    });
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      if (doc.y > doc.page.height - 100) { doc.addPage(); doc.y = MARGIN; }
      const cellHeights = row.map((cell, j) => {
        const w = colWidths[j] - pad * 2;
        return doc.heightOfString(stripMarkdownBold(String(cell).trim()), { width: w });
      });
      const rowH = Math.max(20, ...cellHeights) + pad;
      let x = MARGIN;
      for (let j = 0; j < row.length; j++) {
        doc.rect(x, doc.y, colWidths[j], rowH).stroke();
        doc.text(stripMarkdownBold(String(row[j]).trim()), x + pad, doc.y + pad, {
          width: colWidths[j] - pad * 2,
          align: j === 0 ? 'left' : 'left',
        });
        x += colWidths[j];
      }
      doc.y += rowH;
    }
    doc.y += 10;
    tableRows = [];
    inTable = false;
  }

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      if (!inTable) flushBlockquote();
      inTable = true;
      const cells = trimmed.split('|').slice(1, -1).map(c => c.trim());
      tableRows.push(cells);
      continue;
    } else if (inTable) {
      flushTable();
    }

    if (trimmed.startsWith('> ')) {
      inBlockquote = true;
      blockquoteLines.push(trimmed.slice(2));
      continue;
    } else if (inBlockquote && (trimmed === '' || !trimmed.startsWith('*'))) {
      flushBlockquote();
    }

    if (trimmed === '' || trimmed === '---') {
      flushBlockquote();
      doc.y += 8;
      continue;
    }

    if (trimmed.startsWith('# ')) {
      flushBlockquote();
      addHeading(doc, trimmed.slice(2), 1);
      continue;
    }
    if (trimmed.startsWith('## ')) {
      flushBlockquote();
      addHeading(doc, trimmed.slice(3), 2);
      continue;
    }
    if (trimmed.startsWith('### ')) {
      flushBlockquote();
      addHeading(doc, trimmed.slice(4), 3);
      continue;
    }

    if (trimmed.startsWith('- ')) {
      flushBlockquote();
      addParagraph(doc, '• ' + trimmed.slice(2), { size: 10 });
      continue;
    }

    const imgMatch = trimmed.match(/!\[([^\]]*)\]\((\.\/screenshots\/[^)]+)\)/);
    if (imgMatch) {
      flushBlockquote();
      addImage(doc, imgMatch[2]);
      if (lines[i + 1] && lines[i + 1].trim().match(/^\*\s*.+\s*$/)) {
        doc.fontSize(9).fillColor('#444444');
        doc.text(stripMarkdownBold(lines[i + 1].trim().replace(/^\*\s*/, '')), MARGIN, doc.y, { width: CONTENT_WIDTH });
        doc.y += doc.currentLineHeight() + 4;
        doc.fillColor('#000000');
        i++;
      }
      continue;
    }

    if (trimmed.startsWith('*') && trimmed.endsWith('*') && !trimmed.includes('**')) {
      flushBlockquote();
      addParagraph(doc, trimmed, { size: 9 });
      continue;
    }

    if (trimmed.length > 0 && !trimmed.startsWith('>')) {
      flushBlockquote();
      addParagraph(doc, trimmed);
    }
  }
  flushBlockquote();
  flushTable();
}

function buildPdf() {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(MD_FILE)) {
      reject(new Error('Missing: ' + MD_FILE));
      return;
    }
    const md = fs.readFileSync(MD_FILE, 'utf8');
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN });
    const out = fs.createWriteStream(OUT_FILE);
    doc.pipe(out);
    doc.y = MARGIN;
    parseAndWrite(doc, md);
    doc.end();
    out.on('finish', () => resolve(OUT_FILE));
    out.on('error', reject);
  });
}

buildPdf()
  .then((p) => console.log('Owner tutorial PDF written:', p))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
