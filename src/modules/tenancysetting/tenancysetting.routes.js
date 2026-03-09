/**
 * Tenancy Setting API – list/filters/extend/change/terminate/cancel/agreement for Wix tenant management page.
 * Requires email for access context; staff must have tenantdetail or admin permission.
 */

const express = require('express');
const router = express.Router();
const { getAccessContextByEmail } = require('../access/access.service');
const {
  getTenancyList,
  getTenancyFilters,
  getRoomsForChange,
  previewChangeRoomProrate,
  getExtendOptions,
  extendTenancy,
  changeRoom,
  terminateTenancy,
  cancelBooking,
  getAgreementTemplates,
  insertAgreement
} = require('./tenancysetting.service');

function getEmail(req) {
  return req.body?.email ?? req.query?.email ?? null;
}

router.use((req, res, next) => {
  console.log('[tenancysetting]', req.method, req.path, 'email=', req.body?.email ? 'present' : 'missing');
  next();
});

async function requireCtx(req, res, next) {
  const email = getEmail(req);
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
    req.ctx = ctx;
    next();
  } catch (err) {
    next(err);
  }
}

/** POST /api/tenancysetting/list – body: { email, propertyId?, status?, search?, sort?, page?, pageSize?, limit? } */
router.post('/list', requireCtx, async (req, res, next) => {
  try {
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
    const result = await getTenancyList(clientId, opts);
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

/** POST /api/tenancysetting/extend-options – body: { email, tenancyId } → { paymentCycle, maxExtensionEnd } for #datepickerextension */
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

/** POST /api/tenancysetting/extend – body: { email, tenancyId, newEnd, newRental, agreementFees?, newDeposit? } */
router.post('/extend', requireCtx, async (req, res, next) => {
  try {
    const staffId = req.ctx.staff?.id || null;
    const result = await extendTenancy(req.ctx.client.id, staffId, req.body?.tenancyId, {
      newEnd: req.body?.newEnd,
      newRental: req.body?.newRental,
      agreementFees: req.body?.agreementFees,
      newDeposit: req.body?.newDeposit
    });
    res.json(result);
  } catch (err) {
    if (err.message === 'TENANCY_NOT_FOUND') {
      return res.status(404).json({ success: false, message: err.message });
    }
    if (err.message === 'EXTEND_EXCEEDS_NEXT_BOOKING') {
      return res.status(400).json({ success: false, message: err.message });
    }
    next(err);
  }
});

/** POST /api/tenancysetting/change – body: { email, tenancyId, newRoomId, newRental, newEnd, agreementFees?, changeDate?, newDeposit? } */
router.post('/change', requireCtx, async (req, res, next) => {
  try {
    const staffId = req.ctx.staff?.id || null;
    const result = await changeRoom(req.ctx.client.id, staffId, req.body?.tenancyId, {
      newRoomId: req.body?.newRoomId,
      newRental: req.body?.newRental,
      newEnd: req.body?.newEnd,
      agreementFees: req.body?.agreementFees,
      changeDate: req.body?.changeDate,
      newDeposit: req.body?.newDeposit
    });
    res.json(result);
  } catch (err) {
    if (err.message === 'TENANCY_NOT_FOUND') return res.status(404).json({ success: false, message: err.message });
    if (err.message === 'ROOM_NOT_AVAILABLE') return res.status(400).json({ success: false, message: err.message });
    next(err);
  }
});

/** POST /api/tenancysetting/terminate – body: { email, tenancyId, forfeitAmount } */
router.post('/terminate', requireCtx, async (req, res, next) => {
  try {
    const result = await terminateTenancy(req.ctx.client.id, req.body?.tenancyId, req.body?.forfeitAmount);
    res.json(result);
  } catch (err) {
    if (err.message === 'TENANCY_NOT_FOUND') return res.status(404).json({ success: false, message: err.message });
    if (['TENANCY_ALREADY_TERMINATED', 'INVALID_FORFEIT_AMOUNT', 'FORFEIT_EXCEEDS_DEPOSIT'].includes(err.message)) {
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

/** POST /api/tenancysetting/agreement-insert – body: { email, tenancyId, propertyId?, ownerName?, mode, type, url?, templateId?, status?, createdBy?, extendBegin?, extendEnd?, remark? } */
router.post('/agreement-insert', requireCtx, async (req, res, next) => {
  try {
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
      remark: req.body?.remark
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
