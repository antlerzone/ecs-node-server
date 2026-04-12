/**
 * Convert HTML string to PDF buffer using Puppeteer. No Drive usage.
 * Used for agreement template preview (Drive HTML export → replace vars → PDF).
 */

/** Base styles so HTML fragments render in Puppeteer PDF; match common Word agreement (Times New Roman, 10.5pt). */
/** Mammoth does not preserve paragraph alignment; center first block (title/parties) like typical Word template. */
const BASE_STYLES = `
  html, body { visibility: visible !important; min-height: 100vh; margin: 0; padding: 0; font-size: 10.5pt; font-family: 'Times New Roman', Times, serif; color: #000; line-height: 1.35; }
  body * { visibility: visible !important; }
  body > p:nth-of-type(-n+10), body > div > p:nth-of-type(-n+10) { text-align: center; }
  body > p:nth-of-type(n+11), body > div > p:nth-of-type(n+11) { text-align: left; }
  .agreement-preview, .agreement-preview * { visibility: visible !important; }
  .agreement-preview p, .agreement-preview div { margin: 0.35em 0; }
  .agreement-preview h1, .agreement-preview h2, .agreement-preview h3, .agreement-preview h4 { margin: 0.5em 0 0.25em 0; font-weight: bold; }
  .agreement-preview ul { margin: 0.35em 0; padding-left: 1.5em; }
  .agreement-preview li { margin: 0.2em 0; }
`;

/** Ensure we have a full HTML document so Puppeteer renders correctly (export may return body fragment only). */
function ensureFullDocument(html) {
  if (!html || typeof html !== 'string') return '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body></body></html>';
  const trimmed = html.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('<!doctype') || (lower.startsWith('<html') && lower.includes('<'))) {
    return html;
  }
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${BASE_STYLES}</style></head><body>${trimmed}</body></html>`;
}

/** @param {string} html - Full HTML document string (or fragment from Drive export)
 *  @returns {Promise<Buffer>}
 */
async function htmlToPdfBuffer(html) {
  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch (e) {
    throw new Error('puppeteer not installed: run npm install puppeteer');
  }
  const fullHtml = ensureFullDocument(html);
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 794, height: 1123 }); // A4 at 96dpi
    const contentTimeout = Number(process.env.AGREEMENT_PUPPETEER_CONTENT_TIMEOUT_MS) || 60000;
    await page.setContent(fullHtml, { waitUntil: 'load', timeout: contentTimeout });
    await page.evaluate(() => new Promise((r) => setTimeout(r, 600)));
    const buffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' }
    });
    return Buffer.from(buffer);
  } finally {
    await browser.close();
  }
}

module.exports = { htmlToPdfBuffer };
