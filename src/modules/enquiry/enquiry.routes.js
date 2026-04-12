/**
 * Enquiry API – public page (no auth).
 * GET/POST /api/enquiry/plans, /addons, /banks, POST /api/enquiry/submit
 */

const express = require('express');
const router = express.Router();
const { verifyPortalToken } = require('../portal-auth/portal-auth.service');
const { normalizeEmail } = require('../access/access.service');
const {
  getPlansPublic,
  getAddonsPublic,
  getBanksPublic,
  getCreditPlansPublic,
  submitEnquiry,
  getOperatorProfileByEmail,
  submitEnquiryForVerifiedEmail,
  ensureOperatorForVerifiedEmail,
  updateEnquiryContactForVerifiedEmail,
  submitSgdPlanEnquiryForVerifiedEmail
} = require('./enquiry.service');
const { createPlanBillplzCheckout } = require('./enquiry-saas-checkout.service');
const { syncEnquiryPricingPlanFromXenditAfterReturn } = require('../billing/xendit-saas-platform.service');
const { syncEnquiryPricingPlanFromStripeAfterReturn } = require('../billing/saas-stripe-platform.service');

function requirePortalJwt(req, res, next) {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const payload = verifyPortalToken(token);
  if (!payload?.email) {
    return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
  }
  req.portalEmail = normalizeEmail(payload.email);
  next();
}

router.get('/plans', async (req, res, next) => {
  try {
    const items = await getPlansPublic();
    res.json({ ok: true, items });
  } catch (err) {
    next(err);
  }
});

router.post('/plans', async (req, res, next) => {
  try {
    const items = await getPlansPublic();
    res.json({ ok: true, items });
  } catch (err) {
    next(err);
  }
});

router.get('/addons', async (req, res, next) => {
  try {
    const items = await getAddonsPublic();
    res.json({ ok: true, items });
  } catch (err) {
    next(err);
  }
});

router.post('/addons', async (req, res, next) => {
  try {
    const items = await getAddonsPublic();
    res.json({ ok: true, items });
  } catch (err) {
    next(err);
  }
});

router.get('/banks', async (req, res, next) => {
  try {
    const result = await getBanksPublic();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/banks', async (req, res, next) => {
  try {
    const result = await getBanksPublic();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/credit-plans', async (req, res, next) => {
  try {
    const items = await getCreditPlansPublic();
    res.json({ ok: true, items });
  } catch (err) {
    next(err);
  }
});

router.post('/credit-plans', async (req, res, next) => {
  try {
    const items = await getCreditPlansPublic();
    res.json({ ok: true, items });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/enquiry/submit
 * Body: { title, email, currency?, country?, profilePhotoUrl?, contact?, accountNumber?, bankId? }
 * Returns: { ok, clientId, email } or { ok: false, reason }. Demo 请用 demo.colivingjb.com。
 */
router.post('/submit', async (req, res, next) => {
  try {
    const result = await submitEnquiry(req.body || {});
    if (result.ok === false) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    console.error('[enquiry] submit route', err);
    res.status(500).json({
      ok: false,
      reason: err?.code === 'ER_DUP_ENTRY' ? 'EMAIL_ALREADY_REGISTERED' : 'SUBMIT_FAILED'
    });
  }
});

/**
 * POST /api/enquiry/me — Header: Authorization: Bearer portal JWT
 */
router.post('/me', requirePortalJwt, async (req, res, next) => {
  try {
    const result = await getOperatorProfileByEmail(req.portalEmail);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/enquiry/ensure-operator — 登入後若無 operatordetail 則建立最小檔案（body: { country?: 'MY'|'SG', contact?: string }）
 */
router.post('/ensure-operator', requirePortalJwt, async (req, res, next) => {
  try {
    const result = await ensureOperatorForVerifiedEmail(req.portalEmail, req.body || {});
    if (result.ok === false) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    console.error('[enquiry] ensure-operator', err);
    next(err);
  }
});

/**
 * POST /api/enquiry/update-contact — 補寫手機（已有 operatordetail；body: { contact }）
 */
router.post('/update-contact', requirePortalJwt, async (req, res, next) => {
  try {
    const result = await updateEnquiryContactForVerifiedEmail(req.portalEmail, req.body || {});
    if (result.ok === false) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    console.error('[enquiry] update-contact', err);
    next(err);
  }
});

/**
 * POST /api/enquiry/submit-profile — 登入後填寫公司資料（email 以 JWT 為準）
 */
router.post('/submit-profile', requirePortalJwt, async (req, res, next) => {
  try {
    const result = await submitEnquiryForVerifiedEmail(req.portalEmail, req.body || {});
    if (result.ok === false) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    console.error('[enquiry] submit-profile', err);
    res.status(500).json({
      ok: false,
      reason: err?.code === 'ER_DUP_ENTRY' ? 'EMAIL_ALREADY_REGISTERED' : 'SUBMIT_FAILED'
    });
  }
});

/**
 * POST /api/enquiry/submit-sgd-plan-enquiry — MYR/SGD：写入 client_profile 方案意向（手动付款 / 跳过线上卡费），SaaS Admin → Enquiry 可见
 * Body: { planId }
 */
router.post('/submit-sgd-plan-enquiry', requirePortalJwt, async (req, res, next) => {
  try {
    const planId = req.body?.planId != null ? String(req.body.planId).trim() : '';
    const receiptUrl = req.body?.receiptUrl != null ? String(req.body.receiptUrl).trim() : '';
    const result = await submitSgdPlanEnquiryForVerifiedEmail(req.portalEmail, {
      planId,
      ...(receiptUrl ? { receiptUrl } : {})
    });
    if (result.ok === false) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[enquiry] submit-sgd-plan-enquiry', err);
    next(err);
  }
});

/**
 * POST /api/enquiry/create-plan-billplz — Coliving SaaS Stripe（Malaysia test）；路径名沿用。
 * Body: { planId, remark? }
 */
router.post('/create-plan-billplz', requirePortalJwt, async (req, res, next) => {
  try {
    const planId = req.body?.planId != null ? String(req.body.planId).trim() : '';
    const remark = req.body?.remark != null ? String(req.body.remark).trim() : '';
    const result = await createPlanBillplzCheckout({
      email: req.portalEmail,
      planId,
      remark: remark || undefined
    });
    if (result.ok === false) {
      const status =
        result.reason === 'UNAUTHORIZED' ? 401 : result.reason === 'NO_OPERATOR_PROFILE' ? 400 : 400;
      return res.status(status).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[enquiry] create-plan-billplz', err);
    next(err);
  }
});

/**
 * POST /api/enquiry/xendit-plan-sync — 支付完成回跳后轮询 Xendit 并套用方案（不依赖 staffdetail；JWT 邮箱须与 operatordetail 一致）
 * Body: { pricingplanlogId }
 */
router.post('/xendit-plan-sync', requirePortalJwt, async (req, res, next) => {
  try {
    const pricingplanlogId = req.body?.pricingplanlogId ?? req.body?.pricingPlanLogId;
    const result = await syncEnquiryPricingPlanFromXenditAfterReturn(req.portalEmail, pricingplanlogId);
    res.json(result);
  } catch (err) {
    console.error('[enquiry] xendit-plan-sync', err);
    next(err);
  }
});

/**
 * POST /api/enquiry/stripe-plan-sync — Stripe 回跳后轮询补单（需 session_id）
 * Body: { pricingplanlogId, sessionId }
 */
router.post('/stripe-plan-sync', requirePortalJwt, async (req, res, next) => {
  try {
    const pricingplanlogId = req.body?.pricingplanlogId ?? req.body?.pricingPlanLogId;
    const sessionId = req.body?.sessionId ?? req.body?.session_id;
    const result = await syncEnquiryPricingPlanFromStripeAfterReturn(req.portalEmail, pricingplanlogId, sessionId);
    res.json(result);
  } catch (err) {
    console.error('[enquiry] stripe-plan-sync', err);
    next(err);
  }
});

module.exports = router;
