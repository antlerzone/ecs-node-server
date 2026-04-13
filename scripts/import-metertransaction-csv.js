#!/usr/bin/env node
/**
 * DELETE all metertransaction rows and import from Wix CSV.
 * Note: metertransaction has NO client_id column; operator scope is via property/tenant/tenancy FKs.
 * Target operatordetail.id is documented for your records (58f809ea-...).
 *
 * Usage:
 *   node scripts/import-metertransaction-csv.js [path/to/Meterransaction.csv] [operatordetail_id_note]
 *
 * Default CSV: cleanlemon/next-app/Wix cms/Meterransaction.csv
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const pool = require('../src/config/db');

const DEFAULT_CSV = path.join(__dirname, '../cleanlemon/next-app/Wix cms/Meterransaction.csv');
const DEFAULT_OPERATOR_ID = '58f809ea-c0af-4233-8b0d-66d0b15d000f';

function toMysqlDatetime(iso) {
  if (iso == null || String(iso).trim() === '') return null;
  const d = new Date(String(iso).trim());
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

function emptyToNull(v) {
  if (v == null) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
}

function parseBoolPaid(v) {
  if (v == null || String(v).trim() === '') return 0;
  const x = String(v).trim().toLowerCase();
  return x === 'true' || x === '1' ? 1 : 0;
}

function parseIntOrNull(v) {
  if (v == null || String(v).trim() === '') return null;
  const n = parseInt(String(v).trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function parseDecimalOrNull(v) {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const csvPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_CSV;
  const operatorIdNote = process.argv[3] || DEFAULT_OPERATOR_ID;

  if (!fs.existsSync(csvPath)) {
    console.error('CSV not found:', csvPath);
    process.exit(1);
  }

  const raw = fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '');
  const rows = parse(raw, { columns: true, skip_empty_lines: true, relax_quotes: true });

  const conn = await pool.getConnection();
  let inserted = 0;
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS=0');
    await conn.query('DELETE FROM metertransaction');

    const sql = `
      INSERT INTO metertransaction (
        id, tenant_id, tenancy_id, property_id, meter, meteridx,
        invoiceid, referenceid, bukku_invoice_id, amount, ispaid, failreason, status,
        invoiceurl, accounting_document_number, receipturl,
        created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `;

    for (const r of rows) {
      const id = emptyToNull(r.ID);
      if (!id) continue;

      const invoiceid = emptyToNull(r.Invoiceid);
      const accountingDocumentNumber =
        invoiceid && /^IV-/i.test(String(invoiceid)) ? String(invoiceid).trim() : null;

      const vals = [
        id,
        emptyToNull(r.Tenant),
        emptyToNull(r.Tenancy),
        emptyToNull(r.property),
        emptyToNull(r.Meter),
        parseIntOrNull(r.Meteridx) != null ? parseIntOrNull(r.Meteridx) : null,
        invoiceid,
        emptyToNull(r.Referenceid),
        parseIntOrNull(r.Bukku_invoice_id),
        parseDecimalOrNull(r.Amount),
        parseBoolPaid(r.Ispaid),
        emptyToNull(r.Failreason),
        emptyToNull(r.Status),
        emptyToNull(r.Invoiceurl),
        accountingDocumentNumber,
        null,
        toMysqlDatetime(r['Created Date']) || new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ''),
        toMysqlDatetime(r['Updated Date']) || new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '')
      ];

      await conn.query(sql, vals);
      inserted += 1;
    }

    console.log(
      'OK: metertransaction cleared and imported',
      inserted,
      'rows. (Table has no client_id; operatordetail scope note:',
      operatorIdNote + ')'
    );
  } catch (e) {
    console.error('Import failed:', e.message || e);
    if (e.sqlMessage) console.error('SQL:', e.sqlMessage);
    process.exitCode = 1;
  } finally {
    try {
      await conn.query('SET FOREIGN_KEY_CHECKS=1');
    } catch (_) {}
    conn.release();
    try {
      await pool.end();
    } catch (_) {}
  }
}

main();
