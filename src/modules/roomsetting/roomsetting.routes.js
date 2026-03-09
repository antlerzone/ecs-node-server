/**
 * Room Setting API – list/filters/get/update/insert rooms, meter/smart door options and updates.
 * All POST with email in body; client from access context.
 */

const express = require('express');
const router = express.Router();
const { getAccessContextByEmail } = require('../access/access.service');
const {
  getRooms,
  getRoomFilters,
  getRoom,
  updateRoom,
  insertRooms,
  getMeterDropdownOptions,
  getSmartDoorDropdownOptions,
  updateRoomMeter,
  updateRoomSmartDoor,
  getTenancyForRoom,
  setRoomActive
} = require('./roomsetting.service');

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

/** POST /api/roomsetting/list – body: { email, keyword?, propertyId?, sort?, page?, pageSize?, limit? } */
router.post('/list', requireClient, async (req, res, next) => {
  try {
    const opts = {
      keyword: req.body?.keyword,
      propertyId: req.body?.propertyId,
      sort: req.body?.sort,
      page: req.body?.page,
      pageSize: req.body?.pageSize,
      limit: req.body?.limit
    };
    console.log('[roomsetting] POST /list clientId=', req.clientId, 'opts=', JSON.stringify(opts));
    const result = await getRooms(req.clientId, opts);
    console.log('[roomsetting] GET /list result: total=', result.total, 'items.length=', result.items?.length);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/roomsetting/filters – body: { email } → { properties } */
router.post('/filters', requireClient, async (req, res, next) => {
  try {
    console.log('[roomsetting] POST /filters clientId=', req.clientId);
    const result = await getRoomFilters(req.clientId);
    console.log('[roomsetting] GET /filters properties.length=', result.properties?.length);
    res.json(result);
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
      active: req.body?.active
    };
    const result = await updateRoom(req.clientId, roomId, data);
    res.json(result);
  } catch (err) {
    if (err.message === 'ROOM_NOT_FOUND') {
      return res.status(404).json({ ok: false, reason: err.message });
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
    if (err.message === 'REMOVE_METER_OR_SMART_DOOR_FIRST') {
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
