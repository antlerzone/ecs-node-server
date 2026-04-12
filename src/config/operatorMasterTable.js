/**
 * Coliving core operator company master table.
 * Migration 0181 renames legacy `clientdetail` → `operatordetail`; runtime always uses `operatordetail` only.
 */
const pool = require('./db');

let _cache = null;

const OPERATOR_MASTER_TABLE = 'operatordetail';

/**
 * @returns {Promise<string>} always `operatordetail`
 */
async function getOperatorMasterTableName() {
  if (_cache) return _cache;
  try {
    const [[row]] = await pool.query(
      `SELECT COUNT(*) AS c FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = ?`,
      [OPERATOR_MASTER_TABLE]
    );
    if (Number(row?.c || 0) === 0) {
      console.error(
        `[operatorMasterTable] Missing table \`${OPERATOR_MASTER_TABLE}\` — check DB_NAME / migrations (0181_rename_clientdetail_to_operatordetail.sql)`
      );
    } else {
      console.log('[operatorMasterTable] Using `%s`', OPERATOR_MASTER_TABLE);
    }
  } catch (err) {
    console.warn('[operatorMasterTable] information_schema lookup failed:', err?.message || err);
  }
  _cache = OPERATOR_MASTER_TABLE;
  return _cache;
}

function resetOperatorMasterTableCacheForTests() {
  _cache = null;
}

module.exports = { getOperatorMasterTableName, resetOperatorMasterTableCacheForTests };
