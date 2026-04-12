/**
 * Admin Dashboard API – list feedback+refund, update/delete feedback and refunddeposit.
 * All endpoints require email (resolve to client via access context); protected by apiAuth.
 */

const express = require('express');
const router = express.Router();
const { getAccessContextByEmail } = require('../access/access.service');
const { getClientIp } = require('../../utils/requestIp');
const { afterSignUpdate, operatorSignerStaffVarsFromAccessStaff } = require('../agreement/agreement.service');
const {
  getAdminList,
  updateFeedback,
  updateRefundDeposit,
  updateCommissionRelease,
  backfillCommissionReleasesForClient,
  removeFeedback,
  removeRefundDeposit,
  updateAgreementOperatorSign,
  getAgreementForOperator,
  retryAgreementFinalPdf,
  listOwnerOperatorAgreementsForClient,
  deleteAgreementBeforeFinalHash
} = require('./admindashboard.service');
const {
  voidCommissionRelease,
  getCommissionReleaseReceiptUrl
} = require('../commission-release/commission-release.service');
const { bulkUpdateRefundDeposit } = require('./admindashboard.service');
const { getTenancyList, getTenancyFilters } = require('../tenancysetting/tenancysetting.service');

function getEmail(req) {
  return req.body?.email ?? req.query?.email ?? null;
}

function buildAgreementStaffVarsFromCtx(ctx) {
  return operatorSignerStaffVarsFromAccessStaff(ctx?.staff || {});
}

async function requireClient(req, res, next) {
  const path = (req.originalUrl || req.url || req.path || '').split('?')[0];
  const email = getEmail(req);
  console.log('[admindashboard requireClient]', path, 'req.clientId=', req.clientId ?? '(null)', 'body.email=', email ?? '(none)', 'req.apiUser=', !!req.apiUser);
  if (req.clientId != null && req.client) {
    console.log('[admindashboard requireClient] pass (has client)', path);
    req.ctx = { client: req.client };
    return next();
  }
  // Portal proxy calls with empty body (no email). Allow through so list handlers return empty data instead of 403.
  if (req.apiUser && !email) {
    console.log('[admindashboard requireClient] pass (apiUser + no email → noClientAllowEmpty)', path);
    req.clientId = null;
    req.noClientAllowEmpty = true;
    return next();
  }
  if (req.apiUser && email) {
    const ctx = await getAccessContextByEmail(email);
    const clientId = ctx.client?.id ?? null;
    // Portal: email may not resolve to a client. Still allow through so list handlers return empty data.
    if (!ctx.ok || !clientId) {
      console.log('[admindashboard requireClient] pass (apiUser+email but no client → noClientAllowEmpty)', path, 'ctx.reason=', ctx.reason);
      req.clientId = null;
      req.noClientAllowEmpty = true;
      return next();
    }
    req.clientId = clientId;
    req.ctx = ctx;
    console.log('[admindashboard requireClient] pass (clientId from email)', path);
    return next();
  }
  if (!email) {
    console.log('[admindashboard requireClient] 400 NO_EMAIL', path);
    return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
  }
  const ctx = await getAccessContextByEmail(email);
  if (!ctx.ok) {
    console.log('[admindashboard requireClient] 403 ACCESS_DENIED', path, 'reason=', ctx.reason);
    return res.status(403).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
  }
  const clientId = ctx.client?.id;
  if (!clientId) {
    console.log('[admindashboard requireClient] 403 NO_CLIENT', path);
    return res.status(403).json({ ok: false, reason: 'NO_CLIENT' });
  }
  req.clientId = clientId;
  req.ctx = ctx;
  console.log('[admindashboard requireClient] pass (clientId from email)', path);
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
    if (req.noClientAllowEmpty) {
      console.log('[admindashboard /list] noClientAllowEmpty → empty list');
      return res.json({ ok: true, items: [], total: 0, totalPages: 0, currentPage: 1 });
    }
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
    console.error('[admindashboard/list]', err?.code || err?.name, err?.message);
    if (err?.sqlMessage) console.error('[admindashboard/list] sqlMessage:', err.sqlMessage);
    next(err);
  }
});

/** POST /api/admindashboard/feedback/update – set done, remark */
router.post('/feedback/update', requireClient, async (req, res, next) => {
  try {
    const id = req.body?.id;
    const payload = {
      done: req.body?.done,
      remark: req.body?.remark,
      message_append: req.body?.message_append
        ? {
            text: req.body.message_append.text,
            visibleToTenant: req.body.message_append.visibleToTenant,
            attachments: req.body.message_append.attachments
          }
        : undefined,
      operator_done_at: req.body?.operator_done_at,
      operator_done_photo_append: req.body?.operator_done_photo_append,
      operator_done_photo_replace: req.body?.operator_done_photo_replace
    };
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

/** POST /api/admindashboard/refund/update – set status/done; optional refundAmount for completed; accounting only on completed */
router.post('/refund/update', requireClient, async (req, res, next) => {
  try {
    const id = req.body?.id;
    const payload = { done: req.body?.done };
    if (req.body?.status != null) payload.status = req.body.status;
    if (req.body?.refundAmount != null && req.body?.refundAmount !== '') {
      payload.refundAmount = req.body.refundAmount;
    }
    if (req.body?.paymentDate != null) payload.paymentDate = req.body.paymentDate;
    if (req.body?.paymentMethod != null) payload.paymentMethod = req.body.paymentMethod;
    if (req.body?.skipAccounting === true || req.body?.skipAccounting === 'true' || req.body?.skipAccounting === 1) payload.skipAccounting = true;
    const result = await updateRefundDeposit(req.clientId, id, payload);
    if (!result.ok) {
      return res.status(result.reason === 'NOT_FOUND' ? 404 : 400).json(result);
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/admindashboard/refund/bulk-update – body: { ids: string[], done?/status?, paymentDate?, paymentMethod?, skipAccounting? } */
router.post('/refund/bulk-update', requireClient, async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const payload = {};
    if (req.body?.done != null) payload.done = req.body.done;
    if (req.body?.status != null) payload.status = req.body.status;
    if (req.body?.paymentDate != null) payload.paymentDate = req.body.paymentDate;
    if (req.body?.paymentMethod != null) payload.paymentMethod = req.body.paymentMethod;
    if (req.body?.skipAccounting === true || req.body?.skipAccounting === 'true' || req.body?.skipAccounting === 1) payload.skipAccounting = true;
    const result = await bulkUpdateRefundDeposit(req.clientId, ids, payload);
    if (!result.ok) return res.status(400).json(result);
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

/** POST /api/admindashboard/commission-release/backfill – create missing commission_release from tenancy (staff + commission). Idempotent. */
router.post('/commission-release/backfill', requireClient, async (req, res, next) => {
  try {
    if (req.noClientAllowEmpty) {
      return res.json({ ok: false, reason: 'NO_CLIENT' });
    }
    const result = await backfillCommissionReleasesForClient(req.clientId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/admindashboard/commission-release/update – set release_date, release_amount, status (paid|pending), remark, staff_id (for money out to staff when Bukku) */
router.post('/commission-release/update', requireClient, async (req, res, next) => {
  try {
    const id = req.body?.id;
    const payload = {};
    if (req.body?.release_date !== undefined) payload.release_date = req.body.release_date;
    if (req.body?.release_amount !== undefined) payload.release_amount = req.body.release_amount;
    if (req.body?.status !== undefined) payload.status = req.body.status;
    if (req.body?.reject_reason !== undefined) payload.reject_reason = req.body.reject_reason;
    if (req.body?.remark !== undefined) payload.remark = req.body.remark;
    if (req.body?.staff_id !== undefined && req.body?.staff_id !== '') payload.staff_id = req.body.staff_id;
    if (req.body?.payment_method !== undefined) payload.payment_method = req.body.payment_method;
    if (req.body?.skipAccounting === true || req.body?.skipAccounting === 'true' || req.body?.skipAccounting === 1) {
      payload.skipAccounting = true;
    }
    if (
      req.body?.skipAccountingVoid === true ||
      req.body?.skipAccountingVoid === 'true' ||
      req.body?.skipAccountingVoid === 1
    ) {
      payload.skipAccountingVoid = true;
    }
    const result = await updateCommissionRelease(req.clientId, id, payload);
    if (!result.ok) {
      return res.status(result.reason === 'NOT_FOUND' ? 404 : 400).json(result);
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/admindashboard/commission-release/void – revert paid row to pending; void Bukku money out / Xero SPEND when linked */
router.post('/commission-release/void', requireClient, async (req, res, next) => {
  try {
    if (req.noClientAllowEmpty) {
      return res.json({ ok: false, reason: 'NO_CLIENT' });
    }
    const id = req.body?.id;
    const void_reason = req.body?.void_reason;
    const result = await voidCommissionRelease(req.clientId, id, void_reason);
    if (!result.ok) {
      return res.status(result.reason === 'NOT_FOUND' ? 404 : 400).json(result);
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/admindashboard/commission-release/receipt-url – Bukku banking expense deep link when bukku_expense_id + subdomain */
router.post('/commission-release/receipt-url', requireClient, async (req, res, next) => {
  try {
    if (req.noClientAllowEmpty) {
      return res.json({ ok: false, reason: 'NO_CLIENT' });
    }
    const id = req.body?.id;
    const result = await getCommissionReleaseReceiptUrl(req.clientId, id);
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
    if (req.noClientAllowEmpty) {
      return res.json({ ok: true, items: [], total: 0, totalPages: 0, currentPage: 1 });
    }
    const opts = {
      propertyId: req.body?.propertyId,
      status: req.body?.status,
      search: req.body?.search,
      page: req.body?.page,
      pageSize: req.body?.pageSize,
      limit: req.body?.limit
    };
    // Match tenancysetting/list: submitby_id is staffdetail.id; client_user.staff.id is wrong for this filter.
    const staffId =
      req.ctx?.staff?.permission?.admin || !req.ctx?.staffDetailId ? null : req.ctx.staffDetailId;
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
    if (req.noClientAllowEmpty) {
      return res.json({ ok: true, properties: [], statusOptions: [] });
    }
    const result = await getTenancyFilters(req.clientId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/admindashboard/agreement/owner-operator-list – all owner_operator agreements for client (Operator → Agreements). Body: { email } */
router.post('/agreement/owner-operator-list', requireClient, async (req, res, next) => {
  try {
    if (req.noClientAllowEmpty) {
      return res.json({ ok: true, items: [] });
    }
    const items = await listOwnerOperatorAgreementsForClient(req.clientId);
    res.json({ ok: true, items });
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
    const operatorSigner = buildAgreementStaffVarsFromCtx(req.ctx);
    const result = await updateAgreementOperatorSign(req.clientId, agreementId, {
      operatorsign,
      operatorSignedIp,
      operatorSigner
    });
    if (!result.ok) {
      return res.status(result.reason === 'NOT_FOUND' ? 404 : 400).json(result);
    }
    try {
      const staffVars = buildAgreementStaffVarsFromCtx(req.ctx);
      await afterSignUpdate(agreementId, { staffVars });
    } catch (hookErr) {
      console.error('[admindashboard] afterSignUpdate', hookErr?.message || hookErr);
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/admindashboard/agreement/retry-final-pdf – body: { agreementId }. When fully signed but still not completed, regenerate final PDF (Drive). */
router.post('/agreement/retry-final-pdf', requireClient, async (req, res, next) => {
  try {
    if (!req.clientId) {
      return res.status(403).json({ ok: false, reason: 'NO_CLIENT' });
    }
    const agreementId = req.body?.agreementId;
    if (!agreementId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_AGREEMENT_ID' });
    }
    const staffVars = buildAgreementStaffVarsFromCtx(req.ctx);
    const result = await retryAgreementFinalPdf(req.clientId, agreementId, { staffVars });
    if (!result.ok) {
      const st =
        result.reason === 'NOT_FOUND'
          ? 404
          : result.reason === 'ALREADY_COMPLETED'
            ? 409
            : 400;
      return res.status(st).json(result);
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/admindashboard/agreement/delete – body: { agreementId }. Deletes only when hash_final is empty; no credit refund. */
router.post('/agreement/delete', requireClient, async (req, res, next) => {
  try {
    if (!req.clientId) {
      return res.status(403).json({ ok: false, reason: 'NO_CLIENT' });
    }
    const agreementId = req.body?.agreementId;
    if (!agreementId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_AGREEMENT_ID' });
    }
    const result = await deleteAgreementBeforeFinalHash(req.clientId, agreementId);
    if (!result.ok) {
      const st =
        result.reason === 'NOT_FOUND'
          ? 404
          : result.reason === 'FINAL_HASH_EXISTS'
            ? 409
            : 400;
      return res.status(st).json(result);
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
