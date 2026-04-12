/**
 * One-off: for each operatordetail, take the **newest** pending SAAS_BILLPLZ log, check Xendit PAID, finalize once.
 * Avoids running finalize on older attempts (would stack core credits).
 * Use when webhooks could not run (e.g. XENDIT_SAAS_PLATFORM_CALLBACK_TOKEN missing in .env).
 *
 *   node scripts/sync-saas-enquiry-xendit-pending.js
 *   node scripts/sync-saas-enquiry-xendit-pending.js --client-id=<operatordetail.uuid>
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../src/config/db');
const { getTodayMalaysiaDate } = require('../src/utils/dateMalaysia');
const { finalizeSaasPlanAfterBillplzPayment } = require('../src/modules/billing/indoor-admin.service');
const { fetchXenditInvoiceV2ById } = require('../src/modules/billing/xendit-saas-platform.service');

function argVal(name) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.slice(name.length + 3).trim() : '';
}

async function main() {
  const clientFilter = argVal('client-id');
  let sql = `
    SELECT p.id, p.client_id, p.status, p.amount, p.payload_json
    FROM pricingplanlogs p
    INNER JOIN (
      SELECT client_id, MAX(created_at) AS max_created
      FROM pricingplanlogs
      WHERE scenario = 'SAAS_BILLPLZ' AND LOWER(TRIM(status)) = 'pending'
      GROUP BY client_id
    ) t ON t.client_id = p.client_id AND p.created_at = t.max_created
    WHERE p.scenario = 'SAAS_BILLPLZ' AND LOWER(TRIM(p.status)) = 'pending'
  `;
  const params = [];
  if (clientFilter) {
    sql += ' AND p.client_id = ?';
    params.push(clientFilter);
  }
  const [rows] = await pool.query(sql, params);
  console.log('[sync-saas-enquiry] newest pending per client:', rows.length);
  let fixed = 0;
  for (const row of rows) {
    let payload = {};
    try {
      payload = typeof row.payload_json === 'string' ? JSON.parse(row.payload_json || '{}') : row.payload_json || {};
    } catch (_) {
      payload = {};
    }
    const invId = String(payload.xendit_invoice_id || payload.xendit_payment_request_id || '').trim();
    if (!invId) {
      console.log('[skip] no invoice id on log', row.id);
      continue;
    }
    const inv = await fetchXenditInvoiceV2ById(invId);
    if (!inv.ok) {
      console.log('[skip] xendit fetch failed', row.id, inv.reason);
      continue;
    }
    const st = String(inv.data?.status || '').toUpperCase();
    if (st !== 'PAID') {
      console.log('[skip] not PAID', row.id, invId, st);
      continue;
    }
    console.log('[finalize]', row.id, 'client', row.client_id, invId);
    const fin = await finalizeSaasPlanAfterBillplzPayment({
      pricingplanlogId: row.id,
      paidDateStr: getTodayMalaysiaDate(),
      paymentMethodLabel: 'Xendit'
    });
    console.log('[finalize] result', row.id, fin?.ok, fin?.reason || '');
    if (fin?.ok !== false) fixed += 1;
  }
  console.log('[sync-saas-enquiry] done. finalized:', fixed);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
