/**
 * Owner agreement – 多页面共用的业主协议生成/更新服务。
 * 用于 Property Setting、Owner Portal 等；支持已有 agreement 时再次生成/更新（每年 renew）。
 * 后期可在此处加入 deduct credit 逻辑。
 */

const { randomUUID } = require('crypto');
const pool = require('../../config/db');

/**
 * Bind property to owner, optionally create agreement (manual URL or system template).
 * type optional: when omitted, only bind property & owner (propertydetail.owner_id + owner_client/owner_property).
 * @param {string} clientId
 * @param {string} propertyId
 * @param {object} payload - { ownerId, type?: 'manual'|'system', templateId?, url?, staffId? }
 * @returns {Promise<{ ok: boolean }>}
 */
async function saveOwnerAgreement(clientId, propertyId, payload) {
  if (!propertyId || !payload.ownerId) throw new Error('MISSING_PROPERTY_OR_OWNER');
  const { ownerId, type, templateId, url } = payload;

  const [propRows] = await pool.query(
    'SELECT id, owner_id, signagreement FROM propertydetail WHERE id = ? AND client_id = ?',
    [propertyId, clientId]
  );
  if (!propRows || !propRows.length) throw new Error('PROPERTY_NOT_FOUND');

  // TODO: 后期可在此 deduct credit（如按次扣费）
  // await deductCredit(clientId, { type: 'owner_agreement', propertyId, staffId: payload.staffId });

  let setClause = 'owner_id = ?';
  const setParams = [ownerId];

  if (type === 'manual') {
    const agreementUrl = (url || '').trim();
    if (!agreementUrl) throw new Error('AGREEMENT_URL_REQUIRED');
    const agreementId = randomUUID();
    await pool.query(
      `INSERT INTO agreement (id, client_id, property_id, owner_id, mode, url, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'owner_operator', ?, 'completed', NOW(), NOW())`,
      [agreementId, clientId, propertyId, ownerId, agreementUrl]
    );
    setClause += ', signagreement = ?';
    setParams.push(agreementUrl);
  } else if (type === 'system' && templateId) {
    const agreementId = randomUUID();
    await pool.query(
      `INSERT INTO agreement (id, client_id, property_id, owner_id, agreementtemplate_id, mode, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'owner_operator', 'pending', NOW(), NOW())`,
      [agreementId, clientId, propertyId, ownerId, templateId]
    );
  }

  await pool.query(
    `UPDATE propertydetail SET ${setClause}, updated_at = NOW() WHERE id = ? AND client_id = ?`,
    [...setParams, propertyId, clientId]
  );

  // Keep owner_client / owner_property in sync so Owner Portal and list see the link
  try {
    await pool.query(
      'INSERT IGNORE INTO owner_client (id, client_id, owner_id, created_at) VALUES (UUID(), ?, ?, NOW())',
      [clientId, ownerId]
    );
    await pool.query(
      'INSERT IGNORE INTO owner_property (id, owner_id, property_id, created_at) VALUES (UUID(), ?, ?, NOW())',
      [ownerId, propertyId]
    );
  } catch (_) {
    // junction tables may not exist
  }
  return { ok: true };
}

module.exports = {
  saveOwnerAgreement
};
