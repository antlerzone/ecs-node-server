/**
 * Demo account daily refresh: update tenancy begin/end to "today"-relative so demo items stay up-to-date.
 * Run from POST /api/cron/daily. For each client with client_profile.is_demo = 1:
 * - Tenancy 1: begin = today - 3 months, end = today + 6 months (active demo).
 * - Tenancy 2: begin = today - 12 months, end = today - 14 days (ended, for refund demo).
 * - client_credit.amount = 99999, operatordetail.expired = 2099, client_pricingplan_detail.expired = 2099.
 * - staffdetail: keep only master (operatordetail.email), remove others.
 *
 * So after demo users consume items (e.g. sign agreement, pay), the next day cron restores default state and dates.
 */

const pool = require('../../config/db');
const { getTodayMalaysiaDate, malaysiaDateToUtcDatetimeForDb } = require('../../utils/dateMalaysia');

const EXPIRED_FAR = '2099-12-31 00:00:00';

function addMonths(ymd, months) {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setMonth(date.getMonth() + months);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function addDays(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * @returns {Promise<{ updated: number; clientIds: string[]; errors: string[] }>}
 */
async function runDemoAccountRefresh() {
  const clientIds = [];
  const errors = [];
  let updated = 0;

  const [demoRows] = await pool.query(
    'SELECT client_id FROM client_profile WHERE is_demo = 1'
  );
  if (!demoRows.length) {
    return { updated: 0, clientIds: [], errors: [] };
  }

  const today = getTodayMalaysiaDate();
  const t1Begin = addMonths(today, -3);
  const t1End = addMonths(today, 6);
  const t2End = addDays(today, -14);
  const t2Begin = addMonths(t2End, -12);
  const t1BeginDb = malaysiaDateToUtcDatetimeForDb(t1Begin);
  const t1EndDb = malaysiaDateToUtcDatetimeForDb(t1End);
  const t2BeginDb = malaysiaDateToUtcDatetimeForDb(t2Begin);
  const t2EndDb = malaysiaDateToUtcDatetimeForDb(t2End);

  for (const row of demoRows) {
    const clientId = row.client_id;
    clientIds.push(clientId);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // 1) Tenancy dates: first two tenancies by id – first = active, second = ended
      const [tenancyRows] = await conn.query(
        'SELECT id FROM tenancy WHERE client_id = ? ORDER BY id LIMIT 2',
        [clientId]
      );
      if (tenancyRows.length >= 1) {
        await conn.query(
          'UPDATE tenancy SET begin = ?, `end` = ?, updated_at = NOW() WHERE id = ?',
          [t1BeginDb, t1EndDb, tenancyRows[0].id]
        );
        updated++;
      }
      if (tenancyRows.length >= 2) {
        await conn.query(
          'UPDATE tenancy SET begin = ?, `end` = ?, updated_at = NOW() WHERE id = ?',
          [t2BeginDb, t2EndDb, tenancyRows[1].id]
        );
        updated++;
      }

      // 2) client_credit (default high for demo so operator/owner/tenant don't need to top up)
      await conn.query(
        'UPDATE client_credit SET amount = 99999, updated_at = NOW() WHERE client_id = ?',
        [clientId]
      );

      // 3) operatordetail.expired
      await conn.query(
        'UPDATE operatordetail SET expired = ?, updated_at = NOW() WHERE id = ?',
        [EXPIRED_FAR, clientId]
      );

      // 4) client_pricingplan_detail.expired
      await conn.query(
        'UPDATE client_pricingplan_detail SET expired = ?, updated_at = NOW() WHERE client_id = ? AND type = ?',
        [EXPIRED_FAR, clientId, 'plan']
      );

      // 5) Master email: from operatordetail or first staff with is_master=1
      const [clientRows] = await conn.query(
        'SELECT email FROM operatordetail WHERE id = ? LIMIT 1',
        [clientId]
      );
      let masterEmail = (clientRows[0] && clientRows[0].email) ? clientRows[0].email.trim().toLowerCase() : null;
      if (!masterEmail) {
        const [staffRows] = await conn.query(
          'SELECT email FROM staffdetail WHERE client_id = ? ORDER BY id LIMIT 1',
          [clientId]
        );
        masterEmail = (staffRows[0] && staffRows[0].email) ? staffRows[0].email.trim().toLowerCase() : null;
      }
      if (masterEmail) {
        await conn.query(
          "DELETE FROM staffdetail WHERE client_id = ? AND LOWER(TRIM(email)) != ?",
          [clientId, masterEmail]
        );
        await conn.query(
          "UPDATE staffdetail SET permission_json = '[\"admin\"]', status = 1, updated_at = NOW() WHERE client_id = ?",
          [clientId]
        );
        try {
          await conn.query(
            'UPDATE staffdetail SET is_master = 1 WHERE client_id = ?',
            [clientId]
          );
        } catch (e) {
          if (e.code !== 'ER_BAD_FIELD_ERROR') throw e;
        }
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      errors.push(`${clientId}: ${err?.message || err}`);
    } finally {
      conn.release();
    }
  }

  return { updated, clientIds, errors };
}

module.exports = { runDemoAccountRefresh };
