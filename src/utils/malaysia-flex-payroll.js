/**
 * Malaysia flexible payroll — pure functions (no I/O).
 * Illustrative business rules; denominators configurable per operator.
 */

/** @typedef {'hourly'|'fixed'|'half_day'} LateMode */
/** @typedef {'attendance_style'|'none'} ConditionalPolicy */

const DEFAULT_PAYROLL_CONFIG = {
  workingDaysPerMonth: 26,
  hoursPerDay: 8,
  /** @type {LateMode} */
  lateMode: 'hourly',
  fixedLateAmount: 0,
  /** @type {ConditionalPolicy} */
  defaultConditionalPolicy: 'attendance_style',
  halfDayLateMinutesThreshold: 60,
  businessTimeZone: 'Asia/Kuala_Lumpur',
};

function roundMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function num(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

/**
 * Merge stored JSON from DB with defaults (ignores invalid keys).
 * @param {Record<string, unknown>|null|undefined} raw
 * @returns {typeof DEFAULT_PAYROLL_CONFIG & Record<string, unknown>}
 */
function normalizePayrollDefaults(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const lateMode = ['hourly', 'fixed', 'half_day'].includes(String(o.lateMode))
    ? String(o.lateMode)
    : DEFAULT_PAYROLL_CONFIG.lateMode;
  const defaultConditionalPolicy = ['attendance_style', 'none'].includes(String(o.defaultConditionalPolicy))
    ? String(o.defaultConditionalPolicy)
    : DEFAULT_PAYROLL_CONFIG.defaultConditionalPolicy;
  return {
    ...DEFAULT_PAYROLL_CONFIG,
    workingDaysPerMonth: Math.max(1, num(o.workingDaysPerMonth, DEFAULT_PAYROLL_CONFIG.workingDaysPerMonth)),
    hoursPerDay: Math.max(1, num(o.hoursPerDay, DEFAULT_PAYROLL_CONFIG.hoursPerDay)),
    lateMode,
    fixedLateAmount: Math.max(0, num(o.fixedLateAmount, 0)),
    defaultConditionalPolicy,
    halfDayLateMinutesThreshold: Math.max(0, num(o.halfDayLateMinutesThreshold, 60)),
    businessTimeZone:
      typeof o.businessTimeZone === 'string' && o.businessTimeZone.trim()
        ? o.businessTimeZone.trim()
        : DEFAULT_PAYROLL_CONFIG.businessTimeZone,
  };
}

/**
 * @param {number} amount
 * @param {ConditionalPolicy} policy
 * @param {{ lateMinutes: number, unpaidLeaveDays: number }} ctx
 */
function effectiveConditionalAllowance(amount, policy, ctx) {
  const a = Math.max(0, amount);
  const lateM = Math.max(0, ctx.lateMinutes);
  const ul = Math.max(0, ctx.unpaidLeaveDays);
  if (policy === 'none') return roundMoney(a);
  // attendance_style: unpaid → 0; late → 50%; else full
  if (ul > 0) return 0;
  if (lateM > 0) return roundMoney(a * 0.5);
  return roundMoney(a);
}

/**
 * @param {number} basicSalary
 * @param {typeof DEFAULT_PAYROLL_CONFIG} cfg
 */
function computeRates(basicSalary, cfg) {
  const b = Math.max(0, basicSalary);
  const wd = cfg.workingDaysPerMonth;
  const hd = cfg.hoursPerDay;
  const dailyRate = wd > 0 ? b / wd : 0;
  const hourlyRate = wd > 0 && hd > 0 ? b / wd / hd : 0;
  return { dailyRate: roundMoney(dailyRate), hourlyRate: roundMoney(hourlyRate) };
}

/**
 * @param {typeof DEFAULT_PAYROLL_CONFIG} cfg
 * @param {{ hourlyRate: number, dailyRate: number, lateMinutes: number, lateCount: number }} p
 */
function computeLateDeduction(cfg, p) {
  const lateMinutes = Math.max(0, num(p.lateMinutes, 0));
  const lateCount = Math.max(0, num(p.lateCount, 0));
  const mode = cfg.lateMode;
  if (mode === 'fixed') {
    const amt = Math.max(0, num(cfg.fixedLateAmount, 0));
    return roundMoney(lateCount * amt);
  }
  if (mode === 'half_day') {
    const thr = Math.max(0, num(cfg.halfDayLateMinutesThreshold, 60));
    if (lateMinutes > thr) return roundMoney(0.5 * p.dailyRate);
    return 0;
  }
  // hourly
  return roundMoney(p.hourlyRate * (lateMinutes / 60));
}

/**
 * Full payroll snapshot (statutory deductions excluded).
 *
 * @param {{
 *   basicSalary: number,
 *   lateMinutes?: number,
 *   lateCount?: number,
 *   unpaidLeaveDays?: number,
 *   allowances?: Array<{
 *     name?: string,
 *     amount: number,
 *     allowanceType?: 'fixed'|'conditional',
 *     conditionalPolicy?: ConditionalPolicy,
 *   }>,
 *   deductionLines?: Array<{ name?: string, amount: number }>,
 * }} input
 * @param {Partial<typeof DEFAULT_PAYROLL_CONFIG>|null|undefined} config
 */
function computeMalaysiaFlexPayroll(input, config) {
  const cfg = normalizePayrollDefaults(config);
  const basicSalary = Math.max(0, num(input?.basicSalary, 0));
  const lateMinutes = Math.max(0, num(input?.lateMinutes, 0));
  const lateCount = Math.max(0, num(input?.lateCount, 0));
  const unpaidLeaveDays = Math.max(0, num(input?.unpaidLeaveDays, 0));

  const { dailyRate, hourlyRate } = computeRates(basicSalary, cfg);

  const lateDeduction = computeLateDeduction(cfg, {
    hourlyRate,
    dailyRate,
    lateMinutes,
    lateCount,
  });

  const unpaidDeduction = roundMoney(unpaidLeaveDays * dailyRate);

  const ctx = { lateMinutes, unpaidLeaveDays };
  const allowancesIn = Array.isArray(input?.allowances) ? input.allowances : [];

  const allowanceBreakdown = [];
  let totalAllowancesEffective = 0;

  for (let i = 0; i < allowancesIn.length; i++) {
    const row = allowancesIn[i] || {};
    const name = row.name != null ? String(row.name).trim() || `Allowance ${i + 1}` : `Allowance ${i + 1}`;
    const rawAmt = Math.max(0, num(row.amount, 0));
    const at = String(row.allowanceType || 'fixed').toLowerCase() === 'conditional' ? 'conditional' : 'fixed';
    const policy =
      row.conditionalPolicy === 'none' || row.conditionalPolicy === 'attendance_style'
        ? row.conditionalPolicy
        : cfg.defaultConditionalPolicy;

    let effective = rawAmt;
    if (at === 'conditional') {
      effective = effectiveConditionalAllowance(rawAmt, policy, ctx);
    } else {
      effective = roundMoney(rawAmt);
    }
    totalAllowancesEffective += effective;
    allowanceBreakdown.push({
      name,
      allowanceType: at,
      conditionalPolicy: at === 'conditional' ? policy : undefined,
      nominalAmount: roundMoney(rawAmt),
      effectiveAmount: roundMoney(effective),
    });
  }

  totalAllowancesEffective = roundMoney(totalAllowancesEffective);

  const grossSalary = roundMoney(basicSalary + totalAllowancesEffective);

  const dedLines = Array.isArray(input?.deductionLines) ? input.deductionLines : [];
  let otherDeductions = 0;
  const deductionLineBreakdown = [];
  for (let i = 0; i < dedLines.length; i++) {
    const d = dedLines[i] || {};
    const name = d.name != null ? String(d.name).trim() || `Deduction ${i + 1}` : `Deduction ${i + 1}`;
    const amt = Math.max(0, num(d.amount, 0));
    otherDeductions += amt;
    deductionLineBreakdown.push({ name, amount: roundMoney(amt) });
  }
  otherDeductions = roundMoney(otherDeductions);

  const totalDeductions = roundMoney(lateDeduction + unpaidDeduction + otherDeductions);
  const netSalary = roundMoney(Math.max(0, grossSalary - totalDeductions));

  return {
    grossSalary,
    totalDeductions,
    netSalary,
    breakdown: {
      basicSalary: roundMoney(basicSalary),
      dailyRate,
      hourlyRate,
      late: {
        mode: cfg.lateMode,
        lateMinutes,
        lateCount,
        amount: lateDeduction,
      },
      unpaidLeave: {
        days: unpaidLeaveDays,
        amount: unpaidDeduction,
      },
      allowances: allowanceBreakdown,
      otherDeductions: deductionLineBreakdown,
      otherDeductionsTotal: otherDeductions,
    },
    configUsed: cfg,
  };
}

module.exports = {
  DEFAULT_PAYROLL_CONFIG,
  normalizePayrollDefaults,
  computeMalaysiaFlexPayroll,
};
