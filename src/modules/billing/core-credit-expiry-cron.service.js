/**
 * Daily cron: clear expired core credit on their expiry date and write creditlogs.
 * Example: client had 500 core expiring 2月20, renewed 2月15 (+1800). On 2月20 we remove the 500 and insert creditlog "Core credit expired (2025-02-20)", amount -500.
 */

const pool = require('../../config/db');
const { randomUUID } = require('crypto');
const { getTodayMalaysiaDate } = require('../../utils/dateMalaysia');
const { syncSubtablesFromClientdetail } = require('../../services/client-subtables');
const { clearBillingCacheByClientId } = require('./billing.service');

function parseJson(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return null; }
}

/**
 * For each client with credit, remove core entries where expired <= today, sum removed amount, update DB, insert creditlog.
 * @returns {{ processed: number, expiredByClient: Array<{ clientId: string, amount: number, expiredDate: string }>, errors: Array<{ clientId: string, message: string }> }}
 */
async function runCoreCreditExpiryCheck() {
  const today = getTodayMalaysiaDate(); // 'YYYY-MM-DD'

  const [rows] = await pool.query(
    `SELECT id, credit FROM clientdetail WHERE credit IS NOT NULL AND TRIM(credit) != '' AND TRIM(credit) != '[]'`
  );

  const expiredByClient = [];
  const errors = [];

  for (const row of rows || []) {
    const clientId = row.id;
    const rawCredit = parseJson(row.credit);
    const creditList = Array.isArray(rawCredit) ? rawCredit.map((c) => ({ ...c })) : [];
    if (creditList.length === 0) continue;

    const toRemove = creditList.filter(
      (c) => c.type === 'core' && c.expired && String(c.expired).trim() && String(c.expired).trim().substring(0, 10) <= today
    );
    if (toRemove.length === 0) continue;

    const totalExpired = toRemove.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
    if (totalExpired <= 0) continue;

    const newCredit = creditList
      .filter(
        (c) =>
          c.type !== 'core' ||
          !c.expired ||
          String(c.expired).trim().substring(0, 10) > today ||
          (Number(c.amount) || 0) <= 0
      )
      .map((c) => ({ ...c, amount: Number(c.amount) || 0 }))
      .filter((c) => Number(c.amount) > 0 || c.type === 'flex');

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const logId = randomUUID();
    const refNum = `EXP-${logId}`;
    const expiredDates = [...new Set(toRemove.map((c) => String(c.expired).trim().substring(0, 10)))];
    const title = `Core credit expired (${today})`;
    const remark = `Expired date: ${expiredDates.join(', ')}. Amount: ${totalExpired} core credit expired.`;
    const payloadStr = JSON.stringify({ source: 'core_expiry_cron', expiredDates, totalExpired });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('UPDATE clientdetail SET credit = ?, updated_at = ? WHERE id = ?', [JSON.stringify(newCredit), now, clientId]);
      await syncSubtablesFromClientdetail(conn, clientId);
      await conn.query(
        `INSERT INTO creditlogs (id, title, type, amount, client_id, staff_id, reference_number, payload, remark, created_at, updated_at)
         VALUES (?, ?, 'Expired', ?, ?, NULL, ?, ?, ?, ?, ?)`,
        [logId, title, -totalExpired, clientId, refNum, payloadStr, remark, now, now]
      );
      await conn.commit();
      expiredByClient.push({ clientId, amount: totalExpired, expiredDate: today });
      clearBillingCacheByClientId(clientId);
      console.log('[cron] core credit expired', { client_id: clientId, amount: totalExpired, expiredDate: today });
    } catch (err) {
      await conn.rollback().catch(() => {});
      errors.push({ clientId, message: err?.message || String(err) });
    } finally {
      conn.release();
    }
  }

  return {
    processed: expiredByClient.length,
    expiredByClient,
    errors
  };
}

module.exports = {
  runCoreCreditExpiryCheck
};
