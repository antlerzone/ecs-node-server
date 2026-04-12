/**
 * Tenant Invoice API – rental list/filters, tenancy list, meter groups, insert/delete/update rental, meter calculation.
 * All POST with email in body; client resolved from access context.
 */

const express = require('express');
const router = express.Router();
const { formatApiResponseDates } = require('../../utils/dateMalaysia');
const { getAccessContextByEmail } = require('../access/access.service');
const {
  getProperties,
  getTypes,
  getTenancyCleaningPriceHint,
  getRentalList,
  getTenancyList,
  getMeterGroups,
  insertRentalRecords,
  deleteRentalRecords,
  voidRentalPayments,
  updateRentalRecord,
  calculateMeterInvoice
} = require('./tenantinvoice.service');

function getEmail(req) {
  return req.body?.email ?? req.query?.email ?? null;
}

/** tenancy.submitby_id / rental scope use staffdetail.id; client_user has staffDetailId=null — do not use staff.id there. */
function tenancyStaffFilterId(ctx) {
  if (!ctx?.staff || ctx.staff.permission?.admin) return null;
  return ctx.staffDetailId != null ? ctx.staffDetailId : null;
}

async function requireClient(req, res, next) {
  if (req.clientId != null && req.client) {
    req.ctx = { client: req.client };
    return next();
  }
  const email = getEmail(req);
  if (req.apiUser && !email) {
    return res.status(403).json({ ok: false, reason: 'API_USER_NOT_BOUND_TO_CLIENT', message: 'API user must be bound to a client to access this resource' });
  }
  if (req.apiUser && email) {
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) return res.status(403).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    const clientId = ctx.client?.id;
    if (!clientId) return res.status(403).json({ ok: false, reason: 'NO_CLIENT' });
    req.ctx = ctx;
    req.clientId = clientId;
    return next();
  }
  if (!email) return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
  const ctx = await getAccessContextByEmail(email);
  if (!ctx.ok) return res.status(403).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
  const clientId = ctx.client?.id;
  if (!clientId) return res.status(403).json({ ok: false, reason: 'NO_CLIENT' });
  req.ctx = ctx;
  req.clientId = clientId;
  next();
}

/** POST /api/tenantinvoice/properties – list properties for filter dropdown */
router.post('/properties', requireClient, async (req, res, next) => {
  try {
    const items = await getProperties(req.clientId);
    res.json({ ok: true, items });
  } catch (err) {
    next(err);
  }
});

/** POST /api/tenantinvoice/types – list account (bukkuid) for type dropdown */
router.post('/types', requireClient, async (req, res, next) => {
  try {
    const items = await getTypes(req.clientId);
    res.json({ ok: true, items });
  } catch (err) {
    next(err);
  }
});

/** POST /api/tenantinvoice/tenancy-cleaning-price – { tenancyId } → suggested MYR from room/property tenant cleaning rate */
router.post('/tenancy-cleaning-price', requireClient, async (req, res, next) => {
  try {
    const tenancyId = req.body?.tenancyId != null ? String(req.body.tenancyId).trim() : '';
    const out = await getTenancyCleaningPriceHint(req.clientId, tenancyId);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

/** POST /api/tenantinvoice/rental-list – list rental with filters (property, type, from, to) */
router.post('/rental-list', requireClient, async (req, res, next) => {
  try {
    const staffId = tenancyStaffFilterId(req.ctx);
    const opts = {
      property: req.body?.property,
      type: req.body?.type,
      from: req.body?.from,
      to: req.body?.to
    };
    if (staffId) opts.staffId = staffId;
    const result = await getRentalList(req.clientId, opts);
    const payload = {
      ok: true,
      items: result.items,
      bukkuSubdomain: result.bukkuSubdomain,
      currency: result.currency
    };
    formatApiResponseDates(payload);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

/** POST /api/tenantinvoice/tenancy-list – list tenancies with room + tenant; body: { propertyId? }. Returns active + inactive with end_date for (Active/Inactive) label. */
router.post('/tenancy-list', requireClient, async (req, res, next) => {
  try {
    const staffId = tenancyStaffFilterId(req.ctx);
    const propertyId = req.body?.propertyId || null;
    const items = await getTenancyList(req.clientId, { propertyId, staffId });
    const payload = { ok: true, items };
    formatApiResponseDates(payload);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

/** POST /api/tenantinvoice/meter-groups – list meter groups (metersharing) */
router.post('/meter-groups', requireClient, async (req, res, next) => {
  try {
    const items = await getMeterGroups(req.clientId);
    res.json({ ok: true, items });
  } catch (err) {
    next(err);
  }
});

/** POST /api/tenantinvoice/rental-insert – insert rental records */
router.post('/rental-insert', requireClient, async (req, res, next) => {
  try {
    const staffId = tenancyStaffFilterId(req.ctx);
    const records = Array.isArray(req.body?.records) ? req.body.records : [];
    const result = await insertRentalRecords(req.clientId, records, staffId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/tenantinvoice/rental-delete – delete by ids */
router.post('/rental-delete', requireClient, async (req, res, next) => {
  try {
    const staffId = tenancyStaffFilterId(req.ctx);
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const result = await deleteRentalRecords(req.clientId, ids, staffId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/tenantinvoice/rental-void-payment – void payment by ids */
router.post('/rental-void-payment', requireClient, async (req, res, next) => {
  try {
    const staffId = tenancyStaffFilterId(req.ctx);
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const result = await voidRentalPayments(req.clientId, ids, staffId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/tenantinvoice/rental-update – update one record */
router.post('/rental-update', requireClient, async (req, res, next) => {
  try {
    const staffId = tenancyStaffFilterId(req.ctx);
    const id = req.body?.id;
    const payload = req.body?.payload || {};
    const result = await updateRentalRecord(req.clientId, id, payload, staffId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/tenantinvoice/meter-calculation – usage or calculation phase */
router.post('/meter-calculation', async (req, res, next) => {
  try {
    const email = getEmail(req);
    if (!email) {
      return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
    }
    const params = {
      mode: req.body?.mode,
      clientId: req.body?.clientId,
      groupMeters: req.body?.groupMeters,
      period: req.body?.period,
      usageSnapshot: req.body?.usageSnapshot,
      inputAmount: req.body?.inputAmount,
      sharingType: req.body?.sharingType
    };
    const result = await calculateMeterInvoice(email, params);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
