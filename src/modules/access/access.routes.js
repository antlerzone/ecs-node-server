/**
 * Access context API – migrated from Wix backend/access/manage.jsw.
 * Frontend (Wix JSW / Next portal) calls with email to get access context.
 * Member = one email; all email comparisons are case-insensitive (LOWER(TRIM)).
 */

const express = require('express');
const router = express.Router();
const {
  getAccessContextByEmail,
  getAccessContextByEmailAndClient,
  getMemberRoles
} = require('./access.service');
const {
  getPortalProfile,
  updatePortalProfile,
  getPasswordStatusForEmail
} = require('../portal-auth/portal-auth.service');
const { ensureColivingDetailForPortalEmail } = require('../portal-auth/portal-detail-ensure.service');

/**
 * POST /api/access/context
 * Body: { email: string }
 * Returns: { ok, reason, staff?, client?, plan?, capability?, credit?, expired? }
 */
router.post('/context', async (req, res, next) => {
  try {
    const email = req.body?.email;
    const result = await getAccessContextByEmail(email);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/access/context?email=xxx
 * Same response as POST (for convenience).
 */
router.get('/context', async (req, res, next) => {
  try {
    const email = req.query?.email;
    const result = await getAccessContextByEmail(email);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/access/context/with-client
 * Body: { email: string, clientId: string }
 * Returns same shape as /context but for the chosen client (when member has multiple staff roles).
 */
router.post('/context/with-client', async (req, res, next) => {
  try {
    const email = req.body?.email;
    const clientId = req.body?.clientId;
    const result = await getAccessContextByEmailAndClient(email, clientId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/access/member-roles
 * Body: { email: string }
 * Returns: { ok, email (normalized), roles: [ { type: 'staff'|'tenant'|'owner'|'saas_admin', ... } ] }
 * For portal: one email = one member; use roles to show "choose identity" then call /context or /context/with-client.
 */
router.post('/member-roles', async (req, res, next) => {
  try {
    const email = req.body?.email;
    const result = await getMemberRoles(email);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/access/portal-profile
 * Body: { email }
 * Same as GET /api/portal-auth/profile but uses apiAuth (Next proxy ECS token) — no browser portal JWT required.
 */
router.post('/portal-profile', async (req, res, next) => {
  try {
    const email = req.body?.email;
    const result = await getPortalProfile(email);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/access/portal-profile-save
 * Body: { email, ...updatePortalProfile fields }; clientId is stripped.
 */
router.post('/portal-profile-save', async (req, res, next) => {
  try {
    const raw = req.body || {};
    const email = raw.email;
    const payload = { ...raw };
    delete payload.email;
    delete payload.clientId;
    const result = await updatePortalProfile(email, payload);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/access/portal-password-status
 * Body: { email }
 * Same as GET /api/portal-auth/password-status without portal JWT.
 */
router.post('/portal-password-status', async (req, res, next) => {
  try {
    const email = req.body?.email;
    const result = await getPasswordStatusForEmail(email);
    if (!result.ok) {
      return res.status(400).json(result);
    }
    return res.status(200).json({ ok: true, hasPassword: !!result.hasPassword });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/access/coliving-ensure-detail
 * Body: { email, role: 'tenant' | 'owner' }
 * Same as POST /api/portal-auth/coliving-ensure-detail without portal JWT.
 */
router.post('/coliving-ensure-detail', async (req, res, next) => {
  try {
    const role = String(req.body?.role || '').toLowerCase();
    if (role !== 'tenant' && role !== 'owner') {
      return res.status(400).json({ ok: false, reason: 'BAD_ROLE' });
    }
    const email = req.body?.email;
    const ensured = await ensureColivingDetailForPortalEmail(email, role);
    if (!ensured.ok) {
      const code = ensured.reason === 'TABLE_MISSING' ? 503 : 400;
      return res.status(code).json({ ok: false, reason: ensured.reason || 'ENSURE_FAILED' });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
