#!/usr/bin/env node
/**
 * Export ownerpayout rows that still need Bukku invoice and/or bill URLs.
 * Output CSV with empty bukkuinvoice_fill / bukkubills_fill columns for manual completion.
 * After import-ownerpayout-bukku-urls-from-csv.js, rows get paid=1 unless --no-mark-paid.
 *
 * Usage:
 *   node scripts/export-ownerpayout-missing-bukku-urls.js [output.csv]
 * Default output: ./ownerpayout_missing_bukku_urls_fill_template.csv
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const pool = require('../src/config/db');

function esc(s) {
  if (s == null) return '';
  const t = String(s);
  if (/[",\n\r]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

async function run() {
  const outArg = process.argv[2];
  const outPath = outArg
    ? path.isAbsolute(outArg)
      ? outArg
      : path.join(process.cwd(), outArg)
    : path.join(process.cwd(), 'ownerpayout_missing_bukku_urls_fill_template.csv');

  const [rows] = await pool.query(`
    SELECT o.id, o.client_id, o.title,
           DATE_FORMAT(o.period, '%Y-%m-%d %H:%i:%s') AS period_utc,
           o.management_fee, o.netpayout, o.paid,
           p.shortname AS property_shortname,
           o.bukkuinvoice, o.bukkubills
    FROM ownerpayout o
    LEFT JOIN propertydetail p ON p.id = o.property_id AND p.client_id = o.client_id
    WHERE (o.bukkuinvoice IS NULL OR TRIM(o.bukkuinvoice) = '')
       OR (o.bukkubills IS NULL OR TRIM(o.bukkubills) = '')
    ORDER BY o.client_id, o.period DESC, o.title
  `);

  const header = [
    'id',
    'client_id',
    'property_shortname',
    'title',
    'period_utc',
    'management_fee',
    'netpayout',
    'paid',
    'needs_invoice_url',
    'needs_bill_url',
    'bukkuinvoice_current',
    'bukkubills_current',
    'bukkuinvoice_fill',
    'bukkubills_fill'
  ];

  const lines = [header.join(',')];
  let count = 0;
  for (const r of rows) {
    const mf = Number(r.management_fee || 0);
    const np = Number(r.netpayout || 0);
    const invEmpty = !r.bukkuinvoice || !String(r.bukkuinvoice).trim();
    const billEmpty = !r.bukkubills || !String(r.bukkubills).trim();
    const needsInv = mf > 0 && invEmpty ? '1' : '0';
    const needsBill = np > 0 && billEmpty ? '1' : '0';
    if (needsInv === '0' && needsBill === '0') continue;

    lines.push(
      [
        esc(r.id),
        esc(r.client_id),
        esc(r.property_shortname),
        esc(r.title),
        esc(r.period_utc),
        esc(mf),
        esc(np),
        r.paid ? '1' : '0',
        needsInv,
        needsBill,
        esc(r.bukkuinvoice),
        esc(r.bukkubills),
        '',
        ''
      ].join(',')
    );
    count += 1;
  }

  fs.writeFileSync(outPath, '\uFEFF' + lines.join('\n'), 'utf8');
  console.log(`[export-ownerpayout-missing-bukku-urls] Wrote ${count} data rows -> ${outPath}`);
  await pool.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
