const pool = require('../../../config/db');
const { resolveClnOperatordetailTable } = require('../../../config/clnOperatordetailTable');

function normalizeIso4217(raw) {
  const s = String(raw || '').trim().toUpperCase();
  if (!s) return '';
  const three = s.slice(0, 3);
  return /^[A-Z]{3}$/.test(three) ? three : '';
}

/** Coliving: `operatordetail.id` = client_id. Default MYR when missing/invalid. */
async function getXeroInvoiceCurrencyForClientId(clientId) {
  if (!clientId) return 'MYR';
  try {
    const [rows] = await pool.query('SELECT currency FROM operatordetail WHERE id = ? LIMIT 1', [clientId]);
    const c = normalizeIso4217(rows[0]?.currency);
    return c || 'MYR';
  } catch {
    return 'MYR';
  }
}

/** Cleanlemons: `cln_operatordetail.id` = operator id. Default MYR when missing/invalid. */
async function getXeroInvoiceCurrencyForClnOperatorId(operatorId) {
  if (!operatorId) return 'MYR';
  try {
    const t = await resolveClnOperatordetailTable();
    const [rows] = await pool.query(`SELECT currency FROM \`${t}\` WHERE id = ? LIMIT 1`, [String(operatorId)]);
    const c = normalizeIso4217(rows[0]?.currency);
    return c || 'MYR';
  } catch {
    return 'MYR';
  }
}

module.exports = {
  normalizeIso4217,
  getXeroInvoiceCurrencyForClientId,
  getXeroInvoiceCurrencyForClnOperatorId
};
