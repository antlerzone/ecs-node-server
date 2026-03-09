/**
 * Get client contact (tel) for CNYIoT from client_profile.
 * Returns digits-only string; throws if not found.
 */

const pool = require('../../../config/db');

async function getClientTel(clientId) {
  const [rows] = await pool.query(
    'SELECT contact FROM client_profile WHERE client_id = ? LIMIT 1',
    [clientId]
  );
  const tel = rows[0]?.contact;
  if (!tel) throw new Error('CLIENT_TEL_NOT_FOUND');
  return String(tel).replace(/\D/g, '');
}

module.exports = { getClientTel };
