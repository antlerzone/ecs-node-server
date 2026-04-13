#!/usr/bin/env node
/**
 * Truncate rentalcollection and import from Wix-export CSV.
 * Usage:
 *   node scripts/import-rentalcollection-csv.js [path/to/RentalCollection.csv] [client_id]
 * Defaults: cleanlemon/next-app/Wix cms/RentalCollection.csv, 58f809ea-c0af-4233-8b0d-66d0b15d000f
 *
 * Sets client_id on every row to operatordetail.id (FK column still named client_id).
 * Disables FOREIGN_KEY_CHECKS during delete/insert so orphan FKs from CSV do not block load.
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const pool = require('../src/config/db');

const DEFAULT_CSV = path.join(
  __dirname,
  '../cleanlemon/next-app/Wix cms/RentalCollection.csv'
);
const DEFAULT_CLIENT_ID = '58f809ea-c0af-4233-8b0d-66d0b15d000f';

/** Wix CMS account _id → resolve to our account.id using title when one Wix id meant multiple products. */
function resolveRentalTypeId(wixTypeUuid, title, accByNormTitle) {
  const t = String(title || '');
  const w = String(wixTypeUuid || '').trim().toLowerCase();
  const A = (key) => accByNormTitle[key] || null;

  if (w === '86da59c0-992c-4e40-8efd-9d6d793eaf6a') return A('owner commission') || wixTypeUuid;
  if (w === '94b4e060-3999-4c76-8189-f969615c0a7d') return A('tenant commission') || wixTypeUuid;

  if (w === '3411c69c-bfec-4d35-a6b9-27929f9d5bf6') return A('agreement fees');

  if (w === 'd3f72d51-c791-4ef0-aeec-3ed1134e5c86') {
    if (/forfeit/i.test(t)) return A('forfeit deposit');
    return A('deposit');
  }

  if (w === 'bf502145-6ec8-45bd-a703-13c810cfe186') {
    if (/owner\s*com(ission|ission)/i.test(t)) return A('owner commission');
    return A('other');
  }

  if (w === 'cf4141b1-c24e-4fc1-930e-cfea4329b178') {
    if (/tenant\s*com(ission|ission)/i.test(t)) return A('tenant commission');
    return A('rental income');
  }

  if (w === '1c7e41b6-9d57-4c03-8122-a76baad3b592') return A('forfeit deposit');

  if (w === 'ae94f899-7f34-4aba-b6ee-39b97496e2a3') {
    if (/maintain|management/i.test(t)) return A('management fees');
    return A('rental income');
  }

  return wixTypeUuid;
}

function toMysqlDatetime(iso) {
  if (iso == null || String(iso).trim() === '') return null;
  const s = String(iso).trim();
  const d = new Date(s);
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
  const clientId = process.argv[3] || DEFAULT_CLIENT_ID;

  if (!fs.existsSync(csvPath)) {
    console.error('CSV not found:', csvPath);
    process.exit(1);
  }

  const raw = fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '');
  const rows = parse(raw, { columns: true, skip_empty_lines: true, relax_quotes: true });

  const conn = await pool.getConnection();
  let inserted = 0;
  try {
    const [acctRows] = await conn.query(
      `SELECT a.id, TRIM(a.title) AS title
         FROM account a
         INNER JOIN account_client ac ON ac.account_id = a.id AND ac.client_id = ?
        ORDER BY a.title`,
      [clientId]
    );
    const accByNormTitle = {};
    for (const row of acctRows || []) {
      const k = String(row.title || '')
        .trim()
        .toLowerCase();
      if (k) accByNormTitle[k] = row.id;
    }

    await conn.query('SET FOREIGN_KEY_CHECKS=0');
    await conn.query('DELETE FROM rentalcollection');

    const sql = `
      INSERT INTO rentalcollection (
        id, client_id, property_id, room_id, tenant_id, tenancy_id, type_id,
        invoiceid, paidat, referenceid, description, accountid, bukku_invoice_id,
        amount, ispaid, date, receipturl, productid, invoiceurl,
        accounting_document_number, title,
        created_at, updated_at, accounting_invoice_voided
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `;

    for (const r of rows) {
      const id = emptyToNull(r.ID || r['ID']);
      if (!id) continue;

      const owner = emptyToNull(r['Owner']);
      const description = owner ? `Wix Owner: ${owner}` : null;

      const invoiceid = emptyToNull(r['invoiceid']);
      const accountingDocumentNumber =
        invoiceid && /^IV-/i.test(String(invoiceid)) ? String(invoiceid).trim() : null;

      const titleRaw = emptyToNull(r['title']) != null ? String(r['title']) : '';
      const wixType = emptyToNull(r['type']);
      const typeId = wixType
        ? resolveRentalTypeId(wixType, titleRaw, accByNormTitle)
        : null;

      const vals = [
        id,
        clientId,
        emptyToNull(r['property']),
        emptyToNull(r['room']),
        emptyToNull(r['tenant']),
        emptyToNull(r['tenancy']),
        typeId,
        invoiceid,
        toMysqlDatetime(r['Paidat']),
        emptyToNull(r['referenceid']),
        description,
        parseIntOrNull(r['Accountid']),
        emptyToNull(r['Bukku_invoice_id']) != null ? String(r['Bukku_invoice_id']).trim() : null,
        parseDecimalOrNull(r['amount']),
        parseBoolPaid(r['isPaid']),
        toMysqlDatetime(r['Date']),
        emptyToNull(r['receipturl']),
        parseIntOrNull(r['Productid']),
        emptyToNull(r['invoiceurl']),
        accountingDocumentNumber,
        emptyToNull(r['title']) != null ? String(r['title']).slice(0, 255) : null,
        toMysqlDatetime(r['Created Date']) || new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ''),
        toMysqlDatetime(r['Updated Date']) || new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ''),
        0
      ];

      await conn.query(sql, vals);
      inserted += 1;
    }

    console.log('OK: rentalcollection cleared and imported', inserted, 'rows; client_id=', clientId);
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
