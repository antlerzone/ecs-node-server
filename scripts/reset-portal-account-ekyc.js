#!/usr/bin/env node
/**
 * Clear Aliyun eKYC_PRO–filled identity + NRIC images for one portal_account (retest eKYC).
 * Does NOT touch Singpass/MyDigital (gov_identity_locked, singpass_sub, mydigital_sub).
 *
 * Usage: node scripts/reset-portal-account-ekyc.js <portal_account_uuid>
 * Requires: DB_* in .env (same as API).
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pool = require('../src/config/db');

const id = String(process.argv[2] || '').trim();
if (!id) {
  console.error('Usage: node scripts/reset-portal-account-ekyc.js <portal_account_uuid>');
  process.exit(1);
}

(async () => {
  const [rows] = await pool.query('SELECT id, email, fullname, nric FROM portal_account WHERE id = ? LIMIT 1', [id]);
  if (!rows.length) {
    console.error('portal_account not found:', id);
    process.exit(1);
  }
  const email = rows[0].email;
  let lkBefore;
  try {
    const [l] = await pool.query(
      'SELECT COALESCE(aliyun_ekyc_locked,0) AS lk FROM portal_account WHERE id = ? LIMIT 1',
      [id]
    );
    lkBefore = l[0] && l[0].lk;
  } catch {
    lkBefore = '(column missing)';
  }
  console.log('before:', { email: rows[0].email, fullname: rows[0].fullname, nric: rows[0].nric, aliyun_ekyc_locked: lkBefore });

  try {
    await pool.query(
      `UPDATE portal_account SET
        aliyun_ekyc_locked = 0,
        nricfront = NULL, nricback = NULL,
        fullname = NULL, first_name = NULL, last_name = NULL,
        nric = NULL, passport_expiry_date = NULL, entity_type = NULL, id_type = NULL, reg_no_type = NULL, tax_id_no = NULL,
        updated_at = NOW()
       WHERE id = ?`,
      [id]
    );
  } catch (e) {
    if (e.code === 'ER_BAD_FIELD_ERROR' && String(e.message).includes('aliyun_ekyc_locked')) {
      await pool.query(
        `UPDATE portal_account SET
          nricfront = NULL, nricback = NULL,
          fullname = NULL, first_name = NULL, last_name = NULL,
          nric = NULL, passport_expiry_date = NULL, entity_type = NULL, id_type = NULL, reg_no_type = NULL, tax_id_no = NULL,
          updated_at = NOW()
         WHERE id = ?`,
        [id]
      );
    } else {
      throw e;
    }
  }

  for (const [label, sql] of [
    [
      'tenantdetail',
      `UPDATE tenantdetail SET nricfront = NULL, nricback = NULL, nric = NULL, fullname = NULL, updated_at = NOW()
       WHERE LOWER(TRIM(email)) = LOWER(TRIM(?))`,
    ],
    [
      'ownerdetail',
      `UPDATE ownerdetail SET nricfront = NULL, nricback = NULL, nric = NULL, updated_at = NOW()
       WHERE LOWER(TRIM(email)) = LOWER(TRIM(?))`,
    ],
  ]) {
    try {
      const [r] = await pool.query(sql, [email]);
      console.log(label, 'affectedRows=', r.affectedRows);
    } catch (err) {
      console.warn(label, err.code || err.message);
    }
  }

  try {
    const [r] = await pool.query(
      `UPDATE cln_employeedetail SET nric_front_url = NULL, nric_back_url = NULL, updated_at = CURRENT_TIMESTAMP(3)
       WHERE LOWER(TRIM(email)) = LOWER(TRIM(?))`,
      [email]
    );
    console.log('cln_employeedetail', 'affectedRows=', r.affectedRows);
  } catch (err) {
    if (err.code !== 'ER_NO_SUCH_TABLE' && err.errno !== 1146) console.warn('cln_employeedetail', err.message);
  }

  let afterRow;
  try {
    const [after] = await pool.query(
      'SELECT fullname, nric, nricfront, nricback, COALESCE(aliyun_ekyc_locked,0) AS lk FROM portal_account WHERE id = ?',
      [id]
    );
    afterRow = after[0];
  } catch {
    const [after] = await pool.query('SELECT fullname, nric, nricfront, nricback FROM portal_account WHERE id = ?', [id]);
    afterRow = after[0];
  }
  console.log('after portal_account:', afterRow);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
