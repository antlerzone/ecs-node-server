/**
 * Property Setting API – list/filters/get/update, parking lots, new property insert,
 * owner/agreement, occupancy. All POST with email in body; client from access context.
 */

const express = require('express');
const router = express.Router();
const pool = require('../../config/db');
const { getAccessContextByEmail, getAccessContextByEmailAndClient } = require('../access/access.service');
const {
  getProperties,
  getPropertyFilters,
  getProperty,
  updateProperty,
  setPropertyActive,
  setPropertyArchived,
  getParkingLotsByProperty,
  saveParkingLots,
  insertProperties,
  isPropertyFullyOccupied,
  getApartmentNames,
  getSuppliers,
  getOwners,
  getAgreementTemplates,
  saveOwnerAgreement,
  getPropertySupplierExtra,
  savePropertySupplierExtra
} = require('./propertysetting.service');
const { searchAddressPlaces } = require('../cleanlemon/cleanlemon.service');

function getEmail(req) {
  return req.body?.email ?? req.query?.email ?? null;
}

async function requireClient(req, res, next) {
  if (req.clientId != null && req.client) {
    req.ctx = { client: req.client };
    return next();
  }
  const email = getEmail(req);
  const bodyClientId = req.body?.clientId ?? req.query?.clientId ?? null;

  if (req.apiUser && !email) {
    return res.status(403).json({ ok: false, reason: 'API_USER_NOT_BOUND_TO_CLIENT', message: 'API user must be bound to a client to access this resource' });
  }
  if (req.apiUser && email) {
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) {
      req.clientId = null;
      req.noClientAllowEmpty = true;
      return next();
    }
    let clientId = ctx.client?.id;
    if (clientId) {
      req.ctx = ctx;
      req.clientId = clientId;
      return next();
    }
    if (bodyClientId) {
      const ctxWithClient = await getAccessContextByEmailAndClient(email, bodyClientId);
      if (ctxWithClient.ok && ctxWithClient.client?.id) {
        req.ctx = ctxWithClient;
        req.clientId = ctxWithClient.client.id;
        return next();
      }
      if (ctx.isSaasAdmin) {
        const [[row]] = await pool.query(
          'SELECT id, title, status FROM operatordetail WHERE id = ? LIMIT 1',
          [bodyClientId]
        );
        if (row && (row.status === 1 || row.status === true)) {
          req.ctx = { client: { id: row.id, title: row.title }, isSaasAdmin: true };
          req.clientId = row.id;
          return next();
        }
      }
    }
    req.clientId = null;
    req.noClientAllowEmpty = true;
    return next();
  }
  if (!email) return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
  /** Same as /api/contact: respect operator-selected company when body.clientId is sent */
  if (bodyClientId) {
    try {
      const ctxWithClient = await getAccessContextByEmailAndClient(String(email).trim(), String(bodyClientId).trim());
      if (!ctxWithClient.ok) return res.status(403).json({ ok: false, reason: ctxWithClient.reason || 'ACCESS_DENIED' });
      if (!ctxWithClient.client?.id) return res.status(403).json({ ok: false, reason: 'NO_CLIENT' });
      req.ctx = ctxWithClient;
      req.clientId = ctxWithClient.client.id;
      return next();
    } catch (e) {
      return next(e);
    }
  }
  const ctx = await getAccessContextByEmail(email);
  if (!ctx.ok) return res.status(403).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
  const clientId = ctx.client?.id;
  if (!clientId) return res.status(403).json({ ok: false, reason: 'NO_CLIENT' });
  req.ctx = ctx;
  req.clientId = clientId;
  next();
}

/** POST /api/propertysetting/list – body: { email, clientId?, keyword?, propertyId?, filter?, sort?, page?, pageSize?, limit? } */
router.post('/list', requireClient, async (req, res, next) => {
  try {
    if (req.noClientAllowEmpty) {
      return res.json({ items: [], total: 0, totalPages: 0, currentPage: 1 });
    }
    const opts = {
      keyword: req.body?.keyword,
      propertyId: req.body?.propertyId,
      filter: req.body?.filter,
      sort: req.body?.sort,
      page: req.body?.page,
      pageSize: req.body?.pageSize,
      limit: req.body?.limit
    };
    const result = await getProperties(req.clientId, opts);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/propertysetting/address-search – body: { email, clientId?, q, limit?, countrycodes?, propertyName? } → { ok, items } (OSM Nominatim; same backend as Cleanlemons). */
router.post('/address-search', requireClient, async (req, res, next) => {
  try {
    const q = String(req.body?.q ?? '').trim();
    const limit = req.body?.limit;
    const countrycodes = req.body?.countrycodes != null ? String(req.body.countrycodes) : 'my';
    const propertyName = String(req.body?.propertyName ?? '').trim();
    if (q.length < 2) {
      return res.json({ ok: true, items: [] });
    }
    const items = await searchAddressPlaces({ q, limit, countrycodes, propertyName });
    res.json({ ok: true, items });
  } catch (err) {
    next(err);
  }
});

/** POST /api/propertysetting/filters – body: { email, clientId? } → { properties, services } */
router.post('/filters', requireClient, async (req, res, next) => {
  try {
    if (req.noClientAllowEmpty) {
      return res.json({
        properties: [],
        services: [
          { label: 'All', value: 'ALL' },
          { label: 'Active only', value: 'ACTIVE_ONLY' },
          { label: 'Inactive only', value: 'INACTIVE_ONLY' },
          { label: 'Archived unit', value: 'ARCHIVED_ONLY' }
        ]
      });
    }
    const result = await getPropertyFilters(req.clientId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/propertysetting/get – body: { email, propertyId } */
router.post('/get', requireClient, async (req, res, next) => {
  try {
    const propertyId = req.body?.propertyId;
    if (!propertyId) {
      return res.status(400).json({ ok: false, reason: 'NO_PROPERTY_ID' });
    }
    const property = await getProperty(req.clientId, propertyId);
    if (!property) {
      return res.status(404).json({ ok: false, reason: 'PROPERTY_NOT_FOUND' });
    }
    res.json(property);
  } catch (err) {
    next(err);
  }
});

/** POST /api/propertysetting/update – body: { email, propertyId, ...fields } */
router.post('/update', requireClient, async (req, res, next) => {
  try {
    const propertyId = req.body?.propertyId;
    if (!propertyId) {
      return res.status(400).json({ ok: false, reason: 'NO_PROPERTY_ID' });
    }
    const data = { ...req.body };
    delete data.email;
    delete data.propertyId;
    await updateProperty(req.clientId, propertyId, data);
    res.json({ ok: true });
  } catch (err) {
    if (err.message === 'PROPERTY_NOT_FOUND') {
      return res.status(404).json({ ok: false, reason: err.message });
    }
    if (
      err.message === 'INVALID_OR_INACTIVE_SMART_DOOR' ||
      err.message === 'SMART_DOOR_ALREADY_USED_BY_PROPERTY' ||
      err.message === 'SMART_DOOR_ALREADY_USED_BY_ROOM' ||
      err.message === 'INVALID_LAT_LNG' ||
      err.message === 'INVALID_SECURITY_CREDENTIALS'
    ) {
      return res.status(400).json({ ok: false, reason: err.message });
    }
    next(err);
  }
});

/** POST /api/propertysetting/set-active – body: { email, propertyId, active } */
router.post('/set-active', requireClient, async (req, res, next) => {
  try {
    const propertyId = req.body?.propertyId;
    const active = req.body?.active === true;
    if (!propertyId) {
      return res.status(400).json({ ok: false, reason: 'NO_PROPERTY_ID' });
    }
    await setPropertyActive(req.clientId, propertyId, active);
    res.json({ ok: true });
  } catch (err) {
    if (err.message === 'PROPERTY_NOT_FOUND') {
      return res.status(404).json({ ok: false, reason: err.message });
    }
    if (err.message === 'PROPERTY_HAS_ONGOING_TENANCY') {
      return res.status(400).json({ ok: false, reason: err.message });
    }
    next(err);
  }
});

/** POST /api/propertysetting/set-archived – body: { email, propertyId, archived } */
router.post('/set-archived', requireClient, async (req, res, next) => {
  try {
    const propertyId = req.body?.propertyId;
    const archived = req.body?.archived === true;
    if (!propertyId) {
      return res.status(400).json({ ok: false, reason: 'NO_PROPERTY_ID' });
    }
    await setPropertyArchived(req.clientId, propertyId, archived);
    res.json({ ok: true });
  } catch (err) {
    if (err.message === 'PROPERTY_NOT_FOUND') {
      return res.status(404).json({ ok: false, reason: err.message });
    }
    if (err.message === 'PROPERTY_HAS_ONGOING_TENANCY') {
      return res.status(400).json({ ok: false, reason: err.message });
    }
    if (err.message === 'PROPERTY_HAS_ROOMS') {
      return res.status(400).json({ ok: false, reason: err.message });
    }
    if (err.message === 'PROPERTY_HAS_METER_BOUND' || err.message === 'PROPERTY_HAS_LOCK_BOUND') {
      return res.status(400).json({ ok: false, reason: err.message });
    }
    next(err);
  }
});

/** POST /api/propertysetting/parkinglots – body: { email, propertyId } → { items } */
router.post('/parkinglots', requireClient, async (req, res, next) => {
  try {
    const propertyId = req.body?.propertyId;
    if (!propertyId) {
      return res.status(400).json({ ok: false, reason: 'NO_PROPERTY_ID' });
    }
    const items = await getParkingLotsByProperty(req.clientId, propertyId);
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

/** POST /api/propertysetting/parkinglots-save – body: { email, propertyId, items: [{ parkinglot }] } */
router.post('/parkinglots-save', requireClient, async (req, res, next) => {
  try {
    const propertyId = req.body?.propertyId;
    const items = req.body?.items;
    if (!propertyId) {
      return res.status(400).json({ ok: false, reason: 'NO_PROPERTY_ID' });
    }
    await saveParkingLots(req.clientId, propertyId, Array.isArray(items) ? items : []);
    res.json({ ok: true });
  } catch (err) {
    if (err.message === 'PROPERTY_NOT_FOUND') {
      return res.status(404).json({ ok: false, reason: err.message });
    }
    next(err);
  }
});

/** POST /api/propertysetting/insert – body: { email, items: [{ unitNumber, apartmentName }] } */
router.post('/insert', requireClient, async (req, res, next) => {
  try {
    const items = req.body?.items;
    if (!Array.isArray(items)) {
      return res.status(400).json({ ok: false, reason: 'NO_ITEMS' });
    }
    const result = await insertProperties(req.clientId, items);
    res.json(result);
  } catch (err) {
    if (err.message === 'NO_ITEMS' || err.message === 'INVALID_LAT_LNG') {
      return res.status(400).json({ ok: false, reason: err.message });
    }
    next(err);
  }
});

/** POST /api/propertysetting/occupancy – body: { email, propertyId } → { fullyOccupied } */
router.post('/occupancy', requireClient, async (req, res, next) => {
  try {
    const propertyId = req.body?.propertyId;
    if (!propertyId) {
      return res.status(400).json({ ok: false, reason: 'NO_PROPERTY_ID' });
    }
    const fullyOccupied = await isPropertyFullyOccupied(req.clientId, propertyId);
    res.json({ fullyOccupied });
  } catch (err) {
    next(err);
  }
});

/** POST /api/propertysetting/apartment-names – body: { email } → { items: [{ apartmentName, country }] }. All operators; normalized name + MY/SG for dropdown e.g. "Space Residency | MY". */
router.post('/apartment-names', requireClient, async (req, res, next) => {
  try {
    const bodyCountry = String(req.body?.country || '').trim().toUpperCase();
    const ctxCurrency = String(req.ctx?.client?.currency || '').trim().toUpperCase();
    const countryFromCurrency = ctxCurrency === 'SGD' ? 'SG' : (ctxCurrency === 'MYR' ? 'MY' : '');
    const country = bodyCountry === 'SG' || bodyCountry === 'MY'
      ? bodyCountry
      : (countryFromCurrency || null);
    const items = await getApartmentNames(req.clientId, country);
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

/** POST /api/propertysetting/suppliers – body: { email } → { options } */
router.post('/suppliers', requireClient, async (req, res, next) => {
  try {
    const options = await getSuppliers(req.clientId);
    res.json({ options });
  } catch (err) {
    next(err);
  }
});

/** POST /api/propertysetting/supplier-extra – body: { email, propertyId } → { items } */
router.post('/supplier-extra', requireClient, async (req, res, next) => {
  try {
    const propertyId = req.body?.propertyId;
    if (!propertyId) {
      return res.status(400).json({ ok: false, reason: 'NO_PROPERTY_ID' });
    }
    const items = await getPropertySupplierExtra(req.clientId, propertyId);
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

/** POST /api/propertysetting/supplier-extra-save – body: { email, propertyId, items: [{ supplier_id, value }] } */
router.post('/supplier-extra-save', requireClient, async (req, res, next) => {
  try {
    const propertyId = req.body?.propertyId;
    const items = req.body?.items;
    if (!propertyId) {
      return res.status(400).json({ ok: false, reason: 'NO_PROPERTY_ID' });
    }
    await savePropertySupplierExtra(req.clientId, propertyId, Array.isArray(items) ? items : []);
    res.json({ ok: true });
  } catch (err) {
    if (err.message === 'PROPERTY_NOT_FOUND') {
      return res.status(404).json({ ok: false, reason: err.message });
    }
    next(err);
  }
});

/** POST /api/propertysetting/owners – body: { email } → { options } */
router.post('/owners', requireClient, async (req, res, next) => {
  try {
    const options = await getOwners(req.clientId);
    res.json({ options });
  } catch (err) {
    next(err);
  }
});

/** POST /api/propertysetting/agreement-templates – body: { email } → { options } */
router.post('/agreement-templates', requireClient, async (req, res, next) => {
  try {
    const options = await getAgreementTemplates(req.clientId);
    res.json({ options });
  } catch (err) {
    next(err);
  }
});

/** POST /api/propertysetting/owner-save – body: { email, propertyId, ownerId, type?, templateId?, url? }. type optional: bind owner only when omitted. */
router.post('/owner-save', requireClient, async (req, res, next) => {
  try {
    const propertyId = req.body?.propertyId;
    const ownerId = req.body?.ownerId;
    const type = req.body?.type;
    const templateId = req.body?.templateId;
    const url = req.body?.url;
    if (!propertyId || !ownerId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_PROPERTY_OR_OWNER' });
    }
    await saveOwnerAgreement(req.clientId, propertyId, {
      ownerId,
      type,
      templateId,
      url,
      staffId: req.ctx?.staffDetailId != null ? req.ctx.staffDetailId : null
    });
    res.json({ ok: true });
  } catch (err) {
    if (err.message === 'PROPERTY_NOT_FOUND' || err.message === 'AGREEMENT_URL_REQUIRED') {
      return res.status(400).json({ ok: false, reason: err.message });
    }
    if (String(err?.message || '').includes('INSUFFICIENT_CREDIT')) {
      return res.status(400).json({
        ok: false,
        reason: 'INSUFFICIENT_CREDIT',
        message: 'Not enough credits. Top up on the Credit page before creating an agreement from a template.'
      });
    }
    next(err);
  }
});

const { rollbackQuickSetupOnboardingFailure } = require('../quicksetup/quicksetup.service');
const colivingCleaning = require('../coliving-cleanlemons/coliving-cleanlemons-cleaning.service');

/** POST /api/propertysetting/cleanlemons-cleaning/pricing — { propertyId, roomId? } → cln_property ref prices + flags */
router.post('/cleanlemons-cleaning/pricing', requireClient, async (req, res, next) => {
  try {
    if (req.noClientAllowEmpty) {
      return res.status(403).json({ ok: false, reason: 'NO_CLIENT' });
    }
    const propertyId = String(req.body?.propertyId || '').trim();
    const roomId = req.body?.roomId != null && String(req.body.roomId).trim() !== '' ? String(req.body.roomId).trim() : null;
    if (!propertyId) return res.status(400).json({ ok: false, reason: 'MISSING_PROPERTY_ID' });
    const out = await colivingCleaning.getCleanlemonsCleaningPricingForOperator(req.clientId, propertyId, roomId);
    return res.json(out);
  } catch (err) {
    next(err);
  }
});

/** POST /api/propertysetting/cleanlemons-cleaning/schedule — { propertyId, roomId?, date, time, serviceProvider } */
router.post('/cleanlemons-cleaning/schedule', requireClient, async (req, res, next) => {
  try {
    if (req.noClientAllowEmpty) {
      return res.status(403).json({ ok: false, reason: 'NO_CLIENT' });
    }
    const propertyId = String(req.body?.propertyId || '').trim();
    const roomId = req.body?.roomId != null && String(req.body.roomId).trim() !== '' ? String(req.body.roomId).trim() : null;
    const date = String(req.body?.date || '').slice(0, 10);
    const time = req.body?.time != null ? String(req.body.time).trim() : '09:00';
    const serviceProvider = String(req.body?.serviceProvider || 'general-cleaning').trim();
    if (!propertyId || !date) {
      return res.status(400).json({ ok: false, reason: 'MISSING_PROPERTY_OR_DATE' });
    }
    const out = await colivingCleaning.scheduleColivingCleaningJob(req.clientId, {
      propertyId,
      roomId,
      date,
      time,
      serviceProvider
    });
    return res.json(out);
  } catch (err) {
    const code = err?.code || err?.message;
    if (code === 'CLEANLEMONS_NOT_LINKED') return res.status(400).json({ ok: false, reason: code });
    if (code === 'PROPERTY_NOT_FOUND' || code === 'ROOM_NOT_FOUND') return res.status(404).json({ ok: false, reason: code });
    if (code === 'CLN_PROPERTY_NOT_SYNCED') return res.status(400).json({ ok: false, reason: code });
    if (code === 'INVALID_DATE_TIME') return res.status(400).json({ ok: false, reason: code });
    next(err);
  }
});

/** POST /api/propertysetting/rollback-quicksetup-onboarding – undo partial writes when Quick Setup final submit fails */
router.post('/rollback-quicksetup-onboarding', requireClient, async (req, res, next) => {
  try {
    if (req.noClientAllowEmpty) {
      return res.status(403).json({ ok: false, reason: 'NO_CLIENT' });
    }
    const { propertyId, roomIds, meterIds } = req.body || {};
    const result = await rollbackQuickSetupOnboardingFailure(req.clientId, {
      propertyId: propertyId || undefined,
      roomIds: Array.isArray(roomIds) ? roomIds : [],
      meterIds: Array.isArray(meterIds) ? meterIds : [],
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
