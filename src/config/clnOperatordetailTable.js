const pool = require('./db');

/** @type {string|null} */
let cache = null;

/**
 * Cleanlemons company master table (Wix CSV / portal operator row).
 * Prefer `cln_operatordetail` after migration 0198; else legacy `cln_operator` / `cln_client`.
 */
async function resolveClnOperatordetailTable() {
  if (cache) return cache;
  const [[cnt]] = await pool.query(
    `SELECT
      SUM(CASE WHEN table_name = 'cln_operatordetail' THEN 1 ELSE 0 END) AS has_od,
      SUM(CASE WHEN table_name = 'cln_operator' THEN 1 ELSE 0 END) AS has_op,
      SUM(CASE WHEN table_name = 'cln_client' THEN 1 ELSE 0 END) AS has_cl
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name IN ('cln_operatordetail', 'cln_operator', 'cln_client')`
  );
  if (Number(cnt?.has_od) > 0) {
    cache = 'cln_operatordetail';
  } else if (Number(cnt?.has_op) > 0) {
    cache = 'cln_operator';
  } else if (Number(cnt?.has_cl) > 0) {
    cache = 'cln_client';
  } else {
    cache = 'cln_operator';
  }
  return cache;
}

function clearClnOperatordetailTableCache() {
  cache = null;
}

module.exports = {
  resolveClnOperatordetailTable,
  clearClnOperatordetailTableCache,
};
