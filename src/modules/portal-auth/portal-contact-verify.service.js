/**
 * Email change (OTP to new address) + phone verify / change (OTP via email to login inbox until SMS).
 */
'use strict';

const pool = require('../../config/db');
const { getOperatorMasterTableName } = require('../../config/operatorMasterTable');
const { resolveClnOperatordetailTable } = require('../../config/clnOperatordetailTable');
const { normalizeEmail } = require('../access/access.service');
const { sendPortalOtpEmail } = require('./portal-password-reset-sender');

/**
 * True if email is already used for another portal account or any Coliving / Cleanlemons identity
 * (aligned with member-roles "registered" — not only portal_account).
 */
async function isNewEmailRegisteredByAnotherAccount(newEmailNorm, portalAccountId) {
  const e = newEmailNorm;
  const pid = String(portalAccountId);
  const [pa] = await pool.query(
    'SELECT id FROM portal_account WHERE LOWER(TRIM(email)) = ? AND id <> ? LIMIT 1',
    [e, pid]
  );
  if (pa.length) return true;

  const simpleTables = [
    ['tenantdetail', 'email'],
    ['ownerdetail', 'email'],
    ['staffdetail', 'email'],
  ];
  for (const [tbl, col] of simpleTables) {
    try {
      const [rows] = await pool.query(
        `SELECT id FROM \`${tbl}\` WHERE LOWER(TRIM(\`${col}\`)) = ? LIMIT 1`,
        [e]
      );
      if (rows.length) return true;
    } catch (err) {
      if (err?.code === 'ER_NO_SUCH_TABLE' || err?.errno === 1146) continue;
      throw err;
    }
  }

  try {
    const [saas] = await pool.query('SELECT id FROM saasadmin WHERE LOWER(TRIM(email)) = ? LIMIT 1', [e]);
    if (saas.length) return true;
  } catch (err) {
    if (err?.code !== 'ER_NO_SUCH_TABLE' && err?.errno !== 1146) throw err;
  }

  try {
    const [cu] = await pool.query('SELECT id FROM client_user WHERE LOWER(TRIM(email)) = ? LIMIT 1', [e]);
    if (cu.length) return true;
  } catch (err) {
    if (err?.code !== 'ER_NO_SUCH_TABLE' && err?.errno !== 1146) throw err;
  }

  try {
    const opTable = await getOperatorMasterTableName();
    const [op] = await pool.query(
      `SELECT id FROM \`${opTable}\` WHERE LOWER(TRIM(email)) = ? LIMIT 1`,
      [e]
    );
    if (op.length) return true;
  } catch (err) {
    const msg = String(err?.sqlMessage || err?.message || '');
    if (err?.code === 'ER_NO_SUCH_TABLE' || /doesn't exist/i.test(msg)) {
      /* skip */
    } else {
      throw err;
    }
  }

  try {
    const [clnE] = await pool.query(
      'SELECT id FROM cln_employeedetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [e]
    );
    if (clnE.length) return true;
  } catch (err) {
    if (err?.code !== 'ER_NO_SUCH_TABLE' && err?.errno !== 1146) throw err;
  }

  try {
    const clnOd = await resolveClnOperatordetailTable();
    const [co] = await pool.query(
      `SELECT id FROM \`${clnOd}\` WHERE LOWER(TRIM(email)) = ? LIMIT 1`,
      [e]
    );
    if (co.length) return true;
  } catch (err) {
    if (err?.code !== 'ER_NO_SUCH_TABLE' && err?.errno !== 1146) throw err;
  }

  return false;
}

const PHONE_OTP_TTL_MS = 15 * 60 * 1000;
/** accountId -> { phone, code, expires, mode: 'verify'|'change' } */
const phoneOtpByAccount = new Map();

function cleanupPhoneOtps() {
  const now = Date.now();
  for (const [k, v] of phoneOtpByAccount.entries()) {
    if (!v || v.expires < now) phoneOtpByAccount.delete(k);
  }
}
setInterval(cleanupPhoneOtps, 60 * 1000).unref();

function normalizePhoneDigits(p) {
  return String(p || '').replace(/\s+/g, '').trim();
}

async function migratePortalAccountEmail(oldEmail, newEmail) {
  const o = normalizeEmail(oldEmail);
  const n = normalizeEmail(newEmail);
  if (!o || !n) return { ok: false, reason: 'NO_EMAIL' };
  const [acctRows] = await pool.query(
    'SELECT id FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1',
    [o]
  );
  if (!acctRows.length) return { ok: false, reason: 'NO_ACCOUNT' };
  const accountId = String(acctRows[0].id);
  const takenElsewhere = await isNewEmailRegisteredByAnotherAccount(n, accountId);
  if (takenElsewhere) return { ok: false, reason: 'EMAIL_TAKEN' };

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('UPDATE portal_account SET email = ?, updated_at = NOW() WHERE id = ?', [n, accountId]);
    const tables = [
      ['tenantdetail', 'email'],
      ['ownerdetail', 'email'],
      ['staffdetail', 'email'],
    ];
    for (const [tbl, col] of tables) {
      try {
        await conn.query(`UPDATE ${tbl} SET ${col} = ? WHERE LOWER(TRIM(${col})) = ?`, [n, o]);
      } catch (err) {
        if (err?.code !== 'ER_NO_SUCH_TABLE' && err?.errno !== 1146) throw err;
      }
    }
    try {
      await conn.query('UPDATE cln_clientdetail SET email = ? WHERE LOWER(TRIM(email)) = ?', [n, o]);
    } catch (err) {
      if (err?.code !== 'ER_NO_SUCH_TABLE' && err?.errno !== 1146) throw err;
    }
    try {
      await conn.query('UPDATE cln_employeedetail SET email = ? WHERE LOWER(TRIM(email)) = ?', [n, o]);
    } catch (err) {
      if (err?.code !== 'ER_NO_SUCH_TABLE' && err?.errno !== 1146) throw err;
    }
    try {
      await conn.query('UPDATE client_user SET email = ? WHERE LOWER(TRIM(email)) = ?', [n, o]);
    } catch (err) {
      if (err?.code !== 'ER_NO_SUCH_TABLE' && err?.errno !== 1146) throw err;
    }
    await conn.commit();
    return { ok: true };
  } catch (err) {
    try {
      await conn.rollback();
    } catch (_) {
      /* ignore */
    }
    console.error('[portal-contact-verify] migratePortalAccountEmail', err?.message || err);
    return { ok: false, reason: 'DB_ERROR' };
  } finally {
    conn.release();
  }
}

async function requestEmailChangeOtp(portalEmail, newEmailRaw) {
  const newE = normalizeEmail(newEmailRaw);
  const oldE = normalizeEmail(portalEmail);
  if (!newE || !oldE) return { ok: false, reason: 'NO_EMAIL' };
  if (newE === oldE) return { ok: false, reason: 'SAME_EMAIL' };
  const [acct] = await pool.query('SELECT id FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1', [oldE]);
  if (!acct.length) return { ok: false, reason: 'NO_ACCOUNT' };
  const accountId = acct[0].id;
  const takenElsewhere = await isNewEmailRegisteredByAnotherAccount(newE, String(accountId));
  if (takenElsewhere) return { ok: false, reason: 'EMAIL_TAKEN' };
  const code = String(Math.floor(100000 + Math.random() * 900000));
  try {
    await pool.query(
      `INSERT INTO portal_email_change_pending (portal_account_id, new_email, code, expires_at)
       VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 MINUTE))
       ON DUPLICATE KEY UPDATE new_email = VALUES(new_email), code = VALUES(code), expires_at = VALUES(expires_at)`,
      [accountId, newE, code]
    );
  } catch (err) {
    if (err?.code === 'ER_NO_SUCH_TABLE' || err?.errno === 1146) {
      return { ok: false, reason: 'MIGRATION_REQUIRED' };
    }
    console.error('[portal-contact-verify] requestEmailChangeOtp', err?.message || err);
    return { ok: false, reason: 'DB_ERROR' };
  }
  await sendPortalOtpEmail(
    newE,
    'Verify your new Coliving email',
    `Your verification code is: ${code}\n\nThis code expires in 30 minutes.`,
    `<p>Your verification code is: <strong>${code}</strong></p><p>This code expires in 30 minutes.</p>`
  );
  return { ok: true };
}

async function confirmEmailChange(portalEmail, newEmailRaw, codeStr) {
  const newE = normalizeEmail(newEmailRaw);
  const oldE = normalizeEmail(portalEmail);
  const code = String(codeStr || '').trim();
  if (!newE || !oldE || !code) return { ok: false, reason: 'NO_EMAIL' };
  const [acct] = await pool.query('SELECT id FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1', [oldE]);
  if (!acct.length) return { ok: false, reason: 'NO_ACCOUNT' };
  const accountId = acct[0].id;
  let pend;
  try {
    const [rows] = await pool.query(
      'SELECT new_email FROM portal_email_change_pending WHERE portal_account_id = ? AND new_email = ? AND code = ? AND expires_at > NOW() LIMIT 1',
      [accountId, newE, code]
    );
    pend = rows;
  } catch (err) {
    if (err?.code === 'ER_NO_SUCH_TABLE') return { ok: false, reason: 'MIGRATION_REQUIRED' };
    throw err;
  }
  if (!pend || !pend.length) return { ok: false, reason: 'INVALID_OR_EXPIRED_CODE' };
  const takenElsewhere = await isNewEmailRegisteredByAnotherAccount(newE, String(accountId));
  if (takenElsewhere) return { ok: false, reason: 'EMAIL_TAKEN' };
  const mig = await migratePortalAccountEmail(oldE, newE);
  if (!mig.ok) return mig;
  try {
    await pool.query('DELETE FROM portal_email_change_pending WHERE portal_account_id = ?', [accountId]);
  } catch (_) {
    /* ignore */
  }
  return { ok: true, newEmail: newE };
}

async function requestPhoneVerifyOtp(portalEmail, phoneRaw) {
  const em = normalizeEmail(portalEmail);
  const phone = normalizePhoneDigits(phoneRaw);
  if (!em) return { ok: false, reason: 'NO_EMAIL' };
  if (!phone || phone.length < 8) return { ok: false, reason: 'INVALID_PHONE' };
  let acct;
  try {
    const [rows] = await pool.query(
      'SELECT id, COALESCE(phone_verified,0) AS pv FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [em]
    );
    acct = rows;
  } catch (err) {
    if (err?.code === 'ER_BAD_FIELD_ERROR') {
      const [rows] = await pool.query(
        'SELECT id FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1',
        [em]
      );
      acct = rows.map((r) => ({ ...r, pv: 0 }));
    } else {
      throw err;
    }
  }
  if (!acct.length) return { ok: false, reason: 'NO_ACCOUNT' };
  if (Number(acct[0].pv) === 1) return { ok: false, reason: 'ALREADY_VERIFIED' };
  const accountId = String(acct[0].id);
  const code = String(Math.floor(100000 + Math.random() * 900000));
  phoneOtpByAccount.set(accountId, {
    phone,
    code,
    expires: Date.now() + PHONE_OTP_TTL_MS,
    mode: 'verify',
  });
  await sendPortalOtpEmail(
    em,
    'Phone verification code',
    `Your code to verify phone ${phone} is: ${code}\n\nExpires in 15 minutes.`,
    `<p>Your code to verify phone <strong>${phone}</strong> is: <strong>${code}</strong></p><p>Expires in 15 minutes.</p>`
  );
  return { ok: true };
}

async function confirmPhoneVerifyOtp(portalEmail, phoneRaw, codeStr) {
  const em = normalizeEmail(portalEmail);
  const phone = normalizePhoneDigits(phoneRaw);
  const code = String(codeStr || '').trim();
  if (!em || !phone || !code) return { ok: false, reason: 'INVALID_INPUT' };
  const [acct] = await pool.query('SELECT id FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1', [em]);
  if (!acct.length) return { ok: false, reason: 'NO_ACCOUNT' };
  const accountId = String(acct[0].id);
  const rec = phoneOtpByAccount.get(accountId);
  if (!rec || rec.mode !== 'verify' || rec.expires < Date.now()) {
    return { ok: false, reason: 'INVALID_OR_EXPIRED_CODE' };
  }
  if (rec.phone !== phone || rec.code !== code) {
    return { ok: false, reason: 'INVALID_OR_EXPIRED_CODE' };
  }
  phoneOtpByAccount.delete(accountId);
  try {
    await pool.query(
      'UPDATE portal_account SET phone = ?, phone_verified = 1, updated_at = NOW() WHERE LOWER(TRIM(email)) = ?',
      [phone, em]
    );
    await pool.query(
      'UPDATE tenantdetail SET phone = ?, updated_at = NOW() WHERE LOWER(TRIM(email)) = ?',
      [phone, em]
    );
  } catch (err) {
    if (err?.code === 'ER_BAD_FIELD_ERROR') {
      await pool.query('UPDATE portal_account SET phone = ?, updated_at = NOW() WHERE LOWER(TRIM(email)) = ?', [phone, em]);
    } else {
      throw err;
    }
  }
  try {
    await pool.query(
      'UPDATE ownerdetail SET mobilenumber = ?, updated_at = NOW() WHERE LOWER(TRIM(email)) = ?',
      [phone, em]
    );
  } catch (_) {
    /* ignore */
  }
  return { ok: true };
}

async function requestPhoneChangeOtp(portalEmail, newPhoneRaw) {
  const em = normalizeEmail(portalEmail);
  const newPhone = normalizePhoneDigits(newPhoneRaw);
  if (!em) return { ok: false, reason: 'NO_EMAIL' };
  if (!newPhone || newPhone.length < 8) return { ok: false, reason: 'INVALID_PHONE' };
  let acct;
  try {
    const [rows] = await pool.query(
      'SELECT id, phone, COALESCE(phone_verified,0) AS pv FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [em]
    );
    acct = rows;
  } catch (err) {
    if (err?.code === 'ER_BAD_FIELD_ERROR') {
      return { ok: false, reason: 'MIGRATION_REQUIRED' };
    }
    throw err;
  }
  if (!acct.length) return { ok: false, reason: 'NO_ACCOUNT' };
  if (Number(acct[0].pv) !== 1) return { ok: false, reason: 'NOT_VERIFIED' };
  const stored = acct[0].phone != null ? normalizePhoneDigits(acct[0].phone) : '';
  if (newPhone === stored) return { ok: false, reason: 'SAME_PHONE' };
  const accountId = String(acct[0].id);
  const code = String(Math.floor(100000 + Math.random() * 900000));
  phoneOtpByAccount.set(accountId, {
    phone: newPhone,
    code,
    expires: Date.now() + PHONE_OTP_TTL_MS,
    mode: 'change',
  });
  await sendPortalOtpEmail(
    em,
    'Confirm new phone number',
    `Your code to change your phone to ${newPhone} is: ${code}\n\nExpires in 15 minutes.`,
    `<p>Your code to change your phone to <strong>${newPhone}</strong> is: <strong>${code}</strong></p>`
  );
  return { ok: true };
}

async function confirmPhoneChangeOtp(portalEmail, newPhoneRaw, codeStr) {
  const em = normalizeEmail(portalEmail);
  const newPhone = normalizePhoneDigits(newPhoneRaw);
  const code = String(codeStr || '').trim();
  if (!em || !newPhone || !code) return { ok: false, reason: 'INVALID_INPUT' };
  const [acct] = await pool.query('SELECT id FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1', [em]);
  if (!acct.length) return { ok: false, reason: 'NO_ACCOUNT' };
  const accountId = String(acct[0].id);
  const rec = phoneOtpByAccount.get(accountId);
  if (!rec || rec.mode !== 'change' || rec.expires < Date.now()) {
    return { ok: false, reason: 'INVALID_OR_EXPIRED_CODE' };
  }
  if (rec.phone !== newPhone || rec.code !== code) {
    return { ok: false, reason: 'INVALID_OR_EXPIRED_CODE' };
  }
  phoneOtpByAccount.delete(accountId);
  try {
    await pool.query(
      'UPDATE portal_account SET phone = ?, phone_verified = 1, updated_at = NOW() WHERE LOWER(TRIM(email)) = ?',
      [newPhone, em]
    );
    await pool.query('UPDATE tenantdetail SET phone = ?, updated_at = NOW() WHERE LOWER(TRIM(email)) = ?', [newPhone, em]);
  } catch (err) {
    if (err?.code === 'ER_BAD_FIELD_ERROR') {
      await pool.query('UPDATE portal_account SET phone = ?, updated_at = NOW() WHERE LOWER(TRIM(email)) = ?', [newPhone, em]);
    } else {
      throw err;
    }
  }
  try {
    await pool.query('UPDATE ownerdetail SET mobilenumber = ?, updated_at = NOW() WHERE LOWER(TRIM(email)) = ?', [
      newPhone,
      em,
    ]);
  } catch (_) {
    /* ignore */
  }
  return { ok: true };
}

module.exports = {
  migratePortalAccountEmail,
  requestEmailChangeOtp,
  confirmEmailChange,
  requestPhoneVerifyOtp,
  confirmPhoneVerifyOtp,
  requestPhoneChangeOtp,
  confirmPhoneChangeOtp,
};
