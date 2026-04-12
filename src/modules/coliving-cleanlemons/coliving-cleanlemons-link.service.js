/**
 * Coliving Operator ↔ Cleanlemons Client link (client_integration + OAuth handoff + optional TTLock copy + property sync).
 */

const crypto = require('crypto');
const { randomUUID, createHash, createHmac, randomBytes } = crypto;
const pool = require('../../config/db');
const { getOperatorMasterTableName } = require('../../config/operatorMasterTable');
const {
  THIRD_PARTY_INTEGRATION_PLAN_IDS,
  isCleanlemonsPartnerCurrency,
} = require('../access/access.service');
const { requireCtx, upsertClientIntegration } = require('../companysetting/companysetting.service');
const clnInt = require('../cleanlemon/cleanlemon-integration.service');
const { resolveClnPropertyNavigationUrls, clnNavigationUrlsFromPlainAddress } = require('../cleanlemon/cln-property-address-split');

const KEY_SAAS = 'saasIntegration';
const PROVIDER_CLEANLEMONS = 'cleanlemons';

function getLinkSecret() {
  return (
    (process.env.COLIVING_CLEANLEMONS_LINK_SECRET || '').trim() ||
    (process.env.GOOGLE_DRIVE_OAUTH_STATE_SECRET || '').trim() ||
    (process.env.GOOGLE_DRIVE_OAUTH_TOKEN_SECRET || '').trim() ||
    (process.env.SESSION_SECRET || '').trim() ||
    ''
  );
}

function getCleanlemonsClientPortalColivingLinkUrl() {
  const base = (process.env.CLEANLEMON_PORTAL_CLIENT_BASE_URL || '').trim().replace(/\/+$/, '');
  if (base) return `${base}/portal/client/coliving-link`;
  return 'https://portal.cleanlemons.com/portal/client/coliving-link';
}

function getColivingOperatorPortalCompanyUrl() {
  const u = (process.env.COLIVING_OPERATOR_PORTAL_COMPANY_URL || '').trim();
  if (u) return u.replace(/\/+$/, '');
  return 'https://portal.colivingjb.com/operator/company';
}

function signColivingCleanlemonsState(payload) {
  const secret = getLinkSecret();
  if (!secret) throw new Error('COLIVING_CLEANLEMONS_LINK_SECRET_NOT_SET');
  const bodyB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', secret).update(bodyB64).digest('base64url');
  return `${bodyB64}.${sig}`;
}

function verifyColivingCleanlemonsState(s) {
  if (!s || typeof s !== 'string') return null;
  const i = s.lastIndexOf('.');
  if (i < 0) return null;
  const bodyB64 = s.slice(0, i);
  const sig = s.slice(i + 1);
  const secret = getLinkSecret();
  if (!secret) return null;
  const expected = createHmac('sha256', secret).update(bodyB64).digest('base64url');
  const sigBuf = Buffer.from(sig, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(bodyB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload?.nonce || !payload?.oid || !payload?.exp || payload.exp < Date.now()) return null;
  return payload;
}

function parseIntegrationValues(raw) {
  let v = raw;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v || '{}');
    } catch {
      v = {};
    }
  }
  return v && typeof v === 'object' ? v : {};
}

async function getCleanlemonsIntegrationRow(clientId) {
  const [rows] = await pool.query(
    `SELECT id, values_json, enabled FROM client_integration
     WHERE client_id = ? AND \`key\` = ? AND provider = ? AND enabled = 1 LIMIT 1`,
    [String(clientId), KEY_SAAS, PROVIDER_CLEANLEMONS]
  );
  return rows[0] || null;
}

async function resolveOperatorMainPlanIdForPartnerGate(clientId) {
  const cid = String(clientId || '').trim();
  if (!cid) return null;
  const [planRows] = await pool.query(
    `SELECT plan_id FROM client_pricingplan_detail WHERE client_id = ? AND type = 'plan' LIMIT 1`,
    [cid]
  );
  if (planRows?.[0]?.plan_id) return String(planRows[0].plan_id).trim();
  try {
    const opTable = await getOperatorMasterTableName();
    const [[row]] = await pool.query(
      `SELECT pricingplan_id FROM \`${opTable}\` WHERE id = ? LIMIT 1`,
      [cid]
    );
    if (row?.pricingplan_id) return String(row.pricingplan_id).trim();
  } catch (_) {
    /* optional column / table */
  }
  return null;
}

async function resolveOperatorCurrency(clientId) {
  const cid = String(clientId || '').trim();
  if (!cid) return null;
  try {
    const opTable = await getOperatorMasterTableName();
    const [[row]] = await pool.query(`SELECT currency FROM \`${opTable}\` WHERE id = ? LIMIT 1`, [cid]);
    return row?.currency != null ? String(row.currency).trim() : null;
  } catch (_) {
    return null;
  }
}

async function assertMyrOperatorForCleanlemons(clientId) {
  const currency = await resolveOperatorCurrency(clientId);
  if (!isCleanlemonsPartnerCurrency(currency)) {
    const e = new Error('CLEANLEMONS_MYR_OPERATORS_ONLY');
    e.code = 'CLEANLEMONS_MYR_OPERATORS_ONLY';
    throw e;
  }
}

async function assertCleanlemonsOfferedToOperator(clientId) {
  await assertMyrOperatorForCleanlemons(clientId);
}

/**
 * Coliving OAuth handoff: B2B row must exist. We do **not** require `cln_client_operator`:
 * portal login can create `cln_clientdetail` alone (no linked Cleanlemons operator / CRM junction).
 * `operatorId` from the client may equal `clientdetailId` (JWT quirk) or a real `cln_operatordetail.id` when linked later.
 */
async function assertCleanlemonsOAuthClientSubject(clientdetailId, operatorId) {
  const cid = String(clientdetailId || '').trim();
  const oid = String(operatorId || '').trim();
  if (!cid || !oid) {
    const e = new Error('MISSING_CLIENTDETAIL_OR_OPERATOR');
    e.code = 'MISSING_CLIENTDETAIL_OR_OPERATOR';
    throw e;
  }
  try {
    const [[cd]] = await pool.query('SELECT id FROM cln_clientdetail WHERE id = ? LIMIT 1', [cid]);
    if (!cd?.id) {
      const e = new Error('CLEANLEMONS_CLIENTDETAIL_NOT_FOUND');
      e.code = 'CLEANLEMONS_CLIENTDETAIL_NOT_FOUND';
      throw e;
    }
  } catch (err) {
    if (err?.code === 'CLEANLEMONS_CLIENTDETAIL_NOT_FOUND') throw err;
    const msg = String(err?.sqlMessage || err?.message || '');
    if (/doesn't exist/i.test(msg) || /Unknown table/i.test(msg)) {
      const e = new Error('CLN_CLIENTDETAIL_TABLE_MISSING');
      e.code = 'CLN_CLIENTDETAIL_TABLE_MISSING';
      throw e;
    }
    throw err;
  }
}

/**
 * Coliving operator starts link: create nonce row + signed state for Cleanlemons portal.
 */
async function startCleanlemonsLink(email, clientIdFromReq = null) {
  const { clientId } = await requireCtx(email, ['integration', 'admin'], clientIdFromReq);
  await assertCleanlemonsOfferedToOperator(clientId);
  const secret = getLinkSecret();
  if (!secret) throw new Error('COLIVING_CLEANLEMONS_LINK_SECRET_NOT_SET');

  const nonce = randomUUID();
  const exp = Date.now() + 15 * 60 * 1000;
  try {
    await pool.query(
      `INSERT INTO cleanlemons_coliving_oauth_state (nonce, operatordetail_id, expires_at)
       VALUES (?, ?, DATE_ADD(NOW(3), INTERVAL 15 MINUTE))`,
      [nonce, String(clientId)]
    );
  } catch (err) {
    const msg = String(err?.sqlMessage || err?.message || '');
    if (/doesn't exist/i.test(msg) || /Unknown table/i.test(msg)) {
      throw new Error('CLEANLEMONS_COLIVING_OAUTH_STATE_TABLE_MISSING_RUN_MIGRATION');
    }
    throw err;
  }

  const state = signColivingCleanlemonsState({ nonce, oid: String(clientId), exp });
  const base = getCleanlemonsClientPortalColivingLinkUrl();
  const oauthUrl = `${base}?state=${encodeURIComponent(state)}`;
  return { ok: true, oauthUrl, state, nonce };
}

/**
 * Called from Cleanlemons browser (no Coliving session). Verifies state + junction, writes pending client_integration.
 */
async function completeCleanlemonsOAuth({ state, cleanlemonsClientdetailId, cleanlemonsOperatorId }) {
  const payload = verifyColivingCleanlemonsState(String(state || '').trim());
  if (!payload) {
    const e = new Error('INVALID_OR_EXPIRED_STATE');
    e.code = 'INVALID_OR_EXPIRED_STATE';
    throw e;
  }

  const [[oauthRow]] = await pool.query(
    `SELECT nonce, operatordetail_id, used_at FROM cleanlemons_coliving_oauth_state
     WHERE nonce = ? LIMIT 1`,
    [payload.nonce]
  );
  if (!oauthRow || String(oauthRow.operatordetail_id) !== String(payload.oid)) {
    const e = new Error('OAUTH_NONCE_NOT_FOUND');
    e.code = 'OAUTH_NONCE_NOT_FOUND';
    throw e;
  }
  if (oauthRow.used_at) {
    const e = new Error('OAUTH_NONCE_ALREADY_USED');
    e.code = 'OAUTH_NONCE_ALREADY_USED';
    throw e;
  }

  await assertCleanlemonsOAuthClientSubject(cleanlemonsClientdetailId, cleanlemonsOperatorId);

  const colivingClientId = String(oauthRow.operatordetail_id);
  await assertCleanlemonsOfferedToOperator(colivingClientId);
  const nowIso = new Date().toISOString();
  await upsertClientIntegration(
    colivingClientId,
    KEY_SAAS,
    0,
    PROVIDER_CLEANLEMONS,
    {
      cleanlemons_clientdetail_id: String(cleanlemonsClientdetailId).trim(),
      cleanlemons_operator_id: String(cleanlemonsOperatorId).trim(),
      oauth_verified_at: nowIso,
      export_property_enabled: false,
      integrate_ttlock_enabled: false,
      confirmed_at: null
    },
    true,
    null
  );

  await pool.query(
    'UPDATE cleanlemons_coliving_oauth_state SET used_at = NOW(3) WHERE nonce = ?',
    [payload.nonce]
  );

  const redirectUrl = `${getColivingOperatorPortalCompanyUrl()}?cleanlemons_oauth=1`;
  return { ok: true, redirectUrl };
}

async function getCleanlemonsLinkStatus(email, clientIdFromReq = null) {
  const { clientId } = await requireCtx(email, ['integration', 'admin'], clientIdFromReq);
  const planId = await resolveOperatorMainPlanIdForPartnerGate(clientId);
  const planAllowsPartnerIntegration = !!(planId && THIRD_PARTY_INTEGRATION_PLAN_IDS.includes(planId));
  const operatorCurrency = await resolveOperatorCurrency(clientId);
  const cleanlemonsOffered = isCleanlemonsPartnerCurrency(operatorCurrency);
  const row = await getCleanlemonsIntegrationRow(clientId);
  if (!row) {
    return {
      ok: true,
      planAllowsPartnerIntegration,
      cleanlemonsOffered,
      linked: false,
      oauthVerified: false,
      confirmed: false,
      cleanlemonsClientdetailId: null,
      cleanlemonsOperatorId: null
    };
  }
  const v = parseIntegrationValues(row.values_json);
  return {
    ok: true,
    planAllowsPartnerIntegration,
    cleanlemonsOffered,
    linked: true,
    oauthVerified: !!v.oauth_verified_at,
    confirmed: !!v.confirmed_at,
    exportPropertyEnabled: !!v.export_property_enabled,
    integrateTtlockEnabled: !!v.integrate_ttlock_enabled,
    cleanlemonsClientdetailId: v.cleanlemons_clientdetail_id || null,
    cleanlemonsOperatorId: v.cleanlemons_operator_id || null,
    hasBridgeApiKey: !!v.coliving_bridge_api_key_sha256
  };
}

function roomDisplayLabel(roomRow) {
  const t = roomRow?.title_fld != null ? String(roomRow.title_fld).trim() : '';
  const n = roomRow?.roomname != null ? String(roomRow.roomname).trim() : '';
  const u = roomRow?.unitnumber != null ? String(roomRow.unitnumber).trim() : '';
  return t || n || u || 'Room';
}

/**
 * Coliving → Cleanlemons: rows are **B2B client–scoped** (`clientdetail_id` only).
 * `operator_id` is optional — property may be created by client or operator; who shares with whom is decided separately (client↔operator), not inferred here.
 */
async function upsertSyncedClnProperty({
  cleanlemonsClientdetailId,
  propertyName,
  address,
  unitName,
  colivingPropertydetailId,
  colivingRoomdetailId
}) {
  const [hasWazeCol, hasGoogleCol, hasColivingScope, hasColivingSource, hasClientIdCol] = await Promise.all([
    tableHasColumn('cln_property', 'waze_url'),
    tableHasColumn('cln_property', 'google_maps_url'),
    tableHasColumn('cln_property', 'coliving_scope'),
    tableHasColumn('cln_property', 'coliving_source_id'),
    tableHasColumn('cln_property', 'client_id'),
  ]);
  const colivingScopeVal = colivingRoomdetailId ? 'room' : 'entire';
  const colivingSourceVal = colivingRoomdetailId
    ? String(colivingRoomdetailId)
    : String(colivingPropertydetailId);
  let sel = 'id';
  if (hasWazeCol || hasGoogleCol) sel += ', address';
  if (hasWazeCol) sel += ', waze_url';
  if (hasGoogleCol) sel += ', google_maps_url';
  let existing;
  if (hasColivingScope && hasColivingSource) {
    ;[existing] = await pool.query(
      `SELECT ${sel} FROM cln_property
       WHERE coliving_source_id = ? AND coliving_scope = ?
       LIMIT 1`,
      [colivingSourceVal, colivingScopeVal]
    );
  } else {
    existing = [];
  }
  if (!existing || !existing.length) {
    ;[existing] = await pool.query(
      `SELECT ${sel} FROM cln_property
       WHERE coliving_propertydetail_id = ?
         AND (coliving_roomdetail_id <=> ?)
       LIMIT 1`,
      [String(colivingPropertydetailId), colivingRoomdetailId ? String(colivingRoomdetailId) : null]
    );
  }
  const addr = address != null ? String(address) : '';
  const un = unitName != null ? String(unitName).trim() : null;
  /** Bridge sync does not set `operator_id`; COALESCE on UPDATE keeps any later share assignment. */
  const opId = null;

  if (existing.length) {
    const nav = resolveClnPropertyNavigationUrls({
      nextAddressRaw: addr,
      prevAddress: hasWazeCol || hasGoogleCol ? String(existing[0].address ?? '') : '',
      prevWaze: hasWazeCol ? String(existing[0].waze_url ?? '') : '',
      prevGoogle: hasGoogleCol ? String(existing[0].google_maps_url ?? '') : '',
      explicitWaze: false,
      explicitGoogle: false,
    });
    const extraSet = [];
    const params = [propertyName, addr, un, String(cleanlemonsClientdetailId), opId];
    if (hasColivingScope && hasColivingSource) {
      extraSet.push('coliving_source_id = ?', 'coliving_scope = ?');
      params.push(colivingSourceVal, colivingScopeVal);
    }
    if (hasWazeCol) {
      extraSet.push('waze_url = ?');
      params.push(nav.wazeUrl);
    }
    if (hasGoogleCol) {
      extraSet.push('google_maps_url = ?');
      params.push(nav.googleMapsUrl);
    }
    params.push(existing[0].id);
    const extraSql = extraSet.length ? `${extraSet.join(', ')}, ` : '';
    await pool.query(
      `UPDATE cln_property SET
         property_name = ?, address = ?, unit_name = COALESCE(?, unit_name),
         clientdetail_id = ?,
         operator_id = COALESCE(?, operator_id),
         ${extraSql}updated_at = NOW(3)
       WHERE id = ?`,
      params
    );
    return existing[0].id;
  }
  const navIns = resolveClnPropertyNavigationUrls({
    nextAddressRaw: addr,
    prevAddress: '',
    prevWaze: '',
    prevGoogle: '',
    explicitWaze: false,
    explicitGoogle: false,
  });
  const id = randomUUID();
  const hasPdCols = await tableHasColumn('cln_property', 'coliving_propertydetail_id');
  const qn = (c) => `\`${c}\``;
  const insertCols = ['id', 'operator_id'];
  const insertVals = [id, opId];
  if (hasClientIdCol) {
    insertCols.push('client_id');
    insertVals.push(null);
  }
  insertCols.push('clientdetail_id', 'property_name', 'address', 'unit_name');
  insertVals.push(String(cleanlemonsClientdetailId), propertyName, addr, un);
  if (hasWazeCol) {
    insertCols.push('waze_url');
    insertVals.push(navIns.wazeUrl);
  }
  if (hasGoogleCol) {
    insertCols.push('google_maps_url');
    insertVals.push(navIns.googleMapsUrl);
  }
  if (hasColivingSource && hasColivingScope) {
    insertCols.push('coliving_source_id', 'coliving_scope');
    insertVals.push(colivingSourceVal, colivingScopeVal);
  }
  if (hasPdCols) {
    insertCols.push('coliving_propertydetail_id', 'coliving_roomdetail_id');
    insertVals.push(
      String(colivingPropertydetailId),
      colivingRoomdetailId ? String(colivingRoomdetailId) : null
    );
  }
  if (insertCols.length !== insertVals.length) {
    const e = new Error('CLN_PROPERTY_INSERT_INTERNAL_MISMATCH');
    e.code = 'CLN_PROPERTY_INSERT_INTERNAL_MISMATCH';
    throw e;
  }
  const ph = insertCols.map(() => '?').join(', ');
  await pool.query(
    `INSERT INTO cln_property (${insertCols.map(qn).join(', ')}, created_at, updated_at)
     VALUES (${ph}, NOW(3), NOW(3))`,
    insertVals
  );
  return id;
}

async function tableHasColumn(tableName, columnName) {
  const tn = String(tableName || '').trim();
  const cn = String(columnName || '').trim();
  if (!tn || !cn) return false;
  try {
    const [[row]] = await pool.query(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [tn, cn]
    );
    return Number(row?.n || 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Integration confirmed + export enabled → Cleanlemons `cln_clientdetail.id` for sync.
 */
async function getCleanlemonsExportContext(operatordetailId) {
  const oid = String(operatordetailId || '').trim();
  if (!oid) return null;
  const row = await getCleanlemonsIntegrationRow(oid);
  if (!row || !row.enabled) return null;
  const v = parseIntegrationValues(row.values_json);
  if (!v.confirmed_at || !v.cleanlemons_clientdetail_id) return null;
  if (v.export_property_enabled === false) return null;
  return { cleanlemonsClientdetailId: String(v.cleanlemons_clientdetail_id).trim() };
}

/**
 * Push propertydetail address / unit / premises_type / security_system to all linked `cln_property` rows.
 */
async function mirrorPropertydetailToClnRows(propertydetailId) {
  const pid = String(propertydetailId || '').trim();
  if (!pid) return;
  const hasPdPt = await tableHasColumn('propertydetail', 'premises_type');
  const hasPdSec = await tableHasColumn('propertydetail', 'security_system');
  const hasPdGeo =
    (await tableHasColumn('propertydetail', 'latitude')) &&
    (await tableHasColumn('propertydetail', 'longitude'));
  const hasPdMb = await tableHasColumn('propertydetail', 'mailbox_password');
  const hasPdSdp = await tableHasColumn('propertydetail', 'smartdoor_password');
  const hasPdSdt = await tableHasColumn('propertydetail', 'smartdoor_token_enabled');
  const sel = ['address', 'unitnumber'];
  if (hasPdPt) sel.push('premises_type');
  if (hasPdSec) sel.push('security_system');
  if (hasPdGeo) {
    sel.push('latitude', 'longitude');
  }
  if (hasPdMb) sel.push('mailbox_password');
  if (hasPdSdp) sel.push('smartdoor_password');
  if (hasPdSdt) sel.push('smartdoor_token_enabled');
  let pd;
  try {
    const [[row]] = await pool.query(
      `SELECT ${sel.map((c) => `\`${c}\``).join(', ')} FROM propertydetail WHERE id = ? LIMIT 1`,
      [pid]
    );
    pd = row;
  } catch (e) {
    const isUnknown = e.code === 'ER_BAD_FIELD_ERROR' || e.errno === 1054;
    if (!isUnknown) throw e;
    const [[row]] = await pool.query(
      'SELECT address, unitnumber FROM propertydetail WHERE id = ? LIMIT 1',
      [pid]
    );
    pd = row;
  }
  if (!pd) return;
  const addr = pd.address != null ? String(pd.address) : '';
  const un = pd.unitnumber != null ? String(pd.unitnumber).trim() : '';
  const sets = ['`address` = ?', '`unit_name` = ?'];
  const vals = [addr, un || null];
  if (hasPdPt && pd.premises_type !== undefined && (await tableHasColumn('cln_property', 'premises_type'))) {
    const pt =
      pd.premises_type != null && String(pd.premises_type).trim() !== ''
        ? String(pd.premises_type).trim().toLowerCase()
        : null;
    sets.push('`premises_type` = ?');
    vals.push(pt);
  }
  if (hasPdSec && pd.security_system !== undefined && (await tableHasColumn('cln_property', 'security_system'))) {
    const sec =
      pd.security_system != null && String(pd.security_system).trim() !== ''
        ? String(pd.security_system).trim()
        : null;
    sets.push('`security_system` = ?');
    vals.push(sec);
  }
  const [hasWazeMir, hasGoogleMir] = await Promise.all([
    tableHasColumn('cln_property', 'waze_url'),
    tableHasColumn('cln_property', 'google_maps_url'),
  ]);
  if (hasWazeMir || hasGoogleMir) {
    const nav = clnNavigationUrlsFromPlainAddress(addr);
    if (hasWazeMir) {
      sets.push('`waze_url` = ?');
      vals.push(nav.wazeUrl);
    }
    if (hasGoogleMir) {
      sets.push('`google_maps_url` = ?');
      vals.push(nav.googleMapsUrl);
    }
  }
  const hasClnGeo =
    (await tableHasColumn('cln_property', 'latitude')) &&
    (await tableHasColumn('cln_property', 'longitude'));
  if (hasPdGeo && hasClnGeo && pd.latitude !== undefined && pd.longitude !== undefined) {
    const laRaw = pd.latitude;
    const loRaw = pd.longitude;
    const la =
      laRaw != null && String(laRaw).trim() !== '' ? Number(laRaw) : null;
    const lo =
      loRaw != null && String(loRaw).trim() !== '' ? Number(loRaw) : null;
    if (la != null && lo != null && Number.isFinite(la) && Number.isFinite(lo)) {
      sets.push('`latitude` = ?', '`longitude` = ?');
      vals.push(la, lo);
    } else {
      sets.push('`latitude` = ?', '`longitude` = ?');
      vals.push(null, null);
    }
  }
  if (hasPdMb && pd.mailbox_password !== undefined && (await tableHasColumn('cln_property', 'mailbox_password'))) {
    const m =
      pd.mailbox_password != null && String(pd.mailbox_password).trim() !== ''
        ? String(pd.mailbox_password)
        : null;
    sets.push('`mailbox_password` = ?');
    vals.push(m);
  }
  if (hasPdSdp && pd.smartdoor_password !== undefined && (await tableHasColumn('cln_property', 'smartdoor_password'))) {
    const s =
      pd.smartdoor_password != null && String(pd.smartdoor_password).trim() !== ''
        ? String(pd.smartdoor_password)
        : null;
    sets.push('`smartdoor_password` = ?');
    vals.push(s);
  }
  if (hasPdSdt && pd.smartdoor_token_enabled !== undefined && (await tableHasColumn('cln_property', 'smartdoor_token_enabled'))) {
    sets.push('`smartdoor_token_enabled` = ?');
    vals.push(pd.smartdoor_token_enabled === 1 || pd.smartdoor_token_enabled === true ? 1 : 0);
  }
  sets.push('`updated_at` = NOW(3)');
  const hasScope = await tableHasColumn('cln_property', 'coliving_scope');
  const hasSrc = await tableHasColumn('cln_property', 'coliving_source_id');
  if (hasScope && hasSrc) {
    vals.push(pid, pid);
    await pool.query(
      `UPDATE cln_property SET ${sets.join(', ')} WHERE coliving_propertydetail_id = ? OR (coliving_source_id = ? AND coliving_scope = 'entire')`,
      vals
    );
  } else {
    vals.push(pid);
    await pool.query(`UPDATE cln_property SET ${sets.join(', ')} WHERE coliving_propertydetail_id = ?`, vals);
  }
}

/**
 * After Coliving property/room changes: upsert `cln_property` rows + mirror pd fields (when integration export is on).
 */
async function maybeSyncPropertydetailToCleanlemons(operatordetailId, propertydetailId) {
  const ctx = await getCleanlemonsExportContext(operatordetailId);
  if (!ctx) return;
  const pid = String(propertydetailId || '').trim();
  if (!pid) return;
  const hasClnPd = await tableHasColumn('cln_property', 'coliving_propertydetail_id');
  if (!hasClnPd) return;
  const [[p]] = await pool.query(
    `SELECT id, apartmentname, shortname, address, unitnumber, active, archived
     FROM propertydetail WHERE client_id = ? AND id = ? LIMIT 1`,
    [String(operatordetailId), pid]
  );
  if (!p) return;
  const activeOk = (p.active === 1 || p.active === true) && !(p.archived === 1 || p.archived === true);
  if (activeOk) {
    const baseName = String(p.apartmentname || p.shortname || 'Property').trim() || 'Property';
    const addr = p.address != null ? String(p.address) : '';
    const unit = p.unitnumber != null ? String(p.unitnumber).trim() : '';
    await upsertSyncedClnProperty({
      cleanlemonsClientdetailId: ctx.cleanlemonsClientdetailId,
      propertyName: `${baseName} (entire unit)`,
      address: addr,
      unitName: unit || null,
      colivingPropertydetailId: p.id,
      colivingRoomdetailId: null
    });
    const [rooms] = await pool.query(
      `SELECT id, title_fld, roomname FROM roomdetail
       WHERE property_id = ? AND active = 1`,
      [p.id]
    );
    for (const r of rooms || []) {
      const label = roomDisplayLabel(r);
      await upsertSyncedClnProperty({
        cleanlemonsClientdetailId: ctx.cleanlemonsClientdetailId,
        propertyName: `${baseName} (${label})`,
        address: addr,
        unitName: unit || null,
        colivingPropertydetailId: p.id,
        colivingRoomdetailId: r.id
      });
    }
  }
  await mirrorPropertydetailToClnRows(pid);
}

async function syncPropertiesToCleanlemons(operatordetailId, cleanlemonsClientdetailId) {
  const [props] = await pool.query(
    `SELECT id, apartmentname, shortname, address, unitnumber
     FROM propertydetail
     WHERE client_id = ?
       AND active = 1
       AND (archived IS NULL OR archived = 0)`,
    [String(operatordetailId)]
  );
  for (const p of props) {
    const baseName = String(p.apartmentname || p.shortname || 'Property').trim() || 'Property';
    const addr = p.address != null ? String(p.address) : '';
    const unit = p.unitnumber != null ? String(p.unitnumber).trim() : '';
    await upsertSyncedClnProperty({
      cleanlemonsClientdetailId,
      propertyName: `${baseName} (entire unit)`,
      address: addr,
      unitName: unit || null,
      colivingPropertydetailId: p.id,
      colivingRoomdetailId: null
    });
    const [rooms] = await pool.query(
      `SELECT id, title_fld, roomname FROM roomdetail
       WHERE property_id = ? AND active = 1`,
      [p.id]
    );
    for (const r of rooms) {
      const label = roomDisplayLabel(r);
      await upsertSyncedClnProperty({
        cleanlemonsClientdetailId,
        propertyName: `${baseName} (${label})`,
        address: addr,
        /* roomdetail has no unitnumber (only propertydetail does); reuse property-level unit */
        unitName: unit || null,
        colivingPropertydetailId: p.id,
        colivingRoomdetailId: r.id
      });
    }
  }
}

/**
 * Final step on Coliving: export properties is required; TTLock copy is optional and skipped if Coliving has no enabled TTLock credentials.
 */
async function confirmCleanlemonsLink(
  email,
  { exportPropertyToCleanlemons, integrateTtlock, replaceTtlockFromColiving } = {},
  clientIdFromReq = null
) {
  const ex = !!exportPropertyToCleanlemons;
  if (!ex) {
    const e = new Error('EXPORT_PROPERTY_REQUIRED');
    e.code = 'EXPORT_PROPERTY_REQUIRED';
    throw e;
  }

  const { clientId } = await requireCtx(email, ['integration', 'admin'], clientIdFromReq);
  const row = await getCleanlemonsIntegrationRow(clientId);
  if (!row) {
    const err = new Error('CLEANLEMONS_LINK_NOT_STARTED');
    err.code = 'CLEANLEMONS_LINK_NOT_STARTED';
    throw err;
  }
  const v0 = parseIntegrationValues(row.values_json);
  if (!v0.oauth_verified_at || !v0.cleanlemons_clientdetail_id || !v0.cleanlemons_operator_id) {
    const err = new Error('CLEANLEMONS_OAUTH_NOT_VERIFIED');
    err.code = 'CLEANLEMONS_OAUTH_NOT_VERIFIED';
    throw err;
  }

  if (v0.confirmed_at) {
    return {
      ok: true,
      alreadyConfirmed: true,
      confirmedAt: v0.confirmed_at,
      integrateTtlockApplied: !!v0.integrate_ttlock_enabled
    };
  }

  await assertCleanlemonsOfferedToOperator(clientId);

  const cleanlemonsClientdetailId = String(v0.cleanlemons_clientdetail_id).trim();

  let integrateTtlockApplied = false;
  if (integrateTtlock) {
    const st = await clnInt.getTtlockOnboardStatusClnClientdetail(cleanlemonsClientdetailId);
    if (st.ttlockConnected) {
      if (!replaceTtlockFromColiving) {
        return {
          ok: false,
          reason: 'TTLOCK_ALREADY_CONNECTED_ON_CLEANLEMONS',
          needsTtlockReplaceConfirm: true
        };
      }
      await clnInt.ttlockDisconnectClnClientdetail(cleanlemonsClientdetailId);
    }
    const [ttRows] = await pool.query(
      `SELECT values_json FROM client_integration
       WHERE client_id = ? AND \`key\` = 'smartDoor' AND provider = 'ttlock' AND enabled = 1 LIMIT 1`,
      [String(clientId)]
    );
    if (ttRows.length) {
      const tv = parseIntegrationValues(ttRows[0].values_json);
      const username = tv.ttlock_username != null ? String(tv.ttlock_username).trim() : '';
      const password = tv.ttlock_password != null ? String(tv.ttlock_password) : '';
      if (username && password) {
        await clnInt.ttlockConnectClnClientdetail(cleanlemonsClientdetailId, { username, password });
        integrateTtlockApplied = true;
      }
    }
  }

  if (exportPropertyToCleanlemons) {
    await syncPropertiesToCleanlemons(clientId, cleanlemonsClientdetailId);
  }

  const colivingOpId = String(clientId);
  const clnClientRowId = String(cleanlemonsClientdetailId);
  await pool.query(
    `UPDATE lockdetail SET cln_clientid = ? WHERE client_id = ?`,
    [clnClientRowId, colivingOpId]
  );
  await pool.query(
    `UPDATE gatewaydetail SET cln_clientid = ? WHERE client_id = ?`,
    [clnClientRowId, colivingOpId]
  );

  const apiKey = randomBytes(32).toString('base64url');
  const apiKeySha256 = createHash('sha256').update(apiKey).digest('hex');
  await clnInt.upsertColivingBridgeApiKeyClnClientdetail(cleanlemonsClientdetailId, apiKey);

  const nowIso = new Date().toISOString();
  await upsertClientIntegration(clientId, KEY_SAAS, 0, PROVIDER_CLEANLEMONS, {
    ...v0,
    export_property_enabled: true,
    integrate_ttlock_enabled: integrateTtlockApplied,
    confirmed_at: nowIso,
    coliving_bridge_api_key_sha256: apiKeySha256
  }, true, null);

  return { ok: true, confirmedAt: nowIso, integrateTtlockApplied };
}

/**
 * Coliving operator removes Cleanlemons link: disable bridge key on Cleanlemons B2B client, clear junction columns, wipe integration row.
 */
async function disconnectCleanlemonsLink(email, clientIdFromReq = null) {
  const { clientId } = await requireCtx(email, ['integration', 'admin'], clientIdFromReq);
  const [rows] = await pool.query(
    `SELECT values_json, enabled FROM client_integration
     WHERE client_id = ? AND \`key\` = ? AND provider = ? LIMIT 1`,
    [String(clientId), KEY_SAAS, PROVIDER_CLEANLEMONS]
  );
  const row = rows[0];
  if (!row || Number(row.enabled) !== 1) {
    return { ok: true, alreadyDisconnected: true };
  }
  const v = parseIntegrationValues(row.values_json);
  const cleanlemonsClientdetailId =
    v.cleanlemons_clientdetail_id != null ? String(v.cleanlemons_clientdetail_id).trim() : '';
  if (cleanlemonsClientdetailId) {
    await clnInt.disconnectColivingBridgeClnClientdetail(cleanlemonsClientdetailId);
  }
  const colivingOpId = String(clientId);
  await pool.query('UPDATE lockdetail SET cln_clientid = NULL WHERE client_id = ?', [colivingOpId]);
  await pool.query('UPDATE gatewaydetail SET cln_clientid = NULL WHERE client_id = ?', [colivingOpId]);
  await pool.query(
    `UPDATE client_integration SET enabled = 0, values_json = '{}', updated_at = NOW()
     WHERE client_id = ? AND \`key\` = ? AND provider = ?`,
    [String(clientId), KEY_SAAS, PROVIDER_CLEANLEMONS]
  );
  return { ok: true };
}

module.exports = {
  startCleanlemonsLink,
  completeCleanlemonsOAuth,
  getCleanlemonsLinkStatus,
  confirmCleanlemonsLink,
  disconnectCleanlemonsLink,
  /** Coliving operatordetail.id + Cleanlemons cln_clientdetail.id — upserts unit + per-room `cln_property` rows. */
  syncPropertiesToCleanlemons,
  maybeSyncPropertydetailToCleanlemons,
  mirrorPropertydetailToClnRows,
  KEY_SAAS,
  PROVIDER_CLEANLEMONS
};
