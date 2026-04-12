/**
 * Cleanlemons operator AI schedule: cln_operator_ai, chat, LLM calls, suggest/apply.
 */

const axios = require('axios');
const crypto = require('crypto');
const pool = require('../../config/db');
const clnInt = require('./cleanlemon-integration.service');
const cleanlemonSvc = require('./cleanlemon.service');

function uuid() {
  return crypto.randomUUID();
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
  const x = String(raw || '')
    .toLowerCase()
    .replace(/\s+/g, '-');
  if (x.includes('complete')) return 'completed';
  if (x === 'done') return 'completed';
  if (x.includes('progress')) return 'in-progress';
  if (x.includes('cancel')) return 'cancelled';
  if (x.includes('checkout') || x === 'pending-checkout') return 'pending-checkout';
  if (x.includes('customer') && x.includes('missing')) return 'pending-checkout';
  return 'ready-to-clean';
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
  return rowToApiShape(row);
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

async function appendChatMessage(operatorId, role, content) {
  const oid = String(operatorId || '').trim();
  if (!oid) throw new Error('MISSING_OPERATOR_ID');
  const r = String(role || '').toLowerCase();
  if (!['user', 'assistant', 'system'].includes(r)) throw new Error('INVALID_ROLE');
  const text = String(content || '').slice(0, 32000);
  if (!text) throw new Error('EMPTY_CONTENT');
  await pool.query(
    'INSERT INTO cln_operator_ai_chat_message (id, operator_id, role, content, created_at) VALUES (?, ?, ?, ?, NOW(3))',
    [uuid(), oid, r, text]
  );
}

async function listChatMessages(operatorId, limit = 40) {
  const oid = String(operatorId || '').trim();
  if (!oid) return [];
  const lim = Math.min(Math.max(Number(limit) || 40, 1), 100);
  const [rows] = await pool.query(
    `SELECT id, role, content, created_at AS createdAt
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

function extractJsonObject(text) {
  const s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1].trim() : s;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('LLM_JSON_PARSE');
  return JSON.parse(raw.slice(start, end + 1));
}

/**
 * Operator chat (settings assistant) — stores messages; optional merge of extracted constraints.
 */
async function runOperatorAiChat({ operatorId, userMessage, mergeExtractedConstraints = false }) {
  const oid = String(operatorId || '').trim();
  if (!oid) throw new Error('MISSING_OPERATOR_ID');
  const creds = await clnInt.getDecryptedAiApiKeyForOperator(oid);
  if (!creds?.apiKey) throw new Error('AI_NOT_CONFIGURED');

  await appendChatMessage(oid, 'user', userMessage);

  const settings = await getOperatorAiSettingsForApi(oid);
  const history = await listChatMessages(oid, 16);
  const histLines = history
    .filter((h) => h.role !== 'system')
    .map((h) => `${h.role}: ${h.content}`)
    .join('\n');

  const system = `You are a scheduling assistant for a cleaning company operator. Be concise.
Saved schedule preferences (JSON): ${JSON.stringify(settings.schedulePrefs)}
Pinned constraints: ${JSON.stringify(settings.pinnedConstraints)}
Operator extra notes: ${settings.promptExtra || '(none)'}
If merge mode is on, end your reply with a line exactly: EXTRACT_JSON:{"pinnedConstraints":[...]} where the array lists new property_only_teams rules from the user message (propertyId + teamIds UUIDs). Use empty array if none.`;

  const user = `Recent conversation:\n${histLines || '(start)'}\n\nReply to the operator's latest message helpfully.`;

  const reply = await invokeOperatorLlm({
    provider: creds.provider,
    apiKey: creds.apiKey,
    system: mergeExtractedConstraints ? `${system}\nMERGE_MODE: on` : system,
    user,
  });

  let extraPinned = [];
  if (mergeExtractedConstraints) {
    const idx = reply.lastIndexOf('EXTRACT_JSON:');
    if (idx !== -1) {
      const jsonPart = reply.slice(idx + 'EXTRACT_JSON:'.length).trim();
      try {
        const parsed = JSON.parse(jsonPart);
        if (Array.isArray(parsed.pinnedConstraints)) extraPinned = parsed.pinnedConstraints;
      } catch (_) {
        /* ignore */
      }
    }
  }

  const cleanReply = reply.replace(/EXTRACT_JSON:\s*\{[\s\S]*\}\s*$/m, '').trim();
  await appendChatMessage(oid, 'assistant', cleanReply || reply);

  if (mergeExtractedConstraints && extraPinned.length) {
    const cur = settings.pinnedConstraints || [];
    await saveOperatorAiSettingsFromApi(oid, { pinnedConstraints: [...cur, ...extraPinned] });
  }

  return { reply: cleanReply || reply, pinnedMerged: mergeExtractedConstraints && extraPinned.length > 0 };
}

async function loadScheduleContextForAi(operatorId, workingDay) {
  const oid = String(operatorId || '').trim();
  const day = String(workingDay || '').slice(0, 10);
  if (!oid || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('INVALID_PARAMS');

  const hasLock = await databaseHasColumn('cln_schedule', 'ai_assignment_locked');
  const lockSel = hasLock ? 's.ai_assignment_locked AS aiLocked,' : '0 AS aiLocked,';

  const [rows] = await pool.query(
    `SELECT s.id, s.property_id AS propertyId, s.team AS teamName, ${lockSel}
            DATE_FORMAT(s.working_day, '%Y-%m-%d') AS jobDate,
            s.status AS rawStatus, s.cleaning_type AS cleaningType,
            TIME_FORMAT(s.start_time, '%H:%i') AS staffStartTime,
            TIME_FORMAT(s.end_time, '%H:%i') AS staffEndTime
     FROM cln_schedule s
     INNER JOIN cln_property p ON p.id = s.property_id
     WHERE p.operator_id = ? AND DATE(s.working_day) = ?
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

function jobEligibleForAiAssign(j) {
  if (j.aiLocked) return false;
  if (isTerminalScheduleRaw(j.status)) return false;
  const t = (j.teamName || '').trim();
  return !t;
}

function validateTeamId(teamId, teams) {
  return teams.some((t) => t.id === teamId);
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
    teamId: j.teamName ? nameToId.get(String(j.teamName)) || null : null,
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
 * Full-day suggest: assigns teamId (UUID) to jobs with empty team; respects pinned constraints when possible.
 */
async function runScheduleAiSuggest({ operatorId, workingDay, apply = false }) {
  const oid = String(operatorId || '').trim();
  const creds = await clnInt.getDecryptedAiApiKeyForOperator(oid);
  if (!creds?.apiKey) throw new Error('AI_NOT_CONFIGURED');

  const settings = await getOperatorAiSettingsForApi(oid);
  const prefs = settings.schedulePrefs;
  if (!prefs.aiScheduleCronEnabled && apply) {
    /* allow manual/internal call with apply even if cron disabled — caller decides */
  }

  const ctx = await loadScheduleContextForAi(oid, workingDay);
  const eligible = ctx.jobs.filter(jobEligibleForAiAssign);
  if (!eligible.length) {
    return { ok: true, assignments: [], applied: 0, message: 'NO_ELIGIBLE_JOBS' };
  }

  const areaBlock = buildAreaTeamAllocationNarrative(settings, ctx, eligible);
  const timingBlock = buildTimingAndStatusRulesNarrative(prefs);

  const system = `You assign cleaning jobs to teams. Output ONLY valid JSON, no markdown.
Schema: { "assignments": [ { "jobId": "uuid", "teamId": "uuid", "reason": "short" } ] }
Rules:
- Every eligible jobId must appear exactly once.
- teamId MUST be one of the provided team ids (UUID).
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
  )}`;

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
    throw new Error(`LLM_JSON_PARSE: ${e.message}`);
  }
  const list = Array.isArray(parsed.assignments) ? parsed.assignments : [];
  const eligibleIds = new Set(eligible.map((j) => j.id));
  const propertyByJob = new Map(eligible.map((j) => [j.id, j.propertyId]));

  const valid = [];
  const rejected = [];
  for (const a of list) {
    const jobId = String(a.jobId || '').trim();
    const teamId = String(a.teamId || '').trim();
    if (!eligibleIds.has(jobId)) {
      rejected.push({ jobId, reason: 'NOT_ELIGIBLE' });
      continue;
    }
    if (!validateTeamId(teamId, ctx.teams)) {
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
    assignments: valid,
    rejected,
    applied,
    rawModel: process.env.CLEANLEMON_AI_DEBUG === '1' ? raw : undefined,
  };
}

/**
 * Incremental: assign teams only for given job ids (empty team, not locked). Existing rows are context only.
 */
async function runScheduleAiSuggestIncremental({ operatorId, workingDay, newJobIds, apply = false }) {
  const oid = String(operatorId || '').trim();
  const wantIds = new Set((newJobIds || []).map((x) => String(x || '').trim()).filter(Boolean));
  if (!oid || !wantIds.size) throw new Error('INVALID_PARAMS');

  const creds = await clnInt.getDecryptedAiApiKeyForOperator(oid);
  if (!creds?.apiKey) throw new Error('AI_NOT_CONFIGURED');

  const settings = await getOperatorAiSettingsForApi(oid);
  const ctx = await loadScheduleContextForAi(oid, workingDay);
  const eligible = ctx.jobs.filter((j) => wantIds.has(j.id) && jobEligibleForAiAssign(j));
  if (!eligible.length) {
    return { ok: true, mode: 'incremental', assignments: [], applied: 0, message: 'NO_ELIGIBLE_NEW_JOBS' };
  }

  const frozen = ctx.jobs
    .filter((j) => !wantIds.has(j.id) && (j.teamName || j.aiLocked))
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
  const system = `You assign cleaning jobs to teams. Output ONLY valid JSON, no markdown.
Schema: { "assignments": [ { "jobId": "uuid", "teamId": "uuid", "reason": "short" } ] }
This is INCREMENTAL: assign ONLY the jobs listed under "newJobs". Do NOT include other jobIds.
- Every new jobId must appear exactly once.
- teamId MUST be one of the provided team ids (UUID).
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
  )}`;

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
    throw new Error(`LLM_JSON_PARSE: ${e.message}`);
  }
  const list = Array.isArray(parsed.assignments) ? parsed.assignments : [];
  const eligibleIds = new Set(eligible.map((j) => j.id));
  const propertyByJob = new Map(eligible.map((j) => [j.id, j.propertyId]));

  const valid = [];
  const rejected = [];
  for (const a of list) {
    const jobId = String(a.jobId || '').trim();
    const teamId = String(a.teamId || '').trim();
    if (!eligibleIds.has(jobId)) {
      rejected.push({ jobId, reason: 'NOT_ELIGIBLE' });
      continue;
    }
    if (!validateTeamId(teamId, ctx.teams)) {
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
 * Rebalance: may reassign ready-to-clean jobs that have a team, not AI-locked, not terminal.
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
  const enriched = enrichJobsWithTeamIds(ctx.jobs, ctx.teams);

  const rebalEligible = enriched.filter(
    (j) =>
      !j.aiLocked &&
      !isTerminalScheduleRaw(j.status) &&
      isReadyToCleanRaw(j.status) &&
      j.teamId
  );

  if (!rebalEligible.length) {
    return { ok: true, mode: 'rebalance', reassignments: [], applied: 0, message: 'NO_REBALANCE_TARGETS' };
  }

  const loadByTeam = {};
  for (const j of enriched) {
    if (!j.teamId || j.aiLocked || isTerminalScheduleRaw(j.status)) continue;
    loadByTeam[j.teamId] = (loadByTeam[j.teamId] || 0) + 1;
  }

  const inProgress = enriched
    .filter((j) => String(j.status || '').toLowerCase().includes('progress') && !isTerminalScheduleRaw(j.status))
    .map((j) => ({ jobId: j.id, propertyId: j.propertyId, teamId: j.teamId, status: j.status }));

  const postCompletionHint =
    rebalanceContext === 'post_completion'
      ? `Context: staff just completed one or more jobs on this working day. If some teams are clearly slower or overloaded compared to others, move ready-to-clean jobs (not locked) from busier/slower teams to teams with spare capacity. Prefer minimal changes.`
      : '';

  const timingBlock = buildTimingAndStatusRulesNarrative(prefs);
  const system = `You rebalance team assignments for one working day. Output ONLY valid JSON, no markdown.
Schema: { "reassignments": [ { "jobId": "uuid", "toTeamId": "uuid", "reason": "short" } ] }
Rules:
- Only include jobIds from the "rebalancable" list (ready-to-clean, already have a team, not locked).
- toTeamId MUST be one of the team ids (UUID).
- Prefer moving jobs from overloaded teams to underloaded teams; use region groups and pinned constraints.
- If in-progress jobs suggest a team is delayed, you may move some ready-to-clean jobs OFF that team to others.
- Do not reassign the same job to its current team (must change team when included).
- It is valid to return an empty reassignments array if no change is needed.
${postCompletionHint}
${timingBlock}

Teams: ${JSON.stringify(ctx.teams)}
Pinned constraints: ${JSON.stringify(settings.pinnedConstraints)}
Region groups: ${JSON.stringify(normalizeRegionGroups(settings.regionGroups))}
Active job counts by teamId (non-terminal, non-locked): ${JSON.stringify(loadByTeam)}
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
  )}`;

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
    throw new Error(`LLM_JSON_PARSE: ${e.message}`);
  }

  const list = Array.isArray(parsed.reassignments) ? parsed.reassignments : [];
  const eligibleIds = new Set(rebalEligible.map((j) => j.id));
  const currentTeamByJob = new Map(rebalEligible.map((j) => [j.id, j.teamId]));
  const propertyByJob = new Map(rebalEligible.map((j) => [j.id, j.propertyId]));

  const valid = [];
  const rejected = [];
  for (const a of list) {
    const jobId = String(a.jobId || '').trim();
    const toTeamId = String(a.toTeamId || '').trim();
    if (!eligibleIds.has(jobId)) {
      rejected.push({ jobId, reason: 'NOT_ELIGIBLE' });
      continue;
    }
    if (!validateTeamId(toTeamId, ctx.teams)) {
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
        `SELECT DISTINCT DATE_FORMAT(s.working_day, '%Y-%m-%d') AS d
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
