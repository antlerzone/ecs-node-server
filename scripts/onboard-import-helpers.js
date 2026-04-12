/**
 * Coliving onboard 1.0：import 脚本共用（固定 operator、忽略 Owner、Bukku account JSON）
 * 环境变量 ONBOARD_OPERATOR_ID 可覆盖默认 operatordetail.id。
 */
const ONBOARD_OPERATOR_ID =
  process.env.ONBOARD_OPERATOR_ID || '58f809ea-c0af-4233-8b0d-66d0b15d000f';

function skipCsvColumn(trimmedHeader) {
  return String(trimmedHeader || '')
    .trim()
    .toLowerCase() === 'owner';
}

/**
 * CSV contact_id → account 列 JSON（Bukku）
 */
function bukkuAccountFromContactId(contactIdRaw, operatorId = ONBOARD_OPERATOR_ID) {
  if (contactIdRaw == null || contactIdRaw === '') return null;
  const s = String(contactIdRaw).trim();
  if (!s) return null;
  const n = parseInt(s, 10);
  const idVal = !Number.isNaN(n) && String(n) === s ? n : s;
  return JSON.stringify([{ clientId: operatorId, provider: 'bukku', id: idVal }]);
}

module.exports = {
  ONBOARD_OPERATOR_ID,
  skipCsvColumn,
  bukkuAccountFromContactId,
};
