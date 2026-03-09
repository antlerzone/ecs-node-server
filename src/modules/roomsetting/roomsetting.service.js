/**
 * Room Setting – list/update/insert rooms, meter/smart door options and updates.
 * Uses MySQL: roomdetail, propertydetail, tenancy, tenantdetail, meterdetail, lockdetail.
 * FK: client_id, property_id, meter_id, smartdoor_id (lockdetail). No Wix CMS.
 */

const { randomUUID } = require('crypto');
const pool = require('../../config/db');

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const CACHE_LIMIT_MAX = 2000;

function orderClause(sort) {
  switch (String(sort || 'title').toLowerCase()) {
    case 'title_desc':
      return 'ORDER BY r.title_fld DESC, r.roomname ASC';
    case 'price_asc':
      return 'ORDER BY r.price ASC, r.title_fld ASC';
    case 'price_desc':
      return 'ORDER BY r.price DESC, r.title_fld ASC';
    case 'title':
    default:
      return 'ORDER BY r.title_fld ASC, r.roomname ASC';
  }
}

function listConditions(clientId, opts = {}) {
  const keyword = (opts.keyword || opts.search || '').trim();
  const propertyId = opts.propertyId === 'ALL' || !opts.propertyId ? null : opts.propertyId;
  const conditions = ['r.client_id = ?'];
  const params = [clientId];
  if (propertyId) {
    conditions.push('r.property_id = ?');
    params.push(propertyId);
  }
  if (keyword && keyword.length >= 1) {
    conditions.push('(r.title_fld LIKE ? OR r.roomname LIKE ?)');
    const term = `%${keyword}%`;
    params.push(term, term);
  }
  return { whereSql: conditions.join(' AND '), params };
}

/**
 * List rooms for client with filters and pagination.
 * @param {string} clientId
 * @param {Object} opts - { keyword?, propertyId?, sort?, page?, pageSize?, limit? }
 *   limit: when set, one page with up to limit items (for frontend cache).
 * @returns {Promise<{ items, totalPages, currentPage, total }>}
 */
async function getRooms(clientId, opts = {}) {
  const limit = opts.limit != null ? Math.min(CACHE_LIMIT_MAX, Math.max(1, parseInt(opts.limit, 10) || 0)) : null;
  const useLimit = limit != null && limit > 0;

  const page = useLimit ? 1 : Math.max(1, parseInt(opts.page, 10) || 1);
  const pageSize = useLimit ? limit : Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(opts.pageSize, 10) || DEFAULT_PAGE_SIZE));
  const offset = (page - 1) * pageSize;

  const { whereSql, params } = listConditions(clientId, opts);
  const orderSql = orderClause(opts.sort || 'title');

  console.log('[roomsetting.service] getRooms clientId=', clientId, 'whereSql=', whereSql, 'params=', params, 'pageSize=', pageSize, 'offset=', offset);

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM roomdetail r WHERE ${whereSql}`,
    params
  );
  const total = Number(countRows[0]?.total || 0);
  const totalPages = useLimit ? 1 : Math.max(1, Math.ceil(total / pageSize));

  console.log('[roomsetting.service] getRooms COUNT total=', total);

  const [rows] = await pool.query(
    `SELECT r.id, r.roomname, r.title_fld, r.description_fld, r.remark, r.price,
            r.mainphoto, r.media_gallery_json, r.active, r.property_id, r.meter_id, r.smartdoor_id,
            r.available, r.availablesoon,
            p.shortname AS property_shortname
       FROM roomdetail r
       LEFT JOIN propertydetail p ON p.id = r.property_id
       WHERE ${whereSql}
       ${orderSql}
       LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  const roomIds = (rows || []).map(r => r.id);
  const roomIdsWithTenancy = new Set();
  if (roomIds.length > 0) {
    const placeholders = roomIds.map(() => '?').join(',');
    const [tenancyRows] = await pool.query(
      `SELECT room_id FROM tenancy WHERE client_id = ? AND room_id IN (${placeholders}) AND status = 1`,
      [clientId, ...roomIds]
    );
    (tenancyRows || []).forEach(row => roomIdsWithTenancy.add(row.room_id));
  }

  const items = (rows || []).map(r => ({
    _id: r.id,
    id: r.id,
    roomName: r.roomname || '',
    title_fld: r.title_fld || r.roomname || '',
    description_fld: r.description_fld || '',
    remark: r.remark || '',
    price: r.price != null ? Number(r.price) : null,
    mainPhoto: r.mainphoto || null,
    mediaGallery: (typeof r.media_gallery_json === 'string' ? (() => { try { return JSON.parse(r.media_gallery_json); } catch (_) { return []; } })() : r.media_gallery_json) || [],
    active: !!r.active,
    available: !!r.available,       /* roomdetail.available: tinyint 1/0 */
    availablesoon: !!r.availablesoon, /* roomdetail.availablesoon: tinyint 1/0 */
    propertyId: r.property_id,
    meter: r.meter_id || null,
    smartdoor: r.smartdoor_id || null,
    property: r.property_shortname != null ? { shortname: r.property_shortname, _id: r.property_id } : { _id: r.property_id },
    hasActiveTenancy: roomIdsWithTenancy.has(r.id)
  }));

  console.log('[roomsetting.service] getRooms returning items.length=', items.length);

  return {
    items,
    totalPages,
    currentPage: page,
    total
  };
}

/**
 * Get filter options: properties for dropdown.
 */
async function getRoomFilters(clientId) {
  const [rows] = await pool.query(
    'SELECT id, shortname FROM propertydetail WHERE client_id = ? ORDER BY shortname ASC LIMIT 1000',
    [clientId]
  );
  const properties = (rows || []).map(p => ({
    value: p.id,
    label: p.shortname || p.id
  }));
  return { properties };
}

/**
 * Get one room by id (for detail section).
 */
async function getRoom(clientId, roomId) {
  if (!roomId) return null;
  const [rows] = await pool.query(
    `SELECT r.id, r.roomname, r.title_fld, r.description_fld, r.remark, r.price,
            r.mainphoto, r.media_gallery_json, r.active, r.property_id, r.meter_id, r.smartdoor_id,
            r.available, r.availablesoon,
            p.shortname AS property_shortname
       FROM roomdetail r
       LEFT JOIN propertydetail p ON p.id = r.property_id
       WHERE r.id = ? AND r.client_id = ? LIMIT 1`,
    [roomId, clientId]
  );
  const r = rows && rows[0];
  if (!r) return null;
  return {
    _id: r.id,
    id: r.id,
    roomName: r.roomname || '',
    title_fld: r.title_fld || r.roomname || '',
    description_fld: r.description_fld || '',
    remark: r.remark || '',
    price: r.price != null ? Number(r.price) : null,
    mainPhoto: r.mainphoto || null,
    mediaGallery: (typeof r.media_gallery_json === 'string' ? (() => { try { return JSON.parse(r.media_gallery_json); } catch (_) { return []; } })() : r.media_gallery_json) || [],
    active: !!r.active,
    available: !!r.available,       /* roomdetail.available: tinyint 1/0 */
    availablesoon: !!r.availablesoon, /* roomdetail.availablesoon: tinyint 1/0 */
    propertyId: r.property_id,
    property: r.property_shortname != null ? { shortname: r.property_shortname, _id: r.property_id } : { _id: r.property_id },
    meter: r.meter_id || null,
    smartdoor: r.smartdoor_id || null
  };
}

/**
 * Compute title_fld = property shortname + roomName. propertyId can be room's property_id.
 */
async function computeRoomTitleFld(propertyId, roomName) {
  const name = (roomName ?? '').toString().trim();
  if (!propertyId) return name;
  const [rows] = await pool.query('SELECT shortname FROM propertydetail WHERE id = ? LIMIT 1', [propertyId]);
  const shortname = (rows && rows[0] && rows[0].shortname) ? String(rows[0].shortname).trim() : '';
  return `${shortname} ${name}`.trim() || name;
}

/**
 * Update room. data: roomName, description_fld, remark, price, property, mainPhoto, mediaGallery, active.
 * title_fld is auto-computed from property shortname + roomName when roomName or property changes.
 * available/availablesoon are system-only (booking/tenancy); not updatable by client here.
 * After update, syncs title_fld to meterdetail.title when room has a meter.
 */
async function updateRoom(clientId, roomId, data) {
  const room = await getRoom(clientId, roomId);
  if (!room) throw new Error('ROOM_NOT_FOUND');

  const roomname = data.roomName != null ? String(data.roomName).trim() : room.roomName;
  const property_id = data.property != null ? data.property : room.propertyId;
  const title_fld = (data.roomName !== undefined || data.property !== undefined)
    ? await computeRoomTitleFld(property_id, roomname)
    : (data.title_fld != null ? String(data.title_fld).trim() : (room.title_fld || roomname));
  const description_fld = data.description_fld != null ? String(data.description_fld) : room.description_fld;
  const remark = data.remark != null ? String(data.remark) : room.remark;
  const price = data.price != null ? (Number(data.price) || null) : room.price;
  const mainphoto = data.mainPhoto != null ? data.mainPhoto : room.mainPhoto;
  let media_gallery_json = room.mediaGallery;
  if (data.mediaGallery !== undefined) {
    media_gallery_json = Array.isArray(data.mediaGallery) ? data.mediaGallery : [];
  }
  const active = data.active !== undefined ? (data.active === true || data.active === 1) : room.active;

  await pool.query(
    `UPDATE roomdetail SET roomname = ?, title_fld = ?, description_fld = ?, remark = ?, price = ?,
      property_id = ?, mainphoto = ?, media_gallery_json = ?, active = ?, updated_at = NOW()
      WHERE id = ? AND client_id = ?`,
    [
      roomname,
      title_fld,
      description_fld || null,
      remark || null,
      price,
      property_id || null,
      mainphoto || null,
      JSON.stringify(media_gallery_json),
      active ? 1 : 0,
      roomId,
      clientId
    ]
  );
  const [r2] = await pool.query('SELECT meter_id FROM roomdetail WHERE id = ? AND client_id = ? LIMIT 1', [roomId, clientId]);
  const currentMeterId = r2 && r2[0] ? r2[0].meter_id : null;
  if (currentMeterId) {
    await pool.query('UPDATE meterdetail SET title = ?, updated_at = NOW() WHERE id = ?', [title_fld || roomname, currentMeterId]);
  }
  return { ok: true, room: await getRoom(clientId, roomId) };
}

/**
 * Insert rooms (batch). Each: { roomName, property } (property = property_id).
 * title_fld = property shortname + roomName.
 * New room: available=1 (vacant, system-only), active=0 (client turns on in Room Management).
 */
async function insertRooms(clientId, records) {
  if (!Array.isArray(records) || records.length === 0) {
    return { inserted: 0, ids: [] };
  }
  const ids = [];
  for (const r of records.slice(0, 500)) {
    const name = (r.roomName || '').trim();
    const propertyId = r.property || null;
    if (!name || !propertyId) continue;
    const title_fld = await computeRoomTitleFld(propertyId, name);
    const id = randomUUID();
    await pool.query(
      `INSERT INTO roomdetail (id, client_id, property_id, roomname, title_fld, active, available, availablesoon, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, 1, 0, NOW(), NOW())`,
      [id, clientId, propertyId, name, title_fld || name]
    );
    ids.push(id);
  }
  return { inserted: ids.length, ids };
}

/**
 * Get meter dropdown options: 已绑定的电表 (current item's meter) + 还没被绑定的电表 (unbound meters).
 * When roomId or propertyId is provided, the meter bound to that item is included so the dropdown can show and keep it.
 * All option values are returned as strings for reliable dropdown matching.
 */
async function getMeterDropdownOptions(clientId, roomId = null, propertyId = null) {
  const meterRows = await pool.query(
    'SELECT id, title FROM meterdetail WHERE client_id = ? AND status = 1 LIMIT 1000',
    [clientId]
  ).then(([rows]) => rows || []);

  console.log('[roomsetting.service] getMeterDropdownOptions: clientId=', clientId, 'roomId=', roomId, 'propertyId=', propertyId, 'meterRows.length=', meterRows.length, 'meterIds=', meterRows.map(m => m.id));

  if (meterRows.length === 0) {
    console.log('[roomsetting.service] getMeterDropdownOptions: no meters for client, returning []');
    return [];
  }

  const ids = meterRows.map(m => m.id);
  const toVal = (id) => (id != null ? String(id) : null);
  const toLabel = (m) => (m && m.title && String(m.title).trim()) ? String(m.title).trim() : 'Meter Unknown';

  const [usedByProperty] = await pool.query(
    'SELECT meter_id FROM propertydetail WHERE client_id = ? AND meter_id IS NOT NULL',
    [clientId]
  );
  const usedByPropertySet = new Set((usedByProperty || []).map(p => p.meter_id).filter(Boolean));

  const [roomRows] = await pool.query(
    'SELECT id, meter_id FROM roomdetail WHERE client_id = ? AND meter_id IN (?)',
    [clientId, ids]
  );
  const usedByRoom = new Set((roomRows || []).map(r => r.meter_id).filter(Boolean));

  console.log('[roomsetting.service] getMeterDropdownOptions: usedByProperty count=', usedByProperty?.length, 'usedByRoom count=', roomRows?.length);

  const options = [];
  const addedIds = new Set();

  function pushMeterOption(m) {
    if (!m || addedIds.has(m.id)) return;
    addedIds.add(m.id);
    options.push({ label: toLabel(m), value: toVal(m.id) });
  }

  if (roomId) {
    const [roomMeterRows] = await pool.query(
      'SELECT meter_id FROM roomdetail WHERE id = ? AND client_id = ? AND meter_id IS NOT NULL LIMIT 1',
      [roomId, clientId]
    );
    const currentMeterId = roomMeterRows?.[0]?.meter_id;
    console.log('[roomsetting.service] getMeterDropdownOptions: roomId path currentMeterId=', currentMeterId);
    if (currentMeterId) {
      const m = meterRows.find(m => m.id === currentMeterId);
      pushMeterOption(m || { id: currentMeterId, title: null });
    }
  }
  if (propertyId) {
    const [propMeterRows] = await pool.query(
      'SELECT meter_id FROM propertydetail WHERE id = ? AND client_id = ? AND meter_id IS NOT NULL LIMIT 1',
      [propertyId, clientId]
    );
    const currentMeterId = propMeterRows?.[0]?.meter_id;
    console.log('[roomsetting.service] getMeterDropdownOptions: propertyId path propMeterRows.length=', propMeterRows?.length, 'currentMeterId=', currentMeterId);
    if (currentMeterId) {
      const m = meterRows.find(m => m.id === currentMeterId);
      pushMeterOption(m || { id: currentMeterId, title: null });
    }
  }

  for (const m of meterRows) {
    if (usedByPropertySet.has(m.id)) continue;
    if (usedByRoom.has(m.id)) continue;
    pushMeterOption(m);
  }

  if (options.length === 0 && meterRows.length > 0 && !roomId && !propertyId) {
    console.log('[roomsetting.service] getMeterDropdownOptions: fallback (no roomId/propertyId) – returning all client meters');
    return meterRows.map(m => ({ label: (m.title && String(m.title).trim()) ? String(m.title).trim() : 'Meter Unknown', value: String(m.id) }));
  }

  console.log('[roomsetting.service] getMeterDropdownOptions: final options.length=', options.length);
  return options;
}

/**
 * Get smart door dropdown options: 原本绑定的门锁 (current item's lock) + 还没绑定的门锁 (unbound locks).
 * When roomId or propertyId is provided, the smart door bound to that item is included.
 * All option values are returned as strings for reliable dropdown matching.
 */
async function getSmartDoorDropdownOptions(clientId, roomId = null, propertyId = null) {
  const [lockRows] = await pool.query(
    'SELECT id, lockalias, lockname FROM lockdetail WHERE client_id = ? AND active = 1 LIMIT 1000',
    [clientId]
  );
  const locks = lockRows || [];
  console.log('[roomsetting.service] getSmartDoorDropdownOptions: clientId=', clientId, 'roomId=', roomId, 'propertyId=', propertyId, 'locks.length=', locks.length, 'lockIds=', locks.map(l => l.id));

  if (locks.length === 0) {
    console.log('[roomsetting.service] getSmartDoorDropdownOptions: no locks for client, returning []');
    return [];
  }

  const lockIds = locks.map(l => l.id);
  const toVal = (id) => (id != null ? String(id) : null);
  const toLabel = (lock) => {
    if (!lock) return 'Smart Door Unknown';
    const a = lock.lockalias && String(lock.lockalias).trim();
    const n = lock.lockname && String(lock.lockname).trim();
    return a || n || 'Smart Door Unknown';
  };

  const [usedByProperty] = await pool.query(
    'SELECT smartdoor_id FROM propertydetail WHERE client_id = ? AND smartdoor_id IS NOT NULL',
    [clientId]
  );
  const usedByPropertySet = new Set((usedByProperty || []).map(p => p.smartdoor_id).filter(Boolean));

  const [roomRows] = await pool.query(
    'SELECT id, smartdoor_id FROM roomdetail WHERE client_id = ? AND smartdoor_id IN (?)',
    [clientId, lockIds]
  );
  const usedByRoom = new Set((roomRows || []).map(r => r.smartdoor_id).filter(Boolean));

  console.log('[roomsetting.service] getSmartDoorDropdownOptions: usedByProperty count=', usedByProperty?.length, 'usedByRoom count=', roomRows?.length);

  const options = [];
  const addedIds = new Set();

  function pushLockOption(lock) {
    if (!lock || addedIds.has(lock.id)) return;
    addedIds.add(lock.id);
    options.push({ label: toLabel(lock), value: toVal(lock.id) });
  }

  if (roomId) {
    const [roomLockRows] = await pool.query(
      'SELECT smartdoor_id FROM roomdetail WHERE id = ? AND client_id = ? AND smartdoor_id IS NOT NULL LIMIT 1',
      [roomId, clientId]
    );
    const currentLockId = roomLockRows?.[0]?.smartdoor_id;
    console.log('[roomsetting.service] getSmartDoorDropdownOptions: roomId path currentLockId=', currentLockId);
    if (currentLockId) {
      const lock = locks.find(l => l.id === currentLockId);
      pushLockOption(lock || { id: currentLockId, lockalias: null, lockname: null });
    }
  }
  if (propertyId) {
    const [propLockRows] = await pool.query(
      'SELECT smartdoor_id FROM propertydetail WHERE id = ? AND client_id = ? AND smartdoor_id IS NOT NULL LIMIT 1',
      [propertyId, clientId]
    );
    const currentLockId = propLockRows?.[0]?.smartdoor_id;
    console.log('[roomsetting.service] getSmartDoorDropdownOptions: propertyId path propLockRows.length=', propLockRows?.length, 'currentLockId=', currentLockId);
    if (currentLockId) {
      const lock = locks.find(l => l.id === currentLockId);
      pushLockOption(lock || { id: currentLockId, lockalias: null, lockname: null });
    }
  }

  for (const lock of locks) {
    if (usedByPropertySet.has(lock.id)) continue;
    if (usedByRoom.has(lock.id)) continue;
    pushLockOption(lock);
  }

  if (options.length === 0 && locks.length > 0 && !roomId && !propertyId) {
    const toLabel = (l) => (l.lockalias && String(l.lockalias).trim()) ? String(l.lockalias).trim() : (l.lockname && String(l.lockname).trim()) ? String(l.lockname).trim() : 'Smart Door Unknown';
    console.log('[roomsetting.service] getSmartDoorDropdownOptions: fallback (no roomId/propertyId) – returning all client locks');
    return locks.map(l => ({ label: toLabel(l), value: String(l.id) }));
  }

  console.log('[roomsetting.service] getSmartDoorDropdownOptions: final options.length=', options.length);
  return options;
}

/**
 * Update room meter (bind or unbind). Same logic as Wix metersetting: clear old meter.room if different.
 */
async function updateRoomMeter(clientId, roomId, meterId) {
  const [roomRows] = await pool.query('SELECT id, meter_id, property_id FROM roomdetail WHERE id = ? AND client_id = ?', [roomId, clientId]);
  const room = roomRows && roomRows[0];
  if (!room) throw new Error('NO_PERMISSION');

  const oldMeterId = room.meter_id || null;

  if (oldMeterId && oldMeterId !== meterId) {
    const [oldMeterRows] = await pool.query('SELECT id, room_id FROM meterdetail WHERE id = ?', [oldMeterId]);
    const oldMeter = oldMeterRows && oldMeterRows[0];
    if (oldMeter && oldMeter.room_id === roomId) {
      await pool.query('UPDATE meterdetail SET room_id = NULL, property_id = NULL, updated_at = NOW() WHERE id = ?', [oldMeterId]);
    }
  }

  if (!meterId) {
    await pool.query('UPDATE roomdetail SET meter_id = NULL, updated_at = NOW() WHERE id = ? AND client_id = ?', [roomId, clientId]);
    return { ok: true };
  }

  const [meterRows] = await pool.query('SELECT id, client_id, room_id, property_id FROM meterdetail WHERE id = ?', [meterId]);
  const meter = meterRows && meterRows[0];
  if (!meter || meter.client_id !== clientId) throw new Error('INVALID_METER');
  if ((meter.room_id && meter.room_id !== roomId) || (meter.property_id && meter.property_id !== room.property_id)) {
    throw new Error('METER_ALREADY_IN_USE');
  }

  const [roomTitleRows] = await pool.query('SELECT title_fld, roomname FROM roomdetail WHERE id = ? AND client_id = ? LIMIT 1', [roomId, clientId]);
  const roomTitle = (roomTitleRows && roomTitleRows[0] && roomTitleRows[0].title_fld) ? roomTitleRows[0].title_fld : (roomTitleRows && roomTitleRows[0] ? roomTitleRows[0].roomname : null);
  await pool.query('UPDATE meterdetail SET room_id = ?, property_id = ?, title = ?, updated_at = NOW() WHERE id = ?', [roomId, room.property_id, roomTitle, meterId]);
  await pool.query('UPDATE roomdetail SET meter_id = ?, updated_at = NOW() WHERE id = ? AND client_id = ?', [meterId, roomId, clientId]);
  return { ok: true };
}

/**
 * Update room smart door (bind or unbind).
 */
async function updateRoomSmartDoor(clientId, roomId, smartDoorId) {
  const [roomRows] = await pool.query('SELECT id FROM roomdetail WHERE id = ? AND client_id = ?', [roomId, clientId]);
  const room = roomRows && roomRows[0];
  if (!room) throw new Error('NO_PERMISSION');

  if (!smartDoorId) {
    await pool.query('UPDATE roomdetail SET smartdoor_id = NULL, updated_at = NOW() WHERE id = ? AND client_id = ?', [roomId, clientId]);
    return { ok: true };
  }

  const [lockRows] = await pool.query('SELECT id, client_id, active FROM lockdetail WHERE id = ?', [smartDoorId]);
  const lock = lockRows && lockRows[0];
  if (!lock || lock.client_id !== clientId || !lock.active) throw new Error('INVALID_OR_INACTIVE_SMART_DOOR');

  const [usedByProperty] = await pool.query('SELECT id FROM propertydetail WHERE client_id = ? AND smartdoor_id = ? LIMIT 1', [clientId, smartDoorId]);
  if (usedByProperty && usedByProperty.length) throw new Error('SMART_DOOR_ALREADY_USED_BY_PROPERTY');

  const [usedByRoom] = await pool.query('SELECT id FROM roomdetail WHERE client_id = ? AND smartdoor_id = ? AND id != ? LIMIT 1', [clientId, smartDoorId, roomId]);
  if (usedByRoom && usedByRoom.length) throw new Error('SMART_DOOR_ALREADY_USED_BY_ROOM');

  await pool.query('UPDATE roomdetail SET smartdoor_id = ?, updated_at = NOW() WHERE id = ? AND client_id = ?', [smartDoorId, roomId, clientId]);
  return { ok: true };
}

/**
 * Get active tenancy for room (for detail popup: tenant name, phone, rental, dates).
 */
async function getTenancyForRoom(clientId, roomId) {
  const [rows] = await pool.query(
    `SELECT t.id, t.tenant_id, t.begin, t.end, t.rental,
            td.fullname, td.phone
       FROM tenancy t
       LEFT JOIN tenantdetail td ON td.id = t.tenant_id
       WHERE t.client_id = ? AND t.room_id = ? AND t.status = 1
       ORDER BY t.end DESC LIMIT 1`,
    [clientId, roomId]
  );
  const r = rows && rows[0];
  if (!r) return null;
  return {
    _id: r.id,
    id: r.id,
    begin: r.begin,
    end: r.end,
    rental: r.rental != null ? Number(r.rental) : null,
    tenant: r.tenant_id ? {
      _id: r.tenant_id,
      fullname: r.fullname || '',
      phone: r.phone || ''
    } : null
  };
}

/**
 * Toggle room active (for list view checkbox).
 */
async function setRoomActive(clientId, roomId, active) {
  const [roomRows] = await pool.query('SELECT id, meter_id, smartdoor_id FROM roomdetail WHERE id = ? AND client_id = ?', [roomId, clientId]);
  const room = roomRows && roomRows[0];
  if (!room) throw new Error('ROOM_NOT_FOUND');
  if (active === false && (room.meter_id || room.smartdoor_id)) {
    throw new Error('REMOVE_METER_OR_SMART_DOOR_FIRST');
  }
  await pool.query('UPDATE roomdetail SET active = ?, updated_at = NOW() WHERE id = ? AND client_id = ?', [active ? 1 : 0, roomId, clientId]);
  return { ok: true };
}

module.exports = {
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
};
