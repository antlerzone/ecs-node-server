/**
 * Cleanlemons operator AI schedule: cln_operator_ai, chat, LLM calls, suggest/apply.
 */

const axios = require('axios');
const crypto = require('crypto');
const pool = require('../../config/db');
const clnInt = require('./cleanlemon-integration.service');
const clnSaasAiMd = require('./cln-saasadmin-ai-md.service');
const cleanlemonSvc = require('./cleanlemon.service');

// #region agent log
function __dbgJarvisYesFlow(payload) {
  try {
    fetch('http://127.0.0.1:7739/ingest/e3e79611-3662-4b91-9509-c2e13537425d', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'ec8515' },
      body: JSON.stringify({ sessionId: 'ec8515', timestamp: Date.now(), ...payload }),
    }).catch(() => {});
  } catch (_) {
    /* ignore */
  }
}
// #endregion

function safeJsonStringifyForPrompt(label, obj) {
  try {
    return JSON.stringify(obj == null ? null : obj);
  } catch (e) {
    console.warn('[cln-operator-ai] safeJsonStringifyForPrompt', label, e?.message || e);
    return '"<unserializable>"';
  }
}

function malaysiaTodayYmd() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
}

/** Whether `ymd` is Malaysia calendar today or a future day (YYYY-MM-DD lexicographic OK). */
function isMalaysiaYmdOnOrAfterToday(ymd) {
  const d = String(ymd || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return d >= malaysiaTodayYmd();
}

/** Malaysia business calendar YYYY-MM-DD from UTC-stored `working_day` (DB session +00:00). */
const SQL_WORKING_DAY_KL_YMD = `DATE_FORMAT(CONVERT_TZ(s.working_day, '+00:00', 'Asia/Kuala_Lumpur'), '%Y-%m-%d')`;

/** Map DB cleaning_type to short operator-facing label. */
function humanizeCleaningTypeForChat(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
  if (!s) return 'other';
  if (s.includes('homestay')) return 'homestay cleaning';
  if (s.includes('deep')) return 'deep cleaning';
  if (s.includes('warm')) return 'warm cleaning';
  if (s.includes('renovat')) return 'renovation cleaning';
  if (s.includes('general')) return 'general cleaning';
  return 'other';
}

function normalizeScheduleContextYmd(raw) {
  const s = String(raw || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

/** Malaysia calendar YYYY-MM-DD + N days (toolbar / anchor). Noon on `ymd` in Asia/Kuala_Lumpur, then add civil days (server-TZ-safe). */
function malaysiaCalendarAddDays(ymd, deltaDays) {
  const base = String(ymd || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(base)) return '';
  const n = Math.floor(Number(deltaDays));
  if (!Number.isFinite(n)) return '';
  const [y, mo, da] = base.split('-').map((x) => parseInt(x, 10));
  if (!y || !mo || !da) return '';
  // 12:00 Malaysia = 04:00 UTC on that civil date (UTC+8)
  const d = new Date(Date.UTC(y, mo - 1, da, 4, 0, 0, 0));
  if (isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + n);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(d);
}

/**
 * Relative calendar day vs Schedule toolbar day (contextWorkingDay or Malaysia today).
 * @returns {number} 0 = no extra load; +1 tomorrow; -1 yesterday; +2 day after tomorrow
 */
function detectRelativeScheduleDayOffsetFromMessage(userMessage) {
  const raw = String(userMessage || '');
  const s = raw.toLowerCase();
  if (/后天|後天/.test(raw) || /\bday after tomorrow\b/.test(s)) return 2;
  if (/明天|翌日/.test(raw) || /\btomorrow\b/.test(s) || /\btmr\b/.test(s) || /\btmw\b/.test(s) || /\besok\b/.test(s))
    return 1;
  if (
    /昨天|昨日/.test(raw) ||
    /\byesterday\b/.test(s) ||
    /\bytd\b/.test(s) ||
    /\bystd\b/.test(s) ||
    /\bsemalam\b/.test(s)
  )
    return -1;
  return 0;
}

/**
 * Follow-ups like "list them" omit day words; reuse the most recent user turn that names a relative day,
 * explicit calendar date, or "last Friday" style day (scan newest → oldest, first hit per dimension).
 */
function resolveScheduleDayHintsFromUserThread(historyRows, defaultYearYyyy) {
  const users = (Array.isArray(historyRows) ? historyRows : [])
    .filter((h) => String(h.role) === 'user')
    .map((h) => String(h.content || '').trim());

  let relOff = 0;
  let explicitYmd = '';
  let lastNamedWeekdaySun0 = null;

  for (let i = users.length - 1; i >= 0; i -= 1) {
    const m = users[i];
    if (relOff === 0) {
      const r = detectRelativeScheduleDayOffsetFromMessage(m);
      if (r !== 0) relOff = r;
    }
    if (!explicitYmd) {
      const ex = detectExplicitCalendarYmdFromMessage(m, defaultYearYyyy);
      if (ex) explicitYmd = ex;
    }
    if (lastNamedWeekdaySun0 == null) {
      const w = detectLastNamedWeekdaySun0FromMessage(m);
      if (w != null) lastNamedWeekdaySun0 = w;
    }
  }

  return { relOff, explicitYmd, lastNamedWeekdaySun0 };
}

/**
 * Replace Chinese auto-assign consent tokens with English (portal operators often do not read Chinese).
 * Used on GET history so old DB rows still display correctly without restarting the API process only.
 */
function stripJarvisChineseConsentTokens(text) {
  let out = String(text || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '');

  if (!/(确认执行|確認執行|CONFIRM_EXECUTE|是否执行\s*自动派队)/u.test(out)) return String(text || '');

  out = out.replace(/是否执行\s*自动派队/gu, 'server auto-assign');
  out = out.replace(/\*\*only\*\*\s*with\s*[^\n]+?(?=\s*to\s+proceed)/gi, '');
  out = out.replace(
    /please\s+confirm\s+by\s+replying\s*\*\*only\*\*\s*with\s*([「【]?确认执行[」】]?|CONFIRM_EXECUTE)/gi,
    'Please confirm to proceed above. Thank you.'
  );
  out = out.replace(
    /(?:please\s+)?reply\s+\*\*only\*\*\s*with\s*[「【]?\s*确认执行\s*[」】]?/gi,
    'Please confirm to proceed above. Thank you.'
  );
  out = out.replace(/"确认执行"|'确认执行'|「确认执行」/g, '**yes**, **ok**, or **confirm**');
  out = out.replace(/[「【]确认执行[」】]/gu, '**yes**, **ok**, or **confirm**');
  out = out.replace(/\bCONFIRM_EXECUTE\b/gi, 'yes, ok, or confirm');
  let prev;
  do {
    prev = out;
    out = out.replace(/确认执行|確認執行/gu, 'yes or confirm');
  } while (prev !== out);
  return out;
}

/** When the operator's latest line has no Han, strip Chinese consent tokens before storing the assistant reply. */
function sanitizeJarvisConsentWordingForEnglishOperator(fullReplyText, historyRows, latestUserMessage) {
  const um = String(latestUserMessage || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
  if (/[\u4e00-\u9fff]/u.test(um)) return String(fullReplyText || '');
  return shortenVerboseEnglishConsentFooter(stripJarvisChineseConsentTokens(fullReplyText));
}

/** If model claimed DB create before operator confirmed, strip misleading lines (SCHEDULE_JOB_CREATE_JSON still pending). */
function sanitizePrematureScheduleJobCreateClaims(text) {
  let s = String(text || '');
  /** LLM-only path: drop whole lines that falsely claim a row was persisted (server success uses "job added" / "Created **N**"). */
  const dropFalseCreateLine = (ln) => {
    const l = String(ln || '');
    if (!l.trim()) return false;
    if (/could not create|tidak dapat|gagal/i.test(l)) return false;
    if (/未能创建|无法创建|没有创建|创建失败|未创建/u.test(l)) return false;
    if (/\bhas been created\b/i.test(l) && (/\bjob\b/i.test(l) || /\bhomestay\b/i.test(l) || /\*\*/.test(l)))
      return true;
    if (/\b(were|was)\s+created\b/i.test(l) && /\bjob(s)?\b/i.test(l)) return true;
    if (/\b(successfully\s+)?created\b/i.test(l) && /\bfor\s+\*\*/i.test(l)) return true;
    if (/\btelah\s+dicipta\b/i.test(l) && /\bjob\b/i.test(l)) return true;
    /** Chinese: model claimed a row was saved before server confirmed (no SCHEDULE_JOB_CREATE_JSON yet). */
    if (/已为[^。\n]{0,200}创建/u.test(l)) return true;
    if (/工作已(?:为)?[^。\n]{0,160}创建/u.test(l)) return true;
    if (/(?:打扫|清洁|民宿).{0,80}已[^。\n]{0,120}创建/u.test(l)) return true;
    return false;
  };
  s = s
    .split(/\r?\n/)
    .filter((ln) => !dropFalseCreateLine(ln))
    .join('\n');
  if (!s.includes(SCHEDULE_JOB_CREATE_JSON_PREFIX)) {
    s = s.replace(/\n{3,}/g, '\n\n');
    return s.trim();
  }
  s = s.replace(/\bThe cleaning schedule[^.\n]*has been created successfully\.?\s*/gi, '');
  s = s.replace(/\b[A-Za-z ]*cleaning schedule[^.\n]*has been created[^.\n]*\.?\s*/gi, '');
  s = s.replace(/\b(has been created successfully|created successfully|successfully created)\b[^.\n]*\.?\s*/gi, '');
  s = s.replace(/已成功[^。\n]*创建[^。\n]*[。!]?/gu, '');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

/** Collapse legacy "reply only with yes/ok/confirm" footers for English-thread operators. */
function shortenVerboseEnglishConsentFooter(text) {
  let out = String(text || '');
  out = out.replace(
    /\bPlease confirm by replying\s*\*\*only\*\*\s*with\s*\*\*yes\*\*,\s*\*\*ok\*\*,\s*or\s*\*\*confirm\*\*\s*to proceed with[^.!?\n]*[.!?]?/gi,
    'Please confirm to proceed above. Thank you!'
  );
  out = out.replace(
    /\bPlease reply\s*\*\*only\*\*\s*with\s*\*\*yes\*\*,\s*\*\*ok\*\*,\s*or\s*\*\*confirm\*\*\s*to proceed with[^.!?\n]*[.!?]?/gi,
    'Please confirm to proceed above. Thank you!'
  );
  return out;
}

const WEEKDAY_SHORT_SUN0 = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Malaysia weekday for civil `ymd`: 0=Sunday … 6=Saturday. */
function malaysiaCalendarWeekdaySun0(ymd) {
  const base = String(ymd || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(base)) return null;
  const d = new Date(`${base}T12:00:00+08:00`);
  if (isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    weekday: 'short',
  }).formatToParts(d);
  const label = String(parts.find((p) => p.type === 'weekday')?.value || '').slice(0, 3);
  return WEEKDAY_SHORT_SUN0[label] !== undefined ? WEEKDAY_SHORT_SUN0[label] : null;
}

/**
 * Most recent `weekdaySun0` strictly before `anchorYmd` on Malaysia calendar (walk back from anchor−1, max 21 days).
 */
function malaysiaLastNamedCalendarWeekday(anchorYmd, weekdaySun0) {
  if (weekdaySun0 == null || weekdaySun0 < 0 || weekdaySun0 > 6) return '';
  let d = malaysiaCalendarAddDays(anchorYmd, -1);
  for (let i = 0; i < 21; i++) {
    if (!d) return '';
    if (malaysiaCalendarWeekdaySun0(d) === weekdaySun0) return d;
    d = malaysiaCalendarAddDays(d, -1);
  }
  return '';
}

/**
 * "last Sunday", "last Friday", "previous Monday", "last week friday", "上个星期天" → weekday 0–6, or null.
 */
function detectLastNamedWeekdaySun0FromMessage(userMessage) {
  const raw = String(userMessage || '');
  const s = raw.toLowerCase();

  const wdAlt =
    'sunday|monday|tuesday|wednesday|thursday|friday|saturday|tues|thurs|sun|mon|tue|wed|thu|fri|sat';
  const en = s.match(
    new RegExp(`\\b(last|previous|past)\\s+(?:week'?s?\\s+)?(${wdAlt})s?\\b`, 'i')
  );
  if (en) {
    const g2 = en[2].toLowerCase();
    const map = {
      sunday: 0,
      sun: 0,
      monday: 1,
      mon: 1,
      tuesday: 2,
      tues: 2,
      tue: 2,
      wednesday: 3,
      wed: 3,
      thursday: 4,
      thurs: 4,
      thu: 4,
      friday: 5,
      fri: 5,
      saturday: 6,
      sat: 6,
    };
    if (map[g2] !== undefined) return map[g2];
  }

  if (/(上个|上一)星期日|上个星期天|上个周日|上个周天|上个礼拜天|上个礼拜日/.test(raw)) return 0;
  if (/(上个|上一)(?:星期|周)一|上个礼拜一|上个周一/.test(raw)) return 1;
  if (/(上个|上一)(?:星期|周)二|上个礼拜二|上个周二/.test(raw)) return 2;
  if (/(上个|上一)(?:星期|周)三|上个礼拜三|上个周三/.test(raw)) return 3;
  if (/(上个|上一)(?:星期|周)四|上个礼拜四|上个周四/.test(raw)) return 4;
  if (/(上个|上一)(?:星期|周)五|上个礼拜五|上个周五/.test(raw)) return 5;
  if (/(上个|上一)(?:星期|周)六|上个礼拜六|上个周六/.test(raw)) return 6;

  return null;
}

const MONTH_WORD_TO_NUM = new Map(
  Object.entries({
    january: 1,
    jan: 1,
    february: 2,
    feb: 2,
    march: 3,
    mar: 3,
    april: 4,
    apr: 4,
    may: 5,
    june: 6,
    jun: 6,
    july: 7,
    jul: 7,
    august: 8,
    aug: 8,
    september: 9,
    sept: 9,
    sep: 9,
    october: 10,
    oct: 10,
    november: 11,
    nov: 11,
    december: 12,
    dec: 12,
  })
);

function pad2Calendar(n) {
  return String(Math.min(99, Math.max(0, Math.floor(Number(n))))).padStart(2, '0');
}

/** Valid civil Y-M-D or ''. */
function malaysiaCivilYmdOrEmpty(y, m, d) {
  const yi = Math.floor(Number(y));
  const mi = Math.floor(Number(m));
  const di = Math.floor(Number(d));
  if (!Number.isFinite(yi) || !Number.isFinite(mi) || !Number.isFinite(di)) return '';
  if (mi < 1 || mi > 12 || di < 1 || di > 31) return '';
  const dt = new Date(Date.UTC(yi, mi - 1, di, 12, 0, 0));
  if (dt.getUTCFullYear() !== yi || dt.getUTCMonth() !== mi - 1 || dt.getUTCDate() !== di) return '';
  return `${yi}-${pad2Calendar(mi)}-${pad2Calendar(di)}`;
}

/**
 * Explicit calendar date in user text (e.g. March 20, march 20 2026, 2026-03-20, 20 March, 2026年3月20日).
 * Year omitted → `defaultYearYyyy` (toolbar day year, else Malaysia today year).
 */
function detectExplicitCalendarYmdFromMessage(userMessage, defaultYearYyyy) {
  const s = String(userMessage || '');
  const yDefRaw = String(defaultYearYyyy || '').trim().slice(0, 4);
  const yDef = /^\d{4}$/.test(yDefRaw) ? yDefRaw : malaysiaTodayYmd().slice(0, 4);
  const yNum = parseInt(yDef, 10);

  const iso = s.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return malaysiaCivilYmdOrEmpty(iso[1], iso[2], iso[3]);

  const zh = s.match(/\b(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?\b/);
  if (zh) return malaysiaCivilYmdOrEmpty(zh[1], zh[2], zh[3]);

  const monthAlt = [...MONTH_WORD_TO_NUM.keys()].sort((a, b) => b.length - a.length).join('|');

  const m1 = s.match(new RegExp(`\\b(${monthAlt})\\s+(\\d{1,2})(?:\\s*,\\s*|\\s+)(\\d{4})?\\b`, 'i'));
  if (m1) {
    const mo = MONTH_WORD_TO_NUM.get(m1[1].toLowerCase());
    const day = parseInt(m1[2], 10);
    const y = m1[3] ? parseInt(m1[3], 10) : yNum;
    if (mo && Number.isFinite(day)) return malaysiaCivilYmdOrEmpty(y, mo, day);
  }

  const m2 = s.match(new RegExp(`\\b(\\d{1,2})\\s+(${monthAlt})(?:\\s*,\\s*|\\s+)?(\\d{4})?\\b`, 'i'));
  if (m2) {
    const day = parseInt(m2[1], 10);
    const mo = MONTH_WORD_TO_NUM.get(m2[2].toLowerCase());
    const y = m2[3] ? parseInt(m2[3], 10) : yNum;
    if (mo && Number.isFinite(day)) return malaysiaCivilYmdOrEmpty(y, mo, day);
  }

  return '';
}

/**
 * Jobs for operator AI chat — `dayYmd` is Malaysia calendar YYYY-MM-DD (Asia/Kuala_Lumpur; portal Schedule when sent, else Malaysia today). DB stores UTC+0; filter **only** by Malaysia calendar (CONVERT_TZ), never raw UTC DATE_FORMAT alone (avoids wrong-day rows).
 */
async function loadScheduleJobsForOperatorChat(operatorId, dayYmdOpt) {
  const oid = String(operatorId || '').trim();
  const day = normalizeScheduleContextYmd(dayYmdOpt) || malaysiaTodayYmd();
  if (!oid || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return { workingDay: day, jobsJson: '[]' };
  try {
    const [rows] = await pool.query(
      `SELECT s.id AS scheduleId,
              COALESCE(NULLIF(TRIM(p.property_name), ''), NULLIF(TRIM(p.unit_name), ''), '(unnamed property)') AS propertyName,
              COALESCE(NULLIF(TRIM(p.unit_name), ''), '') AS unitNumber,
              s.cleaning_type AS cleaningTypeRaw,
              COALESCE(NULLIF(TRIM(s.team), ''), '') AS teamName,
              COALESCE(NULLIF(TRIM(s.status), ''), '') AS jobStatus
       FROM cln_schedule s
       INNER JOIN cln_property p ON p.id = s.property_id
       WHERE p.operator_id = ?
         AND s.working_day IS NOT NULL
         AND (${SQL_WORKING_DAY_KL_YMD}) = ?
       ORDER BY COALESCE(NULLIF(TRIM(p.property_name), ''), '') ASC, s.start_time ASC, s.id ASC`,
      [oid, day]
    );
    const mapped = (rows || []).map((r) => ({
      scheduleId: String(r.scheduleId),
      propertyName: String(r.propertyName || ''),
      unitNumber: String(r.unitNumber || ''),
      jobType: humanizeCleaningTypeForChat(r.cleaningTypeRaw),
      cleaningTypeRaw: String(r.cleaningTypeRaw || ''),
      teamName: String(r.teamName || ''),
      jobStatus: String(r.jobStatus || ''),
    }));
    const maxN = 120;
    const items = mapped.slice(0, maxN);
    const payload =
      mapped.length > maxN
        ? { truncated: true, totalJobs: mapped.length, items }
        : { truncated: false, totalJobs: mapped.length, items };
    return { workingDay: day, jobsJson: JSON.stringify(payload) };
  } catch (e) {
    console.warn('[cln-operator-ai] loadScheduleJobsForOperatorChat:', e?.message || e);
    return { workingDay: day, jobsJson: '[]' };
  }
}

/** Shown when no key, or model returns quota/auth errors — keep in sync with portal copy. */
/** User-facing name — keep in sync with `cleanlemon/next-app/lib/cleanlemon-operator-ai-brand.ts`. */
const OPERATOR_SCHEDULE_AI_DISPLAY_NAME = 'Jarvis';

const OPERATOR_AI_AGENT_PAYMENT_HINT =
  `${OPERATOR_SCHEDULE_AI_DISPLAY_NAME} is not available or your model key has no quota. Please complete payment / top up and connect your AI model under Company → API Integration (${OPERATOR_SCHEDULE_AI_DISPLAY_NAME}), then try again.\n\n${OPERATOR_SCHEDULE_AI_DISPLAY_NAME} 暂不可用或模型没有额度。请到 Company → API Integration（${OPERATOR_SCHEDULE_AI_DISPLAY_NAME}）付款或连接模型后再试。`;

/** SaaS admin turned off operator AI — keep in sync with `cleanlemon-operator-ai-messages.ts`. */
const OPERATOR_AI_PLATFORM_DISABLED_HINT =
  `${OPERATOR_SCHEDULE_AI_DISPLAY_NAME} is turned off by the platform. You can still manage the schedule manually. If you believe this is a mistake, contact Cleanlemons support.\n\n平台已关闭 ${OPERATOR_SCHEDULE_AI_DISPLAY_NAME}，排班仍可手动操作。如需开通请联系 Cleanlemons。`;

const OPERATOR_AI_SCOPE_SCHEDULE_DISABLED_HINT =
  `${OPERATOR_SCHEDULE_AI_DISPLAY_NAME} / schedule assistant is not enabled for this platform configuration. Contact Cleanlemons support.\n\n当前平台配置未开放 ${OPERATOR_SCHEDULE_AI_DISPLAY_NAME}（排程助手），请联系 Cleanlemons。`;

async function getScheduleAiPlatformGate() {
  try {
    const pol = await clnSaasAiMd.getOperatorAiAccessPolicy();
    if (!pol.accessEnabled) return { ok: false, code: 'OPERATOR_AI_DISABLED_BY_PLATFORM' };
    const scopes = Array.isArray(pol.allowedDataScopes) ? pol.allowedDataScopes : [];
    if (!scopes.includes('cln_schedule')) return { ok: false, code: 'OPERATOR_AI_SCOPE_SCHEDULE_DISABLED' };
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

async function assertScheduleAiAllowedByPlatform() {
  const g = await getScheduleAiPlatformGate();
  if (!g.ok) {
    const err = new Error(g.code);
    err.code = g.code;
    throw err;
  }
}

function uuid() {
  return crypto.randomUUID();
}

/** SaaS platform rules from `cln_saasadmin_ai_md` — prepended to operator LLM system prompts. */
async function safePlatformRulesPrefix() {
  try {
    return await clnSaasAiMd.getPlatformRulesPromptPrefix();
  } catch (e) {
    const msg = String(e?.message || '');
    const c = String(e?.code || '');
    if (c === 'ER_NO_SUCH_TABLE' || msg.includes("doesn't exist") || msg.includes('Unknown table')) {
      return '';
    }
    console.warn('[cln-operator-ai] platform rules prefix:', e?.message || e);
    return '';
  }
}

async function databaseHasColumn(table, column) {
  const db = process.env.DB_NAME;
  if (!db) return false;
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [db, String(table), String(column)]
  );
  return rows.length > 0;
}

let _operatorAiChatHasMachineAppendCol;
async function operatorAiChatHasMachineAppendColumn() {
  if (_operatorAiChatHasMachineAppendCol === true) return true;
  const v = await databaseHasColumn('cln_operator_ai_chat_message', 'machine_append');
  if (v) _operatorAiChatHasMachineAppendCol = true;
  return Boolean(v);
}

function safeJsonParse(s, fallback) {
  if (s == null || s === '') return fallback;
  try {
    return typeof s === 'object' ? s : JSON.parse(String(s));
  } catch {
    return fallback;
  }
}

const DEFAULT_AREA_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#ca8a04', '#9333ea', '#0891b2', '#ea580c'];

function normalizeRegionGroups(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((g, i) => {
    const id = String(g?.id || `area-${i + 1}`).trim() || `area-${i + 1}`;
    const name = String(g?.name || `Area ${String.fromCharCode(65 + (i % 26))}`).trim() || `Area ${i + 1}`;
    const color = String(g?.color || '').trim() || DEFAULT_AREA_COLORS[i % DEFAULT_AREA_COLORS.length];
    const propertyIds = Array.isArray(g?.propertyIds) ? g.propertyIds.map((x) => String(x).trim()).filter(Boolean) : [];
    return { id, name, color, propertyIds };
  });
}

/**
 * Jobs per geographic area + team-allocation rules for the LLM (region_groups in cln_operator_ai).
 */
function buildAreaTeamAllocationNarrative(settings, ctx, eligibleJobs) {
  const regions = normalizeRegionGroups(settings.regionGroups);
  if (!regions.length) return '';

  const teamCount = Array.isArray(ctx.teams) ? ctx.teams.length : 0;
  const byArea = new Map();
  const unassignedJobIds = [];

  for (const j of eligibleJobs) {
    const pid = String(j.propertyId || '').trim();
    let matched = null;
    for (const r of regions) {
      if (r.propertyIds.includes(pid)) {
        matched = r;
        break;
      }
    }
    if (matched) {
      const cur = byArea.get(matched.id) || { areaId: matched.id, name: matched.name, jobIds: [] };
      cur.jobIds.push(j.id);
      byArea.set(matched.id, cur);
    } else {
      unassignedJobIds.push(j.id);
    }
  }

  const areasWithJobs = [...byArea.values()].filter((a) => a.jobIds.length > 0);
  const areaCount = areasWithJobs.length + (unassignedJobIds.length > 0 ? 1 : 0);
  const summary = areasWithJobs.map((a) => `${a.name}: ${a.jobIds.length} job(s)`).join('; ');
  const unassignedNote =
    unassignedJobIds.length > 0
      ? ` ${unassignedJobIds.length} job(s) belong to properties not listed in any area — distribute with the rest.`
      : '';

  return `Area / team allocation (geographic regions configured by the operator):
- Teams available: ${teamCount}. Distinct areas with at least one eligible job in this batch: ${areaCount}.
- Eligible jobs per area: ${summary || 'none'}.${unassignedNote}
Rules:
- If there is only one eligible job in total, assign exactly one team to that job.
- If areas with workload (${areaCount}) exceed available teams (${teamCount}), spread teams across areas as evenly as possible; prioritize areas with more jobs.
- If teams (${teamCount}) are greater than or equal to the number of busy areas, assign capacity proportionally: areas with more jobs should receive more team assignments (multiple teams may serve the same area if needed).
- Still respect max jobs per team, pinned constraints, and region group membership when choosing teams for properties.`;
}

function defaultSchedulePrefs() {
  return {
    aiScheduleCronEnabled: true,
    /** Midnight batch (UTC+8): assign for today + next N-1 calendar days; 1–7 */
    aiSchedulePlanningHorizonDays: 1,
    /** Legacy; ignored by midnight runner (fixed 00:00 UTC+8) */
    aiScheduleCronTimeLocal: '06:00',
    aiScheduleOnJobCreate: false,
    aiScheduleProgressWatchEnabled: false,
    /** After employee group-end completes a job, run rebalance for that KL day */
    aiScheduleRebalanceOnTaskComplete: true,
    aiScheduleRebalanceIntervalMinutes: 30,
    aiSchedulePreferSameTeamWhenPossible: true,
    aiScheduleSamePropertyDifferentTeamAlways: false,
    /** prefer_same | rotate_same_property | balanced — normalized keeps booleans in sync */
    aiScheduleTeamAssignmentMode: 'prefer_same',
    maxJobsPerTeamPerDay: 15,
    /** @deprecated split into same/different location; kept for migration */
    aiScheduleMinBufferMinutesBetweenJobs: 30,
    aiScheduleMinBufferMinutesSameLocation: 15,
    aiScheduleMinBufferMinutesDifferentLocation: 30,
    /** Homestay: no fixed slot in DB; work must fit in this local window (UTC+8) */
    aiScheduleHomestayWindowStartLocal: '11:00',
    aiScheduleHomestayWindowEndLocal: '16:00',
  };
}

function normalizeCronTimeLocal(v) {
  const s = String(v ?? '').trim();
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) return s;
  return '06:00';
}

function normalizePlanningHorizonDays(v) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return 1;
  return Math.min(7, Math.max(1, n));
}

function normalizeHmLocal(v, fallback) {
  const s = String(v ?? '').trim();
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) return s;
  return fallback;
}

function normalizeBufferMinutes(v) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return 30;
  return Math.min(240, Math.max(0, n));
}

function normalizeTeamAssignmentMode(merged) {
  const mode = String(merged.aiScheduleTeamAssignmentMode || '').trim();
  if (mode === 'rotate_same_property' || mode === 'prefer_same' || mode === 'balanced') {
    merged.aiScheduleTeamAssignmentMode = mode;
    merged.aiSchedulePreferSameTeamWhenPossible = mode === 'prefer_same';
    merged.aiScheduleSamePropertyDifferentTeamAlways = mode === 'rotate_same_property';
    return;
  }
  if (merged.aiScheduleSamePropertyDifferentTeamAlways) {
    merged.aiScheduleTeamAssignmentMode = 'rotate_same_property';
    merged.aiSchedulePreferSameTeamWhenPossible = false;
  } else if (merged.aiSchedulePreferSameTeamWhenPossible) {
    merged.aiScheduleTeamAssignmentMode = 'prefer_same';
    merged.aiScheduleSamePropertyDifferentTeamAlways = false;
  } else {
    merged.aiScheduleTeamAssignmentMode = 'balanced';
    merged.aiSchedulePreferSameTeamWhenPossible = false;
    merged.aiScheduleSamePropertyDifferentTeamAlways = false;
  }
}

/** Mirrors cleanlemon.service normalizeScheduleStatus for AI eligibility. */
function normalizeScheduleStatusForAi(raw) {
  const trimmed = String(raw ?? '').trim();
  if (trimmed === '') return 'pending-checkout';
  const x = trimmed.toLowerCase().replace(/\s+/g, '-');
  if (x.includes('complete')) return 'completed';
  if (x === 'done') return 'completed';
  if (x.includes('progress')) return 'in-progress';
  if (x.includes('cancel')) return 'cancelled';
  if (
    x.includes('checkout') ||
    x.includes('check-out') ||
    x === 'pending-checkout' ||
    x === 'pending-check-out'
  ) {
    return 'pending-checkout';
  }
  if (x.includes('customer') && x.includes('missing')) return 'pending-checkout';
  if (x.includes('ready') && x.includes('clean')) return 'ready-to-clean';
  return 'pending-checkout';
}

function isHomestayCleaningType(cleaningType) {
  const s = String(cleaningType || '').toLowerCase();
  return s.includes('homestay') || s === 'homestay-cleaning';
}

/**
 * Timing, buffer, homestay window, status rules — injected into assign/rebalance prompts.
 */
function buildTimingAndStatusRulesNarrative(prefs) {
  const p = prefs && typeof prefs === 'object' ? prefs : defaultSchedulePrefs();
  const legacy = normalizeBufferMinutes(p.aiScheduleMinBufferMinutesBetweenJobs);
  const bufSame = normalizeBufferMinutes(
    p.aiScheduleMinBufferMinutesSameLocation != null ? p.aiScheduleMinBufferMinutesSameLocation : legacy
  );
  const bufDiff = normalizeBufferMinutes(
    p.aiScheduleMinBufferMinutesDifferentLocation != null ? p.aiScheduleMinBufferMinutesDifferentLocation : legacy
  );
  const hsStart = normalizeHmLocal(p.aiScheduleHomestayWindowStartLocal, '11:00');
  const hsEnd = normalizeHmLocal(p.aiScheduleHomestayWindowEndLocal, '16:00');
  return `Timing and visit rules (operator settings; UTC+8 local time for windows):
- Consecutive jobs on the same team at the same property / location: leave at least ${bufSame} minutes between visits (handover).
- Consecutive jobs on the same team at different properties / locations: leave at least ${bufDiff} minutes (travel, parking, handover). When ordering routes, avoid overlapping visits and respect these gaps.
- Homestay cleaning: jobs often have no single fixed appointment time in the data; work should still fit within ${hsStart}–${hsEnd} the same working day when planning routes.
- Homestay status: assign teams to BOTH pending-checkout and ready-to-clean for route planning that day. pending-checkout still needs a team on the board. Staff may enter and start cleaning only after the guest has checked out and the job becomes ready-to-clean — until then the visit is planned but not executed inside the unit.
- Non-homestay jobs that have staff start/end times (scheduled time slot): assign teams so visits follow those time windows and route order respects both the slot and the buffers above.`;
}

function normalizePrefs(raw) {
  const d = defaultSchedulePrefs();
  if (!raw || typeof raw !== 'object') return d;
  const merged = { ...d, ...raw };
  merged.aiScheduleCronTimeLocal = normalizeCronTimeLocal(merged.aiScheduleCronTimeLocal);
  merged.aiSchedulePlanningHorizonDays = normalizePlanningHorizonDays(merged.aiSchedulePlanningHorizonDays);
  merged.aiScheduleRebalanceOnTaskComplete = Boolean(merged.aiScheduleRebalanceOnTaskComplete);
  merged.aiScheduleMinBufferMinutesBetweenJobs = normalizeBufferMinutes(merged.aiScheduleMinBufferMinutesBetweenJobs);
  const legacyBuf = merged.aiScheduleMinBufferMinutesBetweenJobs;
  merged.aiScheduleMinBufferMinutesSameLocation = normalizeBufferMinutes(
    merged.aiScheduleMinBufferMinutesSameLocation != null ? merged.aiScheduleMinBufferMinutesSameLocation : legacyBuf
  );
  merged.aiScheduleMinBufferMinutesDifferentLocation = normalizeBufferMinutes(
    merged.aiScheduleMinBufferMinutesDifferentLocation != null ? merged.aiScheduleMinBufferMinutesDifferentLocation : legacyBuf
  );
  merged.aiScheduleHomestayWindowStartLocal = normalizeHmLocal(merged.aiScheduleHomestayWindowStartLocal, '11:00');
  merged.aiScheduleHomestayWindowEndLocal = normalizeHmLocal(merged.aiScheduleHomestayWindowEndLocal, '16:00');
  normalizeTeamAssignmentMode(merged);
  return merged;
}

/**
 * @returns {Promise<{ id: string, operator_id: string, region_groups_json: string|null, pinned_constraints_json: string|null, schedule_prefs_json: string|null, prompt_extra: string|null, chat_summary: string|null }|null>}
 */
async function getOperatorAiRow(operatorId) {
  const oid = String(operatorId || '').trim();
  if (!oid) return null;
  const [rows] = await pool.query(
    'SELECT * FROM cln_operator_ai WHERE operator_id = ? LIMIT 1',
    [oid]
  );
  return rows[0] || null;
}

async function upsertOperatorAiRow(operatorId, patch = {}) {
  const oid = String(operatorId || '').trim();
  if (!oid) throw new Error('MISSING_OPERATOR_ID');

  const row = await getOperatorAiRow(oid);
  const nowCols = row || {
    region_groups_json: null,
    pinned_constraints_json: null,
    schedule_prefs_json: null,
    prompt_extra: null,
    chat_summary: null,
  };

  const next = {
    region_groups_json:
      patch.regionGroups !== undefined
        ? JSON.stringify(patch.regionGroups)
        : row?.region_groups_json ?? null,
    pinned_constraints_json:
      patch.pinnedConstraints !== undefined
        ? JSON.stringify(patch.pinnedConstraints)
        : row?.pinned_constraints_json ?? null,
    schedule_prefs_json:
      patch.schedulePrefs !== undefined
        ? JSON.stringify(normalizePrefs(patch.schedulePrefs))
        : row?.schedule_prefs_json ?? JSON.stringify(defaultSchedulePrefs()),
    prompt_extra:
      patch.promptExtra !== undefined ? String(patch.promptExtra || '').slice(0, 8000) : row?.prompt_extra ?? null,
    chat_summary:
      patch.chatSummary !== undefined ? String(patch.chatSummary || '').slice(0, 16000) : row?.chat_summary ?? null,
  };

  if (!row) {
    const id = uuid();
    await pool.query(
      `INSERT INTO cln_operator_ai (id, operator_id, region_groups_json, pinned_constraints_json, schedule_prefs_json, prompt_extra, chat_summary)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        oid,
        next.region_groups_json,
        next.pinned_constraints_json,
        next.schedule_prefs_json,
        next.prompt_extra,
        next.chat_summary,
      ]
    );
    return getOperatorAiRow(oid);
  }

  await pool.query(
    `UPDATE cln_operator_ai SET
       region_groups_json = COALESCE(?, region_groups_json),
       pinned_constraints_json = COALESCE(?, pinned_constraints_json),
       schedule_prefs_json = COALESCE(?, schedule_prefs_json),
       prompt_extra = COALESCE(?, prompt_extra),
       chat_summary = COALESCE(?, chat_summary),
       updated_at = CURRENT_TIMESTAMP(3)
     WHERE operator_id = ? LIMIT 1`,
    [
      patch.regionGroups !== undefined ? next.region_groups_json : null,
      patch.pinnedConstraints !== undefined ? next.pinned_constraints_json : null,
      patch.schedulePrefs !== undefined ? next.schedule_prefs_json : null,
      patch.promptExtra !== undefined ? next.prompt_extra : null,
      patch.chatSummary !== undefined ? next.chat_summary : null,
      oid,
    ]
  );
  return getOperatorAiRow(oid);
}

function rowToApiShape(row) {
  if (!row) {
    return {
      regionGroups: [],
      pinnedConstraints: [],
      schedulePrefs: defaultSchedulePrefs(),
      promptExtra: '',
      chatSummary: '',
      lastScheduleAiCronDayYmd: null,
      scheduleAiLastErrorAt: null,
      scheduleAiLastErrorMessage: null,
      scheduleAiLastErrorSource: null,
    };
  }
  const ymd = row.last_schedule_ai_cron_day != null ? String(row.last_schedule_ai_cron_day).slice(0, 10) : null;
  const errAt =
    row.schedule_ai_last_error_at != null ? String(row.schedule_ai_last_error_at) : null;
  return {
    regionGroups: normalizeRegionGroups(safeJsonParse(row.region_groups_json, [])),
    pinnedConstraints: safeJsonParse(row.pinned_constraints_json, []),
    schedulePrefs: normalizePrefs(safeJsonParse(row.schedule_prefs_json, {})),
    promptExtra: row.prompt_extra || '',
    chatSummary: row.chat_summary || '',
    lastScheduleAiCronDayYmd: ymd && /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null,
    scheduleAiLastErrorAt: errAt,
    scheduleAiLastErrorMessage:
      row.schedule_ai_last_error_message != null ? String(row.schedule_ai_last_error_message) : null,
    scheduleAiLastErrorSource:
      row.schedule_ai_last_error_source != null ? String(row.schedule_ai_last_error_source) : null,
  };
}

async function recordScheduleAiFailure(operatorId, message, source = 'midnight_batch') {
  const oid = String(operatorId || '').trim();
  if (!oid) return;
  const hasCol = await databaseHasColumn('cln_operator_ai', 'schedule_ai_last_error_at');
  if (!hasCol) return;
  const msg = String(message || 'Schedule AI failed').slice(0, 1024);
  const src = String(source || 'unknown').slice(0, 64);
  await pool.query(
    `UPDATE cln_operator_ai SET
       schedule_ai_last_error_at = CURRENT_TIMESTAMP(3),
       schedule_ai_last_error_message = ?,
       schedule_ai_last_error_source = ?,
       updated_at = CURRENT_TIMESTAMP(3)
     WHERE operator_id = ? LIMIT 1`,
    [msg, src, oid]
  );
}

async function clearScheduleAiFailure(operatorId) {
  const oid = String(operatorId || '').trim();
  if (!oid) return;
  const hasCol = await databaseHasColumn('cln_operator_ai', 'schedule_ai_last_error_at');
  if (!hasCol) return;
  await pool.query(
    `UPDATE cln_operator_ai SET
       schedule_ai_last_error_at = NULL,
       schedule_ai_last_error_message = NULL,
       schedule_ai_last_error_source = NULL,
       updated_at = CURRENT_TIMESTAMP(3)
     WHERE operator_id = ? LIMIT 1`,
    [oid]
  );
}

async function getOperatorAiSettingsForApi(operatorId) {
  const row = await getOperatorAiRow(operatorId);
  const base = rowToApiShape(row);
  let platformRules = [];
  try {
    platformRules = await clnSaasAiMd.listSaasadminAiMd();
  } catch (e) {
    const msg = String(e?.message || '');
    const c = String(e?.code || '');
    if (c !== 'ER_NO_SUCH_TABLE' && !msg.includes("doesn't exist") && !msg.includes('Unknown table')) {
      console.warn('[cln-operator-ai] list platform rules for operator UI:', e?.message || e);
    }
  }
  let platformOperatorAi = { accessEnabled: true, allowedDataScopes: ['cln_schedule'], updatedAt: null };
  try {
    platformOperatorAi = await clnSaasAiMd.getOperatorAiAccessPolicy();
  } catch (e) {
    const msg = String(e?.message || '');
    const c = String(e?.code || '');
    if (c !== 'ER_NO_SUCH_TABLE' && !msg.includes("doesn't exist") && !msg.includes('Unknown table')) {
      console.warn('[cln-operator-ai] operator AI access policy:', e?.message || e);
    }
  }
  return { ...base, platformRules, platformOperatorAi };
}

async function saveOperatorAiSettingsFromApi(operatorId, body = {}) {
  if (body && body.clearScheduleAiLastError === true) {
    await clearScheduleAiFailure(operatorId);
  }
  const patch = {};
  if (body.regionGroups !== undefined) patch.regionGroups = normalizeRegionGroups(body.regionGroups);
  if (body.pinnedConstraints !== undefined) patch.pinnedConstraints = body.pinnedConstraints;
  if (body.schedulePrefs !== undefined) patch.schedulePrefs = body.schedulePrefs;
  if (body.promptExtra !== undefined) patch.promptExtra = body.promptExtra;
  if (body.chatSummary !== undefined) patch.chatSummary = body.chatSummary;
  await upsertOperatorAiRow(operatorId, patch);
  return getOperatorAiSettingsForApi(operatorId);
}

async function appendChatMessage(operatorId, role, content, machineAppend = null) {
  const oid = String(operatorId || '').trim();
  if (!oid) throw new Error('MISSING_OPERATOR_ID');
  const r = String(role || '').toLowerCase();
  if (!['user', 'assistant', 'system'].includes(r)) throw new Error('INVALID_ROLE');
  let human = String(content ?? '').slice(0, 32000);
  const machRaw = machineAppend != null ? String(machineAppend).trim().slice(0, 16000) : '';
  const hasMachCol = await operatorAiChatHasMachineAppendColumn();
  if (!hasMachCol) {
    const combined = machRaw ? `${human.trimEnd()}${human.trim() ? '\n\n' : ''}${machRaw}`.trim() : human;
    if (!String(combined).trim()) throw new Error('EMPTY_CONTENT');
    await pool.query(
      'INSERT INTO cln_operator_ai_chat_message (id, operator_id, role, content, created_at) VALUES (?, ?, ?, ?, NOW(3))',
      [uuid(), oid, r, String(combined).slice(0, 32000)]
    );
    return;
  }
  let mach = machRaw || '';
  let h = human.trimEnd();
  if (!h.trim() && mach) {
    h = 'Please reply **yes**, **ok**, or **confirm** to proceed.';
  }
  if (!h.trim() && !mach) throw new Error('EMPTY_CONTENT');
  await pool.query(
    'INSERT INTO cln_operator_ai_chat_message (id, operator_id, role, content, machine_append, created_at) VALUES (?, ?, ?, ?, ?, NOW(3))',
    [uuid(), oid, r, h.slice(0, 32000), mach || null]
  );
}

async function listChatMessages(operatorId, limit = 40) {
  const oid = String(operatorId || '').trim();
  if (!oid) return [];
  const lim = Math.min(Math.max(Number(limit) || 40, 1), 100);
  const hasMachCol = await operatorAiChatHasMachineAppendColumn();
  const [rows] = await pool.query(
    hasMachCol
      ? `SELECT id, role, content, machine_append AS machineAppend, created_at AS createdAt
         FROM cln_operator_ai_chat_message
         WHERE operator_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      : `SELECT id, role, content, created_at AS createdAt
         FROM cln_operator_ai_chat_message
         WHERE operator_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
    [oid, lim]
  );
  return (rows || []).reverse();
}

function openAiCompatibleUrl(provider) {
  const p = String(provider || '').toLowerCase();
  if (p === 'deepseek') return 'https://api.deepseek.com/v1/chat/completions';
  return 'https://api.openai.com/v1/chat/completions';
}

function defaultModel(provider) {
  const p = String(provider || '').toLowerCase();
  if (p === 'gemini') return 'gemini-1.5-flash';
  if (p === 'deepseek') return 'deepseek-chat';
  return 'gpt-4o-mini';
}

async function callChatCompletionsOpenAiCompatible({ apiKey, provider, model, messages, temperature = 0.2 }) {
  const url = openAiCompatibleUrl(provider);
  const { data } = await axios.post(
    url,
    {
      model: model || defaultModel(provider),
      messages,
      temperature,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 120000,
    }
  );
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('LLM_EMPTY_RESPONSE');
  return String(text);
}

async function callGemini({ apiKey, model, systemText, userText }) {
  const m = model || 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const parts = [];
  if (systemText) parts.push({ text: `System instructions:\n${systemText}\n\n` });
  parts.push({ text: userText });
  const { data } = await axios.post(
    url,
    {
      contents: [{ role: 'user', parts: [{ text: parts.map((p) => p.text).join('') }] }],
      generationConfig: { temperature: 0.2 },
    },
    { timeout: 120000 }
  );
  const t = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!t) throw new Error('LLM_EMPTY_RESPONSE');
  return String(t);
}

async function invokeOperatorLlm({ provider, apiKey, system, user }) {
  const p = String(provider || '').toLowerCase();
  if (p === 'gemini') {
    return callGemini({ apiKey, model: defaultModel('gemini'), systemText: system, userText: user });
  }
  return callChatCompletionsOpenAiCompatible({
    apiKey,
    provider: p,
    model: defaultModel(p),
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
}

function isLlmQuotaOrAuthError(err) {
  const status = Number(err?.response?.status);
  if (status === 401 || status === 402 || status === 403 || status === 429) return true;
  const blob = `${JSON.stringify(err?.response?.data || {})} ${String(err?.message || '')}`;
  return /insufficient[_\s]?quota|invalid[_\s]?api[_\s]?key|billing_hard|rate[_\s]?limit|RESOURCE_EXHAUSTED|exceeded your current quota/i.test(
    blob
  );
}

/** First top-level `{ ... }` slice with string-aware brace matching (handles `}` inside "reason"). */
function extractBalancedJsonSlice(s0) {
  const s = String(s0 || '');
  const start = s.indexOf('{');
  if (start === -1) return '';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i += 1) {
    const c = s[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (inStr) {
      if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return '';
}

function extractJsonObject(text) {
  let s = String(text || '').trim();
  if (!s) throw new Error('LLM_JSON_PARSE');
  s = s.replace(/^\uFEFF/, '').normalize('NFKC');

  const candidates = [];
  const reFence = /```(?:json)?\s*([\s\S]*?)```/gi;
  let fm;
  while ((fm = reFence.exec(s)) !== null) candidates.push(String(fm[1] || '').trim());
  candidates.push(s);

  const tryParse = (raw0) => {
    const raw = String(raw0 || '').trim();
    if (!raw) return null;
    let slice = extractBalancedJsonSlice(raw);
    if (!slice) {
      const st = raw.indexOf('{');
      const en = raw.lastIndexOf('}');
      if (st !== -1 && en > st) slice = raw.slice(st, en + 1);
    }
    if (!slice) return null;
    slice = slice.replace(/[\u201c\u201d]/g, '"');
    try {
      return JSON.parse(slice);
    } catch {
      return null;
    }
  };

  for (const c of candidates) {
    const p = tryParse(c);
    if (p) return p;
    const brace = c.indexOf('{');
    if (brace > 0) {
      const p2 = tryParse(c.slice(brace));
      if (p2) return p2;
    }
  }
  throw new Error('LLM_JSON_PARSE');
}

/** Avoid `LLM_JSON_PARSE: LLM_JSON_PARSE` when re-wrapping. */
function wrapLlmJsonParseError(e) {
  let msg = String(e?.message || e || '').trim();
  if (!msg || msg === 'LLM_JSON_PARSE') msg = 'model output was not valid JSON';
  else msg = msg.replace(/^LLM_JSON_PARSE:?\s*/i, '').trim() || 'model output was not valid JSON';
  return new Error(`LLM_JSON_PARSE: ${msg}`);
}

const SCHEDULE_LLM_JSON_ONLY_TAIL =
  '\n\nReply with one JSON object only — no text before or after the outer `{` `}`. Match the schema from the system message.';

/** Strip trailing `OPTIONS_JSON:[...]` from assistant reply; return body + parsed buttons. */
function splitOptionsSuffixFromAssistantReply(text) {
  const s = String(text || '').trimEnd();
  const marker = 'OPTIONS_JSON:';
  const idx = s.lastIndexOf(marker);
  if (idx === -1) return { body: s.trim(), options: [] };
  const body = s.slice(0, idx).trimEnd();
  const jsonPart = s.slice(idx + marker.length).trim();
  try {
    const arr = JSON.parse(jsonPart);
    const options = Array.isArray(arr)
      ? arr
          .filter((o) => o && (o.id != null || o.label != null))
          .map((o) => ({
            id: String(o.id != null ? o.id : o.label || '').trim().slice(0, 64),
            label: String(o.label != null ? o.label : o.id || '').trim().slice(0, 200),
          }))
          .filter((o) => o.id && o.label)
          .slice(0, 8)
      : [];
    return { body: (body || '').trim() || s.trim(), options };
  } catch {
    return { body: s.trim(), options: [] };
  }
}

/** Reuse calendar dates the model already stated (e.g. "April 21, 2026") when the user only says "list them". */
function detectExplicitYmdFromRecentAssistantBodies(historyRows, defaultYearYyyy) {
  const assistants = (Array.isArray(historyRows) ? historyRows : [])
    .filter((h) => String(h.role) === 'assistant')
    .slice(-4);
  for (let i = assistants.length - 1; i >= 0; i -= 1) {
    const { body } = splitOptionsSuffixFromAssistantReply(fullAssistantStoredBody(assistants[i]));
    const y = detectExplicitCalendarYmdFromMessage(String(body || '').trim(), defaultYearYyyy);
    if (y) return y;
  }
  return '';
}

/** Only keys that exist on default schedule prefs — blocks arbitrary JSON from the model. */
function whitelistSchedulePrefsPatch(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const d = defaultSchedulePrefs();
  const out = {};
  for (const k of Object.keys(d)) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  }
  return Object.keys(out).length ? out : null;
}

/** Rejoin human `content` + server-only `machineAppend` for consent parsers and LLM thread context. */
function fullAssistantStoredBody(row) {
  if (!row) return '';
  const c = String(row.content || '');
  const m = row.machineAppend != null && String(row.machineAppend).trim() ? String(row.machineAppend).trim() : '';
  if (!m) return c;
  return `${c}\n\n${m}`.trimEnd();
}

/**
 * Operator chat (settings assistant) — stores messages; optional merge of extracted constraints.
 */
function findPreviousAssistantBodyFromHistory(historyRows) {
  const arr = Array.isArray(historyRows) ? historyRows : [];
  for (let i = arr.length - 2; i >= 0; i -= 1) {
    if (String(arr[i].role) === 'assistant') {
      const { body } = splitOptionsSuffixFromAssistantReply(fullAssistantStoredBody(arr[i]));
      return String(body || '').trim();
    }
  }
  return '';
}

/**
 * User confirms a schedule DB write — short natural replies only after `assistantAskedScheduleExecuteConsent` is true.
 */
function isExplicitScheduleExecuteConsentMessage(raw) {
  const t = String(raw || '').trim();
  if (!t || t.length > 48) return false;
  const noTrail = t.replace(/[.!…。!，,?？]+$/u, '').trim();
  const lower = noTrail.toLowerCase();

  if (/^(no|nope|wait|stop|cancel|delay|later|jangan|tidak)\b/i.test(lower)) return false;

  if (/^确认执行$/u.test(noTrail)) return true;
  if (/^执行确认$/u.test(noTrail)) return true;
  if (/^CONFIRM_EXECUTE$/i.test(noTrail)) return true;
  if (/^SAHKAN_LAKSANA$/i.test(noTrail)) return true;
  if (/^sahkan\s+pelaksanaan$/i.test(noTrail)) return true;
  if (/^ya,\s*laksana$/i.test(noTrail)) return true;
  if (/^yes\s*,?\s*execute$/i.test(noTrail)) return true;
  if (/^execute\s+now$/i.test(noTrail)) return true;

  if (noTrail.length <= 22 && /^(yes|y|confirm|confirmed|ok|okay|sure|proceed|go\s+ahead)$/i.test(lower)) return true;
  if (noTrail.length <= 36 && /^(confirm(\s+proceed)?|ok\s*,?\s*proceed|yes\s*,?\s*proceed)$/i.test(lower)) return true;
  if (noTrail.length <= 18 && /^(do\s+now|do\s+it\s*now|do\s+it)$/i.test(lower)) return true;
  if (noTrail.length <= 6 && /^only$/i.test(lower)) return true;
  if (noTrail.length <= 18 && /^(ya|betul|boleh|sahkan|teruskan|mula|ok\s+boleh)$/i.test(lower)) return true;
  if (noTrail.length <= 8 && /^(好|行|可以|确认|确定|同意)$/u.test(noTrail)) return true;

  return false;
}

/**
 * After Jarvis asked to confirm a delete, operators sometimes reply with a short phrase
 * ("delete arc today") instead of only "yes" — treat as consent so the DB path runs
 * (the LLM must not claim success without this).
 */
function isAffirmativeScheduleDeleteReply(raw, prevAssistantBody) {
  if (!assistantAskedScheduleJobDeleteConsent(String(prevAssistantBody || ''))) return false;
  const t = String(raw || '').trim();
  if (!t || t.length > 96) return false;
  const lower = t.toLowerCase();
  if (/^(no|nope|wait|stop|cancel|later|dont|don't|do not)\b/i.test(lower)) return false;
  if (/\bnot\s+delete\b/i.test(lower) || /\bdon'?t\s+delete\b/i.test(lower) || /\bdo\s+not\s+delete\b/i.test(lower)) return false;
  const deleteIdx = lower.search(/\bdelete\b/);
  const deleteNearStart = deleteIdx >= 0 && deleteIdx <= 28;
  if (
    deleteNearStart &&
    /\bdelete\b/i.test(lower) &&
    /\b(today|yesterday|tomorrow|this\s+day)\b/i.test(lower)
  ) {
    return true;
  }
  if (/\bdelete\b.*\b(ok|yes|confirm|proceed|go\s+ahead|please)\b/i.test(lower)) return true;
  if (/^(ok|yes|confirm|proceed|go\s+ahead)\b[^.]{0,40}\bdelete\b/i.test(lower)) return true;
  if (/^(删|删除|确认删|确认删除)/u.test(t)) return true;
  return false;
}

/** Shared: assistant asked operator to confirm with yes/ok (team assign, status bulk, etc.). */
function hasJarvisOperatorDbConsentPrompt(s) {
  const t = String(s || '');
  return (
    /请回复|仅回复|只(?:需)?回复|type\s+(yes|ok|confirm|ya)|please\s+(type|reply|enter)\s+(yes|ok|confirm|ya)|reply\s+(with\s+)?(yes|ok|confirm|ya)|respond\s+with\s+(yes|ok|confirm)|reply\s+only|only\s+reply|only\s+with|exactly|CONFIRM_EXECUTE|确认执行|SAHKAN_LAKSANA/i.test(
      t
    ) ||
    /tolong\s+(type|taip|balas)/i.test(t) ||
    /sila\s+(taip|ketik|balas)/i.test(t) ||
    // BM: "Sila sahkan dengan membalas **yes** …" (confirm create / team / status)
    /sila\s+sahkan/i.test(t) ||
    /untuk\s+meneruskan\s+penciptaan/i.test(t) ||
    /tekan\s+(ya|ok)/i.test(t) ||
    /请.{0,20}(输入|回复|打).{0,12}(yes|ok|好|确认)/iu.test(t) ||
    /是否同意/u.test(t) ||
    /\bconfirm\s+to\s+(proceed|continue)\b/i.test(t) ||
    /\bplease\s+confirm(\s+by)?\b/i.test(t) ||
    /\bconfirm\s+by\s+replying/i.test(t) ||
    /\b(yes|ok|proceed|do\s+now)\s+to\s+confirm\b/i.test(t) ||
    /\b(reply|type)\s+with\s+(yes|ok|proceed|do\s+now)\b/i.test(t) ||
    /\bplease\s+confirm[^.\n]{0,100}\bproceed\s+above\b/i.test(t) ||
    /\*\*only\*\*\s*with/i.test(t) ||
    /replying\s+\*\*only\*\*/i.test(t) ||
    /\bkami\s+akan\s+mula/i.test(t) ||
    /\bbalas\s+hanya|hanya\s+balas/i.test(t)
  );
}

/** Strip `**bold**` / `*italic*` markers for schedule text parsing. */
function stripMarkdownBoldForScheduleParse(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1');
  /** Orphan `**` from LLM (e.g. `**C-29-18` without closing pair) must not reach unit tokens. */
  s = s.replace(/\*+/g, '');
  return s.trim();
}

/** "ARC AUSTIN HILL (C-29-18)" on the Property line → split name + unit. */
function splitPropertyLineIntoNameAndUnitMaybe(propRaw) {
  const t = stripMarkdownBoldForScheduleParse(String(propRaw || '')).trim();
  const m = t.match(/^(.+?)\s*\(\s*([^)]+?)\s*\)\s*$/);
  if (!m) return null;
  const propertyName = normScheduleJobPropertyNameToken(String(m[1] || '').trim());
  const unitNumber = normScheduleJobUnitToken(String(m[2] || '').trim());
  return propertyName && unitNumber ? { propertyName, unitNumber } : null;
}

/**
 * Parses "**Job**: Name (Unit)" and common Jarvis summary shapes (not full-day auto-assign).
 * @returns {{ propertyName: string, unitToken: string } | null}
 */
function extractSingleJobAssignTargetFromAssistantBody(body) {
  const s = String(body || '');

  const pack = (nameRaw, unitRaw) => {
    const propertyName = normScheduleJobPropertyNameToken(stripMarkdownBoldForScheduleParse(nameRaw));
    const unitToken = normScheduleJobUnitToken(String(unitRaw || ''));
    if (propertyName && unitToken) return { propertyName, unitToken };
    return null;
  };

  const jobM =
    s.match(/\*\*Job\*\*\s*:\s*([^\n]+)/i) ||
    s.match(/(?:^|\n)\s*\d+\.\s*\*?\*?Job\*?\*\s*:\s*([^\n]+)/im);
  const line = String(jobM?.[1] || '').trim();
  if (line) {
    const paren = line.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    if (paren) {
      const r = pack(paren[1], paren[2]);
      if (r) return r;
    }
  }

  const mTheJobFor = s.match(
    /\b(?:update\s+)?(?:the\s+)?job\s+for\s+\*\*([^*]+)\*\*\s*\(\s*([^)]+?)\s*\)/i
  );
  if (mTheJobFor) {
    const r = pack(mTheJobFor[1], mTheJobFor[2]);
    if (r) return r;
  }

  const mJobForBold = s.match(/\bjob\s+for\s+\*\*([^*]+)\*\*\s*\(\s*([^)]+?)\s*\)/i);
  if (mJobForBold) {
    const r = pack(mJobForBold[1], mJobForBold[2]);
    if (r) return r;
  }

  const mAssignOf = s.match(/assignment\s+of\s+job\s+for\s+([^(\n]+?)\s*\(\s*([^)]+?)\s*\)/i);
  if (mAssignOf) {
    const r = pack(mAssignOf[1], mAssignOf[2]);
    if (r) return r;
  }

  const mForBoldTo = s.match(/\bfor\s+\*\*([^*]+)\*\*\s*\(\s*([^)]+?)\s*\)\s+to\s+/i);
  if (mForBoldTo) {
    const r = pack(mForBoldTo[1], mForBoldTo[2]);
    if (r) return r;
  }

  if (/\bteam\s*\d+\b/i.test(s) && /\bassign/i.test(s)) {
    const mBoldParen = s.match(/\*\*([^*\n]{2,120}?)\*\*\s*\(\s*([^)\s][^)]*?)\s*\)/);
    if (mBoldParen) {
      const r = pack(mBoldParen[1], mBoldParen[2]);
      if (r) return r;
    }
  }

  // Same property/unit as selective ready-to-clean (e.g. "Mark **BORA** (A-29-02) …") when there is exactly one hint.
  const head = assistantBodyBeforeConsentFooter(s);
  const hints = extractReadyToCleanPropertyHintsFromAssistant(head);
  if (hints.length === 1 && String(hints[0].name || '').trim() && String(hints[0].unit || '').trim()) {
    return {
      propertyName: normScheduleJobPropertyNameToken(String(hints[0].name || '')),
      unitToken: normScheduleJobUnitToken(String(hints[0].unit || '')),
    };
  }
  return null;
}

/**
 * Numbered Jarvis summary lines, e.g. "1. Change assignment of job for **PROP (UNIT)** to **Team 3**."
 * @returns {Array<{ propertyName: string, unitToken: string, teamDigit: string }>}
 */
function parseNumberedTeamReassignmentEntries(body) {
  const s = String(body || '');
  const head = assistantBodyBeforeConsentFooter(s);
  const out = [];
  const re =
    /^\s*\d+\.\s+Change assignment of job for\s+\*\*([^*]+)\*\*\s+to\s+\*\*Team\s*(\d+)\s*\*\*(?:\s+and[^\n]*)?/gim;
  let m;
  while ((m = re.exec(head)) !== null) {
    const inner = stripMarkdownBoldForScheduleParse(String(m[1] || '').trim());
    const paren = inner.match(/^(.+?)\s*\(\s*([^)]+?)\s*\)\s*$/);
    if (!paren) continue;
    const propertyName = normScheduleJobPropertyNameToken(String(paren[1] || ''));
    const unitToken = normScheduleJobUnitToken(String(paren[2] || ''));
    const teamDigit = String(m[2] || '').trim().replace(/^0+/, '') || '';
    if (propertyName && unitToken && teamDigit) {
      out.push({ propertyName, unitToken, teamDigit });
    }
  }
  return out;
}

/**
 * Numbered lines: "N. Change status of job for **PROP (UNIT)** to **pending-checkout**."
 * @returns {Array<{ name: string, unit: string }>}
 */
function parseNumberedPendingCheckoutEntries(body) {
  const s = String(body || '');
  const head = assistantBodyBeforeConsentFooter(s);
  const out = [];
  /** Match **pending-checkout**, **pending check out**, **pending-check out** (LLM varies). */
  const re =
    /^\s*\d+\.\s+Change status of job for\s+\*\*([^*]+)\*\*\s+to\s+\*\*pending[\s_-]*check[\s_-]*out\*\*\.?/gim;
  let m;
  while ((m = re.exec(head)) !== null) {
    const inner = stripMarkdownBoldForScheduleParse(String(m[1] || '').trim());
    const paren = inner.match(/^(.+?)\s*\(\s*([^)]+?)\s*\)\s*$/);
    if (paren) {
      const name = String(paren[1] || '').trim();
      const unit = String(paren[2] || '').trim();
      if (name && unit) out.push({ name, unit });
    }
  }
  return out;
}

/**
 * Numbered or single: "Delete job for **PROP (UNIT)**." Optional: " for **YYYY-MM-DD**."
 * @returns {Array<{ name: string, unit: string, dateYmd?: string }>}
 */
function parseNumberedJobDeleteEntries(body) {
  const s = String(body || '');
  const head = assistantBodyBeforeConsentFooter(s);
  const out = [];
  const re =
    /^\s*\d+\.\s+Delete job for\s+\*\*([^*]+)\*\*(?:\s+for\s+\*\*(\d{4}-\d{2}-\d{2})\*\*)?\.?/gim;
  let m;
  while ((m = re.exec(head)) !== null) {
    const inner = stripMarkdownBoldForScheduleParse(String(m[1] || '').trim());
    const paren = inner.match(/^(.+?)\s*\(\s*([^)]+?)\s*\)\s*$/);
    if (paren) {
      const name = String(paren[1] || '').trim();
      const unit = String(paren[2] || '').trim();
      const dateYmd = m[2] ? String(m[2] || '').trim().slice(0, 10) : '';
      if (name && unit) out.push({ name, unit, ...(dateYmd ? { dateYmd } : {}) });
    }
  }
  return out;
}

/** Non-numbered "Delete job for **…**" (one row). */
function extractSingleJobDeleteTargetsFromAssistant(body) {
  const s = String(body || '');
  const head = assistantBodyBeforeConsentFooter(s);
  if (/^\s*\d+\.\s+Delete job for\s+\*\*/im.test(head)) return [];
  const m = head.match(/\bDelete job for\s+\*\*([^*]+)\*\*(?:\s+for\s+\*\*(\d{4}-\d{2}-\d{2})\*\*)?/i);
  if (!m) return [];
  const inner = stripMarkdownBoldForScheduleParse(String(m[1] || '').trim());
  const paren = inner.match(/^(.+?)\s*\(\s*([^)]+?)\s*\)\s*$/);
  if (!paren) return [];
  const name = String(paren[1] || '').trim();
  const unit = String(paren[2] || '').trim();
  const dateYmd = m[2] ? String(m[2] || '').trim().slice(0, 10) : '';
  return name && unit ? [{ name, unit, ...(dateYmd ? { dateYmd } : {}) }] : [];
}

function assistantAskedSelectivePendingCheckoutConsent(text) {
  const s = String(text || '');
  if (!s.trim()) return false;
  if (extractScheduleJobCreateProposalFromAssistantBody(s)) return false;
  if (!hasJarvisOperatorDbConsentPrompt(s)) return false;
  if (parseNumberedPendingCheckoutEntries(s).length < 1) return false;
  if (assistantAskedScheduleExecuteConsent(s)) return false;
  if (assistantAskedScheduleStatusBulkConsent(s)) return false;
  if (assistantAskedSingleJobTeamAssignConsent(s)) return false;
  if (assistantAskedSelectiveReadyToCleanConsent(s)) return false;
  if (assistantAskedScheduleJobDeleteConsent(s)) return false;
  return true;
}

function assistantAskedScheduleJobDeleteConsent(text) {
  const s = String(text || '');
  if (!hasJarvisOperatorDbConsentPrompt(s)) return false;
  if (extractScheduleJobCreateProposalFromAssistantBody(s)) return false;
  return (
    parseNumberedJobDeleteEntries(s).length >= 1 || extractSingleJobDeleteTargetsFromAssistant(s).length >= 1
  );
}

/**
 * One schedule row + one Team N after yes — not full-day runScheduleAiSuggest.
 */
function assistantAskedSingleJobTeamAssignConsent(text) {
  const s = String(text || '');
  if (!hasJarvisOperatorDbConsentPrompt(s)) return false;
  if (extractScheduleJobCreateProposalFromAssistantBody(s)) return false;
  if (assistantAskedScheduleStatusBulkConsent(s)) return false;
  // Do not call assistantAskedBulkPendingCheckoutOnlyConsent / assistantAskedSelectiveReadyToCleanConsent here:
  // both call assistantAskedScheduleExecuteConsent → this function again → stack overflow.

  const numbered = parseNumberedTeamReassignmentEntries(s);
  if (numbered.length >= 2) {
    if (/\bserver\s+auto-?assign\b/i.test(s) || /是否执行\s*自动派队/u.test(s)) return false;
    // Numbered "Change assignment … to **Team N**" lines are authoritative: do not disable this
    // consent when copy says "all jobs for today" or matches assign-all fallback heuristics —
    // otherwise "yes" skips DB apply (schedule execute consent needs \\bassign\\b) and the model may
    // reply as if rows were updated.
    return true;
  }

  const digit = extractAssistantTeamDigitFromAssignSummary(s);
  if (!digit) return false;
  if (!extractSingleJobAssignTargetFromAssistantBody(s)) return false;
  if (/\bserver\s+auto-?assign\b/i.test(s) || /是否执行\s*自动派队/u.test(s)) return false;
  if (assistantPromisesAssignAllJobsToOneTeam(s)) return false;
  const head = assistantBodyBeforeConsentFooter(s);
  if (/\ball\s+jobs?\b/i.test(head) || /\bevery\s+job\b/i.test(head) || /\bassign\s+all\b/i.test(head)) return false;
  return true;
}

/**
 * Previous Jarvis reply offered a server-side team write (auto-assign / assign jobs) and asked for typed confirmation.
 */
function assistantAskedScheduleExecuteConsent(text) {
  const s = String(text || '');
  if (!s.trim()) return false;
  if (assistantAskedSingleJobTeamAssignConsent(s)) return false;

  const hasServerAutoAssignMarker =
    /是否执行\s*自动派队/u.test(s) ||
    /\bserver\s+auto-?assign\b/i.test(s) ||
    /\b(laksana|jalankan)\b[^.?\n]{0,120}\bauto-?assign\b/i.test(s) ||
    /\brun\s+(the\s+)?auto-?assign\b/i.test(s);

  /** Do not treat "**Job**:" field label as "assign all jobs" — that must use today/all/every/semua or server auto-assign. */
  const assignJobsToTeamIntent =
    /\bassign(?:ment)?s?\b/i.test(s) &&
    /\bteam\b/i.test(s) &&
    /\b(today|all|semua|hari\s+ini|every\s+job|jobs?\s+for\s+today|assign\s+all)\b/i.test(s);

  if (!(hasServerAutoAssignMarker || assignJobsToTeamIntent)) return false;
  return hasJarvisOperatorDbConsentPrompt(s);
}

/** Strip generic consent footer so "this status change" does not trigger bulk RTC. */
function assistantBodyBeforeConsentFooter(text) {
  const s = String(text || '');
  const idxs = [];
  const tryIdx = (re) => {
    const m = s.match(re);
    if (m && m.index != null) idxs.push(m.index);
  };
  tryIdx(/\n\s*Please\s+confirm\b/i);
  tryIdx(/\bPlease\s+confirm\s+by\b/i);
  tryIdx(/\bPlease\s+confirm\s+to\s+proceed\b/i);
  tryIdx(/\bPlease\s+confirm,\s*to\s+proceed\s+above\b/i);
  tryIdx(/\bPlease\s+confirm\s+to\s+proceed\s+above\b/i);
  tryIdx(/\n\s*请确认/i);
  tryIdx(/\breply\s+only\b/i);
  tryIdx(/\bconfirm\s+by\s+replying\b/i);
  tryIdx(/\bonly\s+with\s+\*\*yes\*\*/i);
  const cut = idxs.length ? Math.min(...idxs.filter((n) => n >= 0)) : -1;
  if (cut <= 0) return s.trim();
  const head = s.slice(0, cut).trim();
  return head || s.trim();
}

/**
 * Previous Jarvis reply offered bulk status → ready-to-clean (server write) and asked for confirmation.
 * Uses only the body *before* the consent footer so phrases like "this status change" do not imply "all jobs".
 */
function assistantAskedScheduleStatusBulkConsent(text) {
  const s = String(text || '');
  if (!s.trim()) return false;
  if (!/\bready\s*[- ]?to\s*[- ]?clean\b/i.test(s)) return false;
  const head = assistantBodyBeforeConsentFooter(s);
  const bulkIntent =
    /\ball\s+jobs?\b/i.test(head) ||
    /\bevery\s+job\b/i.test(head) ||
    /\bchange\s+(?:the\s+)?status\s+of\s+all\b/i.test(head) ||
    /\ball\s+[^.\n]{0,120}\bre ready\s*[- ]?to\s*[- ]?clean\b/i.test(head) ||
    /\b(set|move)\b[^.\n]{0,80}\ball\b[^.\n]{0,80}\bready\b/i.test(head);
  if (!bulkIntent) return false;
  return hasJarvisOperatorDbConsentPrompt(s);
}

/** Single-property / explicit "mark … (unit) … ready to clean" — not all jobs. */
function assistantAskedSelectiveReadyToCleanConsent(text) {
  const s = String(text || '');
  if (!s.trim()) return false;
  if (extractScheduleJobCreateProposalFromAssistantBody(s)) return false;
  if (!hasJarvisOperatorDbConsentPrompt(s)) return false;
  if (!/\bready\s*[- ]?to\s*[- ]?clean\b/i.test(s)) return false;
  if (assistantAskedScheduleExecuteConsent(s)) return false;
  if (assistantAskedScheduleStatusBulkConsent(s)) return false;
  const head = assistantBodyBeforeConsentFooter(s);
  return extractReadyToCleanPropertyHintsFromAssistant(head).length > 0;
}

const SCHEDULE_JOB_CREATE_JSON_PREFIX = 'SCHEDULE_JOB_CREATE_JSON:';

/** Machine-only lines kept in chat history for consent/apply — omit from API `reply` to the portal. */
const OPERATOR_AI_MACHINE_DISPLAY_LINE_PREFIXES = ['SCHEDULE_JOB_CREATE_JSON:', 'EXTRACT_JSON:'];

function stripOperatorScheduleAiMachineDisplayLinesForReply(text) {
  const lines = String(text || '').split(/\r?\n/);
  const kept = lines.filter((line) => {
    const t = line.trimStart();
    return !OPERATOR_AI_MACHINE_DISPLAY_LINE_PREFIXES.some((p) => t.startsWith(p));
  });
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

/** Split LLM output so human text goes to `content` and machine lines to `machine_append` (portal never loads the latter). */
function splitMachineLinesFromAssistantPersistText(fullText) {
  const lines = String(fullText || '').split(/\r?\n/);
  const human = [];
  const machine = [];
  for (const line of lines) {
    const trimmedStart = line.trimStart();
    if (OPERATOR_AI_MACHINE_DISPLAY_LINE_PREFIXES.some((p) => trimmedStart.startsWith(p))) {
      machine.push(line.trimEnd());
    } else {
      human.push(line);
    }
  }
  const humanJoined = human.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
  const machineJoined = machine.filter(Boolean).join('\n').trimEnd();
  return { human: humanJoined, machine: machineJoined };
}

function extractScheduleJobCreateProposalFromAssistantBody(text) {
  const s = String(text || '');
  const idx = s.lastIndexOf(SCHEDULE_JOB_CREATE_JSON_PREFIX);
  if (idx < 0) return null;
  let raw = s.slice(idx + SCHEDULE_JOB_CREATE_JSON_PREFIX.length).trim();
  const nl = raw.indexOf('\n');
  if (nl >= 0) raw = raw.slice(0, nl).trim();
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return null;
    return o;
  } catch {
    return null;
  }
}

function normalizeJarvisCreateServiceProvider(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  if (s === 'homestay' || s === 'homestay-cleaning') return 'homestay-cleaning';
  if (s === 'general' || s === 'general-cleaning') return 'general-cleaning';
  if (s === 'deep' || s === 'deep-cleaning') return 'deep-cleaning';
  if (s === 'warm' || s === 'warm-cleaning') return 'warm-cleaning';
  if (s === 'renovation' || s === 'renovation-cleaning') return 'renovation-cleaning';
  if (s === 'room-rental' || s === 'roomrental' || s === 'room-rental-cleaning') return 'room-rental-cleaning';
  if (s === 'commercial' || s === 'commercial-cleaning') return 'commercial-cleaning';
  if (s === 'office' || s === 'office-cleaning') return 'office-cleaning';
  return 'homestay-cleaning';
}

function serviceProviderToJarvisJobProposalTypeLabel(sp) {
  const n = normalizeJarvisCreateServiceProvider(sp);
  const map = {
    'homestay-cleaning': 'homestay cleaning',
    'general-cleaning': 'general cleaning',
    'deep-cleaning': 'deep cleaning',
    'warm-cleaning': 'warm cleaning',
    'renovation-cleaning': 'renovation cleaning',
    'room-rental-cleaning': 'room rental cleaning',
    'commercial-cleaning': 'commercial cleaning',
    'office-cleaning': 'office cleaning',
  };
  return map[n] || 'homestay cleaning';
}

/** en-GB day + month name + year, Malaysia civil calendar for that YYYY-MM-DD. */
function formatMalaysiaYmdWordsForJobProposal(ymd) {
  const d = String(ymd || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return d || '';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kuala_Lumpur',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date(`${d}T12:00:00+08:00`));
  } catch {
    return d;
  }
}

function humanAssistantHasJarvisJobCreateLabelBlock(human) {
  const s = String(human || '');
  return (
    /(^|\n)Type:\s*\S/m.test(s) &&
    /(^|\n)Property:\s*\S/m.test(s) &&
    /(^|\n)Unit Number:/m.test(s) &&
    /(^|\n)Date:\s*\S/m.test(s)
  );
}

/** OPTIONS_JSON suffix stays on human lines; preserve when rewriting job proposal text. */
function stripTrailingOptionsJsonFromHumanAssistantText(text) {
  const s = String(text || '');
  const marker = '\nOPTIONS_JSON:';
  const idx = s.lastIndexOf(marker);
  if (idx < 0) return { base: s.trimEnd(), optionsPart: '' };
  return { base: s.slice(0, idx).trimEnd(), optionsPart: s.slice(idx + 1).trim() };
}

/**
 * If the model emitted SCHEDULE_JOB_CREATE_JSON but skipped the mandatory Type/Property/Unit/Date block,
 * replace visible human text with a canonical block derived from JSON + operator portfolio (portal-only).
 */
function ensureJarvisJobCreateLabelBlockInPersistHuman(humanText, machineText, portfolioJsonStr) {
  const full = `${String(humanText || '')}\n${String(machineText || '')}`.trim();
  const proposal = extractScheduleJobCreateProposalFromAssistantBody(full);
  if (!proposal || !String(proposal.propertyId || '').trim()) return humanText;
  if (humanAssistantHasJarvisJobCreateLabelBlock(humanText)) return humanText;

  let items = [];
  try {
    const p = JSON.parse(String(portfolioJsonStr || '{}'));
    if (Array.isArray(p.items)) items = p.items;
  } catch {
    /* ignore */
  }

  const pid = String(proposal.propertyId || '').trim();
  const row = items.find((it) => String(it.propertyId || '').trim() === pid);
  const propertyName = row ? String(row.propertyName || '').trim() : '';
  if (!propertyName) return humanText;

  let unitNumber = row ? String(row.unitNumber || '').trim() : '';
  if (!unitNumber) unitNumber = '\u2014';

  const dateYmd = String(proposal.date || '').trim().slice(0, 10);
  const typeLabel = serviceProviderToJarvisJobProposalTypeLabel(proposal.serviceProvider);
  const dateWords = formatMalaysiaYmdWordsForJobProposal(dateYmd) || dateYmd;

  const { base: humanBase, optionsPart } = stripTrailingOptionsJsonFromHumanAssistantText(String(humanText || ''));

  const block = `To create cleaning job, here's the job proposal:
Type: ${typeLabel}
Property: ${propertyName}
Unit Number: ${unitNumber}
Date: ${dateWords}

Please confirm by replying **yes**, **ok**, or **confirm** to proceed with creating this job. Thank you!`;

  const rebuilt = optionsPart ? `${block}\n\n${optionsPart}` : block;
  return rebuilt;
}

function assistantAskedScheduleJobCreateConsent(text) {
  const s = String(text || '');
  /** Two+ numbered create blocks use implicit multi-apply, not a single machine JSON line. */
  if (parseMultiImplicitJobCreateEntriesFromAssistant(s).length >= 2) return false;
  const o = extractScheduleJobCreateProposalFromAssistantBody(s);
  if (!o) return false;
  if (!String(o.propertyId || '').trim()) return false;
  const dt = String(o.date || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dt)) return false;
  // serviceProvider may be omitted — apply path normalizes (e.g. homestay-cleaning).
  if (assistantAskedScheduleStatusBulkConsent(s)) return false;
  if (assistantAskedBulkPendingCheckoutOnlyConsent(s)) return false;
  const headRtc = assistantBodyBeforeConsentFooter(s);
  if (
    /\bready\s*[- ]?to\s*[- ]?clean\b/i.test(s) &&
    extractReadyToCleanPropertyHintsFromAssistant(headRtc).length > 0
  ) {
    return false;
  }
  // Machine line SCHEDULE_JOB_CREATE_JSON:… implies a pending server write after yes/ok — do not require
  // hasJarvisOperatorDbConsentPrompt (models often skip exact "please confirm" boilerplate).
  return true;
}

function normScheduleJobUnitToken(u) {
  return String(u || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function normScheduleJobPropertyNameToken(n) {
  return String(n || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\*+/g, '');
}

/**
 * When the model omits SCHEDULE_JOB_CREATE_JSON but lists Property + Unit, the label block (Type / Property / Unit Number / Date), or natural "… cleaning job for Name (Unit) …", and asks to confirm creating a row.
 * @returns {{ propertyName: string, unitNumber: string, serviceProvider: string } | null}
 */
function extractImplicitScheduleJobCreateFromAssistantBody(text) {
  const s = String(text || '');
  if (
    extractScheduleJobCreateProposalFromAssistantBody(s) &&
    parseMultiImplicitJobCreateEntriesFromAssistant(s).length < 2
  ) {
    return null;
  }

  const createIntent =
    /\bproceed with creating\b/i.test(s) ||
    /\bcreat(e|ing)\b[^.\n]{0,120}\b(this )?schedule\b/i.test(s) ||
    /\bcreat(e|ing)\b[^.\n]{0,120}\b(these|those|multiple|two|three|four|both)\s+jobs?\b/i.test(s) ||
    /\bbook(ing)?\b[^.\n]{0,100}\b(cleaning|homestay)\b/i.test(s) ||
    /\bnew\b[^.\n]{0,50}\b(cleaning )?job\b/i.test(s) ||
    /\badd(ing)?\b[^.\n]{0,80}\b(job|schedule)\b/i.test(s) ||
    /\buntuk\s+membuat\b/i.test(s) ||
    /\bmembuat\s+(?:job|jadual|schedule)\b/i.test(s) ||
    /\bmembuat\s+[^.\n]{0,80}\b(homestay|cleaning)\b/i.test(s) ||
    /\bpenciptaan\s+job\b/i.test(s) ||
    /\bmeneruskan\s+penciptaan\b/i.test(s) ||
    /** Chinese summaries + consent footers (implicit create, no SCHEDULE_JOB_CREATE_JSON). */
    /以继续创建/u.test(s) ||
    /继续创建(?:此|该)?工作/u.test(s) ||
    /创建今天/u.test(s) ||
    /创建[^。\n]{0,120}(?:民宿|打扫|清洁)/u.test(s) ||
    (/为了为/u.test(s) && /创建/u.test(s)) ||
    /以下是提案/u.test(s) ||
    (/提案/u.test(s) && /创建/u.test(s));

  const multi = parseMultiImplicitJobCreateEntriesFromAssistant(s);
  if (multi.length >= 2) return null;
  if (multi.length === 1) {
    if (!createIntent) return null;
    const e = multi[0];
    return {
      propertyName: e.propertyName,
      unitNumber: e.unitNumber,
      serviceProvider: e.serviceProvider,
    };
  }

  const unitM =
    s.match(/(?:^|\n)\s*Unit\s*Number\s*:\s*([^\n]+)/im) ||
    s.match(/\*\*Unit\s*Number\*{0,2}\s*:\s*([^\n]+)/i) ||
    s.match(/\*\*Unit\*\*\s*:\s*([^\n*]+)/i) ||
    s.match(/(?:^|\n)\s*\d+\.\s*\*?\*?Unit\*?\*\s*:\s*([^\n]+)/im) ||
    s.match(/(?:^|\n)\s*Unit\s*:\s*([^\n]+)/im);
  const propM =
    s.match(/\*\*Property\*{0,2}\s*:\s*([^\n]+)/i) ||
    s.match(/\*\*Property\*\*\s*:\s*([^\n*]+)/i) ||
    s.match(/(?:^|\n)\s*\d+\.\s*\*?\*?Property\*?\*\s*:\s*([^\n]+)/im) ||
    s.match(/(?:^|\n)\s*Property\s*:\s*([^\n]+)/im);

  let propertyName = '';
  let unitNumber = '';
  if (propM && unitM) {
    propertyName = normScheduleJobPropertyNameToken(
      stripMarkdownBoldForScheduleParse(String(propM[1] || '').trim())
    );
    unitNumber = normScheduleJobUnitToken(
      stripMarkdownBoldForScheduleParse(String(unitM[1] || '').trim()).replace(/\.\s*$/, '')
    );
  }
  if (!propertyName || !unitNumber) {
    const natural =
      s.match(
        /\b(?:homestay|deep|general|warm|renovation|commercial|office|room[-\s]?rental)\s+cleaning\s+job\s+for\s+([^(]+?)\s*\(\s*([^)\n]{1,64})\s*\)/i
      ) ||
      s.match(/\bnew\s+(?:homestay\s+)?cleaning\s+job\s+for\s+([^(]+?)\s*\(\s*([^)\n]{1,64})\s*\)/i) ||
      s.match(
        /\b(?:to\s+)?creat(?:e|ing)\s+(?:a\s+)?(?:new\s+)?(?:homestay\s+)?(?:cleaning\s+)?job\s+for\s+([^(]+?)\s*\(\s*([^)\n]{1,64})\s*\)/i
      ) ||
      s.match(/\bjob\s+for\s+([^(]{2,80}?)\s*\(\s*([^)\n]{1,64})\s*\)/i);
    if (natural) {
      propertyName = normScheduleJobPropertyNameToken(String(natural[1] || ''));
      unitNumber = normScheduleJobUnitToken(String(natural[2] || ''));
    }
  }
  if (!propertyName || !unitNumber) return null;
  if (!createIntent) return null;

  const jtM =
    s.match(/\*\*Job Type\*\*\s*:\s*([^\n]+)/i) ||
    s.match(/Job Type\s*:\s*([^\n]+)/im) ||
    s.match(/(?:^|\n)\s*Type\s*:\s*([^\n]+)/im);
  const jtRaw = String(jtM?.[1] || '').trim();
  let serviceProvider = jtRaw ? normalizeJarvisCreateServiceProvider(jtRaw.replace(/\s+/g, '-')) : 'homestay-cleaning';
  if (!jtRaw && /\bhomestay\b/i.test(s)) serviceProvider = 'homestay-cleaning';
  return { propertyName, unitNumber, serviceProvider };
}

function findOperatorPropertyRowByNameAndUnit(props, propertyName, unitNumber) {
  const na = normScheduleJobPropertyNameToken(propertyName);
  const ua = normScheduleJobUnitToken(unitNumber);
  const arr = Array.isArray(props) ? props : [];
  const naNoTrailParen = String(na || '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim();
  const nameCandidates = [...new Set([na, naNoTrailParen].map((x) => String(x || '').trim()).filter(Boolean))];
  const hits = [];
  for (const naTry of nameCandidates) {
    if (!naTry) continue;
    for (const p of arr) {
      const pn = normScheduleJobPropertyNameToken(String(p.name || ''));
      const un = normScheduleJobUnitToken(String(p.unitNumber || ''));
      if (!un || un !== ua) continue;
      const nameOk = pn === naTry || pn.includes(naTry) || naTry.includes(pn);
      if (!nameOk) continue;
      const score = pn === naTry ? 3 : pn.includes(naTry) && naTry.length >= 4 ? 2 : 1;
      hits.push({ p, score });
    }
  }
  const byId = new Map();
  for (const h of hits) {
    const id = String(h.p?.id || '');
    if (!id) continue;
    const prev = byId.get(id);
    if (!prev || h.score > prev.score) byId.set(id, h);
  }
  const deduped = [...byId.values()].sort((a, b) => b.score - a.score);
  return deduped[0]?.p || null;
}

/** "23 April 2026" / ISO in a Date: line → YYYY-MM-DD (Malaysia civil day). */
function parseJobCreateDateHintToYmd(raw) {
  const t = String(raw || '').trim();
  if (!t) return '';
  const iso = t.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1].slice(0, 10);
  /** e.g. 2026年4月23日 — Malaysia civil calendar day as YYYY-MM-DD */
  const zh = t.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/u);
  if (zh) {
    const y = Number(zh[1]);
    const mo = Number(zh[2]);
    const da = Number(zh[3]);
    if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(da)) return '';
    if (mo < 1 || mo > 12 || da < 1 || da > 31) return '';
    const d = new Date(Date.UTC(y, mo - 1, da, 12, 0, 0));
    if (Number.isNaN(d.getTime())) return '';
    if (d.getUTCFullYear() !== y || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== da) return '';
    const mm = String(mo).padStart(2, '0');
    const dd = String(da).padStart(2, '0');
    return `${y}-${mm}-${dd}`;
  }
  const m = t.match(/\b(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\b/);
  if (!m) return '';
  const day = Number(m[1]);
  const monStr = String(m[2] || '')
    .toLowerCase()
    .replace(/\./g, '');
  const year = Number(m[3]);
  const months = {
    january: 0,
    february: 1,
    march: 2,
    april: 3,
    may: 4,
    june: 5,
    july: 6,
    august: 7,
    september: 8,
    october: 9,
    november: 10,
    december: 11,
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    sept: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  };
  const mi = months[monStr];
  if (mi == null || !Number.isFinite(day) || !Number.isFinite(year) || day < 1 || day > 31) return '';
  const d = new Date(Date.UTC(year, mi, day, 12, 0, 0));
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

/**
 * Numbered blocks: `1. **Type:** … **Property:** … **Unit Number:** … **Date:** …` then `2. **Type:** …`.
 * @returns {Array<{ propertyName: string, unitNumber: string, serviceProvider: string, dateHint: string }>}
 */
function parseMultiImplicitJobCreateEntriesFromAssistant(text) {
  const head = assistantBodyBeforeConsentFooter(String(text || ''));
  const lines = head.split(/\r?\n/);
  const blocks = [];
  let cur = [];
  const flush = () => {
    if (!cur.length) return;
    const joined = cur.join('\n');
    if (/\btype\b/i.test(joined) && /\bproperty\b/i.test(joined) && /\bunit\b/i.test(joined) && /number/i.test(joined)) {
      blocks.push(joined);
    }
    cur = [];
  };
  for (const line of lines) {
    if (/^\s*\d+\.\s+/.test(line) && /\btype\b/i.test(line)) {
      flush();
      cur = [line];
    } else if (cur.length) cur.push(line);
  }
  flush();
  const out = [];
  for (const block of blocks) {
    const typeM =
      block.match(/\*\*Type\*{0,2}\s*:\s*([^\n]+)/i) || block.match(/(?:^|\n)\s*Type\s*:\s*([^\n]+)/im);
    const propM =
      block.match(/\*\*Property\*{0,2}\s*:\s*([^\n]+)/i) || block.match(/(?:^|\n)\s*Property\s*:\s*([^\n]+)/im);
    const unitM =
      block.match(/\*\*Unit\s*Number\*{0,2}\s*:\s*([^\n]+)/i) || block.match(/(?:^|\n)\s*Unit\s*Number\s*:\s*([^\n]+)/im);
    const dateM = block.match(/\*\*Date\*{0,2}\s*:\s*([^\n]+)/i) || block.match(/(?:^|\n)\s*Date\s*:\s*([^\n]+)/im);
    if (!typeM || !propM || !unitM) continue;
    const propRaw0 = stripMarkdownBoldForScheduleParse(String(propM[1] || '').trim());
    const unitRaw0 = stripMarkdownBoldForScheduleParse(String(unitM[1] || '').trim()).replace(/\.\s*$/, '');
    const fromParen = splitPropertyLineIntoNameAndUnitMaybe(String(propM[1] || ''));
    let propertyName;
    let unitNumber;
    if (fromParen) {
      propertyName = fromParen.propertyName;
      const uLine = normScheduleJobUnitToken(unitRaw0);
      unitNumber = uLine || fromParen.unitNumber;
    } else {
      propertyName = normScheduleJobPropertyNameToken(propRaw0);
      unitNumber = normScheduleJobUnitToken(unitRaw0);
    }
    const jtRaw = stripMarkdownBoldForScheduleParse(String(typeM[1] || '').trim());
    let serviceProvider = jtRaw ? normalizeJarvisCreateServiceProvider(jtRaw.replace(/\s+/g, '-')) : 'homestay-cleaning';
    if (!jtRaw && /\bhomestay\b/i.test(block)) serviceProvider = 'homestay-cleaning';
    if (!propertyName || !unitNumber) continue;
    const dateHint = dateM ? stripMarkdownBoldForScheduleParse(String(dateM[1] || '').trim()) : '';
    out.push({ propertyName, unitNumber, serviceProvider, dateHint });
  }
  return out;
}

/**
 * Property + unit from the visible Jarvis label block (what the operator reads before yes/ok).
 * Used to correct wrong `propertyId` in SCHEDULE_JOB_CREATE_JSON when the model picks another unit.
 * @returns {{ propertyName: string, unitNumber: string } | null}
 */
function extractJobCreateProposalLabelPropertyUnit(text) {
  const s = String(text || '');
  const unitM =
    s.match(/(?:^|\n)\s*Unit\s*Number\s*:\s*([^\n]+)/im) ||
    s.match(/\*\*Unit\s*Number\*{0,2}\s*:\s*([^\n]+)/i) ||
    s.match(/\*\*Unit\*\*\s*:\s*([^\n*]+)/i) ||
    s.match(/(?:^|\n)\s*\d+\.\s*\*?\*?Unit\*?\*\s*:\s*([^\n]+)/im) ||
    s.match(/(?:^|\n)\s*Unit\s*:\s*([^\n]+)/im);
  const propM =
    s.match(/\*\*Property\*{0,2}\s*:\s*([^\n]+)/i) ||
    s.match(/\*\*Property\*\*\s*:\s*([^\n*]+)/i) ||
    s.match(/(?:^|\n)\s*\d+\.\s*\*?\*?Property\*?\*\s*:\s*([^\n]+)/im) ||
    s.match(/(?:^|\n)\s*Property\s*:\s*([^\n]+)/im);
  if (!propM || !unitM) return null;
  const propertyName = normScheduleJobPropertyNameToken(
    stripMarkdownBoldForScheduleParse(String(propM[1] || '').trim())
  );
  const unitRaw = stripMarkdownBoldForScheduleParse(String(unitM[1] || '').trim()).replace(/\.\s*$/, '');
  const unitNumber = normScheduleJobUnitToken(unitRaw);
  if (!propertyName || !unitNumber) return null;
  return { propertyName, unitNumber };
}

/** Model asked yes/ok to create a job from a text summary but did not emit SCHEDULE_JOB_CREATE_JSON. */
function assistantAskedImplicitScheduleJobCreateConsent(text) {
  const s = String(text || '');
  if (!hasJarvisOperatorDbConsentPrompt(s)) return false;
  if (assistantAskedScheduleExecuteConsent(s)) return false;
  if (assistantAskedScheduleStatusBulkConsent(s)) return false;
  if (assistantAskedBulkPendingCheckoutOnlyConsent(s)) return false;
  if (assistantAskedSelectivePendingCheckoutConsent(s)) return false;
  if (assistantAskedScheduleJobDeleteConsent(s)) return false;
  if (assistantAskedSelectiveReadyToCleanConsent(s)) return false;
  if (parseMultiImplicitJobCreateEntriesFromAssistant(s).length >= 2) return true;
  if (extractScheduleJobCreateProposalFromAssistantBody(s)) return false;
  return !!extractImplicitScheduleJobCreateFromAssistantBody(s);
}

/** Compact counts by reason for operator-facing chat (no PII). */
function summarizeScheduleSuggestRejectionsForChat(rejected) {
  if (!Array.isArray(rejected) || !rejected.length) return '';
  const counts = new Map();
  for (const r of rejected) {
    const k = String(r?.reason || 'UNKNOWN').trim().slice(0, 48) || 'UNKNOWN';
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([k, v]) => `${v}×${k}`)
    .join(', ');
}

function formatScheduleSuggestApplyReplyForChat(res, dayYmd, opts = {}) {
  const confirmExecuteFullDay = !!opts.confirmExecuteFullDay;
  if (!res) return 'No assignment run was performed.';
  if (res.error) return `Could not apply team assignments: ${res.error}`;
  if (res.ok === false && res.reason === 'INCOMPLETE_COVERAGE') {
    return `Could not apply: the model returned only ${res.got} of ${res.expected} required assignments for ${dayYmd}. Try again or assign teams manually on Schedule.`;
  }
  if (res.message === 'NO_ELIGIBLE_JOBS') {
    if (confirmExecuteFullDay) {
      return `No jobs could be auto-assigned for ${dayYmd} (all rows are in a terminal status, or there is nothing to assign). Open the Schedule Job list for that day.`;
    }
    return `No unassigned jobs needed a team for ${dayYmd} (all already have a team or are not eligible). Open the Schedule Job list for that day.`;
  }
  if (res.message === 'PAST_WORKING_DAY_READ_ONLY') {
    return `No team changes were saved: ${dayYmd} is before Malaysia today — auto-assign only updates jobs on today or future working days. Pick today or a future date on Schedule, then run auto-assign again.`;
  }
  const n = Number(res.applied) || 0;
  const rej = Array.isArray(res.rejected) ? res.rejected.length : 0;
  if (n > 0) {
    if (!rej) {
      return `Applied ${n} team assignment(s) for ${dayYmd} in the database. Refresh the Job list if you do not see updates yet.`;
    }
    const summary = summarizeScheduleSuggestRejectionsForChat(res.rejected);
    const detail = summary ? ` Details: ${summary}.` : '';
    return `Applied ${n} team assignment(s) for ${dayYmd} in the database. ${rej} row(s) were skipped — often invalid team id, ineligible job id, pinned team rule (property_only_teams), or save error.${detail} Refresh the Job list if you do not see updates yet.`;
  }
  return `No rows were updated for ${dayYmd}. Try Schedule → Save settings (with AI connected) for that day, or assign teams manually.`;
}

function formatScheduleStatusApplyReplyForChat(res, dayYmd) {
  if (!res) return 'No status update was performed.';
  if (res.message === 'PAST_WORKING_DAY_READ_ONLY') {
    return `No status changes were saved: ${dayYmd} is before Malaysia today — bulk updates only run for today or future working days.`;
  }
  const n = Number(res.applied) || 0;
  const rej = Array.isArray(res.rejected) ? res.rejected.length : 0;
  if (n > 0) {
    return `Updated ${n} job(s) to ready-to-clean for ${dayYmd} in the database.${rej ? ` ${rej} row(s) were skipped (not pending checkout, terminal, or update failed).` : ''} Refresh the Job list if you do not see updates yet.`;
  }
  return `No jobs were moved to ready-to-clean for ${dayYmd}. Only pending-checkout rows are updated; completed, cancelled, in-progress, or already-ready rows are skipped.`;
}

function humanServiceLabelForScheduleJobCreate(serviceProvider) {
  const k = String(serviceProvider || '').trim().toLowerCase();
  const map = {
    'homestay-cleaning': 'Homestay cleaning',
    'general-cleaning': 'General cleaning',
    'deep-cleaning': 'Deep cleaning',
    'warm-cleaning': 'Warm cleaning',
    'renovation-cleaning': 'Renovation cleaning',
    'room-rental-cleaning': 'Room rental cleaning',
    'commercial-cleaning': 'Commercial cleaning',
    'office-cleaning': 'Office cleaning',
  };
  return map[k] || 'Cleaning';
}

function formatScheduleJobCreateReplyForChat(res) {
  if (!res) return 'No job was created.';
  if (res.multi && Array.isArray(res.results)) {
    const ok = res.results.filter((r) => r.ok);
    const bad = res.results.filter((r) => !r.ok);
    const day = String(res.date || '').slice(0, 10);
    if (!ok.length) {
      const why = bad.map((b) => `${b.propertyName || ''} (${b.unitNumber || ''}): ${b.message || b.detail || 'failed'}`).join('; ');
      return `Could not create jobs for **${day}**. ${why || (res.message || res.reason || 'Unknown error')}.`;
    }
    const bits = ok.map((r) => {
      const svc = humanServiceLabelForScheduleJobCreate(r.serviceProvider);
      return `${svc} — **${r.propertyName || 'Property'}** (${r.unitNumber || '—'})`;
    });
    let msg = `Created **${ok.length}** job(s) for **${day}**: ${bits.join('; ')}. Refresh the Job list if you do not see them yet.`;
    if (bad.length) msg += ` (${bad.length} row(s) failed.)`;
    return msg;
  }
  if (res.ok && res.scheduleId) {
    const u = res.unitNumber ? ` (${res.unitNumber})` : '';
    const day = String(res.date || '').slice(0, 10);
    const svc = humanServiceLabelForScheduleJobCreate(res.serviceProvider);
    return `${svc} job added for **${res.propertyName || 'Property'}**${u} on **${day}**. Refresh the Job list if you do not see it yet.`;
  }
  return `Could not create job: ${res.message || res.reason || 'Unknown error'}.`;
}

async function tryApplyCreateScheduleJobFromAssistant({ operatorId, workingDay, prevAssistantBody, portalEmail }) {
  const oid = String(operatorId || '').trim();
  const day = String(workingDay || '').trim().slice(0, 10);
  const props = await cleanlemonSvc.listOperatorProperties({
    operatorId: oid,
    limit: 500,
    offset: 0,
    includeArchived: false,
  });
  const arr = Array.isArray(props) ? props : [];

  const multiEntries = parseMultiImplicitJobCreateEntriesFromAssistant(prevAssistantBody);
  const o = extractScheduleJobCreateProposalFromAssistantBody(prevAssistantBody);
  const useMultiCreate = multiEntries.length >= 2 || (multiEntries.length >= 1 && !o);

  if (useMultiCreate && multiEntries.length >= 1) {
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return {
        ok: false,
        applied: 0,
        reason: 'BAD_WORKING_DAY',
        message: 'Pick the working day on Schedule, then confirm again.',
      };
    }
    if (!isMalaysiaYmdOnOrAfterToday(day)) {
      return {
        ok: false,
        applied: 0,
        reason: 'PAST_DAY',
        message: 'That working day is before Malaysia today.',
      };
    }
    const results = [];
    const ids = [];
    for (const ent of multiEntries) {
      const dateFromHint = parseJobCreateDateHintToYmd(ent.dateHint);
      const dateRow =
        dateFromHint && /^\d{4}-\d{2}-\d{2}$/.test(dateFromHint) ? dateFromHint.slice(0, 10) : day;
      if (day && dateRow !== day) {
        results.push({
          ok: false,
          propertyName: ent.propertyName,
          unitNumber: ent.unitNumber,
          serviceProvider: ent.serviceProvider,
          message: 'DATE_TOOLBAR_MISMATCH',
          detail: `${dateRow} vs ${day}`,
        });
        continue;
      }
      const row = findOperatorPropertyRowByNameAndUnit(arr, ent.propertyName, ent.unitNumber);
      if (!row) {
        results.push({
          ok: false,
          propertyName: ent.propertyName,
          unitNumber: ent.unitNumber,
          serviceProvider: ent.serviceProvider,
          message: 'PROPERTY_LOOKUP_FAILED',
        });
        continue;
      }
      try {
        const sid = await cleanlemonSvc.createCleaningScheduleJobUnified({
          propertyId: String(row.id),
          date: dateRow,
          time: '09:00',
          serviceProvider: ent.serviceProvider,
          remarks: 'Jarvis (multi confirm)',
          operatorId: oid,
          source: 'operator_portal',
          status: 'pending-checkout',
          createdByEmail: portalEmail ? String(portalEmail).trim().toLowerCase() : undefined,
        });
        ids.push(String(sid));
        results.push({
          ok: true,
          scheduleId: String(sid),
          date: dateRow,
          propertyName: String(row.name || '').trim(),
          unitNumber: String(row.unitNumber || '').trim(),
          serviceProvider: ent.serviceProvider,
        });
      } catch (e) {
        results.push({
          ok: false,
          propertyName: ent.propertyName,
          unitNumber: ent.unitNumber,
          serviceProvider: ent.serviceProvider,
          message: String(e?.code || e?.message || e || 'CREATE_FAILED').slice(0, 200),
        });
      }
    }
    const nOk = results.filter((r) => r.ok).length;
    const firstOk = results.find((r) => r.ok);
    return {
      ok: nOk > 0,
      applied: nOk,
      multi: multiEntries.length >= 2,
      results,
      ids,
      date: day,
      ...(firstOk
        ? {
            scheduleId: firstOk.scheduleId,
            propertyName: firstOk.propertyName,
            unitNumber: firstOk.unitNumber,
            serviceProvider: firstOk.serviceProvider,
          }
        : {}),
      message: nOk ? 'MULTI_OK' : 'MULTI_NONE',
    };
  }

  let propertyId = '';
  let date = '';
  let timeHm = '09:00';
  let remarks = 'Jarvis';
  let priceOpt;
  let serviceProvider = 'homestay-cleaning';
  let propRow = null;

  if (o && String(o.propertyId || '').trim()) {
    propertyId = String(o.propertyId || '').trim();
    date = String(o.date || '').trim().slice(0, 10);
    timeHm =
      o.time != null && String(o.time).trim()
        ? String(o.time).trim().replace(/^\s+|\s+$/g, '').slice(0, 5)
        : '09:00';
    if (!/^\d{1,2}:\d{2}$/.test(timeHm)) timeHm = '09:00';
    if (!propertyId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return {
        ok: false,
        applied: 0,
        reason: 'BAD_PROPOSAL',
        message: 'Invalid propertyId or date in SCHEDULE_JOB_CREATE_JSON.',
      };
    }
    if (day && date !== day) {
      return {
        ok: false,
        applied: 0,
        reason: 'DATE_TOOLBAR_MISMATCH',
        message: `Proposal date ${date} must match the Schedule toolbar working day ${day}. Pick that day on Schedule and confirm again.`,
      };
    }
    propRow = arr.find((p) => String(p.id) === propertyId) || null;
    serviceProvider = normalizeJarvisCreateServiceProvider(o.serviceProvider);
    remarks = o.remarks != null ? String(o.remarks).slice(0, 2000) : '';
    if (o.price != null && String(o.price).trim() !== '') {
      const n = Number(o.price);
      // Ignore 0 from the model so Create Job default pricing can apply (same as omitting price).
      if (Number.isFinite(n) && n > 0) priceOpt = Math.round(n * 100) / 100;
    }
  } else {
    const im = extractImplicitScheduleJobCreateFromAssistantBody(prevAssistantBody);
    if (!im) {
      return {
        ok: false,
        applied: 0,
        reason: 'NO_CREATE_JSON',
        message:
          'Missing SCHEDULE_JOB_CREATE_JSON (or a readable Property + Unit + create summary) in the previous assistant message.',
      };
    }
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return {
        ok: false,
        applied: 0,
        reason: 'BAD_WORKING_DAY',
        message: 'Pick the working day on Schedule, then confirm again.',
      };
    }
    date = day;
    propRow = findOperatorPropertyRowByNameAndUnit(arr, im.propertyName, im.unitNumber);
    if (!propRow) {
      return {
        ok: false,
        applied: 0,
        reason: 'PROPERTY_LOOKUP_FAILED',
        message:
          'Could not match Property + Unit to your portfolio. Ask Jarvis to include SCHEDULE_JOB_CREATE_JSON with propertyId, or check spelling.',
      };
    }
    propertyId = String(propRow.id || '').trim();
    serviceProvider = normalizeJarvisCreateServiceProvider(im.serviceProvider);
    remarks = 'Jarvis (summary confirm)';
  }

  /** Operator-visible Property + Unit wins over machine JSON.propertyId when the model picks the wrong row. */
  const labelPu = extractJobCreateProposalLabelPropertyUnit(prevAssistantBody);
  if (labelPu) {
    const rowFromLabel = findOperatorPropertyRowByNameAndUnit(arr, labelPu.propertyName, labelPu.unitNumber);
    if (rowFromLabel) {
      propRow = rowFromLabel;
      propertyId = String(rowFromLabel.id || '').trim();
    } else if (!propRow) {
      return {
        ok: false,
        applied: 0,
        reason: 'PROPERTY_LOOKUP_FAILED',
        message: `Could not find "${String(labelPu.propertyName || '').replace(/\s+/g, ' ')}" (${String(labelPu.unitNumber || '')}) in your portfolio. Check spelling or add the unit under Properties.`,
      };
    }
  }

  if (!propRow || !propertyId) {
    return {
      ok: false,
      applied: 0,
      reason: 'PROPERTY_NOT_IN_PORTFOLIO',
      message: 'That property is not in this operator portfolio.',
    };
  }

  try {
    const id = await cleanlemonSvc.createCleaningScheduleJobUnified({
      propertyId,
      date,
      time: timeHm,
      serviceProvider,
      remarks: remarks || 'Jarvis',
      operatorId: oid,
      source: 'operator_portal',
      status: 'pending-checkout',
      createdByEmail: portalEmail ? String(portalEmail).trim().toLowerCase() : undefined,
      ...(priceOpt != null ? { price: priceOpt } : {}),
    });
    return {
      ok: true,
      applied: 1,
      scheduleId: id,
      date,
      propertyName: String(propRow.name || '').trim(),
      unitNumber: String(propRow.unitNumber || '').trim(),
      serviceProvider,
    };
  } catch (e) {
    const code = String(e?.code || '').trim();
    const msg = String(e?.message || e || 'CREATE_FAILED').trim();
    return { ok: false, applied: 0, reason: code || 'CREATE_FAILED', message: msg.slice(0, 500) };
  }
}

async function runOperatorAiChat({
  operatorId,
  userMessage,
  mergeExtractedConstraints = false,
  contextWorkingDay,
  portalEmail,
}) {
  const oid = String(operatorId || '').trim();
  if (!oid) throw new Error('MISSING_OPERATOR_ID');

  const gate = await getScheduleAiPlatformGate();

  await appendChatMessage(oid, 'user', userMessage);

  if (!gate.ok) {
    const hint =
      gate.code === 'OPERATOR_AI_SCOPE_SCHEDULE_DISABLED'
        ? OPERATOR_AI_SCOPE_SCHEDULE_DISABLED_HINT
        : OPERATOR_AI_PLATFORM_DISABLED_HINT;
    await appendChatMessage(oid, 'assistant', hint);
    return {
      reply: hint,
      options: [],
      pinnedMerged: false,
      schedulePrefsMerged: false,
      usedFallback: true,
    };
  }

  let creds;
  try {
    creds = await clnInt.getDecryptedAiApiKeyForOperator(oid);
  } catch (_) {
    creds = null;
  }
  if (!creds?.apiKey) {
    await appendChatMessage(oid, 'assistant', OPERATOR_AI_AGENT_PAYMENT_HINT);
    return {
      reply: OPERATOR_AI_AGENT_PAYMENT_HINT,
      options: [],
      pinnedMerged: false,
      schedulePrefsMerged: false,
      usedFallback: true,
    };
  }

  const settingsFull = await getOperatorAiSettingsForApi(oid);
  const { platformRules: _pr, ...settingsRest } = settingsFull;
  const settings = settingsRest;
  const history = await listChatMessages(oid, 16);

  const prevAssistantBody = findPreviousAssistantBodyFromHistory(history);
  const consentUserOk =
    isExplicitScheduleExecuteConsentMessage(userMessage) ||
    isAffirmativeScheduleDeleteReply(userMessage, prevAssistantBody);
  const consentPrevBulkPcoOnly = assistantAskedBulkPendingCheckoutOnlyConsent(prevAssistantBody);
  const consentPrevSelectivePco = assistantAskedSelectivePendingCheckoutConsent(prevAssistantBody);
  const consentPrevDeleteJob = assistantAskedScheduleJobDeleteConsent(prevAssistantBody);
  const consentPrevSingleJobTeam = assistantAskedSingleJobTeamAssignConsent(prevAssistantBody);
  const consentPrevTeam = assistantAskedScheduleExecuteConsent(prevAssistantBody);
  const consentPrevStatusBulk = assistantAskedScheduleStatusBulkConsent(prevAssistantBody);
  const consentPrevSelectiveRtc = assistantAskedSelectiveReadyToCleanConsent(prevAssistantBody);
  const consentPrevCreateJobJson = assistantAskedScheduleJobCreateConsent(prevAssistantBody);
  const consentPrevCreateJobImplicit = assistantAskedImplicitScheduleJobCreateConsent(prevAssistantBody);
  const consentPrevCreateJob = consentPrevCreateJobJson || consentPrevCreateJobImplicit;
  const explicitCreateProposal = extractScheduleJobCreateProposalFromAssistantBody(prevAssistantBody);
  const dayFromContext = normalizeScheduleContextYmd(contextWorkingDay);
  /** JSON proposal date, or implicit summary → toolbar day / Malaysia today. */
  const proposalDayForCreate =
    consentPrevCreateJobJson && explicitCreateProposal
      ? (() => {
          const d = String(explicitCreateProposal.date || '').trim().slice(0, 10);
          return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
        })()
      : consentPrevCreateJobImplicit
        ? (dayFromContext || malaysiaTodayYmd())
        : '';
  const dayForConfirm = dayFromContext || proposalDayForCreate;
  const consentPrevOk =
    consentPrevCreateJob ||
    consentPrevDeleteJob ||
    consentPrevSelectivePco ||
    consentPrevBulkPcoOnly ||
    consentPrevSingleJobTeam ||
    consentPrevTeam ||
    consentPrevStatusBulk ||
    consentPrevSelectiveRtc;
  // #region agent log
  __dbgJarvisYesFlow({
    hypothesisId: 'H1_H2',
    location: 'cln-operator-ai.service.js:runOperatorAiChat:consent_precheck',
    message: 'schedule yes-flow gate',
    data: {
      dayForConfirm: dayForConfirm || '',
      contextWorkingDayRaw: String(contextWorkingDay || '').slice(0, 14),
      mergeExtractedConstraints: !!mergeExtractedConstraints,
      consentUserOk,
      consentPrevCreateJob,
      consentPrevCreateJobJson: !!consentPrevCreateJobJson,
      consentPrevCreateJobImplicit: !!consentPrevCreateJobImplicit,
      consentPrevSingleJobTeam: !!consentPrevSingleJobTeam,
      consentPrevTeam,
      consentPrevStatusBulk,
      consentPrevSelectiveRtc,
      consentPrevOk,
      userLen: String(userMessage || '').trim().length,
      prevAssistantLen: String(prevAssistantBody || '').length,
      prevAssistantTail: String(prevAssistantBody || '').slice(-280),
    },
  });
  // #endregion
  if (dayForConfirm && consentUserOk && consentPrevOk) {
    if (consentPrevCreateJob) {
      const createRes = await tryApplyCreateScheduleJobFromAssistant({
        operatorId: oid,
        workingDay: dayForConfirm,
        prevAssistantBody,
        portalEmail,
      });
      const replyCreate = formatScheduleJobCreateReplyForChat(createRes).trim();
      await appendChatMessage(oid, 'assistant', replyCreate);
      if (createRes.ok && createRes.date) {
        if (createRes.multi && Array.isArray(createRes.ids) && createRes.ids.length) {
          for (const sid of createRes.ids) {
            maybeRunIncrementalAfterJobCreate(oid, createRes.date, sid);
          }
        } else if (createRes.scheduleId) {
          maybeRunIncrementalAfterJobCreate(oid, createRes.date, createRes.scheduleId);
        }
      }
      const createdDayRaw = String(createRes.date || dayForConfirm || '')
        .trim()
        .slice(0, 10);
      const workingDayForCreated = /^\d{4}-\d{2}-\d{2}$/.test(createdDayRaw)
        ? createdDayRaw
        : String(dayForConfirm || '')
            .trim()
            .slice(0, 10);
      const hasCreatedIds = createRes.ok && Array.isArray(createRes.ids) && createRes.ids.length;
      const hasCreatedSingle = createRes.ok && createRes.scheduleId;
      const scheduleJobCreatedPayload =
        hasCreatedIds && /^\d{4}-\d{2}-\d{2}$/.test(workingDayForCreated)
          ? {
              scheduleJobCreated: {
                ok: true,
                ids: createRes.ids.map((x) => String(x)),
                workingDay: workingDayForCreated,
              },
            }
          : hasCreatedSingle && /^\d{4}-\d{2}-\d{2}$/.test(workingDayForCreated)
            ? {
                scheduleJobCreated: {
                  ok: true,
                  id: String(createRes.scheduleId),
                  workingDay: workingDayForCreated,
                },
              }
            : {};
      const jobsCreatedCount =
        Array.isArray(createRes.ids) && createRes.ids.length
          ? createRes.ids.length
          : createRes.scheduleId
            ? 1
            : 0;
      return {
        reply: replyCreate,
        options: [],
        pinnedMerged: false,
        schedulePrefsMerged: false,
        usedFallback: false,
        ...scheduleJobCreatedPayload,
        ...(createRes.ok && jobsCreatedCount > 0 ? { scheduleListRefresh: true } : {}),
      };
    }

    if (consentPrevDeleteJob) {
      let delRes;
      try {
        delRes = await tryApplyDeleteScheduleJobsFromAssistant({
          operatorId: oid,
          workingDay: dayForConfirm,
          prevAssistantBody,
        });
      } catch (e) {
        const errText = String(e?.message || e);
        const reply = `Could not delete schedule row(s) for ${dayForConfirm}: ${errText}`;
        await appendChatMessage(oid, 'assistant', reply);
        return {
          reply,
          options: [],
          pinnedMerged: false,
          schedulePrefsMerged: false,
          usedFallback: false,
        };
      }
      const replyDel = formatScheduleDeleteReplyForChat(delRes, dayForConfirm).trim();
      await appendChatMessage(oid, 'assistant', replyDel);
      const delN = Number(delRes.applied) || 0;
      return {
        reply: replyDel,
        options: [],
        pinnedMerged: false,
        schedulePrefsMerged: false,
        usedFallback: false,
        ...(delN > 0 && delRes.ok
          ? { scheduleJobsDeleted: { ok: true, applied: delN, workingDay: dayForConfirm } }
          : {}),
      };
    }

    if (consentPrevSelectivePco) {
      const pcoSel = await tryApplySelectivePendingCheckoutFromAssistant({
        operatorId: oid,
        workingDay: dayForConfirm,
        prevAssistantBody,
      });
      const replyPcoSel =
        formatSchedulePendingCheckoutBulkReplyForChat(pcoSel, dayForConfirm).trim() ||
        `No pending-checkout status updates for ${dayForConfirm}.`;
      await appendChatMessage(oid, 'assistant', replyPcoSel);
      const nSel = Number(pcoSel.applied) || 0;
      return {
        reply: replyPcoSel,
        options: [],
        pinnedMerged: false,
        schedulePrefsMerged: false,
        usedFallback: false,
        ...(nSel > 0
          ? {
              scheduleStatusApplied: {
                ok: true,
                applied: nSel,
                workingDay: dayForConfirm,
              },
            }
          : {}),
      };
    }

    if (consentPrevBulkPcoOnly) {
      const pcoOnly = await tryApplyBulkRevertToPendingCheckoutForWorkingDay({
        operatorId: oid,
        workingDay: dayForConfirm,
      });
      const replyPco =
        formatSchedulePendingCheckoutBulkReplyForChat(pcoOnly, dayForConfirm).trim() ||
        `No pending-checkout status updates for ${dayForConfirm}.`;
      await appendChatMessage(oid, 'assistant', replyPco);
      const n = Number(pcoOnly.applied) || 0;
      return {
        reply: replyPco,
        options: [],
        pinnedMerged: false,
        schedulePrefsMerged: false,
        usedFallback: false,
        ...(n > 0
          ? {
              scheduleStatusApplied: {
                ok: true,
                applied: n,
                workingDay: dayForConfirm,
              },
            }
          : {}),
      };
    }

    if (consentPrevSingleJobTeam) {
      const numberedTeamLines = parseNumberedTeamReassignmentEntries(prevAssistantBody);
      let singleTeamRes;
      try {
        if (numberedTeamLines.length >= 2) {
          singleTeamRes = await tryApplyNumberedMultiJobTeamReassignmentsFromAssistant({
            operatorId: oid,
            workingDay: dayForConfirm,
            prevAssistantBody,
            pinnedConstraints: settings.pinnedConstraints,
          });
        } else {
          singleTeamRes = await tryApplySingleJobTeamFromAssistant({
            operatorId: oid,
            workingDay: dayForConfirm,
            prevAssistantBody,
            pinnedConstraints: settings.pinnedConstraints,
          });
        }
      } catch (e) {
        const errText = String(e?.message || e);
        const reply = `Could not assign team for ${dayForConfirm}: ${errText}`;
        await appendChatMessage(oid, 'assistant', reply);
        return {
          reply,
          options: [],
          pinnedMerged: false,
          schedulePrefsMerged: false,
          usedFallback: false,
          scheduleSuggestApplied: { ok: false, error: errText, workingDay: dayForConfirm },
        };
      }
      let replySingleTeam =
        numberedTeamLines.length >= 2
          ? formatNumberedMultiJobTeamAssignReplyForChat(singleTeamRes, dayForConfirm).trim()
          : formatSingleJobTeamAssignReplyForChat(singleTeamRes, dayForConfirm).trim();
      let rtcAfterSingle = { applied: 0, rejected: [] };
      if (/\bready\s*[- ]?to\s*[- ]?clean\b/i.test(prevAssistantBody)) {
        rtcAfterSingle = await tryApplySelectiveReadyToCleanFromAssistant({
          operatorId: oid,
          workingDay: dayForConfirm,
          prevAssistantBody,
        });
        const rtcN2 = Number(rtcAfterSingle.applied) || 0;
        const rtcR2 = Array.isArray(rtcAfterSingle.rejected) ? rtcAfterSingle.rejected.length : 0;
        if (rtcN2 > 0) {
          replySingleTeam = `${replySingleTeam} Additionally: updated ${rtcN2} matching job(s) to ready-to-clean for ${dayForConfirm}.${rtcR2 ? ` ${rtcR2} row(s) could not be updated (wrong status, terminal, or no text match).` : ''}`;
        }
      }
      let pcoAfterMixed = { applied: 0, rejected: [] };
      if (parseNumberedPendingCheckoutEntries(prevAssistantBody).length >= 1) {
        pcoAfterMixed = await tryApplySelectivePendingCheckoutFromAssistant({
          operatorId: oid,
          workingDay: dayForConfirm,
          prevAssistantBody,
        });
        const pcoN2 = Number(pcoAfterMixed.applied) || 0;
        const pcoR2 = Array.isArray(pcoAfterMixed.rejected) ? pcoAfterMixed.rejected.length : 0;
        if (pcoN2 > 0) {
          replySingleTeam = `${replySingleTeam} Additionally: set ${pcoN2} matching job(s) to pending-checkout for ${dayForConfirm}.${pcoR2 ? ` ${pcoR2} row(s) skipped (not ready-to-clean, terminal, or no match).` : ''}`;
        }
      }
      await appendChatMessage(oid, 'assistant', replySingleTeam);
      const singleN = Number(singleTeamRes.applied) || 0;
      const rtcNAfter = Number(rtcAfterSingle.applied) || 0;
      const pcoNAfter = Number(pcoAfterMixed.applied) || 0;
      const totalStatusApplied = rtcNAfter + pcoNAfter;
      return {
        reply: replySingleTeam,
        options: [],
        pinnedMerged: false,
        schedulePrefsMerged: false,
        usedFallback: false,
        ...(singleN > 0 && singleTeamRes.ok
          ? { scheduleSuggestApplied: { ok: true, applied: singleN, workingDay: dayForConfirm } }
          : {}),
        ...(totalStatusApplied > 0
          ? {
              scheduleStatusApplied: {
                ok: true,
                applied: totalStatusApplied,
                workingDay: dayForConfirm,
              },
            }
          : {}),
      };
    }

    if (consentPrevTeam) {
    // #region agent log
    __dbgJarvisYesFlow({
      hypothesisId: 'H3',
      location: 'cln-operator-ai.service.js:runOperatorAiChat:consent_branch_enter',
      message: 'running runScheduleAiSuggest apply=true includeExistingTeamJobs=true',
      data: { operatorId: oid, workingDay: dayForConfirm },
    });
    // #endregion
    let suggestRes;
    let usedStructuredMultiTeam = false;
    const structuredTeamRes = await tryApplyStructuredMultiTeamAssignmentPlan({
      operatorId: oid,
      workingDay: dayForConfirm,
      prevAssistantBody,
      pinnedConstraints: settings.pinnedConstraints,
    });
    if ((Number(structuredTeamRes.applied) || 0) > 0) {
      usedStructuredMultiTeam = true;
      suggestRes = {
        ok: true,
        applied: structuredTeamRes.applied,
        rejected: Array.isArray(structuredTeamRes.rejected) ? structuredTeamRes.rejected : [],
        assignments: Array.isArray(structuredTeamRes.assignments) ? structuredTeamRes.assignments : [],
        message: String(structuredTeamRes.message || 'STRUCTURED_MULTI_TEAM'),
      };
    }
    if (!usedStructuredMultiTeam) {
      try {
        suggestRes = await runScheduleAiSuggest({
          operatorId: oid,
          workingDay: dayForConfirm,
          apply: true,
          includeExistingTeamJobs: true,
        });
      } catch (e) {
        const errText = String(e?.message || e);
        // #region agent log
        __dbgJarvisYesFlow({
          hypothesisId: 'H3',
          location: 'cln-operator-ai.service.js:runOperatorAiChat:consent_catch',
          message: 'runScheduleAiSuggest threw',
          data: { errText: errText.slice(0, 500), workingDay: dayForConfirm },
        });
        // #endregion
        const reply = `Could not run auto-assign for ${dayForConfirm}: ${errText}`;
        await appendChatMessage(oid, 'assistant', reply);
        return {
          reply,
          options: [],
          pinnedMerged: false,
          schedulePrefsMerged: false,
          usedFallback: false,
          scheduleSuggestApplied: { ok: false, error: errText, workingDay: dayForConfirm },
        };
      }
      const wantAssignAllOneTeam = assistantPromisesAssignAllJobsToOneTeam(prevAssistantBody);
      if (wantAssignAllOneTeam) {
        const fbAll = await tryApplyAllJobsFromAssistantTeamAllIntent({
          operatorId: oid,
          workingDay: dayForConfirm,
          prevAssistantBody,
          pinnedConstraints: settings.pinnedConstraints,
        });
        // #region agent log
        __dbgJarvisYesFlow({
          hypothesisId: 'H6_ASSIGN_ALL_OVERRIDE',
          location: 'cln-operator-ai.service.js:runOperatorAiChat:assign_all_one_team_override',
          message: 'deterministic assign-all to summary team after suggest',
          data: {
            llmApplied: Number(suggestRes.applied) || 0,
            fbApplied: fbAll.applied,
            fbReason: String(fbAll.reason || ''),
            fbRejectedN: Array.isArray(fbAll.rejected) ? fbAll.rejected.length : -1,
          },
        });
        // #endregion
        if (fbAll.applied > 0) {
          suggestRes = {
            ok: true,
            assignments: Array.isArray(fbAll.assignments) ? fbAll.assignments : [],
            rejected: Array.isArray(fbAll.rejected) ? fbAll.rejected : [],
            applied: fbAll.applied,
            message: 'ASSISTANT_ASSIGN_ALL_ONE_TEAM',
          };
        }
      } else if ((Number(suggestRes.applied) || 0) === 0) {
        const fb = await tryApplyAllJobsFromAssistantTeamAllIntent({
          operatorId: oid,
          workingDay: dayForConfirm,
          prevAssistantBody,
          pinnedConstraints: settings.pinnedConstraints,
        });
        // #region agent log
        __dbgJarvisYesFlow({
          hypothesisId: 'H6_FALLBACK',
          location: 'cln-operator-ai.service.js:runOperatorAiChat:summary_fallback',
          message: 'deterministic assign-all after 0 applied',
          data: {
            fbApplied: fb.applied,
            fbReason: String(fb.reason || ''),
            fbRejectedN: Array.isArray(fb.rejected) ? fb.rejected.length : -1,
          },
        });
        // #endregion
        if (fb.applied > 0) {
          suggestRes = {
            ok: true,
            assignments: [...(Array.isArray(suggestRes.assignments) ? suggestRes.assignments : []), ...(fb.assignments || [])],
            rejected: [...(Array.isArray(suggestRes.rejected) ? suggestRes.rejected : []), ...(fb.rejected || [])],
            applied: fb.applied,
            message: 'ASSISTANT_SUMMARY_FALLBACK',
          };
        }
      }
    }
    // #region agent log
    __dbgJarvisYesFlow({
      hypothesisId: 'H4_H5',
      location: 'cln-operator-ai.service.js:runOperatorAiChat:consent_after_suggest',
      message: 'runScheduleAiSuggest returned',
      data: {
        ok: suggestRes.ok !== false,
        applied: Number(suggestRes.applied) || 0,
        message: String(suggestRes.message || ''),
        reason: String(suggestRes.reason || ''),
        rejectedN: Array.isArray(suggestRes.rejected) ? suggestRes.rejected.length : -1,
      },
    });
    // #endregion
    let rtcExtra = { applied: 0, rejected: [] };
    if (/\bready\s*[- ]?to\s*[- ]?clean\b/i.test(prevAssistantBody)) {
      rtcExtra = await tryApplySelectiveReadyToCleanFromAssistant({
        operatorId: oid,
        workingDay: dayForConfirm,
        prevAssistantBody,
      });
    }
    let pcoExtra = { applied: 0, rejected: [] };
    if (assistantAskedBulkPendingCheckoutAlongTeamExecuteConsent(prevAssistantBody)) {
      pcoExtra = await tryApplyBulkRevertToPendingCheckoutForWorkingDay({
        operatorId: oid,
        workingDay: dayForConfirm,
      });
    }
    const baseReply = formatScheduleSuggestApplyReplyForChat(suggestRes, dayForConfirm, {
      confirmExecuteFullDay: true,
    });
    const rtcN = Number(rtcExtra.applied) || 0;
    const rtcRej = Array.isArray(rtcExtra.rejected) ? rtcExtra.rejected.length : 0;
    const pcoLine = formatSchedulePendingCheckoutBulkReplyForChat(pcoExtra, dayForConfirm);
    let reply = baseReply;
    if (rtcN > 0) {
      reply = `${reply} Additionally: updated ${rtcN} matching job(s) to ready-to-clean for ${dayForConfirm}.${rtcRej ? ` ${rtcRej} row(s) could not be updated (wrong status, terminal, or no text match).` : ''}`;
    }
    if (pcoLine) {
      reply = `${reply} ${pcoLine}`;
    }
    await appendChatMessage(oid, 'assistant', reply);
    const pcoN = Number(pcoExtra.applied) || 0;
    const statusAppliedN = rtcN + pcoN;
    return {
      reply,
      options: [],
      pinnedMerged: false,
      schedulePrefsMerged: false,
      usedFallback: false,
      scheduleSuggestApplied: {
        ok: suggestRes.ok !== false,
        applied: Number(suggestRes.applied) || 0,
        workingDay: dayForConfirm,
        reason: suggestRes.reason,
        message: suggestRes.message,
      },
      ...(statusAppliedN > 0
        ? {
            scheduleStatusApplied: {
              ok: true,
              applied: statusAppliedN,
              workingDay: dayForConfirm,
            },
          }
        : {}),
    };
    }

    if (consentPrevStatusBulk) {
      // #region agent log
      __dbgJarvisYesFlow({
        hypothesisId: 'H7_STATUS',
        location: 'cln-operator-ai.service.js:runOperatorAiChat:bulk_ready_to_clean',
        message: 'tryApplyBulkReadyToCleanForWorkingDay',
        data: { operatorId: oid, workingDay: dayForConfirm },
      });
      // #endregion
      const statusResBulk = await tryApplyBulkReadyToCleanForWorkingDay({
        operatorId: oid,
        workingDay: dayForConfirm,
      });
      const replyBulk = formatScheduleStatusApplyReplyForChat(statusResBulk, dayForConfirm);
      await appendChatMessage(oid, 'assistant', replyBulk);
      return {
        reply: replyBulk,
        options: [],
        pinnedMerged: false,
        schedulePrefsMerged: false,
        usedFallback: false,
        scheduleStatusApplied: {
          ok: true,
          applied: Number(statusResBulk.applied) || 0,
          workingDay: dayForConfirm,
        },
      };
    }

    if (consentPrevSelectiveRtc) {
      // #region agent log
      __dbgJarvisYesFlow({
        hypothesisId: 'H7_STATUS_SELECTIVE',
        location: 'cln-operator-ai.service.js:runOperatorAiChat:selective_ready_to_clean',
        message: 'tryApplySelectiveReadyToCleanFromAssistant',
        data: { operatorId: oid, workingDay: dayForConfirm },
      });
      // #endregion
      const selResOnly = await tryApplySelectiveReadyToCleanFromAssistant({
        operatorId: oid,
        workingDay: dayForConfirm,
        prevAssistantBody,
      });
      const digitRtc = extractAssistantTeamDigitFromAssignSummary(prevAssistantBody);
      const hasRtcSingleTarget = !!extractSingleJobAssignTargetFromAssistantBody(prevAssistantBody);
      let singleTeamAfterRtc = { ok: false, applied: 0, message: '' };
      if (digitRtc && hasRtcSingleTarget) {
        try {
          singleTeamAfterRtc = await tryApplySingleJobTeamFromAssistant({
            operatorId: oid,
            workingDay: dayForConfirm,
            prevAssistantBody,
            pinnedConstraints: settings.pinnedConstraints,
          });
        } catch (_) {
          /* status already applied */
        }
      }
      const statusResSel = {
        ok: true,
        applied: selResOnly.applied,
        rejected: selResOnly.rejected,
        workingDay: dayForConfirm,
      };
      let replySel = formatScheduleStatusApplyReplyForChat(statusResSel, dayForConfirm);
      const teamN = Number(singleTeamAfterRtc.applied) || 0;
      if (digitRtc && hasRtcSingleTarget) {
        const teamLine = formatSingleJobTeamAssignReplyForChat(singleTeamAfterRtc, dayForConfirm).trim();
        if (teamLine) replySel = `${replySel.trim()} ${teamLine}`;
      }
      await appendChatMessage(oid, 'assistant', replySel.trim());
      return {
        reply: replySel.trim(),
        options: [],
        pinnedMerged: false,
        schedulePrefsMerged: false,
        usedFallback: false,
        scheduleStatusApplied: {
          ok: true,
          applied: Number(selResOnly.applied) || 0,
          workingDay: dayForConfirm,
        },
        ...(teamN > 0 && singleTeamAfterRtc.ok
          ? { scheduleSuggestApplied: { ok: true, applied: teamN, workingDay: dayForConfirm } }
          : {}),
      };
    }
  }

  const histLines = history
    .filter((h) => h.role !== 'system')
    .map((h) => {
      if (String(h.role) === 'assistant') {
        const { body } = splitOptionsSuffixFromAssistantReply(fullAssistantStoredBody(h));
        return `${h.role}: ${body}`;
      }
      return `${h.role}: ${h.content}`;
    })
    .join('\n');

  const pr = await safePlatformRulesPrefix();
  const dayForJobs = normalizeScheduleContextYmd(contextWorkingDay) || malaysiaTodayYmd();
  const { workingDay: chatWorkingDay, jobsJson: chatJobsJson } = await loadScheduleJobsForOperatorChat(oid, dayForJobs);

  let operatorPropertiesPortfolioJson = '{"totalProperties":0,"items":[]}';
  try {
    const props = await cleanlemonSvc.listOperatorProperties({
      operatorId: oid,
      limit: 400,
      offset: 0,
      includeArchived: false,
    });
    const items = (Array.isArray(props) ? props : []).map((p) => ({
      propertyId: p.id,
      propertyName: String(p.name || '').trim(),
      unitNumber: String(p.unitNumber || '').trim(),
      address: String(p.address || '').trim().slice(0, 200),
      client: String(p.client || '').trim().slice(0, 120),
    }));
    operatorPropertiesPortfolioJson = JSON.stringify({ totalProperties: items.length, items });
  } catch (e) {
    operatorPropertiesPortfolioJson = JSON.stringify({
      totalProperties: 0,
      items: [],
      loadError: String(e?.message || 'LOAD_FAILED').slice(0, 200),
    });
  }

  const defaultYearForExplicit = dayForJobs.slice(0, 4);
  const dayHints = resolveScheduleDayHintsFromUserThread(history, defaultYearForExplicit);
  const { relOff, lastNamedWeekdaySun0: lastWdSun0 } = dayHints;
  let explicitDay = dayHints.explicitYmd;
  if (!explicitDay) {
    const fromAssist = detectExplicitYmdFromRecentAssistantBodies(history, defaultYearForExplicit);
    if (fromAssist) explicitDay = fromAssist;
  }

  const relativeDay =
    relOff !== 0 ? malaysiaCalendarAddDays(dayForJobs, relOff) : '';
  let relativeJobsJson = '';
  let relativeWorkingDay = '';
  if (relativeDay && relativeDay !== chatWorkingDay) {
    const rel = await loadScheduleJobsForOperatorChat(oid, relativeDay);
    relativeWorkingDay = rel.workingDay;
    relativeJobsJson = rel.jobsJson;
  }

  const namedPastDay =
    lastWdSun0 != null ? malaysiaLastNamedCalendarWeekday(dayForJobs, lastWdSun0) : '';
  let namedPastWorkingDay = '';
  let namedPastJobsJson = '';
  if (
    namedPastDay &&
    namedPastDay !== chatWorkingDay &&
    namedPastDay !== relativeDay
  ) {
    const np = await loadScheduleJobsForOperatorChat(oid, namedPastDay);
    namedPastWorkingDay = np.workingDay;
    namedPastJobsJson = np.jobsJson;
  }
  let explicitWorkingDay = '';
  let explicitJobsJson = '';
  if (
    explicitDay &&
    explicitDay !== chatWorkingDay &&
    explicitDay !== relativeDay &&
    explicitDay !== namedPastDay
  ) {
    const ex = await loadScheduleJobsForOperatorChat(oid, explicitDay);
    explicitWorkingDay = ex.workingDay;
    explicitJobsJson = ex.jobsJson;
  }

  function countJobsInChatPayloadJson(jsonStr) {
    try {
      const p = JSON.parse(jsonStr);
      if (p && typeof p.totalJobs === 'number') return p.totalJobs;
      if (Array.isArray(p?.items)) return p.items.length;
    } catch {
      /* ignore */
    }
    return null;
  }

  let jobCountHint = '';
  try {
    const parsed = JSON.parse(chatJobsJson);
    const n =
      parsed && typeof parsed.totalJobs === 'number'
        ? parsed.totalJobs
        : Array.isArray(parsed?.items)
          ? parsed.items.length
          : 0;
    const relN = relativeJobsJson ? countJobsInChatPayloadJson(relativeJobsJson) : null;
    const namedN = namedPastJobsJson ? countJobsInChatPayloadJson(namedPastJobsJson) : null;
    const explicitN = explicitJobsJson ? countJobsInChatPayloadJson(explicitJobsJson) : null;

    const bits = [`${n} job(s) for toolbar Malaysia day ${chatWorkingDay}`];
    if (relN != null) bits.push(`${relN} for ${relativeWorkingDay} (tomorrow/yesterday-style)`);
    if (namedN != null) {
      bits.push(
        `${namedN} for ${namedPastWorkingDay} ("last Sunday" / 上个星期几 vs toolbar anchor)`
      );
    }
    if (explicitN != null) {
      bits.push(`${explicitN} for ${explicitWorkingDay} (explicit calendar date in the user message)`);
    }
    if (relN != null || namedN != null || explicitN != null) {
      jobCountHint = `\nDatabase fact: ${bits.join('; ')}. For each date the user asked about, use only the JSON block labeled for that Malaysia YYYY-MM-DD — do not say you lack access if that block is present.`;
    } else if (n === 0) {
      jobCountHint = `\nDatabase fact: ZERO schedule jobs for Malaysia calendar date ${chatWorkingDay} (Schedule toolbar sends contextWorkingDay; default is Malaysia "today"). Do not invent jobs. If the user sees jobs on screen, tell them to open Schedule, select that working day, then ask again so the portal syncs the date.`;
    } else {
      jobCountHint = `\nDatabase fact: ${n} job(s) in the JSON — you MUST acknowledge them and use propertyName/unitNumber from JSON when listing; never say there are no jobs.`;
    }
  } catch {
    jobCountHint = '';
  }

  const relativeJobsBlock =
    relativeJobsJson && relativeWorkingDay
      ? `\nAuthoritative job rows for Malaysia calendar date ${relativeWorkingDay} (user asked about a day relative to toolbar day ${chatWorkingDay}; for "how many jobs tomorrow/yesterday" use totalJobs or items length from THIS JSON only):
${relativeJobsJson}`
      : '';

  const namedPastJobsBlock =
    namedPastJobsJson && namedPastWorkingDay
      ? `\nAuthoritative job rows for Malaysia calendar date ${namedPastWorkingDay} (user asked for a past calendar weekday such as "last Sunday" / "last Friday" / "上个星期天", resolved relative to Malaysia calendar toolbar day ${chatWorkingDay}; answer "how many jobs" with totalJobs or items.length from THIS JSON only — that date is ${namedPastWorkingDay}):
${namedPastJobsJson}`
      : '';

  const explicitJobsBlock =
    explicitJobsJson && explicitWorkingDay
      ? `\nAuthoritative job rows for Malaysia calendar date ${explicitWorkingDay} (user named an explicit calendar date such as "March 20" / "3月20日" / ISO YYYY-MM-DD; year omitted used toolbar-day year ${defaultYearForExplicit}; use totalJobs or items length from THIS JSON for that date only):
${explicitJobsJson}`
      : '';

  const latestUserHasHan = /[\u4e00-\u9fff]/u.test(String(userMessage || '').trim());
  const consentTokenRuleLine = latestUserHasHan
    ? 'CONSENT_TOKEN_RULE: **Product order:** (1) 先用 JSON 做**编号摘要**供 operator 核对；(2) 再用**一句**简短收尾征求同意（例如「请确认后即可按上文执行。谢谢。」）——**不要**写「仅回复 yes / ok / confirm」那种长段。**复合指令拆分：**若 operator 一句话里要**两类会写库的操作**（例：「今天全部改 pending checkout」**且**「全部交给 Team 3」），必须当成**两件工作**——**本回合只做第一件**：只做其中一类的编号摘要 + 征求**一次**同意；**另一件**等对方确认、系统回执后，你在**下一轮助手回复**里再做摘要 + 征求第二次同意；**禁止**在同一条助手消息里用同一句确认同时涵盖两件写库操作。排程 AI 偏好（每日自动派队、按物业绑队、cron 等）由 operator **在本聊天说明**，MERGE 打开时你以 EXTRACT_JSON 写入 schedulePrefs ——**没有**单独的 Schedule 设置弹窗。**新建一单排程：** 正文用 **Type / Property / Unit Number / Date** 标签块（每项一行），**或** 物业名称+单元 简短说明；**禁止**在正文写 propertyId、UUID、代码块或大段 JSON；如需建单，**单独一行** `SCHEDULE_JOB_CREATE_JSON:…`（产品界面会隐藏该行）。**删除排程行：** 摘要每条须写 **YYYY-MM-DD**（与 Schedule 工具栏马来西亚日一致）；**禁止**在服务端回执前写「已成功删除」等；待确认删单时，短句如「删…今天」可视为同意（今天=工具栏日）。'
    : 'CONSENT_TOKEN_RULE: This operator\'s **latest** message is English/Malay/Latin only — many operators **do not read Chinese**. **Product order:** (1) JSON-backed **numbered summary** for review, (2) then **one short** closing line to confirm — e.g. "Please confirm to proceed above. Thank you!" or, for auto-assign specifically, "Please confirm to proceed with **server auto-assign**. Thank you!" **Do not** use long "reply only with yes / ok / confirm" boilerplate **except** the **single new job** flow in system "Create one new cleaning job", where that exact closing is **required** after the Type/Property/Unit Number/Date block. Short replies like yes / ok / confirm / proceed / ya / go ahead still count; for a **pending delete** summary, a short line like **delete … today** (meaning the Schedule toolbar day) also counts as consent. **Do not use Chinese characters** in your reply. The server parses consent from your question + the operator\'s short reply. **Schedule AI preferences** (daily auto-assign by property binding, cron toggles, buffers, homestay window, etc.) are set **through this chat** when MERGE_MODE is on (EXTRACT_JSON → schedulePrefs) — there is **no** separate Schedule settings dialog. **COMPOUND_WRITE_SPLIT:** If the operator\'s **latest** message asks for **two** different kinds of **saved** database changes in one go (examples: change **all** jobs\' **status** (e.g. to pending checkout / ready to clean) **and** assign or **pass all jobs to a specific team**), treat that as **two separate jobs**. In **this** assistant reply: (1) Say briefly you will do **two steps**. (2) Cover **only step 1** — numbered JSON-backed summary for that step only, then **one** short confirmation for **that step only**. (3) Do **not** ask for confirmation for step 2 in the same message. After they confirm step 1 and the thread shows the server result, your **next** assistant reply handles **step 2** with its own summary and its own confirmation.';

  const localeGuardLine = !latestUserHasHan
    ? 'LOCALE_GUARD: **Hard rule:** zero Chinese characters in your reply when the operator\'s latest message has no Han — they may not read Chinese. Use only English and/or Malay/Latin for consent and instructions.'
    : '';

  const honestyRuleLine = latestUserHasHan
    ? '**Clarify when unsure:** 若缺关键信息（哪一间物业、单元、哪一天、哪种服务），或无法从 portfolio / JSON 确定答案，用**一两句**追问 operator 或请对方核对；**不要**装作全懂，也不要在信息不足时把方案说成已定案。'
    : '**Clarify when unsure:** If anything is missing or ambiguous (property, unit, which Malaysia day, service type), or you are **not confident** you matched the portfolio / JSON correctly, ask **one short** question or ask the operator to confirm your understanding—**do not** answer as if you fully understood when you do not, and do not present a plan as ready without the facts you need.';

  const system = `${pr}You are Jarvis, a scheduling assistant for ONE cleaning company operator only (this tenant). Operators see you as "Jarvis" in the portal. Follow all platform rules above first (they include tenant isolation and rule CLN-AI6 on read/write scope for schedule assistance).
Calendar: all working-day dates are Malaysia local calendar (Asia/Kuala_Lumpur, UTC+8). MySQL stores instants in UTC+0; the JSON below is already resolved to that Malaysia YYYY-MM-DD.
Scope: only Cleanlemons / this operator's scheduling, teams, properties, and portal automation. If the user asks for unrelated work (e.g. building a website), reply briefly that you cannot help and stay on Cleanlemons topics.
Tone: gentle, very short answers (直白); avoid long essays.
${honestyRuleLine}
Language: match the operator's language in this thread for explanations and questions—English if they write English, Malay (Bahasa Malaysia) if they write Malay, Chinese if they write Chinese. Do not default to Chinese when the operator is not using Chinese.
${consentTokenRuleLine}
${localeGuardLine}
No guessing: never invent jobs, teams, counts, or statuses. Every job line must match the JSON (scheduleId / propertyName / unitNumber / jobType). If there is **no** JSON block in this prompt whose header date matches the day the user means, say you need them to pick that working day on Schedule and ask again—do not invent rows. If a matching block exists (even as a second chunk after the toolbar day), you **do** have read access: list jobs from that JSON using the team format below; **never** reply with "no access", "cannot see details", "I do not have permission", or "check Schedule" **for listing** when that block is present and non-empty.
When a second/third JSON block is present for yesterday/ytd/tomorrow/tmr or for "last Friday" / "last Sunday" / an explicit date, that block is authoritative for that Malaysia YYYY-MM-DD: answer counts and **lists** using its items only—do not use only the first JSON chunk if the user meant the other date. Do not invent another date (e.g. wrong Friday) and do not say you lack access for that block.
**Operator property portfolio (MySQL \`cln_property\` for this operator):** The JSON below is the **full list of properties/units** under this operator (same tenant as schedules). It may include rows that have **no** job on the toolbar day — still use it to answer "what is my property called", "does Space Residency exist", or to **internally** resolve **propertyId** from **propertyName + unitNumber** when you compose the single **SCHEDULE_JOB_CREATE_JSON** machine line for a **new** row. **Never** paste propertyId, UUIDs, or raw JSON objects into normal conversational text — operators are non-technical; they only need human names and units in prose. Before saying a name "is not in the system", **scan this portfolio** (match on propertyName, unitNumber, address, client; allow minor spelling / spacing / word-order differences). If nothing plausibly matches, say it is not in this operator portfolio and they should add it under Operator → Properties first.
**Bulk create for one property name ("all units", "every ARC unit", "whole building"):** The **schedule JSON for the toolbar day** only lists rows that **already exist** in \`cln_schedule\` for that Malaysia date — it does **not** list portfolio units that have **no** job yet. When the operator wants **homestay (or any service) for every unit** under one property name, you MUST build the numbered **Type / Property / Unit Number / Date** blocks from **every** \`items[]\` entry in the **property portfolio** JSON whose propertyName matches that building (normalize spacing/case). Do **not** infer the unit list only from the schedule JSON for that day (you would under-count). State the total count (e.g. "N units in portfolio match …") so the operator can see it is complete; if you hit a practical limit or skip units, say which and why.
Data: schedule JSON is loaded only for this operator (cln_schedule joined to cln_property so property.operator_id matches the logged-in operator). You never see another company's rows. Server-side auto-assign (after the operator sends a **short confirmation** you asked for—e.g. yes / ok / confirm / proceed / do now / go ahead / 好 / ya—see consent rules below) may write cln_schedule.team only for jobs whose Malaysia working day is today or a future date — past calendar days are not team-updated by automation; chat text alone never writes teams.
Authoritative **property portfolio** (cln_property; not filtered by schedule day):
${operatorPropertiesPortfolioJson}
Authoritative job rows for calendar date ${chatWorkingDay} (toolbar / selected working day; JSON; use only this list for that day's property/unit/type; do not invent jobs):
${chatJobsJson}${relativeJobsBlock}${namedPastJobsBlock}${explicitJobsBlock}${jobCountHint}
Team-by-team draft format (mandatory whenever you list jobs): group rows ONLY by each item's JSON field teamName (trimmed). Start each group with one line exactly: Team <that exact teamName value>. If teamName is empty or "Unassigned" (any case), the heading MUST be "Team Unassigned" — never rename unassigned rows to "Team 1", "Team 2", or any crew name that does not appear as that row's teamName in the JSON.
Under each heading, list each job as exactly two lines (no one-line shortcuts):
  PropertyName (UnitNumber)
  job type: homestay cleaning | general cleaning | deep cleaning | warm cleaning | renovation cleaning | other
Example (structure only — Alpha/Beta are fictional names; your headings must mirror JSON teamName, not this example):
Team Alpha
Sunrise Condo (12A)
job type: homestay cleaning
Team Beta
Lakeview (—)
job type: deep cleaning
Truth check before claiming assignment state: scan every JSON item's teamName. If any is empty or "Unassigned" (case-insensitive), you MUST NOT say that all jobs already have teams, that there are no unassigned jobs, or that the schedule is fully assigned — say clearly how many rows are still Unassigned. To run **server auto-assign**, you must first give the **numbered JSON-backed summary** in that flow, then ask for **operator approval** (see multi-job rules)—do not ask for approval without that summary in the same turn unless the **immediately previous assistant message** in the thread already contains the full numbered summary for the same day and intent.
Use the real propertyName and unitNumber from the JSON (if unitNumber is empty, write "—" inside the parentheses). Use jobType from JSON (or map cleaningTypeRaw to the same set). Never use placeholders like [Jobs], "TBD", or vague bullets without real property names.
Multi-job / "arrange today" / distribute many jobs: (1) If you lack facts, ask—do not guess. (2) **Product flow — two steps:** (A) **Summary first:** from JSON only, give a **numbered summary** (how many jobs, which properties; use the mandatory team-by-team list format when you list jobs). This is for **operator review** before any database write. (B) **Operator approval second:** after (A), one short line — e.g. "Please confirm to proceed with **server auto-assign**. Thank you!" (English) or「是否执行自动派队」+ 一句「请确认后即可按上文执行。谢谢。」(Chinese). **Never** show「确认执行」to operators whose latest message has no Han. (3) Until the next assistant message from the server states the apply result, NEVER say teams were saved, applied, or updated. (4) **Same rule when they mix status + team in one sentence** — that is **two** confirmations, not one: see COMPOUND_WRITE_SPLIT / CONSENT_TOKEN_RULE above.
**Multiple manual team reassignments (same working day, not server auto-assign):** If the operator asks to move **several** jobs to **different** teams in one message, your pre-confirm summary MUST use **one numbered line per row** in this exact pattern (property + unit inside a single bold pair): 1. Change assignment of job for **PROPERTY_NAME (UNIT)** to **Team N**. then 2. … then 3. … — real names from the schedule JSON. One operator **yes** / **ok** then applies **all** lines in one server step; do not ask them to confirm each row separately.
**Mixed status + team in one numbered list:** For each row moving to **ready-to-clean**, use exactly this numbered shape (N = 1,2,3…): N. Change status of job for **PROPERTY_NAME (UNIT)** to **ready-to-clean**. — not the assignment-line pattern. The server parses these together with team-change lines after one **yes**.
**Revert to pending checkout (numbered):** Use N. Change status of job for **PROPERTY_NAME (UNIT)** to **pending-checkout**. One **yes** applies every listed row that is currently **ready-to-clean** (other statuses are skipped with a count in the server reply).
**Delete one schedule row:** Always include the **Malaysia working day** as **YYYY-MM-DD** on the same line so the operator sees which calendar day (use toolbar day **${chatWorkingDay}** unless they clearly mean another date you can justify from the thread). Numbered form: \`1. Delete job for **PROPERTY_NAME (UNIT)** for **YYYY-MM-DD**.\` Single-row form: \`Delete job for **PROPERTY_NAME (UNIT)** for **YYYY-MM-DD**.\` If the bold date does not match the day the server applies (Schedule toolbar), the delete is rejected. Confirmations that apply the pending delete: **yes** / **ok** / **confirm** / **proceed** / **go ahead**, or a short line such as **"delete arc today"** when **today** means the toolbar Malaysia day. Do **not** say the row was deleted, removed, or gone until the **server's next assistant message** after that confirmation — **never** invent "successfully deleted" or similar from the model alone.
**Create several new jobs (same backend as Schedule → Create Job, same Malaysia day):** When the operator asks for **more than one** new row, use **numbered blocks** \`1.\`, \`2.\`, … each starting with \`N. **Type:** …\` then the next lines **Property / Unit Number / Date** with the same **\`**Property:**\`** / **\`**Unit Number:**\`** / **\`**Date:**\`** shape as the single-job template (Date must match toolbar **${chatWorkingDay}** in civil meaning unless you justify another YYYY-MM-DD). For **all units of one property**, use **portfolio** \`items\` as the source of units (see **Bulk create for one property name** above), not the schedule-day JSON alone. One operator **yes** / **ok** / **confirm** applies **all** blocks the server can resolve from the portfolio — **never** say jobs were created until the **server's** next reply after they confirm.
**Create one new cleaning job (same backend as Schedule → Create Job):** When the operator asks to add/book a **single** new job: (1) Resolve **propertyId** internally from the **property portfolio** JSON (match propertyName + unitNumber; if ambiguous, ask one short question). (2) **date** in the machine JSON must be the **Schedule toolbar Malaysia day** (${chatWorkingDay}) unless they clearly asked for another YYYY-MM-DD you can justify from the thread — mismatch rejects the create. (3) **serviceProvider** in the machine JSON must be one of: homestay-cleaning, general-cleaning, deep-cleaning, warm-cleaning, renovation-cleaning, room-rental-cleaning, commercial-cleaning, office-cleaning. (4) **Mandatory operator-readable block** — **no** extra intro paragraph, **no** merging type/property/unit/date into one sentence. **Forbidden:** lines like "To create a new homestay cleaning job for Some Property (12-34) today, here's the job proposal:" — that skips the labels and is **wrong**. Put **only** human-readable facts inside the four label lines below. Use **this exact shape** (opening line then **immediately** the four lines; each label starts at column 1; plain text, **no** UUIDs, **no** raw JSON in these lines):
To create cleaning job, here's the job proposal:
Type: <e.g. homestay cleaning — spell out here, not in the opening line>
Property: <exact name from portfolio>
Unit Number: <exact unit from portfolio>
Date: <Malaysia calendar day in words, e.g. 22 April 2026 — must be the same civil day as toolbar ${chatWorkingDay} unless you justify another date>
Then **one** closing line: "Please confirm by replying **yes**, **ok**, or **confirm** to proceed with creating this job. Thank you!" (5) Add **exactly one** final line **on its own** for the **server only**: SCHEDULE_JOB_CREATE_JSON:{"propertyId":"<real-uuid>","date":"YYYY-MM-DD","serviceProvider":"homestay-cleaning","time":"09:00","remarks":"optional"} — **time** optional (default 09:00 local). Optional numeric **price** (RM) inside that JSON if you are sure; otherwise omit \`price\` and portal default pricing applies. The product **saves** that line in a **server-only** field (operators do not see it in chat); the server **still requires** that exact line in your model output so yes/ok/confirm can apply. After they confirm, the server inserts **one** row (pending-checkout, operator_portal); do not claim the row exists until the server reply.
CRITICAL: This chat text alone never writes teams or job status to MySQL, and never inserts schedule rows **until** the operator confirms a **saved** proposal that either includes the **SCHEDULE_JOB_CREATE_JSON** machine line **or** the **Type / Property / Unit Number / Date** label block in (4) that the server can match to the portfolio (implicit apply), **including multi-row numbered create summaries**. While a create is **pending** operator yes/ok/confirm, you MUST **not** say the job(s) were created, saved, booked, or "successfully" done — no "has been created successfully", "The cleaning jobs … have been created", "已成功创建", or similar. Forbidden phrases unless the user already received the server's apply result in the same thread: "applied", "assignments are now applied", "saved to the schedule", "updated the database", "I have assigned", "I will now change the status", "status has been updated". Operators never need to read UUIDs or internal IDs in chat.
Saved schedule preferences (JSON): ${safeJsonStringifyForPrompt('schedulePrefs', settings.schedulePrefs)}
Pinned constraints: ${safeJsonStringifyForPrompt('pinnedConstraints', settings.pinnedConstraints)}
Operator extra notes: ${settings.promptExtra || '(none)'}
${
  mergeExtractedConstraints
    ? `MERGE_MODE is on. **EXTRACT_JSON** (optional): only if you are actually merging **non-empty** \`pinnedConstraints\` and/or \`schedulePrefs\` changes from the operator's message. End with **exactly one** line \`EXTRACT_JSON:{...}\` (single JSON object, no markdown fence). **Never** output \`EXTRACT_JSON:{}\`, \`EXTRACT_JSON:[]\`, or an object with no real keys to write. If you have **nothing** to merge this turn, **omit EXTRACT_JSON entirely**. **SCHEDULE_JOB_CREATE_JSON** (new job proposal) and EXTRACT_JSON must not contradict each other — when your main action is **only** proposing a new job line + confirmation, **do not** add EXTRACT_JSON in that same reply. The object may include:
- "pinnedConstraints": array of new property_only_teams entries from the user message (propertyId + teamIds UUIDs). Omit or use [] if none.
- "schedulePrefs": partial object with only keys you are changing (same field names as in Saved schedule preferences), e.g. aiScheduleCronEnabled, aiSchedulePlanningHorizonDays, aiScheduleCronTimeLocal (HH:mm, Malaysia local), maxJobsPerTeamPerDay, buffer minutes, homestay window, team assignment mode flags, etc. Omit if none.
**OPTIONS_JSON (optional):** When you need the operator to pick one of a few fixed paths (simple A/B/C multiple choice in chat), add ONE final line exactly \`OPTIONS_JSON:[...]\` after your normal text — same JSON rules as MERGE off: max 6 objects, \`id\` + \`label\` strings only. Prefer **(A) / (B) / (C)** at the start of each \`label\` and matching letter \`id\`s \`a\`, \`b\`, \`c\` so portal chips read clearly. If this turn is only EXTRACT_JSON / job create / consent, skip OPTIONS_JSON.`
    : 'MERGE_MODE is off: do not include EXTRACT_JSON. When the operator should pick among a few clear choices (e.g. fair split vs property-team binding), put your short question in normal text, then add ONE final line exactly: OPTIONS_JSON:[{"id":"a","label":"(A) Fair split across teams"},{"id":"b","label":"(B) Follow property-team binding"}] — valid JSON array only, max 6 objects with id and label strings. **Always start each label with (A), (B), (C), …** in order when offering 2–6 choices (multiple-choice for the operator). Prefer ids \`a\`,\`b\`,\`c\`. No semicolons inside strings, no line breaks inside the JSON.'
}`;

  const user = `Recent conversation:\n${histLines || '(start)'}\n\nReply to the operator's latest message helpfully.`;

  let reply;
  try {
    reply = await invokeOperatorLlm({
      provider: creds.provider,
      apiKey: creds.apiKey,
      system,
      user,
    });
  } catch (err) {
    if (isLlmQuotaOrAuthError(err)) {
      await appendChatMessage(oid, 'assistant', OPERATOR_AI_AGENT_PAYMENT_HINT);
      return {
        reply: OPERATOR_AI_AGENT_PAYMENT_HINT,
        options: [],
        pinnedMerged: false,
        schedulePrefsMerged: false,
        usedFallback: true,
      };
    }
    throw err;
  }

  let trimmed = String(reply || '').trim();
  trimmed = sanitizeJarvisConsentWordingForEnglishOperator(trimmed, history, userMessage);
  const { body: replyBody, options: replyOptions } = splitOptionsSuffixFromAssistantReply(trimmed);

  let extraPinned = [];
  let schedulePrefsPatch = null;
  if (mergeExtractedConstraints) {
    const idx = replyBody.lastIndexOf('EXTRACT_JSON:');
    if (idx !== -1) {
      const jsonPart = replyBody.slice(idx + 'EXTRACT_JSON:'.length).trim();
      try {
        const parsed = JSON.parse(jsonPart);
        if (Array.isArray(parsed.pinnedConstraints)) extraPinned = parsed.pinnedConstraints;
        const sp = whitelistSchedulePrefsPatch(parsed.schedulePrefs);
        if (sp) schedulePrefsPatch = sp;
      } catch (_) {
        /* ignore */
      }
    }
  }

  let userFacing = replyBody.trim();
  if (mergeExtractedConstraints && userFacing.lastIndexOf('EXTRACT_JSON:') !== -1) {
    userFacing = userFacing.slice(0, userFacing.lastIndexOf('EXTRACT_JSON:')).trim();
  }
  userFacing = sanitizePrematureScheduleJobCreateClaims(userFacing);

  const optionsSuffixForStore =
    replyOptions.length > 0 ? `\n\nOPTIONS_JSON:${JSON.stringify(replyOptions)}` : '';
  const storedAssistantBody = `${userFacing}${optionsSuffixForStore}`.trim();
  let { human: persistHuman, machine: persistMachine } = splitMachineLinesFromAssistantPersistText(storedAssistantBody);
  persistHuman = ensureJarvisJobCreateLabelBlockInPersistHuman(
    persistHuman,
    persistMachine,
    operatorPropertiesPortfolioJson
  );
  await appendChatMessage(oid, 'assistant', persistHuman, persistMachine || null);

  const curPinned = settings.pinnedConstraints || [];
  const patch = {};
  if (mergeExtractedConstraints && extraPinned.length) {
    patch.pinnedConstraints = [...curPinned, ...extraPinned];
  }
  if (mergeExtractedConstraints && schedulePrefsPatch) {
    patch.schedulePrefs = normalizePrefs({ ...settings.schedulePrefs, ...schedulePrefsPatch });
  }
  if (Object.keys(patch).length) {
    await saveOperatorAiSettingsFromApi(oid, patch);
  }

  return {
    reply: stripOperatorScheduleAiMachineDisplayLinesForReply(persistHuman.trim()),
    options: replyOptions,
    pinnedMerged: mergeExtractedConstraints && extraPinned.length > 0,
    schedulePrefsMerged: mergeExtractedConstraints && !!schedulePrefsPatch,
  };
}

async function loadScheduleContextForAi(operatorId, workingDay) {
  const oid = String(operatorId || '').trim();
  const day = String(workingDay || '').slice(0, 10);
  if (!oid || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('INVALID_PARAMS');

  const hasLock = await databaseHasColumn('cln_schedule', 'ai_assignment_locked');
  const lockSel = hasLock ? 's.ai_assignment_locked AS aiLocked,' : '0 AS aiLocked,';

  const [rows] = await pool.query(
    `SELECT s.id, s.property_id AS propertyId, s.team AS teamName, ${lockSel}
            COALESCE(NULLIF(TRIM(p.property_name), ''), '') AS propertyName,
            COALESCE(NULLIF(TRIM(p.unit_name), ''), '') AS propertyUnit,
            ${SQL_WORKING_DAY_KL_YMD} AS jobDate,
            s.status AS rawStatus, s.cleaning_type AS cleaningType,
            TIME_FORMAT(s.start_time, '%H:%i') AS staffStartTime,
            TIME_FORMAT(s.end_time, '%H:%i') AS staffEndTime
     FROM cln_schedule s
     INNER JOIN cln_property p ON p.id = s.property_id
     WHERE p.operator_id = ? AND (${SQL_WORKING_DAY_KL_YMD}) = ?
     ORDER BY s.start_time ASC, s.id ASC`,
    [oid, day]
  );

  const teams = await cleanlemonSvc.listOperatorTeams(oid);
  const teamList = teams.map((t) => ({ id: t.id, name: t.name }));

  const jobs = (rows || []).map((r) => {
    const st = String(r.staffStartTime || '').trim();
    const et = String(r.staffEndTime || '').trim();
    const hasTimeSlot = Boolean(st && et);
    const statusNorm = normalizeScheduleStatusForAi(r.rawStatus);
    const homestay = isHomestayCleaningType(r.cleaningType);
    return {
      id: r.id,
      propertyId: r.propertyId,
      propertyName: String(r.propertyName || '').trim(),
      propertyUnit: String(r.propertyUnit || '').trim(),
      teamName: r.teamName || null,
      jobDate: r.jobDate,
      status: r.rawStatus,
      statusNormalized: statusNorm,
      cleaningType: r.cleaningType,
      isHomestay: homestay,
      staffStartTime: hasTimeSlot ? st : null,
      staffEndTime: hasTimeSlot ? et : null,
      hasScheduledTimeSlot: hasTimeSlot,
      aiLocked: Number(r.aiLocked) === 1,
    };
  });

  return { jobs, teams: teamList, day };
}

/** True when `cln_schedule.team` means "no crew yet" (empty or legacy placeholder text). */
function isTeamSlotEmptyForAssign(teamNameRaw) {
  const t = String(teamNameRaw || '').trim().toLowerCase();
  if (!t) return true;
  if (t === 'unassigned') return true;
  if (t === '-' || t === '—' || t === 'none' || t === 'n/a' || t === 'na') return true;
  return false;
}

function jobEligibleForAiAssign(j) {
  if (isTerminalScheduleRaw(j.status)) return false;
  return isTeamSlotEmptyForAssign(j.teamName);
}

/** Full-day run (e.g. chat 确认执行): include jobs that already have a team so the model can rebalance. */
function jobEligibleForAiFullDayReassign(j) {
  if (isTerminalScheduleRaw(j.status)) return false;
  return true;
}

/** Match "Team 2" / "**Assign to**: Team 2" / "to Team 2" and return digit string e.g. "2". */
function extractAssistantTeamDigitFromAssignSummary(body) {
  const s = String(body || '');
  const m =
    s.match(/\*\*Assign\s+to\*\*\s*:\s*Team\s+(\d+)/i) ||
    s.match(/\bAssign\s+to\s*:\s*Team\s+(\d+)\b/i) ||
    s.match(/\*\*\s*Team\s*(\d+)\s*\*\*/i) ||
    s.match(/\bto\s+Team\s+(\d+)\b/i) ||
    s.match(/\bTeam\s+(\d+)\s*[\n*]/i) ||
    s.match(/\bTeam\s+(\d+)\s*$/im);
  return m ? String(m[1] || '').trim() : '';
}

function resolveTeamIdByDigitFromTeams(teams, digitStr) {
  const d = String(digitStr || '').trim().replace(/^0+/, '') || '';
  if (!d || !Array.isArray(teams) || !teams.length) return '';
  const byName = teamNameToIdMap(teams);
  const candidates = [`Team ${d}`, `Team  ${d}`, `team ${d}`, `T${d}`];
  for (const c of candidates) {
    const id = byName.get(c);
    if (id) return id;
  }
  for (const t of teams) {
    const n = String(t?.name || '').trim();
    if (!n) continue;
    const num = n.replace(/^team\s*/i, '').trim();
    if (num === d || String(Number(num)) === String(Number(d))) return String(t.id);
  }
  return '';
}

/**
 * Team-execute consent also offered to set (bulk) same-day jobs back to pending-checkout (e.g. undo ready-to-clean).
 * Requires the same yes/ok footer as other DB writes.
 */
function assistantAskedBulkPendingCheckoutAlongTeamExecuteConsent(text) {
  const s = String(text || '');
  if (!assistantAskedScheduleExecuteConsent(s)) return false;
  const head = assistantBodyBeforeConsentFooter(s);
  if (!/\bpending[\s_-]*(?:check[\s_-]*out|checkout)\b/i.test(head)) return false;
  if (/\bready\s*[- ]?to\s*[- ]?clean\b/i.test(head) && /\ball\s+jobs?\b/i.test(head)) return false;
  return (
    /\ball\s+jobs?\b/i.test(head) ||
    /\bevery\s+job\b/i.test(head) ||
    /\ball\s+jobs?\s+for\s+today\b/i.test(head) ||
    /\ball\s+for\s+today\b/i.test(head) ||
    /\bassign\s+all\b/i.test(head)
  );
}

/**
 * Bulk pending-checkout only (no assign-all-to-team consent in the same assistant message).
 * Used when Jarvis splits step 1 (status) from step 2 (teams).
 */
function assistantAskedBulkPendingCheckoutOnlyConsent(text) {
  const s = String(text || '');
  if (extractScheduleJobCreateProposalFromAssistantBody(s)) return false;
  if (!hasJarvisOperatorDbConsentPrompt(s)) return false;
  if (assistantAskedScheduleExecuteConsent(s)) return false;
  if (parseNumberedPendingCheckoutEntries(s).length >= 1) return false;
  const head = assistantBodyBeforeConsentFooter(s);
  if (!/\bpending[\s_-]*(?:check[\s_-]*out|checkout)\b/i.test(head)) return false;
  if (/\bready\s*[- ]?to\s*[- ]?clean\b/i.test(head) && /\ball\s+jobs?\b/i.test(head)) return false;
  return (
    /\ball\s+jobs?\b/i.test(head) ||
    /\bevery\s+job\b/i.test(head) ||
    /\ball\s+jobs?\s+for\s+today\b/i.test(head) ||
    /\ball\s+for\s+today\b/i.test(head) ||
    /\bassign\s+all\b/i.test(head)
  );
}

/** True when assistant clearly promised every job that day goes to one team (used for DB fallback if LLM JSON apply wrote 0 rows). */
function assistantPromisesAssignAllJobsToOneTeam(body) {
  const s = String(body || '');
  if (!extractAssistantTeamDigitFromAssignSummary(s)) return false;
  return (
    /\ball\s+jobs?\b/i.test(s) ||
    /\bassign\s+all\b/i.test(s) ||
    /\bevery\s+job\b/i.test(s) ||
    /\ball\s+for\s+today\b/i.test(s) ||
    /\ball\s+jobs?\s+for\s+today\b/i.test(s)
  );
}

/**
 * Deterministic apply: all non-terminal jobs on `workingDay` → team resolved from "**Team N**" / "to Team N" in assistant text.
 */
async function tryApplyAllJobsFromAssistantTeamAllIntent({ operatorId, workingDay, prevAssistantBody, pinnedConstraints }) {
  const wd = String(workingDay || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(wd)) return { applied: 0, rejected: [], reason: 'BAD_DAY' };
  if (!isMalaysiaYmdOnOrAfterToday(wd)) return { applied: 0, rejected: [], reason: 'PAST_DAY' };

  const body = String(prevAssistantBody || '');
  if (!assistantPromisesAssignAllJobsToOneTeam(body)) {
    return { applied: 0, rejected: [], reason: 'NOT_ASSIGN_ALL_INTENT' };
  }
  const digit = extractAssistantTeamDigitFromAssignSummary(body);
  const ctx = await loadScheduleContextForAi(operatorId, wd);
  const teamId = resolveTeamIdByDigitFromTeams(ctx.teams, digit);
  if (!teamId) return { applied: 0, rejected: [], reason: 'TEAM_NOT_FOUND', teamDigit: digit };

  const eligible = ctx.jobs.filter(jobEligibleForAiFullDayReassign);
  const assignments = [];
  const rejected = [];
  let applied = 0;
  for (const j of eligible) {
    if (!validatePinnedForAssignment(j.propertyId, teamId, pinnedConstraints)) {
      rejected.push({ jobId: j.id, reason: 'PINNED_VIOLATION' });
      continue;
    }
    try {
      await cleanlemonSvc.updateOperatorScheduleJob(j.id, { teamId });
      applied += 1;
      assignments.push({ jobId: j.id, teamId, reason: 'ASSISTANT_SUMMARY_FALLBACK' });
    } catch (err) {
      rejected.push({ jobId: j.id, reason: err?.message || 'UPDATE_FAILED' });
    }
  }
  return { applied, rejected, assignments, reason: applied ? 'ASSISTANT_SUMMARY_FALLBACK' : 'NO_ROWS_TOUCHED' };
}

function formatSingleJobTeamAssignReplyForChat(res, dayYmd) {
  const wd = String(dayYmd || '').slice(0, 10);
  if (!res || !res.ok || !Number(res.applied)) {
    const m = String(res?.message || 'Unknown error');
    if (m === 'NO_MATCHING_JOB') {
      return `No schedule row matched that property/unit for ${wd}. Open the Job list and assign manually.`;
    }
    if (m === 'TEAM_NOT_FOUND') {
      return `Could not resolve Team ${String(res?.teamDigit || '?')}. Check Operator → Team list.`;
    }
    if (m === 'PINNED_VIOLATION') {
      return `Pinned team rules block assigning Team ${String(res?.teamDigit || '?')} to this property.`;
    }
    if (m === 'AI_ASSIGNMENT_LOCKED') {
      return `That job is locked for AI team changes — use Schedule → edit the row.`;
    }
    if (m === 'PAST_DAY') {
      return `Team changes cannot be saved for past working days.`;
    }
    if (m === 'NO_JOB_LINE') {
      return `Could not read which job to assign. Ask Jarvis to list **Job**: Property (Unit) and **Assign to**: Team N.`;
    }
    if (m === 'NO_TEAM_DIGIT') {
      return `Could not read which team number to assign.`;
    }
    return `Could not assign team: ${m}.`;
  }
  const label = String(res.propertyLabel || 'job').trim();
  return `Assigned **Team ${String(res.teamDigit || '')}** to **${label}** (job ${String(res.jobId || '').trim()}) for **${wd}**. Refresh the Job list if needed.`;
}

/**
 * After yes: set team on the single schedule row matching **Job**: Name (Unit) on that Malaysia working day.
 */
async function tryApplySingleJobTeamFromAssistant({ operatorId, workingDay, prevAssistantBody, pinnedConstraints }) {
  const wd = String(workingDay || '').slice(0, 10);
  const empty = { ok: false, applied: 0, message: 'BAD_DAY', jobId: '', teamDigit: '', propertyLabel: '' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(wd)) return { ...empty, message: 'BAD_DAY' };
  if (!isMalaysiaYmdOnOrAfterToday(wd)) return { ...empty, message: 'PAST_DAY' };

  const body = String(prevAssistantBody || '');
  const digit = extractAssistantTeamDigitFromAssignSummary(body);
  if (!digit) return { ...empty, message: 'NO_TEAM_DIGIT', teamDigit: '' };

  const target = extractSingleJobAssignTargetFromAssistantBody(body);
  if (!target) return { ...empty, message: 'NO_JOB_LINE', teamDigit: digit };

  const ctx = await loadScheduleContextForAi(operatorId, wd);
  const teamId = resolveTeamIdByDigitFromTeams(ctx.teams, digit);
  if (!teamId) return { ...empty, message: 'TEAM_NOT_FOUND', teamDigit: digit };

  const matches = ctx.jobs.filter((j) => {
    const pn = normScheduleJobPropertyNameToken(String(j.propertyName || ''));
    const un = normScheduleJobUnitToken(String(j.propertyUnit || ''));
    const nameOk =
      pn === target.propertyName || pn.includes(target.propertyName) || target.propertyName.includes(pn);
    return nameOk && un === target.unitToken;
  });
  const preferEmpty = matches.filter((j) => isTeamSlotEmptyForAssign(j.teamName));
  const pool = preferEmpty.length ? preferEmpty : matches;
  const pick = pool.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
  if (!pick) return { ...empty, message: 'NO_MATCHING_JOB', teamDigit: digit };

  if (!validatePinnedForAssignment(pick.propertyId, teamId, pinnedConstraints)) {
    return {
      ok: false,
      applied: 0,
      message: 'PINNED_VIOLATION',
      jobId: pick.id,
      teamDigit: digit,
      propertyLabel: `${pick.propertyName} (${pick.propertyUnit})`,
    };
  }
  if (pick.aiLocked) {
    return {
      ok: false,
      applied: 0,
      message: 'AI_ASSIGNMENT_LOCKED',
      jobId: pick.id,
      teamDigit: digit,
      propertyLabel: `${pick.propertyName} (${pick.propertyUnit})`,
    };
  }

  await cleanlemonSvc.updateOperatorScheduleJob(pick.id, { teamId });
  return {
    ok: true,
    applied: 1,
    message: 'OK',
    jobId: pick.id,
    teamDigit: digit,
    propertyLabel: `${pick.propertyName} (${pick.propertyUnit})`,
  };
}

/**
 * After yes: apply each numbered "Change assignment … to **Team N**" line (same working day).
 */
async function tryApplyNumberedMultiJobTeamReassignmentsFromAssistant({
  operatorId,
  workingDay,
  prevAssistantBody,
  pinnedConstraints,
}) {
  const wd = String(workingDay || '').slice(0, 10);
  const empty = {
    ok: false,
    applied: 0,
    message: 'BAD_DAY',
    results: [],
    mode: 'NUMBERED_MULTI',
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(wd)) return { ...empty, message: 'BAD_DAY' };
  if (!isMalaysiaYmdOnOrAfterToday(wd)) return { ...empty, message: 'PAST_DAY' };

  const entries = parseNumberedTeamReassignmentEntries(prevAssistantBody);
  if (entries.length < 2) return { ...empty, message: 'NOT_MULTI', applied: 0, results: [] };

  const ctx = await loadScheduleContextForAi(operatorId, wd);
  const usedJobIds = new Set();
  const results = [];
  let applied = 0;

  for (const ent of entries) {
    const teamId = resolveTeamIdByDigitFromTeams(ctx.teams, ent.teamDigit);
    if (!teamId) {
      results.push({
        ok: false,
        teamDigit: ent.teamDigit,
        propertyLabel: `${ent.propertyName} (${ent.unitToken})`,
        message: 'TEAM_NOT_FOUND',
      });
      continue;
    }
    const matches = ctx.jobs.filter((j) => {
      if (usedJobIds.has(j.id)) return false;
      const pn = normScheduleJobPropertyNameToken(String(j.propertyName || ''));
      const un = normScheduleJobUnitToken(String(j.propertyUnit || ''));
      const nameOk =
        pn === ent.propertyName || pn.includes(ent.propertyName) || ent.propertyName.includes(pn);
      return nameOk && un === ent.unitToken;
    });
    const preferEmpty = matches.filter((j) => isTeamSlotEmptyForAssign(j.teamName));
    const pool = preferEmpty.length ? preferEmpty : matches;
    const pick = pool.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
    if (!pick) {
      results.push({
        ok: false,
        teamDigit: ent.teamDigit,
        propertyLabel: `${ent.propertyName} (${ent.unitToken})`,
        message: 'NO_MATCHING_JOB',
      });
      continue;
    }
    if (!validatePinnedForAssignment(pick.propertyId, teamId, pinnedConstraints)) {
      results.push({
        ok: false,
        teamDigit: ent.teamDigit,
        propertyLabel: `${pick.propertyName} (${pick.propertyUnit})`,
        jobId: pick.id,
        message: 'PINNED_VIOLATION',
      });
      continue;
    }
    if (pick.aiLocked) {
      results.push({
        ok: false,
        teamDigit: ent.teamDigit,
        propertyLabel: `${pick.propertyName} (${pick.propertyUnit})`,
        jobId: pick.id,
        message: 'AI_ASSIGNMENT_LOCKED',
      });
      continue;
    }
    try {
      await cleanlemonSvc.updateOperatorScheduleJob(pick.id, { teamId });
      usedJobIds.add(pick.id);
      applied += 1;
      results.push({
        ok: true,
        teamDigit: ent.teamDigit,
        propertyLabel: `${pick.propertyName} (${pick.propertyUnit})`,
        jobId: pick.id,
        message: 'OK',
      });
    } catch (err) {
      results.push({
        ok: false,
        teamDigit: ent.teamDigit,
        propertyLabel: `${pick.propertyName} (${pick.propertyUnit})`,
        jobId: pick.id,
        message: String(err?.message || err || 'UPDATE_FAILED').slice(0, 200),
      });
    }
  }

  return {
    ok: applied > 0,
    applied,
    message: applied ? 'NUMBERED_MULTI' : 'NO_ROWS_TOUCHED',
    results,
    mode: 'NUMBERED_MULTI',
  };
}

function formatNumberedMultiJobTeamAssignReplyForChat(res, dayYmd) {
  const wd = String(dayYmd || '').slice(0, 10);
  const results = Array.isArray(res?.results) ? res.results : [];
  if (!results.length) {
    return `No team updates were parsed for ${wd}. Ask Jarvis to use numbered lines: "1. Change assignment of job for **Property (Unit)** to **Team N**."`;
  }
  const ok = results.filter((r) => r.ok);
  const bad = results.filter((r) => !r.ok);
  if (!ok.length) {
    const why = bad[0]?.message || 'Unknown error';
    if (why === 'TEAM_NOT_FOUND') {
      return `Could not resolve a team number from the summary for ${wd}. Check Operator → Team list.`;
    }
    return `Could not apply team updates for ${wd}. Check property/unit spelling, pinned teams, or row locks.`;
  }
  const parts = ok.map(
    (r) =>
      `Assigned **Team ${String(r.teamDigit || '')}** to **${String(r.propertyLabel || '').trim()}** (job ${String(r.jobId || '').trim()})`
  );
  let msg = `${parts.join('; ')} for **${wd}**. Refresh the Job list if needed.`;
  if (bad.length) {
    const detail = bad
      .slice(0, 4)
      .map((r) => `${String(r.propertyLabel || '').trim() || 'row'}: ${String(r.message || '').trim() || 'failed'}`)
      .join('; ');
    msg += ` ${bad.length} line(s) could not be applied (${detail}) — check spelling, pins, or locks.`;
  }
  return msg;
}

function jobMatchesStructuredTeamAssignHint(j, entry) {
  const pn = normScheduleJobPropertyNameToken(String(j.propertyName || ''));
  const un = normScheduleJobUnitToken(String(j.propertyUnit || ''));
  const nameOk =
    pn === entry.propertyName || pn.includes(entry.propertyName) || entry.propertyName.includes(pn);
  if (!nameOk || un !== entry.unitToken) return false;
  const h = String(entry.hint || '').trim().toLowerCase();
  if (!h) return true;
  const ct = String(j.cleaningType || '').toLowerCase();
  if (h.includes('deep') && !ct.includes('deep')) return false;
  if (h.includes('homestay') && !ct.includes('homestay')) return false;
  if (h.includes('warm') && !ct.includes('warm')) return false;
  if (h.includes('renovat') && !ct.includes('renovat')) return false;
  if (h.includes('general') && !ct.includes('general')) return false;
  if (h.includes('room') && h.includes('rental') && !ct.includes('room')) return false;
  return true;
}

/**
 * Jarvis multi-team bullet summary: **Team 1**: … **Team 2**: … (before consent footer / status block).
 * @returns {{ sections: Array<{ teamDigit: string, entries: Array<{ propertyName: string, unitToken: string, hint: string }> }> } | null}
 */
function tryParseStructuredMultiTeamAssignmentPlan(body) {
  const head = assistantBodyBeforeConsentFooter(String(body || ''));
  if (!head) return null;
  const headerRe = /\*\*Team\s+(\d+)\s*\*\*/gi;
  const hits = [];
  let m;
  while ((m = headerRe.exec(head)) !== null) {
    hits.push({ digit: String(m[1] || '').trim(), startIdx: m.index, headerLen: m[0].length });
  }
  if (hits.length < 2) return null;
  const sections = [];
  for (let i = 0; i < hits.length; i += 1) {
    const from = hits[i].startIdx + hits[i].headerLen;
    const to = i + 1 < hits.length ? hits[i + 1].startIdx : head.length;
    let chunk = head.slice(from, to);
    const statusCut = chunk.search(/\*\*Update Status\*\*/i);
    if (statusCut >= 0) chunk = chunk.slice(0, statusCut);
    const entries = [];
    for (const rawLine of chunk.split(/\n/)) {
      const line = rawLine.trim();
      if (!line || /^\d+\.\s*\*\*(Update Status|Status)\*\*/i.test(line)) break;
      if (/^\*\*(Job Type|Assign to|Property|Unit|Current Status)\*\*/i.test(line)) continue;
      const cleaned = line.replace(/^[-*•\d.)]+\s+/, '').trim();
      const um = cleaned.match(/^(.+?)\s*\(([^)]+)\)\s*(?:$|[-–—]\s*(.+))?$/);
      if (!um) continue;
      const propertyName = normScheduleJobPropertyNameToken(String(um[1] || ''));
      const unitToken = normScheduleJobUnitToken(String(um[2] || ''));
      const hint = String(um[3] || '').trim();
      if (propertyName && unitToken) entries.push({ propertyName, unitToken, hint });
    }
    sections.push({ teamDigit: hits[i].digit, entries });
  }
  const totalLines = sections.reduce((n, s) => n + s.entries.length, 0);
  if (totalLines < 2) return null;
  return { sections };
}

/** Deterministic apply when Jarvis listed jobs under **Team 1** / **Team 2** and operator confirmed yes. */
async function tryApplyStructuredMultiTeamAssignmentPlan({
  operatorId,
  workingDay,
  prevAssistantBody,
  pinnedConstraints,
}) {
  const wd = String(workingDay || '').slice(0, 10);
  const plan = tryParseStructuredMultiTeamAssignmentPlan(prevAssistantBody);
  if (!plan || !plan.sections?.length) {
    return { ok: false, applied: 0, rejected: [], assignments: [], message: 'NO_STRUCTURED_PLAN' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(wd) || !isMalaysiaYmdOnOrAfterToday(wd)) {
    return { ok: false, applied: 0, rejected: [], assignments: [], message: 'BAD_OR_PAST_DAY' };
  }
  const ctx = await loadScheduleContextForAi(operatorId, wd);
  const usedIds = new Set();
  const rejected = [];
  const assignments = [];
  let applied = 0;
  for (const sec of plan.sections) {
    const teamId = resolveTeamIdByDigitFromTeams(ctx.teams, sec.teamDigit);
    if (!teamId) {
      for (const ent of sec.entries) {
        rejected.push({
          jobId: '',
          reason: 'TEAM_NOT_FOUND',
          detail: `Team ${sec.teamDigit}: ${ent.propertyName} (${ent.unitToken})`,
        });
      }
      continue;
    }
    for (const ent of sec.entries) {
      const candidates = ctx.jobs.filter(
        (j) => !usedIds.has(j.id) && !isTerminalScheduleRaw(j.status) && jobMatchesStructuredTeamAssignHint(j, ent)
      );
      const pool = candidates.filter((j) => !j.aiLocked);
      const blocked = candidates.filter((j) => j.aiLocked);
      if (blocked.length && !pool.length) {
        rejected.push({ jobId: blocked[0].id, reason: 'AI_ASSIGNMENT_LOCKED' });
        continue;
      }
      const pick = pool.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
      if (!pick) {
        rejected.push({
          jobId: '',
          reason: 'NO_MATCH',
          detail: `Team ${sec.teamDigit}: ${ent.propertyName} (${ent.unitToken})`,
        });
        continue;
      }
      if (!validatePinnedForAssignment(pick.propertyId, teamId, pinnedConstraints)) {
        rejected.push({ jobId: pick.id, reason: 'PINNED_VIOLATION' });
        continue;
      }
      try {
        await cleanlemonSvc.updateOperatorScheduleJob(pick.id, { teamId });
        usedIds.add(pick.id);
        applied += 1;
        assignments.push({ jobId: pick.id, teamId, teamDigit: sec.teamDigit, reason: 'STRUCTURED_SUMMARY' });
      } catch (err) {
        rejected.push({ jobId: pick.id, reason: err?.message || 'UPDATE_FAILED' });
      }
    }
  }
  return {
    ok: applied > 0,
    applied,
    rejected,
    assignments,
    message: applied ? 'STRUCTURED_MULTI_TEAM' : 'NO_ROWS_TOUCHED',
  };
}

/**
 * After operator confirms: set eligible same-day jobs to ready-to-clean (pending-checkout only; skip terminal).
 */
async function tryApplyBulkReadyToCleanForWorkingDay({ operatorId, workingDay }) {
  const wd = String(workingDay || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(wd)) {
    return { ok: true, applied: 0, rejected: [], message: 'BAD_DAY', workingDay: wd };
  }
  if (!isMalaysiaYmdOnOrAfterToday(wd)) {
    return { ok: true, applied: 0, rejected: [], message: 'PAST_WORKING_DAY_READ_ONLY', workingDay: wd };
  }
  const ctx = await loadScheduleContextForAi(operatorId, wd);
  const rejected = [];
  let applied = 0;
  for (const j of ctx.jobs) {
    if (isTerminalScheduleRaw(j.status)) {
      rejected.push({ jobId: j.id, reason: 'TERMINAL' });
      continue;
    }
    const norm = normalizeScheduleStatusForAi(j.status);
    if (norm === 'ready-to-clean') continue;
    if (norm !== 'pending-checkout') {
      rejected.push({ jobId: j.id, reason: 'NOT_PENDING_CHECKOUT' });
      continue;
    }
    try {
      await cleanlemonSvc.updateOperatorScheduleJob(j.id, { status: 'ready-to-clean' });
      applied += 1;
    } catch (err) {
      rejected.push({ jobId: j.id, reason: err?.message || 'UPDATE_FAILED' });
    }
  }
  return { ok: true, applied, rejected, workingDay: wd };
}

/**
 * Bulk set status to pending-checkout for jobs currently ready-to-clean (same working day; skip terminal only).
 * Used when operator confirms Jarvis summary that asked to move all today’s jobs back to pending checkout.
 */
async function tryApplyBulkRevertToPendingCheckoutForWorkingDay({ operatorId, workingDay }) {
  const wd = String(workingDay || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(wd)) {
    return { ok: true, applied: 0, rejected: [], message: 'BAD_DAY', workingDay: wd };
  }
  if (!isMalaysiaYmdOnOrAfterToday(wd)) {
    return { ok: true, applied: 0, rejected: [], message: 'PAST_WORKING_DAY_READ_ONLY', workingDay: wd };
  }
  const ctx = await loadScheduleContextForAi(operatorId, wd);
  const rejected = [];
  let applied = 0;
  for (const j of ctx.jobs) {
    if (isTerminalScheduleRaw(j.status)) {
      rejected.push({ jobId: j.id, reason: 'TERMINAL' });
      continue;
    }
    const norm = normalizeScheduleStatusForAi(j.status);
    if (norm === 'pending-checkout') continue;
    if (norm !== 'ready-to-clean') {
      rejected.push({ jobId: j.id, reason: 'NOT_READY_TO_CLEAN' });
      continue;
    }
    try {
      await cleanlemonSvc.updateOperatorScheduleJob(j.id, { status: 'pending-checkout' });
      applied += 1;
    } catch (err) {
      rejected.push({ jobId: j.id, reason: err?.message || 'UPDATE_FAILED' });
    }
  }
  return { ok: true, applied, rejected, workingDay: wd };
}

/**
 * Numbered "… to **pending-checkout**" lines: only matching rows currently **ready-to-clean** revert to pending-checkout.
 */
async function tryApplySelectivePendingCheckoutFromAssistant({ operatorId, workingDay, prevAssistantBody }) {
  const wd = String(workingDay || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(wd)) {
    return { ok: true, applied: 0, rejected: [], message: 'BAD_DAY', workingDay: wd };
  }
  if (!isMalaysiaYmdOnOrAfterToday(wd)) {
    return { ok: true, applied: 0, rejected: [], message: 'PAST_WORKING_DAY_READ_ONLY', workingDay: wd };
  }
  const hints = parseNumberedPendingCheckoutEntries(prevAssistantBody);
  if (!hints.length) {
    return { ok: true, applied: 0, rejected: [], message: 'NO_HINTS', workingDay: wd };
  }
  const ctx = await loadScheduleContextForAi(operatorId, wd);
  const rejected = [];
  let applied = 0;
  const used = new Set();
  for (const j of ctx.jobs) {
    const hit = hints.some((h) => scheduleJobMatchesPropertyHint(j, h));
    if (!hit) continue;
    if (used.has(j.id)) continue;
    if (isTerminalScheduleRaw(j.status)) {
      rejected.push({ jobId: j.id, reason: 'TERMINAL' });
      continue;
    }
    const norm = normalizeScheduleStatusForAi(j.status);
    if (norm === 'pending-checkout') {
      rejected.push({ jobId: j.id, reason: 'ALREADY_PENDING_CHECKOUT' });
      continue;
    }
    if (norm !== 'ready-to-clean') {
      rejected.push({ jobId: j.id, reason: 'NOT_READY_TO_CLEAN' });
      continue;
    }
    try {
      await cleanlemonSvc.updateOperatorScheduleJob(j.id, { status: 'pending-checkout' });
      used.add(j.id);
      applied += 1;
    } catch (err) {
      rejected.push({ jobId: j.id, reason: err?.message || 'UPDATE_FAILED' });
    }
  }
  return { ok: true, applied, rejected, workingDay: wd, message: applied ? 'SELECTIVE_PCO' : 'NO_ROWS' };
}

async function tryApplyDeleteScheduleJobsFromAssistant({ operatorId, workingDay, prevAssistantBody }) {
  const wd = String(workingDay || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(wd)) {
    return { ok: false, applied: 0, message: 'BAD_DAY', results: [] };
  }
  if (!isMalaysiaYmdOnOrAfterToday(wd)) {
    return { ok: false, applied: 0, message: 'PAST_DAY', results: [] };
  }
  let entries = parseNumberedJobDeleteEntries(prevAssistantBody);
  if (!entries.length) entries = extractSingleJobDeleteTargetsFromAssistant(prevAssistantBody);
  if (!entries.length) {
    return { ok: false, applied: 0, message: 'NO_DELETE_TARGETS', results: [] };
  }
  const ctx = await loadScheduleContextForAi(operatorId, wd);
  const used = new Set();
  const results = [];
  let applied = 0;
  for (const ent of entries) {
    const entDay = ent.dateYmd ? String(ent.dateYmd).trim().slice(0, 10) : '';
    if (entDay && /^\d{4}-\d{2}-\d{2}$/.test(entDay) && entDay !== wd) {
      results.push({
        ok: false,
        label: `${ent.name} (${ent.unit})`,
        message: `DATE_MISMATCH:${entDay}`,
      });
      continue;
    }
    const hint = { name: ent.name, unit: ent.unit };
    const matches = ctx.jobs.filter((j) => !used.has(j.id) && scheduleJobMatchesPropertyHint(j, hint));
    const pick = matches.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
    if (!pick) {
      results.push({
        ok: false,
        label: `${ent.name} (${ent.unit})`,
        message: 'NO_MATCHING_JOB',
      });
      continue;
    }
    try {
      await cleanlemonSvc.deleteOperatorScheduleJob({ scheduleId: pick.id, operatorId });
      used.add(pick.id);
      applied += 1;
      results.push({
        ok: true,
        label: `${pick.propertyName} (${pick.propertyUnit})`,
        jobId: pick.id,
      });
    } catch (err) {
      results.push({
        ok: false,
        label: `${ent.name} (${ent.unit})`,
        message: String(err?.code || err?.message || err || 'DELETE_FAILED').slice(0, 200),
      });
    }
  }
  return { ok: applied > 0, applied, message: applied ? 'OK' : 'NONE', results };
}

function formatScheduleDeleteReplyForChat(res, dayYmd) {
  const wd = String(dayYmd || '').slice(0, 10);
  const results = Array.isArray(res?.results) ? res.results : [];
  const ok = results.filter((r) => r.ok);
  const bad = results.filter((r) => !r.ok);
  if (!ok.length) {
    if (bad.length && String(bad[0]?.message || '').startsWith('DATE_MISMATCH:')) {
      const wrong = String(bad[0].message).replace(/^DATE_MISMATCH:/, '');
      return `Delete summary named **${wrong}** but the Schedule toolbar day is **${wd}**. Pick that day on Schedule (or ask Jarvis again with the same date) and confirm.`;
    }
    if (bad.length && bad[0]?.message === 'NO_MATCHING_JOB') {
      return `No schedule row matched that property/unit for ${wd}. Open the Job list and delete manually if needed.`;
    }
    return `Could not delete schedule row(s) for ${wd}. Check spelling or try Schedule → delete on the row.`;
  }
  const parts = ok.map((r) => `Removed **${String(r.label || '').trim()}**`);
  let msg = `${parts.join('; ')} for **${wd}**. Refresh the Job list if needed.`;
  if (bad.length) {
    msg += ` ${bad.length} row(s) could not be deleted.`;
  }
  return msg;
}

function formatSchedulePendingCheckoutBulkReplyForChat(res, dayYmd) {
  if (!res) return '';
  if (res.message === 'PAST_WORKING_DAY_READ_ONLY') {
    return `No pending-checkout status changes were saved: ${dayYmd} is before Malaysia today.`;
  }
  const n = Number(res.applied) || 0;
  const rej = Array.isArray(res.rejected) ? res.rejected.length : 0;
  const detail = rej ? summarizeScheduleSuggestRejectionsForChat(res.rejected) : '';
  if (n > 0) {
    return `${n} job(s) set to pending-checkout for ${dayYmd}.${rej ? ` ${rej} row(s) skipped.${detail ? ` Details: ${detail}.` : ''}` : ''}`;
  }
  if (rej > 0) {
    return `No jobs moved to pending-checkout for ${dayYmd}; ${rej} row(s) skipped.${detail ? ` Details: ${detail}.` : ''}`;
  }
  return '';
}

function normSchedulePropToken(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Parse "mark … ARC … (unit) … ready to clean" from the last assistant consent summary. */
function extractReadyToCleanPropertyHintsFromAssistant(body) {
  const s = String(body || '');
  const hints = [];
  const seen = new Set();
  const add = (name, unit) => {
    const nm = String(name || '').trim();
    const un = String(unit || '').trim();
    if (!nm && !un) return;
    const k = `${normSchedulePropToken(nm)}|${normSchedulePropToken(un)}`;
    if (seen.has(k)) return;
    seen.add(k);
    hints.push({ name: nm, unit: un });
  };
  const re1 =
    /mark\s+(?:the\s+)?(?:job\s+)?(?:for\s+)?\s*([^.\n]+?)\s+as\s+["']?ready\s*[- ]?to\s*[- ]?clean/gi;
  let m;
  while ((m = re1.exec(s)) !== null) {
    const chunk = String(m[1] || '').trim();
    const paren = chunk.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    if (paren) add(paren[1].trim(), paren[2].trim());
    else add(chunk, '');
  }
  const re2 =
    /([A-Za-z0-9][A-Za-z0-9\s.'-]{2,80}?)\s*\(([A-Za-z0-9\-./]+)\)[^\n]{0,120}ready\s*[- ]?to\s*[- ]?clean/gi;
  while ((m = re2.exec(s)) !== null) {
    add(String(m[1] || '').trim(), String(m[2] || '').trim());
  }
  // Jarvis numbered summaries: "Change status of job for **ARC (A-33-09)** to **ready-to-clean**."
  const re3 =
    /Change\s+status\s+of\s+job\s+for\s+\*\*([^*]+)\*\*\s+to\s+\*\*ready\s*[- ]?to\s*[- ]?clean\*\*\.?/gi;
  while ((m = re3.exec(s)) !== null) {
    const inner = stripMarkdownBoldForScheduleParse(String(m[1] || '').trim());
    const paren = inner.match(/^(.+?)\s*\(\s*([^)]+?)\s*\)\s*$/);
    if (paren) add(paren[1].trim(), paren[2].trim());
    else if (inner) add(inner, '');
  }
  // Bold property (unit) then "to **ready-to-clean**" (handles markdown wrapping).
  const re4 = /\*\*([^*]+)\*\*\s+to\s+\*\*ready\s*[- ]?to\s*[- ]?clean\*\*\.?/gi;
  while ((m = re4.exec(s)) !== null) {
    const inner = stripMarkdownBoldForScheduleParse(String(m[1] || '').trim());
    const paren = inner.match(/^(.+?)\s*\(\s*([^)]+?)\s*\)\s*$/);
    if (paren) add(paren[1].trim(), paren[2].trim());
  }
  return hints;
}

function scheduleJobMatchesPropertyHint(job, hint) {
  const jn = normSchedulePropToken(job.propertyName);
  const ju = normSchedulePropToken(job.propertyUnit);
  const hn = normSchedulePropToken(hint.name);
  const hu = normSchedulePropToken(hint.unit);
  if (!jn && !ju) return false;
  if (hu) {
    const unitOk = Boolean(ju && ju === hu);
    if (!unitOk) return false;
    if (!hn) return true;
    if (!jn) return true;
    return Boolean(jn === hn || jn.includes(hn) || hn.includes(jn));
  }
  return Boolean(hn && jn && (jn === hn || jn.includes(hn) || hn.includes(jn)));
}

/**
 * After team consent apply: if the assistant summary also asked to mark specific property/unit rows as ready-to-clean, apply those only.
 */
async function tryApplySelectiveReadyToCleanFromAssistant({ operatorId, workingDay, prevAssistantBody }) {
  const wd = String(workingDay || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(wd)) return { applied: 0, rejected: [] };
  if (!isMalaysiaYmdOnOrAfterToday(wd)) return { applied: 0, rejected: [{ reason: 'PAST_DAY' }] };
  if (!/\bready\s*[- ]?to\s*[- ]?clean\b/i.test(String(prevAssistantBody || ''))) {
    return { applied: 0, rejected: [] };
  }
  const head = assistantBodyBeforeConsentFooter(String(prevAssistantBody || ''));
  const hints = extractReadyToCleanPropertyHintsFromAssistant(head);
  if (!hints.length) return { applied: 0, rejected: [] };

  const ctx = await loadScheduleContextForAi(operatorId, wd);
  const rejected = [];
  let applied = 0;
  for (const j of ctx.jobs) {
    const hit = hints.some((h) => scheduleJobMatchesPropertyHint(j, h));
    if (!hit) continue;
    if (isTerminalScheduleRaw(j.status)) {
      rejected.push({ jobId: j.id, reason: 'TERMINAL' });
      continue;
    }
    const norm = normalizeScheduleStatusForAi(j.status);
    if (norm === 'ready-to-clean') continue;
    if (norm !== 'pending-checkout') {
      rejected.push({ jobId: j.id, reason: 'NOT_PENDING_CHECKOUT' });
      continue;
    }
    try {
      await cleanlemonSvc.updateOperatorScheduleJob(j.id, { status: 'ready-to-clean' });
      applied += 1;
    } catch (err) {
      rejected.push({ jobId: j.id, reason: err?.message || 'UPDATE_FAILED' });
    }
  }
  // #region agent log
  __dbgJarvisYesFlow({
    hypothesisId: 'H8_SELECTIVE_MATCH',
    location: 'cln-operator-ai.service.js:tryApplySelectiveReadyToCleanFromAssistant:exit',
    message: 'selective RTC summary',
    data: {
      workingDay: wd,
      hintsJson: JSON.stringify(hints).slice(0, 500),
      applied,
      rejectedN: rejected.length,
      matchedJobIds: ctx.jobs
        .filter((j) => hints.some((h) => scheduleJobMatchesPropertyHint(j, h)))
        .map((j) => String(j.id || ''))
        .slice(0, 20),
    },
  });
  // #endregion
  return { applied, rejected };
}

function validateTeamId(teamId, teams) {
  return teams.some((t) => t.id === teamId);
}

function normTeamLabelForResolve(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Map LLM `teamId` / `toTeamId` to a real UUID: accepts valid id, exact team name, or labels like "Team 2" / "team 2".
 * Reduces BAD_TEAM when the model echoes a display name instead of Teams[].id.
 */
function resolveModelTeamIdToCanonicalId(rawTeamId, teams) {
  const raw = String(rawTeamId || '').trim();
  if (!raw) return '';
  const teamArr = Array.isArray(teams) ? teams : [];
  if (validateTeamId(raw, teamArr)) return raw;
  const mapByName = teamNameToIdMap(teamArr);
  if (mapByName.has(raw)) return String(mapByName.get(raw));
  const nRaw = normTeamLabelForResolve(raw);
  for (const t of teamArr) {
    if (!t || t.id == null) continue;
    const nm = String(t.name || '').trim();
    if (nm && normTeamLabelForResolve(nm) === nRaw) return String(t.id);
  }
  let digit = null;
  const tm = raw.match(/team\s*(\d+)/i);
  if (tm) digit = String(tm[1]);
  else if (/^\d+$/.test(raw)) digit = raw;
  if (digit) {
    for (const t of teamArr) {
      const m = String(t.name || '').match(/team\s*(\d+)/i);
      if (m && String(m[1]) === digit) return String(t.id);
    }
  }
  return '';
}

function validatePinnedForAssignment(propertyId, teamId, pinned) {
  if (!Array.isArray(pinned) || !pinned.length) return true;
  for (const c of pinned) {
    if (String(c.type) !== 'property_only_teams') continue;
    if (String(c.propertyId) !== String(propertyId)) continue;
    const allowed = Array.isArray(c.teamIds) ? c.teamIds.map(String) : [];
    if (allowed.length && !allowed.includes(String(teamId))) return false;
  }
  return true;
}

function teamNameToIdMap(teams) {
  const m = new Map();
  for (const t of teams || []) {
    if (t && t.name && t.id) m.set(String(t.name), String(t.id));
  }
  return m;
}

function enrichJobsWithTeamIds(jobs, teams) {
  const nameToId = teamNameToIdMap(teams);
  return (jobs || []).map((j) => ({
    ...j,
    teamId:
      !isTeamSlotEmptyForAssign(j.teamName) && String(j.teamName || '').trim()
        ? nameToId.get(String(j.teamName).trim()) || null
        : null,
  }));
}

function isTerminalScheduleRaw(rawStatus) {
  const s = String(rawStatus || '').toLowerCase().replace(/\s+/g, '-');
  if (s.includes('complete')) return true;
  if (s.includes('cancel')) return true;
  if (s === 'done') return true;
  return false;
}

function isReadyToCleanRaw(rawStatus) {
  if (isTerminalScheduleRaw(rawStatus)) return false;
  const x = String(rawStatus || '').toLowerCase().replace(/\s+/g, '-');
  if (x.includes('progress')) return false;
  if (x.includes('checkout') || x === 'pending-checkout') return false;
  return true;
}

function strictCoverageEnabled() {
  return !!String(process.env.CLEANLEMON_AI_STRICT_COVERAGE || '').match(/^1|true$/i);
}

/** operatorId -> last successful rebalance epoch ms */
const lastRebalanceAtByOperator = new Map();

/**
 * Full-day suggest: assigns teamId (UUID) to jobs; respects pinned constraints when possible.
 * @param {boolean} [includeExistingTeamJobs=false] — if true, every non-terminal job is eligible (rebalance); else only empty team slots (cron / Save settings).
 */
async function runScheduleAiSuggest({ operatorId, workingDay, apply = false, includeExistingTeamJobs = false }) {
  const oid = String(operatorId || '').trim();
  await assertScheduleAiAllowedByPlatform();
  const creds = await clnInt.getDecryptedAiApiKeyForOperator(oid);
  if (!creds?.apiKey) throw new Error('AI_NOT_CONFIGURED');

  const settings = await getOperatorAiSettingsForApi(oid);
  const prefs = settings.schedulePrefs;
  if (!prefs.aiScheduleCronEnabled && apply) {
    /* allow manual/internal call with apply even if cron disabled — caller decides */
  }

  const ctx = await loadScheduleContextForAi(oid, workingDay);
  if (apply && !isMalaysiaYmdOnOrAfterToday(ctx.day)) {
    // #region agent log
    __dbgJarvisYesFlow({
      hypothesisId: 'H4',
      location: 'cln-operator-ai.service.js:runScheduleAiSuggest:past_day',
      message: 'apply skipped past working day',
      data: { ctxDay: ctx.day, malaysiaToday: malaysiaTodayYmd() },
    });
    // #endregion
    return {
      ok: true,
      assignments: [],
      rejected: [],
      applied: 0,
      message: 'PAST_WORKING_DAY_READ_ONLY',
      workingDay: ctx.day,
    };
  }

  const pickEligible = includeExistingTeamJobs ? jobEligibleForAiFullDayReassign : jobEligibleForAiAssign;
  const eligible = ctx.jobs.filter(pickEligible);
  if (!eligible.length) {
    // #region agent log
    __dbgJarvisYesFlow({
      hypothesisId: 'H4',
      location: 'cln-operator-ai.service.js:runScheduleAiSuggest:no_eligible',
      message: 'no eligible jobs for suggest',
      data: { apply: !!apply, includeExistingTeamJobs: !!includeExistingTeamJobs, ctxDay: ctx.day },
    });
    // #endregion
    return { ok: true, assignments: [], applied: 0, message: 'NO_ELIGIBLE_JOBS' };
  }

  const areaBlock = buildAreaTeamAllocationNarrative(settings, ctx, eligible);
  const timingBlock = buildTimingAndStatusRulesNarrative(prefs);

  const pr = await safePlatformRulesPrefix();
  const rebalanceRule = includeExistingTeamJobs
    ? '- Jobs may already have a team; output a complete fresh assignment for every eligible jobId (rebalance / 全日重派).\n'
    : '';
  const system = `${pr}You assign cleaning jobs to teams. Output ONLY valid JSON, no markdown.
Schema: { "assignments": [ { "jobId": "uuid", "teamId": "uuid", "reason": "short" } ] }
Rules:
- Only this operator's jobs and teams; never assign across operators.
- Every eligible jobId must appear exactly once.
${rebalanceRule}- teamId MUST be one of the provided team ids: copy exactly from Teams[].id (UUID). Do not invent UUIDs; if unsure, use the id string from the Teams list, not the display name alone.
- This batch is for workingDay ${ctx.day} (Malaysia calendar): applying assignments updates the database only when that day is today or future; the server rejects past days.
- Respect pinned constraints: for property_only_teams, only use allowed teamIds for that property.
- Team routing mode (teamAssignmentMode): prefer_same = prefer the same team for nearby jobs; rotate_same_property = vary teams across repeat visits to the same property when possible; balanced = fair split across teams (no strong bias to one crew).
Teams: ${JSON.stringify(ctx.teams)}
Pinned constraints: ${JSON.stringify(settings.pinnedConstraints)}
Region groups (propertyIds per area for map / zoning): ${JSON.stringify(normalizeRegionGroups(settings.regionGroups))}
Preferences: ${JSON.stringify({
    teamAssignmentMode: String(prefs.aiScheduleTeamAssignmentMode || 'prefer_same'),
    preferSameTeam: !!prefs.aiSchedulePreferSameTeamWhenPossible,
    samePropertyDifferentTeam: !!prefs.aiScheduleSamePropertyDifferentTeamAlways,
    maxPerTeam: prefs.maxJobsPerTeamPerDay || 15,
    minBufferMinutesSameLocation: normalizeBufferMinutes(prefs.aiScheduleMinBufferMinutesSameLocation),
    minBufferMinutesDifferentLocation: normalizeBufferMinutes(prefs.aiScheduleMinBufferMinutesDifferentLocation),
    homestayServiceWindowLocal: `${normalizeHmLocal(prefs.aiScheduleHomestayWindowStartLocal, '11:00')}-${normalizeHmLocal(prefs.aiScheduleHomestayWindowEndLocal, '16:00')}`,
  })}
${timingBlock}

${areaBlock ? `${areaBlock}\n` : ''}Operator notes: ${settings.promptExtra || ''}`;

  const user = `workingDay: ${ctx.day}\nEligible jobs (assign each): ${JSON.stringify(
    eligible.map((j) => ({
      jobId: j.id,
      propertyId: j.propertyId,
      status: j.status,
      statusNormalized: j.statusNormalized,
      cleaningType: j.cleaningType,
      isHomestay: j.isHomestay,
      staffStartTime: j.staffStartTime,
      staffEndTime: j.staffEndTime,
      hasScheduledTimeSlot: j.hasScheduledTimeSlot,
    }))
  )}${SCHEDULE_LLM_JSON_ONLY_TAIL}`;

  const raw = await invokeOperatorLlm({
    provider: creds.provider,
    apiKey: creds.apiKey,
    system,
    user,
  });

  let parsed;
  try {
    parsed = extractJsonObject(raw);
  } catch (e) {
    throw wrapLlmJsonParseError(e);
  }
  const list = Array.isArray(parsed.assignments) ? parsed.assignments : [];
  const eligibleIds = new Set(eligible.map((j) => j.id));
  const propertyByJob = new Map(eligible.map((j) => [j.id, j.propertyId]));

  const valid = [];
  const rejected = [];
  for (const a of list) {
    const jobId = String(a.jobId || '').trim();
    const rawTeam = String(a.teamId || '').trim();
    const teamId = resolveModelTeamIdToCanonicalId(rawTeam, ctx.teams);
    if (!eligibleIds.has(jobId)) {
      rejected.push({ jobId, reason: 'NOT_ELIGIBLE' });
      continue;
    }
    if (!teamId || !validateTeamId(teamId, ctx.teams)) {
      rejected.push({ jobId, reason: 'BAD_TEAM' });
      continue;
    }
    const pid = propertyByJob.get(jobId);
    if (!validatePinnedForAssignment(pid, teamId, settings.pinnedConstraints)) {
      rejected.push({ jobId, reason: 'PINNED_VIOLATION' });
      continue;
    }
    valid.push({ jobId, teamId, reason: a.reason });
  }

  // #region agent log
  __dbgJarvisYesFlow({
    hypothesisId: 'H4',
    location: 'cln-operator-ai.service.js:runScheduleAiSuggest:after_validate',
    message: 'parsed assignments vs eligible',
    data: {
      apply: !!apply,
      includeExistingTeamJobs: !!includeExistingTeamJobs,
      ctxDay: ctx.day,
      eligibleN: eligible.length,
      modelAssignmentsN: list.length,
      validN: valid.length,
      rejectedN: rejected.length,
      strictCoverage: strictCoverageEnabled(),
    },
  });
  // #endregion

  if (apply && strictCoverageEnabled() && valid.length !== eligible.length) {
    return {
      ok: false,
      reason: 'INCOMPLETE_COVERAGE',
      expected: eligible.length,
      got: valid.length,
      assignments: valid,
      rejected,
      applied: 0,
      rawModel: process.env.CLEANLEMON_AI_DEBUG === '1' ? raw : undefined,
    };
  }

  let applied = 0;
  if (apply && valid.length) {
    for (const x of valid) {
      try {
        await cleanlemonSvc.updateOperatorScheduleJob(x.jobId, { teamId: x.teamId });
        applied += 1;
      } catch (err) {
        rejected.push({ jobId: x.jobId, reason: err?.message || 'UPDATE_FAILED' });
      }
    }
  }

  // #region agent log
  __dbgJarvisYesFlow({
    hypothesisId: 'H5',
    location: 'cln-operator-ai.service.js:runScheduleAiSuggest:exit',
    message: 'suggest finished',
    data: { apply: !!apply, applied, validN: valid.length, rejectedNAfterDb: rejected.length },
  });
  // #endregion

  return {
    ok: true,
    assignments: valid,
    rejected,
    applied,
    rawModel: process.env.CLEANLEMON_AI_DEBUG === '1' ? raw : undefined,
  };
}

/**
 * Incremental: assign teams only for given job ids (empty team slot). Existing rows are context only.
 */
async function runScheduleAiSuggestIncremental({ operatorId, workingDay, newJobIds, apply = false }) {
  const oid = String(operatorId || '').trim();
  const wantIds = new Set((newJobIds || []).map((x) => String(x || '').trim()).filter(Boolean));
  if (!oid || !wantIds.size) throw new Error('INVALID_PARAMS');

  await assertScheduleAiAllowedByPlatform();
  const creds = await clnInt.getDecryptedAiApiKeyForOperator(oid);
  if (!creds?.apiKey) throw new Error('AI_NOT_CONFIGURED');

  const settings = await getOperatorAiSettingsForApi(oid);
  const ctx = await loadScheduleContextForAi(oid, workingDay);
  if (apply && !isMalaysiaYmdOnOrAfterToday(ctx.day)) {
    return {
      ok: true,
      mode: 'incremental',
      assignments: [],
      rejected: [],
      applied: 0,
      message: 'PAST_WORKING_DAY_READ_ONLY',
      workingDay: ctx.day,
    };
  }

  const eligible = ctx.jobs.filter((j) => wantIds.has(j.id) && jobEligibleForAiAssign(j));
  if (!eligible.length) {
    return { ok: true, mode: 'incremental', assignments: [], applied: 0, message: 'NO_ELIGIBLE_NEW_JOBS' };
  }

  const frozen = ctx.jobs
    .filter((j) => !wantIds.has(j.id) && !isTeamSlotEmptyForAssign(j.teamName))
    .map((j) => ({
      jobId: j.id,
      propertyId: j.propertyId,
      teamName: j.teamName || null,
      locked: j.aiLocked,
      status: j.status,
    }));

  const prefs = settings.schedulePrefs;
  const areaBlock = buildAreaTeamAllocationNarrative(settings, ctx, eligible);
  const timingBlock = buildTimingAndStatusRulesNarrative(prefs);
  const pr = await safePlatformRulesPrefix();
  const system = `${pr}You assign cleaning jobs to teams. Output ONLY valid JSON, no markdown.
Schema: { "assignments": [ { "jobId": "uuid", "teamId": "uuid", "reason": "short" } ] }
This is INCREMENTAL: assign ONLY the jobs listed under "newJobs". Do NOT include other jobIds.
- Only this operator's jobs and teams; never assign across operators.
- Every new jobId must appear exactly once.
- teamId MUST be one of the provided team ids: copy exactly from Teams[].id (UUID). Do not invent UUIDs.
- Respect pinned constraints.
- Consider existing fixed assignments as context (do not change them): frozen rows below.
- Team routing mode (teamAssignmentMode): prefer_same | rotate_same_property | balanced — see Preferences JSON.
Teams: ${JSON.stringify(ctx.teams)}
Pinned constraints: ${JSON.stringify(settings.pinnedConstraints)}
Region groups (propertyIds per area): ${JSON.stringify(normalizeRegionGroups(settings.regionGroups))}
Preferences: ${JSON.stringify({
    teamAssignmentMode: String(prefs.aiScheduleTeamAssignmentMode || 'prefer_same'),
    preferSameTeam: !!prefs.aiSchedulePreferSameTeamWhenPossible,
    samePropertyDifferentTeam: !!prefs.aiScheduleSamePropertyDifferentTeamAlways,
    maxPerTeam: prefs.maxJobsPerTeamPerDay || 15,
    minBufferMinutesSameLocation: normalizeBufferMinutes(prefs.aiScheduleMinBufferMinutesSameLocation),
    minBufferMinutesDifferentLocation: normalizeBufferMinutes(prefs.aiScheduleMinBufferMinutesDifferentLocation),
    homestayServiceWindowLocal: `${normalizeHmLocal(prefs.aiScheduleHomestayWindowStartLocal, '11:00')}-${normalizeHmLocal(prefs.aiScheduleHomestayWindowEndLocal, '16:00')}`,
  })}
${timingBlock}

${areaBlock ? `${areaBlock}\n` : ''}Existing context (frozen): ${JSON.stringify(frozen)}
Operator notes: ${settings.promptExtra || ''}`;

  const user = `workingDay: ${ctx.day}\nNew jobs to assign: ${JSON.stringify(
    eligible.map((j) => ({
      jobId: j.id,
      propertyId: j.propertyId,
      status: j.status,
      statusNormalized: j.statusNormalized,
      cleaningType: j.cleaningType,
      isHomestay: j.isHomestay,
      staffStartTime: j.staffStartTime,
      staffEndTime: j.staffEndTime,
      hasScheduledTimeSlot: j.hasScheduledTimeSlot,
    }))
  )}${SCHEDULE_LLM_JSON_ONLY_TAIL}`;

  const raw = await invokeOperatorLlm({
    provider: creds.provider,
    apiKey: creds.apiKey,
    system,
    user,
  });

  let parsed;
  try {
    parsed = extractJsonObject(raw);
  } catch (e) {
    throw wrapLlmJsonParseError(e);
  }
  const list = Array.isArray(parsed.assignments) ? parsed.assignments : [];
  const eligibleIds = new Set(eligible.map((j) => j.id));
  const propertyByJob = new Map(eligible.map((j) => [j.id, j.propertyId]));

  const valid = [];
  const rejected = [];
  for (const a of list) {
    const jobId = String(a.jobId || '').trim();
    const rawTeam = String(a.teamId || '').trim();
    const teamId = resolveModelTeamIdToCanonicalId(rawTeam, ctx.teams);
    if (!eligibleIds.has(jobId)) {
      rejected.push({ jobId, reason: 'NOT_ELIGIBLE' });
      continue;
    }
    if (!teamId || !validateTeamId(teamId, ctx.teams)) {
      rejected.push({ jobId, reason: 'BAD_TEAM' });
      continue;
    }
    const pid = propertyByJob.get(jobId);
    if (!validatePinnedForAssignment(pid, teamId, settings.pinnedConstraints)) {
      rejected.push({ jobId, reason: 'PINNED_VIOLATION' });
      continue;
    }
    valid.push({ jobId, teamId, reason: a.reason });
  }

  if (apply && strictCoverageEnabled() && valid.length !== eligible.length) {
    return {
      ok: false,
      mode: 'incremental',
      reason: 'INCOMPLETE_COVERAGE',
      expected: eligible.length,
      got: valid.length,
      assignments: valid,
      rejected,
      applied: 0,
      rawModel: process.env.CLEANLEMON_AI_DEBUG === '1' ? raw : undefined,
    };
  }

  let applied = 0;
  if (apply && valid.length) {
    for (const x of valid) {
      try {
        await cleanlemonSvc.updateOperatorScheduleJob(x.jobId, { teamId: x.teamId });
        applied += 1;
      } catch (err) {
        rejected.push({ jobId: x.jobId, reason: err?.message || 'UPDATE_FAILED' });
      }
    }
  }

  return {
    ok: true,
    mode: 'incremental',
    assignments: valid,
    rejected,
    applied,
    rawModel: process.env.CLEANLEMON_AI_DEBUG === '1' ? raw : undefined,
  };
}

/**
 * Rebalance: may reassign ready-to-clean jobs that have a team (skip terminal only).
 * @param {object} [opts]
 * @param {'post_completion'|'progress_watch'|undefined} [opts.rebalanceContext]
 */
async function runScheduleAiRebalance({
  operatorId,
  workingDay,
  apply = false,
  force = false,
  rebalanceContext,
} = {}) {
  const oid = String(operatorId || '').trim();
  await assertScheduleAiAllowedByPlatform();
  const creds = await clnInt.getDecryptedAiApiKeyForOperator(oid);
  if (!creds?.apiKey) throw new Error('AI_NOT_CONFIGURED');

  const settings = await getOperatorAiSettingsForApi(oid);
  const prefs = settings.schedulePrefs;
  const postCompleteOk =
    rebalanceContext === 'post_completion' && prefs.aiScheduleRebalanceOnTaskComplete;
  const allow =
    !!force || !!prefs.aiScheduleProgressWatchEnabled || postCompleteOk;
  if (!allow) {
    return {
      ok: true,
      mode: 'rebalance',
      skipped: true,
      reason: 'REBALANCE_DISABLED',
      reassignments: [],
      applied: 0,
    };
  }

  const ctx = await loadScheduleContextForAi(oid, workingDay);
  if (apply && !isMalaysiaYmdOnOrAfterToday(ctx.day)) {
    return {
      ok: true,
      mode: 'rebalance',
      reassignments: [],
      rejected: [],
      applied: 0,
      message: 'PAST_WORKING_DAY_READ_ONLY',
      workingDay: ctx.day,
    };
  }

  const enriched = enrichJobsWithTeamIds(ctx.jobs, ctx.teams);

  const rebalEligible = enriched.filter(
    (j) => !isTerminalScheduleRaw(j.status) && isReadyToCleanRaw(j.status) && j.teamId
  );

  if (!rebalEligible.length) {
    return { ok: true, mode: 'rebalance', reassignments: [], applied: 0, message: 'NO_REBALANCE_TARGETS' };
  }

  const loadByTeam = {};
  for (const j of enriched) {
    if (!j.teamId || isTerminalScheduleRaw(j.status)) continue;
    loadByTeam[j.teamId] = (loadByTeam[j.teamId] || 0) + 1;
  }

  const inProgress = enriched
    .filter((j) => String(j.status || '').toLowerCase().includes('progress') && !isTerminalScheduleRaw(j.status))
    .map((j) => ({ jobId: j.id, propertyId: j.propertyId, teamId: j.teamId, status: j.status }));

  const postCompletionHint =
    rebalanceContext === 'post_completion'
      ? `Context: staff just completed one or more jobs on this working day. If some teams are clearly slower or overloaded compared to others, move ready-to-clean jobs from busier/slower teams to teams with spare capacity. Prefer minimal changes.`
      : '';

  const timingBlock = buildTimingAndStatusRulesNarrative(prefs);
  const pr = await safePlatformRulesPrefix();
  const system = `${pr}You rebalance team assignments for one working day. Output ONLY valid JSON, no markdown.
Schema: { "reassignments": [ { "jobId": "uuid", "toTeamId": "uuid", "reason": "short" } ] }
Rules:
- Only this operator's jobs and teams; never reassign across operators.
- Only include jobIds from the "rebalancable" list (ready-to-clean, already have a team; terminal jobs excluded).
- toTeamId MUST be one of the team ids: copy exactly from Teams[].id (UUID). Do not invent UUIDs.
- Prefer moving jobs from overloaded teams to underloaded teams; use region groups and pinned constraints.
- If in-progress jobs suggest a team is delayed, you may move some ready-to-clean jobs OFF that team to others.
- Do not reassign the same job to its current team (must change team when included).
- It is valid to return an empty reassignments array if no change is needed.
${postCompletionHint}
${timingBlock}

Teams: ${JSON.stringify(ctx.teams)}
Pinned constraints: ${JSON.stringify(settings.pinnedConstraints)}
Region groups: ${JSON.stringify(normalizeRegionGroups(settings.regionGroups))}
Active job counts by teamId (non-terminal): ${JSON.stringify(loadByTeam)}
Operator notes: ${settings.promptExtra || ''}`;

  const user = `workingDay: ${ctx.day}
In-progress (context): ${JSON.stringify(inProgress)}
Rebalancable jobs: ${JSON.stringify(
    rebalEligible.map((j) => ({
      jobId: j.id,
      propertyId: j.propertyId,
      currentTeamId: j.teamId,
      status: j.status,
      statusNormalized: j.statusNormalized,
      isHomestay: j.isHomestay,
      staffStartTime: j.staffStartTime,
      staffEndTime: j.staffEndTime,
      hasScheduledTimeSlot: j.hasScheduledTimeSlot,
    }))
  )}${SCHEDULE_LLM_JSON_ONLY_TAIL}`;

  const raw = await invokeOperatorLlm({
    provider: creds.provider,
    apiKey: creds.apiKey,
    system,
    user,
  });

  let parsed;
  try {
    parsed = extractJsonObject(raw);
  } catch (e) {
    throw wrapLlmJsonParseError(e);
  }

  const list = Array.isArray(parsed.reassignments) ? parsed.reassignments : [];
  const eligibleIds = new Set(rebalEligible.map((j) => j.id));
  const currentTeamByJob = new Map(rebalEligible.map((j) => [j.id, j.teamId]));
  const propertyByJob = new Map(rebalEligible.map((j) => [j.id, j.propertyId]));

  const valid = [];
  const rejected = [];
  for (const a of list) {
    const jobId = String(a.jobId || '').trim();
    const rawTo = String(a.toTeamId || '').trim();
    const toTeamId = resolveModelTeamIdToCanonicalId(rawTo, ctx.teams);
    if (!eligibleIds.has(jobId)) {
      rejected.push({ jobId, reason: 'NOT_ELIGIBLE' });
      continue;
    }
    if (!toTeamId || !validateTeamId(toTeamId, ctx.teams)) {
      rejected.push({ jobId, reason: 'BAD_TEAM' });
      continue;
    }
    const cur = currentTeamByJob.get(jobId);
    if (cur && cur === toTeamId) {
      rejected.push({ jobId, reason: 'NO_CHANGE' });
      continue;
    }
    const pid = propertyByJob.get(jobId);
    if (!validatePinnedForAssignment(pid, toTeamId, settings.pinnedConstraints)) {
      rejected.push({ jobId, reason: 'PINNED_VIOLATION' });
      continue;
    }
    valid.push({ jobId, toTeamId, reason: a.reason });
  }

  let applied = 0;
  if (apply && valid.length) {
    for (const x of valid) {
      try {
        await cleanlemonSvc.updateOperatorScheduleJob(x.jobId, { teamId: x.toTeamId });
        applied += 1;
      } catch (err) {
        rejected.push({ jobId: x.jobId, reason: err?.message || 'UPDATE_FAILED' });
      }
    }
  }

  return {
    ok: true,
    mode: 'rebalance',
    reassignments: valid,
    rejected,
    applied,
    rawModel: process.env.CLEANLEMON_AI_DEBUG === '1' ? raw : undefined,
  };
}

function kualaLumpurTodayYmd() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
}

/** @returns {{ ymd: string, minutesFromMidnight: number }} */
function kualaLumpurNowClock() {
  const d = new Date();
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(d);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return { ymd, minutesFromMidnight: h * 60 + m };
}

/** Add calendar days to YYYY-MM-DD (civil date; no DST issues for MY). */
function addDaysToYmd(ymd, deltaDays) {
  const parts = String(ymd || '')
    .slice(0, 10)
    .split('-')
    .map((x) => parseInt(x, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return String(ymd).slice(0, 10);
  const [y, m, d] = parts;
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + deltaDays);
  const y2 = base.getUTCFullYear();
  const mo = String(base.getUTCMonth() + 1).padStart(2, '0');
  const da = String(base.getUTCDate()).padStart(2, '0');
  return `${y2}-${mo}-${da}`;
}

/**
 * Midnight batch (KL): for each operator, assign empty teams for working_day anchor..anchor+N-1.
 * Requires last_schedule_ai_cron_day (0232). When skipIfAlreadyRan, skips operators with last_schedule_ai_cron_day === anchorYmd.
 */
async function runMidnightScheduleAiBatch({ anchorYmd, skipIfAlreadyRan = true } = {}) {
  const anchor =
    anchorYmd && /^\d{4}-\d{2}-\d{2}$/.test(String(anchorYmd).slice(0, 10))
      ? String(anchorYmd).slice(0, 10)
      : kualaLumpurTodayYmd();
  const hasCol = await databaseHasColumn('cln_operator_ai', 'last_schedule_ai_cron_day');
  if (!hasCol) {
    return {
      ok: false,
      reason: 'MIGRATION_0232_REQUIRED',
      message: 'Run migration 0232_cln_operator_ai_last_cron_day.sql',
      results: [],
    };
  }

  const gate = await getScheduleAiPlatformGate();
  if (!gate.ok) {
    return { ok: true, skipped: true, reason: gate.code, anchorYmd: anchor, results: [] };
  }

  const [opRows] = await pool.query(
    `SELECT DISTINCT operator_id FROM cln_operator_integration
     WHERE \`key\` = 'aiAgent' AND enabled = 1`
  );
  const results = [];
  for (const r of opRows || []) {
    const oid = String(r.operator_id || '').trim();
    if (!oid) continue;
    try {
      const row = await getOperatorAiRow(oid);
      const prefs = normalizePrefs(safeJsonParse(row?.schedule_prefs_json, {}));
      if (!prefs.aiScheduleCronEnabled) {
        results.push({ operatorId: oid, skipped: true, reason: 'CRON_DISABLED' });
        continue;
      }
      const lastDay =
        row?.last_schedule_ai_cron_day != null ? String(row.last_schedule_ai_cron_day).slice(0, 10) : '';
      if (skipIfAlreadyRan && lastDay === anchor) {
        results.push({ operatorId: oid, skipped: true, reason: 'ALREADY_RAN_THIS_ANCHOR' });
        continue;
      }
      const creds = await clnInt.getDecryptedAiApiKeyForOperator(oid);
      if (!creds?.apiKey) {
        results.push({ operatorId: oid, skipped: true, reason: 'NO_KEY' });
        continue;
      }

      const horizon = prefs.aiSchedulePlanningHorizonDays || 1;
      const dayResults = [];
      let batchOk = true;
      const errParts = [];
      for (let off = 0; off < horizon; off += 1) {
        const wd = addDaysToYmd(anchor, off);
        try {
          const out = await runScheduleAiSuggest({ operatorId: oid, workingDay: wd, apply: true });
          dayResults.push({ workingDay: wd, ...out });
          if (out.ok === false) {
            batchOk = false;
            errParts.push(
              `${wd}: ${out.reason || 'FAILED'}${out.expected != null ? ` (expected ${out.expected}, got ${out.got})` : ''}`
            );
          }
        } catch (dayErr) {
          batchOk = false;
          const em = dayErr?.message || String(dayErr);
          dayResults.push({ workingDay: wd, ok: false, error: em });
          errParts.push(`${wd}: ${em}`);
        }
      }
      if (batchOk) {
        await pool.query(
          `UPDATE cln_operator_ai SET last_schedule_ai_cron_day = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE operator_id = ? LIMIT 1`,
          [anchor, oid]
        );
        await clearScheduleAiFailure(oid);
      } else {
        const summary = errParts.length ? errParts.join(' | ') : 'Daily AI schedule batch failed';
        await recordScheduleAiFailure(oid, summary, 'midnight_batch');
      }
      results.push({ operatorId: oid, anchorYmd: anchor, horizon, dayResults });
    } catch (e) {
      const em = e?.message || String(e);
      results.push({ operatorId: oid, ok: false, error: em });
      try {
        await recordScheduleAiFailure(oid, em, 'midnight_batch');
      } catch (_) {
        /* ignore */
      }
    }
  }
  return { ok: true, anchorYmd: anchor, results };
}

/**
 * In-process: if KL time is 00:00–00:05 and migration ok, run midnight batch once per anchor per operator.
 */
async function runMidnightScheduleAiTick() {
  const hasCol = await databaseHasColumn('cln_operator_ai', 'last_schedule_ai_cron_day');
  if (!hasCol) {
    return { ok: false, reason: 'MIGRATION_0232_REQUIRED', results: [] };
  }
  const { ymd, minutesFromMidnight } = kualaLumpurNowClock();
  const h = Math.floor(minutesFromMidnight / 60);
  const min = minutesFromMidnight % 60;
  if (h !== 0 || min > 5) {
    return { ok: true, skipped: true, reason: 'NOT_MIDNIGHT_WINDOW', anchorYmd: ymd, klHour: h, klMinute: min };
  }
  return runMidnightScheduleAiBatch({ anchorYmd: ymd, skipIfAlreadyRan: true });
}

/**
 * After employee group-end: rebalance same KL calendar day as jobs (if today in KL and pref on).
 */
function maybeRunProgressRebalanceAfterGroupEnd(operatorId, jobIds) {
  const oid = String(operatorId || '').trim();
  const ids = [...new Set((jobIds || []).map((x) => String(x).trim()).filter(Boolean))];
  if (!oid || ids.length === 0) return;

  setImmediate(async () => {
    try {
      const settings = await getOperatorAiSettingsForApi(oid);
      if (!settings.schedulePrefs.aiScheduleRebalanceOnTaskComplete) return;
      const creds = await clnInt.getDecryptedAiApiKeyForOperator(oid);
      if (!creds?.apiKey) return;

      const placeholders = ids.map(() => '?').join(',');
      const [rows] = await pool.query(
        `SELECT DISTINCT ${SQL_WORKING_DAY_KL_YMD} AS d
         FROM cln_schedule s
         INNER JOIN cln_property p ON p.id = s.property_id
         WHERE p.operator_id = ? AND s.id IN (${placeholders})`,
        [oid, ...ids]
      );
      const days = [...new Set((rows || []).map((r) => String(r.d || '').slice(0, 10)).filter(Boolean))];
      if (days.length !== 1) return;
      const wd = days[0];
      if (wd !== kualaLumpurTodayYmd()) return;

      await runScheduleAiRebalance({
        operatorId: oid,
        workingDay: wd,
        apply: true,
        force: false,
        rebalanceContext: 'post_completion',
      });
    } catch (e) {
      console.warn('[cln-operator-ai] rebalance after group-end:', e?.message || e);
    }
  });
}

/**
 * Fire-and-forget after POST schedule-jobs when prefs.aiScheduleOnJobCreate and job date is today (KL).
 */
function maybeRunIncrementalAfterJobCreate(operatorId, dateYmd, newJobId) {
  const oid = String(operatorId || '').trim();
  const jid = String(newJobId || '').trim();
  const day = String(dateYmd || '').slice(0, 10);
  if (!oid || !jid || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return;

  setImmediate(async () => {
    try {
      const settings = await getOperatorAiSettingsForApi(oid);
      if (!settings.schedulePrefs.aiScheduleOnJobCreate) return;
      const creds = await clnInt.getDecryptedAiApiKeyForOperator(oid);
      if (!creds?.apiKey) return;
      if (day !== kualaLumpurTodayYmd()) return;
      await runScheduleAiSuggestIncremental({
        operatorId: oid,
        workingDay: day,
        newJobIds: [jid],
        apply: true,
      });
    } catch (e) {
      console.warn('[cln-operator-ai] incremental after job create:', e?.message || e);
    }
  });
}

async function runRebalanceAllOperatorsWithWatch({ workingDay } = {}) {
  const day = workingDay || kualaLumpurTodayYmd();
  const gate = await getScheduleAiPlatformGate();
  if (!gate.ok) {
    return { workingDay: day, results: [], skipped: true, reason: gate.code };
  }
  const [opRows] = await pool.query(
    `SELECT DISTINCT operator_id FROM cln_operator_integration
     WHERE \`key\` = 'aiAgent' AND enabled = 1`
  );
  const now = Date.now();
  const results = [];
  for (const r of opRows || []) {
    const oid = String(r.operator_id || '').trim();
    if (!oid) continue;
    try {
      const settings = await getOperatorAiSettingsForApi(oid);
      if (!settings.schedulePrefs.aiScheduleProgressWatchEnabled) {
        results.push({ operatorId: oid, skipped: true, reason: 'WATCH_DISABLED' });
        continue;
      }
      const intervalMs =
        Math.max(5, Number(settings.schedulePrefs.aiScheduleRebalanceIntervalMinutes || 30)) * 60 * 1000;
      const last = lastRebalanceAtByOperator.get(oid) || 0;
      if (now - last < intervalMs) {
        results.push({ operatorId: oid, skipped: true, reason: 'INTERVAL' });
        continue;
      }
      const creds = await clnInt.getDecryptedAiApiKeyForOperator(oid);
      if (!creds?.apiKey) {
        results.push({ operatorId: oid, skipped: true, reason: 'NO_KEY' });
        continue;
      }
      const out = await runScheduleAiRebalance({
        operatorId: oid,
        workingDay: day,
        apply: true,
        rebalanceContext: 'progress_watch',
      });
      lastRebalanceAtByOperator.set(oid, Date.now());
      results.push({ operatorId: oid, ...out });
    } catch (e) {
      results.push({ operatorId: oid, ok: false, error: e?.message || String(e) });
    }
  }
  return { workingDay: day, results };
}

/**
 * Cron: all operators with AI key + cron enabled in prefs.
 */
/**
 * Ops backfill: all operators, single calendar day (does not update last_schedule_ai_cron_day).
 */
async function runDailyScheduleAiAllOperators({ workingDay } = {}) {
  const day =
    workingDay ||
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());

  const gate = await getScheduleAiPlatformGate();
  if (!gate.ok) {
    return { workingDay: day, results: [], skipped: true, reason: gate.code };
  }

  const [opRows] = await pool.query(
    `SELECT DISTINCT operator_id FROM cln_operator_integration
     WHERE \`key\` = 'aiAgent' AND enabled = 1`
  );
  const results = [];
  for (const r of opRows || []) {
    const oid = String(r.operator_id || '').trim();
    if (!oid) continue;
    try {
      const settings = await getOperatorAiSettingsForApi(oid);
      if (!settings.schedulePrefs.aiScheduleCronEnabled) {
        results.push({ operatorId: oid, skipped: true, reason: 'CRON_DISABLED' });
        continue;
      }
      const creds = await clnInt.getDecryptedAiApiKeyForOperator(oid);
      if (!creds?.apiKey) {
        results.push({ operatorId: oid, skipped: true, reason: 'NO_KEY' });
        continue;
      }
      const out = await runScheduleAiSuggest({ operatorId: oid, workingDay: day, apply: true });
      results.push({ operatorId: oid, ...out });
    } catch (e) {
      results.push({ operatorId: oid, ok: false, error: e?.message || String(e) });
    }
  }
  return { workingDay: day, results };
}

module.exports = {
  getOperatorAiSettingsForApi,
  saveOperatorAiSettingsFromApi,
  appendChatMessage,
  listChatMessages,
  stripJarvisChineseConsentTokens,
  shortenVerboseEnglishConsentFooter,
  runOperatorAiChat,
  runScheduleAiSuggest,
  runScheduleAiSuggestIncremental,
  runScheduleAiRebalance,
  maybeRunIncrementalAfterJobCreate,
  maybeRunProgressRebalanceAfterGroupEnd,
  runDailyScheduleAiAllOperators,
  runMidnightScheduleAiBatch,
  runMidnightScheduleAiTick,
  runRebalanceAllOperatorsWithWatch,
  loadScheduleContextForAi,
  databaseHasColumn,
};
