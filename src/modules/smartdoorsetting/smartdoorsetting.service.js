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
const { getTodayMalaysiaDate, malaysiaDateRangeToUtcForQuery } = require('../../utils/dateMalaysia');

/**
 * Smart door row ownership (lockdetail / gatewaydetail).
 * - Coliving portal: { kind: 'coliving', clientId: operatordetail.id }
 * - Cleanlemons client: { kind: 'cln_client', clnClientId, ttlockSlot?: number } (multi TTLock logins)
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
      const rawSlot = s.ttlockSlot;
      const slotNum = rawSlot == null || rawSlot === '' ? 0 : Number(rawSlot);
      const ttlockSlot = Number.isFinite(slotNum) && slotNum >= 0 ? slotNum : 0;
      return { kind: 'cln_client', clnClientId: String(s.clnClientId || '').trim(), ttlockSlot };
    }
    if (s.kind === 'cln_operator') {
      const rawOpSlot = s.ttlockSlot;
      const opSlotNum = rawOpSlot == null || rawOpSlot === '' ? 0 : Number(rawOpSlot);
      const ttlockSlot = Number.isFinite(opSlotNum) && opSlotNum >= 0 ? opSlotNum : 0;
      return { kind: 'cln_operator', clnOperatorId: String(s.clnOperatorId || '').trim(), ttlockSlot };
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

/** Options for TTLock API (multi-account Cleanlemons B2B clients). */
function ttLockApiOptions(scopeOrColivingClientId) {
  const s = normalizeSmartDoorScope(scopeOrColivingClientId);
  if (s.kind === 'cln_client') return { slot: s.ttlockSlot ?? 0 };
  if (s.kind === 'cln_operator') return { slot: s.ttlockSlot ?? 0 };
  return {};
}

/** Merge slot from a lockdetail/gatewaydetail row into scope for TTLock calls. */
function scopeWithTtlockSlotFromRow(scopeOrColivingClientId, slotFromRow) {
  const s = normalizeSmartDoorScope(scopeOrColivingClientId);
  const n = slotFromRow == null ? 0 : Number(slotFromRow);
  const ttlockSlot = Number.isFinite(n) && n >= 0 ? n : 0;
  if (s.kind === 'cln_client') return { kind: 'cln_client', clnClientId: s.clnClientId, ttlockSlot };
  if (s.kind === 'cln_operator') return { kind: 'cln_operator', clnOperatorId: s.clnOperatorId, ttlockSlot };
  return scopeOrColivingClientId;
}

/** DB value for lockdetail.cln_ttlock_slot / gatewaydetail.cln_ttlock_slot on insert/update. */
function clnTtlockSlotColumnValue(scopeOrColivingClientId) {
  const s = normalizeSmartDoorScope(scopeOrColivingClientId);
  if (s.kind === 'cln_client') return s.ttlockSlot ?? 0;
  if (s.kind === 'cln_operator') return s.ttlockSlot ?? 0;
  return 0;
}

/** SQL fragment + params for "this portal owns the row" on lockdetail/gatewaydetail. */
function scopeRowOwnerWhere(scopeOrColivingClientId) {
  const s = normalizeSmartDoorScope(scopeOrColivingClientId);
  if (s.kind === 'coliving') return { sql: 'client_id = ?', params: [s.clientId] };
  if (s.kind === 'cln_client') return { sql: 'cln_clientid = ?', params: [s.clnClientId] };
  return { sql: 'cln_operatorid = ?', params: [s.clnOperatorId] };
}

function getClnServiceLazy() {
  return require('../cleanlemon/cleanlemon.service');
}

/**
 * TTLock API credentials belong to the B2B client that owns the lockdetail row, not the logged-in grantee.
 */
function ttLockScopeForClnClientDevice(sessionScopeOrRow, deviceRow) {
  const session = normalizeSmartDoorScope(sessionScopeOrRow);
  const ownerId =
    deviceRow?.clnClientdetailId != null && String(deviceRow.clnClientdetailId).trim() !== ''
      ? String(deviceRow.clnClientdetailId).trim()
      : '';
  const slotRaw = deviceRow?.clnTtlockSlot != null ? Number(deviceRow.clnTtlockSlot) : 0;
  const ttlockSlot = Number.isFinite(slotRaw) && slotRaw >= 0 ? slotRaw : 0;
  if (session.kind === 'cln_client' && ownerId) {
    return { kind: 'cln_client', clnClientId: ownerId, ttlockSlot };
  }
  return scopeWithTtlockSlotFromRow(sessionScopeOrRow, deviceRow?.clnTtlockSlot);
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
 * Lockdetail ids linked to a Cleanlemons `cln_property` (Coliving mirror + cln_property_lock + optional smartdoor_id).
 * Does not filter by portal owner — use with client portal property ACL.
 */
async function getMergedLockDetailIdsForCleanlemonsProperty(propertyId) {
  const pid = String(propertyId || '').trim();
  if (!pid) return [];
  let colivingPid = null;
  try {
    const [clnRows] = await pool.query(
      'SELECT coliving_propertydetail_id AS pid FROM cln_property WHERE id = ? LIMIT 1',
      [pid]
    );
    colivingPid = clnRows?.[0]?.pid ? String(clnRows[0].pid).trim() : null;
  } catch (e) {
    const msg = String(e?.sqlMessage || e?.message || '');
    if (!/Unknown column/i.test(msg)) throw e;
  }
  const nativeIds = [];
  try {
    const [plRows] = await pool.query(
      'SELECT lockdetail_id AS lid FROM cln_property_lock WHERE property_id = ?',
      [pid]
    );
    for (const r of plRows || []) {
      const lid = r.lid != null ? String(r.lid).trim() : '';
      if (lid) nativeIds.push(lid);
    }
  } catch (e) {
    const msg = String(e?.sqlMessage || e?.message || '');
    if (!/doesn't exist|ER_NO_SUCH_TABLE|Table .* doesn't exist/i.test(msg)) throw e;
  }
  try {
    const [[row]] = await pool.query(
      'SELECT NULLIF(TRIM(smartdoor_id), \'\') AS sd FROM cln_property WHERE id = ? LIMIT 1',
      [pid]
    );
    if (row?.sd) nativeIds.push(String(row.sd).trim());
  } catch (e) {
    const msg = String(e?.sqlMessage || e?.message || '');
    if (!/Unknown column/i.test(msg)) throw e;
  }
  let candidates = [];
  if (colivingPid) {
    candidates = await getColivingPropertySmartDoorIds(colivingPid);
  }
  return [...new Set([...candidates, ...nativeIds])].filter(Boolean);
}

/**
 * Property shortname / cln_property name for filter fallback (when smartdoor_id not set on property/rooms).
 */
async function getPropertyDisplayNameForSmartDoorFilter(scopeOrColivingClientId, propertyId, opts = {}) {
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
    const loginEmail = opts.loginEmail != null ? String(opts.loginEmail).trim().toLowerCase() : '';
    try {
      const cln = getClnServiceLazy();
      const acc = await cln.getClientPortalAccessiblePropertyIds({
        clientdetailId: integId,
        loginEmail,
        limit: 1000,
      });
      const want = String(propertyId || '').trim();
      if (!acc.some((x) => String(x).trim() === want)) return null;
    } catch (_) {
      return null;
    }
    const [rows] = await pool.query(
      `SELECT COALESCE(NULLIF(TRIM(property_name), ''), id) AS nm FROM cln_property WHERE id = ? LIMIT 1`,
      [propertyId]
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

async function clnClientPortalCanViewLockDetail(clnClientId, loginEmail, lockDetailId) {
  const cid = String(clnClientId || '').trim();
  const lid = String(lockDetailId || '').trim();
  const em = String(loginEmail || '').trim().toLowerCase();
  if (!cid || !lid || !em) return false;
  try {
    const cln = getClnServiceLazy();
    const acc = await cln.getClientPortalAccessiblePropertyIds({
      clientdetailId: cid,
      loginEmail: em,
      limit: 1000,
    });
    if (!acc.length) return false;
    for (const pid of acc) {
      const merged = await getMergedLockDetailIdsForCleanlemonsProperty(pid);
      if (merged.some((x) => String(x) === lid)) return true;
    }
  } catch (_) {
    return false;
  }
  return false;
}

async function collectGatewayIdsFromClnClientAccessiblePropertyLocks(scope, loginEmail) {
  const s = normalizeSmartDoorScope(scope);
  if (s.kind !== 'cln_client') return new Set();
  const em = String(loginEmail || '').trim().toLowerCase();
  if (!em) return new Set();
  const gw = new Set();
  try {
    const cln = getClnServiceLazy();
    const acc = await cln.getClientPortalAccessiblePropertyIds({
      clientdetailId: s.clnClientId,
      loginEmail: em,
      limit: 1000,
    });
    for (const pid of acc) {
      const merged = await getMergedLockDetailIdsForCleanlemonsProperty(pid);
      if (!merged.length) continue;
      const ph = merged.map(() => '?').join(',');
      const [rows] = await pool.query(
        `SELECT DISTINCT gateway_id FROM lockdetail WHERE id IN (${ph})
         AND gateway_id IS NOT NULL AND TRIM(COALESCE(gateway_id, '')) != ''`,
        merged
      );
      for (const r of rows || []) {
        if (r.gateway_id) gw.add(String(r.gateway_id).trim());
      }
    }
  } catch (_) {
    /* ignore */
  }
  return gw;
}

async function clnClientPortalCanViewGatewayDetail(clnClientId, loginEmail, gatewayDetailId) {
  const gid = String(gatewayDetailId || '').trim();
  if (!gid) return false;
  const [locks] = await pool.query(
    `SELECT id FROM lockdetail
     WHERE gateway_id IS NOT NULL AND TRIM(COALESCE(gateway_id, '')) != '' AND gateway_id = ?
     LIMIT 200`,
    [gid]
  );
  for (const r of locks || []) {
    const ok = await clnClientPortalCanViewLockDetail(clnClientId, loginEmail, r.id);
    if (ok) return true;
  }
  return false;
}

function mapLockDetailQueryRowToItem(r, scope) {
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
    clnTtlockSlot: r.cln_ttlock_slot != null ? Number(r.cln_ttlock_slot) : 0,
  };
}

function mapGatewayQueryRowToItem(r, scope) {
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
    clnTtlockSlot: r.cln_ttlock_slot != null ? Number(r.cln_ttlock_slot) : 0,
  };
}

/**
 * Remote unlock a lock by lockdetail id. Resolves lockid from DB and calls TTLock API.
 * @param {object} [logContext] - { actorEmail, portalSource?, jobId? } — on success writes lockdetail_log when actorEmail set.
 */
async function remoteUnlockLock(scopeOrColivingClientId, lockDetailId, logContext = null) {
  const loginEmail = logContext?.loginEmail != null ? String(logContext.loginEmail).trim().toLowerCase() : '';
  const lock = await getLock(scopeOrColivingClientId, lockDetailId, { loginEmail });
  if (!lock || !lock.lockId) throw new Error('LOCK_NOT_FOUND');
  const scopeForTt = ttLockScopeForClnClientDevice(scopeOrColivingClientId, lock);
  const ttKey = ttLockIntegrationKey(scopeForTt);
  const ttOpt = ttLockApiOptions(scopeForTt);
  await lockWrapper.remoteUnlock(ttKey, lock.lockId, ttOpt);
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

/**
 * Operator list: attach `cln_property` door mode + whether there is a schedule on today's MY calendar.
 */
async function enrichOperatorSmartDoorLockItems(lockItems, operatorId) {
  const oid = String(operatorId || '').trim();
  const ids = lockItems.map((l) => l._id).filter(Boolean);
  if (!oid || !ids.length) return;
  const ph = ids.map(() => '?').join(',');
  let rows;
  try {
    [rows] = await pool.query(
      `SELECT id AS propertyId, smartdoor_id AS smartdoorId,
              COALESCE(NULLIF(TRIM(operator_door_access_mode), ''), 'fixed_password') AS mode
       FROM cln_property
       WHERE operator_id = ? AND smartdoor_id IN (${ph})`,
      [oid, ...ids]
    );
  } catch (e) {
    console.warn('[smartdoorsetting] enrichOperatorSmartDoorLockItems:', e?.message || e);
    return;
  }
  const byLock = new Map((rows || []).map((r) => [String(r.smartdoorId), r]));
  const todayMy = getTodayMalaysiaDate();
  const propertyIds = [...new Set((rows || []).map((r) => String(r.propertyId)))];
  let bookingSet = new Set();
  if (propertyIds.length) {
    const pph = propertyIds.map(() => '?').join(',');
    try {
      const [br] = await pool.query(
        `SELECT DISTINCT property_id AS pid FROM cln_schedule
         WHERE property_id IN (${pph})
           AND working_day IS NOT NULL
           AND DATE(DATE_ADD(working_day, INTERVAL 8 HOUR)) = ?`,
        [...propertyIds, todayMy]
      );
      bookingSet = new Set((br || []).map((x) => String(x.pid)));
    } catch (e) {
      console.warn('[smartdoorsetting] enrichOperatorSmartDoorLockItems booking:', e?.message || e);
    }
  }
  for (const l of lockItems) {
    const pr = byLock.get(String(l._id));
    if (!pr) continue;
    l.clnPropertyId = String(pr.propertyId);
    l.operatorDoorAccessMode = pr.mode;
    l.hasBookingToday = bookingSet.has(String(pr.propertyId));
  }
}

async function mapEmailsToClnDisplayNames(emails) {
  const list = [...new Set(emails.map((e) => String(e || '').trim().toLowerCase()).filter(Boolean))];
  const m = new Map();
  if (!list.length) return m;
  const ph = list.map(() => '?').join(',');
  try {
    const [cRows] = await pool.query(
      `SELECT LOWER(TRIM(email)) AS em, NULLIF(TRIM(fullname), '') AS nm FROM cln_clientdetail WHERE LOWER(TRIM(email)) IN (${ph})`,
      list
    );
    for (const r of cRows || []) {
      if (r.nm) m.set(String(r.em), String(r.nm));
    }
  } catch (_) {
    /* optional */
  }
  for (const t of ['cln_operatordetail', 'cln_operator']) {
    try {
      const [oRows] = await pool.query(
        `SELECT LOWER(TRIM(email)) AS em, NULLIF(TRIM(name), '') AS nm FROM \`${t}\` WHERE LOWER(TRIM(email)) IN (${ph})`,
        list
      );
      for (const r of oRows || []) {
        const em = String(r.em || '');
        if (em && r.nm && !m.has(em)) m.set(em, String(r.nm));
      }
    } catch (_) {
      /* table may not exist in some envs */
    }
  }
  return m;
}

/**
 * Operator remote unlock: enforce `cln_property.operator_door_access_mode` + gateway + booking (MY today).
 */
async function assertOperatorRemoteDoorPolicy(scopeOrColivingClientId, lockDetailId) {
  const scope = normalizeSmartDoorScope(scopeOrColivingClientId);
  if (scope.kind !== 'cln_operator') return;
  const oid = scope.clnOperatorId;
  const lid = String(lockDetailId || '').trim();
  const lock = await getLock(scopeOrColivingClientId, lid);
  if (!lock) {
    const e = new Error('LOCK_NOT_FOUND');
    e.code = 'LOCK_NOT_FOUND';
    throw e;
  }
  const gwOk = !!lock.hasGateway && !!lock.gateway && !lock.needsGatewayDbLink;
  let prop = null;
  try {
    const [[row]] = await pool.query(
      `SELECT id AS propertyId,
              COALESCE(NULLIF(TRIM(operator_door_access_mode), ''), 'temporary_password_only') AS mode
       FROM cln_property
       WHERE operator_id = ? AND smartdoor_id = ?
       LIMIT 1`,
      [oid, lid]
    );
    prop = row || null;
  } catch (err) {
    console.warn('[smartdoorsetting] assertOperatorRemoteDoorPolicy:', err?.message || err);
  }
  if (!prop) return;
  let mode = String(prop.mode || 'temporary_password_only').trim().toLowerCase();
  if (mode === 'fixed_password') {
    const e = new Error('OPERATOR_DOOR_USE_PASSWORD');
    e.code = 'OPERATOR_DOOR_USE_PASSWORD';
    throw e;
  }
  if (mode === 'working_date_only') mode = 'temporary_password_only';
  if (mode === 'full_access') {
    if (!gwOk) {
      const e = new Error('OPERATOR_DOOR_GATEWAY_REQUIRED');
      e.code = 'OPERATOR_DOOR_GATEWAY_REQUIRED';
      throw e;
    }
    return;
  }
  if (mode === 'temporary_password_only') {
    if (!gwOk) {
      const e = new Error('OPERATOR_DOOR_GATEWAY_REQUIRED');
      e.code = 'OPERATOR_DOOR_GATEWAY_REQUIRED';
      throw e;
    }
    const ymd = getTodayMalaysiaDate();
    const [[b]] = await pool.query(
      `SELECT 1 AS ok FROM cln_schedule
       WHERE property_id = ?
         AND working_day IS NOT NULL
         AND DATE(DATE_ADD(working_day, INTERVAL 8 HOUR)) = ?
       LIMIT 1`,
      [prop.propertyId, ymd]
    );
    if (!b) {
      const e = new Error('OPERATOR_DOOR_NO_BOOKING_TODAY');
      e.code = 'OPERATOR_DOOR_NO_BOOKING_TODAY';
      throw e;
    }
    return;
  }
  if (!gwOk) {
    const e = new Error('OPERATOR_DOOR_GATEWAY_REQUIRED');
    e.code = 'OPERATOR_DOOR_GATEWAY_REQUIRED';
    throw e;
  }
}

/**
 * Operator: reveal `cln_property.smartdoor_password` when policy allows.
 */
async function getOperatorDoorPasswordReveal(scopeOrColivingClientId, lockDetailId) {
  const scope = normalizeSmartDoorScope(scopeOrColivingClientId);
  if (scope.kind !== 'cln_operator') {
    return { ok: false, reason: 'NOT_OPERATOR_SCOPE' };
  }
  const oid = scope.clnOperatorId;
  const lid = String(lockDetailId || '').trim();
  const lock = await getLock(scopeOrColivingClientId, lid);
  if (!lock) return { ok: false, reason: 'LOCK_NOT_FOUND' };
  const gwOk = !!lock.hasGateway && !!lock.gateway && !lock.needsGatewayDbLink;
  let row;
  try {
    const [[r]] = await pool.query(
      `SELECT id AS propertyId, COALESCE(smartdoor_password, '') AS pwd,
              COALESCE(NULLIF(TRIM(operator_door_access_mode), ''), 'fixed_password') AS mode
       FROM cln_property
       WHERE operator_id = ? AND smartdoor_id = ?
       LIMIT 1`,
      [oid, lid]
    );
    row = r;
  } catch (e) {
    return { ok: false, reason: 'QUERY_FAILED' };
  }
  if (!row) return { ok: false, reason: 'NO_PROPERTY_LINK' };
  const mode = String(row.mode || 'fixed_password').trim().toLowerCase();
  const pwd = String(row.pwd || '');
  if (mode === 'fixed_password') {
    return { ok: true, password: pwd };
  }
  if (!gwOk) return { ok: false, reason: 'OPERATOR_DOOR_GATEWAY_REQUIRED' };
  if (mode === 'full_access') {
    return { ok: true, password: pwd };
  }
  if (mode === 'working_date_only') {
    const ymd = getTodayMalaysiaDate();
    const [[b]] = await pool.query(
      `SELECT 1 AS ok FROM cln_schedule
       WHERE property_id = ?
         AND working_day IS NOT NULL
         AND DATE(DATE_ADD(working_day, INTERVAL 8 HOUR)) = ?
       LIMIT 1`,
      [row.propertyId, ymd]
    );
    if (!b) return { ok: false, reason: 'OPERATOR_DOOR_NO_BOOKING_TODAY' };
    return { ok: true, password: pwd };
  }
  return { ok: true, password: pwd };
}

/**
 * Portal: unlock logs for a lock (scope must own lockdetail row). `date` or `from`+`to` = Malaysia YYYY-MM-DD.
 */
async function listLockUnlockLogsForPortalScope(scopeOrColivingClientId, lockDetailId, { date, from, to, page, pageSize, loginEmail } = {}) {
  const lid = String(lockDetailId || '').trim();
  const lock = await getLock(scopeOrColivingClientId, lid, { loginEmail });
  if (!lock) {
    const e = new Error('LOCK_NOT_FOUND');
    e.code = 'LOCK_NOT_FOUND';
    throw e;
  }
  const fromY = from || date;
  const toY = to || date;
  if (!fromY || !toY) {
    const e = new Error('MISSING_DATE_RANGE');
    e.code = 'MISSING_DATE_RANGE';
    throw e;
  }
  const a = String(fromY).slice(0, 10);
  const b = String(toY).slice(0, 10);
  const { fromUtc, toUtc } = malaysiaDateRangeToUtcForQuery(a, b);
  const raw = await lockdetailLog.listLockdetailLogsForPortal({
    lockdetailId: lid,
    utcFrom: fromUtc,
    utcTo: toUtc,
    page,
    pageSize,
  });
  const emails = [...new Set((raw.items || []).map((i) => String(i.actorEmail || '').trim().toLowerCase()).filter(Boolean))];
  const nameMap = await mapEmailsToClnDisplayNames(emails);
  const items = (raw.items || []).map((i) => ({
    ...i,
    actorDisplayName: nameMap.get(String(i.actorEmail || '').trim().toLowerCase()) || '',
  }));
  return { ok: true, items, total: raw.total, page: raw.page, pageSize: raw.pageSize };
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
    if (scope.kind === 'cln_client' && opts.loginEmail) {
      try {
        const cln = getClnServiceLazy();
        const acc = await cln.getClientPortalAccessiblePropertyIds({
          clientdetailId: scope.clnClientId,
          loginEmail: String(opts.loginEmail || '').trim().toLowerCase(),
          limit: 1000,
        });
        const ownedIds = new Set(lockItems.map((l) => String(l._id)));
        const extraIds = new Set();
        for (const pid of acc) {
          const merged = await getMergedLockDetailIdsForCleanlemonsProperty(pid);
          for (const lid of merged) {
            const s = String(lid);
            if (!ownedIds.has(s)) extraIds.add(s);
          }
        }
        if (extraIds.size) {
          const ph = [...extraIds].map(() => '?').join(',');
          const [extraRows] = await pool.query(
            `SELECT l.id, l.lockid, l.lockalias, l.lockname, l.gateway_id, l.hasgateway, l.electricquantity, l.type, l.brand, l.isonline, l.active, l.childmeter, l.client_id, l.cln_clientid, l.cln_operatorid, l.cln_ttlock_slot,
             cd.fullname AS cln_client_fullname, cd.email AS cln_client_email
             FROM lockdetail l
             LEFT JOIN cln_clientdetail cd ON cd.id = l.cln_clientid
             WHERE l.id IN (${ph})`,
            [...extraIds]
          );
          lockItems = lockItems.concat((extraRows || []).map((r) => mapLockDetailQueryRowToItem(r, scope)));
        }
      } catch (e) {
        console.warn('[smartdoorsetting] cln_client shared smartdoor locks:', e?.message || e);
      }
    }
    const idToLock = new Map(lockItems.map((l) => [l._id, l]));
    lockItems.forEach((l) => {
      l.childmeterAliases = (l.childmeter || []).map((id) => idToLock.get(id)?.lockAlias || id);
      const parent = lockItems.find((o) => o._id !== l._id && (o.childmeter || []).includes(l._id));
      l.parentLockAlias = parent ? parent.lockAlias : null;
    });
    if (scope.kind === 'cln_operator' && lockItems.length) {
      await enrichOperatorSmartDoorLockItems(lockItems, scope.clnOperatorId);
    }
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
    if (scope.kind === 'cln_client' && opts.loginEmail && (lockItems.length || filter === 'GATEWAY')) {
      const have = new Set(gatewayItems.map((g) => String(g._id)));
      const need = new Set();
      for (const l of lockItems) {
        if (l.gateway != null && String(l.gateway).trim() !== '') need.add(String(l.gateway).trim());
      }
      if (filter === 'GATEWAY') {
        const fromAcc = await collectGatewayIdsFromClnClientAccessiblePropertyLocks(scope, opts.loginEmail);
        for (const id of fromAcc) need.add(id);
      }
      const toFetch = [...need].filter((id) => !have.has(id));
      if (toFetch.length) {
        const ph = toFetch.map(() => '?').join(',');
        const [gr] = await pool.query(
          `SELECT g.id, g.gatewayid, g.gatewayname, g.networkname, g.locknum, g.isonline, g.type, g.client_id, g.cln_clientid, g.cln_operatorid, g.cln_ttlock_slot,
           cd.fullname AS cln_client_fullname, cd.email AS cln_client_email
           FROM gatewaydetail g
           LEFT JOIN cln_clientdetail cd ON cd.id = g.cln_clientid
           WHERE g.id IN (${ph})`,
          toFetch
        );
        gatewayItems = gatewayItems.concat((gr || []).map((r) => mapGatewayQueryRowToItem(r, scope)));
      }
    }
  }

  let items = [...lockItems, ...gatewayItems];

  /** Cleanlemons operator portal: filter by operator-owned rows vs a linked B2B client (`cln_clientid`). */
  const ownOpt = opts.clnClientOwnership != null ? String(opts.clnClientOwnership).trim().toLowerCase() : 'all';
  if (scope.kind === 'cln_operator' && ownOpt && ownOpt !== 'all') {
    if (ownOpt === 'own' || ownOpt === 'operator') {
      items = items.filter((i) => !i.clnClientdetailId);
    } else {
      const want = String(opts.clnClientOwnership || '').trim();
      items = items.filter((i) => String(i.clnClientdetailId || '').trim() === want);
    }
  }

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
    const doorIds = await getSmartDoorIdsByProperty(scopeOrColivingClientId, propertyId, {
      loginEmail: opts.loginEmail,
    });
    // 1) Strict: locks on property/room smartdoor_id + gateways linked via lockdetail.gateway_id
    // 2) Fallback: no DB linkage — match device alias/name to property label tokens (e.g. "Paragon Suite" → "ps" for "PS A 29-05")
    if (doorIds && doorIds.length > 0) {
      const lockSet = new Set(doorIds);
      const inPh = doorIds.map(() => '?').join(',');
      const [gwFromLocks] = await pool.query(
        `SELECT DISTINCT gateway_id FROM lockdetail WHERE id IN (${inPh})
         AND gateway_id IS NOT NULL AND TRIM(COALESCE(gateway_id, '')) != ''`,
        doorIds
      );
      const gwSet = new Set((gwFromLocks || []).map((r) => String(r.gateway_id).trim()));
      items = items.filter(
        (i) =>
          (i.__type === 'lock' && lockSet.has(i._id)) ||
          (i.__type === 'gateway' && gwSet.has(String(i._id)))
      );
    } else {
      const label = await getPropertyDisplayNameForSmartDoorFilter(scopeOrColivingClientId, propertyId, {
        loginEmail: opts.loginEmail,
      });
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
async function getSmartDoorFilters(scopeOrColivingClientId, opts = {}) {
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
      let linkedClients = [];
      try {
        const [lr] = await pool.query(
          `SELECT DISTINCT l.cln_clientid AS id, cd.fullname, cd.email
           FROM lockdetail l
           INNER JOIN cln_clientdetail cd ON cd.id = l.cln_clientid
           WHERE l.cln_operatorid = ? AND l.cln_clientid IS NOT NULL AND TRIM(COALESCE(l.cln_clientid, '')) != ''`,
          [integId]
        );
        const [gr] = await pool.query(
          `SELECT DISTINCT g.cln_clientid AS id, cd.fullname, cd.email
           FROM gatewaydetail g
           INNER JOIN cln_clientdetail cd ON cd.id = g.cln_clientid
           WHERE g.cln_operatorid = ? AND g.cln_clientid IS NOT NULL AND TRIM(COALESCE(g.cln_clientid, '')) != ''`,
          [integId]
        );
        const m = new Map();
        for (const r of [...(lr || []), ...(gr || [])]) {
          const id = r.id != null ? String(r.id).trim() : '';
          if (!id || m.has(id)) continue;
          const fn = r.fullname != null ? String(r.fullname).trim() : '';
          const em = r.email != null ? String(r.email).trim() : '';
          const label = fn || em || id;
          m.set(id, label);
        }
        linkedClients = [...m.entries()]
          .sort((a, b) => String(a[1]).localeCompare(String(b[1]), undefined, { sensitivity: 'base' }))
          .map(([value, label]) => ({ value, label }));
      } catch (_) {
        linkedClients = [];
      }
      return { properties, linkedClients };
    } catch (e) {
      const msg = String(e?.sqlMessage || e?.message || '');
      if (!/Unknown column/i.test(msg)) throw e;
    }
  }
  if (kind === 'cln_client') {
    try {
      const loginEmail = opts.loginEmail != null ? String(opts.loginEmail).trim().toLowerCase() : '';
      if (loginEmail) {
        const cln = getClnServiceLazy();
        const rows = await cln.listClientPortalProperties({
          clientdetailId: integId,
          limit: 1000,
          loginEmail,
        });
        const properties = (rows || []).map((r) => ({
          label: (r.name && String(r.name).trim()) || r.id,
          value: r.id,
        }));
        return { properties };
      }
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
async function getLock(scopeOrColivingClientId, id, viewOpts = {}) {
  const scope = normalizeSmartDoorScope(scopeOrColivingClientId);
  const { sql, params } = scopeRowOwnerWhere(scopeOrColivingClientId);
  const sel = `SELECT l.id, l.lockid, l.lockalias, l.lockname, l.gateway_id, l.hasgateway, l.electricquantity, l.type, l.brand, l.isonline, l.active, l.childmeter, l.client_id, l.cln_clientid, l.cln_operatorid, l.cln_ttlock_slot,
     cd.fullname AS cln_client_fullname, cd.email AS cln_client_email
     FROM lockdetail l
     LEFT JOIN cln_clientdetail cd ON cd.id = l.cln_clientid`;
  const [rows] = await pool.query(`${sel} WHERE l.id = ? AND l.${sql} LIMIT 1`, [id, ...params]);
  let r = rows && rows[0];
  if (!r && scope.kind === 'cln_client' && viewOpts.loginEmail) {
    const em = String(viewOpts.loginEmail || '').trim().toLowerCase();
    if (em && (await clnClientPortalCanViewLockDetail(scope.clnClientId, em, id))) {
      const [rows2] = await pool.query(`${sel} WHERE l.id = ? LIMIT 1`, [id]);
      r = rows2 && rows2[0];
    }
  }
  if (!r) return null;
  return mapLockDetailQueryRowToItem(r, scope);
}

/**
 * Get single gateway by id.
 */
async function getGateway(scopeOrColivingClientId, id, viewOpts = {}) {
  const scope = normalizeSmartDoorScope(scopeOrColivingClientId);
  const { sql, params } = scopeRowOwnerWhere(scopeOrColivingClientId);
  const sel = `SELECT g.id, g.gatewayid, g.gatewayname, g.networkname, g.locknum, g.isonline, g.type, g.client_id, g.cln_clientid, g.cln_operatorid, g.cln_ttlock_slot,
     cd.fullname AS cln_client_fullname, cd.email AS cln_client_email
     FROM gatewaydetail g
     LEFT JOIN cln_clientdetail cd ON cd.id = g.cln_clientid`;
  const [rows] = await pool.query(`${sel} WHERE g.id = ? AND g.${sql} LIMIT 1`, [id, ...params]);
  let r = rows && rows[0];
  if (!r && scope.kind === 'cln_client' && viewOpts.loginEmail) {
    const em = String(viewOpts.loginEmail || '').trim().toLowerCase();
    if (em && (await clnClientPortalCanViewGatewayDetail(scope.clnClientId, em, id))) {
      const [rows2] = await pool.query(`${sel} WHERE g.id = ? LIMIT 1`, [id]);
      r = rows2 && rows2[0];
    }
  }
  if (!r) return null;
  return mapGatewayQueryRowToItem(r, scope);
}

/**
 * Update lock: lockAlias, active, childmeter (array of lockdetail ids).
 */
async function updateLock(scopeOrColivingClientId, id, data) {
  const scope = normalizeSmartDoorScope(scopeOrColivingClientId);
  const { sql, params } = scopeRowOwnerWhere(scopeOrColivingClientId);
  const [rows] = await pool.query(
    `SELECT id, cln_clientid FROM lockdetail WHERE id = ? AND ${sql}`,
    [id, ...params]
  );
  if (!rows || rows.length === 0) return { ok: false, reason: 'LOCK_NOT_FOUND' };
  const cc = rows[0].cln_clientid;
  if (scope.kind === 'cln_operator' && cc != null && String(cc).trim() !== '') {
    return { ok: false, reason: 'CLIENT_OWNED_READ_ONLY' };
  }

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
  const scope = normalizeSmartDoorScope(scopeOrColivingClientId);
  const { sql, params } = scopeRowOwnerWhere(scopeOrColivingClientId);
  const [rows] = await pool.query(
    `SELECT id, cln_clientid FROM gatewaydetail WHERE id = ? AND ${sql}`,
    [id, ...params]
  );
  if (!rows || rows.length === 0) return { ok: false, reason: 'GATEWAY_NOT_FOUND' };
  const cc = rows[0].cln_clientid;
  if (scope.kind === 'cln_operator' && cc != null && String(cc).trim() !== '') {
    return { ok: false, reason: 'CLIENT_OWNED_READ_ONLY' };
  }
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
  const ttOpt = ttLockApiOptions(scopeOrColivingClientId);
  const lockId = Number(l.lockId);
  if (!Number.isFinite(lockId)) return;
  const newAlias = l.lockAlias || l.lockName || '';
  const newElectric = Number(l.electricQuantity || 0);
  const ttHasGateway = ttlockListItemHasGateway(l);
  let ttGwRaw = ttlockListItemGatewayExternalId(l);
  if (ttHasGateway && ttGwRaw == null) {
    try {
      const detailRes = await lockWrapper.getLockDetail(ttKey, lockId, ttOpt);
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
  const ttKey = ttLockIntegrationKey(scopeOrColivingClientId);
  const ttOpt = ttLockApiOptions(scopeOrColivingClientId);
  const lockRes = await lockWrapper.listAllLocks(ttKey, ttOpt);
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
async function syncSingleLockStatusFromTtlock(scopeOrColivingClientId, lockDetailId, opts = {}) {
  const id = String(lockDetailId || '').trim();
  if (!id) return { ok: false, reason: 'NO_ID' };
  const dbLock = await getLock(scopeOrColivingClientId, id, { loginEmail: opts.loginEmail });
  if (!dbLock || dbLock.lockId == null) return { ok: false, reason: 'LOCK_NOT_FOUND' };
  const lockIdNum = Number(dbLock.lockId);
  if (!Number.isFinite(lockIdNum)) return { ok: false, reason: 'INVALID_LOCK_ID' };

  const scopeForTt = ttLockScopeForClnClientDevice(scopeOrColivingClientId, dbLock);
  const ttKey = ttLockIntegrationKey(scopeForTt);
  const ttOpt = ttLockApiOptions(scopeForTt);
  const lockRes = await lockWrapper.listAllLocks(ttKey, ttOpt);
  let l = (lockRes?.list || []).find((x) => Number(x.lockId) === lockIdNum);
  if (!l) {
    const detailRes = await lockWrapper.getLockDetail(ttKey, lockIdNum, ttOpt);
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
      const { sql, params } = scopeRowOwnerWhere(scopeForTt);
      singleGatewayFallbackPromise = pool
        .query(`SELECT id FROM gatewaydetail WHERE ${sql} LIMIT 2`, params)
        .then(([rows]) => (rows && rows.length === 1 ? rows[0].id : null));
    }
    return singleGatewayFallbackPromise;
  };

  await mergeOneLockFromTtlockListItem(scopeForTt, l, getSingleGatewayDbIdFallback);
  const updated = await getLock(scopeOrColivingClientId, id, { loginEmail: opts.loginEmail });
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
  const ttOpt = ttLockApiOptions(scopeOrColivingClientId);
  const gatewayRes = await gatewayWrapper.listAllGateways(ttKey, ttOpt);
  const gwList = gatewayRes?.list || [];
  for (const g of gwList) {
    await mergeOneGatewayFromTtlockListItem(scopeOrColivingClientId, g);
  }
  return gwList;
}

/**
 * Refresh one gatewaydetail row from TTLock (name, online, lock count, network).
 */
async function syncSingleGatewayStatusFromTtlock(scopeOrColivingClientId, gatewayDetailId, opts = {}) {
  const id = String(gatewayDetailId || '').trim();
  if (!id) return { ok: false, reason: 'NO_ID' };
  const dbGw = await getGateway(scopeOrColivingClientId, id, { loginEmail: opts.loginEmail });
  if (!dbGw || dbGw.gatewayId == null) return { ok: false, reason: 'GATEWAY_NOT_FOUND' };
  const extId = Number(dbGw.gatewayId);
  if (!Number.isFinite(extId)) return { ok: false, reason: 'INVALID_GATEWAY_ID' };

  const scopeForTt = ttLockScopeForClnClientDevice(scopeOrColivingClientId, dbGw);
  const ttKey = ttLockIntegrationKey(scopeForTt);
  const ttOpt = ttLockApiOptions(scopeForTt);
  const gatewayRes = await gatewayWrapper.listAllGateways(ttKey, ttOpt);
  const g = (gatewayRes?.list || []).find((x) => Number(x.gatewayId) === extId);
  if (!g) {
    return { ok: false, reason: 'TTLOCK_GATEWAY_NOT_FOUND' };
  }
  await mergeOneGatewayFromTtlockListItem(scopeForTt, g);
  const updated = await getGateway(scopeOrColivingClientId, id, { loginEmail: opts.loginEmail });
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
  const ttOpt = ttLockApiOptions(scopeOrColivingClientId);
  const result = [];

  try {
    const lockRes = await lockWrapper.listAllLocks(ttKey, ttOpt);
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
    const gatewayRes = await gatewayWrapper.listAllGateways(ttKey, ttOpt);
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
async function syncTTLockName(scopeOrColivingClientId, { type, externalId, name }, opts = {}) {
  if (!name || !externalId) throw new Error('NAME_AND_EXTERNAL_ID_REQUIRED');
  const sess = normalizeSmartDoorScope(scopeOrColivingClientId);
  let ttScope = scopeOrColivingClientId;
  const em = opts.loginEmail != null ? String(opts.loginEmail).trim().toLowerCase() : '';
  if (sess.kind === 'cln_client' && em) {
    if (type === 'lock') {
      const ext = Number(externalId);
      if (Number.isFinite(ext)) {
        const [lr] = await pool.query('SELECT id FROM lockdetail WHERE lockid = ? LIMIT 1', [ext]);
        const lid = lr?.[0]?.id;
        if (lid) {
          const lock = await getLock(scopeOrColivingClientId, lid, { loginEmail: em });
          if (!lock) {
            const e = new Error('LOCK_NOT_FOUND');
            e.code = 'LOCK_NOT_FOUND';
            throw e;
          }
          ttScope = ttLockScopeForClnClientDevice(scopeOrColivingClientId, lock);
        }
      }
    } else if (type === 'gateway') {
      const ext = Number(externalId);
      if (Number.isFinite(ext)) {
        const [gr] = await pool.query('SELECT id FROM gatewaydetail WHERE gatewayid = ? LIMIT 1', [ext]);
        const gid = gr?.[0]?.id;
        if (gid) {
          const gw = await getGateway(scopeOrColivingClientId, gid, { loginEmail: em });
          if (!gw) {
            const e = new Error('GATEWAY_NOT_FOUND');
            e.code = 'GATEWAY_NOT_FOUND';
            throw e;
          }
          ttScope = ttLockScopeForClnClientDevice(scopeOrColivingClientId, gw);
        }
      }
    }
  }
  const ttKey = ttLockIntegrationKey(ttScope);
  const ttOpt = ttLockApiOptions(ttScope);
  if (type === 'lock') {
    await lockWrapper.changeLockName(ttKey, Number(externalId), name, ttOpt);
    return { ok: true };
  }
  if (type === 'gateway') {
    await gatewayWrapper.renameGateway(ttKey, Number(externalId), name, ttOpt);
    return { ok: true };
  }
  throw new Error(`UNKNOWN_TYPE: ${type}`);
}

/**
 * Get lockdetail ids that belong to this property (property.smartdoor_id + rooms' smartdoor_id).
 * Cleanlemons: propertyId is cln_property.id; resolves via coliving_propertydetail_id when set.
 */
async function getSmartDoorIdsByProperty(scopeOrColivingClientId, propertyId, opts = {}) {
  const integId = scopeToIntegrationId(scopeOrColivingClientId);
  const kind = await detectTtlockOwnerKind(integId);
  if (kind === 'cln_client') {
    const loginEmail = opts.loginEmail != null ? String(opts.loginEmail).trim().toLowerCase() : '';
    const want = String(propertyId || '').trim();
    if (!want) return [];
    if (loginEmail) {
      try {
        const cln = getClnServiceLazy();
        const acc = await cln.getClientPortalAccessiblePropertyIds({
          clientdetailId: integId,
          loginEmail,
          limit: 1000,
        });
        if (!acc.some((x) => String(x).trim() === want)) return [];
      } catch (_) {
        return [];
      }
      const merged = await getMergedLockDetailIdsForCleanlemonsProperty(want);
      if (!merged.length) return [];
      const inPh = merged.map(() => '?').join(',');
      const [rows] = await pool.query(`SELECT id FROM lockdetail WHERE id IN (${inPh})`, merged);
      return (rows || []).map((r) => r.id);
    }
    const col = 'clientdetail_id';
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
    let nativeIds = [];
    try {
      const [plRows] = await pool.query(
        'SELECT lockdetail_id AS lid FROM cln_property_lock WHERE property_id = ?',
        [propertyId]
      );
      nativeIds = (plRows || []).map((r) => String(r.lid || '').trim()).filter(Boolean);
    } catch (e) {
      const msg = String(e?.sqlMessage || e?.message || '');
      if (!/doesn't exist|ER_NO_SUCH_TABLE|Table .* doesn't exist/i.test(msg)) throw e;
    }
    let candidates = [];
    if (colivingPid) {
      candidates = await getColivingPropertySmartDoorIds(colivingPid);
    }
    const merged = [...new Set([...candidates, ...nativeIds])];
    if (!merged.length) return [];
    const { sql, params } = scopeRowOwnerWhere(scopeOrColivingClientId);
    const inPh = merged.map(() => '?').join(',');
    const [owned] = await pool.query(
      `SELECT id FROM lockdetail WHERE ${sql} AND id IN (${inPh})`,
      [...params, ...merged]
    );
    return (owned || []).map((r) => r.id);
  }
  if (kind === 'cln_operator') {
    const col = 'operator_id';
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
    let nativeIds = [];
    try {
      const [plRows] = await pool.query(
        'SELECT lockdetail_id AS lid FROM cln_property_lock WHERE property_id = ?',
        [propertyId]
      );
      nativeIds = (plRows || []).map((r) => String(r.lid || '').trim()).filter(Boolean);
    } catch (e) {
      const msg = String(e?.sqlMessage || e?.message || '');
      if (!/doesn't exist|doesn't exist|ER_NO_SUCH_TABLE|Table .* doesn't exist/i.test(msg)) throw e;
    }
    let candidates = [];
    if (colivingPid) {
      candidates = await getColivingPropertySmartDoorIds(colivingPid);
    }
    const merged = [...new Set([...candidates, ...nativeIds])];
    if (!merged.length) return [];
    const { sql, params } = scopeRowOwnerWhere(scopeOrColivingClientId);
    const inPh = merged.map(() => '?').join(',');
    const [owned] = await pool.query(
      `SELECT id FROM lockdetail WHERE ${sql} AND id IN (${inPh})`,
      [...params, ...merged]
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
  const slotCol = clnTtlockSlotColumnValue(scopeOrColivingClientId);
  const inserted = [];
  for (const g of records) {
    const extGw = g.gatewayId != null ? Number(g.gatewayId) : NaN;
    if (!Number.isFinite(extGw)) {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO gatewaydetail (id, client_id, cln_clientid, cln_operatorid, cln_ttlock_slot, gatewayid, gatewayname, networkname, locknum, isonline, type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          id,
          triple.client_id,
          triple.cln_clientid,
          triple.cln_operatorid,
          slotCol,
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
        `UPDATE gatewaydetail SET client_id = ?, cln_clientid = ?, cln_operatorid = ?, cln_ttlock_slot = ?, gatewayname = ?, networkname = ?, locknum = ?, isonline = ?, type = ?, updated_at = NOW() WHERE id = ?`,
        [
          merged.client_id,
          merged.cln_clientid,
          merged.cln_operatorid,
          slotCol,
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
        `INSERT INTO gatewaydetail (id, client_id, cln_clientid, cln_operatorid, cln_ttlock_slot, gatewayid, gatewayname, networkname, locknum, isonline, type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          id,
          triple.client_id,
          triple.cln_clientid,
          triple.cln_operatorid,
          slotCol,
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
  const slotCol = clnTtlockSlotColumnValue(scopeOrColivingClientId);
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
        `INSERT INTO lockdetail (id, client_id, cln_clientid, cln_operatorid, cln_ttlock_slot, lockid, lockname, lockalias, electricquantity, type, hasgateway, gateway_id, brand, isonline, active, childmeter, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          id,
          triple.client_id,
          triple.cln_clientid,
          triple.cln_operatorid,
          slotCol,
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
  assertOperatorRemoteDoorPolicy,
  getOperatorDoorPasswordReveal,
  listLockUnlockLogsForPortalScope,
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
