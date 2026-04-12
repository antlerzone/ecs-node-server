/**
 * Terms & Conditions – SaaS–Operator agreement: get content, acceptance status, sign with hash.
 * Signature hash = SHA256(acceptanceId + signature + signed_at + content_hash) for non-repudiation.
 */

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const pool = require('../../config/db');

const DOCUMENT_TYPE_SAAS_OPERATOR = 'saas_operator';
const VERSION_SAAS_OPERATOR = '1.0';

/** Path to SaaS–Operator T&C markdown (from project root). */
function getSaasOperatorTermsPath() {
  return path.join(__dirname, '../../../docs/terms/saas-operator-terms-v1.md');
}

/**
 * Get raw T&C content and content hash for saas_operator. Uses UTF-8.
 * @returns {{ content: string, contentHash: string, version: string }}
 */
function getSaasOperatorTermsContent() {
  const filePath = getSaasOperatorTermsPath();
  let content = '';
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    console.error('[terms] Failed to read saas-operator terms file', e?.message || e);
  }
  const contentHash = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  return { content, contentHash, version: VERSION_SAAS_OPERATOR };
}

/**
 * Get SaaS–Operator terms for client or api_user: content, version, contentHash, and whether they have signed.
 * When clientId is null, if apiUserId is provided we look up acceptance by api_user_id; otherwise accepted: false.
 * @param {string|null|undefined} clientId
 * @param {string|null|undefined} apiUserId - when no client (e.g. SaaS admin), use this to check acceptance
 * @returns {Promise<{ ok: boolean, content?: string, version?: string, contentHash?: string, accepted?: boolean, acceptedAt?: string, signatureHash?: string, noClient?: boolean, reason?: string }>}
 */
async function getTermsSaasOperator(clientId, apiUserId) {
  const { content, contentHash, version } = getSaasOperatorTermsContent();
  if (!clientId && !apiUserId) {
    return { ok: true, content, version, contentHash, accepted: false, acceptedAt: null, signatureHash: null, noClient: true };
  }

  let rows = [];
  try {
    if (clientId) {
      const [r] = await pool.query(
        `SELECT id, signed_at, signature_hash FROM terms_acceptance
         WHERE client_id = ? AND document_type = ? LIMIT 1`,
        [clientId, DOCUMENT_TYPE_SAAS_OPERATOR]
      );
      rows = r || [];
    } else if (apiUserId) {
      const [r] = await pool.query(
        `SELECT id, signed_at, signature_hash FROM terms_acceptance
         WHERE api_user_id = ? AND document_type = ? LIMIT 1`,
        [apiUserId, DOCUMENT_TYPE_SAAS_OPERATOR]
      );
      rows = r || [];
    }
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') {
      const dbName = process.env.DB_NAME || '(not set)';
      const dbHost = process.env.DB_HOST || '(not set)';
      console.error('[terms] Table terms_acceptance missing. Run migration 0102_terms_acceptance.sql. App is using DB_NAME=', dbName, 'DB_HOST=', dbHost);
      return { ok: false, reason: 'TERMS_TABLE_MISSING', message: 'Run migration 0102_terms_acceptance.sql' };
    }
    // Migration 0115 not run yet: api_user_id column missing → treat as no acceptance
    if (e.code === 'ER_BAD_FIELD_ERROR' && apiUserId && String(e.message || '').includes('api_user_id')) {
      console.warn('[terms] getTermsSaasOperator: api_user_id column missing (run migration 0115?), returning accepted: false');
      return { ok: true, content, version, contentHash, accepted: false, acceptedAt: null, signatureHash: null, noClient: true };
    }
    console.error('[terms] getTermsSaasOperator', e?.message || e);
    return { ok: false, reason: 'DB_ERROR', message: e?.message };
  }

  const row = rows[0];
  const accepted = !!row;
  const acceptedAt = row?.signed_at ? (row.signed_at instanceof Date ? row.signed_at.toISOString() : String(row.signed_at)) : null;
  const signatureHash = row?.signature_hash || null;

  return {
    ok: true,
    content,
    version,
    contentHash,
    accepted,
    acceptedAt,
    signatureHash
  };
}

/**
 * Sign SaaS–Operator terms. Records signature and signature_hash for audit.
 * Either clientId or apiUserId must be set (when operator has no client, use apiUserId).
 * signature_hash = SHA256(acceptanceId + signature + signed_at_iso + content_hash).
 * @param {string|null} clientId
 * @param {string|null} apiUserId - when no client (e.g. SaaS admin), use this to store acceptance
 * @param {{ signature: string }} payload
 * @param {string} [signedIp]
 * @returns {Promise<{ ok: boolean, signatureHash?: string, reason?: string }>}
 */
async function signTermsSaasOperator(clientId, apiUserId, payload, signedIp) {
  console.log('[terms.service signTermsSaasOperator] entry clientId=', clientId ?? '(null)', 'apiUserId=', apiUserId ?? '(null)', 'hasSignature=', !!(payload?.signature != null && String(payload.signature).trim()));
  if (!clientId && !apiUserId) {
    console.log('[terms.service signTermsSaasOperator] return MISSING_CLIENT_OR_API_USER');
    return { ok: false, reason: 'MISSING_CLIENT_ID' };
  }
  const signature = payload?.signature != null ? String(payload.signature).trim() : '';
  if (!signature) {
    console.log('[terms.service signTermsSaasOperator] return SIGNATURE_REQUIRED');
    return { ok: false, reason: 'SIGNATURE_REQUIRED' };
  }

  const { contentHash, version } = getSaasOperatorTermsContent();
  const signedAt = new Date();
  const signedAtStr = signedAt.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  const ip = signedIp != null ? String(signedIp).trim().slice(0, 45) : null;

  const byClient = !!clientId;
  let existing = [];
  try {
    if (byClient) {
      const [r] = await pool.query(
        'SELECT id FROM terms_acceptance WHERE client_id = ? AND document_type = ? LIMIT 1',
        [clientId, DOCUMENT_TYPE_SAAS_OPERATOR]
      );
      existing = r || [];
    } else {
      const [r] = await pool.query(
        'SELECT id FROM terms_acceptance WHERE api_user_id = ? AND document_type = ? LIMIT 1',
        [apiUserId, DOCUMENT_TYPE_SAAS_OPERATOR]
      );
      existing = r || [];
    }
    console.log('[terms.service signTermsSaasOperator] terms_acceptance existing rows=', existing.length);
  } catch (e) {
    console.log('[terms.service signTermsSaasOperator] DB error code=', e?.code, 'message=', e?.message);
    if (e.code === 'ER_NO_SUCH_TABLE') {
      const dbName = process.env.DB_NAME || '(not set)';
      const dbHost = process.env.DB_HOST || '(not set)';
      console.error('[terms] Table terms_acceptance missing (sign). App is using DB_NAME=', dbName, 'DB_HOST=', dbHost);
      return { ok: false, reason: 'TERMS_TABLE_MISSING', message: 'Run migration 0102_terms_acceptance.sql' };
    }
    if (e.code === 'ER_BAD_FIELD_ERROR' && !byClient && String(e.message || '').includes('api_user_id')) {
      console.warn('[terms] signTermsSaasOperator: api_user_id column missing. Run migration 0115_terms_acceptance_api_user_id.sql');
      return { ok: false, reason: 'TERMS_MIGRATION_REQUIRED', message: 'Run migration 0115_terms_acceptance_api_user_id.sql to allow signing without a client.' };
    }
    console.error('[terms] signTermsSaasOperator', e?.message || e);
    return { ok: false, reason: 'DB_ERROR', message: e?.message };
  }

  let acceptanceId;
  if (existing.length > 0) {
    acceptanceId = existing[0].id;
    const payloadForHash = [acceptanceId, signature, signedAt.toISOString(), contentHash].join('|');
    const signatureHash = crypto.createHash('sha256').update(payloadForHash, 'utf8').digest('hex');
    console.log('[terms.service signTermsSaasOperator] UPDATE terms_acceptance id=', acceptanceId);
    await pool.query(
      `UPDATE terms_acceptance SET
         version = ?, content_hash = ?, signature = ?, signed_at = ?, signed_ip = ?, signature_hash = ?, updated_at = NOW()
       WHERE id = ?`,
      [version, contentHash, signature, signedAtStr, ip, signatureHash, acceptanceId]
    );
    console.log('[terms.service signTermsSaasOperator] return ok (updated)');
    return { ok: true, signatureHash };
  }

  acceptanceId = crypto.randomUUID();
  const payloadForHash = [acceptanceId, signature, signedAt.toISOString(), contentHash].join('|');
  const signatureHash = crypto.createHash('sha256').update(payloadForHash, 'utf8').digest('hex');
  console.log('[terms.service signTermsSaasOperator] INSERT terms_acceptance acceptanceId=', acceptanceId);
  if (byClient) {
    await pool.query(
      `INSERT INTO terms_acceptance (id, client_id, document_type, version, content_hash, signature, signed_at, signed_ip, signature_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [acceptanceId, clientId, DOCUMENT_TYPE_SAAS_OPERATOR, version, contentHash, signature, signedAtStr, ip, signatureHash]
    );
  } else {
    try {
      await pool.query(
        `INSERT INTO terms_acceptance (id, client_id, api_user_id, document_type, version, content_hash, signature, signed_at, signed_ip, signature_hash)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [acceptanceId, apiUserId, DOCUMENT_TYPE_SAAS_OPERATOR, version, contentHash, signature, signedAtStr, ip, signatureHash]
      );
    } catch (insertErr) {
      if (insertErr?.code === 'ER_BAD_FIELD_ERROR' && String(insertErr?.message || '').includes('api_user_id')) {
        console.warn('[terms] signTermsSaasOperator INSERT: api_user_id column missing. Run migration 0115.');
        return { ok: false, reason: 'TERMS_MIGRATION_REQUIRED', message: 'Run migration 0115_terms_acceptance_api_user_id.sql to allow signing without a client.' };
      }
      throw insertErr;
    }
  }
  console.log('[terms.service signTermsSaasOperator] return ok (inserted)');
  return { ok: true, signatureHash };
}

module.exports = {
  getTermsSaasOperator,
  signTermsSaasOperator,
  getSaasOperatorTermsContent
};
