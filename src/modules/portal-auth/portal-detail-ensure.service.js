/**
 * After portal login/register/OAuth: provision domain detail rows linked to portal_account.id.
 *
 * Cleanlemons: `/client` routes can be reached without re-auth; canonical provisioning is still
 * **password/OAuth login** (e.g. portal.cleanlemons.com/login or `/`) so every session gets
 * `cln_clientdetail` (linked via `portal_account_id`). Client sends `body.frontend` on login/register
 * when `Origin` may not reach the API (proxy), so product inference stays reliable.
 *
 * Coliving (portal.colivingjb.com): ensure tenantdetail + ownerdetail.
 */
const { randomUUID } = require('crypto');
const pool = require('../../config/db');
const { normalizeEmail } = require('../access/access.service');

function inferPortalProductFromRequest(req) {
  if (!req || !req.headers) return null;
  const origin = String(req.headers.origin || '').toLowerCase();
  const host = String(req.headers.host || '').toLowerCase();
  const referer = String(req.headers.referer || '').toLowerCase();
  const hay = `${origin} ${host} ${referer}`;
  if (hay.includes('cleanlemons')) return 'cleanlemons';
  if (hay.includes('colivingjb') || hay.includes('portal.coliving')) return 'coliving';
  return null;
}

function inferProductFromFrontendHint(hint) {
  const h = String(hint || '').toLowerCase();
  if (h.includes('cleanlemons')) return 'cleanlemons';
  if (h.includes('colivingjb') || h.includes('portal.coliving')) return 'coliving';
  return null;
}

function isMissingTableOrColumn(err) {
  const code = err?.code;
  const errno = err?.errno;
  if (code === 'ER_NO_SUCH_TABLE' || errno === 1146) return true;
  if (code === 'ER_BAD_FIELD_ERROR' || errno === 1054) return true;
  const msg = String(err?.sqlMessage || err?.message || '');
  return /doesn't exist/i.test(msg) || /Unknown table/i.test(msg) || /Unknown column/i.test(msg);
}

async function ensureCleanlemonsClnClientdetail(portalAccountId, email) {
  const em = normalizeEmail(email);
  if (!em || !portalAccountId) return;
  try {
    const [[byPa]] = await pool.query(
      'SELECT id FROM cln_clientdetail WHERE portal_account_id = ? LIMIT 1',
      [portalAccountId]
    );
    if (byPa?.id) return;

    const [byEmail] = await pool.query(
      'SELECT id, email FROM cln_clientdetail WHERE LOWER(TRIM(email)) = ? LIMIT 3',
      [em]
    );
    if (byEmail.length === 1) {
      await pool.query(
        `UPDATE cln_clientdetail SET
           portal_account_id = COALESCE(portal_account_id, ?),
           email = IF(email IS NULL OR TRIM(COALESCE(email, '')) = '', ?, email),
           updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [portalAccountId, em, byEmail[0].id]
      );
      return;
    }
    if (byEmail.length > 1) {
      console.warn('[portal-detail-ensure] multiple cln_clientdetail for email; skip insert', em);
      return;
    }

    const [[pa]] = await pool.query(
      'SELECT fullname, first_name FROM portal_account WHERE id = ? LIMIT 1',
      [portalAccountId]
    );
    const fn = String(pa?.fullname || pa?.first_name || '').trim() || null;

    const id = randomUUID();
    await pool.query(
      `INSERT INTO cln_clientdetail (id, email, fullname, phone, address, account, portal_account_id, created_at, updated_at)
       VALUES (?, ?, ?, NULL, NULL, '[]', ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
      [id, em, fn, portalAccountId]
    );
  } catch (e) {
    if (isMissingTableOrColumn(e)) return;
    console.warn('[portal-detail-ensure] cln_clientdetail:', e?.message || e);
  }
}

async function ensureColivingTenantdetail(portalAccountId, email) {
  const em = normalizeEmail(email);
  if (!em || !portalAccountId) return;
  try {
    const [[byPa]] = await pool.query(
      'SELECT id FROM tenantdetail WHERE portal_account_id = ? LIMIT 1',
      [portalAccountId]
    );
    if (byPa?.id) return;

    const [byEmail] = await pool.query(
      'SELECT id FROM tenantdetail WHERE LOWER(TRIM(email)) = ? ORDER BY created_at ASC LIMIT 3',
      [em]
    );
    if (byEmail.length >= 1) {
      await pool.query(
        `UPDATE tenantdetail SET
           portal_account_id = COALESCE(portal_account_id, ?),
           email = IF(email IS NULL OR TRIM(COALESCE(email, '')) = '', ?, email),
           updated_at = CURRENT_TIMESTAMP()
         WHERE id = ?`,
        [portalAccountId, em, byEmail[0].id]
      );
      return;
    }

    const [[pa]] = await pool.query(
      'SELECT fullname, first_name FROM portal_account WHERE id = ? LIMIT 1',
      [portalAccountId]
    );
    const fn = String(pa?.fullname || pa?.first_name || '').trim() || null;
    const id = randomUUID();
    await pool.query(
      `INSERT INTO tenantdetail (id, email, fullname, portal_account_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [id, em, fn, portalAccountId]
    );
  } catch (e) {
    if (isMissingTableOrColumn(e)) return;
    console.warn('[portal-detail-ensure] tenantdetail:', e?.message || e);
  }
}

async function ensureColivingOwnerdetail(portalAccountId, email) {
  const em = normalizeEmail(email);
  if (!em || !portalAccountId) return;
  try {
    const [[byPa]] = await pool.query(
      'SELECT id FROM ownerdetail WHERE portal_account_id = ? LIMIT 1',
      [portalAccountId]
    );
    if (byPa?.id) return;

    const [byEmail] = await pool.query(
      'SELECT id FROM ownerdetail WHERE LOWER(TRIM(email)) = ? ORDER BY created_at ASC LIMIT 3',
      [em]
    );
    if (byEmail.length >= 1) {
      await pool.query(
        `UPDATE ownerdetail SET
           portal_account_id = COALESCE(portal_account_id, ?),
           email = IF(email IS NULL OR TRIM(COALESCE(email, '')) = '', ?, email),
           updated_at = CURRENT_TIMESTAMP()
         WHERE id = ?`,
        [portalAccountId, em, byEmail[0].id]
      );
      return;
    }

    const [[pa]] = await pool.query(
      'SELECT fullname, first_name FROM portal_account WHERE id = ? LIMIT 1',
      [portalAccountId]
    );
    const on = String(pa?.fullname || pa?.first_name || '').trim() || null;
    const id = randomUUID();
    await pool.query(
      `INSERT INTO ownerdetail (id, email, ownername, portal_account_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [id, em, on, portalAccountId]
    );
  } catch (e) {
    if (isMissingTableOrColumn(e)) return;
    console.warn('[portal-detail-ensure] ownerdetail:', e?.message || e);
  }
}

/**
 * @param {import('express').Request} req
 * @param {string} portalAccountId - portal_account.id
 * @param {string} email
 * @param {string} [frontendHint] - OAuth callback: state frontend URL when Origin is missing
 */
async function ensurePortalDetailRowsAfterAuth(req, portalAccountId, email, frontendHint) {
  let product = inferPortalProductFromRequest(req);
  if (!product && frontendHint) product = inferProductFromFrontendHint(frontendHint);
  if (!product || !portalAccountId || !normalizeEmail(email)) return;

  if (product === 'cleanlemons') {
    await ensureCleanlemonsClnClientdetail(portalAccountId, email);
  } else if (product === 'coliving') {
    await ensureColivingTenantdetail(portalAccountId, email);
    await ensureColivingOwnerdetail(portalAccountId, email);
  }
}

function scheduleEnsurePortalDetailRowsAfterAuth(req, portalAccountId, email, frontendHint) {
  setImmediate(() => {
    ensurePortalDetailRowsAfterAuth(req, portalAccountId, email, frontendHint).catch((e) =>
      console.warn('[portal-detail-ensure] scheduleEnsure failed', e?.message || e)
    );
  });
}

/**
 * Coliving: upsert `tenantdetail` or `ownerdetail` for portal JWT email when user opens Tenant or Owner portal
 * (same idea as Cleanlemons `cleanlemons-ensure-employee`). Idempotent if row already exists.
 * @param {string} email
 * @param {'tenant'|'owner'} role
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
async function ensureColivingDetailForPortalEmail(email, role) {
  const em = normalizeEmail(email);
  if (!em) return { ok: false, reason: 'NO_EMAIL' };
  const r = String(role || '').toLowerCase();
  if (r !== 'tenant' && r !== 'owner') return { ok: false, reason: 'BAD_ROLE' };
  try {
    const [rows] = await pool.query(
      'SELECT id FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [em]
    );
    if (!rows?.[0]?.id) return { ok: false, reason: 'NO_ACCOUNT' };
    const portalAccountId = String(rows[0].id);
    if (r === 'tenant') {
      await ensureColivingTenantdetail(portalAccountId, email);
    } else {
      await ensureColivingOwnerdetail(portalAccountId, email);
    }
    return { ok: true };
  } catch (e) {
    if (isMissingTableOrColumn(e)) return { ok: false, reason: 'TABLE_MISSING' };
    console.warn('[portal-detail-ensure] ensureColivingDetailForPortalEmail:', e?.message || e);
    return { ok: false, reason: 'DB_ERROR' };
  }
}

module.exports = {
  inferPortalProductFromRequest,
  ensurePortalDetailRowsAfterAuth,
  scheduleEnsurePortalDetailRowsAfterAuth,
  ensureColivingDetailForPortalEmail,
};
