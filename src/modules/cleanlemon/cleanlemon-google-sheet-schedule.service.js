/**
 * Google Apps Script → ECS：对齐 Wix `post_scheduleInsert` 的语义，写入 `cln_schedule`。
 *
 * 鉴权：仅 HTTP 头 — `Authorization: Bearer <B2B api_key>` 或 `x-api-key`（与 `cln_client_integration` 一致）。
 * 不要把密钥放在 body 的 `source` 里；`submit_by` 在服务端固定为 GoogleSheet。
 *
 * Body：
 * - property: Listing UUID → 匹配 `homestay_source_id` 或 `source_id`（与 L 列一致）
 * - reservationId: 可选。有值：`reservation_id` + `property_id` 命中则 update。无值：同一 `property_id`
 *   且吉隆坡同一日历日、且 `reservation_id` 为空的历史行 → update（避免无订单号重复建）
 * - workingDay: 必填 — 推荐 `yyyy-MM-dd'T'00:00:00.000'+08:00'`（吉隆坡日历日 00:00）；Node 解析为 UTC 瞬时写入 MySQL（+00）；Portal 按 +8 显示
 * - date: 可选 — 仅写入 `date_display`；新 GScript 可不传
 *
 * 业务约定（Antlerzone Sheet）：Homestay Cleaning、无 addon、无 remark、btob=false、不做 client 提前预订校验。
 * 运营商 / 客户上下文：`Authorization` / `x-api-key` 匹配 `cln_client_integration`（B2B api_key）→ `operator_id`。
 */

const crypto = require('crypto');
const { randomUUID } = crypto;
const pool = require('../../config/db');
const { parseDateParts } = require('../../utils/dateMalaysia');
const {
  resolveSyncContextFromApiKey,
  resolveSyncContextFromEnv
} = require('./cleanlemon-antlerzone-sync.service');

function tokenForSyncAuth(req) {
  const a = String(req.headers.authorization || '');
  const m = /^Bearer\s+(\S+)/i.exec(a);
  if (m) return m[1].trim();
  const xk =
    req.headers['x-api-key'] ||
    req.headers['X-Api-Key'] ||
    req.headers['x-apikey'] ||
    '';
  if (xk) return String(xk).trim();
  return String(req.headers['x-sync-secret'] || '').trim();
}

function parseWorkingDayMysql(d) {
  if (d == null || d === '') return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

/**
 * @param {import('express').Request} req
 */
function reqWithNormalizedBearer(req) {
  const token = tokenForSyncAuth(req);
  const headers = { ...(req.headers || {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  return { headers };
}

async function handleGoogleSheetSchedule(req) {
  const reqNorm = reqWithNormalizedBearer(req);
  let ctx = await resolveSyncContextFromApiKey(reqNorm);

  if (ctx && ctx.error) {
    const err = new Error(ctx.error);
    err.code = 'SERVER_MISCONFIGURED';
    throw err;
  }
  if (!ctx) {
    ctx = resolveSyncContextFromEnv(reqNorm);
  }
  if (!ctx || !ctx.operatorId) {
    const err = new Error('Unauthorized');
    err.code = 'UNAUTHORIZED';
    throw err;
  }

  const body = req.body || {};
  const sourceId = String(body.property ?? body.propertyId ?? '').trim();
  const reservationId =
    body.reservationId != null && String(body.reservationId).trim() !== ''
      ? String(body.reservationId).trim()
      : null;
  const workingDayRaw = body.workingDay;
  const dateDisplay = body.date != null ? String(body.date).trim() : '';

  if (!sourceId) {
    const err = new Error('Missing property (source_id)');
    err.code = 'BAD_REQUEST';
    throw err;
  }

  const workingDay = parseWorkingDayMysql(workingDayRaw);
  if (!workingDay) {
    const err = new Error('Invalid or missing workingDay');
    err.code = 'BAD_REQUEST';
    throw err;
  }

  const operatorId = String(ctx.operatorId);

  const [[hasHs]] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cln_property' AND COLUMN_NAME = 'homestay_source_id'`
  );
  const useHomestayCol = Number(hasHs?.n || 0) > 0;

  const [[prop]] = useHomestayCol
    ? await pool.query(
        `SELECT id, team, score, cleaning_fees
         FROM cln_property
         WHERE operator_id = ? AND (homestay_source_id = ? OR source_id = ?)
         LIMIT 1`,
        [operatorId, sourceId, sourceId]
      )
    : await pool.query(
        `SELECT id, team, score, cleaning_fees
         FROM cln_property
         WHERE source_id = ? AND operator_id = ?
         LIMIT 1`,
        [sourceId, operatorId]
      );

  if (!prop) {
    const err = new Error('Property not found for source_id and operator');
    err.code = 'BAD_REQUEST';
    throw err;
  }

  const propertyId = String(prop.id);
  const team = prop.team != null && String(prop.team).trim() !== '' ? String(prop.team).trim() : 'Unassigned';
  const point = prop.score != null && Number.isFinite(Number(prop.score)) ? Math.floor(Number(prop.score)) : 0;
  const price =
    prop.cleaning_fees != null && String(prop.cleaning_fees).trim() !== ''
      ? Math.round(Number(prop.cleaning_fees) * 100) / 100
      : 0;

  const status = 'Pending Check Out';
  const cleaningType = 'Homestay Cleaning';
  const submitBy = 'GoogleSheet';

  const parts = parseDateParts(workingDay);
  const klYmd =
    parts != null
      ? `${parts.y}-${String(parts.m).padStart(2, '0')}-${String(parts.d).padStart(2, '0')}`
      : null;

  let existingId = null;
  if (reservationId) {
    const [found] = await pool.query(
      'SELECT id FROM cln_schedule WHERE reservation_id = ? AND property_id = ? LIMIT 1',
      [reservationId, propertyId]
    );
    if (found && found.length) existingId = found[0].id;
  }
  if (!existingId && !reservationId && klYmd) {
    const [found2] = await pool.query(
      `SELECT id FROM cln_schedule
       WHERE property_id = ?
         AND (reservation_id IS NULL OR TRIM(reservation_id) = '')
         AND DATE(CONVERT_TZ(working_day, '+00:00', 'Asia/Kuala_Lumpur')) = ?
       LIMIT 1`,
      [propertyId, klYmd]
    );
    if (found2 && found2.length) existingId = found2[0].id;
  }

  const wdSql = workingDay;

  if (existingId) {
    await pool.query(
      `UPDATE cln_schedule SET
         working_day = ?,
         date_display = ?,
         status = ?,
         cleaning_type = ?,
         submit_by = ?,
         team = ?,
         point = ?,
         price = ?,
         btob = 0,
         updated_at = NOW(3)
       WHERE id = ?`,
      [wdSql, dateDisplay || null, status, cleaningType, submitBy, team, point, price, existingId]
    );
    return {
      ok: true,
      action: 'updated',
      id: existingId,
      propertyId,
      authSource: ctx.source
    };
  }

  const id = randomUUID();
  await pool.query(
    `INSERT INTO cln_schedule (
       id, property_id, working_day, date_display, status, cleaning_type, submit_by,
       team, point, price, btob, reservation_id, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
    [
      id,
      propertyId,
      wdSql,
      dateDisplay || null,
      status,
      cleaningType,
      submitBy,
      team,
      point,
      price,
      0,
      reservationId
    ]
  );

  return {
    ok: true,
    action: 'inserted',
    id,
    propertyId,
    authSource: ctx.source
  };
}

module.exports = {
  handleGoogleSheetSchedule,
  tokenForSyncAuth
};
