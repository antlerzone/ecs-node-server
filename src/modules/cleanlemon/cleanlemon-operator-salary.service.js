/**
 * Operator salary → accounting accrual + payout (MY):
 * - Bukku: journal + banking expense (see Bukku payroll guide).
 * - Xero: Accounting API only — Manual Journal (accrual) + Bank SPEND (payout). Maps same GL titles
 *   "Salary & Wages" / "Salary Control" / Bank|Cash in cln_account_client with system=xero (not Payroll AU/NZ/UK).
 */

const crypto = require('crypto');
const pool = require('../../config/db');
const { computeMalaysiaFlexPayroll, normalizePayrollDefaults } = require('../../utils/malaysia-flex-payroll');
const clnInt = require('./cleanlemon-integration.service');
const bukkuJournal = require('../bukku/wrappers/journalEntry.wrapper');
const bukkuBankingExpense = require('../bukku/wrappers/bankingExpense.wrapper');
const xeroManualJournal = require('../xero/wrappers/manualjournal.wrapper');
const xeroBankTransaction = require('../xero/wrappers/banktransaction.wrapper');
const { resolveXeroAccountCode, resolveXeroInvoiceLineItemAccount } = require('../xero/lib/accountCodeResolver');
const { findXeroBankAccountRef } = require('../rentalcollection-invoice/rentalcollection-invoice.service');

const DEFAULT_CURRENCY = (process.env.CLEANLEMON_DEFAULT_CURRENCY || 'MYR').trim() || 'MYR';

function bukkuReq(operatorId, creds) {
  return {
    client: {
      id: String(operatorId),
      bukku_secretKey: String(creds.token || '').trim(),
      bukku_subdomain: String(creds.subdomain || '').trim()
    }
  };
}

async function salaryTablesExist() {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'cln_salary_record'`
  );
  return Number(row?.c || 0) === 1;
}

async function getClnAddonAccountProvider(operatorId) {
  await clnInt.ensureClnOperatorIntegrationTable();
  const [rows] = await pool.query(
    `SELECT provider FROM cln_operator_integration
     WHERE operator_id = ? AND \`key\` = 'addonAccount' AND enabled = 1
     ORDER BY CASE provider WHEN 'bukku' THEN 0 WHEN 'xero' THEN 1 ELSE 2 END
     LIMIT 1`,
    [String(operatorId)]
  );
  const p = rows[0]?.provider;
  return p ? String(p).trim().toLowerCase() : null;
}

async function resolveMappedAccountId(operatorId, title, system = 'bukku') {
  const t = String(title || '').trim();
  if (!t) return null;
  const [rows] = await pool.query(
    `SELECT ac.external_account
     FROM cln_account a
     INNER JOIN cln_account_client ac ON ac.account_id = a.id AND ac.operator_id = ? AND ac.\`system\` = ?
     WHERE TRIM(a.title) = ?
     LIMIT 1`,
    [String(operatorId), system, t]
  );
  const ext = rows[0]?.external_account != null ? String(rows[0].external_account).trim() : '';
  if (ext && /^\d+$/.test(ext)) return Number(ext);
  return null;
}

/** Raw external_account for Xero (code or AccountID UUID). */
async function resolveMappedAccountExternal(operatorId, title, system = 'xero') {
  const t = String(title || '').trim();
  if (!t) return null;
  const [rows] = await pool.query(
    `SELECT ac.external_account
     FROM cln_account a
     INNER JOIN cln_account_client ac ON ac.account_id = a.id AND ac.operator_id = ? AND ac.\`system\` = ?
     WHERE TRIM(a.title) = ?
     LIMIT 1`,
    [String(operatorId), system, t]
  );
  const ext = rows[0]?.external_account != null ? String(rows[0].external_account).trim() : '';
  return ext || null;
}

function xeroReq(operatorId) {
  return { cleanlemonOperatorId: String(operatorId) };
}

function formatXeroErr(err) {
  if (err == null) return '';
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function ymdLastOfMonth(period) {
  const [ys, ms] = String(period || '').split('-');
  const y = parseInt(ys, 10);
  const mo = parseInt(ms, 10);
  if (!y || !mo) return new Date().toISOString().slice(0, 10);
  const d = new Date(y, mo, 0);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function parseJsonObject(val) {
  if (val == null) return null;
  if (typeof val === 'object' && !Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try {
      const o = JSON.parse(val);
      return typeof o === 'object' && o !== null && !Array.isArray(o) ? o : null;
    } catch (_) {
      return null;
    }
  }
  return null;
}

function roundMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

/** Only approved lines (or legacy rows with no status) count toward flexible payroll. */
function lineIncludedInPayroll(meta) {
  const m = meta && typeof meta === 'object' ? meta : {};
  const s = String(m.approvalStatus || '')
    .trim()
    .toLowerCase();
  if (s === 'pending' || s === 'rejected') return false;
  return true;
}

function mapRecordRow(r) {
  const mtdAmt = r.mtd_amount != null && r.mtd_amount !== '' ? Number(r.mtd_amount) : null;
  const mtdTick =
    Number(r.mtd_applies) === 1 || (mtdAmt != null && !Number.isNaN(mtdAmt) && mtdAmt > 0);
  const payrollInputs = parseJsonObject(r.payroll_inputs_json);
  return {
    id: r.id,
    employeeLabel: r.employee_label != null ? String(r.employee_label) : '',
    team: r.team != null ? String(r.team) : '',
    baseSalary: Number(r.base_salary || 0),
    netSalary: Number(r.net_salary || 0),
    period: r.period != null ? String(r.period) : '',
    status: r.status != null ? String(r.status) : 'pending_sync',
    bukkuJournalId: r.bukku_journal_id != null ? String(r.bukku_journal_id).trim() : '',
    bukkuExpenseId: r.bukku_expense_id != null ? String(r.bukku_expense_id).trim() : '',
    xeroManualJournalId: r.xero_manual_journal_id != null ? String(r.xero_manual_journal_id).trim() : '',
    xeroBankTransactionId: r.xero_bank_transaction_id != null ? String(r.xero_bank_transaction_id).trim() : '',
    paymentMethod: r.payment_method != null ? String(r.payment_method) : '',
    paidDate: r.paid_date != null ? String(r.paid_date).slice(0, 10) : '',
    mtdApplies: Number(r.mtd_applies) === 1,
    epfApplies: Number(r.epf_applies) === 1,
    socsoApplies: Number(r.socso_applies) === 1,
    eisApplies: Number(r.eis_applies) === 1,
    mtdAmount: mtdAmt != null && !Number.isNaN(mtdAmt) ? mtdAmt : null,
    epfAmount: r.epf_amount != null && r.epf_amount !== '' ? Number(r.epf_amount) : null,
    socsoAmount: r.socso_amount != null && r.socso_amount !== '' ? Number(r.socso_amount) : null,
    eisAmount: r.eis_amount != null && r.eis_amount !== '' ? Number(r.eis_amount) : null,
    mtdTick,
    payrollInputs: payrollInputs || undefined,
  };
}

async function listOperatorSalaries(operatorId, periodOpt) {
  const ok = await salaryTablesExist();
  if (!ok) return [];
  const oid = String(operatorId || '').trim();
  if (!oid) return [];
  const period = periodOpt != null && String(periodOpt).trim() !== '' ? String(periodOpt).trim() : null;
  let sql = `SELECT id, operator_id, period, team, employee_label, base_salary, net_salary,
            status, bukku_journal_id, bukku_expense_id, xero_manual_journal_id, xero_bank_transaction_id,
            payment_method, paid_date,
            mtd_applies, epf_applies, socso_applies, eis_applies,
            mtd_amount, epf_amount, socso_amount, eis_amount,
            payroll_inputs_json
     FROM cln_salary_record
     WHERE operator_id = ?`;
  const params = [oid];
  if (period) {
    sql += ` AND period = ?`;
    params.push(period);
  }
  sql += ` ORDER BY period DESC, team ASC, employee_label ASC`;
  const [rows] = await pool.query(sql, params);
  return rows.map(mapRecordRow);
}

async function getSalarySettings(operatorId) {
  const oid = String(operatorId || '').trim();
  if (!oid) return { payDays: [28], businessTimeZone: 'Asia/Kuala_Lumpur', payrollDefaults: {} };
  const ok = await salaryTablesExist();
  if (!ok) return { payDays: [28], businessTimeZone: 'Asia/Kuala_Lumpur', payrollDefaults: {} };
  const [[row]] = await pool.query(
    'SELECT pay_days_json, payroll_defaults_json FROM cln_operator_salary_settings WHERE operator_id = ? LIMIT 1',
    [oid]
  );
  let payDays = [28];
  if (row?.pay_days_json != null) {
    try {
      const j = typeof row.pay_days_json === 'string' ? JSON.parse(row.pay_days_json) : row.pay_days_json;
      if (Array.isArray(j) && j.length) {
        payDays = j.map((n) => Math.min(31, Math.max(1, parseInt(n, 10) || 1)));
      }
    } catch (_) {}
  }
  let payrollDefaults = {};
  if (row?.payroll_defaults_json != null) {
    try {
      const raw =
        typeof row.payroll_defaults_json === 'string'
          ? JSON.parse(row.payroll_defaults_json)
          : row.payroll_defaults_json;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) payrollDefaults = raw;
    } catch (_) {}
  }
  return { payDays, businessTimeZone: 'Asia/Kuala_Lumpur', payrollDefaults };
}

async function saveSalarySettings(operatorId, payDaysInput, payrollDefaultsInput) {
  const oid = String(operatorId || '').trim();
  if (!oid) throw Object.assign(new Error('MISSING_OPERATOR_ID'), { code: 'MISSING_OPERATOR_ID' });
  const ok = await salaryTablesExist();
  if (!ok) throw Object.assign(new Error('SALARY_TABLES_MISSING'), { code: 'SALARY_TABLES_MISSING' });
  const arr = Array.isArray(payDaysInput) ? payDaysInput : [];
  const payDays = [...new Set(arr.map((n) => Math.min(31, Math.max(1, parseInt(n, 10) || 1))))].sort(
    (a, b) => a - b
  );
  const json = JSON.stringify(payDays.length ? payDays : [28]);

  let payrollDefaultsJson = null;
  if (payrollDefaultsInput !== undefined) {
    const o = payrollDefaultsInput && typeof payrollDefaultsInput === 'object' ? payrollDefaultsInput : {};
    payrollDefaultsJson = JSON.stringify(o);
  }

  if (payrollDefaultsJson != null) {
    await pool.query(
      `INSERT INTO cln_operator_salary_settings (operator_id, pay_days_json, payroll_defaults_json, updated_at)
       VALUES (?, ?, CAST(? AS JSON), CURRENT_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE pay_days_json = VALUES(pay_days_json),
         payroll_defaults_json = VALUES(payroll_defaults_json), updated_at = CURRENT_TIMESTAMP(3)`,
      [oid, json, payrollDefaultsJson]
    );
  } else {
    await pool.query(
      `INSERT INTO cln_operator_salary_settings (operator_id, pay_days_json, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE pay_days_json = VALUES(pay_days_json), updated_at = CURRENT_TIMESTAMP(3)`,
      [oid, json]
    );
  }
  return getSalarySettings(operatorId);
}

async function createSalaryRecord(operatorId, body) {
  const oid = String(operatorId || '').trim();
  if (!oid) throw Object.assign(new Error('MISSING_OPERATOR_ID'), { code: 'MISSING_OPERATOR_ID' });
  const ok = await salaryTablesExist();
  if (!ok) throw Object.assign(new Error('SALARY_TABLES_MISSING'), { code: 'SALARY_TABLES_MISSING' });
  const period = String(body?.period || '').trim();
  if (!/^\d{4}-\d{2}$/.test(period)) throw Object.assign(new Error('INVALID_PERIOD'), { code: 'INVALID_PERIOD' });
  const id = crypto.randomUUID();
  const team = String(body?.team ?? '').trim();
  const employeeLabel = String(body?.employeeLabel ?? '').trim() || 'Staff';
  const baseSalary = Math.max(0, Number(body?.baseSalary) || 0);
  const netSalary = Math.max(0, Number(body?.netSalary) || 0);
  const pi = body?.payrollInputs;
  const payrollInputsJson =
    pi && typeof pi === 'object' && !Array.isArray(pi) ? JSON.stringify(pi) : null;
  if (payrollInputsJson != null) {
    await pool.query(
      `INSERT INTO cln_salary_record (id, operator_id, period, team, employee_label, base_salary, net_salary, payroll_inputs_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), 'pending_sync', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
      [id, oid, period, team, employeeLabel, baseSalary, netSalary, payrollInputsJson]
    );
  } else {
    await pool.query(
      `INSERT INTO cln_salary_record (id, operator_id, period, team, employee_label, base_salary, net_salary, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_sync', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
      [id, oid, period, team, employeeLabel, baseSalary, netSalary]
    );
  }
  const [[r]] = await pool.query(`SELECT * FROM cln_salary_record WHERE id = ? LIMIT 1`, [id]);
  return mapRecordRow(r);
}

async function updateSalaryRecord(operatorId, recordId, input) {
  const oid = String(operatorId || '').trim();
  const rid = String(recordId || '').trim();
  if (!oid || !rid) throw Object.assign(new Error('MISSING_PARAMS'), { code: 'MISSING_PARAMS' });
  const ok = await salaryTablesExist();
  if (!ok) throw Object.assign(new Error('SALARY_TABLES_MISSING'), { code: 'SALARY_TABLES_MISSING' });
  const [[row]] = await pool.query(
    `SELECT status FROM cln_salary_record WHERE id = ? AND operator_id = ? LIMIT 1`,
    [rid, oid]
  );
  if (!row) throw Object.assign(new Error('RECORD_NOT_FOUND'), { code: 'RECORD_NOT_FOUND' });
  if (['void', 'archived'].includes(String(row.status))) {
    throw Object.assign(new Error('RECORD_LOCKED'), { code: 'RECORD_LOCKED' });
  }

  const sets = [];
  const vals = [];
  const take = (col, val, type = 'str') => {
    if (val === undefined) return;
    sets.push(`${col} = ?`);
    if (type === 'str') vals.push(val != null ? String(val).trim() : '');
    else if (type === 'money') {
      if (val === null || val === '') vals.push(null);
      else vals.push(Math.max(0, Number(val) || 0));
    } else if (type === 'bool') {
      vals.push(val === true || val === 1 || val === '1' ? 1 : 0);
    } else if (type === 'num') {
      vals.push(Math.max(0, Number(val) || 0));
    }
  };

  take('team', input.team, 'str');
  take('employee_label', input.employeeLabel, 'str');
  if (input.baseSalary !== undefined) take('base_salary', input.baseSalary, 'num');
  if (input.netSalary !== undefined) take('net_salary', input.netSalary, 'num');
  take('mtd_applies', input.mtdApplies, 'bool');
  take('epf_applies', input.epfApplies, 'bool');
  take('socso_applies', input.socsoApplies, 'bool');
  take('eis_applies', input.eisApplies, 'bool');
  take('mtd_amount', input.mtdAmount, 'money');
  take('epf_amount', input.epfAmount, 'money');
  take('socso_amount', input.socsoAmount, 'money');
  take('eis_amount', input.eisAmount, 'money');

  if (input.payrollInputs !== undefined) {
    if (input.payrollInputs === null) {
      sets.push('payroll_inputs_json = NULL');
    } else if (typeof input.payrollInputs === 'object' && !Array.isArray(input.payrollInputs)) {
      sets.push('payroll_inputs_json = CAST(? AS JSON)');
      vals.push(JSON.stringify(input.payrollInputs));
    }
  }

  if (!sets.length) {
    const [[r2]] = await pool.query(`SELECT * FROM cln_salary_record WHERE id = ? AND operator_id = ? LIMIT 1`, [rid, oid]);
    return r2 ? mapRecordRow(r2) : null;
  }

  vals.push(rid, oid);
  await pool.query(
    `UPDATE cln_salary_record SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND operator_id = ? LIMIT 1`,
    vals
  );
  const [[r3]] = await pool.query(`SELECT * FROM cln_salary_record WHERE id = ? AND operator_id = ? LIMIT 1`, [rid, oid]);
  return r3 ? mapRecordRow(r3) : null;
}

async function listSalaryLines(operatorId, period) {
  const oid = String(operatorId || '').trim();
  if (!oid) return [];
  const ok = await salaryTablesExist();
  if (!ok) return [];
  const p = String(period || '').trim();
  if (!/^\d{4}-\d{2}$/.test(p)) return [];
  const [rows] = await pool.query(
    `SELECT l.id, l.salary_record_id, l.line_kind, l.label, l.amount, l.meta_json, l.sort_order,
            r.employee_label, r.period, r.team
     FROM cln_salary_line l
     INNER JOIN cln_salary_record r ON r.id = l.salary_record_id
     WHERE r.operator_id = ? AND r.period = ?
     ORDER BY r.employee_label ASC, l.sort_order ASC, l.created_at ASC`,
    [oid, p]
  );
  return rows.map((x) => {
    const meta = parseJsonObject(x.meta_json);
    return {
      id: x.id,
      salaryRecordId: x.salary_record_id,
      lineKind: x.line_kind,
      label: x.label != null ? String(x.label) : '',
      amount: Number(x.amount || 0),
      employeeLabel: x.employee_label != null ? String(x.employee_label) : '',
      period: x.period != null ? String(x.period) : '',
      team: x.team != null ? String(x.team) : '',
      meta: meta || undefined,
    };
  });
}

async function addSalaryLine(operatorId, body) {
  const oid = String(operatorId || '').trim();
  if (!oid) throw Object.assign(new Error('MISSING_OPERATOR_ID'), { code: 'MISSING_OPERATOR_ID' });
  const ok = await salaryTablesExist();
  if (!ok) throw Object.assign(new Error('SALARY_TABLES_MISSING'), { code: 'SALARY_TABLES_MISSING' });
  const salaryRecordId = String(body?.salaryRecordId || '').trim();
  const lineKind = String(body?.lineKind || '').toLowerCase() === 'deduction' ? 'deduction' : 'allowance';
  const label = String(body?.label ?? '').trim() || (lineKind === 'allowance' ? 'Allowance' : 'Deduction');
  const amount = Math.max(0, Number(body?.amount) || 0);
  const metaRaw = body?.meta != null ? body.meta : body?.metaJson;
  let metaObj = {};
  if (metaRaw && typeof metaRaw === 'object' && !Array.isArray(metaRaw)) {
    metaObj = { ...metaRaw };
  }
  if (metaObj.approvalStatus == null || String(metaObj.approvalStatus).trim() === '') {
    metaObj.approvalStatus = 'pending';
  }
  const metaJson = JSON.stringify(metaObj);
  const [[rec]] = await pool.query(
    'SELECT id FROM cln_salary_record WHERE id = ? AND operator_id = ? LIMIT 1',
    [salaryRecordId, oid]
  );
  if (!rec) throw Object.assign(new Error('RECORD_NOT_FOUND'), { code: 'RECORD_NOT_FOUND' });
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO cln_salary_line (id, salary_record_id, line_kind, label, amount, meta_json, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), 0, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
    [id, salaryRecordId, lineKind, label, amount, metaJson]
  );
  const [[row]] = await pool.query(
    `SELECT l.id, l.salary_record_id, l.line_kind, l.label, l.amount, l.meta_json, r.employee_label, r.period, r.team
     FROM cln_salary_line l INNER JOIN cln_salary_record r ON r.id = l.salary_record_id WHERE l.id = ? LIMIT 1`,
    [id]
  );
  const meta = parseJsonObject(row.meta_json);
  await syncRecordNetSalaryFromPayroll(oid, salaryRecordId);
  return {
    id: row.id,
    salaryRecordId: row.salary_record_id,
    lineKind: row.line_kind,
    label: row.label,
    amount: Number(row.amount || 0),
    employeeLabel: row.employee_label != null ? String(row.employee_label) : '',
    period: row.period != null ? String(row.period) : '',
    team: row.team != null ? String(row.team) : '',
    meta: meta || undefined,
  };
}

/**
 * Recompute flexible net from lines (approved only), then subtract stored statutory employee amounts.
 */
async function syncRecordNetSalaryFromPayroll(operatorId, salaryRecordId) {
  const oid = String(operatorId || '').trim();
  const rid = String(salaryRecordId || '').trim();
  if (!oid || !rid) return null;
  const ok = await salaryTablesExist();
  if (!ok) return null;
  const [[row]] = await pool.query(`SELECT * FROM cln_salary_record WHERE id = ? AND operator_id = ? LIMIT 1`, [
    rid,
    oid
  ]);
  if (!row) return null;
  let flexNet = 0;
  try {
    const prev = await previewFlexiblePayroll(oid, { salaryRecordId: rid });
    flexNet = Math.max(0, Number(prev?.netSalary) || 0);
  } catch (_) {
    flexNet = Math.max(0, Number(row.net_salary || 0));
  }
  const mtdTick =
    Number(row.mtd_applies) === 1 ||
    (row.mtd_amount != null && row.mtd_amount !== '' && Number(row.mtd_amount) > 0);
  let net = flexNet;
  if (mtdTick && row.mtd_amount != null && row.mtd_amount !== '') {
    net -= Math.max(0, Number(row.mtd_amount) || 0);
  }
  if (Number(row.epf_applies) === 1 && row.epf_amount != null && row.epf_amount !== '') {
    net -= Math.max(0, Number(row.epf_amount) || 0);
  }
  if (Number(row.socso_applies) === 1 && row.socso_amount != null && row.socso_amount !== '') {
    net -= Math.max(0, Number(row.socso_amount) || 0);
  }
  if (Number(row.eis_applies) === 1 && row.eis_amount != null && row.eis_amount !== '') {
    net -= Math.max(0, Number(row.eis_amount) || 0);
  }
  net = roundMoney(Math.max(0, net));
  await pool.query(
    `UPDATE cln_salary_record SET net_salary = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND operator_id = ? LIMIT 1`,
    [net, rid, oid]
  );
  return net;
}

async function updateSalaryLine(operatorId, lineId, body) {
  const oid = String(operatorId || '').trim();
  const lid = String(lineId || '').trim();
  if (!oid || !lid) throw Object.assign(new Error('MISSING_PARAMS'), { code: 'MISSING_PARAMS' });
  const ok = await salaryTablesExist();
  if (!ok) throw Object.assign(new Error('SALARY_TABLES_MISSING'), { code: 'SALARY_TABLES_MISSING' });
  const [[ln]] = await pool.query(
    `SELECT l.id, l.meta_json, l.salary_record_id FROM cln_salary_line l
     INNER JOIN cln_salary_record r ON r.id = l.salary_record_id
     WHERE l.id = ? AND r.operator_id = ? LIMIT 1`,
    [lid, oid]
  );
  if (!ln) throw Object.assign(new Error('LINE_NOT_FOUND'), { code: 'LINE_NOT_FOUND' });
  const prevMeta = parseJsonObject(ln.meta_json) || {};
  let nextMeta = { ...prevMeta };
  if (body?.meta && typeof body.meta === 'object' && !Array.isArray(body.meta)) {
    nextMeta = { ...nextMeta, ...body.meta };
  }
  if (body?.approvalStatus != null) {
    const st = String(body.approvalStatus).toLowerCase();
    if (['pending', 'approved', 'rejected'].includes(st)) nextMeta.approvalStatus = st;
  }
  const sets = [];
  const vals = [];
  if (body?.label !== undefined) {
    sets.push('label = ?');
    vals.push(String(body.label ?? '').trim() || 'Line');
  }
  if (body?.amount !== undefined) {
    sets.push('amount = ?');
    vals.push(Math.max(0, Number(body.amount) || 0));
  }
  sets.push('meta_json = CAST(? AS JSON)');
  vals.push(JSON.stringify(nextMeta));
  vals.push(lid);
  await pool.query(
    `UPDATE cln_salary_line SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ? LIMIT 1`,
    vals
  );
  await syncRecordNetSalaryFromPayroll(oid, ln.salary_record_id);
  const [[row]] = await pool.query(
    `SELECT l.id, l.salary_record_id, l.line_kind, l.label, l.amount, l.meta_json, r.employee_label, r.period, r.team
     FROM cln_salary_line l INNER JOIN cln_salary_record r ON r.id = l.salary_record_id WHERE l.id = ? LIMIT 1`,
    [lid]
  );
  const metaOut = parseJsonObject(row.meta_json);
  return {
    id: row.id,
    salaryRecordId: row.salary_record_id,
    lineKind: row.line_kind,
    label: row.label,
    amount: Number(row.amount || 0),
    employeeLabel: row.employee_label != null ? String(row.employee_label) : '',
    period: row.period != null ? String(row.period) : '',
    team: row.team != null ? String(row.team) : '',
    meta: metaOut || undefined,
  };
}

function numOpt(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

/**
 * Server-side payroll preview using shared calculator.
 * Body: { baseSalary, payrollConfig?, payrollInputs?, lateMinutes?, lateCount?, unpaidLeaveDays?,
 *         allowances?, deductionLines?, salaryRecordId? }
 * When salaryRecordId is set, loads base_salary, payroll_inputs_json, and lines if allowances/deductionLines omitted.
 */
async function previewFlexiblePayroll(operatorId, body) {
  const oid = String(operatorId || '').trim();
  if (!oid) throw Object.assign(new Error('MISSING_OPERATOR_ID'), { code: 'MISSING_OPERATOR_ID' });

  const settings = await getSalarySettings(oid);
  const cfg = normalizePayrollDefaults({
    ...(settings.payrollDefaults || {}),
    ...(body?.payrollConfig && typeof body.payrollConfig === 'object' && !Array.isArray(body.payrollConfig)
      ? body.payrollConfig
      : {}),
  });

  let allowances = Array.isArray(body?.allowances) ? body.allowances : [];
  let deductionLines = Array.isArray(body?.deductionLines) ? body.deductionLines : [];
  let baseSalary = Math.max(0, numOpt(body?.baseSalary, 0));
  let lateMinutes = numOpt(body?.lateMinutes, 0);
  let lateCount = numOpt(body?.lateCount, 0);
  let unpaidLeaveDays = numOpt(body?.unpaidLeaveDays, 0);

  const piBody = body?.payrollInputs && typeof body.payrollInputs === 'object' ? body.payrollInputs : {};
  if (body?.lateMinutes === undefined && piBody.lateMinutes != null) lateMinutes = numOpt(piBody.lateMinutes, 0);
  if (body?.lateCount === undefined && piBody.lateCount != null) lateCount = numOpt(piBody.lateCount, 0);
  if (body?.unpaidLeaveDays === undefined && piBody.unpaidLeaveDays != null) {
    unpaidLeaveDays = numOpt(piBody.unpaidLeaveDays, 0);
  }

  const rid = String(body?.salaryRecordId || '').trim();
  if (rid) {
    const ok = await salaryTablesExist();
    if (!ok) throw Object.assign(new Error('SALARY_TABLES_MISSING'), { code: 'SALARY_TABLES_MISSING' });
    const [[rec]] = await pool.query(
      `SELECT base_salary, payroll_inputs_json FROM cln_salary_record WHERE id = ? AND operator_id = ? LIMIT 1`,
      [rid, oid]
    );
    if (!rec) throw Object.assign(new Error('RECORD_NOT_FOUND'), { code: 'RECORD_NOT_FOUND' });

    if (!(body?.baseSalary !== undefined)) baseSalary = Math.max(0, Number(rec.base_salary || 0));
    const piDb = parseJsonObject(rec.payroll_inputs_json) || {};
    if (body?.lateMinutes === undefined && piBody.lateMinutes === undefined) lateMinutes = numOpt(piDb.lateMinutes, lateMinutes);
    if (body?.lateCount === undefined && piBody.lateCount === undefined) lateCount = numOpt(piDb.lateCount, lateCount);
    if (body?.unpaidLeaveDays === undefined && piBody.unpaidLeaveDays === undefined) {
      unpaidLeaveDays = numOpt(piDb.unpaidLeaveDays, unpaidLeaveDays);
    }

    if (!allowances.length || !deductionLines.length) {
      const [lineRows] = await pool.query(
        `SELECT line_kind, label, amount, meta_json FROM cln_salary_line WHERE salary_record_id = ? ORDER BY sort_order ASC, created_at ASC`,
        [rid]
      );
      const fromA = [];
      const fromD = [];
      for (const ln of lineRows || []) {
        const kind = String(ln.line_kind || '').toLowerCase();
        const meta = parseJsonObject(ln.meta_json) || {};
        if (!lineIncludedInPayroll(meta)) continue;
        if (kind === 'allowance') {
          const at = meta.allowanceType === 'conditional' ? 'conditional' : 'fixed';
          const row = {
            name: ln.label != null ? String(ln.label) : 'Allowance',
            amount: Math.max(0, Number(ln.amount || 0)),
            allowanceType: at,
          };
          if (meta.conditionalPolicy === 'none' || meta.conditionalPolicy === 'attendance_style') {
            row.conditionalPolicy = meta.conditionalPolicy;
          }
          fromA.push(row);
        } else {
          fromD.push({
            name: ln.label != null ? String(ln.label) : 'Deduction',
            amount: Math.max(0, Number(ln.amount || 0)),
          });
        }
      }
      if (!allowances.length) allowances = fromA;
      if (!deductionLines.length) deductionLines = fromD;
    }
  }

  const result = computeMalaysiaFlexPayroll(
    {
      basicSalary: baseSalary,
      lateMinutes,
      lateCount,
      unpaidLeaveDays,
      allowances,
      deductionLines,
    },
    cfg
  );
  return result;
}

async function deleteSalaryLine(operatorId, lineId) {
  const oid = String(operatorId || '').trim();
  if (!oid) throw Object.assign(new Error('MISSING_OPERATOR_ID'), { code: 'MISSING_OPERATOR_ID' });
  const ok = await salaryTablesExist();
  if (!ok) throw Object.assign(new Error('SALARY_TABLES_MISSING'), { code: 'SALARY_TABLES_MISSING' });
  const lid = String(lineId || '').trim();
  const [[row]] = await pool.query(
    `SELECT l.salary_record_id FROM cln_salary_line l
     INNER JOIN cln_salary_record r ON r.id = l.salary_record_id
     WHERE l.id = ? AND r.operator_id = ? LIMIT 1`,
    [lid, oid]
  );
  if (!row) return false;
  const rid = row.salary_record_id;
  const [res] = await pool.query(
    `DELETE l FROM cln_salary_line l
     INNER JOIN cln_salary_record r ON r.id = l.salary_record_id
     WHERE l.id = ? AND r.operator_id = ? LIMIT 1`,
    [lid, oid]
  );
  const deleted = Number(res.affectedRows || 0) > 0;
  if (deleted) await syncRecordNetSalaryFromPayroll(oid, rid);
  return deleted;
}

async function patchSalaryRecordStatus(operatorId, recordId, status) {
  const oid = String(operatorId || '').trim();
  if (!oid) throw Object.assign(new Error('MISSING_OPERATOR_ID'), { code: 'MISSING_OPERATOR_ID' });
  const ok = await salaryTablesExist();
  if (!ok) throw Object.assign(new Error('SALARY_TABLES_MISSING'), { code: 'SALARY_TABLES_MISSING' });
  const st = ['void', 'archived'].includes(String(status)) ? String(status) : null;
  if (!st) throw Object.assign(new Error('INVALID_STATUS'), { code: 'INVALID_STATUS' });
  await pool.query(
    `UPDATE cln_salary_record SET status = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND operator_id = ? LIMIT 1`,
    [st, String(recordId), oid]
  );
  const [[r]] = await pool.query(`SELECT * FROM cln_salary_record WHERE id = ? LIMIT 1`, [String(recordId)]);
  return r ? mapRecordRow(r) : null;
}

/**
 * Dr Salary & Wages, Cr Salary Control — net pay accrual (MYR).
 * @param {string} [journalDate] YYYY-MM-DD journal entry date (from UI); else last day of salary period.
 */
async function syncSalaryRecordsToBukku(operatorId, recordIds, journalDate) {
  const oid = String(operatorId || '').trim();
  if (!oid) return { ok: false, reason: 'MISSING_OPERATOR_ID' };
  const ok = await salaryTablesExist();
  if (!ok) return { ok: false, reason: 'SALARY_TABLES_MISSING' };
  const ids = Array.isArray(recordIds) ? recordIds.map((x) => String(x).trim()).filter(Boolean) : [];
  if (!ids.length) return { ok: false, reason: 'NO_IDS' };

  const creds = await clnInt.getBukkuCredentials(oid);
  if (!creds?.token || !creds?.subdomain) return { ok: false, reason: 'BUKKU_NOT_CONNECTED' };
  const req = bukkuReq(oid, creds);
  const system = 'bukku';

  const expenseId = await resolveMappedAccountId(oid, 'Salary & Wages', system);
  const controlId = await resolveMappedAccountId(oid, 'Salary Control', system);
  if (!expenseId || !controlId) {
    return { ok: false, reason: 'BUKKU_ACCOUNT_MAPPING_MISSING', detail: 'Map Salary & Wages and Salary Control in Accounting' };
  }

  const results = [];
  for (const id of ids) {
    const [[row]] = await pool.query(
      `SELECT * FROM cln_salary_record WHERE id = ? AND operator_id = ? LIMIT 1`,
      [id, oid]
    );
    if (!row) {
      results.push({ id, ok: false, reason: 'NOT_FOUND' });
      continue;
    }
    if (['void', 'archived'].includes(row.status)) {
      results.push({ id, ok: false, reason: 'INVALID_STATUS' });
      continue;
    }
    if (row.bukku_journal_id) {
      results.push({ id, ok: true, skipped: true, journalId: String(row.bukku_journal_id) });
      continue;
    }
    const net = Math.max(0, Number(row.net_salary || 0));
    if (net <= 0) {
      results.push({ id, ok: false, reason: 'INVALID_AMOUNT' });
      continue;
    }
    const jeDate =
      journalDate != null && String(journalDate).trim() !== '' && /^\d{4}-\d{2}-\d{2}$/.test(String(journalDate).trim())
        ? String(journalDate).trim().slice(0, 10)
        : ymdLastOfMonth(row.period);
    const desc = `Salary accrual ${row.period} · ${String(row.employee_label || '').slice(0, 120)}`.slice(0, 255);
    const items = [
      {
        line: 1,
        account_id: expenseId,
        description: desc,
        debit_amount: net,
        credit_amount: null,
        tax_code_id: null
      },
      {
        line: 2,
        account_id: controlId,
        description: desc,
        debit_amount: null,
        credit_amount: net,
        tax_code_id: null
      }
    ];
    const payload = {
      currency_code: DEFAULT_CURRENCY,
      date: jeDate,
      description: desc,
      exchange_rate: 1,
      journal_items: items,
      status: 'ready'
    };
    try {
      const res = await bukkuJournal.create(req, payload);
      if (!res || res.ok === false) {
        results.push({
          id,
          ok: false,
          reason: 'BUKKU_JOURNAL_FAILED',
          detail: typeof res?.error === 'string' ? res.error : JSON.stringify(res?.error || {})
        });
        continue;
      }
      const data = res.data;
      const jid =
        data?.id != null
          ? String(data.id)
          : data?.transaction?.id != null
            ? String(data.transaction.id)
            : data?.journal_entry?.id != null
              ? String(data.journal_entry.id)
              : null;
      if (!jid) {
        results.push({ id, ok: false, reason: 'BUKKU_JOURNAL_NO_ID' });
        continue;
      }
      await pool.query(
        `UPDATE cln_salary_record SET bukku_journal_id = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND operator_id = ? LIMIT 1`,
        [jid, id, oid]
      );
      results.push({ id, ok: true, journalId: jid });
    } catch (e) {
      results.push({ id, ok: false, reason: e?.message || 'BUKKU_JOURNAL_FAILED' });
    }
  }
  const allOk = results.every((r) => r.ok);
  return { ok: allOk, results, provider: 'bukku' };
}

/**
 * Dr Salary & Wages, Cr Salary Control — net pay accrual in Xero (LineAmount: negative = debit).
 */
async function syncSalaryRecordsToXero(operatorId, recordIds, journalDate) {
  const oid = String(operatorId || '').trim();
  if (!oid) return { ok: false, reason: 'MISSING_OPERATOR_ID' };
  const ok = await salaryTablesExist();
  if (!ok) return { ok: false, reason: 'SALARY_TABLES_MISSING' };
  const ids = Array.isArray(recordIds) ? recordIds.map((x) => String(x).trim()).filter(Boolean) : [];
  if (!ids.length) return { ok: false, reason: 'NO_IDS' };

  const req = xeroReq(oid);
  const system = 'xero';
  const expenseRaw = await resolveMappedAccountExternal(oid, 'Salary & Wages', system);
  const controlRaw = await resolveMappedAccountExternal(oid, 'Salary Control', system);
  if (!expenseRaw || !controlRaw) {
    return {
      ok: false,
      reason: 'XERO_ACCOUNT_MAPPING_MISSING',
      detail: 'Map Salary & Wages and Salary Control in Accounting (Xero)'
    };
  }
  const expenseCode = await resolveXeroAccountCode(req, expenseRaw);
  const controlCode = await resolveXeroAccountCode(req, controlRaw);
  if (!expenseCode || !controlCode) {
    return {
      ok: false,
      reason: 'XERO_ACCOUNT_CODE_REQUIRED',
      detail: 'Could not resolve Xero account codes for Salary & Wages / Salary Control'
    };
  }

  const results = [];
  for (const id of ids) {
    const [[row]] = await pool.query(
      `SELECT * FROM cln_salary_record WHERE id = ? AND operator_id = ? LIMIT 1`,
      [id, oid]
    );
    if (!row) {
      results.push({ id, ok: false, reason: 'NOT_FOUND' });
      continue;
    }
    if (['void', 'archived'].includes(row.status)) {
      results.push({ id, ok: false, reason: 'INVALID_STATUS' });
      continue;
    }
    if (row.xero_manual_journal_id) {
      results.push({ id, ok: true, skipped: true, manualJournalId: String(row.xero_manual_journal_id) });
      continue;
    }
    const net = Math.max(0, Number(row.net_salary || 0));
    if (net <= 0) {
      results.push({ id, ok: false, reason: 'INVALID_AMOUNT' });
      continue;
    }
    const jeDate =
      journalDate != null && String(journalDate).trim() !== '' && /^\d{4}-\d{2}-\d{2}$/.test(String(journalDate).trim())
        ? String(journalDate).trim().slice(0, 10)
        : ymdLastOfMonth(row.period);
    const desc = `Salary accrual ${row.period} · ${String(row.employee_label || '').slice(0, 120)}`.slice(0, 255);
    const payload = {
      Narration: desc,
      Date: jeDate,
      JournalLines: [
        { Description: desc, LineAmount: -net, AccountCode: expenseCode },
        { Description: desc, LineAmount: net, AccountCode: controlCode }
      ]
    };
    try {
      const res = await xeroManualJournal.create(req, payload);
      if (!res || !res.ok) {
        results.push({
          id,
          ok: false,
          reason: 'XERO_MANUAL_JOURNAL_FAILED',
          detail: formatXeroErr(res?.error)
        });
        continue;
      }
      const journals = res.data?.ManualJournals;
      const first = Array.isArray(journals) && journals[0] ? journals[0] : null;
      const jid = first?.ManualJournalID || first?.ManualJournalId || first?.id || null;
      if (!jid) {
        results.push({ id, ok: false, reason: 'XERO_MANUAL_JOURNAL_NO_ID' });
        continue;
      }
      await pool.query(
        `UPDATE cln_salary_record SET xero_manual_journal_id = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND operator_id = ? LIMIT 1`,
        [String(jid), id, oid]
      );
      results.push({ id, ok: true, manualJournalId: String(jid) });
    } catch (e) {
      results.push({ id, ok: false, reason: e?.message || 'XERO_MANUAL_JOURNAL_FAILED' });
    }
  }
  const allOk = results.every((r) => r.ok);
  return { ok: allOk, results, provider: 'xero' };
}

async function syncSalaryRecordsToAccounting(operatorId, recordIds, journalDate) {
  const provider = await getClnAddonAccountProvider(String(operatorId || '').trim());
  if (provider === 'bukku') return syncSalaryRecordsToBukku(operatorId, recordIds, journalDate);
  if (provider === 'xero') return syncSalaryRecordsToXero(operatorId, recordIds, journalDate);
  return { ok: false, reason: 'NO_ACCOUNTING_PROVIDER', provider: provider || null };
}

async function markSalaryRecordsPaid(operatorId, recordIds, paymentDate, paymentMethod) {
  const oid = String(operatorId || '').trim();
  if (!oid) return { ok: false, reason: 'MISSING_OPERATOR_ID' };
  const ok = await salaryTablesExist();
  if (!ok) return { ok: false, reason: 'SALARY_TABLES_MISSING' };
  const ids = Array.isArray(recordIds) ? recordIds.map((x) => String(x).trim()).filter(Boolean) : [];
  if (!ids.length) return { ok: false, reason: 'NO_IDS' };
  const pd = String(paymentDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pd)) return { ok: false, reason: 'INVALID_DATE' };
  const pm = String(paymentMethod || 'bank_transfer').trim().slice(0, 32);
  const provider = await getClnAddonAccountProvider(oid);
  const bukkuCreds = provider === 'bukku' ? await clnInt.getBukkuCredentials(oid) : null;
  const bukkuReqHttp = bukkuCreds?.token && bukkuCreds?.subdomain ? bukkuReq(oid, bukkuCreds) : null;
  const xeroHttpReq = provider === 'xero' ? xeroReq(oid) : null;

  const results = [];
  for (const id of ids) {
    const [[row]] = await pool.query(`SELECT * FROM cln_salary_record WHERE id = ? AND operator_id = ? LIMIT 1`, [id, oid]);
    if (!row) {
      results.push({ id, ok: false, reason: 'NOT_FOUND' });
      continue;
    }
    if (['void', 'archived', 'complete'].includes(row.status)) {
      results.push({ id, ok: false, reason: 'INVALID_STATUS' });
      continue;
    }

    if (provider === 'bukku') {
      if (!row.bukku_journal_id) {
        results.push({ id, ok: false, reason: 'NOT_SYNCED' });
        continue;
      }
      if (row.bukku_expense_id) {
        await pool.query(
          `UPDATE cln_salary_record SET status = 'complete', payment_method = ?, paid_date = ?, updated_at = CURRENT_TIMESTAMP(3)
           WHERE id = ? AND operator_id = ? LIMIT 1`,
          [pm, pd, id, oid]
        );
        results.push({ id, ok: true, skipped: true, expenseId: String(row.bukku_expense_id) });
        continue;
      }
    } else if (provider === 'xero') {
      if (!row.xero_manual_journal_id) {
        results.push({ id, ok: false, reason: 'NOT_SYNCED' });
        continue;
      }
      if (row.xero_bank_transaction_id) {
        await pool.query(
          `UPDATE cln_salary_record SET status = 'complete', payment_method = ?, paid_date = ?, updated_at = CURRENT_TIMESTAMP(3)
           WHERE id = ? AND operator_id = ? LIMIT 1`,
          [pm, pd, id, oid]
        );
        results.push({ id, ok: true, skipped: true, bankTransactionId: String(row.xero_bank_transaction_id) });
        continue;
      }
    } else {
      results.push({ id, ok: false, reason: 'NO_ACCOUNTING_PROVIDER' });
      continue;
    }

    const net = Math.max(0, Number(row.net_salary || 0));
    if (net <= 0) {
      results.push({ id, ok: false, reason: 'INVALID_AMOUNT' });
      continue;
    }

    let expenseIdOut = null;
    let bankTxnIdOut = null;

    if (provider === 'bukku') {
      if (!bukkuReqHttp) {
        results.push({ id, ok: false, reason: 'BUKKU_NOT_CONNECTED' });
        continue;
      }
      const system = 'bukku';
      const salaryControlId = await resolveMappedAccountId(oid, 'Salary Control', system);
      const payMethodKey = pm.toLowerCase() === 'cash' ? 'cash' : 'bank';
      const payFromTitle = payMethodKey === 'cash' ? 'Cash' : 'Bank';
      const bankAccountId = await resolveMappedAccountId(oid, payFromTitle, system);
      if (!salaryControlId || !bankAccountId) {
        results.push({
          id,
          ok: false,
          reason: 'BUKKU_ACCOUNT_MAPPING_MISSING',
          detail: 'Map Salary Control and Bank/Cash in Accounting'
        });
        continue;
      }
      const desc = `Net salary ${row.period} · ${String(row.employee_label || '').slice(0, 120)}`.slice(0, 255);
      const payloadB = {
        date: pd,
        currency_code: DEFAULT_CURRENCY,
        exchange_rate: 1,
        tax_mode: 'exclusive',
        description: desc,
        remarks: `Salary payout · ${pm}`.slice(0, 255),
        bank_items: [
          {
            line: 1,
            account_id: salaryControlId,
            description: desc,
            amount: net,
            tax_code_id: null
          }
        ],
        deposit_items: [{ account_id: bankAccountId, amount: net }],
        status: 'ready'
      };
      try {
        const res = await bukkuBankingExpense.create(bukkuReqHttp, payloadB);
        const eid =
          res?.data?.transaction?.id ?? res?.data?.id ?? res?.id ?? res?.data?.transaction_id ?? null;
        if (res?.ok !== true || eid == null || String(eid).trim() === '') {
          results.push({
            id,
            ok: false,
            reason: 'BUKKU_MONEY_OUT_FAILED',
            detail: typeof res?.error === 'string' ? res.error : JSON.stringify(res?.error || {})
          });
          continue;
        }
        expenseIdOut = String(eid);
      } catch (e) {
        results.push({ id, ok: false, reason: e?.message || 'BUKKU_MONEY_OUT_FAILED' });
        continue;
      }
    } else if (provider === 'xero' && xeroHttpReq) {
      const salaryControlRaw = await resolveMappedAccountExternal(oid, 'Salary Control', 'xero');
      if (!salaryControlRaw) {
        results.push({
          id,
          ok: false,
          reason: 'XERO_ACCOUNT_MAPPING_MISSING',
          detail: 'Map Salary Control in Accounting (Xero)'
        });
        continue;
      }
      const payMethodKey = pm.toLowerCase() === 'cash' ? 'cash' : 'bank';
      const payFromTitle = payMethodKey === 'cash' ? 'Cash' : 'Bank';
      const bankRaw = await resolveMappedAccountExternal(oid, payFromTitle, 'xero');
      const mappedPayFromCode = bankRaw ? await resolveXeroAccountCode(xeroHttpReq, bankRaw) : '';
      const envDefault = String(process.env.XERO_DEFAULT_BANK_ACCOUNT_CODE || '').trim();
      const bankRef = await findXeroBankAccountRef(xeroHttpReq, [bankRaw, mappedPayFromCode, envDefault]);
      if (!bankRef) {
        results.push({
          id,
          ok: false,
          reason: 'NO_XERO_BANK_ACCOUNT',
          detail: 'Map Bank/Cash in Accounting or set XERO_DEFAULT_BANK_ACCOUNT_CODE'
        });
        continue;
      }
      const ctrlLine = await resolveXeroInvoiceLineItemAccount(xeroHttpReq, salaryControlRaw);
      if (!ctrlLine) {
        results.push({ id, ok: false, reason: 'XERO_ACCOUNT_CODE_REQUIRED', detail: 'Salary Control' });
        continue;
      }
      const desc = `Net salary ${row.period} · ${String(row.employee_label || '').slice(0, 120)}`.slice(0, 255);
      const lineItem = {
        Description: desc.slice(0, 500),
        Quantity: 1,
        UnitAmount: net,
        ...ctrlLine
      };
      const payloadX = {
        Type: 'SPEND',
        Contact: { Name: String(row.employee_label || 'Employee').slice(0, 255) },
        BankAccount: bankRef,
        Date: pd,
        Reference: desc.slice(0, 255),
        LineItems: [lineItem]
      };
      try {
        const res = await xeroBankTransaction.createBankTransaction(xeroHttpReq, payloadX);
        if (!res || !res.ok) {
          results.push({
            id,
            ok: false,
            reason: 'XERO_MONEY_OUT_FAILED',
            detail: formatXeroErr(res?.error)
          });
          continue;
        }
        const bt = res.data?.BankTransactions?.[0];
        const xid = bt?.BankTransactionID ?? bt?.BankTransactionId;
        if (!xid) {
          results.push({ id, ok: false, reason: 'XERO_BANK_TXN_ID_MISSING' });
          continue;
        }
        bankTxnIdOut = String(xid);
      } catch (e) {
        results.push({ id, ok: false, reason: e?.message || 'XERO_MONEY_OUT_FAILED' });
        continue;
      }
    }

    if (provider === 'bukku') {
      await pool.query(
        `UPDATE cln_salary_record SET status = 'complete', payment_method = ?, paid_date = ?,
                bukku_expense_id = COALESCE(?, bukku_expense_id), updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ? AND operator_id = ? LIMIT 1`,
        [pm, pd, expenseIdOut, id, oid]
      );
      results.push({ id, ok: true, expenseId: expenseIdOut || undefined });
    } else {
      await pool.query(
        `UPDATE cln_salary_record SET status = 'complete', payment_method = ?, paid_date = ?,
                xero_bank_transaction_id = COALESCE(?, xero_bank_transaction_id), updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ? AND operator_id = ? LIMIT 1`,
        [pm, pd, bankTxnIdOut, id, oid]
      );
      results.push({ id, ok: true, bankTransactionId: bankTxnIdOut || undefined });
    }
  }
  return { ok: results.every((r) => r.ok), results, provider: provider || undefined };
}

const EMPLOYEE_ROLES = new Set(['staff', 'driver', 'dobi', 'supervisor']);

function isSalaryEligibleContact(c) {
  if (!c || typeof c !== 'object') return false;
  if (String(c.status || '').toLowerCase() !== 'active') return false;
  if (String(c.contactSource || '').toLowerCase() === 'employee') return true;
  const perms = Array.isArray(c.permissions) ? c.permissions.map((x) => String(x).toLowerCase()) : [];
  return perms.some((p) => EMPLOYEE_ROLES.has(p));
}

/**
 * Create salary rows for the period from operator contacts (active employees only).
 * Skips archived/resigned; skips B2B client-only rows. Idempotent: by sourceContactId / email / name.
 */
async function syncSalaryRecordsFromContacts(operatorId, period, contactItems) {
  const oid = String(operatorId || '').trim();
  const p = String(period || '').trim();
  if (!oid || !/^\d{4}-\d{2}$/.test(p)) {
    throw Object.assign(new Error('INVALID_PARAMS'), { code: 'INVALID_PARAMS' });
  }
  const ok = await salaryTablesExist();
  if (!ok) throw Object.assign(new Error('SALARY_TABLES_MISSING'), { code: 'SALARY_TABLES_MISSING' });

  const items = Array.isArray(contactItems) ? contactItems : [];
  const eligible = items.filter(isSalaryEligibleContact);

  const [existingRows] = await pool.query(
    `SELECT id, employee_label, payroll_inputs_json FROM cln_salary_record WHERE operator_id = ? AND period = ?`,
    [oid, p]
  );

  const byContactId = new Set();
  const byEmail = new Set();
  const labelsTaken = new Set();
  for (const row of existingRows || []) {
    const pi = parseJsonObject(row.payroll_inputs_json);
    if (pi?.sourceContactId) byContactId.add(String(pi.sourceContactId).trim());
    if (pi?.sourceContactEmail) byEmail.add(String(pi.sourceContactEmail).trim().toLowerCase());
    const lab = String(row.employee_label || '')
      .trim()
      .toLowerCase();
    if (lab) labelsTaken.add(lab);
  }

  let created = 0;
  for (const c of eligible) {
    const cid = String(c.id || '').trim();
    const email = String(c.email || '')
      .trim()
      .toLowerCase();
    const name = String(c.name || '').trim() || 'Staff';
    const nameKey = name.toLowerCase();

    if (cid && byContactId.has(cid)) continue;
    if (email && byEmail.has(email)) continue;
    if (labelsTaken.has(nameKey)) continue;

    const team = String(c.team ?? '').trim();
    const base = Math.max(0, Number(c.salaryBasic) || 0);
    const payrollInputs = {};
    if (cid) payrollInputs.sourceContactId = cid;
    if (email) payrollInputs.sourceContactEmail = email;

    await createSalaryRecord(oid, {
      period: p,
      team,
      employeeLabel: name,
      baseSalary: base,
      netSalary: base,
      payrollInputs: Object.keys(payrollInputs).length ? payrollInputs : undefined
    });
    created += 1;
    if (cid) byContactId.add(cid);
    if (email) byEmail.add(email);
    labelsTaken.add(nameKey);
  }

  return {
    ok: true,
    created,
    skipped: Math.max(0, eligible.length - created),
    eligible: eligible.length
  };
}

module.exports = {
  listOperatorSalaries,
  getSalarySettings,
  saveSalarySettings,
  createSalaryRecord,
  updateSalaryRecord,
  listSalaryLines,
  addSalaryLine,
  updateSalaryLine,
  deleteSalaryLine,
  patchSalaryRecordStatus,
  syncSalaryRecordsToBukku,
  syncSalaryRecordsToXero,
  syncSalaryRecordsToAccounting,
  markSalaryRecordsPaid,
  previewFlexiblePayroll,
  syncSalaryRecordsFromContacts,
};
