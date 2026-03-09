/**
 * Tenant Invoice API – rental list/filters, tenancy list, meter groups, insert/delete/update rental, meter calculation.
 * All POST with email in body; client resolved from access context.
 */

const express = require('express');
const router = express.Router();
const { getAccessContextByEmail } = require('../access/access.service');
const {
  getProperties,
  getTypes,
  getRentalList,
  getTenancyList,
  getMeterGroups,
  insertRentalRecords,
  deleteRentalRecords,
  updateRentalRecord,
  calculateMeterInvoice
} = require('./tenantinvoice.service');

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

/** POST /api/tenantinvoice/rental-list – list rental with filters (property, type, from, to) */
router.post('/rental-list', requireClient, async (req, res, next) => {
  try {
    const opts = {
      property: req.body?.property,
      type: req.body?.type,
      from: req.body?.from,
      to: req.body?.to
    };
    const items = await getRentalList(req.clientId, opts);
    res.json({ ok: true, items });
  } catch (err) {
    next(err);
  }
});

/** POST /api/tenantinvoice/tenancy-list – list active tenancies with room + tenant */
router.post('/tenancy-list', requireClient, async (req, res, next) => {
  try {
    const items = await getTenancyList(req.clientId);
    res.json({ ok: true, items });
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
    const records = Array.isArray(req.body?.records) ? req.body.records : [];
    const result = await insertRentalRecords(req.clientId, records);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/tenantinvoice/rental-delete – delete by ids */
router.post('/rental-delete', requireClient, async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const result = await deleteRentalRecords(req.clientId, ids);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/tenantinvoice/rental-update – update one record */
router.post('/rental-update', requireClient, async (req, res, next) => {
  try {
    const id = req.body?.id;
    const payload = req.body?.payload || {};
    const result = await updateRentalRecord(req.clientId, id, payload);
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
