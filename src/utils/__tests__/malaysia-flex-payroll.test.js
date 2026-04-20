const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  computeMalaysiaFlexPayroll,
  normalizePayrollDefaults,
  DEFAULT_PAYROLL_CONFIG,
} = require('../malaysia-flex-payroll');

describe('normalizePayrollDefaults', () => {
  test('fills defaults', () => {
    const c = normalizePayrollDefaults(null);
    assert.equal(c.workingDaysPerMonth, DEFAULT_PAYROLL_CONFIG.workingDaysPerMonth);
    assert.equal(c.lateMode, 'hourly');
  });

  test('respects overrides', () => {
    const c = normalizePayrollDefaults({ lateMode: 'fixed', fixedLateAmount: 10, workingDaysPerMonth: 22 });
    assert.equal(c.lateMode, 'fixed');
    assert.equal(c.fixedLateAmount, 10);
    assert.equal(c.workingDaysPerMonth, 22);
  });
});

describe('computeMalaysiaFlexPayroll', () => {
  const basic = 2600;

  test('hourly late deduction', () => {
    // hourlyRate = 2600/26/8 = 12.5, 60 min late → 12.5
    const r = computeMalaysiaFlexPayroll(
      { basicSalary: basic, lateMinutes: 60, lateCount: 0, unpaidLeaveDays: 0, allowances: [] },
      { lateMode: 'hourly' }
    );
    assert.equal(r.breakdown.hourlyRate, 12.5);
    assert.equal(r.breakdown.late.amount, 12.5);
    assert.equal(r.grossSalary, basic);
    assert.equal(r.totalDeductions, 12.5);
    assert.equal(r.netSalary, 2587.5);
  });

  test('fixed late deduction', () => {
    const r = computeMalaysiaFlexPayroll(
      { basicSalary: basic, lateMinutes: 0, lateCount: 3, unpaidLeaveDays: 0, allowances: [] },
      { lateMode: 'fixed', fixedLateAmount: 20 }
    );
    assert.equal(r.breakdown.late.amount, 60);
  });

  test('half_day late deduction when late > threshold', () => {
    const r = computeMalaysiaFlexPayroll(
      { basicSalary: basic, lateMinutes: 61, unpaidLeaveDays: 0, allowances: [] },
      { lateMode: 'half_day', halfDayLateMinutesThreshold: 60 }
    );
    // daily = 2600/26 = 100, half = 50
    assert.equal(r.breakdown.dailyRate, 100);
    assert.equal(r.breakdown.late.amount, 50);
  });

  test('half_day no deduction when late <= threshold', () => {
    const r = computeMalaysiaFlexPayroll(
      { basicSalary: basic, lateMinutes: 60, unpaidLeaveDays: 0, allowances: [] },
      { lateMode: 'half_day', halfDayLateMinutesThreshold: 60 }
    );
    assert.equal(r.breakdown.late.amount, 0);
  });

  test('unpaid leave', () => {
    const r = computeMalaysiaFlexPayroll(
      { basicSalary: basic, lateMinutes: 0, unpaidLeaveDays: 2, allowances: [] },
      {}
    );
    assert.equal(r.breakdown.unpaidLeave.amount, 200);
    assert.equal(r.totalDeductions, 200);
  });

  test('fixed allowance always full', () => {
    const r = computeMalaysiaFlexPayroll(
      {
        basicSalary: basic,
        lateMinutes: 30,
        unpaidLeaveDays: 0,
        allowances: [{ name: 'Meal', amount: 200, allowanceType: 'fixed' }],
      },
      {}
    );
    assert.equal(r.breakdown.allowances[0].effectiveAmount, 200);
    assert.equal(r.grossSalary, 2800);
  });

  test('conditional attendance_style: late halves', () => {
    const r = computeMalaysiaFlexPayroll(
      {
        basicSalary: basic,
        lateMinutes: 1,
        unpaidLeaveDays: 0,
        allowances: [{ name: 'Att', amount: 100, allowanceType: 'conditional', conditionalPolicy: 'attendance_style' }],
      },
      {}
    );
    assert.equal(r.breakdown.allowances[0].effectiveAmount, 50);
  });

  test('conditional attendance_style: unpaid removes', () => {
    const r = computeMalaysiaFlexPayroll(
      {
        basicSalary: basic,
        lateMinutes: 0,
        unpaidLeaveDays: 1,
        allowances: [{ name: 'Att', amount: 100, allowanceType: 'conditional' }],
      },
      { defaultConditionalPolicy: 'attendance_style' }
    );
    assert.equal(r.breakdown.allowances[0].effectiveAmount, 0);
  });

  test('conditional none policy ignores late/unpaid', () => {
    const r = computeMalaysiaFlexPayroll(
      {
        basicSalary: basic,
        lateMinutes: 60,
        unpaidLeaveDays: 1,
        allowances: [{ name: 'X', amount: 100, allowanceType: 'conditional', conditionalPolicy: 'none' }],
      },
      {}
    );
    assert.equal(r.breakdown.allowances[0].effectiveAmount, 100);
  });

  test('deduction lines add to total', () => {
    const r = computeMalaysiaFlexPayroll(
      {
        basicSalary: basic,
        lateMinutes: 0,
        unpaidLeaveDays: 0,
        allowances: [],
        deductionLines: [{ name: 'Loan', amount: 50 }],
      },
      {}
    );
    assert.equal(r.breakdown.otherDeductionsTotal, 50);
    assert.equal(r.totalDeductions, 50);
    assert.equal(r.netSalary, 2550);
  });

  test('zero late and unpaid: no attendance penalty on conditional', () => {
    const r = computeMalaysiaFlexPayroll(
      {
        basicSalary: basic,
        lateMinutes: 0,
        unpaidLeaveDays: 0,
        allowances: [{ name: 'Att', amount: 100, allowanceType: 'conditional' }],
      },
      {}
    );
    assert.equal(r.breakdown.allowances[0].effectiveAmount, 100);
  });
});
