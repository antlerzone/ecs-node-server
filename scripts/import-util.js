/**
 * Import 脚本共用：0087 后 id 规则
 * - Import：CSV _id 直接作为 id，不生成
 * - 新 item（API/UI）：才用 randomUUID()
 */

const { randomUUID } = require('crypto');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 从 row 取 id：优先用 CSV 的 _id/id，无则生成
 * @param {Object} row - 解析后的行
 * @param {Set} usedIds - 已用 id 集合
 * @returns {string} id
 */
function resolveId(row, usedIds) {
  const csvId = (row.id || row._id || '').trim();
  if (csvId && UUID_REGEX.test(csvId) && !usedIds.has(csvId)) {
    usedIds.add(csvId);
    return csvId;
  }
  let uid;
  do { uid = randomUUID(); } while (usedIds.has(uid));
  usedIds.add(uid);
  return uid;
}

module.exports = { resolveId, UUID_REGEX };
