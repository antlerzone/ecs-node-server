/**
 * Meter Setting – list/filters/get/update/delete/insert meters, groups, providers,
 * usage summary, sync, client topup. Uses MySQL: meterdetail, propertydetail, roomdetail, client_integration.
 * CNYIoT: meter.wrapper (addMeters, updateMeterNameAndRate, getUsageSummary, createPendingTopup, confirmTopup), sync.wrapper (syncMeterByCmsMeterId).
 */

const { randomUUID } = require('crypto');
const pool = require('../../config/db');
const meterWrapper = require('../cnyiot/wrappers/meter.wrapper');
const syncWrapper = require('../cnyiot/wrappers/sync.wrapper');
const { getCnyiotSubuserId, getClientSubdomain } = require('../cnyiot/lib/cnyiotSubuser');
const { getValidCnyIotToken } = require('../cnyiot/lib/cnyiotToken.service');

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const CACHE_LIMIT_MAX = 2000;

function orderClause(sort) {
  switch (String(sort || 'title').toLowerCase()) {
    case 'meterid':
      return 'ORDER BY m.meterid ASC, m.title ASC';
    case 'meterid_desc':
      return 'ORDER BY m.meterid DESC, m.title ASC';
    case 'title_desc':
      return 'ORDER BY m.title DESC, m.meterid ASC';
    case 'title':
    default:
      return 'ORDER BY m.title ASC, m.meterid ASC';
  }
}

function listConditions(clientId, opts = {}) {
  const keyword = (opts.keyword || opts.search || '').trim().toLowerCase();
  const propertyId = opts.propertyId === 'ALL' || !opts.propertyId ? null : opts.propertyId;
  const filter = opts.filter === 'ALL' || !opts.filter ? null : opts.filter;
  const conditions = ['m.client_id = ?'];
  const params = [clientId];
  if (propertyId) {
    conditions.push('m.property_id = ?');
    params.push(propertyId);
  }
  if (filter === 'PREPAID' || filter === 'MODE_PREPAID') {
    conditions.push('m.mode = ?');
    params.push('prepaid');
  } else if (filter === 'POSTPAID' || filter === 'MODE_POSTPAID') {
    conditions.push('m.mode = ?');
    params.push('postpaid');
  } else if (filter === 'ONLINE') {
    conditions.push('m.isonline = 1');
  } else if (filter === 'OFFLINE') {
    conditions.push('(m.isonline = 0 OR m.isonline IS NULL)');
  } else if (filter === 'ACTIVE') {
    conditions.push('m.status = 1');
  } else if (filter === 'INACTIVE') {
    conditions.push('(m.status = 0 OR m.status IS NULL)');
  } else if (filter === 'BRAND_CNYIOT') {
    conditions.push('(m.productname = ? OR m.productname IS NULL)');
    params.push('CNYIOT');
  }
  if (keyword && keyword.length >= 1) {
    conditions.push('(m.meterid LIKE ? OR m.title LIKE ? OR m.productname LIKE ?)');
    const term = `%${keyword}%`;
    params.push(term, term, term);
  }
  return { whereSql: conditions.join(' AND '), params };
}

/**
 * List meters for client with filters and pagination.
 * opts: { keyword?, propertyId?, filter?, sort?, page?, pageSize?, limit? }
 * limit: when set, one page with up to limit items (for frontend cache).
 */
async function getMeters(clientId, opts = {}) {
  const limit = opts.limit != null ? Math.min(CACHE_LIMIT_MAX, Math.max(1, parseInt(opts.limit, 10) || 0)) : null;
  const useLimit = limit != null && limit > 0;
  const page = useLimit ? 1 : Math.max(1, parseInt(opts.page, 10) || 1);
  const pageSize = useLimit ? limit : Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(opts.pageSize, 10) || DEFAULT_PAGE_SIZE));
  const offset = (page - 1) * pageSize;

  const { whereSql, params } = listConditions(clientId, opts);
  const orderSql = orderClause(opts.sort || 'title');

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM meterdetail m WHERE ${whereSql}`,
    params
  );
  const total = Number(countRows[0]?.total || 0);
  const totalPages = useLimit ? 1 : Math.max(1, Math.ceil(total / pageSize));

  const [rows] = await pool.query(
    `SELECT m.id, m.meterid, m.title, m.meter_type, m.mode, m.rate, m.balance, m.productname, m.isonline, m.status,
            m.client_id, m.room_id, m.property_id, m.metersharing_json, m.lastsyncat,
            p.shortname AS property_shortname
       FROM meterdetail m
       LEFT JOIN propertydetail p ON p.id = m.property_id
       WHERE ${whereSql}
       ${orderSql}
       LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  const items = (rows || []).map(r => ({
    _id: r.id,
    id: r.id,
    meterId: r.meterid || '',
    title: r.title || '',
    meterType: r.meter_type || 'parent',
    mode: r.mode || null,
    rate: r.rate != null ? Number(r.rate) : null,
    balance: r.balance != null ? Number(r.balance) : null,
    productName: r.productname || '',
    isOnline: !!r.isonline,
    status: !!r.status,
    room: r.room_id || null,
    property: r.property_id || null,
    propertyShortname: r.property_shortname || null,
    metersharing: parseJson(r.metersharing_json),
    lastSyncAt: r.lastsyncat || null
  }));

  return { items, totalPages, currentPage: page, total };
}

function parseJson(val) {
  if (val == null) return [];
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch (_) { return []; }
  }
  return Array.isArray(val) ? val : [];
}

/**
 * Get filter options: properties + services (Mode/Brand) for dropdown.
 */
async function getMeterFilters(clientId) {
  const [propRows] = await pool.query(
    'SELECT id, shortname FROM propertydetail WHERE client_id = ? ORDER BY shortname ASC LIMIT 1000',
    [clientId]
  );
  const properties = (propRows || []).map(p => ({
    value: p.id,
    label: p.shortname || p.id
  }));

  const services = [
    { label: 'All', value: 'ALL' },
    { label: 'Prepaid', value: 'PREPAID' },
    { label: 'Postpaid', value: 'POSTPAID' },
    { label: 'Online', value: 'ONLINE' },
    { label: 'Offline', value: 'OFFLINE' },
    { label: 'Active', value: 'ACTIVE' },
    { label: 'Inactive', value: 'INACTIVE' }
  ];

  return { properties, services };
}

/**
 * Get one meter by id (for detail section).
 */
async function getMeter(clientId, meterId) {
  if (!meterId) return null;
  const [rows] = await pool.query(
    `SELECT m.id, m.meterid, m.title, m.meter_type, m.mode, m.rate, m.balance, m.productname, m.isonline, m.status,
            m.room_id, m.property_id, m.metersharing_json, m.lastsyncat,
            p.shortname AS property_shortname,
            r.title_fld AS room_title
       FROM meterdetail m
       LEFT JOIN propertydetail p ON p.id = m.property_id
       LEFT JOIN roomdetail r ON r.id = m.room_id
       WHERE m.id = ? AND m.client_id = ? LIMIT 1`,
    [meterId, clientId]
  );
  const r = rows && rows[0];
  if (!r) return null;
  return {
    _id: r.id,
    id: r.id,
    meterId: r.meterid || '',
    title: r.title || '',
    meterType: r.meter_type || 'parent',
    mode: r.mode || null,
    rate: r.rate != null ? Number(r.rate) : null,
    balance: r.balance != null ? Number(r.balance) : null,
    productName: r.productname || '',
    isOnline: !!r.isonline,
    status: !!r.status,
    room: r.room_id || null,
    property: r.property_id || null,
    propertyShortname: r.property_shortname || null,
    roomName: r.room_title || null,
    metersharing: parseJson(r.metersharing_json),
    lastSyncAt: r.lastsyncat || null
  };
}

/**
 * Update meter: title, rate, mode, status. Syncs name+rate to CNYIoT.
 */
async function updateMeter(clientId, meterId, data) {
  const meter = await getMeter(clientId, meterId);
  if (!meter) throw new Error('METER_NOT_FOUND');

  const title = data.title != null ? String(data.title).trim() : meter.title;
  const rate = data.rate != null ? (Number(data.rate) || null) : meter.rate;
  const mode = data.mode != null ? data.mode : meter.mode;
  const status = data.status !== undefined ? (data.status === true || data.status === 1) : meter.status;

  if (rate !== null && (Number.isNaN(rate) || rate <= 0)) {
    throw new Error('INVALID_RATE');
  }

  // Table: title + rate. CNYIOT: only update rate (PriceID); do not change backend system name. #inputdetailmetername → table only.
  console.log('[updateMeter] clientId=%s meterId=%s title(table)=%s rate=%s', clientId, meterId, title, rate);
  if (rate != null && !Number.isNaN(rate) && rate > 0 && meter.meterId) {
    const platformMeterId = String(meter.meterId).trim();
    if (platformMeterId) {
      try {
        await meterWrapper.updateMeterNameAndRate(clientId, {
          meterId: platformMeterId,
          currentMeterName: meter.title,
          rate,
          usePlatformAccount: true
        });
        console.log('[updateMeter] updateMeterNameAndRate OK (platform name unchanged, main account)');
      } catch (e) {
        if (e?.message === 'RATE_NOT_IN_PRICE_LIST' || e?.message === 'RATE_CREATE_FAILED') throw e;
        console.warn('[updateMeter] CNYIoT sync failed, continuing CMS update', e?.message);
      }
    }
  }

  const metersharingJson = JSON.stringify(meter.metersharing && meter.metersharing.length ? meter.metersharing : []);
  const [updateResult] = await pool.query(
    `UPDATE meterdetail SET title = ?, rate = ?, mode = ?, status = ?, metersharing_json = ?, updated_at = NOW() WHERE id = ? AND client_id = ?`,
    [title, rate, mode, status ? 1 : 0, metersharingJson, meterId, clientId]
  );
  const affected = updateResult?.affectedRows ?? 0;
  console.log('[updateMeter] table updated id=%s rate=%s affectedRows=%s', meterId, rate, affected);
  if (affected === 0) {
    console.warn('[updateMeter] UPDATE meterdetail affected 0 rows');
  }
  return { ok: true, meter: await getMeter(clientId, meterId) };
}

/**
 * Delete meter: clear metersharing from all meters in same group(s), then delete.
 */
async function deleteMeter(clientId, meterId) {
  const meter = await getMeter(clientId, meterId);
  if (!meter) throw new Error('METER_NOT_FOUND');

  const sharing = meter.metersharing || [];
  for (const row of sharing) {
    const groupId = row.sharinggroupId;
    if (!groupId) continue;
    const [all] = await pool.query(
      'SELECT id, metersharing_json FROM meterdetail WHERE client_id = ? AND COALESCE(metersharing_json, "[]") != "[]"',
      [clientId]
    );
    for (const m of all || []) {
      const arr = parseJson(m.metersharing_json).filter(ms => ms.sharinggroupId !== groupId);
      await pool.query(
        'UPDATE meterdetail SET metersharing_json = ?, updated_at = NOW() WHERE id = ?',
        [JSON.stringify(arr), m.id]
      );
    }
  }

  await pool.query('DELETE FROM meterdetail WHERE id = ? AND client_id = ?', [meterId, clientId]);
  return { ok: true };
}

/**
 * Insert new meters: write MySQL then call CNYIoT addMeters.
 * Client must have CNYIOT subuser (create in Company Setting first); every meter is grouped under that subuser.
 * Duplicate meterid for same client_id is skipped (not inserted again, not sent to CNYIOT).
 */
async function insertMeters(clientId, records) {
  console.log('[metersetting-add] service insertMeters clientId=', clientId, 'records.length=', records?.length);
  if (!Array.isArray(records) || records.length === 0) {
    console.log('[metersetting-add] service skip empty records');
    return { inserted: 0, ids: [], skipped: 0 };
  }

  const subuserId = await getCnyiotSubuserId(clientId);
  console.log('[metersetting-add] service subuserId=', subuserId);
  if (!subuserId) {
    console.log('[metersetting-add] service FAIL CLIENT_MUST_HAVE_CNYIOT_SUBUSER');
    throw new Error('CLIENT_MUST_HAVE_CNYIOT_SUBUSER');
  }

  const client = await getClientStationIndex(clientId);
  const stationIndex = client?.stationIndex ?? String(subuserId);
  console.log('[metersetting-add] service stationIndex=', stationIndex);

  const ids = [];
  const cnyiotMeters = [];
  let idxCounter = 1;
  let skipped = 0;

  for (const rec of records) {
    const meterId = String(rec.meterId || '').trim();
    const title = String(rec.title || rec.name || '').trim();
    const mode = rec.mode || 'prepaid';
    if (!meterId || !title) continue;

    const [existing] = await pool.query(
      'SELECT id, title, mode FROM meterdetail WHERE client_id = ? AND meterid = ? LIMIT 1',
      [clientId, meterId]
    );
    if (existing && existing.length > 0) {
      console.log('[metersetting-add] service duplicate skip meterId=', meterId);
      skipped += 1;
      continue;
    }

    const id = randomUUID();
    await pool.query(
      `INSERT INTO meterdetail (id, client_id, meterid, title, mode, balance, productname, isonline, status, lastsyncat, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, 'CNYIOT', 0, 1, NOW(), NOW(), NOW())`,
      [id, clientId, meterId, title, mode]
    );
    console.log('[metersetting-add] service MySQL inserted id=', id, 'meterId=', meterId);
    ids.push(id);
    cnyiotMeters.push({
      MeterID: meterId,
      MeterModel: mode === 'prepaid' ? 0 : 1,
      Name: title,
      PriceID: '1',
      UserID: String(stationIndex),
      index: String(idxCounter++)
    });
  }

  if (cnyiotMeters.length === 0) {
    console.log('[metersetting-add] service no new meters to send to CNYIOT skipped=', skipped);
    return { inserted: 0, ids: [], skipped };
  }

  console.log('[metersetting-add] service 1) getPrices → getMetList → addMeter → link2User, count=', cnyiotMeters.length);
  const cnyRes = await meterWrapper.addMeters(clientId, cnyiotMeters);
  console.log('[metersetting-add] service 2) addMeter result=', cnyRes?.result, 'value=', cnyRes?.value);
  if (cnyRes?.result !== 0 && cnyRes?.result !== 200) {
    console.log('[metersetting-add] service FAIL CNYIOT_ADD_FAILED');
    throw new Error(`CNYIOT_ADD_FAILED_${cnyRes?.result || 'UNKNOWN'}`);
  }
  if (Array.isArray(cnyRes?.value)) {
    const failed = cnyRes.value.filter((v) => v && Number(v.val) !== 0 && Number(v.val) !== 200);
    if (failed.length > 0) {
      const codes = failed.map((v) => v.val).join(',');
      console.error('[metersetting-add] service addMeter per-item failure val=%s', codes);
      throw new Error(`CNYIOT_ADD_FAILED_${codes}`);
    }
  }
  console.log('[metersetting-add] service 3) addMeter OK, link2User done for', cnyiotMeters.length, 'meters');

  return { inserted: ids.length, ids, skipped, cnyiotSummary: { addMeterResult: cnyRes?.result, link2UserCount: cnyiotMeters.length } };
}

/**
 * Build full request body that would be sent to CNYIOT addMeter (for debug display).
 * Does not insert into DB or call CNYIOT.
 */
async function getAddMeterRequestBody(clientId, records) {
  const subuserId = await getCnyiotSubuserId(clientId);
  const client = await getClientStationIndex(clientId);
  const stationIndex = client?.stationIndex ?? (subuserId ? String(subuserId) : '0');
  let idxCounter = 1;
  const cnyiotMeters = [];
  for (const rec of records || []) {
    const meterId = String(rec.meterId || '').trim();
    const title = String(rec.title || rec.name || '').trim();
    const mode = rec.mode || 'prepaid';
    if (!meterId || !title) continue;
    cnyiotMeters.push({
      MeterID: meterId,
      MeterModel: mode === 'prepaid' ? 0 : 1,
      Name: title,
      PriceID: '1',
      UserID: String(stationIndex),
      index: String(idxCounter++),
      warmkwh: rec.warmkwh ?? '0',
      sellmin: rec.sellmin ?? 0,
      isAdd: '1',
      group: rec.group ?? '0'
    });
  }
  if (cnyiotMeters.length === 0) {
    return { body: null, loginid: null, LoginID: null };
  }
  const payload = await meterWrapper.getAddMeterPayload(clientId, cnyiotMeters);
  const token = await getValidCnyIotToken(clientId);
  const fullBody = { ...payload, loginid: token.loginID, LoginID: token.loginID };
  return { body: fullBody, payload, loginid: token.loginID, LoginID: token.loginID };
}

async function getClientStationIndex(clientId) {
  const [rows] = await pool.query(
    `SELECT values_json FROM client_integration WHERE client_id = ? AND \`key\` = 'meter' AND provider = 'cnyiot' AND enabled = 1 LIMIT 1`,
    [clientId]
  );
  if (!rows.length) return null;
  const v = rows[0].values_json;
  const values = typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch (_) { return {}; } })() : (v || {});
  const stationIndex = values.Station_index ?? values.station_index ?? values.cnyiot_subuser_id ?? null;
  return { stationIndex: stationIndex != null ? String(stationIndex) : '0' };
}

/**
 * Get active meter providers for client (from client_integration key=meter, enabled).
 */
async function getActiveMeterProvidersByClient(clientId) {
  const [rows] = await pool.query(
    `SELECT slot, values_json FROM client_integration WHERE client_id = ? AND \`key\` = 'meter' AND enabled = 1 ORDER BY slot ASC LIMIT 20`,
    [clientId]
  );
  return (rows || []).map(r => {
    const v = r.values_json;
    const values = typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch (_) { return {}; } })() : (v || {});
    return {
      slot: r.slot ?? 0,
      provider: values?.provider || 'CNYIOT'
    };
  });
}

/**
 * Usage summary for date range (calls CNYIoT getMonthBill).
 */
async function getUsageSummary(clientId, { meterIds, start, end }) {
  return meterWrapper.getUsageSummary(clientId, { meterIds, start, end });
}

/**
 * Sync single meter by CMS meterid (11-digit). Updates meterdetail from CNYIoT status.
 */
async function syncMeterByCmsMeterId(clientId, meterId) {
  return syncWrapper.syncMeterByCmsMeterId(clientId, String(meterId));
}

/**
 * Client topup: create pending then confirm. meterId = 11-digit meterid.
 * amount = 金额 (sellMoney)，按元充值；simple=2 只传 sellMoney。
 */
async function clientTopup(clientId, meterId, amount) {
  const pending = await meterWrapper.createPendingTopup(clientId, String(meterId), Number(amount), { byMoney: true });
  const idx = pending?.value?.idx ?? pending?.idx;
  if (idx == null) throw new Error('TOPUP_PENDING_NO_IDX');
  await meterWrapper.confirmTopup(clientId, String(meterId), idx);
  return { ok: true };
}

/**
 * Load group list (from meterdetail.metersharing_json).
 */
async function loadGroupList(clientId) {
  const [rows] = await pool.query(
    'SELECT id, meterid, title, mode, metersharing_json FROM meterdetail WHERE client_id = ? AND metersharing_json IS NOT NULL AND JSON_LENGTH(COALESCE(metersharing_json, "[]")) > 0',
    [clientId]
  );
  const groupMap = new Map();
  for (const m of rows || []) {
    const arr = parseJson(m.metersharing_json);
    for (const ms of arr) {
      const gid = ms.sharinggroupId;
      if (!gid) continue;
      if (!groupMap.has(gid)) {
        groupMap.set(gid, { _id: gid, groupId: gid, name: ms.groupName || `Group ${gid}`, meters: [] });
      }
      groupMap.get(gid).meters.push({
        _id: m.id,
        id: m.id,
        meterId: m.meterid,
        title: m.title,
        mode: m.mode,
        role: ms.role,
        groupName: ms.groupName,
        sharingmode: ms.sharingmode,
        sharingType: ms.sharingType,
        active: ms.active !== false
      });
    }
  }
  return [...groupMap.values()];
}

/**
 * Delete group: clear metersharing for all meters in group.
 */
async function deleteGroup(clientId, groupId) {
  const [all] = await pool.query(
    'SELECT id, metersharing_json FROM meterdetail WHERE client_id = ? AND COALESCE(metersharing_json, "[]") != "[]"',
    [clientId]
  );
  const rows = (all || []).filter(m => parseJson(m.metersharing_json).some(ms => ms.sharinggroupId === groupId));
  for (const m of rows) {
    const arr = parseJson(m.metersharing_json).filter(ms => ms.sharinggroupId !== groupId);
    await pool.query('UPDATE meterdetail SET metersharing_json = ?, updated_at = NOW() WHERE id = ?', [JSON.stringify(arr), m.id]);
  }
  return { ok: true };
}

/**
 * Submit group: create or update meter group (parent/child/brother).
 * payload: { groupId?, mode, groupName, sharingType, parentId?, childIds[], childActive?: { [meterId]: boolean } }
 */
async function submitGroup(clientId, payload) {
  const groupId = payload.groupId || `G${Date.now()}`;
  const mode = payload.mode;
  const groupName = String(payload.groupName || '').trim();
  const sharingType = payload.sharingType || 'percentage';
  const parentId = payload.parentId || null;
  const childIds = Array.isArray(payload.childIds) ? [...new Set(payload.childIds)].filter(id => id && id !== parentId) : [];

  if (!groupName) throw new Error('GROUP_NAME_REQUIRED');
  if (mode !== 'brother' && !parentId) throw new Error('PARENT_METER_REQUIRED');
  if (mode === 'brother' && childIds.length < 2) throw new Error('BROTHER_REQUIRES_AT_LEAST_TWO');
  if (mode !== 'brother' && childIds.length === 0) throw new Error('AT_LEAST_ONE_CHILD');

  const childActive = payload.childActive || {};

  if (payload.groupId) {
    const [allM] = await pool.query(
      'SELECT id, metersharing_json FROM meterdetail WHERE client_id = ? AND COALESCE(metersharing_json, "[]") != "[]"',
      [clientId]
    );
    for (const m of allM || []) {
      const arr = parseJson(m.metersharing_json).filter(ms => ms.sharinggroupId !== payload.groupId);
      await pool.query('UPDATE meterdetail SET metersharing_json = ?, updated_at = NOW() WHERE id = ?', [JSON.stringify(arr), m.id]);
    }
  }

  if (mode !== 'brother') {
    const parentRow = { sharinggroupId: groupId, sharingmode: mode, sharingType, role: 'parent', groupName };
    const [parent] = await pool.query('SELECT id, metersharing_json FROM meterdetail WHERE id = ? AND client_id = ?', [parentId, clientId]);
    if (!parent || !parent.length) throw new Error('PARENT_NOT_FOUND');
    const arr = parseJson(parent[0].metersharing_json);
    const rest = arr.filter(ms => ms.sharinggroupId !== groupId);
    rest.push(parentRow);
    await pool.query('UPDATE meterdetail SET metersharing_json = ?, updated_at = NOW() WHERE id = ?', [JSON.stringify(rest), parentId]);
  }

  const role = mode === 'brother' ? 'peer' : 'child';
  for (const cid of childIds) {
    const [c] = await pool.query('SELECT id, metersharing_json FROM meterdetail WHERE id = ? AND client_id = ?', [cid, clientId]);
    if (!c || !c.length) continue;
    const row = { sharinggroupId: groupId, sharingmode: mode, sharingType, role, active: childActive[cid] !== false, groupName };
    const arr = parseJson(c[0].metersharing_json);
    const rest = arr.filter(ms => ms.sharinggroupId !== groupId);
    rest.push(row);
    await pool.query('UPDATE meterdetail SET metersharing_json = ?, updated_at = NOW() WHERE id = ?', [JSON.stringify(rest), cid]);
  }

  if (mode === 'brother') {
    for (const cid of childIds) {
      const [c] = await pool.query('SELECT id, metersharing_json FROM meterdetail WHERE id = ? AND client_id = ?', [cid, clientId]);
      if (!c || !c.length) continue;
      const row = { sharinggroupId: groupId, sharingmode: mode, sharingType, role: 'peer', active: childActive[cid] !== false, groupName };
      const arr = parseJson(c[0].metersharing_json);
      const rest = arr.filter(ms => ms.sharinggroupId !== groupId);
      rest.push(row);
      await pool.query('UPDATE meterdetail SET metersharing_json = ?, updated_at = NOW() WHERE id = ?', [JSON.stringify(rest), cid]);
    }
  }

  return { ok: true, groupId };
}

/**
 * Update meter status only (checkbox toggle).
 * Also calls setRelay: status false → Val 1 (断开), status true → Val 2 (闭合).
 */
async function updateMeterStatus(clientId, meterId, status) {
  const [rows] = await pool.query(
    'SELECT id, meterid FROM meterdetail WHERE id = ? AND client_id = ? LIMIT 1',
    [meterId, clientId]
  );
  if (!rows || !rows.length) throw new Error('METER_NOT_FOUND');
  const row = rows[0];
  await pool.query('UPDATE meterdetail SET status = ?, updated_at = NOW() WHERE id = ? AND client_id = ?', [status ? 1 : 0, meterId, clientId]);
  const platformMeterId = row.meterid ? String(row.meterid).trim() : '';
  if (platformMeterId) {
    const val = status ? 2 : 1; // 2 闭合(开), 1 断开(关)
    try {
      await meterWrapper.setRelay(clientId, platformMeterId, val);
      console.log('[updateMeterStatus] setRelay clientId=%s meterId=%s status=%s val=%s', clientId, platformMeterId, status, val);
    } catch (e) {
      console.warn('[updateMeterStatus] setRelay failed (DB already updated)', clientId, platformMeterId, e?.message || e);
    }
  }
  return { ok: true };
}

/**
 * Preview meters that exist in CNYIOT but not yet in our meterdetail (for Sync Meter flow).
 * getMetList_Simple returns value.d[] with "i" (meter id) and "n" (name); also support MeterID/Name.
 * Returns { list: Array<{ meterId, name?, title? }>, total: number }.
 */
async function previewNewMeters(clientId) {
  const listRes = await meterWrapper.getMeters(clientId, 1);
  const rawList = Array.isArray(listRes?.value) ? listRes.value : (Array.isArray(listRes?.value?.d) ? listRes.value.d : []);
  console.log('[previewNewMeters] clientId=%s rawList.length=%s valueKeys=%s', clientId, rawList?.length ?? 0, listRes?.value ? Object.keys(listRes.value) : 'no value');
  const [ourRows] = await pool.query('SELECT meterid FROM meterdetail WHERE client_id = ?', [clientId]);
  const ourMeterIds = new Set((ourRows || []).map(r => String(r.meterid || '').trim()).filter(Boolean));
  console.log('[previewNewMeters] ourMeterIds.size=%s', ourMeterIds.size);
  const list = [];
  for (const m of rawList || []) {
    const meterId = String(m.i ?? m.MeterID ?? m.meterId ?? m.meterid ?? '').trim();
    if (!meterId || ourMeterIds.has(meterId)) continue;
    const name = (m.n ?? m.Name ?? m.name ?? m.title ?? meterId).toString().trim();
    list.push({
      meterId,
      name: name || meterId,
      title: name || meterId,
      mode: m.m === 1 ? 'postpaid' : 'prepaid'
    });
  }
  console.log('[previewNewMeters] new list.length=%s sample=%j', list.length, list.slice(0, 2));
  return { list, total: list.length };
}

/**
 * Insert meters: main-account addMeter (Name=subdomain+meterId, Note=subdomain, UserID=0), then INSERT meterdetail.
 * records: [{ meterId, title?, mode? }]. DB column title = rec.title (from #inputname/#textmetertitle) or subdomain+meterId.
 */
async function insertMetersFromPreview(clientId, records) {
  console.log('[insertMetersFromPreview] clientId=%s records.length=%s', clientId, records?.length ?? 0);
  if (!Array.isArray(records) || records.length === 0) return { inserted: 0, ids: [] };

  const subdomain = await getClientSubdomain(clientId);
  if (!subdomain) throw new Error('CLIENT_SUBDOMAIN_REQUIRED');

  const toAdd = [];
  const toInsert = [];
  for (const rec of records) {
    const meterId = String(rec.meterId || '').trim();
    const mode = rec.mode || 'prepaid';
    if (!meterId) continue;
    const [existing] = await pool.query('SELECT id FROM meterdetail WHERE client_id = ? AND meterid = ? LIMIT 1', [clientId, meterId]);
    if (existing && existing.length > 0) {
      console.log('[insertMetersFromPreview] skip already exists meterId=%s', meterId);
      continue;
    }
    const nameOnPlatform = subdomain + meterId;
    const title = (rec.title != null && String(rec.title).trim() !== '') ? String(rec.title).trim() : nameOnPlatform;
    toAdd.push({
      MeterID: meterId,
      Name: nameOnPlatform,
      Note: subdomain,
      MeterModel: mode === 'postpaid' ? 1 : 0
    });
    toInsert.push({ meterId, title, mode });
  }

  if (toAdd.length > 0) {
    console.log('[insertMetersFromPreview] clientId=%s toAdd=%j', clientId, toAdd);
    const cnyRes = await meterWrapper.addMetersNoBind(clientId, toAdd);
    const ok = cnyRes?.result === 0 || cnyRes?.result === 200;
    const valueArr = Array.isArray(cnyRes?.value) ? cnyRes.value : [];
    const failedCodes = valueArr.filter((v) => v && Number(v.val) !== 0 && Number(v.val) !== 200).map((v) => v.val);
    const isAlreadyExists = failedCodes.length > 0 && failedCodes.every((c) => c === 4132 || c === 4142);
    console.log('[insertMetersFromPreview] addMetersNoBind result=%s value=%j failedCodes=%j isAlreadyExists=%s', cnyRes?.result, valueArr, failedCodes, isAlreadyExists);
    if (!ok || (failedCodes.length > 0 && !isAlreadyExists)) {
      const codes = failedCodes.length ? failedCodes.join(',') : (cnyRes?.result ?? 'UNKNOWN');
      console.error('[insertMetersFromPreview] CNYIOT addMeter failed, NOT writing to table. codes=%s', codes);
      throw new Error(`CNYIOT_ADD_FAILED_${codes}`);
    }
  }

  const ids = [];
  for (const rec of toInsert) {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO meterdetail (id, client_id, meterid, title, mode, balance, productname, isonline, status, lastsyncat, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, 'CNYIOT', 0, 1, NOW(), NOW(), NOW())`,
      [id, clientId, rec.meterId, rec.title || rec.meterId, rec.mode]
    );
    ids.push(id);
    console.log('[insertMetersFromPreview] inserted meterId=%s id=%s', rec.meterId, id);
  }
  console.log('[insertMetersFromPreview] done inserted=%s', ids.length);
  return { inserted: ids.length, ids };
}

module.exports = {
  getMeters,
  getMeterFilters,
  getMeter,
  updateMeter,
  updateMeterStatus,
  deleteMeter,
  insertMeters,
  getAddMeterRequestBody,
  getActiveMeterProvidersByClient,
  getUsageSummary,
  syncMeterByCmsMeterId,
  clientTopup,
  loadGroupList,
  deleteGroup,
  submitGroup,
  previewNewMeters,
  insertMetersFromPreview
};
