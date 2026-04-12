/**
 * Operator flag operatordetail.admin.tenantRentAutoDebitOffered:
 * when false, tenant portal must not offer cron auto-debit; cron must not charge even if profile still has opt-in.
 */

const pool = require('../../config/db');

function parseJson(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

/**
 * @param {string} clientId
 * @param {Map<string, boolean>} [cache] - per-run dedupe (same client many rows)
 * @returns {Promise<boolean>}
 */
async function isTenantRentAutoDebitOfferedForClient(clientId, cache) {
  if (!clientId) return true;
  if (cache && cache.has(clientId)) return cache.get(clientId);
  const [rows] = await pool.query('SELECT admin FROM operatordetail WHERE id = ? LIMIT 1', [clientId]);
  if (!rows.length) {
    if (cache) cache.set(clientId, true);
    return true;
  }
  let admin = parseJson(rows[0].admin);
  if (Array.isArray(admin) && admin.length > 0) admin = admin[0];
  const offered = !(admin && admin.tenantRentAutoDebitOffered === false);
  if (cache) cache.set(clientId, offered);
  return offered;
}

module.exports = { isTenantRentAutoDebitOfferedForClient };
