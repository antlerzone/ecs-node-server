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
const lockdetailLog = require('./lockdetail-log.service');

/**
 * Smart door row ownership (lockdetail / gatewaydetail).
 * - Coliving portal: { kind: 'coliving', clientId: operatordetail.id }
 * - Cleanlemons client: { kind: 'cln_client', clnClientId: cln_clientdetail.id }
 * - Cleanlemons operator: { kind: 'cln_operator', clnOperatorId: cln_operatordetail.id }
 * Legacy: plain string = Coliving operatordetail id.
 */
function normalizeSmartDoorScope(scopeOrColivingClientId) {
  const s = scopeOrColivingClientId;
  if (s && typeof s === 'object' && s.kind) {
    if (s.kind === 'coliving') {
      return { kind: 'coliving', clientId: String(s.clientId || '').trim() };
    }
    if (s.kind === 'cln_client') {
      return { kind: 'cln_client', clnClientId: String(s.clnClientId || '').trim() };
    }
    if (s.kind === 'cln_operator') {
      return { kind: 'cln_operator', clnOperatorId: String(s.clnOperatorId || '').trim() };
    }
  }
  return { kind: 'coliving', clientId: String(scopeOrColivingClientId || '').trim() };
}

/** Pass-through to TTLock wrappers / getTTLockAccountByClient (integration lookup). */
function ttLockIntegrationKey(scopeOrColivingClientId) {
  const s = normalizeSmartDoorScope(scopeOrColivingClientId);
  if (s.kind === 'coliving') return s.clientId;
  if (s.kind === 'cln_client') return s.clnClientId;
  return s.clnOperatorId;
}

/** SQL fragment + params for "this portal owns the row" on lockdetail/gatewaydetail. */
function scopeRowOwnerWhere(scopeOrColivingClientId) {
  const s = normalizeSmartDoorScope(scopeOrColivingClientId);
  if (s.kind === 'coliving') return { sql: 'client_id = ?', params: [s.clientId] };
  if (s.kind === 'cln_client') return { sql: 'cln_clientid = ?', params: [s.clnClientId] };
  return { sql: 'cln_operatorid = ?', params: [s.clnOperatorId] };
}

/** INSERT column values for scope (only one of the three FK columns is set). */
function scopeInsertTriple(scopeOrColivingClientId) {
  const s = normalizeSmartDoorScope(scopeOrColivingClientId);
  if (s.kind === 'coliving') return { client_id: s.clientId, cln_clientid: null, cln_operatorid: null };
  if (s.kind === 'cln_client') return { client_id: null, cln_clientid: s.clnClientId, cln_operatorid: null };
  return { client_id: null, cln_clientid: null, cln_operatorid: s.clnOperatorId };
}

/** When upserting by TTLock external id: keep existing owner columns; set any non-null triple field from this import. */
function mergeOwnerTripleIntoRow(existing, triple) {
  const ex = existing || {};
  const pick = (tVal, exVal) => {
    if (tVal != null && String(tVal).trim() !== '') return tVal;
    return exVal != null ? exVal : null;
  };
  return {
    client_id: pick(triple.client_id, ex.client_id),
    cln_clientid: pick(triple.cln_clientid, ex.cln_clientid),
    cln_operatorid: pick(triple.cln_operatorid, ex.cln_operatorid),
  };
}

/** DB row → preview/import labels (global lockid / gatewayid). Row object = already in DB → mergeAction update. */
function bindingMetaFromOwnerRow(row) {
  if (!row) {
    return { mergeAction: 'insert', bindingLabels: [], bindingHint: null };
  }
  const labels = [];
  if (row.client_id != null && String(row.client_id).trim() !== '') {
    labels.push('Coliving operator');
  }
  if (row.cln_clientid != null && String(row.cln_clientid).trim() !== '') {
    labels.push('Cleanlemons client');
  }
  if (row.cln_operatorid != null && String(row.cln_operatorid).trim() !== '') {
    labels.push('Cleanlemons operator');
  }
  return {
    mergeAction: 'update',
    bindingLabels: labels,
    bindingHint:
      labels.length > 0
        ? `Already linked: ${labels.join(' · ')}`
        : 'Already in database (import will update this row)'
  };
}

/** Id string for detectTtlockOwnerKind / cln_property filters (legacy helpers). */
function scopeToIntegrationId(scopeOrColivingClientId) {
  return ttLockIntegrationKey(scopeOrColivingClientId);
}

/** Coliving operatordetail scope vs Cleanlemons B2B / operator (TTLock + lockdetail rows use same UUID as integration owner). */
async function detectTtlockOwnerKind(clientId) {
  const cid = String(clientId || '').trim();
  if (!cid) return 'coliving';
  try {
    const [[op]] = await pool.query('SELECT id FROM cln_operatordetail WHERE id = ? LIMIT 1', [cid]);
    if (op?.id) return 'cln_operator';
  } catch (_) {
    /* table missing in some envs */
  }
  try {
    const [[cd]] = await pool.query('SELECT id FROM cln_clientdetail WHERE id = ? LIMIT 1', [cid]);
    if (cd?.id) return 'cln_client';
  } catch (_) {
    /* table missing */
  }
  return 'coliving';
}

/**
 * Smart door lockdetail ids for a Coliving propertydetail row (no client_id check).
 */
async function getColivingPropertySmartDoorIds(propertydetailId) {
  const pid = String(propertydetailId || '').trim();
  if (!pid) return [];
  const ids = new Set();
  const [propRows] = await pool.query(
    'SELECT smartdoor_id FROM propertydetail WHERE id = ? LIMIT 1',
    [pid]
  );
  if (propRows?.[0]?.smartdoor_id) ids.add(propRows[0].smartdoor_id);
  const [roomRows] = await pool.query(
    'SELECT smartdoor_id FROM roomdetail WHERE property_id = ? AND smartdoor_id IS NOT NULL',
    [pid]
  );
  (roomRows || []).forEach((r) => {
    if (r.smartdoor_id) ids.add(r.smartdoor_id);
  });
  return Array.from(ids);
}

/**
 * Property shortname / cln_property name for filter fallback (when smartdoor_id not set on property/rooms).
 */
async function getPropertyDisplayNameForSmartDoorFilter(scopeOrColivingClientId, propertyId) {
  const integId = scopeToIntegrationId(scopeOrColivingClientId);
  const kind = await detectTtlockOwnerKind(integId);
  if (kind === 'cln_operator') {
    const [rows] = await pool.query(
      `SELECT COALESCE(NULLIF(TRIM(property_name), ''), id) AS nm FROM cln_property WHERE id = ? AND operator_id = ? LIMIT 1`,
      [propertyId, integId]
    );
    return rows?.[0]?.nm ? String(rows[0].nm).trim() : null;
  }
  if (kind === 'cln_client') {
    const [rows] = await pool.query(
      `SELECT COALESCE(NULLIF(TRIM(property_name), ''), id) AS nm FROM cln_property WHERE id = ? AND clientdetail_id = ? LIMIT 1`,
      [propertyId, integId]
    );
    return rows?.[0]?.nm ? String(rows[0].nm).trim() : null;
  }
  const [rows] = await pool.query(
    `SELECT COALESCE(NULLIF(TRIM(shortname), ''), id) AS nm FROM propertydetail WHERE id = ? AND client_id = ? LIMIT 1`,
    [propertyId, integId]
  );
  return rows?.[0]?.nm ? String(rows[0].nm).trim() : null;
}

/**
 * When DB has no smartdoor_id for the property, match lock/gateway display names to property label
 * (words + acronym, e.g. "Paragon Suite" → substring "ps" matches "PS A 29-05").
 */
function filterSmartDoorItemsByPropertyNameTokens(items, propertyDisplayName) {
  const raw = String(propertyDisplayName || '').trim();
  if (!raw) return [];
  const words = raw.split(/\s+/).filter((w) => w.length > 0);
  const tokens = new Set();
  tokens.add(raw.toLowerCase());
  words.forEach((w) => tokens.add(w.toLowerCase()));
  words.forEach((w) => {
    if (w.length >= 3) tokens.add(w.toLowerCase());
  });
  const acronym = words.map((w) => w[0]).join('').toLowerCase();
  if (acronym.length >= 2) tokens.add(acronym);

  return items.filter((i) => {
    const name = String(i.lockAlias || i.gatewayName || '').toLowerCase();
    if (!name) return false;
    for (const t of tokens) {
      if (t.length >= 2 && name.includes(t)) return true;
    }
    return false;
  });
}

/**
 * Remote unlock a lock by lockdetail id. Resolves lockid from DB and calls TTLock API.
 * @param {object} [logContext] - { actorEmail, portalSource?, jobId? } — on success writes lockdetail_log when actorEmail set.
 */
async function remoteUnlockLock(scopeOrColivingClientId, lockDetailId, logContext = null) {
  const lock = await getLock(scopeOrColivingClientId, lockDetailId);
  if (!lock || !lock.lockId) throw new Error('LOCK_NOT_FOUND');
  await lockWrapper.remoteUnlock(ttLockIntegrationKey(scopeOrColivingClientId), lock.lockId);
  if (logContext) {
    try {
      const em = String(logContext.actorEmail || '').trim().toLowerCase() || '(unknown)';
      await lockdetailLog.insertLockdetailRemoteUnlockLog({
        lockdetailId: String(lockDetailId),
        actorEmail: em,
        portalSource: logContext.portalSource,
        jobId: logContext.jobId,
      });
    } catch (e) {
      console.warn('[smartdoorsetting] lockdetail_log insert failed:', e?.message || e);
    }
  }
  return { ok: true };
}

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
async function getSmartDoorList(scopeOrColivingClientId, opts = {}) {
  const scope = normalizeSmartDoorScope(scopeOrColivingClientId);
  const { sql: ownerSql, params: ownerParams } = scopeRowOwnerWhere(scope);
  const limit = opts.limit != null ? Math.min(CACHE_LIMIT_MAX, Math.max(1, parseInt(opts.limit, 10) || 0)) : null;
  const useLimit = limit != null && limit > 0;

  const filter = String(opts.filter || 'ALL').toUpperCase();
  const keyword = (opts.keyword || '').trim().toLowerCase();
  const propertyId = opts.propertyId === 'ALL' || !opts.propertyId ? null : opts.propertyId;

  console.log('[smartdoorsetting.service] getSmartDoorList scope=%j filter=%s propertyId=%s keyword=%s', scope, filter, propertyId, keyword || '(none)');

  let lockItems = [];
  let gatewayItems = [];

  if (filter !== 'GATEWAY') {
    let lockSql = `SELECT l.id, l.lockid, l.lockalias, l.lockname, l.gateway_id, l.hasgateway, l.electricquantity, l.type, l.brand, l.isonline, l.active, l.childmeter, l.client_id, l.cln_clientid, l.cln_operatorid,
       cd.fullname AS cln_client_fullname, cd.email AS cln_client_email
       FROM lockdetail l
       LEFT JOIN cln_clientdetail cd ON cd.id = l.cln_clientid
       WHERE l.${ownerSql}`;
    const lockParams = [...ownerParams];
    if (filter === 'ACTIVE') {
      lockSql += ' AND active = 1';
    } else if (filter === 'INACTIVE') {
      lockSql += ' AND active = 0';
    }
    console.log('[smartdoorsetting.service] lockdetail query filter=%s owner=%j', filter, ownerParams);
    const [lockRows] = await pool.query(lockSql, lockParams);
    console.log('[smartdoorsetting.service] lockdetail rows=%s for scope', (lockRows || []).length);
    if (!lockRows || lockRows.length === 0) {
      const [[countRow]] = await pool.query(`SELECT COUNT(*) AS n FROM lockdetail WHERE ${ownerSql}`, ownerParams);
      const [totalLockRows] = await pool.query('SELECT COUNT(*) AS n FROM lockdetail');
      const [distinctClients] = await pool.query('SELECT DISTINCT client_id FROM lockdetail LIMIT 20');
      console.log('[smartdoorsetting.service] lockdetail DEBUG: COUNT(*) for this client_id=%s, total lockdetail table=%s, distinct client_ids (sample)=%s',
        countRow?.n ?? 0, totalLockRows?.[0]?.n ?? 0, (distinctClients || []).map(r => r.client_id));
    }
    lockItems = (lockRows || []).map(r => {
      const clnCid = r.cln_clientid != null && String(r.cln_clientid).trim() !== '' ? String(r.cln_clientid).trim() : '';
      const name = r.cln_client_fullname != null ? String(r.cln_client_fullname).trim() : '';
      const em = r.cln_client_email != null ? String(r.cln_client_email).trim() : '';
      const gwFk = r.gateway_id != null && String(r.gateway_id).trim() !== '' ? String(r.gateway_id).trim() : '';
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
        client: r.client_id,
        clnClientdetailId: clnCid || undefined,
        ownedByClientName: name,
        ownedByClientEmail: em,
        /** TTLock reports gateway but DB row has no gatewaydetail FK yet — run Refresh status (client TTLock after link approval). */
        needsGatewayDbLink: !!r.hasgateway && !gwFk,
        /** Operator portal: false when row still belongs to a B2B client (delete only after property/client disconnect). */
        operatorCanDelete: scope.kind !== 'cln_operator' || !clnCid,
      };
    });
    const idToLock = new Map(lockItems.map(l => [l._id, l]));
    lockItems.forEach(l => {
      l.childmeterAliases = (l.childmeter || []).map(id => idToLock.get(id)?.lockAlias || id);
      const parent = lockItems.find(o => o._id !== l._id && (o.childmeter || []).includes(l._id));
      l.parentLockAlias = parent ? parent.lockAlias : null;
    });
  }

  if (filter !== 'LOCK') {
    const [gwRows] = await pool.query(
      `SELECT g.id, g.gatewayid, g.gatewayname, g.networkname, g.locknum, g.isonline, g.type, g.client_id, g.cln_clientid, g.cln_operatorid,
       cd.fullname AS cln_client_fullname, cd.email AS cln_client_email
       FROM gatewaydetail g
       LEFT JOIN cln_clientdetail cd ON cd.id = g.cln_clientid
       WHERE g.${ownerSql}`,
      ownerParams
    );
    console.log('[smartdoorsetting.service] gatewaydetail rows=%s for scope', (gwRows || []).length);
    if (gwRows && gwRows.length > 0) {
      console.log('[smartdoorsetting.service] gatewaydetail first row client_id=%s (for comparison with lockdetail)', gwRows[0].client_id);
    }
    gatewayItems = (gwRows || []).map(r => {
      const clnCid = r.cln_clientid != null && String(r.cln_clientid).trim() !== '' ? String(r.cln_clientid).trim() : '';
      const name = r.cln_client_fullname != null ? String(r.cln_client_fullname).trim() : '';
      const em = r.cln_client_email != null ? String(r.cln_client_email).trim() : '';
      return {
        _id: r.id,
        __type: 'gateway',
        gatewayId: r.gatewayid,
        gatewayName: r.gatewayname || '',
        networkName: r.networkname || '',
        lockNum: r.locknum != null ? Number(r.locknum) : 0,
        isOnline: !!r.isonline,
        type: r.type || '',
        client: r.client_id,
        clnClientdetailId: clnCid || undefined,
        ownedByClientName: name,
        ownedByClientEmail: em,
        operatorCanDelete: scope.kind !== 'cln_operator' || !clnCid,
      };
    });
  }

  let items = [...lockItems, ...gatewayItems];

  if (keyword) {
    items = items.filter(i => {
      const name = (i.lockAlias || i.gatewayName || '').toLowerCase();
      const extId = String(i.lockId || i.gatewayId || '');
      return name.includes(keyword) || extId.includes(keyword);
    });
  }

  // Active/Inactive applies to locks only (gatewaydetail has no active column).
  if (filter === 'ACTIVE' || filter === 'INACTIVE') {
    items = items.filter((i) => i.__type === 'lock');
  }

  if (propertyId) {
    const doorIds = await getSmartDoorIdsByProperty(scope, propertyId);
    // 1) Strict: locks on property/room smartdoor_id + gateways linked via lockdetail.gateway_id
    // 2) Fallback: no DB linkage — match device alias/name to property label tokens (e.g. "Paragon Suite" → "ps" for "PS A 29-05")
    if (doorIds && doorIds.length > 0) {
      const lockSet = new Set(doorIds);
      const inPh = doorIds.map(() => '?').join(',');
      const { sql: ownerSql, params: ownerParams } = scopeRowOwnerWhere(scope);
      const [gwFromLocks] = await pool.query(
        `SELECT DISTINCT gateway_id FROM lockdetail WHERE ${ownerSql} AND id IN (${inPh})
         AND gateway_id IS NOT NULL AND TRIM(COALESCE(gateway_id, '')) != ''`,
        [...ownerParams, ...doorIds]
      );
      const gwSet = new Set((gwFromLocks || []).map((r) => String(r.gateway_id).trim()));
      items = items.filter(
        (i) =>
          (i.__type === 'lock' && lockSet.has(i._id)) ||
          (i.__type === 'gateway' && gwSet.has(String(i._id)))
      );
    } else {
      const label = await getPropertyDisplayNameForSmartDoorFilter(scopeOrColivingClientId, propertyId);
      items = filterSmartDoorItemsByPropertyNameTokens(items, label);
    }
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
async function getSmartDoorFilters(scopeOrColivingClientId) {
  const integId = scopeToIntegrationId(scopeOrColivingClientId);
  const kind = await detectTtlockOwnerKind(integId);
  if (kind === 'cln_operator') {
    try {
      const [rows] = await pool.query(
        `SELECT id, COALESCE(NULLIF(TRIM(property_name), ''), id) AS shortname
         FROM cln_property WHERE operator_id = ? ORDER BY property_name ASC LIMIT 1000`,
        [integId]
      );
      const properties = (rows || []).map((r) => ({ label: r.shortname || r.id, value: r.id }));
      return { properties };
    } catch (e) {
      const msg = String(e?.sqlMessage || e?.message || '');
      if (!/Unknown column/i.test(msg)) throw e;
    }
  }
  if (kind === 'cln_client') {
    try {
      const [rows] = await pool.query(
        `SELECT id, COALESCE(NULLIF(TRIM(property_name), ''), id) AS shortname
         FROM cln_property WHERE clientdetail_id = ? ORDER BY property_name ASC LIMIT 1000`,
        [integId]
      );
      const properties = (rows || []).map((r) => ({ label: r.shortname || r.id, value: r.id }));
      return { properties };
    } catch (e) {
      const msg = String(e?.sqlMessage || e?.message || '');
      if (!/Unknown column/i.test(msg)) throw e;
    }
  }
  const [rows] = await pool.query(
    `SELECT id, shortname FROM propertydetail WHERE client_id = ? ORDER BY shortname ASC LIMIT 1000`,
    [integId]
  );
  const properties = (rows || []).map(r => ({ label: r.shortname || r.id, value: r.id }));
  return { properties };
}

/**
 * Get single lock by id (client must own it).
 */
async function getLock(scopeOrColivingClientId, id) {
  const scope = normalizeSmartDoorScope(scopeOrColivingClientId);
  const { sql, params } = scopeRowOwnerWhere(scopeOrColivingClientId);
  const [rows] = await pool.query(
    `SELECT l.id, l.lockid, l.lockalias, l.lockname, l.gateway_id, l.hasgateway, l.electricquantity, l.type, l.brand, l.isonline, l.active, l.childmeter, l.client_id, l.cln_clientid, l.cln_operatorid,
     cd.fullname AS cln_client_fullname, cd.email AS cln_client_email
     FROM lockdetail l
     LEFT JOIN cln_clientdetail cd ON cd.id = l.cln_clientid
     WHERE l.id = ? AND l.${sql} LIMIT 1`,
    [id, ...params]
  );
  const r = rows && rows[0];
  if (!r) return null;
  const clnCid = r.cln_clientid != null && String(r.cln_clientid).trim() !== '' ? String(r.cln_clientid).trim() : '';
  const gwFk = r.gateway_id != null && String(r.gateway_id).trim() !== '' ? String(r.gateway_id).trim() : '';
  const name = r.cln_client_fullname != null ? String(r.cln_client_fullname).trim() : '';
  const em = r.cln_client_email != null ? String(r.cln_client_email).trim() : '';
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
    client: r.client_id,
    clnClientdetailId: clnCid || undefined,
    ownedByClientName: name,
    ownedByClientEmail: em,
    needsGatewayDbLink: !!r.hasgateway && !gwFk,
    operatorCanDelete: scope.kind !== 'cln_operator' || !clnCid,
  };
}

/**
 * Get single gateway by id.
 */
async function getGateway(scopeOrColivingClientId, id) {
  const scope = normalizeSmartDoorScope(scopeOrColivingClientId);
  const { sql, params } = scopeRowOwnerWhere(scopeOrColivingClientId);
  const [rows] = await pool.query(
    `SELECT g.id, g.gatewayid, g.gatewayname, g.networkname, g.locknum, g.isonline, g.type, g.client_id, g.cln_clientid, g.cln_operatorid,
     cd.fullname AS cln_client_fullname, cd.email AS cln_client_email
     FROM gatewaydetail g
     LEFT JOIN cln_clientdetail cd ON cd.id = g.cln_clientid
     WHERE g.id = ? AND g.${sql} LIMIT 1`,
    [id, ...params]
  );
  const r = rows && rows[0];
  if (!r) return null;
  const clnCid = r.cln_clientid != null && String(r.cln_clientid).trim() !== '' ? String(r.cln_clientid).trim() : '';
  const name = r.cln_client_fullname != null ? String(r.cln_client_fullname).trim() : '';
  const em = r.cln_client_email != null ? String(r.cln_client_email).trim() : '';
  return {
    _id: r.id,
    __type: 'gateway',
    gatewayId: r.gatewayid,
    gatewayName: r.gatewayname || '',
    networkName: r.networkname || '',
    lockNum: r.locknum != null ? Number(r.locknum) : 0,
    isOnline: !!r.isonline,
    type: r.type || '',
    client: r.client_id,
    clnClientdetailId: clnCid || undefined,
    ownedByClientName: name,
    ownedByClientEmail: em,
    operatorCanDelete: scope.kind !== 'cln_operator' || !clnCid,
  };
}

/**
 * Update lock: lockAlias, active, childmeter (array of lockdetail ids).
 */
async function updateLock(scopeOrColivingClientId, id, data) {
  const { sql, params } = scopeRowOwnerWhere(scopeOrColivingClientId);
  const [rows] = await pool.query(`SELECT id FROM lockdetail WHERE id = ? AND ${sql}`, [id, ...params]);
  if (!rows || rows.length === 0) return { ok: false, reason: 'LOCK_NOT_FOUND' };

  const updates = [];
  const updParams = [];
  if (data.lockAlias !== undefined) {
    updates.push('lockalias = ?');
    updParams.push(String(data.lockAlias));
  }
  if (data.active !== undefined) {
    updates.push('active = ?');
    updParams.push(data.active ? 1 : 0);
  }
  if (data.childmeter !== undefined) {
    updates.push('childmeter = ?');
    updParams.push(JSON.stringify(Array.isArray(data.childmeter) ? data.childmeter : []));
  }
  if (updates.length === 0) return { ok: true };
  updParams.push(id);
  await pool.query(`UPDATE lockdetail SET ${updates.join(', ')} WHERE id = ?`, updParams);
  return { ok: true };
}

/**
 * Update gateway: gatewayName.
 */
async function updateGateway(scopeOrColivingClientId, id, data) {
  const { sql, params } = scopeRowOwnerWhere(scopeOrColivingClientId);
  const [rows] = await pool.query(`SELECT id FROM gatewaydetail WHERE id = ? AND ${sql}`, [id, ...params]);
  if (!rows || rows.length === 0) return { ok: false, reason: 'GATEWAY_NOT_FOUND' };
  if (data.gatewayName === undefined) return { ok: true };
  await pool.query('UPDATE gatewaydetail SET gatewayname = ? WHERE id = ?', [String(data.gatewayName), id]);
  return { ok: true };
}

/**
 * TTLock GET /lock/list returns hasGateway (1 = bound to gateway, 0 = no) per official API.
 * Often the list omits gatewayId; we then call GET /lock/detail to resolve the TT gateway id for `lockdetail.gateway_id`.
 * If still unknown and this scope has exactly one `gatewaydetail` row, we link locks to that gateway (single-gateway accounts).
 */
function ttlockListItemHasGateway(l) {
  const flag = l.hasGateway ?? l.hasgateway;
  if (flag === 1 || flag === true || flag === '1') return true;
  if (flag === 0 || flag === false || flag === '0') return false;
  const raw = l.gatewayId ?? l.gateway_id;
  if (raw == null || raw === '') return false;
  const n = Number(raw);
  return Number.isFinite(n) && n !== 0;
}

/** External TTLock gateway numeric id from list item, if present; else null. */
function ttlockListItemGatewayExternalId(l) {
  const raw = l.gatewayId ?? l.gateway_id ?? null;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n !== 0 ? raw : null;
}

/**
 * `/lock/detail` often includes `gatewayId` when `/lock/list` omits it — needed to set `lockdetail.gateway_id`.
 * Response may be flat or `{ lock: { ... } }`; errcode !== 0 means skip.
 */
function gatewayIdFromLockDetailResponse(detailRes) {
  if (!detailRes || typeof detailRes !== 'object') return null;
  if (detailRes.errcode != null && Number(detailRes.errcode) !== 0) return null;
  const inner = detailRes.lock != null && typeof detailRes.lock === 'object' ? detailRes.lock : detailRes;
  return ttlockListItemGatewayExternalId(inner);
}

/**
 * TTLock external gateway id (numeric) -> gatewaydetail.id for this client, or null if not imported yet.
 */
/** gatewayid is globally unique per TTLock account; one DB row per device across Coliving + Cleanlemons scopes. */
async function resolveGatewayDbIdByTtlockId(_scopeIgnored, ttGatewayId) {
  if (ttGatewayId == null || ttGatewayId === '') return null;
  const ext = Number(ttGatewayId);
  if (!Number.isFinite(ext)) return null;
  const [rows] = await pool.query('SELECT id FROM gatewaydetail WHERE gatewayid = ? LIMIT 1', [ext]);
  return rows && rows[0] ? rows[0].id : null;
}

/**
 * Merge one TTLock lock list/detail item into our lockdetail row (same lockid), if the row exists.
 */
async function mergeOneLockFromTtlockListItem(scopeOrColivingClientId, l, getSingleGatewayDbIdFallback) {
  const ttKey = ttLockIntegrationKey(scopeOrColivingClientId);
  const lockId = Number(l.lockId);
  if (!Number.isFinite(lockId)) return;
  const newAlias = l.lockAlias || l.lockName || '';
  const newElectric = Number(l.electricQuantity || 0);
  const ttHasGateway = ttlockListItemHasGateway(l);
  let ttGwRaw = ttlockListItemGatewayExternalId(l);
  if (ttHasGateway && ttGwRaw == null) {
    try {
      const detailRes = await lockWrapper.getLockDetail(ttKey, lockId);
      const fromDetail = gatewayIdFromLockDetailResponse(detailRes);
      if (fromDetail != null) ttGwRaw = fromDetail;
    } catch (e) {
      console.warn('[smartdoorsetting] mergeOneLockFromTtlockListItem getLockDetail', lockId, e?.message || e);
    }
  }

  const [existRows] = await pool.query(
    `SELECT id, lockalias, electricquantity, hasgateway, gateway_id FROM lockdetail WHERE lockid = ? LIMIT 1`,
    [lockId]
  );
  if (!existRows || existRows.length === 0) return;
  const row = existRows[0];

  let gatewayDbId;
  if (!ttHasGateway) {
    gatewayDbId = null;
  } else if (ttGwRaw != null) {
    gatewayDbId = await resolveGatewayDbIdByTtlockId(scopeOrColivingClientId, ttGwRaw);
  } else {
    gatewayDbId = row.gateway_id;
  }
  if (ttHasGateway && (gatewayDbId == null || gatewayDbId === '')) {
    const singleGw = await getSingleGatewayDbIdFallback();
    if (singleGw) gatewayDbId = singleGw;
  }
  const newHasGw = ttHasGateway ? 1 : 0;

  let needUpdate = false;
  if ((row.lockalias || '') !== newAlias) needUpdate = true;
  if (Number(row.electricquantity || 0) !== newElectric) needUpdate = true;
  if (Number(row.hasgateway || 0) !== newHasGw) needUpdate = true;
  const curGwFk = row.gateway_id != null ? String(row.gateway_id) : '';
  const newGwFkStr = gatewayDbId != null ? String(gatewayDbId) : '';
  if (curGwFk !== newGwFkStr) needUpdate = true;
  if (needUpdate) {
    await pool.query(
      'UPDATE lockdetail SET lockalias = ?, electricquantity = ?, hasgateway = ?, gateway_id = ? WHERE id = ?',
      [newAlias, newElectric, newHasGw, gatewayDbId, row.id]
    );
  }
}

/**
 * TTLock /lock/list → update DB rows we already have (alias, battery, hasgateway, gateway_id).
 * UI "Gateway / No gateway" reads lockdetail.hasgateway; this keeps it aligned with TTLock.
 * @returns {Promise<Array>} lock list from TTLock (empty on failure).
 */
async function fetchTtlockLockListAndMergeToDb(scopeOrColivingClientId) {
  const lockRes = await lockWrapper.listAllLocks(ttLockIntegrationKey(scopeOrColivingClientId));
  const lockList = lockRes?.list || [];
  /** Lazy: one query per sync when list/detail omit gateway id but account has exactly one gateway row. */
  let singleGatewayFallbackPromise;
  const getSingleGatewayDbIdFallback = () => {
    if (!singleGatewayFallbackPromise) {
      const { sql, params } = scopeRowOwnerWhere(scopeOrColivingClientId);
      singleGatewayFallbackPromise = pool
        .query(`SELECT id FROM gatewaydetail WHERE ${sql} LIMIT 2`, params)
        .then(([rows]) => (rows && rows.length === 1 ? rows[0].id : null));
    }
    return singleGatewayFallbackPromise;
  };

  for (const l of lockList) {
    await mergeOneLockFromTtlockListItem(scopeOrColivingClientId, l, getSingleGatewayDbIdFallback);
  }
  return lockList;
}

/**
 * Refresh one lockdetail row from TTLock (battery, alias, gateway link). Does not sync gateways table.
 */
async function syncSingleLockStatusFromTtlock(scopeOrColivingClientId, lockDetailId) {
  const id = String(lockDetailId || '').trim();
  if (!id) return { ok: false, reason: 'NO_ID' };
  const dbLock = await getLock(scopeOrColivingClientId, id);
  if (!dbLock || dbLock.lockId == null) return { ok: false, reason: 'LOCK_NOT_FOUND' };
  const lockIdNum = Number(dbLock.lockId);
  if (!Number.isFinite(lockIdNum)) return { ok: false, reason: 'INVALID_LOCK_ID' };

  const ttKey = ttLockIntegrationKey(scopeOrColivingClientId);
  const lockRes = await lockWrapper.listAllLocks(ttKey);
  let l = (lockRes?.list || []).find((x) => Number(x.lockId) === lockIdNum);
  if (!l) {
    const detailRes = await lockWrapper.getLockDetail(ttKey, lockIdNum);
    if (detailRes && (detailRes.errcode == null || Number(detailRes.errcode) === 0)) {
      const inner = detailRes.lock != null && typeof detailRes.lock === 'object' ? detailRes.lock : detailRes;
      if (inner && inner.lockId != null) l = inner;
    }
  }
  if (!l) {
    return { ok: false, reason: 'TTLOCK_LOCK_NOT_FOUND' };
  }

  let singleGatewayFallbackPromise;
  const getSingleGatewayDbIdFallback = () => {
    if (!singleGatewayFallbackPromise) {
      const { sql, params } = scopeRowOwnerWhere(scopeOrColivingClientId);
      singleGatewayFallbackPromise = pool
        .query(`SELECT id FROM gatewaydetail WHERE ${sql} LIMIT 2`, params)
        .then(([rows]) => (rows && rows.length === 1 ? rows[0].id : null));
    }
    return singleGatewayFallbackPromise;
  };

  await mergeOneLockFromTtlockListItem(scopeOrColivingClientId, l, getSingleGatewayDbIdFallback);
  const updated = await getLock(scopeOrColivingClientId, id);
  return { ok: true, lock: updated };
}

/**
 * Merge one TTLock gateway list item into gatewaydetail (same gatewayid), if row exists.
 */
async function mergeOneGatewayFromTtlockListItem(scopeOrColivingClientId, g) {
  const gatewayId = Number(g.gatewayId);
  if (!Number.isFinite(gatewayId)) return;
  const newName = g.gatewayName || '';
  const newOnline = g.isOnline ? 1 : 0;
  const newLockNum = g.lockNum != null ? Number(g.lockNum) : 0;
  const newNetwork = g.networkName || '';

  const [existRows] = await pool.query(
    `SELECT id, gatewayname, isonline, locknum, networkname FROM gatewaydetail WHERE gatewayid = ? LIMIT 1`,
    [gatewayId]
  );
  if (!existRows || existRows.length === 0) return;
  const row = existRows[0];
  let needUpdate = false;
  if ((row.gatewayname || '') !== newName) needUpdate = true;
  if (Number(row.isonline || 0) !== newOnline) needUpdate = true;
  if (Number(row.locknum || 0) !== newLockNum) needUpdate = true;
  if ((row.networkname || '') !== newNetwork) needUpdate = true;
  if (needUpdate) {
    await pool.query(
      'UPDATE gatewaydetail SET gatewayname = ?, isonline = ?, locknum = ?, networkname = ? WHERE id = ?',
      [newName, newOnline, newLockNum, newNetwork, row.id]
    );
  }
}

/**
 * TTLock /gateway/list → update DB rows we already have (name, online, lock count, network).
 */
async function fetchTtlockGatewayListAndMergeToDb(scopeOrColivingClientId) {
  const ttKey = ttLockIntegrationKey(scopeOrColivingClientId);
  const gatewayRes = await gatewayWrapper.listAllGateways(ttKey);
  const gwList = gatewayRes?.list || [];
  for (const g of gwList) {
    await mergeOneGatewayFromTtlockListItem(scopeOrColivingClientId, g);
  }
  return gwList;
}

/**
 * Refresh one gatewaydetail row from TTLock (name, online, lock count, network).
 */
async function syncSingleGatewayStatusFromTtlock(scopeOrColivingClientId, gatewayDetailId) {
  const id = String(gatewayDetailId || '').trim();
  if (!id) return { ok: false, reason: 'NO_ID' };
  const dbGw = await getGateway(scopeOrColivingClientId, id);
  if (!dbGw || dbGw.gatewayId == null) return { ok: false, reason: 'GATEWAY_NOT_FOUND' };
  const extId = Number(dbGw.gatewayId);
  if (!Number.isFinite(extId)) return { ok: false, reason: 'INVALID_GATEWAY_ID' };

  const ttKey = ttLockIntegrationKey(scopeOrColivingClientId);
  const gatewayRes = await gatewayWrapper.listAllGateways(ttKey);
  const g = (gatewayRes?.list || []).find((x) => Number(x.gatewayId) === extId);
  if (!g) {
    return { ok: false, reason: 'TTLOCK_GATEWAY_NOT_FOUND' };
  }
  await mergeOneGatewayFromTtlockListItem(scopeOrColivingClientId, g);
  const updated = await getGateway(scopeOrColivingClientId, id);
  return { ok: true, gateway: updated };
}

/**
 * Card "Refresh": merge TTLock → existing lockdetail + gatewaydetail (battery, gateway link, gateway online/lock count).
 */
async function syncSmartDoorStatusFromTtlock(scopeOrColivingClientId) {
  const lockList = await fetchTtlockLockListAndMergeToDb(scopeOrColivingClientId);
  const gwList = await fetchTtlockGatewayListAndMergeToDb(scopeOrColivingClientId);
  return { ok: true, lockCount: lockList.length, gatewayCount: gwList.length };
}

/**
 * Preview: all TTLock locks/gateways for this integration (no filter by portal scope).
 * Items already in MySQL (same lockid / gatewayid) include mergeAction "update" and bindingHint / bindingLabels.
 * Import path uses upsert — existing rows are updated, not duplicated.
 */
async function previewSmartDoorSelection(scopeOrColivingClientId) {
  const ttKey = ttLockIntegrationKey(scopeOrColivingClientId);
  const result = [];

  try {
    const lockRes = await lockWrapper.listAllLocks(ttKey);
    const lockList = lockRes?.list || [];
    for (const l of lockList) {
      const lockId = Number(l.lockId);
      const [existRows] = await pool.query(
        'SELECT client_id, cln_clientid, cln_operatorid FROM lockdetail WHERE lockid = ? LIMIT 1',
        [lockId]
      );
      const bind = bindingMetaFromOwnerRow(existRows && existRows[0]);

      const newAlias = l.lockAlias || l.lockName || '';
      const newElectric = Number(l.electricQuantity || 0);
      const ttHasGateway = ttlockListItemHasGateway(l);
      const ttGwRaw = ttlockListItemGatewayExternalId(l);
      const ttGwNum = ttGwRaw != null ? Number(ttGwRaw) : NaN;

      result.push({
        _id: `lock_${lockId}`,
        provider: 'ttlock',
        type: 'lock',
        externalId: String(lockId),
        lockAlias: newAlias,
        lockName: l.lockName || '',
        electricQuantity: newElectric,
        hasGateway: ttHasGateway,
        gatewayId: ttHasGateway && Number.isFinite(ttGwNum) ? String(ttGwNum) : null,
        isOnline: !!(l.isOnline ?? l.online),
        active: true,
        mergeAction: bind.mergeAction,
        bindingLabels: bind.bindingLabels,
        bindingHint: bind.bindingHint
      });
    }
  } catch (err) {
    console.error('[smartdoorsetting] preview locks error', err.message);
  }

  try {
    const gatewayRes = await gatewayWrapper.listAllGateways(ttKey);
    const gwList = gatewayRes?.list || [];
    for (const g of gwList) {
      const gatewayId = Number(g.gatewayId);
      const newName = g.gatewayName || '';

      const [existRows] = await pool.query(
        'SELECT client_id, cln_clientid, cln_operatorid FROM gatewaydetail WHERE gatewayid = ? LIMIT 1',
        [gatewayId]
      );
      const bind = bindingMetaFromOwnerRow(existRows && existRows[0]);

      result.push({
        _id: `gateway_${gatewayId}`,
        provider: 'ttlock',
        type: 'gateway',
        externalId: String(gatewayId),
        lockAlias: newName,
        gatewayName: newName,
        networkName: g.networkName || '',
        lockNum: Number(g.lockNum || 0),
        isOnline: !!g.isOnline,
        mergeAction: bind.mergeAction,
        bindingLabels: bind.bindingLabels,
        bindingHint: bind.bindingHint
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
async function syncTTLockName(scopeOrColivingClientId, { type, externalId, name }) {
  if (!name || !externalId) throw new Error('NAME_AND_EXTERNAL_ID_REQUIRED');
  const ttKey = ttLockIntegrationKey(scopeOrColivingClientId);
  if (type === 'lock') {
    await lockWrapper.changeLockName(ttKey, Number(externalId), name);
    return { ok: true };
  }
  if (type === 'gateway') {
    await gatewayWrapper.renameGateway(ttKey, Number(externalId), name);
    return { ok: true };
  }
  throw new Error(`UNKNOWN_TYPE: ${type}`);
}

/**
 * Get lockdetail ids that belong to this property (property.smartdoor_id + rooms' smartdoor_id).
 * Cleanlemons: propertyId is cln_property.id; resolves via coliving_propertydetail_id when set.
 */
async function getSmartDoorIdsByProperty(scopeOrColivingClientId, propertyId) {
  const integId = scopeToIntegrationId(scopeOrColivingClientId);
  const kind = await detectTtlockOwnerKind(integId);
  if (kind === 'cln_operator' || kind === 'cln_client') {
    const col = kind === 'cln_operator' ? 'operator_id' : 'clientdetail_id';
    let colivingPid = null;
    try {
      const [clnRows] = await pool.query(
        `SELECT coliving_propertydetail_id AS pid FROM cln_property WHERE id = ? AND ${col} = ? LIMIT 1`,
        [propertyId, integId]
      );
      colivingPid = clnRows?.[0]?.pid ? String(clnRows[0].pid).trim() : null;
    } catch (e) {
      const msg = String(e?.sqlMessage || e?.message || '');
      if (!/Unknown column/i.test(msg)) throw e;
    }
    if (!colivingPid) return [];
    const candidates = await getColivingPropertySmartDoorIds(colivingPid);
    if (!candidates.length) return [];
    const { sql, params } = scopeRowOwnerWhere(scopeOrColivingClientId);
    const inPh = candidates.map(() => '?').join(',');
    const [owned] = await pool.query(
      `SELECT id FROM lockdetail WHERE ${sql} AND id IN (${inPh})`,
      [...params, ...candidates]
    );
    return (owned || []).map((r) => r.id);
  }
  const ids = new Set();
  const [propRows] = await pool.query(
    'SELECT smartdoor_id FROM propertydetail WHERE id = ? AND client_id = ? LIMIT 1',
    [propertyId, integId]
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
async function resolveSmartDoorLocationLabel(scopeOrColivingClientId, lockDetailId) {
  const integId = scopeToIntegrationId(scopeOrColivingClientId);
  const [roomRows] = await pool.query(
    'SELECT title_fld, roomname FROM roomdetail WHERE smartdoor_id = ? LIMIT 1',
    [lockDetailId]
  );
  if (roomRows && roomRows[0]) return roomRows[0].title_fld || roomRows[0].roomname || 'room';

  const [propRows] = await pool.query(
    'SELECT shortname FROM propertydetail WHERE smartdoor_id = ? AND client_id = ? LIMIT 1',
    [lockDetailId, integId]
  );
  if (propRows && propRows[0]) return propRows[0].shortname || 'property';

  const kind = await detectTtlockOwnerKind(integId);
  if (kind === 'cln_operator' || kind === 'cln_client') {
    const col = kind === 'cln_operator' ? 'operator_id' : 'clientdetail_id';
    try {
      const [clnRows] = await pool.query(
        `SELECT COALESCE(NULLIF(TRIM(p.property_name), ''), p.id) AS nm
         FROM cln_property p
         INNER JOIN propertydetail pd ON pd.id = p.coliving_propertydetail_id
         WHERE p.${col} = ? AND (pd.smartdoor_id = ? OR EXISTS (
           SELECT 1 FROM roomdetail r WHERE r.property_id = pd.id AND r.smartdoor_id = ?
         )) LIMIT 1`,
        [integId, lockDetailId, lockDetailId]
      );
      if (clnRows?.[0]?.nm) return String(clnRows[0].nm).trim() || 'property';
    } catch (e) {
      const msg = String(e?.sqlMessage || e?.message || '');
      if (!/Unknown column/i.test(msg)) throw e;
    }
  }
  return 'no connect';
}

/**
 * Get child lock options for dropdown (active locks, exclude given id).
 * Aligns with old Wix getSmartDoorDropdownOptions: exclude locks already used by Property or Room.
 */
async function getChildLockOptions(scopeOrColivingClientId, excludeLockId) {
  const { sql: ownSql, params: ownParams } = scopeRowOwnerWhere(scopeOrColivingClientId);
  const integId = scopeToIntegrationId(scopeOrColivingClientId);
  let sql = `SELECT id, lockalias FROM lockdetail WHERE ${ownSql} AND active = 1 ORDER BY lockalias ASC LIMIT 1000`;
  const params = [...ownParams];
  if (excludeLockId) {
    sql = `SELECT id, lockalias FROM lockdetail WHERE ${ownSql} AND active = 1 AND id != ? ORDER BY lockalias ASC LIMIT 1000`;
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
    [integId, lockIds]
  );
  const usedByProperty = new Set((propRows || []).map((p) => p.smartdoor_id).filter(Boolean));

  const [roomRows] = await pool.query(
    'SELECT smartdoor_id FROM roomdetail WHERE client_id = ? AND smartdoor_id IN (?) LIMIT 1000',
    [integId, lockIds]
  );
  const usedByRoom = new Set((roomRows || []).map((r) => r.smartdoor_id).filter(Boolean));

  const kind = await detectTtlockOwnerKind(integId);
  if (kind === 'cln_operator' || kind === 'cln_client') {
    const col = kind === 'cln_operator' ? 'operator_id' : 'clientdetail_id';
    try {
      const [clnProps] = await pool.query(
        `SELECT coliving_propertydetail_id AS pid FROM cln_property
         WHERE ${col} = ? AND coliving_propertydetail_id IS NOT NULL LIMIT 500`,
        [integId]
      );
      for (const row of clnProps || []) {
        const cand = await getColivingPropertySmartDoorIds(row.pid);
        const lockSet = new Set(lockIds.map((x) => String(x)));
        for (const lid of cand) {
          if (lockSet.has(String(lid))) usedByProperty.add(lid);
        }
      }
    } catch (e) {
      const msg = String(e?.sqlMessage || e?.message || '');
      if (!/Unknown column/i.test(msg)) throw e;
    }
  }

  // Exclude locks that are already child of another lock (so one lock cannot be child of two parents)
  const [childRows] = await pool.query(
    `SELECT id, childmeter FROM lockdetail WHERE ${ownSql} AND childmeter IS NOT NULL AND JSON_LENGTH(COALESCE(childmeter, JSON_ARRAY())) > 0`,
    [...ownParams]
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
  console.log('[smartdoorsetting] getChildLockOptions scope excludeLockId=%s locks=%s usedByProp=%s usedByRoom=%s options.length=%s', excludeLockId, locks.length, usedByProperty.size, usedByRoom.size, options.length);
  return options;
}

/**
 * Insert gateways; returns array of { id, gatewayId } for mapping.
 */
async function insertGateways(scopeOrColivingClientId, records) {
  const triple = scopeInsertTriple(scopeOrColivingClientId);
  const inserted = [];
  for (const g of records) {
    const extGw = g.gatewayId != null ? Number(g.gatewayId) : NaN;
    if (!Number.isFinite(extGw)) {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO gatewaydetail (id, client_id, cln_clientid, cln_operatorid, gatewayid, gatewayname, networkname, locknum, isonline, type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          id,
          triple.client_id,
          triple.cln_clientid,
          triple.cln_operatorid,
          null,
          g.gatewayName || '',
          g.networkName || '',
          g.lockNum != null ? Number(g.lockNum) : 0,
          g.isOnline ? 1 : 0,
          g.type || 'Gateway'
        ]
      );
      inserted.push({ id, gatewayId: g.gatewayId });
      continue;
    }
    const [existRows] = await pool.query(
      'SELECT id, client_id, cln_clientid, cln_operatorid FROM gatewaydetail WHERE gatewayid = ? LIMIT 1',
      [extGw]
    );
    if (existRows && existRows[0]) {
      const row = existRows[0];
      const merged = mergeOwnerTripleIntoRow(row, triple);
      await pool.query(
        `UPDATE gatewaydetail SET client_id = ?, cln_clientid = ?, cln_operatorid = ?, gatewayname = ?, networkname = ?, locknum = ?, isonline = ?, type = ?, updated_at = NOW() WHERE id = ?`,
        [
          merged.client_id,
          merged.cln_clientid,
          merged.cln_operatorid,
          g.gatewayName || '',
          g.networkName || '',
          g.lockNum != null ? Number(g.lockNum) : 0,
          g.isOnline ? 1 : 0,
          g.type || 'Gateway',
          row.id
        ]
      );
      inserted.push({ id: row.id, gatewayId: g.gatewayId });
    } else {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO gatewaydetail (id, client_id, cln_clientid, cln_operatorid, gatewayid, gatewayname, networkname, locknum, isonline, type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          id,
          triple.client_id,
          triple.cln_clientid,
          triple.cln_operatorid,
          extGw,
          g.gatewayName || '',
          g.networkName || '',
          g.lockNum != null ? Number(g.lockNum) : 0,
          g.isOnline ? 1 : 0,
          g.type || 'Gateway'
        ]
      );
      inserted.push({ id, gatewayId: g.gatewayId });
    }
  }
  return inserted;
}

/**
 * Insert locks; gatewayIdToDbId is map of external gatewayId -> gatewaydetail.id.
 */
async function insertLocks(scopeOrColivingClientId, records, gatewayIdToDbId = new Map()) {
  const triple = scopeInsertTriple(scopeOrColivingClientId);
  const inserted = [];
  for (const l of records) {
    const lockNum = l.lockId != null ? Number(l.lockId) : NaN;
    if (!Number.isFinite(lockNum)) continue;
    const gatewayRef = l.hasGateway && l.gatewayId != null ? gatewayIdToDbId.get(String(l.gatewayId)) || null : null;
    const childmeterJson = Array.isArray(l.childmeter) ? JSON.stringify(l.childmeter) : '[]';

    const [existRows] = await pool.query(
      'SELECT id, client_id, cln_clientid, cln_operatorid FROM lockdetail WHERE lockid = ? LIMIT 1',
      [lockNum]
    );
    if (existRows && existRows[0]) {
      const row = existRows[0];
      const merged = mergeOwnerTripleIntoRow(row, triple);
      await pool.query(
        `UPDATE lockdetail SET client_id = ?, cln_clientid = ?, cln_operatorid = ?, lockname = ?, lockalias = ?, electricquantity = ?, type = ?, hasgateway = ?, gateway_id = ?, brand = ?, isonline = ?, active = ?, childmeter = ?, updated_at = NOW() WHERE id = ?`,
        [
          merged.client_id,
          merged.cln_clientid,
          merged.cln_operatorid,
          l.lockName || '',
          l.lockAlias || '',
          l.electricQuantity != null ? Number(l.electricQuantity) : 0,
          l.type || 'Smartlock',
          l.hasGateway ? 1 : 0,
          gatewayRef,
          l.brand || 'ttlock',
          l.isOnline ? 1 : 0,
          l.active ? 1 : 1,
          childmeterJson,
          row.id
        ]
      );
      inserted.push({ id: row.id, lockId: l.lockId });
    } else {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO lockdetail (id, client_id, cln_clientid, cln_operatorid, lockid, lockname, lockalias, electricquantity, type, hasgateway, gateway_id, brand, isonline, active, childmeter, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          id,
          triple.client_id,
          triple.cln_clientid,
          triple.cln_operatorid,
          lockNum,
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
  }
  return inserted;
}

/**
 * Delete lock by id. Client must own it. Room/property smartdoor_id will be set null by FK.
 */
async function deleteLock(scopeOrColivingClientId, id) {
  const scope = normalizeSmartDoorScope(scopeOrColivingClientId);
  const { sql, params } = scopeRowOwnerWhere(scopeOrColivingClientId);
  const [rows] = await pool.query(
    `SELECT id, cln_clientid FROM lockdetail WHERE id = ? AND ${sql}`,
    [id, ...params]
  );
  if (!rows || rows.length === 0) return { ok: false, reason: 'LOCK_NOT_FOUND' };
  const cc = rows[0].cln_clientid;
  if (scope.kind === 'cln_operator' && cc != null && String(cc).trim() !== '') {
    return { ok: false, reason: 'CLN_CLIENT_OWNED_DISCONNECT_FIRST' };
  }
  await pool.query(`DELETE FROM lockdetail WHERE id = ? AND ${sql}`, [id, ...params]);
  return { ok: true };
}

/**
 * Delete gateway by id. Unlinks locks first (gateway_id = null), then deletes gateway.
 */
async function deleteGateway(scopeOrColivingClientId, id) {
  const scope = normalizeSmartDoorScope(scopeOrColivingClientId);
  const { sql, params } = scopeRowOwnerWhere(scopeOrColivingClientId);
  const [rows] = await pool.query(
    `SELECT id, cln_clientid FROM gatewaydetail WHERE id = ? AND ${sql}`,
    [id, ...params]
  );
  if (!rows || rows.length === 0) return { ok: false, reason: 'GATEWAY_NOT_FOUND' };
  const cc = rows[0].cln_clientid;
  if (scope.kind === 'cln_operator' && cc != null && String(cc).trim() !== '') {
    return { ok: false, reason: 'CLN_CLIENT_OWNED_DISCONNECT_FIRST' };
  }
  await pool.query('UPDATE lockdetail SET gateway_id = NULL WHERE gateway_id = ?', [id]);
  await pool.query(`DELETE FROM gatewaydetail WHERE id = ? AND ${sql}`, [id, ...params]);
  return { ok: true };
}

module.exports = {
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
};
