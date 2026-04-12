/**
 * Generate Usage Tutorial PDF from the tutorial structure.
 * Output: docs/tutorial/usage-tutorial.pdf
 * Uses PDFKit (Helvetica); for Chinese version use the .md file or convert with pandoc.
 */

const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

const OUT_DIR = path.join(__dirname, '..', 'docs', 'tutorial');
const OUT_FILE = path.join(OUT_DIR, 'usage-tutorial.pdf');

function drawArchitectureDiagram(doc, x, y, width) {
  const boxH = 28;
  const boxW = Math.min(width / 4, 100);
  const gap = 20;
  const centerY = y + boxH / 2;

  // Wix
  doc.rect(x, y, boxW, boxH).stroke();
  doc.fontSize(8).text('Wix Frontend', x + 5, y + 8, { width: boxW - 10, align: 'center' });
  doc.text('(subdomain)', x + 5, y + 18, { width: boxW - 10, align: 'center' });

  // Node
  const nodeX = x + boxW + gap;
  doc.rect(nodeX, y, boxW, boxH).stroke();
  doc.fontSize(8).text('Node (ECS)', nodeX + 5, y + 8, { width: boxW - 10, align: 'center' });
  doc.text('Express API', nodeX + 5, y + 18, { width: boxW - 10, align: 'center' });

  // MySQL
  const dbX = nodeX + boxW + gap;
  doc.rect(dbX, y, boxW * 0.8, boxH).stroke();
  doc.fontSize(8).text('MySQL', dbX + 5, y + 12, { width: boxW * 0.8 - 10, align: 'center' });

  // Arrows
  doc.moveTo(x + boxW, centerY).lineTo(nodeX, centerY).stroke();
  doc.moveTo(nodeX + boxW, centerY).lineTo(dbX, centerY).stroke();

  doc.fontSize(9);
  return y + boxH + 15;
}

function drawCronFlow(doc, x, y, width) {
  const steps = [
    '1. Overdue rent → lock door, power off',
    '2. Room available sync',
    '3. Refund deposit (auto create)',
    '4. Plan expiry → client inactive',
    '5. Core credit expiry → creditlogs',
    '6. Monthly 1st: active room -10 credit',
    '7. Stripe settlement journal',
    '8. Lock battery <20% → feedback',
  ];
  doc.fontSize(9);
  steps.forEach((s, i) => {
    doc.text(s, x, y + i * 14, { width: width - 10 });
  });
  return y + steps.length * 14 + 10;
}

function buildPdf() {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
    const out = fs.createWriteStream(OUT_FILE);
    doc.pipe(out);

    let y = 50;
    const pageWidth = doc.page.width - 100;
    const left = 50;

    // Title
    doc.fontSize(18).font('Helvetica-Bold');
    doc.text('Coliving SaaS Property Management Platform', left, y, { width: pageWidth, align: 'center' });
    y += 28;
    doc.fontSize(12).font('Helvetica');
    doc.text('Usage Tutorial (Overview)', left, y, { width: pageWidth, align: 'center' });
    y += 35;

    // 1. System overview
    doc.fontSize(14).font('Helvetica-Bold');
    doc.text('1. System Overview', left, y);
    y += 22;
    doc.fontSize(10).font('Helvetica');
    doc.text('Multi-tenant backend for property operators: tenancy, rent, invoices, meters, smart locks, accounting (Xero/Bukku/AutoCount/SQL), Stripe.', left, y, { width: pageWidth });
    y += 32;

    doc.text('Architecture:', left, y);
    y += 16;
    y = drawArchitectureDiagram(doc, left, y, pageWidth);
    doc.text('Wix calls ECS with token + X-API-Username; ECS resolves client from host/header and reads/writes MySQL.', left, y, { width: pageWidth });
    y += 40;

    // 2. Roles
    doc.fontSize(14).font('Helvetica-Bold');
    doc.text('2. Roles', left, y);
    y += 22;
    doc.fontSize(10).font('Helvetica');
    const roles = [
      'Operator (staff): Company Setting, Property/Room/Tenancy, Invoice, Expenses, Admin, Billing, Meter/Smart Door.',
      'Tenant: Profile, agreements, pay rent/invoice, meter usage & top-up, lock, feedback.',
      'Owner: Owner portal, reports.',
    ];
    roles.forEach((r) => {
      doc.text('• ' + r, left, y, { width: pageWidth - 10 });
      y += 18;
    });
    y += 15;

    // 3. Environment & deployment
    doc.fontSize(14).font('Helvetica-Bold');
    doc.text('3. Environment & Deployment', left, y);
    y += 22;
    doc.fontSize(10).font('Helvetica');
    doc.text('• Backend: npm install, npm run dev or npm start. Set .env (MySQL, STRIPE_*, CRON_SECRET, etc.).', left, y, { width: pageWidth });
    y += 18;
    doc.text('• Wix Secret Manager: ecs_token, ecs_username, ecs_base_url. Every request: Authorization: Bearer <token>, X-API-Username: <username>.', left, y, { width: pageWidth });
    y += 18;
    doc.text('• Migrations: node scripts/run-migration.js src/db/migrations/xxxx_*.sql', left, y, { width: pageWidth });
    y += 25;

    // 4. Daily Cron
    doc.fontSize(14).font('Helvetica-Bold');
    doc.text('4. Daily Cron (POST /api/cron/daily, X-Cron-Secret)', left, y);
    y += 22;
    doc.fontSize(10).font('Helvetica');
    y = drawCronFlow(doc, left, y, pageWidth);
    y += 15;

    // 5. Operator daily use
    doc.fontSize(14).font('Helvetica-Bold');
    doc.text('5. Operator Daily Use', left, y);
    y += 22;
    doc.fontSize(10).font('Helvetica');
    const opPoints = [
      'Company Setting: profile, staff, integration (accounting, meter, smart door).',
      'Property / Room / Tenancy: list, extend, change room, terminate.',
      'Tenant Invoice: rental list, meter groups, top-up; amount >1000 → manual ticket.',
      'Expenses: list, bulk upload, bank bulk (JomPay).',
      'Admin Dashboard: feedback, refund (edit amount ≤ original, mark as refund → journal).',
      'Billing: plan, credit, statements, Stripe Checkout; ≥1000 → manual.',
    ];
    opPoints.forEach((p) => {
      doc.text('• ' + p, left, y, { width: pageWidth - 10 });
      y += 16;
    });
    y += 20;

    // 6. Tenant
    doc.fontSize(14).font('Helvetica-Bold');
    doc.text('6. Tenant', left, y);
    y += 22;
    doc.fontSize(10).font('Helvetica');
    doc.text('Profile first; then agreement; unpaid rent disables meter/smart door. Pay rent/invoice, meter top-up, lock, feedback.', left, y, { width: pageWidth });
    y += 35;

    // 7. Stripe
    doc.fontSize(14).font('Helvetica-Bold');
    doc.text('7. Stripe', left, y);
    y += 22;
    doc.fontSize(10).font('Helvetica');
    doc.text('(1) Client credit top-up → Checkout → webhook → client_credit. (2) Tenant rent → Connect; 1% from credit, release when enough. (3) Tenant invoice/meter → create-payment → Checkout.', left, y, { width: pageWidth });
    y += 40;

    // 8. Docs
    doc.fontSize(14).font('Helvetica-Bold');
    doc.text('8. Docs & Scripts', left, y);
    y += 22;
    doc.fontSize(10).font('Helvetica');
    doc.text('Full index: docs/index.md. Scripts: clear-and-import-operatordetail.js, import-rentalcollection.js, run-migration.js, insert-api-user.js. Wix: docs/wix/jsw, docs/wix/frontend.', left, y, { width: pageWidth });
    y += 25;
    doc.fontSize(9).fillColor('#666666');
    doc.text('For full Chinese tutorial see docs/tutorial/usage-tutorial.md', left, y, { width: pageWidth });

    doc.end();
    out.on('finish', () => resolve(OUT_FILE));
    out.on('error', reject);
  });
}

buildPdf()
  .then((p) => console.log('PDF written:', p))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
