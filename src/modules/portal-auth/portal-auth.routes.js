/**
 * Portal 手動註冊／登入 API：供 portal 登入頁與註冊頁呼叫。
 * POST /api/portal-auth/register  { email, password }
 * POST /api/portal-auth/login    { email, password }
 * GET  /api/portal-auth/google        → 導向 Google OAuth
 * GET  /api/portal-auth/google/callback
 * GET  /api/portal-auth/facebook      → 導向 Facebook OAuth
 * GET  /api/portal-auth/facebook/callback
 * GET  /api/portal-auth/verify?token=...  → { ok, email?, roles? }（供前端 auth/callback 頁驗證 token）
 */
const express = require('express');
const router = express.Router();
const passport = require('./passport-strategies');
const {
  register,
  login,
  signPortalToken,
  verifyPortalToken,
  getPortalProfile,
  updatePortalProfile,
  getPasswordStatusForEmail,
  requestPasswordReset,
  confirmPasswordReset,
  changePassword,
} = require('./portal-auth.service');
const {
  getMemberRoles,
  normalizeEmail,
  ensureEmployeedetailForPortalEmail,
  getCleanlemonsPortalContext,
} = require('../access/access.service');
const pool = require('../../config/db');
const {
  scheduleEnsurePortalDetailRowsAfterAuth,
  ensureColivingDetailForPortalEmail,
} = require('./portal-detail-ensure.service');

const FRONTEND_URL = process.env.PORTAL_FRONTEND_URL || 'http://localhost:3000';

/** After OAuth/register when portalAccountId is not already known (login returns id). */
async function scheduleEnsureAfterPortalAuth(req, email, frontendHint) {
  try {
    const em = normalizeEmail(email);
    if (!em) return;
    const [rows] = await pool.query('SELECT id FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1', [em]);
    const paId = rows[0]?.id;
    if (paId) scheduleEnsurePortalDetailRowsAfterAuth(req, String(paId), em, frontendHint);
  } catch (e) {
    console.warn('[portal-auth] scheduleEnsureAfterPortalAuth:', e?.message || e);
  }
}
const OAUTH_ALLOWED_FRONTEND_HOSTS = (process.env.PORTAL_AUTH_ALLOWED_FRONTEND_HOSTS || 'portal.colivingjb.com,portal.cleanlemons.com,localhost,127.0.0.1')
  .split(',')
  .map((x) => String(x || '').trim().toLowerCase())
  .filter(Boolean);

function getFrontendUrl(req) {
  const fallback = String(FRONTEND_URL || '').replace(/\/$/, '');
  const candidate = String(req.query?.frontend || '').trim();
  if (!candidate) return fallback;
  try {
    const parsed = new URL(candidate);
    const host = String(parsed.hostname || '').toLowerCase();
    const protocol = String(parsed.protocol || '').toLowerCase();
    if (!['http:', 'https:'].includes(protocol)) return fallback;
    if (!OAUTH_ALLOWED_FRONTEND_HOSTS.includes(host)) return fallback;
    return candidate.replace(/\/$/, '');
  } catch {
    return fallback;
  }
}

function parseFrontendFromState(stateRaw) {
  return parseOAuthState(stateRaw).frontend;
}

/** OAuth state: { frontend, enquiry?: boolean } */
function parseOAuthState(stateRaw) {
  const state = String(stateRaw || '').trim();
  if (!state) return { frontend: '', enquiry: false };
  try {
    const decoded = Buffer.from(state, 'base64url').toString('utf8');
    const obj = JSON.parse(decoded);
    return {
      frontend: String(obj?.frontend || '').trim(),
      enquiry: obj?.enquiry === true
    };
  } catch {
    return { frontend: '', enquiry: false };
  }
}

function getGoogleCallbackBase(req, frontendUrl) {
  const front = String(frontendUrl || '').toLowerCase();
  // Cleanlemons：默认 OAuth 回调在 portal 同域（与 Nginx location /api/ → Node）；可设 CLEANLEMON_PORTAL_AUTH_BASE_URL 覆盖
  if (front.includes('portal.cleanlemons.com')) {
    return (process.env.CLEANLEMON_PORTAL_AUTH_BASE_URL || 'https://portal.cleanlemons.com').replace(/\/$/, '');
  }
  return process.env.PORTAL_AUTH_BASE_URL || '';
}

function getLoginEntryPath(frontendUrl) {
  const front = String(frontendUrl || '').toLowerCase();
  return front.includes('portal.cleanlemons.com') ? '/register' : '/login';
}

function getEnquiryEntryPath() {
  return '/enquiry';
}

/**
 * Cleanlemons（portal.cleanlemons.com）必须使用 CLEANLEMON_GOOGLE_* + 策略 google-cleanlemon。
 * 若误用 Coliving 的 GOOGLE_CLIENT_*，redirect_uri 会指向 api.cleanlemons.com，但 OAuth 客户端只允许
 * api.colivingjb.com 的回调 → Google 报 redirect_uri_mismatch。
 */
function getGoogleStrategyName(frontendUrl) {
  const front = String(frontendUrl || '').toLowerCase();
  if (front.includes('portal.cleanlemons.com')) {
    if (process.env.CLEANLEMON_GOOGLE_CLIENT_ID && process.env.CLEANLEMON_GOOGLE_CLIENT_SECRET) {
      return 'google-cleanlemon';
    }
    return null;
  }
  return 'google';
}

function hasGoogleOauthConfig(frontendUrl) {
  const strategy = getGoogleStrategyName(frontendUrl);
  if (strategy === null) {
    return false;
  }
  if (strategy === 'google-cleanlemon') {
    return !!(process.env.CLEANLEMON_GOOGLE_CLIENT_ID && process.env.CLEANLEMON_GOOGLE_CLIENT_SECRET);
  }
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function getFacebookStrategyName(frontendUrl) {
  const front = String(frontendUrl || '').toLowerCase();
  if (front.includes('portal.cleanlemons.com')) {
    if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) {
      return 'facebook-cleanlemon';
    }
    return null;
  }
  return 'facebook';
}

function hasFacebookOauthConfig(frontendUrl) {
  const strategy = getFacebookStrategyName(frontendUrl);
  if (strategy === null) {
    return false;
  }
  return !!(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET);
}

/** 從 Authorization: Bearer <token> 取得 email，設為 req.portalEmail；無效或無 token 則 401。 */
function requirePortalToken(req, res, next) {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const payload = verifyPortalToken(token);
  if (!payload || !payload.email) {
    return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
  }
  req.portalEmail = payload.email;
  next();
}

/**
 * POST /api/portal-auth/register
 * Body: { email, password }
 * 僅當 email 已在 tenantdetail / staffdetail / ownerdetail / operatordetail 中才可註冊。
 */
router.post('/register', async (req, res) => {
  console.log('[portal-auth] POST /register received', { origin: req.headers.origin, hasBody: !!req.body });
  try {
    const { email, password } = req.body || {};
    const result = await register(email, password);
    console.log('[portal-auth] register result', { ok: result.ok, reason: result.reason });
    if (result.ok) {
      const fe = String(req.body?.frontend || req.headers.origin || '').trim() || null;
      void scheduleEnsureAfterPortalAuth(req, result.email, fe);
    }
    res.status(200).json(result);
  } catch (err) {
    console.error('[portal-auth] register error:', err?.message || err);
    res.status(500).json({ ok: false, reason: 'DB_ERROR' });
  }
});

/**
 * POST /api/portal-auth/login
 * Body: { email, password }
 * 成功回傳 { ok: true, email, roles } 供前端 setMember 並跳 /portal。
 */
router.post('/login', async (req, res) => {
  console.log('[portal-auth] POST /login received', { origin: req.headers.origin, hasBody: !!req.body });
  try {
    const { email, password } = req.body || {};
    const result = await login(email, password);
    console.log('[portal-auth] login result', { ok: result.ok, reason: result.reason });
    if (result.ok && result.portalAccountId) {
      const fe = String(req.body?.frontend || req.headers.origin || '').trim() || null;
      scheduleEnsurePortalDetailRowsAfterAuth(req, result.portalAccountId, result.email, fe);
    }
    res.status(200).json(result);
  } catch (err) {
    console.error('[portal-auth] login error:', err?.message || err);
    res.status(500).json({ ok: false, reason: 'DB_ERROR' });
  }
});

/**
 * GET /api/portal-auth/verify?token=...
 * 驗證 OAuth 登入後取得的 JWT，回傳 { ok: true, email, roles } 或 { ok: false }。
 */
router.get('/verify', (req, res) => {
  const token = req.query?.token;
  const payload = verifyPortalToken(token);
  if (payload) {
    return res.json({
      ok: true,
      email: payload.email,
      roles: payload.roles || [],
      cleanlemons: payload.cleanlemons ?? null
    });
  }
  res.json({ ok: false });
});

// --- Google OAuth ---
router.get('/google', (req, res, next) => {
  const frontendUrl = getFrontendUrl(req);
  const loginPath = getLoginEntryPath(frontendUrl);
  const callbackBase = getGoogleCallbackBase(req, frontendUrl);
  const strategyName = getGoogleStrategyName(frontendUrl);
  const enquiryFlow =
    String(req.query?.enquiry || '').trim() === '1' || String(req.query?.for || '').trim() === 'enquiry';
  const state = Buffer.from(
    JSON.stringify({ frontend: frontendUrl, ...(enquiryFlow ? { enquiry: true } : {}) }),
    'utf8'
  ).toString('base64url');
  if (!hasGoogleOauthConfig(frontendUrl)) {
    return res.redirect(`${frontendUrl}${loginPath}?error=OAUTH_NOT_CONFIGURED`);
  }
  try {
    console.log('[portal-auth] google start', { frontendUrl, strategyName, callbackBase });
    passport.authenticate(strategyName, {
      scope: ['profile', 'email'],
      session: false,
      callbackURL: `${callbackBase}/api/portal-auth/google/callback`,
      state,
      // 强制显示 Google 账号选择（否则浏览器已登录单账号时常静默跳过）
      prompt: 'select_account',
    })(req, res, next);
  } catch (err) {
    console.error('[portal-auth] google error:', err?.message || err);
    res.redirect(`${frontendUrl}${loginPath}?error=OAUTH_ERROR`);
  }
});

router.get('/google/callback', (req, res, next) => {
  const { frontend: stateFrontend, enquiry } = parseOAuthState(req.query?.state);
  const frontendUrl = stateFrontend || getFrontendUrl(req);
  const loginPath = getLoginEntryPath(frontendUrl);
  const enquiryPath = getEnquiryEntryPath();
  const callbackBase = getGoogleCallbackBase(req, frontendUrl);
  const strategyName = getGoogleStrategyName(frontendUrl);
  const errorPath = enquiry ? enquiryPath : loginPath;
  if (!hasGoogleOauthConfig(frontendUrl)) {
    return res.redirect(`${frontendUrl}${errorPath}?error=OAUTH_NOT_CONFIGURED`);
  }
  try {
    console.log('[portal-auth] google callback', { frontendUrl, strategyName, callbackBase, enquiry });
    passport.authenticate(strategyName, {
      session: false,
      callbackURL: `${callbackBase}/api/portal-auth/google/callback`,
    }, (err, user, info) => {
      if (err) {
        console.error('[portal-auth] google callback error:', err?.message || err);
        return res.redirect(`${frontendUrl}${errorPath}?error=OAUTH_ERROR`);
      }
      if (!user) {
        const reason = info?.reason || 'OAUTH_FAILED';
        console.error('[portal-auth] google callback no user, reason:', reason);
        return res.redirect(`${frontendUrl}${errorPath}?error=${encodeURIComponent(reason)}`);
      }
      void scheduleEnsureAfterPortalAuth(req, user.email, frontendUrl);
      const token = signPortalToken({
        email: user.email,
        roles: user.roles,
        cleanlemons: user.cleanlemons ?? null
      });
      if (enquiry) {
        const nextPath = encodeURIComponent('/enquiry');
        return res.redirect(`${frontendUrl}/auth/callback?token=${encodeURIComponent(token)}&next=${nextPath}`);
      }
      res.redirect(`${frontendUrl}/auth/callback?token=${encodeURIComponent(token)}`);
    })(req, res, next);
  } catch (err) {
    console.error('[portal-auth] google callback exception:', err?.message || err);
    res.redirect(`${frontendUrl}${errorPath}?error=OAUTH_ERROR`);
  }
});

// --- Facebook OAuth（與 Google 相同：frontend query + state 回前端 auth/callback）---
router.get('/facebook', (req, res, next) => {
  const frontendUrl = getFrontendUrl(req);
  const loginPath = getLoginEntryPath(frontendUrl);
  const callbackBase = getGoogleCallbackBase(req, frontendUrl);
  const strategyName = getFacebookStrategyName(frontendUrl);
  const enquiryFlow =
    String(req.query?.enquiry || '').trim() === '1' || String(req.query?.for || '').trim() === 'enquiry';
  const state = Buffer.from(
    JSON.stringify({ frontend: frontendUrl, ...(enquiryFlow ? { enquiry: true } : {}) }),
    'utf8'
  ).toString('base64url');
  if (!hasFacebookOauthConfig(frontendUrl)) {
    return res.redirect(`${frontendUrl}${loginPath}?error=OAUTH_NOT_CONFIGURED`);
  }
  try {
    console.log('[portal-auth] facebook start', { frontendUrl, strategyName, callbackBase });
    passport.authenticate(strategyName, {
      scope: ['email'],
      session: false,
      callbackURL: `${callbackBase}/api/portal-auth/facebook/callback`,
      state,
    })(req, res, next);
  } catch (err) {
    console.error('[portal-auth] facebook error:', err?.message || err);
    res.redirect(`${frontendUrl}${loginPath}?error=OAUTH_ERROR`);
  }
});

router.get('/facebook/callback', (req, res, next) => {
  const { frontend: stateFrontend, enquiry } = parseOAuthState(req.query?.state);
  const frontendUrl = stateFrontend || getFrontendUrl(req);
  const loginPath = getLoginEntryPath(frontendUrl);
  const enquiryPath = getEnquiryEntryPath();
  const callbackBase = getGoogleCallbackBase(req, frontendUrl);
  const strategyName = getFacebookStrategyName(frontendUrl);
  const errorPath = enquiry ? enquiryPath : loginPath;
  if (!hasFacebookOauthConfig(frontendUrl)) {
    return res.redirect(`${frontendUrl}${errorPath}?error=OAUTH_NOT_CONFIGURED`);
  }
  try {
    console.log('[portal-auth] facebook callback', { frontendUrl, strategyName, callbackBase, enquiry });
    passport.authenticate(strategyName, {
      session: false,
      callbackURL: `${callbackBase}/api/portal-auth/facebook/callback`,
    }, (err, user, info) => {
      if (err) {
        console.error('[portal-auth] facebook callback error:', err?.message || err);
        return res.redirect(`${frontendUrl}${errorPath}?error=OAUTH_ERROR`);
      }
      if (!user) {
        const reason = info?.reason || 'OAUTH_FAILED';
        console.error('[portal-auth] facebook callback no user, reason:', reason);
        return res.redirect(`${frontendUrl}${errorPath}?error=${encodeURIComponent(reason)}`);
      }
      void scheduleEnsureAfterPortalAuth(req, user.email, frontendUrl);
      const token = signPortalToken({
        email: user.email,
        roles: user.roles,
        cleanlemons: user.cleanlemons ?? null
      });
      if (enquiry) {
        const nextPath = encodeURIComponent('/enquiry');
        return res.redirect(`${frontendUrl}/auth/callback?token=${encodeURIComponent(token)}&next=${nextPath}`);
      }
      res.redirect(`${frontendUrl}/auth/callback?token=${encodeURIComponent(token)}`);
    })(req, res, next);
  } catch (err) {
    console.error('[portal-auth] facebook callback exception:', err?.message || err);
    res.redirect(`${frontendUrl}${errorPath}?error=OAUTH_ERROR`);
  }
});

/**
 * GET /api/portal-auth/password-status
 * Header: Authorization: Bearer <portal JWT>
 * 回傳 { ok, hasPassword } — hasPassword 表示是否已設可登入的 bcrypt 密碼（OAuth-only 為 false）。
 */
router.get('/password-status', requirePortalToken, async (req, res) => {
  try {
    const result = await getPasswordStatusForEmail(req.portalEmail);
    if (!result.ok) {
      return res.status(400).json(result);
    }
    return res.status(200).json({ ok: true, hasPassword: !!result.hasPassword });
  } catch (err) {
    res.status(500).json({ ok: false, reason: 'DB_ERROR' });
  }
});

/**
 * GET /api/portal-auth/member-roles
 * Header: Authorization: Bearer <portal JWT>
 * 以當前 JWT email 即時讀取 MySQL roles（含 saasadmin），供前端 gate 判斷。
 */
router.get('/member-roles', requirePortalToken, async (req, res) => {
  try {
    const result = await getMemberRoles(req.portalEmail);
    if (!result?.ok) {
      return res.status(400).json({
        ok: false,
        reason: result?.reason || 'ROLE_LOOKUP_FAILED',
      });
    }
    return res.status(200).json({
      ok: true,
      email: result.email,
      roles: result.roles || [],
      cleanlemons: result.cleanlemons ?? null,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, reason: 'DB_ERROR' });
  }
});

/**
 * POST /api/portal-auth/cleanlemons-ensure-employee
 * Header: Authorization: Bearer <portal JWT>
 * Body (optional): { fullName?: string }
 * Upserts `cln_employeedetail` for JWT email; returns fresh `getCleanlemonsPortalContext` for `user.cleanlemons`.
 */
router.post('/cleanlemons-ensure-employee', requirePortalToken, async (req, res) => {
  try {
    const email = req.portalEmail;
    let fullName = String(req.body?.fullName || req.body?.name || '').trim();
    if (!fullName) {
      const [rows] = await pool.query(
        'SELECT fullname FROM portal_account WHERE LOWER(TRIM(email)) = LOWER(TRIM(?)) LIMIT 1',
        [email]
      );
      fullName = rows[0]?.fullname != null ? String(rows[0].fullname).trim() : '';
    }
    const ensured = await ensureEmployeedetailForPortalEmail(email, fullName || null);
    if (!ensured.ok) {
      const code = ensured.reason === 'TABLE_MISSING' ? 503 : 400;
      return res.status(code).json({ ok: false, reason: ensured.reason || 'ENSURE_FAILED' });
    }
    const cleanlemons = await getCleanlemonsPortalContext(email);
    return res.status(200).json({ ok: true, cleanlemons });
  } catch (err) {
    console.error('[portal-auth] cleanlemons-ensure-employee', err?.message || err);
    return res.status(500).json({ ok: false, reason: 'DB_ERROR' });
  }
});

/**
 * POST /api/portal-auth/coliving-ensure-detail
 * Header: Authorization: Bearer <portal JWT>
 * Body: { role: 'tenant' | 'owner' }
 * Upserts `tenantdetail` or `ownerdetail` for JWT email (entry from /tenant or /owner).
 */
router.post('/coliving-ensure-detail', requirePortalToken, async (req, res) => {
  try {
    const role = String(req.body?.role || '').toLowerCase();
    if (role !== 'tenant' && role !== 'owner') {
      return res.status(400).json({ ok: false, reason: 'BAD_ROLE' });
    }
    const ensured = await ensureColivingDetailForPortalEmail(req.portalEmail, role);
    if (!ensured.ok) {
      const code = ensured.reason === 'TABLE_MISSING' ? 503 : 400;
      return res.status(code).json({ ok: false, reason: ensured.reason || 'ENSURE_FAILED' });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[portal-auth] coliving-ensure-detail', err?.message || err);
    return res.status(500).json({ ok: false, reason: 'DB_ERROR' });
  }
});

/**
 * GET /api/portal-auth/profile
 * Header: Authorization: Bearer <portal JWT>
 * 回傳該 email 的會員資料（portal_account，一個 email 一份）；與 tenant/staff/owner 同步用。
 */
router.get('/profile', requirePortalToken, async (req, res) => {
  try {
    const result = await getPortalProfile(req.portalEmail);
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ ok: false, reason: 'DB_ERROR' });
  }
});

/**
 * PUT /api/portal-auth/profile
 * Header: Authorization: Bearer <portal JWT>
 * Body: { fullname?, phone?, address?, nric?, bankname_id?, bankaccount?, accountholder? }
 * 更新 portal_account 並同步到 tenantdetail / staffdetail / ownerdetail（同 email 的列）。
 */
router.put('/profile', requirePortalToken, async (req, res) => {
  try {
    const result = await updatePortalProfile(req.portalEmail, req.body || {});
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ ok: false, reason: 'DB_ERROR' });
  }
});

/**
 * POST /api/portal-auth/forgot-password
 * Body: { email }
 * 若 email 在 portal_account 則寫入 reset code、發送驗證信；不透露帳號是否存在。
 */
router.post('/forgot-password', async (req, res) => {
  try {
    const email = (req.body && req.body.email) ? String(req.body.email).trim() : '';
    const result = await requestPasswordReset(email);
    if (!result.ok && result.reason === 'NO_ACCOUNT') {
      return res.status(200).json({ ok: true });
    }
    if (!result.ok) {
      console.error('[portal-auth] forgot-password failed:', result.reason);
    }
    res.status(200).json(result);
  } catch (err) {
    console.error('[portal-auth] forgot-password error:', err?.message || err);
    res.status(500).json({ ok: false, reason: 'DB_ERROR' });
  }
});

/**
 * POST /api/portal-auth/reset-password
 * Body: { email, code, newPassword }
 * 驗證 code 後更新密碼並清除 reset 記錄。
 */
router.post('/reset-password', async (req, res) => {
  try {
    const { email, code, newPassword } = req.body || {};
    const result = await confirmPasswordReset(email, code, newPassword);
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ ok: false, reason: 'DB_ERROR' });
  }
});

/**
 * POST /api/portal-auth/change-password
 * Body: { email, currentPassword, newPassword }
 * 登入後修改密碼：驗證 currentPassword 後更新為 newPassword。
 */
router.post('/change-password', async (req, res) => {
  try {
    const { email, currentPassword, newPassword } = req.body || {};
    const result = await changePassword(email, currentPassword, newPassword);
    res.status(200).json(result);
  } catch (err) {
    console.error('[portal-auth] change-password error:', err?.message || err);
    res.status(500).json({ ok: false, reason: 'DB_ERROR' });
  }
});

module.exports = router;
