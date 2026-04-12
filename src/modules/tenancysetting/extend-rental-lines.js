/**
 * Extend tenancy — rental income lines aligned with Company Settings → admin.rental
 * (first / last / specific / movein), matching operator booking semantics.
 * Rent invoice date = billing anchor due day (first line of extend uses that anchor);
 * tail segments inside the same cycle use the first overlapping day as invoice date.
 * Calendar boundaries use Asia/Singapore (toSingaporeCalendarYmd) for +08 consistency.
 */

'use strict';

const { toSingaporeCalendarYmd } = require('../../utils/dateMalaysia');

const pad = (n) => String(n).padStart(2, '0');

function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  return { y: +m[1], mo: +m[2], d: +m[3] };
}

function compareYmd(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function maxYmd(x, y) {
  return compareYmd(x, y) >= 0 ? x : y;
}

function minYmd(x, y) {
  return compareYmd(x, y) <= 0 ? x : y;
}

function daysInMonth(y, mo) {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

function lastDayOfMonthYmd(y, mo) {
  const ld = daysInMonth(y, mo);
  return `${y}-${pad(mo)}-${pad(ld)}`;
}

function addDaysYmd(ymd, n) {
  const ms = new Date(`${ymd}T12:00:00+08:00`).getTime() + Number(n) * 86400000;
  return toSingaporeCalendarYmd(new Date(ms));
}

function daysInclusive(a, b) {
  if (compareYmd(a, b) > 0) return 0;
  const ta = new Date(`${a}T12:00:00+08:00`).getTime();
  const tb = new Date(`${b}T12:00:00+08:00`).getTime();
  return Math.floor((tb - ta) / 86400000) + 1;
}

function round2(n) {
  return Number(Number(n).toFixed(2));
}

function clampBillingDay(D) {
  const d = Number(D);
  if (!Number.isFinite(d)) return 1;
  return Math.min(31, Math.max(1, Math.floor(d)));
}

function addMonthSameDay(y, mo, D) {
  let nm = mo + 1;
  let ny = y;
  if (nm > 12) {
    nm = 1;
    ny += 1;
  }
  const dim = daysInMonth(ny, nm);
  const dd = Math.min(D, dim);
  return `${ny}-${pad(nm)}-${pad(dd)}`;
}

function nextDueSameMonthDay(dueYmd, D) {
  const p = parseYmd(dueYmd);
  if (!p) return dueYmd;
  return addMonthSameDay(p.y, p.mo, D);
}

/** Latest day-D in the same month as cursor that is <= cursor (for specific/movein anchors). */
function anchorDueOnOrBefore(cursorYmd, D) {
  const p = parseYmd(cursorYmd);
  if (!p) return cursorYmd;
  let y = p.y;
  let mo = p.mo;
  let dd = Math.min(D, daysInMonth(y, mo));
  let due = `${y}-${pad(mo)}-${pad(dd)}`;
  if (compareYmd(due, cursorYmd) > 0) {
    if (mo === 1) {
      mo = 12;
      y -= 1;
    } else {
      mo -= 1;
    }
    dd = Math.min(D, daysInMonth(y, mo));
    due = `${y}-${pad(mo)}-${pad(dd)}`;
  }
  return due;
}

function extLinesCalendarMonth(oldEndYmd, newEndYmd, newRental, invoiceOnFirstDay, titleFull, titleProrate) {
  const tf = titleFull || 'Rental Income';
  const tp = titleProrate || 'Prorated Rental Income';
  const extStart = addDaysYmd(oldEndYmd, 1);
  if (compareYmd(extStart, newEndYmd) > 0) return [];
  const lines = [];
  let cur = extStart;
  while (compareYmd(cur, newEndYmd) <= 0) {
    const p = parseYmd(cur);
    if (!p) break;
    const { y, mo } = p;
    const monthStart = `${y}-${pad(mo)}-01`;
    const monthEnd = lastDayOfMonthYmd(y, mo);
    const segStart = maxYmd(cur, monthStart);
    const segEnd = minYmd(newEndYmd, monthEnd);
    const dim = daysInMonth(y, mo);
    const dc = daysInclusive(segStart, segEnd);
    const full = segStart === monthStart && segEnd === monthEnd;
    const amt = full ? newRental : (newRental / dim) * dc;
    let invoiceYmd = invoiceOnFirstDay ? monthStart : monthEnd;
    /* Partial month that starts after the 1st (e.g. room change on 8th): bill date = first occupied day, not monthStart. */
    if (!full && invoiceOnFirstDay && compareYmd(segStart, monthStart) > 0) {
      invoiceYmd = segStart;
    }
    const row = {
      invoiceYmd,
      amount: round2(amt),
      prorate: !full,
      titleSuffix: full ? tf : tp
    };
    if (!full) {
      row.prorateCalc = {
        kind: 'calendar',
        monthlyRent: newRental,
        daysInMonth: dim,
        billedDays: dc,
        periodFrom: segStart,
        periodTo: segEnd
      };
    }
    lines.push(row);
    cur = addDaysYmd(segEnd, 1);
  }
  return lines;
}

/**
 * specific / movein: billing every month on day D. One cycle = [due, nextDue] inclusive calendar days.
 * Payment / invoice anchor = due; tail in same cycle uses first overlapping day as invoice date.
 */
function extLinesSpecificOrMovein(oldEndYmd, newEndYmd, newRental, D, titleFull, titleProrate) {
  const tf = titleFull || 'Rental Income';
  const tp = titleProrate || 'Prorated Rental Income';
  const extStart = addDaysYmd(oldEndYmd, 1);
  if (compareYmd(extStart, newEndYmd) > 0) return [];
  const lines = [];
  let cursor = extStart;
  let isFirstLine = true;
  let guard = 0;
  while (compareYmd(cursor, newEndYmd) <= 0 && guard++ < 72) {
    const due = anchorDueOnOrBefore(cursor, D);
    const nextDue = nextDueSameMonthDay(due, D);
    const segStart = maxYmd(cursor, due);
    const segEnd = minYmd(newEndYmd, nextDue);
    if (compareYmd(segStart, segEnd) > 0) {
      const n = addDaysYmd(due, 1);
      if (compareYmd(n, cursor) <= 0) break;
      cursor = n;
      continue;
    }
    const fullDays = Math.max(1, daysInclusive(due, nextDue));
    const overlap = daysInclusive(segStart, segEnd);
    /** First extend line: full monthly rent for the first billing cycle in the extension (matches booking / operator expectation). */
    let amt = (newRental / fullDays) * overlap;
    let prorate = overlap < fullDays;
    let titleSuffix = prorate ? tp : tf;
    let invoiceYmd = due;
    if (isFirstLine) {
      amt = newRental;
      prorate = false;
      titleSuffix = tf;
      invoiceYmd = due;
    } else if (compareYmd(segStart, due) > 0) {
      invoiceYmd = segStart;
    }
    const row = {
      invoiceYmd,
      amount: round2(amt),
      prorate,
      titleSuffix
    };
    if (prorate && !isFirstLine) {
      row.prorateCalc = {
        kind: 'cycle',
        monthlyRent: newRental,
        cycleDays: fullDays,
        overlapDays: overlap,
        periodFrom: segStart,
        periodTo: segEnd
      };
    }
    lines.push(row);
    isFirstLine = false;
    const nextCursor = addDaysYmd(segEnd, 1);
    if (compareYmd(nextCursor, cursor) <= 0) break;
    cursor = nextCursor;
  }
  return lines;
}

/**
 * @param {object} p
 * @param {string} p.oldEndYmd
 * @param {string} p.newEndYmd
 * @param {number} p.newRental
 * @param {string} [p.rentalType] first | last | specific | movein
 * @param {number|string} [p.rentalValue] day 1–31 for specific
 * @param {string|null} [p.beginYmd] tenancy.begin for movein
 * @param {string} [p.titleFull] invoice title suffix for full-cycle lines (default Rental Income)
 * @param {string} [p.titleProrate] invoice title suffix for prorated lines (default Prorated Rental Income)
 */
/**
 * Old-room rate from tenancy.begin through last night before first day at new rate (inclusive).
 * Used when change room mid-cycle: e.g. first new-rate day 13 May → old rate 1–12 May, new rate from 13 May.
 * Calendar billing first | last only (specific/movein unchanged — no extra prior lines).
 */
function buildChangeRoomPriorOldRentLines(p) {
  const firstDayNewRentYmd = String(p.firstDayNewRentYmd || '').trim().slice(0, 10);
  const newEndYmd = String(p.newEndYmd || '').trim().slice(0, 10);
  const oldRental = Number(p.oldRental || 0);
  const beginRaw = p.beginYmd ? String(p.beginYmd).trim().slice(0, 10) : '';
  const beginYmd = /^\d{4}-\d{2}-\d{2}$/.test(beginRaw) ? beginRaw : null;
  const t = String(p.rentalType || 'first').toLowerCase();
  const titleFull = p.titleFull || 'Rental Income — prior room';
  const titleProrate = p.titleProrate || 'Prorated Rental Income — prior room';

  if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDayNewRentYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(newEndYmd) || oldRental <= 0) {
    return [];
  }
  if (t === 'specific' || t === 'movein') {
    return [];
  }

  const lastOldNightYmd = addDaysYmd(firstDayNewRentYmd, -1);
  if (compareYmd(lastOldNightYmd, newEndYmd) > 0) {
    return [];
  }

  const startBound = beginYmd ? maxYmd(beginYmd, '2000-01-01') : lastOldNightYmd;
  if (compareYmd(startBound, lastOldNightYmd) > 0) {
    return [];
  }

  const invoiceOnFirstDay = t !== 'last';
  const lines = [];
  const sb = parseYmd(startBound);
  if (!sb) return [];
  let curMonthStart = `${sb.y}-${pad(sb.mo)}-01`;
  const endP = parseYmd(lastOldNightYmd);
  if (!endP) return [];
  const endMonthStart = `${endP.y}-${pad(endP.mo)}-01`;

  let guard = 0;
  while (compareYmd(curMonthStart, endMonthStart) <= 0 && guard++ < 120) {
    const pm = parseYmd(curMonthStart);
    if (!pm) break;
    const { y, mo } = pm;
    const monthStart = `${y}-${pad(mo)}-01`;
    const monthEnd = lastDayOfMonthYmd(y, mo);
    const dim = daysInMonth(y, mo);
    const segStart = maxYmd(monthStart, beginYmd || monthStart);
    const segEnd = minYmd(monthEnd, lastOldNightYmd, newEndYmd);
    if (compareYmd(segStart, segEnd) <= 0) {
      const full = segStart === monthStart && segEnd === monthEnd;
      const dc = daysInclusive(segStart, segEnd);
      const amt = full ? oldRental : round2((oldRental / dim) * dc);
      let invoiceYmd = invoiceOnFirstDay ? monthStart : monthEnd;
      if (!full && invoiceOnFirstDay && compareYmd(segStart, monthStart) > 0) {
        invoiceYmd = segStart;
      }
      if (!full && !invoiceOnFirstDay && compareYmd(segEnd, monthEnd) < 0) {
        invoiceYmd = segEnd;
      }
      const row = {
        invoiceYmd,
        amount: amt,
        prorate: !full,
        titleSuffix: full ? titleFull : titleProrate
      };
      if (!full) {
        row.prorateCalc = {
          kind: 'calendar',
          monthlyRent: oldRental,
          daysInMonth: dim,
          billedDays: dc,
          periodFrom: segStart,
          periodTo: segEnd
        };
      }
      lines.push(row);
    }
    let nm = pm.mo + 1;
    let ny = pm.y;
    if (nm > 12) {
      nm = 1;
      ny += 1;
    }
    curMonthStart = `${ny}-${pad(nm)}-01`;
  }
  return lines;
}

function buildExtendRentalIncomeLines(p) {
  const oldEndYmd = String(p.oldEndYmd || '').trim().slice(0, 10);
  const newEndYmd = String(p.newEndYmd || '').trim().slice(0, 10);
  const newRental = Number(p.newRental || 0);
  const t = String(p.rentalType || 'first').toLowerCase();
  const titleFull = p.titleFull;
  const titleProrate = p.titleProrate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(oldEndYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(newEndYmd) || newRental <= 0) {
    return [];
  }

  if (t === 'specific') {
    const D = clampBillingDay(p.rentalValue);
    return extLinesSpecificOrMovein(oldEndYmd, newEndYmd, newRental, D, titleFull, titleProrate);
  }
  if (t === 'movein') {
    const b = p.beginYmd ? parseYmd(String(p.beginYmd).slice(0, 10)) : null;
    const D = b ? Math.min(b.d, daysInMonth(b.y, b.mo)) : 1;
    return extLinesSpecificOrMovein(oldEndYmd, newEndYmd, newRental, D, titleFull, titleProrate);
  }
  if (t === 'last') {
    return extLinesCalendarMonth(oldEndYmd, newEndYmd, newRental, false, titleFull, titleProrate);
  }
  return extLinesCalendarMonth(oldEndYmd, newEndYmd, newRental, true, titleFull, titleProrate);
}

function defaultFeeInvoiceYmd(p) {
  const oldEndYmd = String(p.oldEndYmd || '').trim().slice(0, 10);
  const newEndYmd = String(p.newEndYmd || '').trim().slice(0, 10);
  const t = String(p.rentalType || 'first').toLowerCase();
  const extStart = addDaysYmd(oldEndYmd, 1);
  if (compareYmd(extStart, newEndYmd) > 0) {
    return toSingaporeCalendarYmd(new Date());
  }
  if (t === 'specific') {
    const D = clampBillingDay(p.rentalValue);
    return anchorDueOnOrBefore(extStart, D);
  }
  if (t === 'movein') {
    const b = p.beginYmd ? parseYmd(String(p.beginYmd).slice(0, 10)) : null;
    const D = b ? Math.min(b.d, daysInMonth(b.y, b.mo)) : 1;
    return anchorDueOnOrBefore(extStart, D);
  }
  if (t === 'last') {
    const p0 = parseYmd(extStart);
    if (!p0) return extStart;
    return lastDayOfMonthYmd(p0.y, p0.mo);
  }
  const p0 = parseYmd(extStart);
  if (!p0) return extStart;
  return `${p0.y}-${pad(p0.mo)}-01`;
}

/**
 * Operator Summary line: show monthly rent ÷ calendar days × occupied days (or cycle-based proration).
 */
function formatProrateFormulaLine(line) {
  if (!line || !line.prorateCalc) return null;
  const c = line.prorateCalc;
  const amt = round2(Number(line.amount));
  if (c.kind === 'calendar') {
    const mr = round2(Number(c.monthlyRent));
    return `Calc: ${mr} ÷ ${c.daysInMonth} calendar days × ${c.billedDays} billed days (${c.periodFrom}–${c.periodTo}) = ${amt}`;
  }
  if (c.kind === 'cycle') {
    const mr = round2(Number(c.monthlyRent));
    return `Calc: (${mr} ÷ ${c.cycleDays} days in cycle) × ${c.overlapDays} billed days (${c.periodFrom}–${c.periodTo}) = ${amt}`;
  }
  return null;
}

module.exports = {
  buildExtendRentalIncomeLines,
  buildChangeRoomPriorOldRentLines,
  defaultFeeInvoiceYmd,
  formatProrateFormulaLine,
  addDaysYmd,
  compareYmd
};
