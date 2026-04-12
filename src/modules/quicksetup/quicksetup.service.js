/**
 * Quick Setup wizard – rollback when "Confirm & complete onboarding" fails partway.
 * Deletes meters (CNYIOT + DB via deleteMeter), then roomdetail, then propertydetail rows for this client.
 */

const pool = require('../../config/db');
const { deleteMeter } = require('../metersetting/metersetting.service');

/**
 * Best-effort cleanup so no partial onboarding remains after a failed handleComplete.
 * @param {string} clientId
 * @param {{ propertyId?: string, roomIds?: string[], meterIds?: string[] }} payload
 */
async function rollbackQuickSetupOnboardingFailure(clientId, { propertyId, roomIds = [], meterIds = [] }) {
  if (!clientId) return { ok: false, reason: 'NO_CLIENT' };
  const meterErrors = [];
  for (const mid of meterIds) {
    if (!mid) continue;
    try {
      await deleteMeter(clientId, mid);
    } catch (err) {
      console.error('[quicksetup rollback] deleteMeter failed id=%s', mid, err?.message || err);
      meterErrors.push({ id: mid, message: err?.message || String(err) });
    }
  }
  const ids = (roomIds || []).filter(Boolean);
  if (ids.length > 0) {
    const ph = ids.map(() => '?').join(',');
    await pool.query(`DELETE FROM roomdetail WHERE client_id = ? AND id IN (${ph})`, [clientId, ...ids]);
  }
  if (propertyId) {
    await pool.query('DELETE FROM propertydetail WHERE id = ? AND client_id = ?', [propertyId, clientId]);
  }
  return { ok: true, meterErrors: meterErrors.length ? meterErrors : undefined };
}

module.exports = { rollbackQuickSetupOnboardingFailure };
