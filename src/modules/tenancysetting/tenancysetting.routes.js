/**
 * Tenancy Setting API – list/filters/extend/change/terminate/cancel/agreement for Wix tenant management page.
 * Requires email for access context; staff must have tenantdetail or admin permission.
 */

const express = require('express');
const router = express.Router();
const { formatApiResponseDates } = require('../../utils/dateMalaysia');
const { getAccessContextByEmail } = require('../access/access.service');
const {
  getTenancyList,
  getTenancyFilters,
  getRoomsForChange,
  previewChangeRoomProrate,
  previewChangeRoomTenancy,
  getExtendOptions,
  previewExtendTenancy,
  extendTenancy,
  changeRoom,
  terminateTenancy,
  getTerminateContext,
  saveCheckoutHandover,
  saveCheckinHandover,
  cancelBooking,
  getAgreementTemplates,
  insertAgreement,
  retryPendingAgreementDraftForClient
} = require('./tenancysetting.service');
const { listHandoverScheduleLog } = require('./handover-schedule-log.service');
const { updateTenancy: updateTenancyOp } = require('./tenancy-update.service');
const {
  submitTenantReview,
  getTenantPublicProfileById,
  getLatestTenantReviewForOperator,
  submitOwnerReview,
  getLatestOwnerReviewForOperator,
  getOwnerPublicProfileById
} = require('./tenant-review.service');

function getEmail(req) {
  return req.body?.email ?? req.query?.email ?? null;
}

router.use((req, res, next) => {
  console.log('[tenancysetting]', req.method, req.path, 'email=', req.body?.email ? 'present' : 'missing');
  next();
});

async function requireCtx(req, res, next) {
  if (req.clientId != null && req.client) {
    req.ctx = { client: req.client };
    return next();
  }
  const email = getEmail(req);
  if (req.apiUser && !email) {
    return res.status(403).json({ ok: false, reason: 'API_USER_NOT_BOUND_TO_CLIENT', message: 'API user must be bound to a client to access this resource' });
  }
  if (req.apiUser && email) {
    try {
      const ctx = await getAccessContextByEmail(email);
      if (!ctx.ok) return res.status(403).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
      if (!ctx.staff?.permission?.tenantdetail && !ctx.staff?.permission?.admin) {
        return res.status(403).json({ ok: false, reason: 'NO_PERMISSION' });
      }
      if (!ctx.client?.id) return res.status(403).json({ ok: false, reason: 'NO_CLIENT' });
      req.clientId = ctx.client.id;
      req.ctx = ctx;
      return next();
    } catch (e) {
      return next(e);
    }
  }
  if (!email) {
    return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
  }
  try {
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) {
      return res.status(403).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    }
    if (!ctx.staff?.permission?.tenantdetail && !ctx.staff?.permission?.admin) {
      return res.status(403).json({ ok: false, reason: 'NO_PERMISSION' });
    }
    if (!ctx.client?.id) {
      return res.status(403).json({ ok: false, reason: 'NO_CLIENT' });
    }
    req.clientId = ctx.client.id;
    req.ctx = ctx;
    next();
  } catch (err) {
    next(err);
  }
}

/** POST /api/tenancysetting/list – body: { email, propertyId?, status?, search?, sort?, page?, pageSize?, limit? } */
router.post('/list', requireCtx, async (req, res, next) => {
  try {
    // tenancy.submitby_id FK → staffdetail.id only. client_user.staff.id is client_user.id — must NOT filter by it.
    const staffId =
      req.ctx?.staff?.permission?.admin || !req.ctx?.staffDetailId ? null : req.ctx.staffDetailId;
    const clientId = req.ctx.client.id;
    const opts = {
      propertyId: req.body?.propertyId,
      status: req.body?.status,
      search: req.body?.search,
      sort: req.body?.sort,
      page: req.body?.page,
      pageSize: req.body?.pageSize,
      limit: req.body?.limit
    };
    if (staffId) opts.staffId = staffId;
    const result = await getTenancyList(clientId, opts);
    formatApiResponseDates(result);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/tenancysetting/filters – body: { email } */
router.post('/filters', requireCtx, async (req, res, next) => {
  try {
    const result = await getTenancyFilters(req.ctx.client.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/tenancysetting/rooms-for-change – body: { email, currentRoomId? } */
router.post('/rooms-for-change', requireCtx, async (req, res, next) => {
  try {
    const result = await getRoomsForChange(req.ctx.client.id, req.body?.currentRoomId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/tenancysetting/change-preview – body: { email, oldRental, newRental, changeDate } */
router.post('/change-preview', requireCtx, async (req, res, next) => {
  try {
    const result = await previewChangeRoomProrate(req.ctx.client.id, {
      oldRental: req.body?.oldRental,
      newRental: req.body?.newRental,
      changeDate: req.body?.changeDate
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/tenancysetting/change-room-preview – same body shape as /change (no handover); returns extend-preview-like Summary rows */
router.post('/change-room-preview', requireCtx, async (req, res, next) => {
  try {
    const result = await previewChangeRoomTenancy(req.ctx.client.id, req.body?.tenancyId, {
      newRoomId: req.body?.newRoomId,
      newRental: req.body?.newRental,
      newEnd: req.body?.newEnd,
      agreementFees: req.body?.agreementFees,
      changeDate: req.body?.changeDate,
      newDeposit: req.body?.newDeposit,
      newParkingMonthly: req.body?.newParkingMonthly
    });
    res.json(result);
  } catch (err) {
    if (err.message === 'TENANCY_NOT_FOUND') {
      return res.status(404).json({ ok: false, success: false, message: err.message });
    }
    if (err.message === 'ROOM_NOT_AVAILABLE') {
      return res.status(400).json({ ok: false, success: false, message: err.message });
    }
    if (
      [
        'INVALID_CHANGE_DATE',
        'INVALID_NEW_END',
        'INVALID_NEW_END_BEFORE_MOVE',
        'CHANGE_ROOM_RENT_REDUCTION'
      ].includes(err.message)
    ) {
      return res.status(400).json({ ok: false, success: false, message: err.message });
    }
    if (err.message === 'EXTEND_PARKING_NOT_APPLICABLE' || err.message === 'INVALID_PARKING_MONTHLY') {
      return res.status(400).json({ ok: false, success: false, message: err.message });
    }
    next(err);
  }
});

/** POST /api/tenancysetting/extend-options – body: { email, tenancyId } → { paymentCycle, maxExtensionEnd, deposit, depositFromTenancy, paidDepositFromRentalCollection } */
router.post('/extend-options', requireCtx, async (req, res, next) => {
  try {
    const result = await getExtendOptions(req.ctx.client.id, req.body?.tenancyId);
    res.json(result);
  } catch (err) {
    if (err.message === 'TENANCY_NOT_FOUND') {
      return res.status(404).json({ success: false, message: err.message });
    }
    next(err);
  }
});

/** POST /api/tenancysetting/extend-preview – same body as extend; returns invoice line preview only */
router.post('/extend-preview', requireCtx, async (req, res, next) => {
  try {
    const result = await previewExtendTenancy(req.ctx.client.id, req.body?.tenancyId, {
      newEnd: req.body?.newEnd,
      newRental: req.body?.newRental,
      agreementFees: req.body?.agreementFees,
      newDeposit: req.body?.newDeposit,
      newParkingMonthly: req.body?.newParkingMonthly
    });
    res.json(result);
  } catch (err) {
    if (err.message === 'TENANCY_NOT_FOUND') {
      return res.status(404).json({ ok: false, success: false, message: err.message });
    }
    if (err.message === 'EXTEND_EXCEEDS_NEXT_BOOKING') {
      return res.status(400).json({ ok: false, success: false, message: err.message });
    }
    if (err.message === 'EXTEND_PARKING_NOT_APPLICABLE' || err.message === 'INVALID_PARKING_MONTHLY') {
      return res.status(400).json({ ok: false, success: false, message: err.message });
    }
    if (err.message === 'INVALID_NEW_END_DATE') {
      return res.status(400).json({ ok: false, success: false, message: err.message });
    }
    next(err);
  }
});

/** POST /api/tenancysetting/extend – body: { email, tenancyId, newEnd, newRental, agreementFees?, newDeposit?, newParkingMonthly? } */
router.post('/extend', requireCtx, async (req, res, next) => {
  try {
    // last_extended_by_id FK → staffdetail.id only (staff.id may be client_user.id when from portal).
    const staffId = req.ctx.staffDetailId != null ? req.ctx.staffDetailId : null;
    const result = await extendTenancy(req.ctx.client.id, staffId, req.body?.tenancyId, {
      newEnd: req.body?.newEnd,
      newRental: req.body?.newRental,
      agreementFees: req.body?.agreementFees,
      newDeposit: req.body?.newDeposit,
      newParkingMonthly: req.body?.newParkingMonthly
    });
    res.json(result);
  } catch (err) {
    if (err.message === 'TENANCY_NOT_FOUND') {
      return res.status(404).json({ success: false, message: err.message });
    }
    if (err.message === 'EXTEND_EXCEEDS_NEXT_BOOKING') {
      return res.status(400).json({ success: false, message: err.message });
    }
    if (err.message === 'EXTEND_PARKING_NOT_APPLICABLE' || err.message === 'INVALID_PARKING_MONTHLY') {
      return res.status(400).json({ success: false, message: err.message });
    }
    next(err);
  }
});

/** POST /api/tenancysetting/change – body: { email, tenancyId, newRoomId, newRental, newEnd, agreementFees?, changeDate?, newDeposit? } */
router.post('/change', requireCtx, async (req, res, next) => {
  try {
    const staffId = req.ctx.staffDetailId != null ? req.ctx.staffDetailId : null;
    const result = await changeRoom(req.ctx.client.id, staffId, req.body?.tenancyId, {
      newRoomId: req.body?.newRoomId,
      newRental: req.body?.newRental,
      newEnd: req.body?.newEnd,
      agreementFees: req.body?.agreementFees,
      changeDate: req.body?.changeDate,
      newDeposit: req.body?.newDeposit,
      newParkingMonthly: req.body?.newParkingMonthly,
      handoverOut: req.body?.handoverOut,
      handoverIn: req.body?.handoverIn
    });
    res.json(result);
  } catch (err) {
    if (err.message === 'TENANCY_NOT_FOUND') return res.status(404).json({ success: false, message: err.message });
    if (err.message === 'ROOM_NOT_AVAILABLE') return res.status(400).json({ success: false, message: err.message });
    if (['HANDOVER_CARD_PHOTO_REQUIRED', 'HANDOVER_UNIT_PHOTO_REQUIRED', 'HANDOVER_TENANT_SIGNATURE_REQUIRED'].includes(err.message)) {
      return res.status(400).json({ success: false, message: err.message });
    }
    if (err.message === 'EXTEND_PARKING_NOT_APPLICABLE' || err.message === 'INVALID_PARKING_MONTHLY') {
      return res.status(400).json({ success: false, message: err.message });
    }
    next(err);
  }
});

/** POST /api/tenancysetting/terminate – body: { email, tenancyId, forfeitAmount } */
router.post('/terminate', requireCtx, async (req, res, next) => {
  try {
    const result = await terminateTenancy(req.ctx.client.id, req.body?.tenancyId, req.body?.forfeitAmount, req.body?.handoverCheckout);
    res.json(result);
  } catch (err) {
    if (err.message === 'TENANCY_NOT_FOUND') return res.status(404).json({ success: false, message: err.message });
    if (['TENANCY_ALREADY_TERMINATED', 'INVALID_FORFEIT_AMOUNT', 'FORFEIT_EXCEEDS_DEPOSIT'].includes(err.message)) {
      return res.status(400).json({ success: false, message: err.message });
    }
    if (['HANDOVER_CARD_PHOTO_REQUIRED', 'HANDOVER_UNIT_PHOTO_REQUIRED', 'HANDOVER_TENANT_SIGNATURE_REQUIRED'].includes(err.message)) {
      return res.status(400).json({ success: false, message: err.message });
    }
    next(err);
  }
});

/** POST /api/tenancysetting/terminate-context – body: { email, tenancyId } */
router.post('/terminate-context', requireCtx, async (req, res, next) => {
  try {
    const result = await getTerminateContext(req.ctx.client.id, req.body?.tenancyId);
    res.json(result);
  } catch (err) {
    if (err.message === 'TENANCY_NOT_FOUND') return res.status(404).json({ ok: false, reason: err.message });
    next(err);
  }
});

/** POST /api/tenancysetting/checkout-handover – body: { email, tenancyId, handoverCheckout } */
router.post('/checkout-handover', requireCtx, async (req, res, next) => {
  try {
    const result = await saveCheckoutHandover(req.ctx.client.id, req.body?.tenancyId, req.body?.handoverCheckout);
    res.json(result);
  } catch (err) {
    if (err.message === 'TENANCY_NOT_FOUND') return res.status(404).json({ success: false, message: err.message });
    if (['HANDOVER_CARD_PHOTO_REQUIRED', 'HANDOVER_UNIT_PHOTO_REQUIRED', 'HANDOVER_TENANT_SIGNATURE_REQUIRED'].includes(err.message)) {
      return res.status(400).json({ success: false, message: err.message });
    }
    next(err);
  }
});

/** POST /api/tenancysetting/checkin-handover – body: { email, tenancyId, handoverCheckin } — on-site check-in proof after booking */
router.post('/checkin-handover', requireCtx, async (req, res, next) => {
  try {
    const result = await saveCheckinHandover(req.ctx.client.id, req.body?.tenancyId, req.body?.handoverCheckin);
    res.json(result);
  } catch (err) {
    if (err.message === 'TENANCY_NOT_FOUND') return res.status(404).json({ success: false, message: err.message });
    if (['HANDOVER_CARD_PHOTO_REQUIRED', 'HANDOVER_UNIT_PHOTO_REQUIRED', 'HANDOVER_TENANT_SIGNATURE_REQUIRED'].includes(err.message)) {
      return res.status(400).json({ success: false, message: err.message });
    }
    next(err);
  }
});

/** POST /api/tenancysetting/cancel-booking – body: { email, tenancyId } */
router.post('/cancel-booking', requireCtx, async (req, res, next) => {
  try {
    const result = await cancelBooking(req.ctx.client.id, req.body?.tenancyId);
    res.json(result);
  } catch (err) {
    if (err.message === 'TENANCY_NOT_FOUND') return res.status(404).json({ success: false, message: err.message });
    next(err);
  }
});

/** POST /api/tenancysetting/agreement-templates – body: { email, mode } */
router.post('/agreement-templates', requireCtx, async (req, res, next) => {
  try {
    const result = await getAgreementTemplates(req.ctx.client.id, req.body?.mode);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/tenancysetting/agreement-retry-draft – body: { email, agreementId } — pending + no PDF only; no credit deduction */
router.post('/agreement-retry-draft', requireCtx, async (req, res, next) => {
  try {
    const agreementId = req.body?.agreementId;
    if (!agreementId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_AGREEMENT_ID' });
    }
    const result = await retryPendingAgreementDraftForClient(req.ctx.client.id, agreementId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/tenancysetting/agreement-insert – body: { email, tenancyId, propertyId?, ownerName?, mode, type, url?, templateId?, status?, createdBy?, extendBegin?, extendEnd?, remark?, confirmCreditDeduction? } – template flow requires confirmCreditDeduction: true */
router.post('/agreement-insert', requireCtx, async (req, res, next) => {
  try {
    const staffDetailId = req.ctx.staffDetailId != null ? req.ctx.staffDetailId : null;
    const result = await insertAgreement(req.ctx.client.id, {
      tenancyId: req.body?.tenancyId,
      propertyId: req.body?.propertyId,
      ownerName: req.body?.ownerName,
      mode: req.body?.mode,
      type: req.body?.type,
      url: req.body?.url,
      templateId: req.body?.templateId,
      status: req.body?.status,
      createdBy: req.body?.createdBy,
      extendBegin: req.body?.extendBegin,
      extendEnd: req.body?.extendEnd,
      remark: req.body?.remark,
      confirmCreditDeduction: req.body?.confirmCreditDeduction === true,
      staffDetailId
    });
    if (result?.ok === false) {
      const reason = result.reason;
      const status =
        reason === 'CLIENT_INVALID' ? 403
          : reason === 'CREDIT_CONFIRM_REQUIRED' || reason === 'MISSING_FIELDS' ? 400
            : 400;
      return res.status(status).json(result);
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/tenancysetting/update – body: { email, tenancyId, rental?, deposit?, end?, handoverCheckinAt?, handoverCheckoutAt? } – edit tenancy (no rental records) */
router.post('/update', requireCtx, async (req, res, next) => {
  try {
    const result = await updateTenancyOp(req.ctx.client.id, req.body?.tenancyId, {
      rental: req.body?.rental,
      deposit: req.body?.deposit,
      end: req.body?.end,
      handoverCheckinAt: req.body?.handoverCheckinAt,
      handoverCheckoutAt: req.body?.handoverCheckoutAt,
      actorEmail: getEmail(req),
      actorType: 'operator'
    });
    res.json(result);
  } catch (err) {
    if (err.message === 'TENANCY_NOT_FOUND') return res.status(404).json({ success: false, message: err.message });
    if (err.message === 'UPDATE_TENANCY_EXPORT_MISSING') {
      return res.status(500).json({ ok: false, reason: 'SERVER_CONFIG', message: 'updateTenancy unavailable' });
    }
    next(err);
  }
});

/** POST /api/tenancysetting/handover-schedule-log – body: { email, tenancyId, limit? } — audit trail for handover appointment time changes */
router.post('/handover-schedule-log', requireCtx, async (req, res, next) => {
  try {
    const tenancyId = req.body?.tenancyId;
    if (!tenancyId) return res.status(400).json({ ok: false, message: 'Missing tenancyId' });
    const items = await listHandoverScheduleLog(req.ctx.client.id, tenancyId, req.body?.limit || 50);
    res.json({ ok: true, items });
  } catch (err) {
    next(err);
  }
});

/** POST /api/tenancysetting/review-submit – body: { email, tenantId, tenancyId?, paymentScoreSuggested, paymentScoreFinal, unitCareScore, communicationScore?, latePaymentsCount?, outstandingCount?, badges?, comment?, evidenceUrls? } */
router.post('/review-submit', requireCtx, async (req, res, next) => {
  try {
    const clientId = req.ctx.client?.id;
    const operatorId = req.ctx.staff?.id || null;
    const result = await submitTenantReview(clientId, operatorId, {
      reviewId: req.body?.reviewId,
      tenantId: req.body?.tenantId,
      tenancyId: req.body?.tenancyId,
      paymentScoreSuggested: req.body?.paymentScoreSuggested,
      paymentScoreFinal: req.body?.paymentScoreFinal,
      unitCareScore: req.body?.unitCareScore,
      communicationScore: req.body?.communicationScore,
      latePaymentsCount: req.body?.latePaymentsCount,
      outstandingCount: req.body?.outstandingCount,
      badges: req.body?.badges,
      comment: req.body?.comment,
      evidenceUrls: req.body?.evidenceUrls
    });
    if (!result?.ok) {
      const status = result?.reason === 'TENANT_NOT_FOUND' || result?.reason === 'TENANCY_NOT_FOUND' ? 404 : 400;
      return res.status(status).json(result);
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/tenancysetting/review-latest – body: { email, tenantId, tenancyId? } */
router.post('/review-latest', requireCtx, async (req, res, next) => {
  try {
    const clientId = req.ctx.client?.id;
    const operatorId = req.ctx.staff?.id || null;
    const result = await getLatestTenantReviewForOperator(
      clientId,
      operatorId,
      req.body?.tenantId,
      req.body?.tenancyId
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/tenancysetting/owner-review-submit – body: { email, ownerId, communicationScore, responsibilityScore, cooperationScore, comment?, evidenceUrls? } */
router.post('/owner-review-submit', requireCtx, async (req, res, next) => {
  try {
    const clientId = req.ctx.client?.id;
    const operatorId = req.ctx.staff?.id || null;
    const result = await submitOwnerReview(clientId, operatorId, {
      reviewId: req.body?.reviewId,
      ownerId: req.body?.ownerId,
      communicationScore: req.body?.communicationScore,
      responsibilityScore: req.body?.responsibilityScore,
      cooperationScore: req.body?.cooperationScore,
      comment: req.body?.comment,
      evidenceUrls: req.body?.evidenceUrls
    });
    if (!result?.ok) {
      const status = result?.reason === 'OWNER_NOT_FOUND' ? 404 : 400;
      return res.status(status).json(result);
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/tenancysetting/owner-review-latest – body: { email, ownerId } */
router.post('/owner-review-latest', requireCtx, async (req, res, next) => {
  try {
    const clientId = req.ctx.client?.id;
    const operatorId = req.ctx.staff?.id || null;
    const result = await getLatestOwnerReviewForOperator(clientId, operatorId, req.body?.ownerId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** GET /api/tenancysetting/public-profile/:id – public profile payload for portal profile page */
router.get('/public-profile/:id', async (req, res, next) => {
  try {
    const tenantId = req.params?.id ? String(req.params.id).trim() : '';
    const result = await getTenantPublicProfileById(tenantId);
    if (!result?.ok) {
      const status = result?.reason === 'TENANT_NOT_FOUND' ? 404 : 400;
      return res.status(status).json(result);
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/public-owner-profile/:id', async (req, res, next) => {
  try {
    const ownerId = req.params?.id ? String(req.params.id).trim() : '';
    const result = await getOwnerPublicProfileById(ownerId);
    if (!result?.ok) {
      const status = result?.reason === 'OWNER_NOT_FOUND' ? 404 : 400;
      return res.status(status).json(result);
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
