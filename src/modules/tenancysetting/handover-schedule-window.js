/**
 * Company admin.handoverWorkingHour only (not admin.workingHour) — tenant handover schedule (operator bypass).
 */

function parseAdmin(adminJson) {
  if (adminJson == null) return {};
  if (typeof adminJson === 'string') {
    try {
      return JSON.parse(adminJson || '{}');
    } catch {
      return {};
    }
  }
  return adminJson && typeof adminJson === 'object' ? adminJson : {};
}

const DEFAULT_HANDOVER_START = '10:00';
const DEFAULT_HANDOVER_END = '19:00';

/**
 * Only admin.handoverWorkingHour. If both start/end missing, use defaults (same as company settings UI).
 * @returns {{ start: string, end: string, source: 'handoverWorkingHour' }}
 */
function getHandoverScheduleWindowFromAdmin(adminJson) {
  const a = parseAdmin(adminJson);
  const hw = a.handoverWorkingHour || {};
  const rawS = hw.start != null && String(hw.start).trim() !== '' ? String(hw.start).slice(0, 5) : null;
  const rawE = hw.end != null && String(hw.end).trim() !== '' ? String(hw.end).slice(0, 5) : null;
  if (rawS == null && rawE == null) {
    return {
      start: DEFAULT_HANDOVER_START,
      end: DEFAULT_HANDOVER_END,
      source: 'handoverWorkingHour'
    };
  }
  return {
    start: rawS ?? DEFAULT_HANDOVER_START,
    end: rawE ?? DEFAULT_HANDOVER_END,
    source: 'handoverWorkingHour'
  };
}

function timeStrToMinutes(s) {
  const m = String(s || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  return h * 60 + min;
}

function datetimeLocalToMinutesOfDay(dtStr) {
  const m = String(dtStr).match(/T(\d{2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function isMinutesInInclusiveWindow(dayMinutes, startM, endM) {
  if (dayMinutes == null || startM == null || endM == null) return true;
  if (startM <= endM) return dayMinutes >= startM && dayMinutes <= endM;
  return dayMinutes >= startM || dayMinutes <= endM;
}

/**
 * Tenant-only validation. Operator updates skip this.
 * @param {{ handoverCheckinAt?: string|null, handoverCheckoutAt?: string|null, adminJson: string|object|null }}
 * @returns {{ ok: true } | { ok: false, reason: string, message: string, window?: object }}
 */
function validateTenantHandoverScheduleAgainstCompanyWindow({ handoverCheckinAt, handoverCheckoutAt, adminJson }) {
  const win = getHandoverScheduleWindowFromAdmin(adminJson);
  const startM = timeStrToMinutes(win.start);
  const endM = timeStrToMinutes(win.end);
  if (startM == null || endM == null) return { ok: true };

  const checkOne = (val, label) => {
    if (val === undefined) return { ok: true };
    const s = val == null ? '' : String(val).trim();
    if (s === '') return { ok: true };
    const mod = datetimeLocalToMinutesOfDay(s);
    if (mod == null) {
      return { ok: false, reason: 'INVALID_DATETIME', message: `Invalid ${label} time.` };
    }
    if (!isMinutesInInclusiveWindow(mod, startM, endM)) {
      return {
        ok: false,
        reason: 'HANDOVER_OUTSIDE_WORKING_HOURS',
        message: `${label} appointment must be between ${win.start} and ${win.end} (Handover working hours in company settings).`,
        window: win
      };
    }
    return { ok: true };
  };

  let r = checkOne(handoverCheckinAt, 'Check-in');
  if (!r.ok) return r;
  r = checkOne(handoverCheckoutAt, 'Check-out');
  return r;
}

module.exports = {
  getHandoverScheduleWindowFromAdmin,
  validateTenantHandoverScheduleAgainstCompanyWindow
};
