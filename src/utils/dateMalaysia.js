/**
 * Malaysia (UTC+8) date service.
 * Rule: 写入 Table 一律 UTC+0；读取 / 给 account system / invoice 一律按 UTC+8 显示，避免 3 号变成 2 号。
 * 其他需一致的业务日期（如 payment_date、bills.period）也可用本 module 做写入转 UTC、读出转 MY。
 */

const MY_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * Parse input to calendar date parts (Malaysia: YYYY-MM-DD).
 * @param {string|Date} v - 'YYYY-MM-DD' or Date (UTC moment)
 * @returns {{ y: number, m: number, d: number } | null}
 */
function parseDateParts(v) {
  if (!v) return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    const [y, m, d] = v.substring(0, 10).split('-').map(Number);
    if (y >= 1970 && m >= 1 && m <= 12 && d >= 1 && d <= 31) return { y, m, d };
    return null;
  }
  try {
    const d = v instanceof Date ? v : new Date(v);
    if (isNaN(d.getTime())) return null;
    const utcMs = d.getTime() + MY_OFFSET_MS;
    const my = new Date(utcMs);
    return {
      y: my.getUTCFullYear(),
      m: my.getUTCMonth() + 1,
      d: my.getUTCDate()
    };
  } catch (e) {
    return null;
  }
}

/**
 * 马来西亚日期 → 存表用 UTC datetime 字符串 'YYYY-MM-DD HH:mm:ss'。
 * 例如 3 号 00:00 马来西亚 → 存 2 号 16:00 UTC，读出来再转回 3 号。
 */
function malaysiaDateToUtcDatetimeForDb(malaysiaDateOrYYYYMMDD) {
  const p = parseDateParts(malaysiaDateOrYYYYMMDD);
  if (!p) return null;
  const utcMs = Date.UTC(p.y, p.m - 1, p.d, 0, 0, 0, 0) - MY_OFFSET_MS;
  const d = new Date(utcMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  const s = String(d.getUTCSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}:${s}`;
}

/**
 * 表里读出的 UTC datetime → 马来西亚日期（供 API / 显示 / account system / invoice 用）。
 * 返回 'YYYY-MM-DD'，保证 3 号不会变成 2 号。
 */
function utcDatetimeFromDbToMalaysiaDateOnly(utcStrOrDate) {
  if (utcStrOrDate == null) return null;
  const d = typeof utcStrOrDate === 'string' ? new Date(utcStrOrDate.replace(' ', 'T') + 'Z') : new Date(utcStrOrDate);
  if (isNaN(d.getTime())) return null;
  const myMs = d.getTime() + MY_OFFSET_MS;
  return new Date(myMs).toISOString().substring(0, 10);
}

/**
 * 表里读出的 UTC datetime → 马来西亚的 Date 对象（用于需要 Date 的 API 或导出）。
 */
function utcDatetimeFromDbToMalaysiaDate(utcStrOrDate) {
  if (utcStrOrDate == null) return null;
  const d = typeof utcStrOrDate === 'string' ? new Date(utcStrOrDate.replace(' ', 'T') + 'Z') : new Date(utcStrOrDate);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getTime() + MY_OFFSET_MS);
}

/**
 * 当前「马来西亚/新加坡日历日」YYYY-MM-DD（UTC+8）。
 * 用于业务上「今天」的判定（如每日 tenancy 检查、租金 due date 比较），与 DB 存的 DATE 列语义一致。
 */
function getTodayMalaysiaDate() {
  const myMs = Date.now() + MY_OFFSET_MS;
  return new Date(myMs).toISOString().substring(0, 10);
}

/**
 * 当前 MY 日历日 + N 天的 YYYY-MM-DD（UTC+8）。用于「60 天内到期」等比较。
 */
function getTodayPlusDaysMalaysia(days) {
  const today = getTodayMalaysiaDate();
  const d = new Date(today + 'T12:00:00+08:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().substring(0, 10);
}

/**
 * Malaysia calendar: first day of the current month `YYYY-MM-01` (from "today" in MY).
 */
function getMalaysiaMonthStartYmd() {
  const today = getTodayMalaysiaDate();
  const [y, m] = today.split('-').map(Number);
  return `${y}-${String(m).padStart(2, '0')}-01`;
}

/**
 * Malaysia calendar: `YYYY-MM-01` for the month that is `monthsAgo` months before the **start**
 * of the current MY month (e.g. `11` → first day of the month 11 months back → 12‑month window).
 */
function getMalaysiaMonthStartMonthsAgo(monthsAgo) {
  const n = Math.max(0, Math.floor(Number(monthsAgo) || 0));
  const startThis = getMalaysiaMonthStartYmd();
  const d = new Date(startThis + 'T12:00:00+08:00');
  d.setMonth(d.getMonth() - n);
  const y = d.getFullYear();
  const mo = d.getMonth() + 1;
  return `${y}-${String(mo).padStart(2, '0')}-01`;
}

/**
 * Calendar YYYY-MM-DD in Asia/Singapore (UTC+8) for an instant.
 * Use when building rentalcollection.date → createInvoicesForRentalRecords / Bukku so invoice date matches business day.
 */
function toSingaporeCalendarYmd(instant) {
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) return getTodayMalaysiaDate();
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Singapore',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(d);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;
    if (y && m && day) return `${y}-${m}-${day}`;
  } catch (_) {
    /* ignore */
  }
  const myMs = d.getTime() + MY_OFFSET_MS;
  return new Date(myMs).toISOString().substring(0, 10);
}

/** API 返回中常见的日期/时间字段名，读出表后一律按 UTC+8 转成 YYYY-MM-DD 再给前端 */
const DEFAULT_DATE_KEYS = [
  'created_at', 'updated_at', '_createdDate', 'period', 'date', 'startDate', 'endDate',
  'paidat', 'paidDate', 'begin', 'end', 'owner_signed_at', 'tenant_signed_at', 'ownerSignedAt', 'tenantSignedAt',
  'payment_date', 'paymentDate', 'generated_at', 'paid_at', 'lastsyncat', 'ttlock_passcode_expired_at'
];

/**
 * 把对象或数组里出现的日期字段转成 UTC+8 的 YYYY-MM-DD（供前端/datepicker 一致）。
 * 会递归处理 items、list、record、agreement 等常见结构；只处理 DEFAULT_DATE_KEYS 中的 key。
 * @param {object|array} obj - 要格式化的 payload（会被原地修改）
 * @param {string[]} [dateKeys] - 视为日期字段的 key，默认 DEFAULT_DATE_KEYS
 * @returns {object|array} - 同一引用，便于 res.json(formatApiResponseDates(data))
 */
function formatApiResponseDates(obj, dateKeys = DEFAULT_DATE_KEYS) {
  if (obj == null) return obj;
  const keys = new Set(dateKeys);

  function formatVal(v) {
    if (v == null || v === '') return v;
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return v;
    const s = utcDatetimeFromDbToMalaysiaDateOnly(v);
    return s != null ? s : v;
  }

  function walk(o) {
    if (Array.isArray(o)) {
      o.forEach(walk);
      return;
    }
    if (o && typeof o === 'object' && !(o instanceof Date)) {
      for (const key of Object.keys(o)) {
        if (keys.has(key) && o[key] != null && o[key] !== '') {
          o[key] = formatVal(o[key]);
        } else {
          walk(o[key]);
        }
      }
    }
  }

  walk(obj);
  return obj;
}

/**
 * 查询用：前端传的马来西亚日期范围 (from/to YYYY-MM-DD) → UTC 的起止时间，用于 WHERE o.period >= ? AND o.period <= ?
 */
function malaysiaDateRangeToUtcForQuery(fromYYYYMMDD, toYYYYMMDD) {
  const fromUtc = fromYYYYMMDD ? malaysiaDateToUtcDatetimeForDb(fromYYYYMMDD) : null;
  if (!toYYYYMMDD) return { fromUtc, toUtc: null };
  const p = parseDateParts(toYYYYMMDD);
  if (!p) return { fromUtc, toUtc: null };
  const endOfDayMy = Date.UTC(p.y, p.m - 1, p.d, 23, 59, 59, 999) - MY_OFFSET_MS;
  const d = new Date(endOfDayMy);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const toUtc = `${y}-${m}-${day} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`;
  return { fromUtc, toUtc };
}

/**
 * Malaysia wall-clock calendar date + HH:mm (no DST) → UTC `YYYY-MM-DD HH:mm:ss.000` for MySQL DATETIME(3).
 * Used when UI means "this local time in Malaysia" (e.g. Cleanlemons schedule working_day).
 */
function malaysiaWallClockToUtcDatetimeForDb(ymd, hh, mm) {
  const p = parseDateParts(ymd);
  if (!p) return null;
  const h = Math.min(23, Math.max(0, Number(hh) || 0));
  const mi = Math.min(59, Math.max(0, Number(mm) || 0));
  const utcMs = Date.UTC(p.y, p.m - 1, p.d, h, mi, 0, 0) - MY_OFFSET_MS;
  const d = new Date(utcMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hs = String(d.getUTCHours()).padStart(2, '0');
  const mins = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${hs}:${mins}:${ss}.000`;
}

/**
 * Legacy: non–YYYY-MM-DD booking inputs → MySQL datetime using UTC clock parts (aligns with +00:00 session).
 * @param {string|Date} val
 * @returns {string|null}
 */
function legacyMysqlDatetimeUtcFromInput(val) {
  if (val == null || val === '') return null;
  const d = val instanceof Date ? val : new Date(val);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  const s = String(d.getUTCSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}:${s}`;
}

/**
 * Booking UI: YYYY-MM-DD = Malaysia calendar day → UTC for tenancy.begin / tenancy.end columns.
 * Non–date-only inputs fall back to legacy UTC parts (same as historical booking.service).
 * @returns {{ beginMysql: string|null, endMysql: string|null }}
 */
function tenancyBeginEndToMysql(beginDate, endDate) {
  const b = String(beginDate || '').trim();
  const e = String(endDate || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(b) && /^\d{4}-\d{2}-\d{2}$/.test(e)) {
    const beginMysql = malaysiaDateToUtcDatetimeForDb(b);
    const { toUtc: endMysql } = malaysiaDateRangeToUtcForQuery(null, e);
    return { beginMysql, endMysql };
  }
  return {
    beginMysql: legacyMysqlDatetimeUtcFromInput(beginDate),
    endMysql: legacyMysqlDatetimeUtcFromInput(endDate)
  };
}

/**
 * Tenancy `end` only (extend / change room): MY calendar YYYY-MM-DD → end of MY day in UTC (same as booking end).
 * @param {string} endYmd
 * @returns {string|null}
 */
function tenancyEndYmdToMysqlDatetime(endYmd) {
  const e = String(endYmd || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e)) return null;
  const { toUtc } = malaysiaDateRangeToUtcForQuery(null, e);
  return toUtc;
}

/**
 * Operator edit tenancy checkout: Malaysia calendar YYYY-MM-DD, or `YYYY-MM-DDTHH:mm` as Malaysia wall clock → UTC for MySQL.
 * @param {string|Date|null|undefined} val
 * @returns {string|null}
 */
function tenancyEndInputToMysqlDatetime(val) {
  if (val == null || val === '') return null;
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return tenancyEndYmdToMysqlDatetime(s);
  }
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/);
  if (m) {
    const raw = malaysiaWallClockToUtcDatetimeForDb(m[1], m[2], m[3]);
    return raw ? raw.replace(/\.000$/, '') : null;
  }
  const d = val instanceof Date ? val : new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const ymd = utcDatetimeFromDbToMalaysiaDateOnly(d);
  if (ymd) return tenancyEndYmdToMysqlDatetime(ymd);
  return null;
}

module.exports = {
  malaysiaDateToUtcDatetimeForDb,
  malaysiaWallClockToUtcDatetimeForDb,
  utcDatetimeFromDbToMalaysiaDateOnly,
  utcDatetimeFromDbToMalaysiaDate,
  malaysiaDateRangeToUtcForQuery,
  parseDateParts,
  getTodayMalaysiaDate,
  getTodayPlusDaysMalaysia,
  getMalaysiaMonthStartYmd,
  getMalaysiaMonthStartMonthsAgo,
  toSingaporeCalendarYmd,
  formatApiResponseDates,
  DEFAULT_DATE_KEYS,
  tenancyBeginEndToMysql,
  tenancyEndYmdToMysqlDatetime,
  tenancyEndInputToMysqlDatetime
};
