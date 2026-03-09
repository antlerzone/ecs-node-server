/**
 * Smart Door Setting – list/update locks & gateways, preview/sync TTLock, filters.
 * Uses MySQL: lockdetail, gatewaydetail, propertydetail, roomdetail.
 * FK: client_id, gateway_id (lock→gateway). No Wix CMS.
 * Pattern: cache + services filter like expenses (list with limit for cache).
 *
 * Sync only: we do NOT have "add smart door" in this app. Locks are added via Bluetooth
 * (TTLock app or SDK lockInitialize); then they appear in TTLock API list. We sync by
 * preview-selection (list from TTLock) and insert-smartdoors (write to lockdetail).
 * To add a new physical lock the user must use TTLock app + Bluetooth or open-platform SDK.
 */

const { randomUUID } = require('crypto');
const pool = require('../../config/db');
const lockWrapper = require('../ttlock/wrappers/lock.wrapper');
const gatewayWrapper = require('../ttlock/wrappers/gateway.wrapper');

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const CACHE_LIMIT_MAX = 2000;

/**
 * List smart doors (locks + gateways) for client with filters.
 * @param {string} clientId
 * @param {Object} opts - { keyword?, propertyId?, filter?, sort?, page?, pageSize?, limit? }
 *   filter: 'ALL' | 'LOCK' | 'GATEWAY' | 'ACTIVE' | 'INACTIVE'
 *   limit: when set, one page with up to limit items (for frontend cache).
 * @returns {Promise<{ items, totalPages, currentPage, total }>}
 */
async function getSmartDoorList(clientId, opts = {}) {
  const limit = opts.limit != null ? Math.min(CACHE_LIMIT_MAX, Math.max(1, parseInt(opts.limit, 10) || 0)) : null;
  const useLimit = limit != null && limit > 0;

  const filter = String(opts.filter || 'ALL').toUpperCase();
  const keyword = (opts.keyword || '').trim().toLowerCase();
  const propertyId = opts.propertyId === 'ALL' || !opts.propertyId ? null : opts.propertyId;

  let lockItems = [];
  let gatewayItems = [];

  if (filter !== 'GATEWAY') {
    let lockSql = `SELECT id, lockid, lockalias, lockname, gateway_id, hasgateway, electricquantity, type, brand, isonline, active, childmeter, client_id
       FROM lockdetail WHERE client_id = ?`;
    const lockParams = [clientId];
    if (filter === 'ACTIVE') {
      lockSql += ' AND active = 1';
    } else if (filter === 'INACTIVE') {
      lockSql += ' AND active = 0';
    }
    const [lockRows] = await pool.query(lockSql, lockParams);
    lockItems = (lockRows || []).map(r => ({
      _id: r.id,
      __type: 'lock',
      lockId: r.lockid,
      lockAlias: r.lockalias || '',
      lockName: r.lockname || '',
      gateway: r.gateway_id || null,
      hasGateway: !!r.hasgateway,
      electricQuantity: r.electricquantity != null ? Number(r.electricquantity) : 0,
      type: r.type || '',
      brand: r.brand || '',
      isOnline: !!r.isonline,
      active: !!r.active,
      childmeter: parseChildmeter(r.childmeter),
      client: r.client_id
    }));
    const idToLock = new Map(lockItems.map(l => [l._id, l]));
    lockItems.forEach(l => {
      l.childmeterAliases = (l.childmeter || []).map(id => idToLock.get(id)?.lockAlias || id);
      const parent = lockItems.find(o => o._id !== l._id && (o.childmeter || []).includes(l._id));
      l.parentLockAlias = parent ? parent.lockAlias : null;
    });
  }

  if (filter !== 'LOCK') {
    const [gwRows] = await pool.query(
      `SELECT id, gatewayid, gatewayname, networkname, locknum, isonline, type, client_id
       FROM gatewaydetail WHERE client_id = ?`,
      [clientId]
    );
    gatewayItems = (gwRows || []).map(r => ({
      _id: r.id,
      __type: 'gateway',
      gatewayId: r.gatewayid,
      gatewayName: r.gatewayname || '',
      networkName: r.networkname || '',
      lockNum: r.locknum != null ? Number(r.locknum) : 0,
      isOnline: !!r.isonline,
      type: r.type || '',
      client: r.client_id
    }));
  }

  let items = [...lockItems, ...gatewayItems];

  if (keyword) {
    items = items.filter(i => {
      const name = (i.lockAlias || i.gatewayName || '').toLowerCase();
      const extId = String(i.lockId || i.gatewayId || '');
      return name.includes(keyword) || extId.includes(keyword);
    });
  }

  if (propertyId) {
    const doorIds = await getSmartDoorIdsByProperty(clientId, propertyId);
    if (!doorIds || doorIds.length === 0) {
      return { items: [], totalPages: 1, currentPage: 1, total: 0 };
    }
    items = items.filter(i => i.__type === 'gateway' || doorIds.includes(i._id));
  }

  const total = items.length;
  const page = useLimit ? 1 : Math.max(1, parseInt(opts.page, 10) || 1);
  const pageSize = useLimit ? limit : Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(opts.pageSize, 10) || DEFAULT_PAGE_SIZE));
  const totalPages = useLimit ? 1 : Math.max(1, Math.ceil(total / pageSize));
  const offset = (page - 1) * pageSize;
  items = items.slice(offset, offset + pageSize);

  return { items, totalPages, currentPage: page, total };
}

function parseChildmeter(val) {
  if (val == null) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) { return []; }
  }
  return [];
}

/**
 * Get filter options: properties for dropdown.
 */
async function getSmartDoorFilters(clientId) {
  const [rows] = await pool.query(
    `SELECT id, shortname FROM propertydetail WHERE client_id = ? ORDER BY shortname ASC LIMIT 1000`,
    [clientId]
  );
  const properties = (rows || []).map(r => ({ label: r.shortname || r.id, value: r.id }));
  return { properties };
}

/**
 * Get single lock by id (client must own it).
 */
async function getLock(clientId, id) {
  const [rows] = await pool.query(
    `SELECT id, lockid, lockalias, lockname, gateway_id, hasgateway, electricquantity, type, brand, isonline, active, childmeter, client_id
     FROM lockdetail WHERE id = ? AND client_id = ? LIMIT 1`,
    [id, clientId]
  );
  const r = rows && rows[0];
  if (!r) return null;
  return {
    _id: r.id,
    __type: 'lock',
    lockId: r.lockid,
    lockAlias: r.lockalias || '',
    lockName: r.lockname || '',
    gateway: r.gateway_id || null,
    hasGateway: !!r.hasgateway,
    electricQuantity: r.electricquantity != null ? Number(r.electricquantity) : 0,
    type: r.type || '',
    brand: r.brand || '',
    isOnline: !!r.isonline,
    active: !!r.active,
    childmeter: parseChildmeter(r.childmeter),
    client: r.client_id
  };
}

/**
 * Get single gateway by id.
 */
async function getGateway(clientId, id) {
  const [rows] = await pool.query(
    `SELECT id, gatewayid, gatewayname, networkname, locknum, isonline, type, client_id
     FROM gatewaydetail WHERE id = ? AND client_id = ? LIMIT 1`,
    [id, clientId]
  );
  const r = rows && rows[0];
  if (!r) return null;
  return {
    _id: r.id,
    __type: 'gateway',
    gatewayId: r.gatewayid,
    gatewayName: r.gatewayname || '',
    networkName: r.networkname || '',
    lockNum: r.locknum != null ? Number(r.locknum) : 0,
    isOnline: !!r.isonline,
    type: r.type || '',
    client: r.client_id
  };
}

/**
 * Update lock: lockAlias, active, childmeter (array of lockdetail ids).
 */
async function updateLock(clientId, id, data) {
  const [rows] = await pool.query('SELECT id FROM lockdetail WHERE id = ? AND client_id = ?', [id, clientId]);
  if (!rows || rows.length === 0) return { ok: false, reason: 'LOCK_NOT_FOUND' };

  const updates = [];
  const params = [];
  if (data.lockAlias !== undefined) {
    updates.push('lockalias = ?');
    params.push(String(data.lockAlias));
  }
  if (data.active !== undefined) {
    updates.push('active = ?');
    params.push(data.active ? 1 : 0);
  }
  if (data.childmeter !== undefined) {
    updates.push('childmeter = ?');
    params.push(JSON.stringify(Array.isArray(data.childmeter) ? data.childmeter : []));
  }
  if (updates.length === 0) return { ok: true };
  params.push(id);
  await pool.query(`UPDATE lockdetail SET ${updates.join(', ')} WHERE id = ?`, params);
  return { ok: true };
}

/**
 * Update gateway: gatewayName.
 */
async function updateGateway(clientId, id, data) {
  const [rows] = await pool.query('SELECT id FROM gatewaydetail WHERE id = ? AND client_id = ?', [id, clientId]);
  if (!rows || rows.length === 0) return { ok: false, reason: 'GATEWAY_NOT_FOUND' };
  if (data.gatewayName === undefined) return { ok: true };
  await pool.query('UPDATE gatewaydetail SET gatewayname = ? WHERE id = ?', [String(data.gatewayName), id]);
  return { ok: true };
}

/**
 * Preview new smart doors from TTLock not yet in DB; sync existing (alias, electricQuantity).
 * Returns { total, list } with items { _id, provider, type, externalId, lockAlias }.
 */
async function previewSmartDoorSelection(clientId) {
  const result = [];

  try {
    const lockRes = await lockWrapper.listAllLocks(clientId);
    const lockList = lockRes?.list || [];
    for (const l of lockList) {
      const lockId = Number(l.lockId);
      const newAlias = l.lockAlias || l.lockName || '';
      const newElectric = Number(l.electricQuantity || 0);

      const [existRows] = await pool.query(
        'SELECT id, lockalias, electricquantity FROM lockdetail WHERE client_id = ? AND lockid = ? LIMIT 1',
        [clientId, lockId]
      );
      if (existRows && existRows.length > 0) {
        const row = existRows[0];
        let needUpdate = false;
        if ((row.lockalias || '') !== newAlias) needUpdate = true;
        if (Number(row.electricquantity || 0) !== newElectric) needUpdate = true;
        if (needUpdate) {
          await pool.query('UPDATE lockdetail SET lockalias = ?, electricquantity = ? WHERE id = ?', [newAlias, newElectric, row.id]);
        }
        continue;
      }
      result.push({
        _id: `lock_${lockId}`,
        provider: 'ttlock',
        type: 'lock',
        externalId: String(lockId),
        lockAlias: newAlias,
        lockName: l.lockName || '',
        electricQuantity: newElectric,
        hasGateway: !!l.gatewayId,
        gatewayId: l.gatewayId != null ? String(l.gatewayId) : null
      });
    }
  } catch (err) {
    console.error('[smartdoorsetting] preview locks error', err.message);
  }

  try {
    const gatewayRes = await gatewayWrapper.listAllGateways(clientId);
    const gwList = gatewayRes?.list || [];
    for (const g of gwList) {
      const gatewayId = Number(g.gatewayId);
      const newName = g.gatewayName || '';

      const [existRows] = await pool.query(
        'SELECT id, gatewayname FROM gatewaydetail WHERE client_id = ? AND gatewayid = ? LIMIT 1',
        [clientId, gatewayId]
      );
      if (existRows && existRows.length > 0) {
        const row = existRows[0];
        if ((row.gatewayname || '') !== newName) {
          await pool.query('UPDATE gatewaydetail SET gatewayname = ? WHERE id = ?', [newName, row.id]);
        }
        continue;
      }
      result.push({
        _id: `gateway_${gatewayId}`,
        provider: 'ttlock',
        type: 'gateway',
        externalId: String(gatewayId),
        lockAlias: newName,
        gatewayName: newName,
        networkName: g.networkName || '',
        lockNum: Number(g.lockNum || 0),
        isOnline: !!g.isOnline
      });
    }
  } catch (err) {
    console.error('[smartdoorsetting] preview gateways error', err.message);
  }

  return { total: result.length, list: result };
}

/**
 * Sync name to TTLock (rename lock or gateway).
 */
async function syncTTLockName(clientId, { type, externalId, name }) {
  if (!name || !externalId) throw new Error('NAME_AND_EXTERNAL_ID_REQUIRED');
  if (type === 'lock') {
    await lockWrapper.changeLockName(clientId, Number(externalId), name);
    return { ok: true };
  }
  if (type === 'gateway') {
    await gatewayWrapper.renameGateway(clientId, Number(externalId), name);
    return { ok: true };
  }
  throw new Error(`UNKNOWN_TYPE: ${type}`);
}

/**
 * Get lockdetail ids that belong to this property (property.smartdoor_id + rooms' smartdoor_id).
 */
async function getSmartDoorIdsByProperty(clientId, propertyId) {
  const ids = new Set();
  const [propRows] = await pool.query(
    'SELECT smartdoor_id FROM propertydetail WHERE id = ? AND client_id = ? LIMIT 1',
    [propertyId, clientId]
  );
  if (propRows && propRows[0] && propRows[0].smartdoor_id) {
    ids.add(propRows[0].smartdoor_id);
  }
  const [roomRows] = await pool.query(
    'SELECT smartdoor_id FROM roomdetail WHERE property_id = ? AND smartdoor_id IS NOT NULL',
    [propertyId]
  );
  (roomRows || []).forEach(r => { if (r.smartdoor_id) ids.add(r.smartdoor_id); });
  return Array.from(ids);
}

/**
 * Resolve location label for a lock: room title > property shortname > 'no connect'.
 */
async function resolveSmartDoorLocationLabel(clientId, lockDetailId) {
  const [roomRows] = await pool.query(
    'SELECT title_fld, roomname FROM roomdetail WHERE smartdoor_id = ? LIMIT 1',
    [lockDetailId]
  );
  if (roomRows && roomRows[0]) return roomRows[0].title_fld || roomRows[0].roomname || 'room';

  const [propRows] = await pool.query(
    'SELECT shortname FROM propertydetail WHERE smartdoor_id = ? AND client_id = ? LIMIT 1',
    [lockDetailId, clientId]
  );
  if (propRows && propRows[0]) return propRows[0].shortname || 'property';
  return 'no connect';
}

/**
 * Get child lock options for dropdown (active locks, exclude given id).
 * Aligns with old Wix getSmartDoorDropdownOptions: exclude locks already used by Property or Room.
 */
async function getChildLockOptions(clientId, excludeLockId) {
  let sql = 'SELECT id, lockalias FROM lockdetail WHERE client_id = ? AND active = 1 ORDER BY lockalias ASC LIMIT 1000';
  const params = [clientId];
  if (excludeLockId) {
    sql = 'SELECT id, lockalias FROM lockdetail WHERE client_id = ? AND active = 1 AND id != ? ORDER BY lockalias ASC LIMIT 1000';
    params.push(excludeLockId);
  }
  const [lockRows] = await pool.query(sql, params);
  const locks = lockRows || [];
  if (locks.length === 0) {
    console.log('[smartdoorsetting] getChildLockOptions clientId=%s excludeLockId=%s locks=0', clientId, excludeLockId);
    return [];
  }
  const lockIds = locks.map((r) => r.id);

  const [propRows] = await pool.query(
    'SELECT smartdoor_id FROM propertydetail WHERE client_id = ? AND smartdoor_id IN (?) LIMIT 1000',
    [clientId, lockIds]
  );
  const usedByProperty = new Set((propRows || []).map((p) => p.smartdoor_id).filter(Boolean));

  const [roomRows] = await pool.query(
    'SELECT smartdoor_id FROM roomdetail WHERE client_id = ? AND smartdoor_id IN (?) LIMIT 1000',
    [clientId, lockIds]
  );
  const usedByRoom = new Set((roomRows || []).map((r) => r.smartdoor_id).filter(Boolean));

  // Exclude locks that are already child of another lock (so one lock cannot be child of two parents)
  const [childRows] = await pool.query(
    'SELECT id, childmeter FROM lockdetail WHERE client_id = ? AND childmeter IS NOT NULL AND JSON_LENGTH(COALESCE(childmeter, JSON_ARRAY())) > 0',
    [clientId]
  );
  const usedAsChildByOther = new Set();
  for (const row of childRows || []) {
    if (excludeLockId && String(row.id) === String(excludeLockId)) continue; // current parent's children stay selectable
    const ids = parseChildmeter(row.childmeter);
    ids.forEach((id) => { if (id != null && String(id).trim() !== '') usedAsChildByOther.add(String(id)); });
  }

  const options = [];
  for (const r of locks) {
    const lockId = r.id;
    if (usedByProperty.has(lockId)) continue;
    if (usedByRoom.has(lockId)) continue;
    if (usedAsChildByOther.has(String(lockId))) continue;
    const label = typeof r.lockalias === 'string' && r.lockalias.trim()
      ? r.lockalias.trim()
      : (r.id != null ? String(r.id) : 'Smart Door Unknown');
    options.push({
      label,
      value: String(lockId != null ? lockId : '')
    });
  }
  console.log('[smartdoorsetting] getChildLockOptions clientId=%s excludeLockId=%s locks=%s usedByProp=%s usedByRoom=%s options.length=%s', clientId, excludeLockId, locks.length, usedByProperty.size, usedByRoom.size, options.length);
  return options;
}

/**
 * Insert gateways; returns array of { id, gatewayId } for mapping.
 */
async function insertGateways(clientId, records) {
  const inserted = [];
  for (const g of records) {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO gatewaydetail (id, client_id, gatewayid, gatewayname, networkname, locknum, isonline, type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        id,
        clientId,
        g.gatewayId != null ? Number(g.gatewayId) : null,
        g.gatewayName || '',
        g.networkName || '',
        g.lockNum != null ? Number(g.lockNum) : 0,
        g.isOnline ? 1 : 0,
        g.type || 'Gateway'
      ]
    );
    inserted.push({ id, gatewayId: g.gatewayId });
  }
  return inserted;
}

/**
 * Insert locks; gatewayIdToDbId is map of external gatewayId -> gatewaydetail.id.
 */
async function insertLocks(clientId, records, gatewayIdToDbId = new Map()) {
  const inserted = [];
  for (const l of records) {
    const gatewayRef = l.hasGateway && l.gatewayId != null ? gatewayIdToDbId.get(String(l.gatewayId)) || null : null;
    const id = randomUUID();
    const childmeterJson = Array.isArray(l.childmeter) ? JSON.stringify(l.childmeter) : '[]';
    await pool.query(
      `INSERT INTO lockdetail (id, client_id, lockid, lockname, lockalias, electricquantity, type, hasgateway, gateway_id, brand, isonline, active, childmeter, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        id,
        clientId,
        l.lockId != null ? Number(l.lockId) : null,
        l.lockName || '',
        l.lockAlias || '',
        l.electricQuantity != null ? Number(l.electricQuantity) : 0,
        l.type || 'Smartlock',
        l.hasGateway ? 1 : 0,
        gatewayRef,
        l.brand || 'ttlock',
        l.isOnline ? 1 : 0,
        l.active ? 1 : 1,
        childmeterJson
      ]
    );
    inserted.push({ id, lockId: l.lockId });
  }
  return inserted;
}

module.exports = {
  getSmartDoorList,
  getSmartDoorFilters,
  getLock,
  getGateway,
  updateLock,
  updateGateway,
  previewSmartDoorSelection,
  syncTTLockName,
  getSmartDoorIdsByProperty,
  resolveSmartDoorLocationLabel,
  getChildLockOptions,
  insertGateways,
  insertLocks
};
