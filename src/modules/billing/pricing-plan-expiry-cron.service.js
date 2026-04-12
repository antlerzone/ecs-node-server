/**
 * Daily cron: check client pricing plan (subscription) expiry.
 * If operatordetail.expired (billing cycle end) is before today and client has not renewed,
 * set client status = 0 (inactive). Tenant can still pay; admin pages will no function (handled by permission/access elsewhere).
 */

const pool = require('../../config/db');
const { getTodayMalaysiaDate } = require('../../utils/dateMalaysia');

/**
 * Find all active clients whose plan expired (expired date < today) and set them inactive.
 * Uses operatordetail.expired (set on renew/upgrade via handlePricingPlanPaymentSuccess).
 * @returns {{ inactived: number, clientIds: string[] }}
 */
async function runPricingPlanExpiryCheck() {
  const today = getTodayMalaysiaDate(); // 'YYYY-MM-DD'

  const [rows] = await pool.query(
    `SELECT id FROM operatordetail
     WHERE status = 1 AND expired IS NOT NULL AND DATE(expired) < ?
     ORDER BY id`,
    [today]
  );

  const clientIds = (rows || []).map((r) => r.id).filter(Boolean);
  if (clientIds.length === 0) {
    return { inactived: 0, clientIds: [] };
  }

  const [result] = await pool.query(
    `UPDATE operatordetail SET status = 0, updated_at = NOW()
     WHERE status = 1 AND expired IS NOT NULL AND DATE(expired) < ?`,
    [today]
  );

  const inactived = result?.affectedRows ?? 0;
  if (inactived > 0) {
    console.log('[cron] pricing plan expiry: inactived clients', { count: inactived, clientIds: clientIds.slice(0, 20), today });
  }

  return { inactived, clientIds };
}

module.exports = {
  runPricingPlanExpiryCheck
};
