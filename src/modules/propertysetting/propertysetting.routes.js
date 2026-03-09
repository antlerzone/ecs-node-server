/**
 * Property Setting API – list/filters/get/update, parking lots, new property insert,
 * owner/agreement, occupancy. All POST with email in body; client from access context.
 */

const express = require('express');
const router = express.Router();
const { getAccessContextByEmail } = require('../access/access.service');
const {
  getProperties,
  getPropertyFilters,
  getProperty,
  updateProperty,
  setPropertyActive,
  getParkingLotsByProperty,
  saveParkingLots,
  insertProperties,
  isPropertyFullyOccupied,
  getApartmentNames,
  getSuppliers,
  getOwners,
  getAgreementTemplates,
  saveOwnerAgreement
} = require('./propertysetting.service');

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

/** POST /api/propertysetting/list – body: { email, keyword?, propertyId?, filter?, sort?, page?, pageSize?, limit? } */
router.post('/list', requireClient, async (req, res, next) => {
  try {
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

/** POST /api/propertysetting/filters – body: { email } → { properties, services } */
router.post('/filters', requireClient, async (req, res, next) => {
  try {
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
    if (err.message === 'NO_ITEMS') {
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

/** POST /api/propertysetting/apartment-names – body: { email } → { names }. Names are from ALL clients (shared pool) so dropdown can reuse e.g. "Space Residency" consistently. */
router.post('/apartment-names', requireClient, async (req, res, next) => {
  try {
    const names = await getApartmentNames(req.clientId);
    res.json({ names });
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
      staffId: req.ctx?.staff?.id
    });
    res.json({ ok: true });
  } catch (err) {
    if (err.message === 'PROPERTY_NOT_FOUND' || err.message === 'AGREEMENT_URL_REQUIRED') {
      return res.status(400).json({ ok: false, reason: err.message });
    }
    next(err);
  }
});

module.exports = router;
