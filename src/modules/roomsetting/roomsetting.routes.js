/**
 * Room Setting API – list/filters/get/update/insert rooms, meter/smart door options and updates.
 * All POST with email in body; client from access context.
 */

const express = require('express');
const router = express.Router();
const pool = require('../../config/db');
const { getAccessContextByEmail, getAccessContextByEmailAndClient } = require('../access/access.service');
const {
  getRooms,
  getRoomFilters,
  getActiveRoomCount,
  getRoom,
  updateRoom,
  insertRooms,
  getMeterDropdownOptions,
  getSmartDoorDropdownOptions,
  updateRoomMeter,
  updateRoomSmartDoor,
  getTenancyForRoom,
  setRoomActive,
  deleteRoom,
  syncRoomAvailabilityFromTenancy
} = require('./roomsetting.service');

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

  // When API user has no client_id (e.g. portal proxy), resolve client from body email or clientId.
  if (req.apiUser && !email) {
    return res.status(403).json({ ok: false, reason: 'API_USER_NOT_BOUND_TO_CLIENT', message: 'API user must be bound to a client to access this resource' });
  }
  if (req.apiUser && email) {
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) {
      // Operator dashboard: allow through with empty data when email has no context (e.g. not in staff/saasadmin yet).
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
    // No client from context (e.g. SaaS admin or staff not yet resolved): try body clientId.
    if (bodyClientId) {
      const ctxWithClient = await getAccessContextByEmailAndClient(email, bodyClientId);
      if (ctxWithClient.ok && ctxWithClient.client?.id) {
        req.ctx = ctxWithClient;
        req.clientId = ctxWithClient.client.id;
        return next();
      }
      // SaaS admin can act as any client: allow if client exists and is active.
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
    // No client and no body clientId: allow through with empty data (operator dashboard no selection).
    req.clientId = null;
    req.noClientAllowEmpty = true;
    return next();
  }
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

/** POST /api/roomsetting/list – body: { email, clientId?, keyword?, propertyId?, sort?, page?, pageSize?, limit? } */
router.post('/list', requireClient, async (req, res, next) => {
  try {
    if (req.noClientAllowEmpty) {
      return res.json({ items: [], total: 0, totalPages: 0, currentPage: 1 });
    }
    const opts = {
      keyword: req.body?.keyword,
      propertyId: req.body?.propertyId,
      sort: req.body?.sort,
      page: req.body?.page,
      pageSize: req.body?.pageSize,
      limit: req.body?.limit,
      availability: req.body?.availability,
      activeFilter: req.body?.activeFilter,
      listingScope: req.body?.listingScope
    };
    console.log('[roomsetting] POST /list clientId=', req.clientId, 'opts=', JSON.stringify(opts));
    const result = await getRooms(req.clientId, opts);
    console.log('[roomsetting] GET /list result: total=', result.total, 'items.length=', result.items?.length);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/roomsetting/filters – body: { email, clientId? } → { properties } */
router.post('/filters', requireClient, async (req, res, next) => {
  try {
    if (req.noClientAllowEmpty) {
      return res.json({ properties: [] });
    }
    console.log('[roomsetting] POST /filters clientId=', req.clientId);
    const result = await getRoomFilters(req.clientId);
    console.log('[roomsetting] GET /filters properties.length=', result.properties?.length);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/roomsetting/active-room-count – body: { email, clientId? } → { activeRoomCount } */
router.post('/active-room-count', requireClient, async (req, res, next) => {
  try {
    if (req.noClientAllowEmpty) {
      return res.json({ ok: true, activeRoomCount: 0 });
    }
    const count = await getActiveRoomCount(req.clientId);
    res.json({ ok: true, activeRoomCount: count });
  } catch (err) {
    next(err);
  }
});

/** POST /api/roomsetting/get – body: { email, roomId } */
router.post('/get', requireClient, async (req, res, next) => {
  try {
    const roomId = req.body?.roomId;
    if (!roomId) {
      return res.status(400).json({ ok: false, reason: 'NO_ROOM_ID' });
    }
    const room = await getRoom(req.clientId, roomId);
    if (!room) {
      return res.status(404).json({ ok: false, reason: 'ROOM_NOT_FOUND' });
    }
    res.json(room);
  } catch (err) {
    next(err);
  }
});

/** POST /api/roomsetting/sync-availability – body: { email, roomId } — recompute available flags from tenancy rows (not a free-form override) */
router.post('/sync-availability', requireClient, async (req, res, next) => {
  try {
    if (req.noClientAllowEmpty) {
      return res.status(403).json({ ok: false, reason: 'NO_CLIENT' });
    }
    const roomId = req.body?.roomId;
    if (!roomId) {
      return res.status(400).json({ ok: false, reason: 'NO_ROOM_ID' });
    }
    const result = await syncRoomAvailabilityFromTenancy(req.clientId, roomId);
    res.json(result);
  } catch (err) {
    if (err.message === 'ROOM_NOT_FOUND') {
      return res.status(404).json({ ok: false, reason: err.message });
    }
    if (err.message === 'NO_ROOM_ID') {
      return res.status(400).json({ ok: false, reason: err.message });
    }
    next(err);
  }
});

/** POST /api/roomsetting/update – body: { email, roomId, roomName?, description_fld?, remark?, price?, property?, mainPhoto?, mediaGallery?, active? } */
router.post('/update', requireClient, async (req, res, next) => {
  try {
    const roomId = req.body?.roomId;
    if (!roomId) {
      return res.status(400).json({ ok: false, reason: 'NO_ROOM_ID' });
    }
    const data = {
      roomName: req.body?.roomName,
      description_fld: req.body?.description_fld,
      remark: req.body?.remark,
      price: req.body?.price,
      property: req.body?.property,
      mainPhoto: req.body?.mainPhoto,
      mediaGallery: req.body?.mediaGallery,
      active: req.body?.active,
      listingScope: req.body?.listingScope,
      cleanlemonsCleaningTenantPriceMyr: req.body?.cleanlemonsCleaningTenantPriceMyr
    };
    const result = await updateRoom(req.clientId, roomId, data);
    res.json(result);
  } catch (err) {
    if (err.message === 'ROOM_NOT_FOUND') {
      return res.status(404).json({ ok: false, reason: err.message });
    }
    if (err.message === 'PROPERTY_INACTIVE_CANNOT_ACTIVATE_ROOM' || err.message === 'PROPERTY_ARCHIVED_CANNOT_ACTIVATE_ROOM') {
      return res.status(400).json({ ok: false, reason: err.message });
    }
    next(err);
  }
});

/** POST /api/roomsetting/insert – body: { email, records: [{ roomName, property }] } */
router.post('/insert', requireClient, async (req, res, next) => {
  try {
    const records = req.body?.records;
    if (!Array.isArray(records)) {
      return res.status(400).json({ ok: false, reason: 'NO_RECORDS' });
    }
    const result = await insertRooms(req.clientId, records);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/roomsetting/set-active – body: { email, roomId, active } */
router.post('/set-active', requireClient, async (req, res, next) => {
  try {
    const roomId = req.body?.roomId;
    const active = req.body?.active !== false;
    if (!roomId) {
      return res.status(400).json({ ok: false, reason: 'NO_ROOM_ID' });
    }
    await setRoomActive(req.clientId, roomId, active);
    res.json({ ok: true });
  } catch (err) {
    if (err.message === 'ROOM_NOT_FOUND') {
      return res.status(404).json({ ok: false, reason: err.message });
    }
    if (err.message === 'PROPERTY_INACTIVE_CANNOT_ACTIVATE_ROOM' || err.message === 'PROPERTY_ARCHIVED_CANNOT_ACTIVATE_ROOM') {
      return res.status(400).json({ ok: false, reason: err.message });
    }
    next(err);
  }
});

/** POST /api/roomsetting/delete – body: { email, roomId } */
router.post('/delete', requireClient, async (req, res, next) => {
  try {
    const roomId = req.body?.roomId;
    if (!roomId) {
      return res.status(400).json({ ok: false, reason: 'NO_ROOM_ID' });
    }
    await deleteRoom(req.clientId, roomId);
    res.json({ ok: true });
  } catch (err) {
    if ([
      'ROOM_NOT_FOUND',
      'ROOM_HAS_ONGOING_TENANCY',
      'ROOM_METER_BOUND',
      'ROOM_SMARTDOOR_BOUND',
      'NO_ROOM_ID'
    ].includes(err.message)) {
      return res.status(400).json({ ok: false, reason: err.message });
    }
    next(err);
  }
});

/** POST /api/roomsetting/tenancy – body: { email, roomId } → active tenancy with tenant */
router.post('/tenancy', requireClient, async (req, res, next) => {
  try {
    const roomId = req.body?.roomId;
    if (!roomId) {
      return res.status(400).json({ ok: false, reason: 'NO_ROOM_ID' });
    }
    const tenancy = await getTenancyForRoom(req.clientId, roomId);
    res.json(tenancy || null);
  } catch (err) {
    next(err);
  }
});

/** POST /api/roomsetting/meter-options – body: { email, roomId?, propertyId? } */
router.post('/meter-options', requireClient, async (req, res, next) => {
  try {
    const roomId = req.body?.roomId || null;
    const propertyId = req.body?.propertyId || null;
    console.log('[roomsetting/meter-options] clientId=', req.clientId, 'roomId=', roomId, 'propertyId=', propertyId, 'propertyIdType=', typeof propertyId);
    const options = await getMeterDropdownOptions(req.clientId, roomId, propertyId);
    console.log('[roomsetting/meter-options] options.length=', options.length, 'options=', options.map(o => ({ label: o.label, value: o.value })));
    res.json({ options });
  } catch (err) {
    next(err);
  }
});

/** POST /api/roomsetting/smartdoor-options – body: { email, roomId?, propertyId? } */
router.post('/smartdoor-options', requireClient, async (req, res, next) => {
  try {
    const roomId = req.body?.roomId || null;
    const propertyId = req.body?.propertyId || null;
    console.log('[roomsetting/smartdoor-options] clientId=', req.clientId, 'roomId=', roomId, 'propertyId=', propertyId, 'propertyIdType=', typeof propertyId);
    const options = await getSmartDoorDropdownOptions(req.clientId, roomId, propertyId);
    console.log('[roomsetting/smartdoor-options] options.length=', options.length, 'options=', options.map(o => ({ label: o.label, value: o.value })));
    res.json({ options });
  } catch (err) {
    next(err);
  }
});

/** POST /api/roomsetting/update-meter – body: { email, roomId, meterId? } */
router.post('/update-meter', requireClient, async (req, res, next) => {
  try {
    const roomId = req.body?.roomId;
    const meterId = req.body?.meterId ?? null;
    if (!roomId) {
      return res.status(400).json({ ok: false, reason: 'NO_ROOM_ID' });
    }
    await updateRoomMeter(req.clientId, roomId, meterId);
    res.json({ ok: true });
  } catch (err) {
    if (err.message === 'NO_PERMISSION' || err.message === 'INVALID_METER' || err.message === 'METER_ALREADY_IN_USE') {
      return res.status(400).json({ ok: false, reason: err.message });
    }
    next(err);
  }
});

/** POST /api/roomsetting/update-smartdoor – body: { email, roomId, smartDoorId? } */
router.post('/update-smartdoor', requireClient, async (req, res, next) => {
  try {
    const roomId = req.body?.roomId;
    const smartDoorId = req.body?.smartDoorId ?? null;
    if (!roomId) {
      return res.status(400).json({ ok: false, reason: 'NO_ROOM_ID' });
    }
    await updateRoomSmartDoor(req.clientId, roomId, smartDoorId);
    res.json({ ok: true });
  } catch (err) {
    if (err.message === 'NO_PERMISSION' || err.message === 'INVALID_OR_INACTIVE_SMART_DOOR' ||
        err.message === 'SMART_DOOR_ALREADY_USED_BY_PROPERTY' || err.message === 'SMART_DOOR_ALREADY_USED_BY_ROOM') {
      return res.status(400).json({ ok: false, reason: err.message });
    }
    next(err);
  }
});

module.exports = router;
