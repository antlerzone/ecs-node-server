/**
 * Generate Usage Tutorial PowerPoint from the tutorial structure.
 * Output: docs/tutorial/usage-tutorial.pptx
 * Uses pptxgenjs. For full Chinese version see docs/tutorial/usage-tutorial.md
 */

const PptxGenJS = require('pptxgenjs');
const path = require('path');
const fs = require('fs');

const OUT_DIR = path.join(__dirname, '..', 'docs', 'tutorial');
const OUT_FILE = path.join(OUT_DIR, 'usage-tutorial.pptx');

const pptx = new PptxGenJS();
pptx.title = 'Coliving SaaS Usage Tutorial';
pptx.author = 'Coliving Management';
pptx.subject = 'Property Management Platform - How to Use';

// --- Slide 1: Title ---
const s1 = pptx.addSlide();
s1.addText('Coliving SaaS Property Management Platform', {
  x: 0.5, y: 1.2, w: 9, h: 0.8,
  fontSize: 28, bold: true, align: 'center',
});
s1.addText('Usage Tutorial', {
  x: 0.5, y: 2.1, w: 9, h: 0.5,
  fontSize: 18, align: 'center',
});
s1.addText('Frontend: Wix  |  Backend: Node (ECS)  |  DB: MySQL', {
  x: 0.5, y: 2.8, w: 9, h: 0.4,
  fontSize: 12, align: 'center', color: '666666',
});

// --- Slide 2: Architecture ---
const s2 = pptx.addSlide();
s2.addText('1. System Architecture', { x: 0.5, y: 0.4, w: 9, h: 0.5, fontSize: 20, bold: true });
s2.addText('Wix (each client subdomain) calls ECS with token + X-API-Username. ECS resolves client from host/header and reads/writes MySQL.', {
  x: 0.5, y: 1, w: 9, h: 0.6, fontSize: 11,
});
// Simple diagram: 3 boxes
s2.addShape(pptx.ShapeType.rect, { x: 0.6, y: 1.8, w: 2.2, h: 1, fill: { color: 'E8F4FD' }, line: { color: '4F81BD' } });
s2.addText('Wix Frontend', { x: 0.7, y: 2.1, w: 2, h: 0.4, fontSize: 12, bold: true, align: 'center' });
s2.addShape(pptx.ShapeType.rect, { x: 3.4, y: 1.8, w: 2.2, h: 1, fill: { color: 'E8F4FD' }, line: { color: '4F81BD' } });
s2.addText('Node (ECS)\nExpress API', { x: 3.5, y: 2.0, w: 2, h: 0.6, fontSize: 12, bold: true, align: 'center' });
s2.addShape(pptx.ShapeType.rect, { x: 6.2, y: 1.8, w: 2.2, h: 1, fill: { color: 'E8F4FD' }, line: { color: '4F81BD' } });
s2.addText('MySQL', { x: 6.3, y: 2.15, w: 2, h: 0.4, fontSize: 12, bold: true, align: 'center' });
s2.addText('Integrations: Stripe, Bukku/Xero/AutoCount/SQL, OSS', { x: 0.5, y: 3.0, w: 9, h: 0.4, fontSize: 10, color: '666666' });

// --- Slide 3: Roles ---
const s3 = pptx.addSlide();
s3.addText('2. Roles', { x: 0.5, y: 0.4, w: 9, h: 0.5, fontSize: 20, bold: true });
s3.addText('Operator (staff)', { x: 0.5, y: 1.0, w: 9, h: 0.35, fontSize: 14, bold: true });
s3.addText('Company Setting, Property/Room/Tenancy, Invoice, Expenses, Admin, Billing, Meter/Smart Door', { x: 0.7, y: 1.35, w: 8.8, h: 0.5, fontSize: 11 });
s3.addText('Tenant', { x: 0.5, y: 2.0, w: 9, h: 0.35, fontSize: 14, bold: true });
s3.addText('Profile, agreements, pay rent/invoice, meter top-up, lock, feedback', { x: 0.7, y: 2.35, w: 8.8, h: 0.5, fontSize: 11 });
s3.addText('Owner', { x: 0.5, y: 2.9, w: 9, h: 0.35, fontSize: 14, bold: true });
s3.addText('Owner portal, reports', { x: 0.7, y: 3.25, w: 8.8, h: 0.4, fontSize: 11 });

// --- Slide 4: Environment ---
const s4 = pptx.addSlide();
s4.addText('3. Environment & Deployment', { x: 0.5, y: 0.4, w: 9, h: 0.5, fontSize: 20, bold: true });
s4.addText('Backend: npm install → npm run dev or npm start. Set .env (MySQL, STRIPE_*, CRON_SECRET).', {
  x: 0.5, y: 1.0, w: 9, h: 0.5, fontSize: 11, bullet: true,
});
s4.addText('Wix Secret Manager: ecs_token, ecs_username, ecs_base_url. Request headers: Authorization: Bearer <token>, X-API-Username: <username>.', {
  x: 0.5, y: 1.6, w: 9, h: 0.65, fontSize: 11, bullet: true,
});
s4.addText('Migrations: node scripts/run-migration.js src/db/migrations/xxxx_*.sql', {
  x: 0.5, y: 2.35, w: 9, h: 0.4, fontSize: 11, bullet: true,
});

// --- Slide 5: Daily Cron ---
const s5 = pptx.addSlide();
s5.addText('4. Daily Cron (POST /api/cron/daily)', { x: 0.5, y: 0.4, w: 9, h: 0.5, fontSize: 20, bold: true });
s5.addText('Header: X-Cron-Secret = CRON_SECRET. Run daily at 00:00 UTC+8.', { x: 0.5, y: 0.95, w: 9, h: 0.4, fontSize: 11 });
const cronSteps = [
  'Overdue rent → lock door, power off, tenancy active=0',
  'Room available sync (roomdetail.available / availablesoon)',
  'Refund deposit: tenancy end passed → create refunddeposit',
  'Plan expiry → client inactive',
  'Core credit expiry → creditlogs',
  'Monthly 1st: active room -10 credit each',
  'Stripe settlement journal',
  'Lock battery <20% → feedback',
];
let cy = 1.5;
cronSteps.forEach((t, i) => {
  s5.addText(`${i + 1}. ${t}`, { x: 0.5, y: cy, w: 9, h: 0.35, fontSize: 10, bullet: true });
  cy += 0.38;
});

// --- Slide 6: Operator daily ---
const s6 = pptx.addSlide();
s6.addText('5. Operator Daily Use', { x: 0.5, y: 0.4, w: 9, h: 0.5, fontSize: 20, bold: true });
const opItems = [
  'Company Setting: profile, staff, integration (accounting, meter, smart door)',
  'Property / Room / Tenancy: list, extend, change room, terminate',
  'Tenant Invoice: rental list, meter groups, top-up; amount >1000 → manual ticket',
  'Expenses: list, bulk upload, bank bulk (JomPay)',
  'Admin Dashboard: feedback, refund (edit amount ≤ original → journal)',
  'Billing: plan, credit, statements, Stripe; ≥1000 → manual',
];
opItems.forEach((t, i) => {
  s6.addText(t, { x: 0.5, y: 0.95 + i * 0.42, w: 9, h: 0.4, fontSize: 11, bullet: true });
});

// --- Slide 7: Tenant & Stripe ---
const s7 = pptx.addSlide();
s7.addText('6. Tenant  |  7. Stripe', { x: 0.5, y: 0.4, w: 9, h: 0.5, fontSize: 20, bold: true });
s7.addText('Tenant: Profile first → agreement; unpaid rent disables meter/smart door. Pay rent, invoice, meter top-up, lock, feedback.', {
  x: 0.5, y: 1.0, w: 9, h: 0.7, fontSize: 11,
});
s7.addText('Stripe: (1) Client credit top-up → Checkout → webhook. (2) Tenant rent → Connect; 1% from credit. (3) Tenant invoice/meter → create-payment.', {
  x: 0.5, y: 1.85, w: 9, h: 0.8, fontSize: 11,
});

// --- Slide 8: Docs ---
const s8 = pptx.addSlide();
s8.addText('8. Docs & Scripts', { x: 0.5, y: 0.4, w: 9, h: 0.5, fontSize: 20, bold: true });
s8.addText('Full index: docs/index.md', { x: 0.5, y: 1.0, w: 9, h: 0.35, fontSize: 11, bullet: true });
s8.addText('Scripts: clear-and-import-operatordetail.js, import-rentalcollection.js, run-migration.js, insert-api-user.js', { x: 0.5, y: 1.4, w: 9, h: 0.5, fontSize: 11, bullet: true });
s8.addText('Wix: docs/wix/jsw, docs/wix/frontend (*-page-full.js)', { x: 0.5, y: 1.9, w: 9, h: 0.4, fontSize: 11, bullet: true });
s8.addText('Full Chinese tutorial: docs/tutorial/usage-tutorial.md', { x: 0.5, y: 2.5, w: 9, h: 0.4, fontSize: 10, color: '666666' });

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
pptx.writeFile({ fileName: OUT_FILE })
  .then(() => console.log('PPTX written:', OUT_FILE))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
