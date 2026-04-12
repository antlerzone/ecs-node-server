/**
 * Cleanlemons client booking: lead-time rules in Malaysia (Asia/Kuala_Lumpur).
 * Shared by Node (`cleanlemon.service.js`) and Next (`cleanlemon-booking-eligibility.ts`).
 */

const MY_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * @param {string} ymd
 * @param {number} hh
 * @param {number} mm
 * @returns {number}
 */
function malaysiaWallClockToUtcMillis(ymd, hh, mm) {
  const parts = String(ymd || '')
    .trim()
    .slice(0, 10)
    .split('-')
    .map((x) => parseInt(x, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return NaN;
  const [y, m, d] = parts;
  const h = Math.min(23, Math.max(0, Number(hh) || 0));
  const mi = Math.min(59, Math.max(0, Number(mm) || 0));
  return Date.UTC(y, m - 1, d, h, mi, 0, 0) - MY_OFFSET_MS;
}

/**
 * @param {number} [nowMs]
 * @returns {string} YYYY-MM-DD
 */
function getMalaysiaCalendarYmd(nowMs = Date.now()) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kuala_Lumpur',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(nowMs));
  } catch (_) {
    const myMs = nowMs + MY_OFFSET_MS;
    return new Date(myMs).toISOString().substring(0, 10);
  }
}

/**
 * @param {string} ymd
 * @param {number} days
 * @returns {string}
 */
function addDaysToMalaysiaYmd(ymd, days) {
  const d = new Date(`${String(ymd).slice(0, 10)}T12:00:00+08:00`);
  if (Number.isNaN(d.getTime())) return String(ymd).slice(0, 10);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * @param {string} leadTime
 * @returns {number}
 */
function leadTimeToMinCalendarDayOffset(leadTime) {
  const k = String(leadTime || 'same_day')
    .trim()
    .toLowerCase();
  const map = {
    same_day: 0,
    one_day: 1,
    two_day: 2,
    three_day: 3,
    four_day: 4,
    five_day: 5,
    six_day: 6,
    one_week: 7,
    two_week: 14,
    three_week: 21,
    four_week: 28,
    one_month: 30,
  };
  if (Object.prototype.hasOwnProperty.call(map, k)) return map[k];
  return 0;
}

/**
 * Earliest bookable calendar day (YYYY-MM-DD, Malaysia) for a day-based lead time.
 * @param {string} leadTimeRaw
 * @param {number} [nowMs]
 * @returns {string}
 */
function getEarliestBookableMalaysiaYmd(leadTimeRaw, nowMs = Date.now()) {
  const lt = String(leadTimeRaw || 'same_day')
    .trim()
    .toLowerCase();
  if (lt === 'twelve_hour') {
    const today = getMalaysiaCalendarYmd(nowMs);
    return addDaysToMalaysiaYmd(today, 0);
  }
  const minDays = leadTimeToMinCalendarDayOffset(lt);
  const today = getMalaysiaCalendarYmd(nowMs);
  return addDaysToMalaysiaYmd(today, minDays);
}

/**
 * @param {string} hm "HH:mm"
 * @returns {{ hh: number, mm: number } | null}
 */
function parseHm(hm) {
  const m = String(hm || '')
    .trim()
    .match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return { hh, mm };
}

/**
 * @param {{
 *   leadTimeRaw: string,
 *   dateYmd: string,
 *   timeHm?: string | null,
 *   isHomestay?: boolean,
 *   nowMs?: number
 * }} p
 * @returns {{ ok: boolean, code?: string, message?: string, earliestYmd?: string }}
 */
function validateBookingLeadTimeForConfig(p) {
  const leadTime = String(p.leadTimeRaw || 'same_day')
    .trim()
    .toLowerCase();
  const dateYmd = String(p.dateYmd || '')
    .trim()
    .slice(0, 10);
  const nowMs = p.nowMs != null ? Number(p.nowMs) : Date.now();
  const isHomestay = Boolean(p.isHomestay);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) {
    return { ok: false, code: 'BOOKING_LEAD_TIME_NOT_MET', message: 'Invalid date.' };
  }

  if (leadTime === 'twelve_hour') {
    const hmStr = (p.timeHm && String(p.timeHm).trim()) || (isHomestay ? '09:00' : '');
    const hm = parseHm(hmStr);
    if (!hm) {
      return {
        ok: false,
        code: 'BOOKING_LEAD_TIME_NOT_MET',
        message: isHomestay
          ? 'Twelve-hour lead time could not be validated.'
          : 'Please select a start time — twelve-hour lead time requires date and time.',
      };
    }
    const utcMs = malaysiaWallClockToUtcMillis(dateYmd, hm.hh, hm.mm);
    if (!Number.isFinite(utcMs)) {
      return { ok: false, code: 'BOOKING_LEAD_TIME_NOT_MET', message: 'Invalid date or time.' };
    }
    if (utcMs < nowMs + 12 * 3600000) {
      return {
        ok: false,
        code: 'BOOKING_LEAD_TIME_NOT_MET',
        message: 'Booking must be at least 12 hours from now (Malaysia time).',
      };
    }
    return { ok: true };
  }

  const minDays = leadTimeToMinCalendarDayOffset(leadTime);
  const today = getMalaysiaCalendarYmd(nowMs);
  const earliest = addDaysToMalaysiaYmd(today, minDays);
  if (dateYmd < earliest) {
    return {
      ok: false,
      code: 'BOOKING_LEAD_TIME_NOT_MET',
      message: `Earliest bookable date is ${earliest} (lead time requires ${minDays} calendar day(s) notice).`,
      earliestYmd: earliest,
    };
  }
  return { ok: true };
}

/**
 * @param {string[]|unknown} selectedServices
 * @param {string|null|undefined} pricingKey — e.g. "general", "homestay"
 * @returns {{ ok: boolean, code?: string, message?: string }}
 */
function validateServiceInSelectedServices(selectedServices, pricingKey) {
  const pk = String(pricingKey || '')
    .trim()
    .toLowerCase();
  if (!pk) return { ok: true };
  const sel = Array.isArray(selectedServices) ? selectedServices : [];
  if (sel.length === 0) return { ok: true };
  const norm = (s) =>
    String(s || '')
      .trim()
      .toLowerCase()
      .replace(/_/g, '-');
  const want = norm(pk);
  if (sel.some((s) => norm(s) === want)) return { ok: true };
  return {
    ok: false,
    code: 'BOOKING_SERVICE_NOT_ALLOWED',
    message: 'This service is not enabled in the operator pricing.',
  };
}

module.exports = {
  malaysiaWallClockToUtcMillis,
  getMalaysiaCalendarYmd,
  addDaysToMalaysiaYmd,
  leadTimeToMinCalendarDayOffset,
  getEarliestBookableMalaysiaYmd,
  validateBookingLeadTimeForConfig,
  validateServiceInSelectedServices,
};
