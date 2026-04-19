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
const MAX_PAGE_SIZE = 200;
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
            p.shortname AS property_shortname,
            COALESCE(r.title_fld,
              (SELECT r2.title_fld FROM roomdetail r2
                WHERE r2.meter_id = m.id AND r2.client_id = m.client_id LIMIT 1)
            ) AS room_title,
            COALESCE(m.room_id,
              (SELECT r2.id FROM roomdetail r2
                WHERE r2.meter_id = m.id AND r2.client_id = m.client_id LIMIT 1)
            ) AS room_id_effective
       FROM meterdetail m
       LEFT JOIN propertydetail p ON p.id = m.property_id
       LEFT JOIN roomdetail r ON r.id = m.room_id
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
    room: r.room_id_effective || null,
    roomTitle: r.room_title || null,
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
            COALESCE(r.title_fld,
              (SELECT r2.title_fld FROM roomdetail r2
                WHERE r2.meter_id = m.id AND r2.client_id = m.client_id LIMIT 1)
            ) AS room_title,
            COALESCE(m.room_id,
              (SELECT r2.id FROM roomdetail r2
                WHERE r2.meter_id = m.id AND r2.client_id = m.client_id LIMIT 1)
            ) AS room_id_effective
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
    room: r.room_id_effective || null,
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
  let rate = meter.rate;
  const rateProvided =
    data.rate !== undefined && data.rate !== null && String(data.rate).trim() !== '';
  if (rateProvided) {
    rate = Number(data.rate);
    if (Number.isNaN(rate) || rate <= 0) {
      throw new Error('INVALID_RATE');
    }
  }
  const mode = data.mode != null ? data.mode : meter.mode;
  const status = data.status !== undefined ? (data.status === true || data.status === 1) : meter.status;

  // Table: title + rate。CNYIOT editMeter：仅在本请求显式传了 rate 且有效时同步电价（避免只改 status 仍调 editMeter）。
  console.log('[updateMeter] clientId=%s meterId=%s title(table)=%s rate=%s rateProvided=%s', clientId, meterId, title, rate, rateProvided);
  if (rateProvided && rate != null && !Number.isNaN(rate) && rate > 0 && meter.meterId) {
    const platformMeterId = String(meter.meterId).trim();
    if (platformMeterId) {
      try {
        const cnyiotMeterName = await cnyiotEditMeterNameOnly(clientId);
        if (!cnyiotMeterName) {
          console.warn('[updateMeter] skip CNYIOT editMeter: CLIENT_SUBDOMAIN_REQUIRED (set company subdomain)');
        } else {
          await meterWrapper.updateMeterNameAndRate(clientId, {
            meterId: platformMeterId,
            currentMeterName: cnyiotMeterName,
            rate
          });
          console.log('[updateMeter] updateMeterNameAndRate OK (CNYIOT MeterName=subdomain only: %s)', cnyiotMeterName);
        }
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
 * CNYIOT deleteMeter codes we treat as success: meter already removed / not on platform — still delete DB row.
 * (Operators often remove on CNYIOT first, then clear our CMS row.)
 */
const CNYIOT_DELETE_SKIP_DB_STILL = new Set([5003]);

/**
 * Delete meter: 1) CNYIOT deleteMeter (platform account) 2) then MySQL + room/property unbind.
 */
async function deleteMeter(clientId, meterId) {
  const meter = await getMeter(clientId, meterId);
  if (!meter) throw new Error('METER_NOT_FOUND');

  const platformMid = String(meter.meterId || '').trim();
  if (!platformMid) throw new Error('METER_PLATFORM_ID_MISSING');

  console.log('[deleteMeter] CNYIOT deleteMeter first metid=%s cmsId=%s', platformMid, meterId);
  const cnyRes = await meterWrapper.deleteMeters(clientId, [platformMid]);
  const resNum = Number(cnyRes?.result);
  const cnyOk = resNum === 0 || resNum === 200;
  const rawVal = cnyRes?.value;
  const valueArr = Array.isArray(rawVal) ? rawVal : rawVal != null ? [rawVal] : [];
  const failed = valueArr.filter((v) => {
    if (!v) return false;
    const code = Number(v.val);
    if (code === 0 || code === 200) return false;
    if (CNYIOT_DELETE_SKIP_DB_STILL.has(code)) return false;
    return true;
  });

  if (!cnyOk) {
    if (CNYIOT_DELETE_SKIP_DB_STILL.has(resNum)) {
      console.warn(
        '[deleteMeter] CNYIOT deleteMeter result=%s (meter absent on platform), continuing MySQL delete cmsId=%s',
        cnyRes?.result,
        meterId
      );
    } else {
      console.error('[deleteMeter] CNYIOT deleteMeter failed result=%s', cnyRes?.result);
      throw new Error(`CNYIOT_DELETE_FAILED_${cnyRes?.result ?? 'UNKNOWN'}`);
    }
  } else if (failed.length > 0) {
    const codes = failed.map((v) => v.val).join(',');
    console.error('[deleteMeter] CNYIOT deleteMeter per-item failure codes=%s', codes);
    throw new Error(`CNYIOT_DELETE_FAILED_${codes}`);
  }
  console.log('[deleteMeter] CNYIOT OK (or skipped absent meter), deleting MySQL cmsId=%s', meterId);

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

  await pool.query(
    'UPDATE roomdetail SET meter_id = NULL, updated_at = NOW() WHERE meter_id = ? AND client_id = ?',
    [meterId, clientId]
  );
  await pool.query(
    'UPDATE propertydetail SET meter_id = NULL, updated_at = NOW() WHERE meter_id = ? AND client_id = ?',
    [meterId, clientId]
  ).catch(() => {});

  await pool.query('DELETE FROM meterdetail WHERE id = ? AND client_id = ?', [meterId, clientId]);
  return { ok: true };
}

/**
 * One physical meter ID → at most one client in our DB. Prevents operator A from claiming B's meter.
 */
async function getMeterIdOwnerClientId(meterId) {
  const mid = String(meterId || '').trim();
  if (!mid) return null;
  const [rows] = await pool.query(
    'SELECT client_id FROM meterdetail WHERE meterid = ? LIMIT 1',
    [mid]
  );
  return rows && rows[0] ? rows[0].client_id : null;
}

/**
 * CNYIOT addMeter 等平台名：subdomain + MeterID（与 insertMetersFromPreview 一致）。
 */
async function cnyiotOperatorMeterDisplayName(clientId, platformMeterId) {
  const sub = await getClientSubdomain(clientId);
  const mid = String(platformMeterId || '').trim();
  if (!mid) return '';
  return sub ? `${String(sub).trim()}${mid}` : mid;
}

/** editMeter 的 MeterName：只用 client subdomain（公司标识），不用 Portal title、也不拼 meterId。 */
async function cnyiotEditMeterNameOnly(clientId) {
  const sub = await getClientSubdomain(clientId);
  return sub ? String(sub).trim() : '';
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
  let subdomainForNew = null;

  for (const rec of records) {
    const meterId = String(rec.meterId || '').trim();
    const title = String(rec.title || rec.name || '').trim();
    const mode = rec.mode || 'prepaid';
    if (!meterId || !title) continue;

    const ownerClientId = await getMeterIdOwnerClientId(meterId);
    if (ownerClientId && ownerClientId !== clientId) {
      console.warn('[metersetting-add] reject meterId=%s other client', meterId);
      throw new Error(
        'This meter ID is already registered to another operator account. Each meter can only belong to one company.'
      );
    }
    if (ownerClientId === clientId) {
      console.log('[metersetting-add] service duplicate skip meterId=', meterId);
      skipped += 1;
      continue;
    }

    if (subdomainForNew === null) {
      subdomainForNew = await getClientSubdomain(clientId);
      if (!subdomainForNew) {
        throw new Error('CLIENT_SUBDOMAIN_REQUIRED');
      }
    }
    const nameOnPlatform = `${subdomainForNew}${meterId}`;

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
      Name: nameOnPlatform,
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
  const subdomain = await getClientSubdomain(clientId);
  let idxCounter = 1;
  const cnyiotMeters = [];
  for (const rec of records || []) {
    const meterId = String(rec.meterId || '').trim();
    const title = String(rec.title || rec.name || '').trim();
    const mode = rec.mode || 'prepaid';
    if (!meterId || !title) continue;
    const nameOnPlatform = subdomain ? `${subdomain}${meterId}` : meterId;
    cnyiotMeters.push({
      MeterID: meterId,
      MeterModel: mode === 'prepaid' ? 0 : 1,
      Name: nameOnPlatform,
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

const SYNC_ALL_MAX = 500;

/**
 * Sync all meters for client (CNYIoT → meterdetail). Sequential to reduce API pressure.
 * @returns {{ ok: boolean, total: number, succeeded: number, failed: number, errors: Array<{ meterId: string, reason: string }>, message?: string }}
 */
async function syncAllMeters(clientId) {
  if (!clientId) throw new Error('CLIENT_ID_REQUIRED');
  const [rows] = await pool.query(
    `SELECT meterid FROM meterdetail WHERE client_id = ? AND meterid IS NOT NULL AND TRIM(COALESCE(meterid, '')) != '' ORDER BY id ASC LIMIT ?`,
    [clientId, SYNC_ALL_MAX]
  );
  const ids = [...new Set((rows || []).map((r) => String(r.meterid).trim()).filter(Boolean))];
  if (ids.length === 0) {
    return { ok: true, total: 0, succeeded: 0, failed: 0, errors: [], message: 'NO_METERS_TO_SYNC' };
  }
  const errors = [];
  let succeeded = 0;
  for (const mid of ids) {
    try {
      const r = await syncMeterByCmsMeterId(clientId, mid);
      if (r && r.ok !== false) succeeded += 1;
      else errors.push({ meterId: mid, reason: String(r?.reason || 'SYNC_FAILED') });
    } catch (e) {
      errors.push({ meterId: mid, reason: String(e?.message || e) });
    }
  }
  const failed = errors.length;
  const allOk = failed === 0;
  return {
    ok: allOk || succeeded > 0,
    total: ids.length,
    succeeded,
    failed,
    errors: errors.slice(0, 50),
    ...(allOk ? {} : { partial: true }),
    ...(succeeded === 0 && failed > 0 ? { reason: 'ALL_SYNC_FAILED' } : {})
  };
}

/**
 * Client topup: (1) CNYIOT sellByApi + sellByApiOk (2) DB balance += top-up kWh
 * (3) prepaid + newBal>0 → Active ON + setRelay 通电（含平台账号重试）; postpaid → 仍接通继电器。
 * Do NOT run syncMeterByCmsMeterId here — it overwrites balance/status from device while readings still lag.
 */
async function clientTopup(clientId, opts, amount) {
  const meterCmsIdIn = opts?.meterCmsId ? String(opts.meterCmsId).trim() : '';
  const platformMidIn = opts?.platformMid != null ? String(opts.platformMid).trim() : '';
  const amountNum = Number(amount);
  if (Number.isNaN(amountNum) || amountNum <= 0) throw new Error('INVALID_TOPUP_AMOUNT');

  let meterRow;
  if (meterCmsIdIn) {
    const [rows] = await pool.query(
      'SELECT id, meterid, balance, rate, mode FROM meterdetail WHERE id = ? AND client_id = ? LIMIT 1',
      [meterCmsIdIn, clientId]
    );
    meterRow = rows && rows[0];
  } else if (platformMidIn) {
    const [rows] = await pool.query(
      'SELECT id, meterid, balance, rate, mode FROM meterdetail WHERE client_id = ? AND meterid = ? LIMIT 1',
      [clientId, platformMidIn]
    );
    meterRow = rows && rows[0];
  }
  if (!meterRow) throw new Error('METER_NOT_FOUND');

  const meterCmsId = meterRow.id;
  const platformMid = String(meterRow.meterid || '').trim();
  if (!platformMid) throw new Error('METER_PLATFORM_ID_MISSING');

  const mode = String(meterRow.mode || 'prepaid').toLowerCase() === 'postpaid' ? 'postpaid' : 'prepaid';
  const oldBalance = Number(meterRow.balance) || 0;
  const rate = Number(meterRow.rate) || 0;
  const addKwh = rate > 0 ? amountNum / rate : amountNum;
  const newBal = Math.round((oldBalance + addKwh) * 10000) / 10000;

  const pending = await meterWrapper.createPendingTopup(clientId, platformMid, amountNum, { byMoney: true });
  const idx = pending?.value?.idx ?? pending?.idx;
  if (idx == null) throw new Error('TOPUP_PENDING_NO_IDX');
  await meterWrapper.confirmTopup(clientId, platformMid, idx);

  const statusAfter = mode === 'prepaid' && newBal <= 0 ? 0 : 1;
  await pool.query(
    'UPDATE meterdetail SET balance = ?, status = ?, lastsyncat = NOW(), updated_at = NOW() WHERE id = ? AND client_id = ?',
    [newBal, statusAfter, meterCmsId, clientId]
  );

  try {
    if (mode === 'prepaid') {
      if (newBal > 0) {
        await connectRelayAfterPrepaidTopupIfHasBalance(clientId, meterCmsId, platformMid, newBal);
      } else {
        await updateMeterStatus(clientId, meterCmsId, false);
      }
    } else {
      await updateMeterStatus(clientId, meterCmsId, true);
    }
  } catch (e) {
    console.warn('[clientTopup] relay / status failed', meterCmsId, e?.message || e);
  }

  const [afterRows] = await pool.query(
    'SELECT balance, status FROM meterdetail WHERE id = ? AND client_id = ? LIMIT 1',
    [meterCmsId, clientId]
  );
  const after = afterRows && afterRows[0];
  return {
    ok: true,
    balance: after != null ? Number(after.balance) : newBal,
    status: !!(after && after.status),
    synced: false
  };
}

/**
 * Clear prepaid: (1) CNYIOT clearKwh (2) balance=0 (3) active=false + relay disconnect (close current).
 * meterCmsId = meterdetail.id (UUID).
 * Does not change roomdetail.active — room listing stays independent of meter power.
 */
async function clearMeterKwh(clientId, meterCmsId) {
  const meter = await getMeter(clientId, meterCmsId);
  if (!meter) throw new Error('METER_NOT_FOUND');
  if (String(meter.mode || '').toLowerCase() !== 'prepaid') {
    throw new Error('CLEAR_KWH_PREPAID_ONLY');
  }
  const platformMid = String(meter.meterId || '').trim();
  if (!platformMid) throw new Error('METER_PLATFORM_ID_MISSING');

  const cnyRes = await meterWrapper.clearKwh(clientId, platformMid);
  const ok = cnyRes?.result === 0 || cnyRes?.result === 200;
  if (!ok) {
    throw new Error(`CNYIOT_CLEAR_KWH_FAILED_${cnyRes?.result ?? 'UNKNOWN'}`);
  }

  await pool.query(
    'UPDATE meterdetail SET balance = 0, status = 0, lastsyncat = NOW(), updated_at = NOW() WHERE id = ? AND client_id = ?',
    [meterCmsId, clientId]
  );

  const st = await updateMeterStatus(clientId, meterCmsId, false);
  if (!st.relayOk && platformMid) {
    console.warn('[clearMeterKwh] setRelay OFF not confirmed for meter=%s', platformMid);
  }

  const [rowArr] = await pool.query(
    'SELECT balance, status FROM meterdetail WHERE id = ? AND client_id = ? LIMIT 1',
    [meterCmsId, clientId]
  );
  const row = rowArr && rowArr[0];
  return {
    ok: true,
    balance: row != null ? Number(row.balance) : 0,
    status: !!(row && row.status),
    clearedKwh: true
  };
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
 * Update meter status only (Active 开关 — meterdetail.status + CNYIOT setRelay).
 * setRelay: Active (on) → Val 2 = connect; deactivate (off) → Val 1 = disconnect.
 *
 * **Never** updates roomdetail.active or calls roomsetting — a room may stay Active in the portal
 * (listing/booking) while this meter is power-off (relay open). Product rule: meter power ≠ room listing.
 */
async function updateMeterStatus(clientId, meterId, status) {
  const [rows] = await pool.query(
    'SELECT id, meterid, balance, mode FROM meterdetail WHERE id = ? AND client_id = ? LIMIT 1',
    [meterId, clientId]
  );
  if (!rows || !rows.length) throw new Error('METER_NOT_FOUND');
  const row = rows[0];
  const balance = Number(row.balance) || 0;
  const mode = String(row.mode || 'prepaid').toLowerCase() === 'postpaid' ? 'postpaid' : 'prepaid';

  await pool.query('UPDATE meterdetail SET status = ?, updated_at = NOW() WHERE id = ? AND client_id = ?', [status ? 1 : 0, meterId, clientId]);
  const platformMeterId = row.meterid ? String(row.meterid).trim() : '';
  let relayOk = !platformMeterId;
  if (platformMeterId) {
    const val = status ? 2 : 1;
    try {
      await meterWrapper.setRelay(clientId, platformMeterId, val);
      relayOk = true;
      console.log('[updateMeterStatus] setRelay clientId=%s meterId=%s status=%s val=%s', clientId, platformMeterId, status, val);
    } catch (e) {
      relayOk = false;
      console.warn('[updateMeterStatus] setRelay failed (DB already updated)', clientId, platformMeterId, e?.message || e);
    }
  }

  let hint = 'POWER_OFF';
  if (status) {
    if (mode === 'postpaid') {
      hint = 'ON_POSTPAID';
    } else if (balance > 0) {
      hint = 'ON_PREPAID_HAS_BALANCE';
    } else {
      hint = 'ON_PREPAID_ZERO_BALANCE';
    }
  }

  return { ok: true, relayOk, hint, balance, mode };
}

/**
 * After prepaid top-up with positive kWh balance: ensure Active ON + setRelay Val=2 (通电).
 */
async function connectRelayAfterPrepaidTopupIfHasBalance(clientId, meterCmsId, platformMid, newBal) {
  if (!platformMid || newBal <= 0) {
    return { ok: true, relayOk: true, skipped: true, hint: 'SKIP_NO_BALANCE', balance: newBal, mode: 'prepaid' };
  }
  return updateMeterStatus(clientId, meterCmsId, true);
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
    const ownerClientId = await getMeterIdOwnerClientId(meterId);
    if (ownerClientId && ownerClientId !== clientId) {
      console.warn('[insertMetersFromPreview] reject meterId=%s owned by other client', meterId);
      throw new Error(
        'This meter ID is already registered to another operator account. Each meter can only belong to one company.'
      );
    }
    if (ownerClientId === clientId) {
      console.log('[insertMetersFromPreview] skip already in your account meterId=%s', meterId);
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
    if (isAlreadyExists) {
      console.error('[insertMetersFromPreview] CNYIOT says meter already on platform — refuse to bind to this operator');
      throw new Error(
        'This meter already exists on CNYIOT under another registration. It cannot be added to your account here.'
      );
    }
    if (!ok || failedCodes.length > 0) {
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

/**
 * Bind meter to property only (whole unit / parent meter — no room).
 * meterCmsId = meterdetail.id (UUID).
 */
async function bindMeterToProperty(clientId, meterCmsId, propertyId) {
  const pid = String(propertyId || '').trim();
  if (!pid) throw new Error('PROPERTY_ID_REQUIRED');
  const [[m]] = await pool.query(
    'SELECT id FROM meterdetail WHERE id = ? AND client_id = ? LIMIT 1',
    [meterCmsId, clientId]
  );
  if (!m) throw new Error('METER_NOT_FOUND');
  const [[p]] = await pool.query(
    'SELECT id FROM propertydetail WHERE id = ? AND client_id = ? LIMIT 1',
    [pid, clientId]
  );
  if (!p) throw new Error('PROPERTY_NOT_FOUND');
  await pool.query(
    'UPDATE meterdetail SET property_id = ?, room_id = NULL, updated_at = NOW() WHERE id = ? AND client_id = ?',
    [pid, meterCmsId, clientId]
  );
  return { ok: true };
}

module.exports = {
  getMeters,
  getMeterFilters,
  getMeter,
  updateMeter,
  updateMeterStatus,
  connectRelayAfterPrepaidTopupIfHasBalance,
  deleteMeter,
  insertMeters,
  getAddMeterRequestBody,
  getActiveMeterProvidersByClient,
  getUsageSummary,
  syncMeterByCmsMeterId,
  syncAllMeters,
  clientTopup,
  clearMeterKwh,
  loadGroupList,
  deleteGroup,
  submitGroup,
  previewNewMeters,
  insertMetersFromPreview,
  bindMeterToProperty
};
