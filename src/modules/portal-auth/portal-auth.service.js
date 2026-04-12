/**
 * Portal 手動註冊／登入：存 portal_account（email + password_hash），登入時驗證密碼後回傳 getMemberRoles(email)。
 * Google/Facebook OAuth 登入：findOrCreateByGoogle / findOrCreateByFacebook 以 email 關聯，可建立或綁定 portal_account。
 */
const { randomUUID } = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../../config/db');
const { getMemberRoles, normalizeEmail } = require('../access/access.service');

const PORTAL_JWT_SECRET = process.env.PORTAL_JWT_SECRET || 'portal-jwt-secret-change-in-production';
/** Onboarding flows (/enquiry, etc.) need longer than a few minutes; override with PORTAL_JWT_EXPIRES_IN in .env */
const PORTAL_JWT_EXPIRES_IN = process.env.PORTAL_JWT_EXPIRES_IN || '12h';

const SALT_ROUNDS = 10;

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

function safeStringify(val) {
  if (val == null) return null;
  try {
    return JSON.stringify(val);
  } catch {
    return null;
  }
}

async function hashPassword(plain) {
  if (!plain || typeof plain !== 'string') return null;
  return bcrypt.hash(plain.trim(), SALT_ROUNDS);
}

async function verifyPassword(plain, hash) {
  if (!plain || !hash) return false;
  return bcrypt.compare(plain.trim(), hash);
}

/** OAuth / legacy rows may have NULL, '', or non-bcrypt junk; only bcrypt-shaped values count as an existing login password. */
function hasUsablePasswordHash(hash) {
  if (hash == null) return false;
  const s = Buffer.isBuffer(hash) ? hash.toString('utf8') : String(hash);
  const t = s.trim();
  if (!t) return false;
  return /^\$2[aby]\$\d{2}\$/.test(t) && t.length >= 59;
}

/**
 * 註冊：任何 email 皆可註冊 portal_account；登入後可進 /portal，點 Tenant/Owner 填 profile 即建立 tenantdetail/ownerdetail。
 * @returns { ok, reason?, email? } reason: EMAIL_ALREADY_REGISTERED | NO_EMAIL | INVALID_PASSWORD | DB_ERROR
 * 若 email 已存在且尚無 password（例如先 Google 登入），則寫入 password_hash；已有密碼則拒絕。
 */
async function register(email, password) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return { ok: false, reason: 'NO_EMAIL' };
  }

  const [existingRows] = await pool.query(
    'SELECT id, password_hash FROM portal_account WHERE email = ? LIMIT 1',
    [normalized]
  );
  const existing = existingRows[0];
  if (existing && hasUsablePasswordHash(existing.password_hash)) {
    return { ok: false, reason: 'EMAIL_ALREADY_REGISTERED' };
  }

  const password_hash = await hashPassword(password);
  if (!password_hash) {
    return { ok: false, reason: 'INVALID_PASSWORD' };
  }

  try {
    if (existing) {
      const [upd] = await pool.query(
        'UPDATE portal_account SET password_hash = ?, updated_at = NOW() WHERE id = ?',
        [password_hash, existing.id]
      );
      if (!upd.affectedRows) {
        return { ok: false, reason: 'DB_ERROR' };
      }
      return { ok: true, email: normalized };
    }

    const id = randomUUID();
    await pool.query(
      'INSERT INTO portal_account (id, email, password_hash) VALUES (?, ?, ?)',
      [id, normalized, password_hash]
    );
    return { ok: true, email: normalized };
  } catch (err) {
    console.error('[portal-auth] register:', err?.message || err);
    return { ok: false, reason: 'DB_ERROR' };
  }
}

/**
 * 登入：驗證 email + 密碼後回傳 getMemberRoles(email)，供前端 setMember 並跳 /portal。
 * @returns { ok, reason?, email?, roles? } reason: INVALID_CREDENTIALS | NO_EMAIL | DB_ERROR
 */
async function login(email, password) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return { ok: false, reason: 'NO_EMAIL' };
  }

  const [rows] = await pool.query(
    'SELECT id, email, password_hash FROM portal_account WHERE email = ? LIMIT 1',
    [normalized]
  );
  const account = rows[0];
  if (!account || !(await verifyPassword(password, account.password_hash))) {
    return { ok: false, reason: 'INVALID_CREDENTIALS' };
  }

  const memberRoles = await getMemberRoles(normalized);
  if (!memberRoles.ok) {
    return { ok: false, reason: 'DB_ERROR' };
  }

  return {
    ok: true,
    email: memberRoles.email,
    portalAccountId: String(account.id),
    roles: memberRoles.roles || [],
    cleanlemons: memberRoles.cleanlemons || null,
    token: signPortalToken({
      email: memberRoles.email,
      roles: memberRoles.roles || [],
      cleanlemons: memberRoles.cleanlemons || null
    })
  };
}

/**
 * Coliving /login Google：與 /enquiry 相同，允許首次登入即建立 portal_account（無 tenant/staff/owner 亦可），roles 可為空。
 * 實作與 findOrCreateByGoogleCleanlemon 共用。
 * @param {{ id: string, emails?: Array<{ value: string }> }} profile - Passport Google profile
 * @returns {{ ok: boolean, reason?: string, email?: string, roles?: Array }} reason: NO_EMAIL | NO_GOOGLE_ID | …
 */
async function findOrCreateByGoogle(profile) {
  return findOrCreateByGoogleCleanlemon(profile);
}

/**
 * Coliving /enquiry：與 /login 相同邏輯（findOrCreateByGoogleCleanlemon）；保留 enquiry state 供路由導向 /enquiry。
 */
async function findOrCreateByGoogleEnquiry(profile) {
  return findOrCreateByGoogleCleanlemon(profile);
}

/**
 * Cleanlemons Google OAuth: allow first-time email (no pre-registered role rows).
 * Creates/binds portal_account and returns empty roles when none exist yet.
 */
async function findOrCreateByGoogleCleanlemon(profile) {
  const email = profile?.emails?.[0]?.value;
  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: false, reason: 'NO_EMAIL' };

  const googleId = profile?.id ? String(profile.id) : null;
  if (!googleId) return { ok: false, reason: 'NO_GOOGLE_ID' };

  const [existingByGoogle] = await pool.query(
    'SELECT id, email FROM portal_account WHERE google_id = ? LIMIT 1',
    [googleId]
  );
  if (existingByGoogle.length) {
    const member = await getMemberRoles(existingByGoogle[0].email);
    return member.ok
      ? {
          ok: true,
          email: normalizeEmail(existingByGoogle[0].email),
          roles: member.roles || [],
          cleanlemons: member.cleanlemons || null
        }
      : { ok: true, email: normalizeEmail(existingByGoogle[0].email), roles: [], cleanlemons: null };
  }

  const [existingByEmail] = await pool.query(
    'SELECT id, email FROM portal_account WHERE email = ? LIMIT 1',
    [normalized]
  );
  if (existingByEmail.length) {
    await pool.query(
      'UPDATE portal_account SET google_id = ?, updated_at = NOW() WHERE id = ?',
      [googleId, existingByEmail[0].id]
    );
  } else {
    const id = randomUUID();
    await pool.query(
      'INSERT INTO portal_account (id, email, password_hash, google_id) VALUES (?, ?, NULL, ?)',
      [id, normalized, googleId]
    );
  }

  const member = await getMemberRoles(normalized);
  return member.ok
    ? { ok: true, email: normalized, roles: member.roles || [], cleanlemons: member.cleanlemons || null }
    : { ok: true, email: normalized, roles: [], cleanlemons: null };
}

/**
 * Coliving /enquiry 專用：與 findOrCreateByGoogleEnquiry 相同，由 Facebook OAuth state.enquiry 觸發。
 */
async function findOrCreateByFacebookEnquiry(profile) {
  return findOrCreateByFacebookCleanlemon(profile);
}

/**
 * Cleanlemons Facebook OAuth：與 findOrCreateByGoogleCleanlemon 相同，允許首登建立 portal_account。
 */
async function findOrCreateByFacebookCleanlemon(profile) {
  const email = profile?.emails?.[0]?.value || profile?._json?.email;
  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: false, reason: 'NO_EMAIL' };

  const facebookId = profile?.id ? String(profile.id) : null;
  if (!facebookId) return { ok: false, reason: 'NO_FACEBOOK_ID' };

  const [existingByFb] = await pool.query(
    'SELECT id, email FROM portal_account WHERE facebook_id = ? LIMIT 1',
    [facebookId]
  );
  if (existingByFb.length) {
    const member = await getMemberRoles(existingByFb[0].email);
    return member.ok
      ? {
          ok: true,
          email: normalizeEmail(existingByFb[0].email),
          roles: member.roles || [],
          cleanlemons: member.cleanlemons || null
        }
      : { ok: true, email: normalizeEmail(existingByFb[0].email), roles: [], cleanlemons: null };
  }

  const [existingByEmail] = await pool.query(
    'SELECT id, email FROM portal_account WHERE email = ? LIMIT 1',
    [normalized]
  );
  if (existingByEmail.length) {
    await pool.query(
      'UPDATE portal_account SET facebook_id = ?, updated_at = NOW() WHERE id = ?',
      [facebookId, existingByEmail[0].id]
    );
  } else {
    const id = randomUUID();
    await pool.query(
      'INSERT INTO portal_account (id, email, password_hash, facebook_id) VALUES (?, ?, NULL, ?)',
      [id, normalized, facebookId]
    );
  }

  const member = await getMemberRoles(normalized);
  return member.ok
    ? { ok: true, email: normalized, roles: member.roles || [], cleanlemons: member.cleanlemons || null }
    : { ok: true, email: normalized, roles: [], cleanlemons: null };
}

/**
 * Coliving /login Facebook：與 /enquiry 相同，允許首次登入即建立 portal_account；實作與 findOrCreateByFacebookCleanlemon 共用。
 */
async function findOrCreateByFacebook(profile) {
  return findOrCreateByFacebookCleanlemon(profile);
}

/** JWT 內只放 Cleanlemons 下拉所需（完整 employee 見 login / member-roles 回應 body）。 */
function slimCleanlemonsForJwt(c) {
  if (!c || typeof c !== 'object') return null;
  return {
    operatorChoices: Array.isArray(c.operatorChoices) ? c.operatorChoices : [],
    employeeId: c.employee && c.employee.id ? String(c.employee.id) : null,
    supervisorOperators: Array.isArray(c.supervisorOperators) ? c.supervisorOperators : [],
    employeeOperators: Array.isArray(c.employeeOperators) ? c.employeeOperators : []
  };
}

/**
 * 簽發供前端使用的短期 JWT（OAuth 登入成功後 redirect 帶上）。
 * Payload: { email, roles, cleanlemons? }；前端驗證後可 setMember 並跳 /portal。
 */
function signPortalToken(payload) {
  const body = {
    email: payload.email,
    roles: payload.roles || []
  };
  if (payload.cleanlemons != null) {
    const slim = slimCleanlemonsForJwt(payload.cleanlemons);
    body.cleanlemons =
      slim ||
      { operatorChoices: [], employeeId: null, supervisorOperators: [], employeeOperators: [] };
  }
  return jwt.sign(body, PORTAL_JWT_SECRET, { expiresIn: PORTAL_JWT_EXPIRES_IN });
}

/**
 * 驗證 portal JWT，回傳 payload 或 null。
 */
function verifyPortalToken(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const decoded = jwt.verify(token.trim(), PORTAL_JWT_SECRET);
    if (!decoded || !decoded.email) return null;
    return {
      email: decoded.email,
      roles: decoded.roles || [],
      cleanlemons: decoded.cleanlemons ?? null
    };
  } catch {
    return null;
  }
}

/**
 * 取得會員資料（一個 email 一份，存在 portal_account）。
 * 若 portal_account 尚無該 email 或無 profile 欄位則回傳 null 或空物件。
 * @returns {{ ok: boolean, profile?: { fullname, phone, address, nric, bankname_id, bankaccount, accountholder } } | { ok: false, reason } }
 */
async function getPortalProfile(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return { ok: false, reason: 'NO_EMAIL' };
  }
  try {
    const [rows] = await pool.query(
      'SELECT fullname, first_name, last_name, phone, address, nric, bankname_id, bankaccount, accountholder, avatar_url, nricfront, nricback, entity_type, reg_no_type, id_type, tax_id_no, bank_refund_remark FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [normalized]
    );
    const r = rows[0];
    if (!r) {
      return { ok: true, profile: null };
    }
    return {
      ok: true,
      profile: {
        fullname: r.fullname ?? null,
        first_name: r.first_name ?? null,
        last_name: r.last_name ?? null,
        phone: r.phone ?? null,
        address: r.address ?? null,
        nric: r.nric ?? null,
        bankname_id: r.bankname_id ?? null,
        bankaccount: r.bankaccount ?? null,
        accountholder: r.accountholder ?? null
        ,
        avatar_url: r.avatar_url ?? null,
        nricfront: r.nricfront ?? null,
        nricback: r.nricback ?? null,
        entity_type: r.entity_type ?? null,
        reg_no_type: r.reg_no_type ?? null,
        id_type: r.id_type ?? null,
        tax_id_no: r.tax_id_no ?? null,
        bank_refund_remark: r.bank_refund_remark ?? null
      }
    };
  } catch (err) {
    if (err && (err.code === 'ER_BAD_FIELD_ERROR' || err.code === 'ECONNRESET')) {
      return { ok: true, profile: null };
    }
    return { ok: false, reason: 'DB_ERROR' };
  }
}

/**
 * 更新會員資料並同步到同一 email 的業務列（僅 UPDATE，列不存在則跳過該表）：
 * tenantdetail、staffdetail、ownerdetail；Cleanlemons 另同步 cln_employeedetail、cln_clientdetail。
 * payload: { fullname?, phone?, address?, nric?, bankname_id?, bankaccount?, accountholder? }
 * @returns {{ ok: boolean, reason? }}
 */
async function updatePortalProfile(email, payload) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return { ok: false, reason: 'NO_EMAIL' };
  }
  if (!payload || typeof payload !== 'object') {
    return { ok: false, reason: 'NO_PAYLOAD' };
  }

  // When a key is not present in payload, keep destination values unchanged (COALESCE + provided flags).
  const hasKey = (k) => Object.prototype.hasOwnProperty.call(payload, k);

  const avatar_url_provided = hasKey('avatar_url') && payload.avatar_url !== undefined;
  const nricfront_provided = hasKey('nricfront') && payload.nricfront !== undefined;
  const nricback_provided = hasKey('nricback') && payload.nricback !== undefined;
  const entity_type_provided = hasKey('entity_type') && payload.entity_type !== undefined;
  const reg_no_type_provided = hasKey('reg_no_type') && payload.reg_no_type !== undefined;
  const id_type_provided = hasKey('id_type') && payload.id_type !== undefined;
  const tax_id_no_provided = hasKey('tax_id_no') && payload.tax_id_no !== undefined;
  const bank_refund_remark_provided = hasKey('bank_refund_remark') && payload.bank_refund_remark !== undefined;
  const address_provided = hasKey('address') && payload.address !== undefined;
  const first_name_provided = hasKey('first_name') && payload.first_name !== undefined;
  const last_name_provided = hasKey('last_name') && payload.last_name !== undefined;
  const fullname_provided = hasKey('fullname') && payload.fullname !== undefined;

  const fullname = payload.fullname != null ? String(payload.fullname).trim() || null : null;
  const first_name = first_name_provided ? (payload.first_name == null ? null : String(payload.first_name).trim() || null) : null;
  const last_name = last_name_provided ? (payload.last_name == null ? null : String(payload.last_name).trim() || null) : null;
  const phone = payload.phone != null ? String(payload.phone).trim() || null : null;
  const address = payload.address != null ? String(payload.address).trim() || null : null;
  const nric = payload.nric != null ? String(payload.nric).trim() || null : null;
  const bankname_id = payload.bankname_id != null ? (payload.bankname_id === '' ? null : payload.bankname_id) : null;
  const bankaccount = payload.bankaccount != null ? String(payload.bankaccount).trim() || null : null;
  const accountholder = payload.accountholder != null ? String(payload.accountholder).trim() || null : null;

  const avatar_url = avatar_url_provided ? (payload.avatar_url == null ? null : String(payload.avatar_url).trim() || null) : null;
  const nricfront = nricfront_provided ? (payload.nricfront == null ? null : String(payload.nricfront).trim() || null) : null;
  const nricback = nricback_provided ? (payload.nricback == null ? null : String(payload.nricback).trim() || null) : null;
  const entity_type = entity_type_provided ? (payload.entity_type == null ? null : String(payload.entity_type).trim() || null) : null;
  const reg_no_type = reg_no_type_provided ? (payload.reg_no_type == null ? null : String(payload.reg_no_type).trim() || null) : null;
  const id_type = id_type_provided ? (payload.id_type == null ? null : String(payload.id_type).trim() || null) : null;
  const tax_id_no = tax_id_no_provided ? (payload.tax_id_no == null ? null : String(payload.tax_id_no).trim() || null) : null;
  const bank_refund_remark = bank_refund_remark_provided ? (payload.bank_refund_remark == null ? null : String(payload.bank_refund_remark).trim() || null) : null;

  try {
    const [existing] = await pool.query(
      'SELECT id FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [normalized]
    );
    if (existing.length === 0) {
      return { ok: false, reason: 'NO_ACCOUNT' };
    }
    const portalAccountPk = String(existing[0].id);

    await pool.query(
      `UPDATE portal_account SET fullname = COALESCE(?, fullname), first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name), phone = COALESCE(?, phone), address = COALESCE(?, address),
       nric = COALESCE(?, nric), bankname_id = COALESCE(?, bankname_id), bankaccount = COALESCE(?, bankaccount),
       accountholder = COALESCE(?, accountholder),
       avatar_url = COALESCE(?, avatar_url), nricfront = COALESCE(?, nricfront), nricback = COALESCE(?, nricback),
       entity_type = COALESCE(?, entity_type), reg_no_type = COALESCE(?, reg_no_type), id_type = COALESCE(?, id_type), tax_id_no = COALESCE(?, tax_id_no),
       bank_refund_remark = COALESCE(?, bank_refund_remark),
       updated_at = NOW() WHERE LOWER(TRIM(email)) = ?`,
      [fullname, first_name, last_name, phone, address, nric, bankname_id, bankaccount, accountholder, avatar_url, nricfront, nricback, entity_type, reg_no_type, id_type, tax_id_no, bank_refund_remark, normalized]
    );

    const [updated] = await pool.query(
      'SELECT fullname, first_name, last_name, phone, address, nric, bankname_id, bankaccount, accountholder, avatar_url, nricfront, nricback, entity_type, reg_no_type, id_type, tax_id_no, bank_refund_remark FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [normalized]
    );
    const p = updated[0] || {};
    const fn = p.fullname ?? null;
    const first = p.first_name ?? null;
    const last = p.last_name ?? null;
    const ph = p.phone ?? null;
    const addr = p.address ?? null;
    const nr = p.nric ?? null;
    const bid = p.bankname_id ?? null;
    const bacc = p.bankaccount ?? null;
    const ahold = p.accountholder ?? null;
    const aUrl = p.avatar_url ?? null;
    const nf = p.nricfront ?? null;
    const nb = p.nricback ?? null;
    const et = p.entity_type ?? null;
    const rnt = p.reg_no_type ?? null;
    const idt = p.id_type ?? null;
    const tno = p.tax_id_no ?? null;
    const brmrk = p.bank_refund_remark ?? null;

    await pool.query(
      'UPDATE tenantdetail SET fullname = ?, phone = ?, address = ?, nric = ?, bankname_id = ?, bankaccount = ?, accountholder = ?, nricfront = COALESCE(?, nricfront), nricback = COALESCE(?, nricback), updated_at = NOW() WHERE LOWER(TRIM(email)) = ?',
      [fn, ph, addr, nr, bid, bacc, ahold, nf, nb, normalized]
    );
    await pool.query(
      'UPDATE staffdetail SET name = ?, bank_name_id = ?, bankaccount = ?, updated_at = NOW() WHERE LOWER(TRIM(email)) = ?',
      [fn, bid, bacc, normalized]
    );
    await pool.query(
      'UPDATE ownerdetail SET ownername = ?, mobilenumber = ?, nric = ?, bankname_id = ?, bankaccount = ?, accountholder = ?, updated_at = NOW() WHERE LOWER(TRIM(email)) = ?',
      [fn, ph, nr, bid, bacc, ahold, normalized]
    );

    // Sync tenantdetail.profile JSON (avatar/entity/reg/tax/bank_refund_remark).
    if (avatar_url_provided || entity_type_provided || reg_no_type_provided || id_type_provided || tax_id_no_provided || bank_refund_remark_provided || first_name_provided || last_name_provided) {
      try {
        const [tenantRows] = await pool.query(
          'SELECT profile FROM tenantdetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
          [normalized]
        );
        const existingProfile = parseJson(tenantRows?.[0]?.profile) || {};
        const nextProfile = { ...existingProfile };
        if (avatar_url_provided) nextProfile.avatar_url = aUrl;
        if (entity_type_provided) nextProfile.entity_type = et;
        if (reg_no_type_provided) nextProfile.reg_no_type = rnt;
        if (id_type_provided) nextProfile.id_type = idt;
        if (tax_id_no_provided) nextProfile.tax_id_no = tno;
        if (bank_refund_remark_provided) nextProfile.bank_refund_remark = brmrk;
        if (first_name_provided) nextProfile.first_name = first;
        if (last_name_provided) nextProfile.last_name = last;
        await pool.query(
          'UPDATE tenantdetail SET profile = ?, updated_at = NOW() WHERE LOWER(TRIM(email)) = ?',
          [JSON.stringify(nextProfile), normalized]
        );
      } catch (err) {
        if (!(err?.code === 'ER_BAD_FIELD_ERROR' || err?.errno === 1054)) {
          // If tenantdetail.profile column not exist yet, ignore (handled by caller UI).
          throw err;
        }
      }
    }

    // Sync staffdetail.profile JSON (operator entity/reg/tax).
    if (entity_type_provided || reg_no_type_provided || id_type_provided || tax_id_no_provided || first_name_provided || last_name_provided) {
      try {
        const [staffRows] = await pool.query(
          'SELECT profile FROM staffdetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
          [normalized]
        );
        const existingProfile = parseJson(staffRows?.[0]?.profile) || {};
        const nextProfile = { ...existingProfile };
        if (entity_type_provided) nextProfile.entity_type = et;
        if (reg_no_type_provided) nextProfile.reg_no_type = rnt;
        if (id_type_provided) nextProfile.id_type = idt;
        if (tax_id_no_provided) nextProfile.tax_id_no = tno;
        if (first_name_provided) nextProfile.first_name = first;
        if (last_name_provided) nextProfile.last_name = last;
        await pool.query(
          'UPDATE staffdetail SET profile = ?, updated_at = NOW() WHERE LOWER(TRIM(email)) = ?',
          [JSON.stringify(nextProfile), normalized]
        );
      } catch (err) {
        if (!(err?.code === 'ER_BAD_FIELD_ERROR' || err?.errno === 1054)) throw err;
      }
    }

    // Sync avatar for operator (staffdetail.profilephoto / client_user.profilephoto).
    if (avatar_url_provided) {
      try {
        // staffdetail
        await pool.query(
          'UPDATE staffdetail SET profilephoto = ?, updated_at = NOW() WHERE LOWER(TRIM(email)) = ?',
          [aUrl, normalized]
        );
      } catch (err) {
        if (!(err?.code === 'ER_BAD_FIELD_ERROR' || err?.errno === 1054)) throw err;
      }
      try {
        // client_user
        await pool.query(
          'UPDATE client_user SET profilephoto = ?, updated_at = NOW() WHERE LOWER(TRIM(email)) = ?',
          [aUrl, normalized]
        );
      } catch (err) {
        if (!(err?.code === 'ER_BAD_FIELD_ERROR' || err?.errno === 1054)) throw err;
      }
    }

    // Sync ownerdetail.profile JSON (entity/reg/tax and address string).
    if (avatar_url_provided || entity_type_provided || reg_no_type_provided || id_type_provided || tax_id_no_provided || address_provided || first_name_provided || last_name_provided) {
      try {
        const [ownerRows] = await pool.query(
          'SELECT profile FROM ownerdetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
          [normalized]
        );
        const existingProfile = parseJson(ownerRows?.[0]?.profile) || {};
        const existingAddr = existingProfile?.address && typeof existingProfile.address === 'object' ? existingProfile.address : {};
        const nextProfile = { ...existingProfile };
        if (entity_type_provided) nextProfile.entity_type = et;
        if (reg_no_type_provided) nextProfile.reg_no_type = rnt;
        if (id_type_provided) nextProfile.id_type = idt;
        if (tax_id_no_provided) nextProfile.tax_id_no = tno;
        if (avatar_url_provided) nextProfile.avatar_url = aUrl;
        if (first_name_provided) nextProfile.first_name = first;
        if (last_name_provided) nextProfile.last_name = last;
        if (address_provided) {
          nextProfile.address = {
            ...existingAddr,
            street: addr,
          };
        }
        await pool.query(
          'UPDATE ownerdetail SET profile = ?, updated_at = NOW() WHERE LOWER(TRIM(email)) = ?',
          [JSON.stringify(nextProfile), normalized]
        );
      } catch (err) {
        if (!(err?.code === 'ER_BAD_FIELD_ERROR' || err?.errno === 1054)) throw err;
      }
    }

    // Sync nricfront/nricback for tenant + owner (top-level columns).
    if (nricfront_provided || nricback_provided) {
      try {
        await pool.query(
          'UPDATE ownerdetail SET nricfront = COALESCE(?, nricfront), nricback = COALESCE(?, nricback), updated_at = NOW() WHERE LOWER(TRIM(email)) = ?',
          [nf, nb, normalized]
        );
      } catch (err) {
        if (!(err?.code === 'ER_BAD_FIELD_ERROR' || err?.errno === 1054)) throw err;
      }
    }

    try {
      const contactService = require('../contact/contact.service');
      await contactService.syncAccountingContactsForProfileEmail(normalized);
    } catch (e) {
      console.warn('[portal-auth] syncAccountingContactsForProfileEmail', e?.message || e);
    }

    try {
      await pool.query(
        `UPDATE cln_employeedetail SET
          full_name = ?, phone = ?, address = ?, id_number = ?, tax_id_no = ?,
          bank_id = ?, bank_account_no = ?, bank_account_holder = ?,
          nric_front_url = COALESCE(?, nric_front_url), nric_back_url = COALESCE(?, nric_back_url),
          avatar_url = COALESCE(?, avatar_url),
          entity_type = COALESCE(?, entity_type), id_type = COALESCE(?, id_type),
          updated_at = CURRENT_TIMESTAMP(3)
         WHERE LOWER(TRIM(email)) = ?`,
        [fn, ph, addr, nr, tno, bid, bacc, ahold, nf, nb, aUrl, et, idt, normalized]
      );
    } catch (err) {
      const code = err?.code;
      const errno = err?.errno;
      if (code !== 'ER_NO_SUCH_TABLE' && errno !== 1146) {
        console.warn('[portal-auth] sync cln_employeedetail from portal_account:', err?.message || err);
      }
    }

    try {
      const [clientRows] = await pool.query(
        'SELECT id FROM cln_clientdetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
        [normalized]
      );
      if (Array.isArray(clientRows) && clientRows.length > 0) {
        await pool.query(
          `UPDATE cln_clientdetail
             SET fullname = ?, phone = ?, address = ?,
                 portal_account_id = COALESCE(portal_account_id, ?),
                 updated_at = CURRENT_TIMESTAMP(3)
           WHERE id = ?`,
          [fn, ph, addr, portalAccountPk, String(clientRows[0].id)]
        );
      } else {
        const clientId = randomUUID();
        await pool.query(
          `INSERT INTO cln_clientdetail (id, email, fullname, phone, address, account, portal_account_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
          [clientId, normalized, fn, ph, addr, '[]', portalAccountPk]
        );
      }
    } catch (err) {
      const code = err?.code;
      const errno = err?.errno;
      if (code !== 'ER_NO_SUCH_TABLE' && errno !== 1146) {
        console.warn('[portal-auth] sync cln_clientdetail from portal_account:', err?.message || err);
      }
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'DB_ERROR' };
  }
}

/**
 * Update only bank fields on portal_account and sync bank columns to tenantdetail / staffdetail / ownerdetail.
 * Uses direct SET (not COALESCE) so empty strings can clear account number / holder when intended.
 * @param {string} email
 * @param {{ bankname_id?: string|null, bankaccount?: string|null, accountholder?: string|null }} fields
 */
async function updatePortalBankFields(email, fields) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return { ok: false, reason: 'NO_EMAIL' };
  }
  if (!fields || typeof fields !== 'object') {
    return { ok: false, reason: 'NO_PAYLOAD' };
  }
  const bid =
    fields.bankname_id === '' || fields.bankname_id == null ? null : String(fields.bankname_id);
  const bacc = fields.bankaccount != null ? String(fields.bankaccount).trim() : null;
  const ahold = fields.accountholder != null ? String(fields.accountholder).trim() : null;

  try {
    const [existing] = await pool.query(
      'SELECT id FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [normalized]
    );
    if (!existing.length) {
      return { ok: false, reason: 'NO_ACCOUNT' };
    }

    await pool.query(
      `UPDATE portal_account SET bankname_id = ?, bankaccount = ?, accountholder = ?, updated_at = NOW()
       WHERE LOWER(TRIM(email)) = ?`,
      [bid, bacc, ahold, normalized]
    );

    const [updated] = await pool.query(
      'SELECT fullname, phone, address, nric, bankname_id, bankaccount, accountholder FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [normalized]
    );
    const p = updated[0] || {};
    const fn = p.fullname ?? null;
    const ph = p.phone ?? null;
    const addr = p.address ?? null;
    const nr = p.nric ?? null;
    const bid2 = p.bankname_id ?? null;
    const bacc2 = p.bankaccount ?? null;
    const ahold2 = p.accountholder ?? null;

    await pool.query(
      'UPDATE tenantdetail SET fullname = ?, phone = ?, address = ?, nric = ?, bankname_id = ?, bankaccount = ?, accountholder = ?, updated_at = NOW() WHERE LOWER(TRIM(email)) = ?',
      [fn, ph, addr, nr, bid2, bacc2, ahold2, normalized]
    );
    await pool.query(
      'UPDATE staffdetail SET name = ?, bank_name_id = ?, bankaccount = ?, updated_at = NOW() WHERE LOWER(TRIM(email)) = ?',
      [fn, bid2, bacc2, normalized]
    );
    await pool.query(
      'UPDATE ownerdetail SET ownername = ?, mobilenumber = ?, nric = ?, bankname_id = ?, bankaccount = ?, accountholder = ?, updated_at = NOW() WHERE LOWER(TRIM(email)) = ?',
      [fn, ph, nr, bid2, bacc2, ahold2, normalized]
    );

    try {
      await pool.query(
        `UPDATE cln_employeedetail SET bank_id = ?, bank_account_no = ?, bank_account_holder = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE LOWER(TRIM(email)) = ?`,
        [bid2, bacc2, ahold2, normalized]
      );
    } catch (err) {
      if (err?.code !== 'ER_NO_SUCH_TABLE' && err?.errno !== 1146) {
        console.warn('[portal-auth] sync cln_employeedetail bank fields', err?.message || err);
      }
    }

    try {
      const contactService = require('../contact/contact.service');
      await contactService.syncAccountingContactsForProfileEmail(normalized);
    } catch (e) {
      console.warn('[portal-auth] syncAccountingContactsForProfileEmail (bank)', e?.message || e);
    }

    return { ok: true };
  } catch (err) {
    console.error('[portal-auth] updatePortalBankFields', err?.message || err);
    return { ok: false, reason: 'DB_ERROR' };
  }
}

/**
 * Forgot password: create or overwrite reset code for email, send email. Only if email exists in portal_account.
 * @returns {{ ok: boolean, reason? }} reason: NO_EMAIL | NO_ACCOUNT | DB_ERROR
 */
async function requestPasswordReset(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return { ok: false, reason: 'NO_EMAIL' };
  }
  const [existing] = await pool.query('SELECT id FROM portal_account WHERE email = ? LIMIT 1', [normalized]);
  if (!existing.length) {
    return { ok: false, reason: 'NO_ACCOUNT' };
  }
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const RESET_CODE_EXPIRY_MINUTES = 30;
  try {
    // Use MySQL NOW() + interval so expires_at and confirmPasswordReset's "expires_at > NOW()" use same clock (no timezone mismatch)
    await pool.query(
      `INSERT INTO portal_password_reset (email, code, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))
       ON DUPLICATE KEY UPDATE code = ?, expires_at = DATE_ADD(NOW(), INTERVAL ? MINUTE)`,
      [normalized, code, RESET_CODE_EXPIRY_MINUTES, code, RESET_CODE_EXPIRY_MINUTES]
    );
    const sender = require('./portal-password-reset-sender');
    await sender.sendPasswordResetCode(normalized, code);
  } catch (err) {
    console.error('[portal-auth] requestPasswordReset DB/send error:', err?.message || err);
    return { ok: false, reason: 'DB_ERROR' };
  }
  return { ok: true };
}

/**
 * Reset password with code from email. Updates portal_account.password_hash and deletes reset row.
 * @returns {{ ok: boolean, reason? }} reason: NO_EMAIL | INVALID_OR_EXPIRED_CODE | DB_ERROR
 */
async function confirmPasswordReset(email, code, newPassword) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return { ok: false, reason: 'NO_EMAIL' };
  }
  const codeStr = String(code).trim();
  const [rows] = await pool.query(
    'SELECT email FROM portal_password_reset WHERE email = ? AND code = ? AND expires_at > NOW() LIMIT 1',
    [normalized, codeStr]
  );
  if (!rows || rows.length === 0) {
    // Debug: see why validation failed (wrong code vs expired)
    const [debugRows] = await pool.query(
      'SELECT code, expires_at FROM portal_password_reset WHERE email = ? LIMIT 1',
      [normalized]
    );
    if (debugRows.length > 0) {
      const row = debugRows[0];
      const dbCode = row.code != null ? String(row.code) : '';
      const codeMatch = dbCode === codeStr;
      const expiresAt = row.expires_at;
      const nowDb = await pool.query('SELECT NOW() AS now').then(([r]) => (r && r[0]) ? r[0].now : null);
      console.error('[portal-auth] reset-password fail: email=', normalized, 'code_match=', codeMatch, 'expires_at=', expiresAt, 'NOW()=', nowDb);
    } else {
      console.error('[portal-auth] reset-password fail: no row for email=', normalized);
    }
    return { ok: false, reason: 'INVALID_OR_EXPIRED_CODE' };
  }
  const password_hash = await hashPassword(newPassword);
  if (!password_hash) {
    return { ok: false, reason: 'INVALID_PASSWORD' };
  }
  try {
    await pool.query('UPDATE portal_account SET password_hash = ?, updated_at = NOW() WHERE email = ?', [password_hash, normalized]);
    await pool.query('DELETE FROM portal_password_reset WHERE email = ?', [normalized]);
  } catch (err) {
    return { ok: false, reason: 'DB_ERROR' };
  }
  return { ok: true };
}

/**
 * Ensure a `portal_account` row exists for this email (OAuth / Cleanlemons-first users may have none).
 * Inserts id + email + password_hash NULL when missing.
 */
async function ensurePortalAccountByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return { ok: false, reason: 'NO_EMAIL' };
  }
  try {
    const [existing] = await pool.query(
      'SELECT id FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [normalized]
    );
    if (existing.length) return { ok: true };
    const id = randomUUID();
    await pool.query(
      'INSERT INTO portal_account (id, email, password_hash) VALUES (?, ?, NULL)',
      [id, normalized]
    );
    return { ok: true };
  } catch (err) {
    console.error('[portal-auth] ensurePortalAccountByEmail', err?.message || err);
    return { ok: false, reason: 'DB_ERROR' };
  }
}

/**
 * Change password when logged in: verify currentPassword then set newPassword.
 * @returns {{ ok: boolean, reason?: string }}
 */
async function changePassword(email, currentPassword, newPassword) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return { ok: false, reason: 'NO_EMAIL' };
  }
  const [rows] = await pool.query(
    'SELECT id, password_hash FROM portal_account WHERE email = ? LIMIT 1',
    [normalized]
  );
  const account = rows[0];
  if (!account || !(await verifyPassword(currentPassword, account.password_hash))) {
    return { ok: false, reason: 'INVALID_CURRENT_PASSWORD' };
  }
  const password_hash = await hashPassword(newPassword);
  if (!password_hash) {
    return { ok: false, reason: 'INVALID_PASSWORD' };
  }
  try {
    await pool.query('UPDATE portal_account SET password_hash = ?, updated_at = NOW() WHERE email = ?', [password_hash, normalized]);
  } catch (err) {
    return { ok: false, reason: 'DB_ERROR' };
  }
  return { ok: true };
}

/**
 * Whether this account has a usable bcrypt password (not OAuth-only).
 * @returns {{ ok: boolean, hasPassword?: boolean, reason?: string }}
 */
async function getPasswordStatusForEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return { ok: false, reason: 'NO_EMAIL' };
  }
  try {
    const [rows] = await pool.query(
      'SELECT password_hash FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [normalized]
    );
    if (!rows.length) {
      return { ok: true, hasPassword: false };
    }
    return { ok: true, hasPassword: hasUsablePasswordHash(rows[0].password_hash) };
  } catch (err) {
    console.error('[portal-auth] getPasswordStatusForEmail', err?.message || err);
    return { ok: false, reason: 'DB_ERROR' };
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  register,
  login,
  findOrCreateByGoogle,
  findOrCreateByGoogleEnquiry,
  findOrCreateByGoogleCleanlemon,
  findOrCreateByFacebook,
  findOrCreateByFacebookEnquiry,
  findOrCreateByFacebookCleanlemon,
  signPortalToken,
  verifyPortalToken,
  getPortalProfile,
  updatePortalProfile,
  getPasswordStatusForEmail,
  ensurePortalAccountByEmail,
  updatePortalBankFields,
  requestPasswordReset,
  confirmPasswordReset,
  changePassword
};
