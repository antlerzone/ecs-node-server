#!/usr/bin/env node
/**
 * Import Bukku URLs from filled export template into ownerpayout.
 *
 * Updates:
 *   - bukkuinvoice / bukkubills from bukkuinvoice_fill / bukkubills_fill (non-empty cells only)
 *   - paid = 1 (same as "mark as paid") unless --no-mark-paid
 *
 * Usage:
 *   node scripts/import-ownerpayout-bukku-urls-from-csv.js <filled.csv> [--dry-run] [--no-mark-paid]
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const pool = require('../src/config/db');

function splitCsvRows(content) {
  const rows = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (c === '"') {
      if (q && content[i + 1] === '"') {
        cur += '"';
        i++;
        continue;
      }
      q = !q;
      continue;
    }
    if (!q && (c === '\n' || c === '\r')) {
      if (cur.length > 0) rows.push(cur);
      cur = '';
      if (c === '\r' && content[i + 1] === '\n') i++;
      continue;
    }
    cur += c;
  }
  if (cur.length > 0) rows.push(cur);
  return rows;
}

function parseLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
        continue;
      }
      q = !q;
      continue;
    }
    if (!q && c === ',') {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

async function run() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const dryRun = process.argv.includes('--dry-run');
  const markPaid = !process.argv.includes('--no-mark-paid');

  const csvPath = args[0];
  if (!csvPath) {
    console.error(
      'Usage: node scripts/import-ownerpayout-bukku-urls-from-csv.js <filled.csv> [--dry-run] [--no-mark-paid]'
    );
    process.exit(1);
  }

  const full = path.isAbsolute(csvPath) ? csvPath : path.join(process.cwd(), csvPath);
  if (!fs.existsSync(full)) {
    console.error('File not found:', full);
    process.exit(1);
  }

  let content = fs.readFileSync(full, 'utf8');
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);

  const lines = splitCsvRows(content);
  if (lines.length < 2) {
    console.error('CSV needs header + at least one data row');
    process.exit(1);
  }

  const headers = parseLine(lines[0]).map((h) => h.trim().toLowerCase());
  const col = (name) => headers.indexOf(name.toLowerCase());

  const iId = col('id');
  const iInv = col('bukkuinvoice_fill');
  const iBill = col('bukkubills_fill');

  if (iId < 0) {
    console.error('CSV must include an id column');
    process.exit(1);
  }
  if (iInv < 0 && iBill < 0) {
    console.error('CSV must include bukkuinvoice_fill and/or bukkubills_fill');
    process.exit(1);
  }

  let okRows = 0;
  let skipped = 0;

  for (let r = 1; r < lines.length; r++) {
    const cells = parseLine(lines[r]);
    const id = (cells[iId] || '').trim();
    if (!id) {
      skipped += 1;
      continue;
    }

    const inv = iInv >= 0 ? (cells[iInv] || '').trim() : '';
    const bill = iBill >= 0 ? (cells[iBill] || '').trim() : '';
    if (!inv && !bill) {
      skipped += 1;
      continue;
    }

    const sets = [];
    const vals = [];

    if (inv) {
      sets.push('bukkuinvoice = ?');
      vals.push(inv);
    }
    if (bill) {
      sets.push('bukkubills = ?');
      vals.push(bill);
    }
    if (markPaid) {
      sets.push('paid = 1');
    }
    sets.push('updated_at = NOW()');
    vals.push(id);

    const sql = `UPDATE ownerpayout SET ${sets.join(', ')} WHERE id = ?`;

    if (dryRun) {
      console.log('[dry-run]', id, {
        bukkuinvoice: inv || '(unchanged)',
        bukkubills: bill || '(unchanged)',
        paid: markPaid ? 1 : '(unchanged)'
      });
      okRows += 1;
    } else {
      const [res] = await pool.query(sql, vals);
      if (res.affectedRows) {
        okRows += 1;
        console.log('OK', id, markPaid ? 'paid=1' : 'urls-only');
      } else {
        console.warn('No row updated (bad id?):', id);
      }
    }
  }

  console.log(
    dryRun
      ? `[dry-run] rows with URL updates: ${okRows}, skipped empty: ${skipped}, markPaid=${markPaid}`
      : `[import] updated: ${okRows}, skipped: ${skipped}, markPaid=${markPaid}`
  );

  if (!dryRun) await pool.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
