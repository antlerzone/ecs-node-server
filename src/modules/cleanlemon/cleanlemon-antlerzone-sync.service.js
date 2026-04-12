/**
 * Antlerzone → Cleanlemons: upsert `cln_property` (MySQL).
 *
 * **首选鉴权：** `Authorization: Bearer <api_key>` 与 `cln_client_integration`
 *（`thirdPartyIntegration` / `static_token` → `values_json.api_key`）做常量时间比对，
 * 再经 `cln_client_operator` 解析 `operator_id`。这样 **不必** 在 ECS `.env` 写死 operator/client。
 *
 * **兼容：** 若 DB 未命中且设置了 `ANTLERZONE_CLEANLEMONS_SYNC_SECRET` + `ANTLERZONE_CLEANLEMONS_OPERATOR_ID`，
 * 仍可按旧逻辑用环境变量（单租户迁移用）。
 */

const crypto = require('crypto');
const { randomUUID } = crypto;
const pool = require('../../config/db');

const KEY_THIRD_PARTY_INTEGRATION = 'thirdPartyIntegration';
const PROVIDER_STATIC_TOKEN = 'static_token';

function timingSafeEqualStr(a, b) {
  const x = Buffer.from(String(a), 'utf8');
  const y = Buffer.from(String(b), 'utf8');
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

function verifySyncSecret(req) {
  const expected = String(process.env.ANTLERZONE_CLEANLEMONS_SYNC_SECRET || '').trim();
  if (!expected) return false;
  const auth = String(req.headers.authorization || '');
  const m = /^Bearer\s+(\S+)/i.exec(auth);
  const fromBearer = m ? m[1].trim() : '';
  const fromHeader = String(req.headers['x-sync-secret'] || '').trim();
  const got = fromBearer || fromHeader;
  if (!got) return false;
  return timingSafeEqualStr(got, expected);
}

/**
 * Bearer = Cleanlemons B2B client「集成 API Key」（存于 `cln_client_integration.values_json.api_key`）。
 * @returns {Promise<{ clientdetailId: string, operatorId: string, source: string } | null | { error: string, clientdetailId?: string }>}
 */
async function resolveSyncContextFromApiKey(req) {
  const auth = String(req.headers.authorization || '');
  const m = /^Bearer\s+(\S+)/i.exec(auth);
  const fromBearer = m ? m[1].trim() : '';
  const fromXApiKey = String(
    req.headers['x-api-key'] || req.headers['X-Api-Key'] || ''
  ).trim();
  const fromHeader = String(req.headers['x-sync-secret'] || '').trim();
  const token = fromBearer || fromXApiKey || fromHeader;
  if (!token) return null;

  const [rows] = await pool.query(
    `SELECT clientdetail_id, values_json FROM cln_client_integration
     WHERE \`key\` = ? AND provider = ? AND enabled = 1`,
    [KEY_THIRD_PARTY_INTEGRATION, PROVIDER_STATIC_TOKEN]
  );

  for (const r of rows || []) {
    let v = r.values_json;
    if (typeof v === 'string') {
      try {
        v = JSON.parse(v || '{}');
      } catch {
        continue;
      }
    } else v = v || {};
    const apiKey = v.api_key != null ? String(v.api_key).trim() : '';
    if (!apiKey || !timingSafeEqualStr(apiKey, token)) continue;

    const clientdetailId = String(r.clientdetail_id || '').trim();
    if (!clientdetailId) continue;

    const [opRows] = await pool.query(
      `SELECT operator_id FROM cln_client_operator WHERE clientdetail_id = ? ORDER BY created_at ASC LIMIT 1`,
      [clientdetailId]
    );
    if (!opRows || !opRows.length) {
      return { error: 'NO_OPERATOR_FOR_CLIENTDETAIL', clientdetailId };
    }
    const operatorId = String(opRows[0].operator_id).trim();
    return { clientdetailId, operatorId, source: 'db_api_key' };
  }

  return null;
}

/** 旧版：整站一个 env secret + env operator / client */
function resolveSyncContextFromEnv(req) {
  if (!verifySyncSecret(req)) return null;
  const operatorId = String(process.env.ANTLERZONE_CLEANLEMONS_OPERATOR_ID || '').trim();
  if (!operatorId) return null;
  const clientdetailId =
    String(process.env.ANTLERZONE_CLN_CLIENTDETAIL_ID || process.env.ANTLERZONE_CLN_CLIENT_ID || '').trim() ||
    null;
  const clientId = String(process.env.ANTLERZONE_CLN_CLIENT_ID || '').trim() || null;
  return { operatorId, clientdetailId, clientId, source: 'env_legacy' };
}

function parseIntOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

function parseDecimalOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function boolToTiny(v) {
  if (v === undefined || v === null) return 1;
  if (v === true || v === 1 || v === '1') return 1;
  if (v === false || v === 0 || v === '0') return 0;
  return 1;
}

function normalizeCcJson(cc) {
  if (cc === undefined || cc === null) return null;
  if (typeof cc === 'string') {
    try {
      JSON.parse(cc);
      return cc;
    } catch {
      return null;
    }
  }
  try {
    return JSON.stringify(cc);
  } catch {
    return null;
  }
}

async function loadClnPropertyColumnSet() {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cln_property'`
  );
  return new Set((rows || []).map((r) => String(r.c || '').toLowerCase()).filter(Boolean));
}

/**
 * Map request body (camelCase from Velo / Wix) → cln_property row fragment.
 */
function mapBodyToRow(body) {
  const b = body && typeof body === 'object' ? body : {};
  const sourceId =
    b.sourceId != null && String(b.sourceId).trim() !== ''
      ? String(b.sourceId).trim()
      : b.source_id != null && String(b.source_id).trim() !== ''
        ? String(b.source_id).trim()
        : '';

  const homestaySourceRaw =
    b.homestaySourceId != null && String(b.homestaySourceId).trim() !== ''
      ? String(b.homestaySourceId).trim()
      : b.homestay_source_id != null && String(b.homestay_source_id).trim() !== ''
        ? String(b.homestay_source_id).trim()
        : sourceId || null;

  const row = {
    property_name: b.propertyName != null ? String(b.propertyName) : b.property_name,
    unit_name: b.unitName != null ? String(b.unitName) : b.unit_name,
    address: b.address != null ? String(b.address) : b.address,
    contact: b.contact != null ? String(b.contact) : b.contact,
    mailbox_password: b.mailboxPassword != null ? String(b.mailboxPassword) : b.mailbox_password,
    bed_count: parseIntOrNull(b.bedCount ?? b.bed_count),
    room_count: parseIntOrNull(b.roomCount ?? b.room_count),
    bathroom_count: parseIntOrNull(b.bathroomCount ?? b.bathroom_count),
    kitchen: parseIntOrNull(b.kitchen),
    living_room: parseIntOrNull(b.livingRoom ?? b.living_room),
    balcony: parseIntOrNull(b.balcony),
    staircase: parseIntOrNull(b.staircase),
    lift_level:
      b.liftLevel != null && String(b.liftLevel).trim() !== ''
        ? String(b.liftLevel).trim().slice(0, 8)
        : b.lift_level != null && String(b.lift_level).trim() !== ''
          ? String(b.lift_level).trim().slice(0, 8)
          : null,
    special_area_count: parseIntOrNull(b.specialAreaCount ?? b.special_area_count),
    cleaning_fees: parseDecimalOrNull(b.cleaningfees ?? b.cleaning_fees),
    source_id: sourceId || null,
    homestay_source_id: homestaySourceRaw,
    is_from_a: boolToTiny(b.isFromA ?? b.is_from_a),
    cc_json: normalizeCcJson(b.cc ?? b.cc_json)
  };

  Object.keys(row).forEach((k) => {
    if (row[k] === undefined) delete row[k];
  });

  return { sourceId, row };
}

async function upsertAntlerzoneProperty(body, ctx) {
  const operatorId = String(ctx.operatorId || '').trim();
  if (!operatorId) {
    const err = new Error('SERVER_MISCONFIGURED');
    err.code = 'NO_OPERATOR_ID';
    throw err;
  }

  const clientdetailId = ctx.clientdetailId != null ? String(ctx.clientdetailId).trim() : null;
  const legacyClientId = ctx.clientId != null ? String(ctx.clientId).trim() : null;

  const { sourceId, row } = mapBodyToRow(body);
  if (!sourceId) {
    const err = new Error('Missing sourceId');
    err.code = 'BAD_REQUEST';
    throw err;
  }

  const cols = await loadClnPropertyColumnSet();
  if (!cols.has('id')) {
    const err = new Error('cln_property table missing');
    err.code = 'DB_ERROR';
    throw err;
  }

  if (!cols.has('operator_id')) {
    const err = new Error('cln_property.operator_id required for sync');
    err.code = 'MIGRATION_REQUIRED';
    throw err;
  }

  let existingId = null;
  const hid = homestaySourceRaw || sourceId;
  if (cols.has('homestay_source_id')) {
    const [found] = await pool.query(
      `SELECT id FROM cln_property
       WHERE operator_id = ? AND (homestay_source_id = ? OR source_id = ?)
       LIMIT 1`,
      [operatorId, hid, sourceId]
    );
    if (found && found.length) existingId = found[0].id;
  } else {
    const [found] = await pool.query(
      'SELECT id FROM cln_property WHERE source_id = ? AND operator_id = ? LIMIT 1',
      [sourceId, operatorId]
    );
    if (found && found.length) existingId = found[0].id;
  }

  const merged = { ...row, source_id: sourceId, operator_id: operatorId };
  if (cols.has('homestay_source_id') && hid) merged.homestay_source_id = hid;
  if (clientdetailId && cols.has('clientdetail_id')) merged.clientdetail_id = clientdetailId;
  if (legacyClientId && cols.has('client_id')) merged.client_id = legacyClientId;

  const allowedKeys = [
    'property_name',
    'unit_name',
    'address',
    'contact',
    'mailbox_password',
    'bed_count',
    'room_count',
    'bathroom_count',
    'kitchen',
    'living_room',
    'balcony',
    'staircase',
    'lift_level',
    'special_area_count',
    'cleaning_fees',
    'source_id',
    'homestay_source_id',
    'is_from_a',
    'cc_json',
    'operator_id',
    'client_id',
    'clientdetail_id'
  ];

  const data = {};
  for (const k of allowedKeys) {
    if (!cols.has(k)) continue;
    if (Object.prototype.hasOwnProperty.call(merged, k) && merged[k] !== undefined) {
      data[k] = merged[k];
    }
  }

  if (existingId) {
    const sets = [];
    const vals = [];
    for (const k of Object.keys(data)) {
      sets.push(`\`${k}\` = ?`);
      vals.push(data[k]);
    }
    if (cols.has('updated_at')) {
      sets.push('`updated_at` = NOW(3)');
    }
    vals.push(existingId);
    await pool.query(`UPDATE cln_property SET ${sets.join(', ')} WHERE id = ?`, vals);
    return { ok: true, id: existingId, action: 'updated', authSource: ctx.source };
  }

  const id = randomUUID();
  const insertKeys = ['id', ...Object.keys(data)];
  const insertVals = [id, ...Object.values(data)];
  if (cols.has('created_at') && !insertKeys.includes('created_at')) {
    insertKeys.push('created_at');
    insertVals.push(new Date());
  }
  if (cols.has('updated_at') && !insertKeys.includes('updated_at')) {
    insertKeys.push('updated_at');
    insertVals.push(new Date());
  }

  const placeholders = insertKeys.map(() => '?').join(', ');
  const colSql = insertKeys.map((k) => `\`${k}\``).join(', ');
  await pool.query(`INSERT INTO cln_property (${colSql}) VALUES (${placeholders})`, insertVals);

  return { ok: true, id, action: 'inserted', authSource: ctx.source };
}

async function handleAntlerzonePropertySync(req) {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    const err = new Error('Invalid JSON body');
    err.code = 'BAD_REQUEST';
    throw err;
  }

  let ctx = await resolveSyncContextFromApiKey(req);

  if (ctx && ctx.error) {
    const err = new Error(ctx.error);
    err.code = 'SERVER_MISCONFIGURED';
    throw err;
  }

  if (!ctx) {
    ctx = resolveSyncContextFromEnv(req);
  }

  if (!ctx || !ctx.operatorId) {
    const err = new Error('Unauthorized');
    err.code = 'UNAUTHORIZED';
    throw err;
  }

  const bodyCid = String(body.cleanlemonsClientdetailId || body.clientdetailId || '').trim();
  if (bodyCid && ctx.clientdetailId) {
    const a = bodyCid;
    const b = String(ctx.clientdetailId);
    const mismatch =
      a.length !== b.length ? true : !timingSafeEqualStr(a, b);
    if (mismatch) {
      const err = new Error('clientdetailId mismatch');
      err.code = 'UNAUTHORIZED';
      throw err;
    }
  }

  return upsertAntlerzoneProperty(body, ctx);
}

module.exports = {
  verifySyncSecret,
  resolveSyncContextFromApiKey,
  resolveSyncContextFromEnv,
  handleAntlerzonePropertySync,
  upsertAntlerzoneProperty
};
