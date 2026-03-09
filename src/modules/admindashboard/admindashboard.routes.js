/**
 * Admin Dashboard API – list feedback+refund, update/delete feedback and refunddeposit.
 * All endpoints require email (resolve to client via access context); protected by apiAuth.
 */

const express = require('express');
const router = express.Router();
const { getAccessContextByEmail } = require('../access/access.service');
const { getClientIp } = require('../../utils/requestIp');
const { afterSignUpdate } = require('../agreement/agreement.service');
const {
  getAdminList,
  updateFeedback,
  updateRefundDeposit,
  removeFeedback,
  removeRefundDeposit,
  updateAgreementOperatorSign,
  getAgreementForOperator
} = require('./admindashboard.service');
const { getTenancyList, getTenancyFilters } = require('../tenancysetting/tenancysetting.service');

function getEmail(req) {
  return req.body?.email ?? req.query?.email ?? null;
}

async function requireClient(req, res, next) {
  const email = getEmail(req);
  if (!email) {
    return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
  }
  const ctx = await getAccessContextByEmail(email);
  if (!ctx.ok) {
    return res.status(403).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
  }
  const clientId = ctx.client?.id;
  if (!clientId) {
    return res.status(403).json({ ok: false, reason: 'NO_CLIENT' });
  }
  req.clientId = clientId;
  req.ctx = ctx;
  next();
}

/**
 * POST /api/admindashboard/list
 * Body: { email, filterType?, search?, sort?, page?, pageSize?, limit? }
 * filterType: 'ALL' | 'Feedback' | 'Refund'
 * sort: 'new' | 'old'
 * limit: optional, max 2000; when set, return up to limit items (for frontend cache) + total
 * Returns: { ok: true, items, total, totalPages?, currentPage? }
 */
router.post('/list', requireClient, async (req, res, next) => {
  try {
    const opts = {
      filterType: req.body?.filterType,
      search: req.body?.search,
      sort: req.body?.sort,
      page: req.body?.page,
      pageSize: req.body?.pageSize,
      limit: req.body?.limit
    };
    const result = await getAdminList(req.clientId, opts);
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

/** POST /api/admindashboard/feedback/update – set done, remark */
router.post('/feedback/update', requireClient, async (req, res, next) => {
  try {
    const id = req.body?.id;
    const payload = { done: req.body?.done, remark: req.body?.remark };
    const result = await updateFeedback(req.clientId, id, payload);
    if (!result.ok) {
      return res.status(result.reason === 'NOT_FOUND' ? 404 : 400).json(result);
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/admindashboard/feedback/remove – delete feedback */
router.post('/feedback/remove', requireClient, async (req, res, next) => {
  try {
    const id = req.body?.id;
    const result = await removeFeedback(req.clientId, id);
    if (!result.ok) {
      return res.status(result.reason === 'NOT_FOUND' ? 404 : 400).json(result);
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/admindashboard/refund/update – set done; optional refundAmount (partial refund, remainder = forfeit) */
router.post('/refund/update', requireClient, async (req, res, next) => {
  try {
    const id = req.body?.id;
    const payload = { done: req.body?.done };
    if (req.body?.refundAmount != null && req.body?.refundAmount !== '') {
      payload.refundAmount = req.body.refundAmount;
    }
    const result = await updateRefundDeposit(req.clientId, id, payload);
    if (!result.ok) {
      return res.status(result.reason === 'NOT_FOUND' ? 404 : 400).json(result);
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/admindashboard/refund/remove – delete refunddeposit */
router.post('/refund/remove', requireClient, async (req, res, next) => {
  try {
    const id = req.body?.id;
    const result = await removeRefundDeposit(req.clientId, id);
    if (!result.ok) {
      return res.status(result.reason === 'NOT_FOUND' ? 404 : 400).json(result);
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/admindashboard/tenancy-list – body: { email, propertyId?, status?, search?, page?, pageSize?, limit? }. Uses tenancysetting. Only tenancies created by current staff (submitby_id) are returned. */
router.post('/tenancy-list', requireClient, async (req, res, next) => {
  try {
    const opts = {
      propertyId: req.body?.propertyId,
      status: req.body?.status,
      search: req.body?.search,
      page: req.body?.page,
      pageSize: req.body?.pageSize,
      limit: req.body?.limit
    };
    const staffId = req.ctx?.staff?.id || null;
    if (staffId) opts.staffId = staffId;
    const result = await getTenancyList(req.clientId, opts);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/admindashboard/tenancy-filters – body: { email }. Returns properties + statusOptions. */
router.post('/tenancy-filters', requireClient, async (req, res, next) => {
  try {
    const result = await getTenancyFilters(req.clientId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/admindashboard/agreement/for-operator – get one agreement by id (same shape as list item). Body: { agreementId } */
router.post('/agreement/for-operator', requireClient, async (req, res, next) => {
  try {
    const agreementId = req.body?.agreementId;
    const item = await getAgreementForOperator(req.clientId, agreementId);
    if (!item) {
      return res.status(404).json({ ok: false, reason: 'NOT_FOUND' });
    }
    res.json({ ok: true, item });
  } catch (err) {
    next(err);
  }
});

/** POST /api/admindashboard/agreement/operator-sign – staff signs agreement (operatorsign). Body: { agreementId, operatorsign }. Records client IP. Hook: first sign→locked, full sign→final PDF. */
router.post('/agreement/operator-sign', requireClient, async (req, res, next) => {
  try {
    const { agreementId, operatorsign } = req.body || {};
    const operatorSignedIp = getClientIp(req);
    const result = await updateAgreementOperatorSign(req.clientId, agreementId, { operatorsign, operatorSignedIp });
    if (!result.ok) {
      return res.status(result.reason === 'NOT_FOUND' ? 404 : 400).json(result);
    }
    try {
      await afterSignUpdate(agreementId);
    } catch (hookErr) {
      console.error('[admindashboard] afterSignUpdate', hookErr?.message || hookErr);
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
