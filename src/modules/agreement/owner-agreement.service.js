/**
 * Owner agreement – 多页面共用的业主协议生成/更新服务。
 * 用于 Property Setting、Owner Portal 等；支持已有 agreement 时再次生成/更新（每年 renew）。
 * 后期可在此处加入 deduct credit 逻辑。
 */

const { randomUUID } = require('crypto');
const pool = require('../../config/db');
const { tryPrepareDraftForAgreement } = require('./agreement.service');
const { deductClientCreditSpending } = require('../billing/deduction.service');

function parseJson(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  if (typeof val !== 'string') return null;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

/** Credits per generated agreement from operatordetail.admin.agreementCreationCredits; default 10. */
function getAgreementCreationCreditAmount(adminJson) {
  const admin = parseJson(adminJson);
  if (!admin || typeof admin !== 'object') return 10;
  const n = Number(admin.agreementCreationCredits);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 10;
}

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
    const [cRows] = await pool.query('SELECT admin FROM operatordetail WHERE id = ? LIMIT 1', [clientId]);
    const creditAmount = getAgreementCreationCreditAmount(cRows[0]?.admin);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      if (creditAmount > 0) {
        await deductClientCreditSpending(
          clientId,
          creditAmount,
          'Owner agreement creation',
          payload.staffId != null ? payload.staffId : null,
          { propertyId, ownerId, templateId: String(templateId).trim(), mode: 'owner_operator', agreementId },
          conn
        );
      }
      await conn.query(
        `INSERT INTO agreement (id, client_id, property_id, owner_id, agreementtemplate_id, mode, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'owner_operator', 'pending', NOW(), NOW())`,
        [agreementId, clientId, propertyId, ownerId, templateId]
      );
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
    // Align with tenancy flow: create draft PDF immediately so operator can sign from Agreements page.
    try {
      await tryPrepareDraftForAgreement(agreementId);
    } catch (e) {
      // Keep owner binding success even if draft preparation fails (e.g. Google quota/profile incomplete).
      console.warn('[owner-agreement] tryPrepareDraftForAgreement failed:', agreementId, e?.message || e);
    }
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
