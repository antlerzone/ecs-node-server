/**
 * Daily cron: create refunddeposit for tenancies that have ended (end < today)
 * and were not renewed (no later tenancy same room+tenant), so admin can see and process in Admin Dashboard.
 * Idempotent: only inserts when no refunddeposit.tenancy_id = tenancy.id exists.
 */

const { randomUUID } = require('crypto');
const pool = require('../../config/db');
const { getTodayMalaysiaDate } = require('../../utils/dateMalaysia');

/**
 * Find tenancies that: end < today, deposit > 0, no renew (no other tenancy same room+tenant with begin > this end), no existing refunddeposit for this tenancy.
 * Insert one refunddeposit per such tenancy (amount = deposit, done = 0).
 * @returns {{ inserted: number, errors: Array<{ tenancyId: string, reason: string }> }}
 */
async function runRefundDepositForEndedTenancies() {
  const today = getTodayMalaysiaDate();
  const result = { inserted: 0, errors: [] };

  const [rows] = await pool.query(
    `SELECT t.id AS tenancy_id, t.tenant_id, t.room_id, t.client_id, t.deposit
     FROM tenancy t
     WHERE t.\`end\` < ?
       AND COALESCE(t.deposit, 0) > 0
       AND NOT EXISTS (
         SELECT 1 FROM tenancy t2
         WHERE t2.room_id = t.room_id AND t2.tenant_id = t.tenant_id AND t2.client_id = t.client_id
           AND t2.id != t.id AND t2.begin > t.\`end\`
       )
       AND NOT EXISTS (
         SELECT 1 FROM refunddeposit rd WHERE rd.tenancy_id = t.id
       )
     ORDER BY t.\`end\` ASC`,
    [today]
  );

  for (const t of rows || []) {
    try {
      const [roomRows] = await pool.query('SELECT title_fld FROM roomdetail WHERE id = ? LIMIT 1', [t.room_id]);
      const [tenantRows] = await pool.query('SELECT fullname FROM tenantdetail WHERE id = ? LIMIT 1', [t.tenant_id]);
      const roomTitle = roomRows[0] ? roomRows[0].title_fld : '';
      const tenantName = tenantRows[0] ? tenantRows[0].fullname : '';
      const id = randomUUID();
      await pool.query(
        `INSERT INTO refunddeposit (id, amount, roomtitle, tenantname, room_id, tenant_id, client_id, tenancy_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [id, t.deposit, roomTitle, tenantName, t.room_id, t.tenant_id, t.client_id, t.tenancy_id]
      );
      result.inserted += 1;
    } catch (err) {
      result.errors.push({ tenancyId: t.tenancy_id, reason: err?.message || String(err) });
    }
  }

  return result;
}

module.exports = {
  runRefundDepositForEndedTenancies
};
