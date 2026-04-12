/**
 * Smart Door Setting API – list/filters/get/update/preview/sync/insert.
 * All POST with email in body; client from access context.
 */

const express = require('express');
const router = express.Router();
const { getAccessContextByEmail, getAccessContextByEmailAndClient } = require('../access/access.service');
const {
  getSmartDoorList,
  getSmartDoorFilters,
  getLock,
  getGateway,
  updateLock,
  updateGateway,
  remoteUnlockLock,
  previewSmartDoorSelection,
  syncTTLockName,
  getSmartDoorIdsByProperty,
  resolveSmartDoorLocationLabel,
  getChildLockOptions,
  insertGateways,
  insertLocks,
  deleteLock,
  deleteGateway,
  syncSmartDoorStatusFromTtlock,
  syncSingleLockStatusFromTtlock,
  syncSingleGatewayStatusFromTtlock
} = require('./smartdoorsetting.service');

function getEmail(req) {
  return req.body?.email ?? req.query?.email ?? null;
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
    const bodyClientId = req.body?.clientId ?? req.query?.clientId ?? null;
    const ctx = bodyClientId
      ? await getAccessContextByEmailAndClient(email, bodyClientId)
      : await getAccessContextByEmail(email);
    if (!ctx.ok) return res.status(403).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    const clientId = ctx.client?.id;
    if (!clientId) return res.status(403).json({ ok: false, reason: 'NO_CLIENT' });
    req.ctx = ctx;
    req.clientId = clientId;
    return next();
  }
  if (!email) return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
  const bodyClientId = req.body?.clientId ?? req.query?.clientId ?? null;
  const ctx = bodyClientId
    ? await getAccessContextByEmailAndClient(email, bodyClientId)
    : await getAccessContextByEmail(email);
  if (!ctx.ok) return res.status(403).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
  const clientId = ctx.client?.id;
  if (!clientId) return res.status(403).json({ ok: false, reason: 'NO_CLIENT' });
  req.ctx = ctx;
  req.clientId = clientId;
  next();
}

/** POST /api/smartdoorsetting/list – body: { email, clientId?, keyword?, propertyId?, filter?, sort?, page?, pageSize?, limit? } */
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
    console.log('[smartdoorsetting] POST /list clientId=%s bodyClientId=%s opts=%j', req.clientId, req.body?.clientId ?? 'none', opts);
    const result = await getSmartDoorList(req.clientId, opts);
    console.log('[smartdoorsetting] POST /list result items=%s total=%s', result?.items?.length ?? 0, result?.total ?? 0);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/smartdoorsetting/filters – body: { email } → { properties } */
router.post('/filters', requireClient, async (req, res, next) => {
  try {
    const result = await getSmartDoorFilters(req.clientId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/smartdoorsetting/get-lock – body: { email, id } */
router.post('/get-lock', requireClient, async (req, res, next) => {
  try {
    const id = req.body?.id;
    if (!id) return res.status(400).json({ ok: false, reason: 'NO_ID' });
    const row = await getLock(req.clientId, id);
    if (!row) return res.status(404).json({ ok: false, reason: 'NOT_FOUND' });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

/** POST /api/smartdoorsetting/get-gateway – body: { email, id } */
router.post('/get-gateway', requireClient, async (req, res, next) => {
  try {
    const id = req.body?.id;
    if (!id) return res.status(400).json({ ok: false, reason: 'NO_ID' });
    const row = await getGateway(req.clientId, id);
    if (!row) return res.status(404).json({ ok: false, reason: 'NOT_FOUND' });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

/** POST /api/smartdoorsetting/update-lock – body: { email, id, lockAlias?, active?, childmeter? } */
router.post('/update-lock', requireClient, async (req, res, next) => {
  try {
    const id = req.body?.id;
    if (!id) return res.status(400).json({ ok: false, reason: 'NO_ID' });
    const result = await updateLock(req.clientId, id, {
      lockAlias: req.body?.lockAlias,
      active: req.body?.active,
      childmeter: req.body?.childmeter
    });
    if (result.ok === false) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/smartdoorsetting/update-gateway – body: { email, id, gatewayName? } */
router.post('/update-gateway', requireClient, async (req, res, next) => {
  try {
    const id = req.body?.id;
    if (!id) return res.status(400).json({ ok: false, reason: 'NO_ID' });
    const result = await updateGateway(req.clientId, id, { gatewayName: req.body?.gatewayName });
    if (result.ok === false) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/smartdoorsetting/unlock – body: { email, id } – remote unlock lock by lockdetail id */
router.post('/unlock', requireClient, async (req, res, next) => {
  try {
    const id = req.body?.id;
    if (!id) return res.status(400).json({ ok: false, reason: 'NO_ID' });
    const email = String(getEmail(req) || '').trim().toLowerCase();
    await remoteUnlockLock(req.clientId, id, {
      actorEmail: email || '(unknown)',
      portalSource: 'coliving_smartdoor',
    });
    res.json({ ok: true });
  } catch (err) {
    if (err.message && err.message.startsWith('TTLOCK_')) {
      return res.status(400).json({ ok: false, reason: err.message });
    }
    next(err);
  }
});

/** POST /api/smartdoorsetting/preview-selection – body: { email } → { total, list } — TTLock items not in DB yet only (no refresh of existing rows) */
router.post('/preview-selection', requireClient, async (req, res, next) => {
  try {
    const result = await previewSmartDoorSelection(req.clientId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/smartdoorsetting/sync-status-from-ttlock – body: { email } → { ok, lockCount, gatewayCount }; refresh existing rows from TTLock (lock: battery + gateway link; gateway: online, lock count, name) */
router.post('/sync-status-from-ttlock', requireClient, async (req, res, next) => {
  try {
    const result = await syncSmartDoorStatusFromTtlock(req.clientId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** @deprecated use sync-status-from-ttlock */
router.post('/sync-locks-from-ttlock', requireClient, async (req, res, next) => {
  try {
    const result = await syncSmartDoorStatusFromTtlock(req.clientId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/smartdoorsetting/sync-single-lock-from-ttlock – body: { email, id } lockdetail id → one lock from TTLock */
router.post('/sync-single-lock-from-ttlock', requireClient, async (req, res, next) => {
  try {
    const id = req.body?.id;
    if (!id) return res.status(400).json({ ok: false, reason: 'NO_ID' });
    const result = await syncSingleLockStatusFromTtlock(req.clientId, id);
    if (result.ok === false) return res.status(result.reason === 'LOCK_NOT_FOUND' ? 404 : 400).json(result);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/smartdoorsetting/sync-single-gateway-from-ttlock – body: { email, id } gatewaydetail id */
router.post('/sync-single-gateway-from-ttlock', requireClient, async (req, res, next) => {
  try {
    const id = req.body?.id;
    if (!id) return res.status(400).json({ ok: false, reason: 'NO_ID' });
    const result = await syncSingleGatewayStatusFromTtlock(req.clientId, id);
    if (result.ok === false) return res.status(result.reason === 'GATEWAY_NOT_FOUND' ? 404 : 400).json(result);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/smartdoorsetting/sync-name – body: { email, type, externalId, name } */
router.post('/sync-name', requireClient, async (req, res, next) => {
  try {
    const { type, externalId, name } = req.body || {};
    if (!type || !externalId || !name) {
      return res.status(400).json({ ok: false, reason: 'TYPE_EXTERNALID_NAME_REQUIRED' });
    }
    await syncTTLockName(req.clientId, { type, externalId, name });
    res.json({ ok: true });
  } catch (err) {
    if (err.message && err.message.startsWith('TTLOCK_')) {
      return res.status(400).json({ ok: false, reason: err.message });
    }
    next(err);
  }
});

/** POST /api/smartdoorsetting/ids-by-property – body: { email, propertyId } → { ids } */
router.post('/ids-by-property', requireClient, async (req, res, next) => {
  try {
    const propertyId = req.body?.propertyId;
    if (!propertyId) return res.status(400).json({ ids: [] });
    const ids = await getSmartDoorIdsByProperty(req.clientId, propertyId);
    res.json({ ids });
  } catch (err) {
    next(err);
  }
});

/** POST /api/smartdoorsetting/location-label – body: { email, lockDetailId } → { label } */
router.post('/location-label', requireClient, async (req, res, next) => {
  try {
    const lockDetailId = req.body?.lockDetailId;
    if (!lockDetailId) return res.status(400).json({ label: 'no connect' });
    const label = await resolveSmartDoorLocationLabel(req.clientId, lockDetailId);
    res.json({ label });
  } catch (err) {
    next(err);
  }
});

/** POST /api/smartdoorsetting/child-lock-options – body: { email, excludeLockId? } → { options } */
router.post('/child-lock-options', requireClient, async (req, res, next) => {
  try {
    const excludeLockId = req.body?.excludeLockId;
    const options = await getChildLockOptions(req.clientId, excludeLockId);
    console.log('[smartdoorsetting] POST child-lock-options excludeLockId=%s options.length=%s', excludeLockId, options.length);
    res.json({ options });
  } catch (err) {
    next(err);
  }
});

/** POST /api/smartdoorsetting/insert-smartdoors – body: { email, gateways: [], locks: [] }; gateways/locks get ids, then locks can reference gateway by externalId */
router.post('/insert-smartdoors', requireClient, async (req, res, next) => {
  try {
    const gateways = Array.isArray(req.body?.gateways) ? req.body.gateways : [];
    const locks = Array.isArray(req.body?.locks) ? req.body.locks : [];
    const gatewayMap = new Map();
    if (gateways.length > 0) {
      const inserted = await insertGateways(req.clientId, gateways);
      inserted.forEach(({ id, gatewayId }) => gatewayMap.set(String(gatewayId), id));
    }
    if (locks.length > 0) {
      await insertLocks(req.clientId, locks, gatewayMap);
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** POST /api/smartdoorsetting/delete-lock – body: { email, id } */
router.post('/delete-lock', requireClient, async (req, res, next) => {
  try {
    const id = req.body?.id;
    if (!id) return res.status(400).json({ ok: false, reason: 'NO_ID' });
    const result = await deleteLock(req.clientId, id);
    if (result.ok === false) return res.status(404).json(result);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/smartdoorsetting/delete-gateway – body: { email, id } */
router.post('/delete-gateway', requireClient, async (req, res, next) => {
  try {
    const id = req.body?.id;
    if (!id) return res.status(400).json({ ok: false, reason: 'NO_ID' });
    const result = await deleteGateway(req.clientId, id);
    if (result.ok === false) return res.status(404).json(result);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
