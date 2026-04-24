/**
 * Cleanlemons operator company master email change (cln_operatordetail.email):
 * TAC to new inbox, then schedule +7 days; cron applies via migratePortalAccountEmail.
 */
'use strict';

const pool = require('../../config/db');
const { resolveClnOperatordetailTable } = require('../../config/clnOperatordetailTable');
const { normalizeEmail } = require('../access/access.service');
const { sendPortalOtpEmail, getPortalProductFromRequest } = require('../portal-auth/portal-password-reset-sender');
const { migratePortalAccountEmail } = require('../portal-auth/portal-contact-verify.service');

async function fetchClnCompanyEmail(operatorId) {
  const ct = await resolveClnOperatordetailTable();
  const [[r]] = await pool.query(`SELECT COALESCE(email, '') AS email FROM \`${ct}\` WHERE id = ? LIMIT 1`, [
    String(operatorId || '').trim(),
  ]);
  return r && r.email != null ? String(r.email).trim() : '';
}

async function requireClnMasterCompanyEmail(loginEmail, operatorId) {
  const oid = String(operatorId || '').trim();
  const em = normalizeEmail(loginEmail);
  if (!oid || !em) {
    const e = new Error('MISSING_OPERATOR_OR_EMAIL');
    e.code = 'MISSING_OPERATOR_OR_EMAIL';
    throw e;
  }
  const companyEmail = await fetchClnCompanyEmail(oid);
  const companyNorm = normalizeEmail(companyEmail);
  if (!companyNorm || companyNorm !== em) {
    const e = new Error('NOT_MASTER');
    e.code = 'NOT_MASTER';
    throw e;
  }
  return { operatorId: oid };
}

async function isClnOperatordetailEmailTakenByOtherOperator(newEmailNorm, excludeOperatorId) {
  const e = String(newEmailNorm || '').trim().toLowerCase();
  if (!e) return false;
  const ct = await resolveClnOperatordetailTable();
  const [rows] = await pool.query(
    `SELECT id FROM \`${ct}\` WHERE LOWER(TRIM(email)) = ? AND id <> ? LIMIT 1`,
    [e, String(excludeOperatorId).trim()]
  );
  return rows.length > 0;
}

/**
 * @param {string} email - JWT login (master)
 * @param {string} newEmailRaw
 * @param {string} operatorId - cln_operatordetail.id
 * @param {import('express').Request} [req]
 */
async function requestClnOperatorCompanyEmailChange(email, newEmailRaw, operatorId, req = null) {
  const newE = normalizeEmail(newEmailRaw);
  const oldE = normalizeEmail(email);
  if (!newE || !oldE) return { ok: false, reason: 'NO_EMAIL' };
  if (newE === oldE) return { ok: false, reason: 'SAME_EMAIL' };

  let opId;
  try {
    const x = await requireClnMasterCompanyEmail(email, operatorId);
    opId = x.operatorId;
  } catch (err) {
    const c = err?.code || err?.message;
    if (c === 'NOT_MASTER') return { ok: false, reason: 'NOT_MASTER' };
    if (c === 'MISSING_OPERATOR_OR_EMAIL') return { ok: false, reason: 'NO_EMAIL' };
    throw err;
  }

  let existing;
  try {
    const [ex] = await pool.query(
      'SELECT status, scheduled_effective_at FROM cln_operator_company_email_change WHERE operator_id = ? LIMIT 1',
      [opId]
    );
    existing = ex;
  } catch (err) {
    if (err?.code === 'ER_NO_SUCH_TABLE' || err?.errno === 1146) {
      return { ok: false, reason: 'MIGRATION_REQUIRED' };
    }
    throw err;
  }
  if (existing && existing.length && existing[0].status === 'scheduled') {
    return {
      ok: false,
      reason: 'ALREADY_SCHEDULED',
      effectiveAt: existing[0].scheduled_effective_at
        ? new Date(existing[0].scheduled_effective_at).toISOString()
        : null,
    };
  }

  const [acct] = await pool.query('SELECT id FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1', [oldE]);
  if (!acct.length) return { ok: false, reason: 'NO_ACCOUNT' };
  if (await isClnOperatordetailEmailTakenByOtherOperator(newE, opId)) {
    return { ok: false, reason: 'EMAIL_TAKEN' };
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  try {
    await pool.query(
      `INSERT INTO cln_operator_company_email_change (operator_id, new_email, code, tac_expires_at, status, scheduled_effective_at)
       VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 MINUTE), 'pending_tac', NULL)
       ON DUPLICATE KEY UPDATE new_email = VALUES(new_email), code = VALUES(code), tac_expires_at = VALUES(tac_expires_at),
         status = 'pending_tac', scheduled_effective_at = NULL, updated_at = CURRENT_TIMESTAMP`,
      [opId, newE, code]
    );
  } catch (err) {
    console.error('[cln-operator-company-email] request', err?.message || err);
    return { ok: false, reason: 'DB_ERROR' };
  }

  const portalProduct = req ? getPortalProductFromRequest(req) : 'cleanlemons';
  await sendPortalOtpEmail(
    newE,
    'Verify your new Cleanlemons company email',
    `Your verification code is: ${code}\n\nThis code expires in 30 minutes. After you confirm, your company email will change in 7 days.`,
    `<p>Your verification code is: <strong>${code}</strong></p><p>This code expires in 30 minutes.</p><p>After you confirm, your company email will change in <strong>7 days</strong>.</p>`,
    { portalProduct: portalProduct === 'coliving' ? 'coliving' : 'cleanlemons' }
  );
  return { ok: true };
}

async function confirmClnOperatorCompanyEmailChange(email, newEmailRaw, codeStr, operatorId, req = null) {
  const newE = normalizeEmail(newEmailRaw);
  const oldE = normalizeEmail(email);
  const code = String(codeStr || '').trim();
  if (!newE || !oldE || !code) return { ok: false, reason: 'NO_EMAIL' };

  let opId;
  try {
    const x = await requireClnMasterCompanyEmail(email, operatorId);
    opId = x.operatorId;
  } catch (err) {
    const c = err?.code || err?.message;
    if (c === 'NOT_MASTER') return { ok: false, reason: 'NOT_MASTER' };
    if (c === 'MISSING_OPERATOR_OR_EMAIL') return { ok: false, reason: 'NO_EMAIL' };
    throw err;
  }

  let pend;
  try {
    const [rows] = await pool.query(
      `SELECT new_email FROM cln_operator_company_email_change WHERE operator_id = ? AND new_email = ? AND code = ? AND status = 'pending_tac'
       AND tac_expires_at > NOW() LIMIT 1`,
      [opId, newE, code]
    );
    pend = rows;
  } catch (err) {
    if (err?.code === 'ER_NO_SUCH_TABLE' || err?.errno === 1146) {
      return { ok: false, reason: 'MIGRATION_REQUIRED' };
    }
    throw err;
  }
  if (!pend || !pend.length) return { ok: false, reason: 'INVALID_OR_EXPIRED_CODE' };

  const [acct] = await pool.query('SELECT id FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1', [oldE]);
  if (!acct.length) return { ok: false, reason: 'NO_ACCOUNT' };
  if (await isClnOperatordetailEmailTakenByOtherOperator(newE, opId)) {
    return { ok: false, reason: 'EMAIL_TAKEN' };
  }

  try {
    await pool.query(
      `UPDATE cln_operator_company_email_change SET status = 'scheduled',
       scheduled_effective_at = DATE_ADD(NOW(), INTERVAL 7 DAY),
       updated_at = CURRENT_TIMESTAMP WHERE operator_id = ? AND new_email = ?`,
      [opId, newE]
    );
  } catch (err) {
    console.error('[cln-operator-company-email] confirm', err?.message || err);
    return { ok: false, reason: 'DB_ERROR' };
  }

  const [[eff]] = await pool.query(
    'SELECT scheduled_effective_at FROM cln_operator_company_email_change WHERE operator_id = ? LIMIT 1',
    [opId]
  );
  const effectiveAt = eff?.scheduled_effective_at ? new Date(eff.scheduled_effective_at).toISOString() : null;
  return { ok: true, newEmail: newE, effectiveAt };
}

async function getClnOperatorCompanyEmailChangeStatus(email, operatorId) {
  const oidEarly = String(operatorId || '').trim();
  const companyEmailEarly = oidEarly ? await fetchClnCompanyEmail(oidEarly) : '';
  let opId;
  try {
    const x = await requireClnMasterCompanyEmail(email, operatorId);
    opId = x.operatorId;
  } catch (err) {
    const c = err?.code || err?.message;
    if (c === 'NOT_MASTER') {
      return {
        ok: true,
        master: false,
        companyEmail: companyEmailEarly,
        canChangeCompanyEmail: false,
        pending: null,
      };
    }
    if (c === 'MISSING_OPERATOR_OR_EMAIL') return { ok: false, reason: 'NO_EMAIL' };
    throw err;
  }

  const companyEmail = await fetchClnCompanyEmail(opId);
  let row;
  try {
    const [rows] = await pool.query(
      `SELECT new_email, status, tac_expires_at, scheduled_effective_at FROM cln_operator_company_email_change WHERE operator_id = ? LIMIT 1`,
      [opId]
    );
    row = rows[0];
  } catch (err) {
    if (err?.code === 'ER_NO_SUCH_TABLE' || err?.errno === 1146) {
      return {
        ok: true,
        master: true,
        companyEmail,
        canChangeCompanyEmail: true,
        pending: null,
      };
    }
    throw err;
  }

  return {
    ok: true,
    master: true,
    companyEmail,
    canChangeCompanyEmail: true,
    pending: row
      ? {
          newEmail: row.new_email,
          status: row.status,
          tacExpiresAt: row.tac_expires_at ? new Date(row.tac_expires_at).toISOString() : null,
          effectiveAt: row.scheduled_effective_at ? new Date(row.scheduled_effective_at).toISOString() : null,
        }
      : null,
  };
}

async function cancelClnOperatorCompanyEmailChange(email, operatorId) {
  let opId;
  try {
    const x = await requireClnMasterCompanyEmail(email, operatorId);
    opId = x.operatorId;
  } catch (err) {
    const c = err?.code || err?.message;
    if (c === 'NOT_MASTER') return { ok: false, reason: 'NOT_MASTER' };
    if (c === 'MISSING_OPERATOR_OR_EMAIL') return { ok: false, reason: 'NO_EMAIL' };
    throw err;
  }
  try {
    const [r] = await pool.query('DELETE FROM cln_operator_company_email_change WHERE operator_id = ?', [opId]);
    if (!r || Number(r.affectedRows) === 0) {
      return { ok: false, reason: 'NOTHING_TO_CANCEL' };
    }
    return { ok: true };
  } catch (err) {
    if (err?.code === 'ER_NO_SUCH_TABLE' || err?.errno === 1146) {
      return { ok: false, reason: 'MIGRATION_REQUIRED' };
    }
    console.error('[cln-operator-company-email] cancel', err?.message || err);
    return { ok: false, reason: 'DB_ERROR' };
  }
}

async function runDueClnOperatorCompanyEmailChanges() {
  const results = { applied: 0, errors: [] };
  let rows;
  try {
    [rows] = await pool.query(
      `SELECT operator_id, new_email FROM cln_operator_company_email_change
       WHERE status = 'scheduled' AND scheduled_effective_at IS NOT NULL AND scheduled_effective_at <= NOW()`
    );
  } catch (err) {
    if (err?.code === 'ER_NO_SUCH_TABLE' || err?.errno === 1146) {
      return results;
    }
    throw err;
  }
  for (const row of rows) {
    const operatorId = row.operator_id;
    const newE = normalizeEmail(row.new_email);
    try {
      const ct = await resolveClnOperatordetailTable();
      const [od] = await pool.query(`SELECT email FROM \`${ct}\` WHERE id = ? LIMIT 1`, [operatorId]);
      if (!od.length) {
        results.errors.push({ operatorId, reason: 'OPERATOR_NOT_FOUND' });
        try {
          await pool.query('DELETE FROM cln_operator_company_email_change WHERE operator_id = ?', [operatorId]);
        } catch (_) {
          /* ignore */
        }
        continue;
      }
      const oldE = normalizeEmail(od[0].email);
      if (!oldE || !newE || oldE === newE) {
        await pool.query('DELETE FROM cln_operator_company_email_change WHERE operator_id = ?', [operatorId]);
        continue;
      }
      const [pa] = await pool.query('SELECT id FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1', [oldE]);
      if (!pa.length) {
        results.errors.push({ operatorId, reason: 'NO_ACCOUNT' });
        continue;
      }
      if (await isClnOperatordetailEmailTakenByOtherOperator(newE, operatorId)) {
        results.errors.push({ operatorId, reason: 'EMAIL_TAKEN_AT_APPLY' });
        continue;
      }
      const mig = await migratePortalAccountEmail(oldE, newE, null, operatorId);
      if (!mig.ok) {
        results.errors.push({ operatorId, reason: mig.reason || 'MIGRATE_FAILED' });
        continue;
      }
      await pool.query('DELETE FROM cln_operator_company_email_change WHERE operator_id = ?', [operatorId]);
      results.applied += 1;
    } catch (err) {
      results.errors.push({ operatorId, reason: err?.message || 'DB_ERROR' });
    }
  }
  return results;
}

module.exports = {
  requestClnOperatorCompanyEmailChange,
  confirmClnOperatorCompanyEmailChange,
  getClnOperatorCompanyEmailChangeStatus,
  cancelClnOperatorCompanyEmailChange,
  runDueClnOperatorCompanyEmailChanges,
  fetchClnCompanyEmail,
};
