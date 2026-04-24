/**
 * Generate Report (Owner Report / OwnerPayout) – migrated from Wix backend/tenancy/ownerreport.jsw.
 * Uses MySQL: ownerpayout, propertydetail, rentalcollection (type_id→account), account, metertransaction, bills, tenancy, roomdetail.
 * All operations scoped by client_id from access context (staff email → client).
 */

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const pool = require('../../config/db');
const { google } = require('googleapis');
const { getOAuth2ClientForClient } = require('../companysetting/google-drive-oauth.service');
const { buildOwnerReportPdfBuffer } = require('./generatereport-pdf');
const {
  malaysiaDateToUtcDatetimeForDb,
  utcDatetimeFromDbToMalaysiaDateOnly,
  utcDatetimeFromDbToMalaysiaDate,
  malaysiaDateRangeToUtcForQuery,
  getTodayMalaysiaDate
} = require('../../utils/dateMalaysia');

/** Extract Google Drive folder ID from URL or return as-is if already an ID. */
function extractFolderId(urlOrId) {
  if (!urlOrId || typeof urlOrId !== 'string') return null;
  const s = urlOrId.trim();
  if (/^[\w-]{25,}$/.test(s)) return s;
  const m = s.match(/[-\w]{25,}/);
  return m ? m[0] : null;
}

let _warnedMissingGoogleApplicationCredentialsFile = false;

function getServiceAccountDriveAuth() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (keyJson) {
    try {
      const key = typeof keyJson === 'string' ? JSON.parse(keyJson) : keyJson;
      return new google.auth.GoogleAuth({
        credentials: key,
        scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/drive.file']
      });
    } catch (e) {
      return null;
    }
  }
  const keyPath = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
  if (keyPath) {
    if (!fs.existsSync(keyPath)) {
      if (!_warnedMissingGoogleApplicationCredentialsFile) {
        _warnedMissingGoogleApplicationCredentialsFile = true;
        console.warn(
          '[generatereport] GOOGLE_APPLICATION_CREDENTIALS file missing; ignoring:',
          keyPath
        );
      }
      return null;
    }
    return new google.auth.GoogleAuth({
      keyFile: keyPath,
      scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/drive.file']
    });
  }
  return null;
}

/**
 * Prefer operator-connected OAuth Drive account (client-level integration),
 * fallback to service account env credentials.
 */
async function getDriveAuthForClient(clientId) {
  try {
    const oauth = clientId ? await getOAuth2ClientForClient(clientId) : null;
    if (oauth) return { auth: oauth, source: 'oauth' };
  } catch (_) {}
  const sa = getServiceAccountDriveAuth();
  if (sa) return { auth: sa, source: 'service_account' };
  return { auth: null, source: null };
}

/**
 * rentalcollection.type_id → account.id 对应关系（table account 的 title 与 payout 表归属）
 *
 * 逻辑：用 rentalcollection 的 type_id 去 table account 查 id，按 account.title 决定：
 *
 * | account.id (type_id) | account.title        | 放入 table | 归类     |
 * |----------------------|----------------------|------------|----------|
 * | rentalIncomeId       | Rental Income        | 是         | INCOME   |
 * | forfeitDepositId     | Forfeit Deposit      | 是         | INCOME   |
 * | ownerCommissionId    | Owner Comission      | 是         | EXPENSES |
 * | agreementFeesId      | Agreement Fees       | 否         | -        |
 * | depositId            | Deposit              | 否         | -        |
 * | tenantCommissionId   | Tenant Commission    | 否         | -        |
 * | managementFeesId     | Management Fees      | 可选       | 由报表设置归类（非下方结算行「Management Fees (x%)」） |
 * | (未在 account 中)     | -                    | 是         | INCOME   |
 */
const TYPE_AGREEMENT_FEES = 'Agreement Fees';
const TYPE_OWNER_COMMISSION = 'Owner Comission'; // typo kept to match Wix
const TYPE_RENTAL_INCOME = 'Rental Income';
const TYPE_FORFEIT_DEPOSIT = 'Forfeit Deposit';
const TYPE_DEPOSIT = 'Deposit';
const TYPE_TENANT_COMMISSION = 'Tenant Commission';
const TYPE_PARKING_FEES = 'Parking Fees';
/** Tenant invoice line type (account); not the settlement summary row generated from property %. */
const TYPE_MANAGEMENT_FEES = 'Management Fees';

/** Canonical keys for owner-report invoice / collection classification (operatordetail.admin.reportSettings.ownerReport). */
const REPORT_CLASSIFICATION_KEYS = [
  'rental_income',
  'forfeit_deposit',
  'parking_fees',
  'deposit',
  'agreement_fees',
  'tenant_commission',
  'owner_commission',
  'management_fees',
  'meter_topup'
];

function normalizeReportClassificationKeys(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  const seen = new Set();
  for (const x of arr) {
    const k = String(x || '')
      .trim()
      .toLowerCase()
      .replace(/-/g, '_');
    if (!REPORT_CLASSIFICATION_KEYS.includes(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

function standardReportIncomeKeys() {
  return new Set(['rental_income', 'forfeit_deposit', 'parking_fees', 'meter_topup']);
}

function standardReportExpenseKeys() {
  return new Set(['owner_commission']);
}

/**
 * Load income/expense sets for generateOwnerPayout. Standard matches legacy hardcoded behaviour.
 */
async function getOwnerReportClassificationSets(clientId) {
  const [rows] = await pool.query('SELECT admin FROM operatordetail WHERE id = ? LIMIT 1', [clientId]);
  if (!rows.length) {
    return { mode: 'standard', income: standardReportIncomeKeys(), expense: standardReportExpenseKeys() };
  }
  let admin = rows[0].admin;
  if (typeof admin === 'string') {
    try {
      admin = JSON.parse(admin || '{}');
    } catch {
      admin = {};
    }
  }
  admin = admin && typeof admin === 'object' ? admin : {};
  const reportRaw = admin.reportSettings && typeof admin.reportSettings === 'object' ? admin.reportSettings : {};
  const ownerRaw = reportRaw.ownerReport && typeof reportRaw.ownerReport === 'object' ? reportRaw.ownerReport : {};
  const mode = ownerRaw.reportClassificationMode === 'customize' ? 'customize' : 'standard';
  let income = standardReportIncomeKeys();
  let expense = standardReportExpenseKeys();
  if (mode === 'customize') {
    const inc = normalizeReportClassificationKeys(ownerRaw.reportIncomeKeys);
    const exp = normalizeReportClassificationKeys(ownerRaw.reportExpenseKeys);
    if (inc.length > 0 || exp.length > 0) {
      income = new Set(inc);
      expense = new Set(exp);
      for (const k of income) expense.delete(k);
    }
  }
  return { mode, income, expense };
}

/**
 * List properties for client (for GR repeater and report filter dropdown).
 * @param {string} clientId
 * @returns {Promise<{ items: Array<{ id, shortname }> }>}
 */
async function getPropertiesForClient(clientId) {
  const [rows] = await pool.query(
    'SELECT id, shortname FROM propertydetail WHERE client_id = ? AND COALESCE(archived, 0) = 0 ORDER BY shortname ASC',
    [clientId]
  );
  return {
    items: rows.map(r => ({
      id: String(r.id),
      _id: String(r.id),
      shortname: r.shortname != null ? String(r.shortname) : ''
    }))
  };
}

/**
 * Resolve client_id from email (staff) for access scope.
 * @param {string} email
 * @returns {Promise<{ ok: boolean, clientId?: string, reason?: string }>}
 */
async function getClientIdByEmail(email) {
  const [rows] = await pool.query(
    'SELECT client_id FROM staffdetail WHERE LOWER(TRIM(email)) = ? AND status = 1 LIMIT 1',
    [String(email).toLowerCase().trim()]
  );
  if (!rows.length || !rows[0].client_id) {
    return { ok: false, reason: 'NOT_AUTHENTICATED' };
  }
  return { ok: true, clientId: rows[0].client_id };
}

const REPORT_CACHE_LIMIT = 2000;

/**
 * List owner reports (OwnerPayout) with filter, sort, pagination.
 * @param {string} clientId
 * @param {Object} params - { property, from, to, search, sort, type (ALL|PAID|UNPAID), page, pageSize, limit? }
 *   limit: when set, return one page with up to min(limit, REPORT_CACHE_LIMIT) items (for frontend cache); totalCount still full count.
 */
async function getOwnerReports(clientId, params = {}) {
  const useLimit = params.limit != null && parseInt(params.limit, 10) > 0;
  const page = useLimit ? 1 : Math.max(1, parseInt(params.page, 10) || 1);
  const pageSize = useLimit
    ? Math.min(REPORT_CACHE_LIMIT, Math.max(1, parseInt(params.limit, 10)))
    : Math.min(100, Math.max(1, parseInt(params.pageSize, 10) || 10));
  const offset = (page - 1) * pageSize;

  const conditions = ['o.client_id = ?'];
  const queryParams = [clientId];

  if (params.property && params.property !== 'ALL') {
    conditions.push('o.property_id = ?');
    queryParams.push(params.property);
  }
  const fromStr = params.from && (typeof params.from === 'string' ? params.from.substring(0, 10) : null);
  const toStr = params.to && (typeof params.to === 'string' ? params.to.substring(0, 10) : null);
  const { fromUtc, toUtc } = malaysiaDateRangeToUtcForQuery(fromStr || null, toStr || null);
  if (fromUtc) {
    conditions.push('o.period >= ?');
    queryParams.push(fromUtc);
  }
  if (toUtc) {
    conditions.push('o.period <= ?');
    queryParams.push(toUtc);
  }
  if (params.search) {
    conditions.push('(o.title LIKE ? OR o.title IS NULL)');
    queryParams.push('%' + String(params.search).trim() + '%');
  }
  if (params.type === 'PAID') {
    conditions.push('o.paid = 1');
  } else if (params.type === 'UNPAID') {
    conditions.push('(o.paid IS NULL OR o.paid = 0)');
  }

  const whereSql = conditions.join(' AND ');

  let orderSql = 'ORDER BY o.period DESC';
  switch (String(params.sort || 'new')) {
    case 'old':
      orderSql = 'ORDER BY o.period ASC';
      break;
    case 'amountasc':
      orderSql = 'ORDER BY o.netpayout ASC';
      break;
    case 'amountdesc':
      orderSql = 'ORDER BY o.netpayout DESC';
      break;
    case 'az':
      orderSql = 'ORDER BY o.title ASC';
      break;
    case 'za':
      orderSql = 'ORDER BY o.title DESC';
      break;
    default:
      orderSql = 'ORDER BY o.period DESC';
  }

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM ownerpayout o WHERE ${whereSql}`,
    queryParams
  );
  const totalCount = Number(countRows[0]?.total || 0);
  const totalPages = useLimit ? Math.max(1, Math.ceil(totalCount / pageSize)) : Math.max(1, Math.ceil(totalCount / pageSize));

  const [rows] = await pool.query(
    `SELECT o.id, o.property_id, o.period, o.title, o.totalrental, o.totalutility, o.totalcollection,
            o.expenses, o.management_fee, o.netpayout, o.paid, o.monthlyreport, o.bukkuinvoice, o.bukkubills,
            o.accounting_status, o.payment_date, o.payment_method,
            p.shortname AS property_shortname
       FROM ownerpayout o
       LEFT JOIN propertydetail p ON p.id = o.property_id
       WHERE ${whereSql}
       ${orderSql}
       LIMIT ? OFFSET ?`,
    [...queryParams, pageSize, offset]
  );

  const items = rows.map(r => ({
    _id: r.id,
    property: r.property_id ? { _id: r.property_id, shortname: r.property_shortname || '' } : null,
    period: utcDatetimeFromDbToMalaysiaDate(r.period),
    title: r.title || '',
    totalrental: Number(r.totalrental || 0),
    totalutility: Number(r.totalutility || 0),
    totalcollection: Number(r.totalcollection || 0),
    expenses: Number(r.expenses || 0),
    managementfee: Number(r.management_fee || 0),
    netpayout: Number(r.netpayout || 0),
    paid: Boolean(r.paid),
    monthlyreport: r.monthlyreport || null,
    bukkuinvoice: r.bukkuinvoice || null,
    bukkubills: r.bukkubills || null,
    accountingStatus: r.accounting_status || null,
    paymentDate: r.payment_date || null,
    paymentMethod: r.payment_method || null
  }));

  return {
    success: true,
    items,
    totalCount,
    totalPages,
    currentPage: page
  };
}

/**
 * Get total netpayout and count for given report ids (for selected total display).
 */
async function getOwnerReportsTotal(clientId, ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return { total: 0, count: 0 };
  }
  const placeholders = ids.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT SUM(netpayout) AS total, COUNT(*) AS count FROM ownerpayout WHERE client_id = ? AND id IN (${placeholders})`,
    [clientId, ...ids]
  );
  return {
    total: Number(rows[0]?.total || 0),
    count: Number(rows[0]?.count || 0)
  };
}

/**
 * Get single owner report by id; must belong to client.
 */
async function getOwnerReport(clientId, id) {
  const [rows] = await pool.query(
    `SELECT o.id, o.property_id, o.period, o.title, o.totalrental, o.totalutility, o.totalcollection,
            o.expenses, o.management_fee, o.netpayout, o.paid, o.monthlyreport, o.bukkuinvoice, o.bukkubills,
            o.accounting_status, o.payment_date, o.payment_method,
            p.shortname AS property_shortname
       FROM ownerpayout o
       LEFT JOIN propertydetail p ON p.id = o.property_id
       WHERE o.id = ? AND o.client_id = ?`,
    [id, clientId]
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    _id: r.id,
    property: r.property_id ? { _id: r.property_id, shortname: r.property_shortname || '' } : null,
    period: utcDatetimeFromDbToMalaysiaDate(r.period),
    title: r.title || '',
    totalrental: Number(r.totalrental || 0),
    totalutility: Number(r.totalutility || 0),
    totalcollection: Number(r.totalcollection || 0),
    expenses: Number(r.expenses || 0),
    managementfee: Number(r.management_fee || 0),
    netpayout: Number(r.netpayout || 0),
    paid: Boolean(r.paid),
    monthlyreport: r.monthlyreport || null,
    bukkuinvoice: r.bukkuinvoice || null,
    bukkubills: r.bukkubills || null,
    accountingStatus: r.accounting_status || null,
    paymentDate: r.payment_date || null,
    paymentMethod: r.payment_method || null
  };
}

/**
 * Insert owner report (after generate payout). Enriches with property/client and optional title.
 */
async function insertOwnerReport(clientId, data) {
  const propertyId = data.property;
  if (!propertyId) throw new Error('PROPERTY_REQUIRED');

  const [propRows] = await pool.query(
    'SELECT id, shortname, percentage FROM propertydetail WHERE id = ? AND client_id = ?',
    [propertyId, clientId]
  );
  if (!propRows.length) throw new Error('CROSS_CLIENT_ACCESS');
  const property = propRows[0];

  let title = data.title;
  if (!title && data.period) {
    const d = new Date(data.period);
    const month = d.toLocaleString('default', { month: 'long' });
    title = `${month} ${d.getFullYear()} ${property.shortname || ''}`;
  }

  const id = randomUUID();
  const period = malaysiaDateToUtcDatetimeForDb(data.period || new Date());
  const totalrental = Number(data.totalrental || 0);
  const totalutility = Number(data.totalutility || 0);
  const totalcollection = Number(data.totalcollection || 0);
  const expenses = Number(data.expenses || 0);
  const managementFee = data.managementfee != null ? Number(data.managementfee) : null;
  const netpayout = Number(data.netpayout || 0);

  await pool.query(
    `INSERT INTO ownerpayout (id, client_id, property_id, period, title, totalrental, totalutility, totalcollection, expenses, management_fee, netpayout, monthlyreport, paid, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NOW(), NOW())`,
    [id, clientId, propertyId, period, title || null, totalrental, totalutility, totalcollection, expenses, managementFee, netpayout, data.monthlyreport || null]
  );

  const record = await getOwnerReport(clientId, id);
  return { success: true, record };
}

/**
 * Update owner report (safe merge). Disallow changing client_id / id.
 * When paid=true with paymentDate and paymentMethod, creates accounting: cash invoice (management fee) + cash bill (owner payout).
 */
function coerceMarkPaidPayload(changes) {
  const out = { ...changes };
  if (out.paid != null && out.paid !== true && out.paid !== false) {
    const s = String(out.paid).trim().toLowerCase();
    out.paid = s === 'true' || s === '1' || out.paid === 1;
  }
  return out;
}

async function updateOwnerReport(clientId, id, changes) {
  changes = coerceMarkPaidPayload(changes);
  const current = await getOwnerReport(clientId, id);
  if (!current) throw new Error('NOT_FOUND');

  const allowed = ['paid', 'accountingStatus', 'paymentDate', 'paymentMethod', 'carryNegativeToNextMonth', 'monthlyreport', 'status', 'title', 'bukkuinvoice', 'bukkubills'];
  const dbMap = {
    accountingStatus: 'accounting_status',
    paymentDate: 'payment_date',
    paymentMethod: 'payment_method',
    carryNegativeToNextMonth: 'carry_negative_to_next_month'
  };
  const setParts = [];
  const values = [];

  for (const [k, v] of Object.entries(changes)) {
    if (!allowed.includes(k)) continue;
    const col = dbMap[k] || k;
    if (k === 'paymentDate') {
      setParts.push('payment_date = ?');
      values.push(v ? new Date(v) : null);
    } else if (k === 'accountingStatus') {
      setParts.push('accounting_status = ?');
      values.push(v);
    } else if (k === 'paymentMethod') {
      setParts.push('payment_method = ?');
      values.push(v);
    } else if (k === 'paid') {
      setParts.push('paid = ?');
      values.push(v ? 1 : 0);
    } else if (k === 'carryNegativeToNextMonth') {
      setParts.push(`${col} = ?`);
      values.push(v ? 1 : 0);
    } else if (['status', 'title', 'bukkuinvoice', 'bukkubills', 'monthlyreport'].includes(k)) {
      setParts.push(`${k} = ?`);
      values.push(v);
    }
  }
  if (setParts.length === 0) return { success: true, record: current };

  setParts.push('updated_at = NOW()');
  values.push(id, clientId);

  await pool.query(
    `UPDATE ownerpayout SET ${setParts.join(', ')} WHERE id = ? AND client_id = ?`,
    values
  );

  let accounting = null;
  if (changes.paid === true && changes.paymentDate != null && changes.paymentMethod != null) {
    try {
      const { createAccountingForOwnerPayout } = require('./generatereport-accounting.service');
      accounting = await createAccountingForOwnerPayout(clientId, id, {
        paymentDate: changes.paymentDate,
        paymentMethod: changes.paymentMethod
      });
      console.log('[generatereport] accounting after mark paid', {
        clientId,
        payoutId: id,
        ok: accounting?.ok,
        skipped: accounting?.skipped,
        skipReason: accounting?.skipReason,
        invoiceCreated: accounting?.invoiceCreated,
        billCreated: accounting?.billCreated,
        errors: accounting?.errors
      });
    } catch (e) {
      console.warn('[generatereport] createAccountingForOwnerPayout failed:', e?.message || e);
      accounting = { ok: false, errors: [e?.message || String(e)] };
    }
  }

  const record = await getOwnerReport(clientId, id);
  return { success: true, record, accounting };
}

/**
 * Delete owner report; must belong to client.
 */
async function deleteOwnerReport(clientId, id) {
  const [r] = await pool.query('SELECT id FROM ownerpayout WHERE id = ? AND client_id = ?', [id, clientId]);
  if (!r.length) throw new Error('NOT_FOUND');
  await pool.query('DELETE FROM ownerpayout WHERE id = ? AND client_id = ?', [id, clientId]);
  return { success: true };
}

/**
 * Get account type ids by title. 仅用于需要 account id 的场景（如 #buttonpay / #buttonbulkpaid 的会计入账）。
 * table account 多 client 共用，此处不做 client 过滤。
 */
async function getAccountTypeIds() {
  const [rows] = await pool.query(
    "SELECT id, title FROM account WHERE title IN (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      TYPE_AGREEMENT_FEES,
      TYPE_OWNER_COMMISSION,
      'Owner Commission',
      TYPE_RENTAL_INCOME,
      TYPE_FORFEIT_DEPOSIT,
      TYPE_DEPOSIT,
      TYPE_TENANT_COMMISSION,
      'Tenant Comission',
      TYPE_PARKING_FEES,
      'Parking',
      TYPE_MANAGEMENT_FEES,
      'Management Fee'
    ]
  );
  const byTitle = {};
  rows.forEach(r => { byTitle[r.title] = r.id; });
  return {
    agreementFeesId: byTitle[TYPE_AGREEMENT_FEES] || null,
    ownerCommissionId: byTitle[TYPE_OWNER_COMMISSION] || byTitle['Owner Commission'] || null,
    rentalIncomeId: byTitle[TYPE_RENTAL_INCOME] || null,
    forfeitDepositId: byTitle[TYPE_FORFEIT_DEPOSIT] || null,
    depositId: byTitle[TYPE_DEPOSIT] || null,
    tenantCommissionId: byTitle[TYPE_TENANT_COMMISSION] || byTitle['Tenant Comission'] || null,
    parkingFeesId: byTitle[TYPE_PARKING_FEES] || byTitle['Parking'] || 'e517299a-60ad-479b-b54f-67f7e12a7b24',
    managementFeesId: byTitle[TYPE_MANAGEMENT_FEES] || byTitle['Management Fee'] || null
  };
}

/**
 * Normalize input to Malaysia YYYY-MM-DD for date range query.
 * ISO 字符串按 UTC 解析后转马来西亚日期，避免 1 号 UTC 变成 31 号 MY。
 */
function toMalaysiaDateOnlyStr(v) {
  if (!v) return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return v.trim().substring(0, 10);
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return null;
  return utcDatetimeFromDbToMalaysiaDateOnly(d);
}

/**
 * Generate owner payout rows and totals for a property and date range (MySQL version of Wix generateOwnerPayout).
 * Uses UTC+8 (Malaysia) date range for rentalcollection.date and bills.period; scopes by client_id.
 * @param {string} clientId - from access context (required for rentalcollection/bills scope)
 * @param {string} propertyId
 * @param {string} propertyName
 * @param {string|Date} startDate - ISO string or Date (interpreted as Malaysia date for range start)
 * @param {string|Date} endDate - Malaysia date for range end
 */
async function generateOwnerPayout(clientId, propertyId, propertyName, startDate, endDate) {
  console.log('[generateOwnerPayout] ENTRY (with rentalcollection + metertransaction logs)', { clientId, propertyId, startDate, endDate });
  const fromStr = toMalaysiaDateOnlyStr(startDate);
  const toStr = toMalaysiaDateOnlyStr(endDate);
  if (!fromStr || !toStr) throw new Error('INVALID_DATE_RANGE');
  const { fromUtc, toUtc } = malaysiaDateRangeToUtcForQuery(fromStr, toStr);
  if (!fromUtc || !toUtc) throw new Error('INVALID_DATE_RANGE');
  console.log('[generateOwnerPayout] date range', { fromStr, toStr, fromUtc, toUtc });

  const rows = [];
  let incomeNo = 1;
  let expenseNo = 1;
  let rentalIncome = 0;
  let forfeitDepositIncome = 0;
  let parkingIncome = 0;
  let topupIncome = 0;
  let depositIncome = 0;
  let agreementFeesIncome = 0;
  let tenantCommissionIncome = 0;
  let managementFeesInvoiceIncome = 0;
  let totalExpenses = 0;
  let totalUtilityBills = 0;
  const ownerCommissionExpenses = [];
  /** Rental/meter lines classified as expense (shown after Gross Income, not above it). */
  const otherCollectionExpenses = [];

  const cls = await getOwnerReportClassificationSets(clientId);

  // 1) RentalCollection: 以 type_id 为准分类（rental income / agreement fees / forfeit / owner commission / tenant commission / parking）；title 仅作 type_id 缺失或未知时的 fallback
  const [rentalRows] = await pool.query(
    `SELECT rc.id, rc.client_id, rc.property_id, rc.room_id, rc.date, rc.amount, rc.ispaid, rc.receipturl, rc.type_id,
            rc.title AS rc_title,
            COALESCE(a.title, (SELECT a2.title FROM account a2 WHERE a2.id = rc.type_id LIMIT 1)) AS type_title,
            rm.title_fld AS room_title
       FROM rentalcollection rc
       LEFT JOIN account a ON a.id = rc.type_id
       LEFT JOIN roomdetail rm ON rm.id = rc.room_id
       WHERE (rc.client_id = ? OR rc.client_id IS NULL) AND rc.property_id = ? AND rc.date >= ? AND rc.date <= ?`,
    [clientId, propertyId, fromUtc, toUtc]
  );
  console.log('[generateOwnerPayout] rentalcollection QUERY', { clientId, propertyId, fromUtc: String(fromUtc), toUtc: String(toUtc), rowCount: rentalRows.length });

  const idKey = (id) => (id == null ? '' : (typeof id === 'string' ? id : String(id)).trim().toLowerCase());
  const tidEq = (a, b) => (a && b && idKey(a) === idKey(b));
  const ids = await getAccountTypeIds();
  console.log('[generateOwnerPayout] account type ids', ids);

  // Title fallback: only when type_id is null or not in account list
  const titleNorm = (t) => (t != null ? String(t).trim() : '');
  const tEq = (t, ...vals) => vals.some(v => v && titleNorm(t).toLowerCase() === String(v).toLowerCase());
  const isRentalByTitle = (t) => {
    const lower = titleNorm(t).toLowerCase();
    if (!lower) return false;
    if (tEq(t, TYPE_RENTAL_INCOME, 'Rent Income')) return true;
    return lower.includes('rental income') || lower.includes('rent income');
  };
  // title 可能是长串如 "January - ... - Forfeit Deposit"，用 contains 识别
  const isForfeitDepositByTitle = (t) => tEq(t, TYPE_FORFEIT_DEPOSIT) || titleNorm(t).toLowerCase().includes('forfeit deposit');
  const isOwnerCommissionByTitle = (t) => tEq(t, TYPE_OWNER_COMMISSION) || titleNorm(t).toLowerCase().includes('owner comission') || titleNorm(t).toLowerCase().includes('owner commission');
  /** Tenant invoice type Management Fees — not the settlement summary line "Management Fees (x% …)" from property settings. */
  const isManagementFeesInvoiceByTitle = (t) => {
    const s = titleNorm(t);
    if (!s) return false;
    if (tEq(t, TYPE_MANAGEMENT_FEES, 'Management Fee')) return true;
    const tl = s.toLowerCase();
    if (tl === 'management fees' || tl === 'management fee') return true;
    if (/\bmanagement fees\b/.test(tl) || /\bmanagement fee\b/.test(tl)) {
      if (/\d+%\s*net income/i.test(tl) || /\d+%\s*gross income/i.test(tl) || /rental income only\)/i.test(tl)) return false;
      return true;
    }
    return false;
  };
  const hasRowTitle = (r) => titleNorm(r.rc_title) !== '' || titleNorm(r.type_title) !== '';
  const nullTitleTypeIds = [...new Set(rentalRows.filter(r => !hasRowTitle(r) && r.type_id).map(r => r.type_id))];
  const typeIdToTitle = {};
  if (nullTitleTypeIds.length > 0) {
    const placeholders = nullTitleTypeIds.map(() => '?').join(',');
    const [idRows] = await pool.query(`SELECT id, title FROM account WHERE id IN (${placeholders})`, nullTitleTypeIds);
    idRows.forEach(row => { typeIdToTitle[idKey(row.id)] = row.title != null ? titleNorm(row.title) : ''; });
  }
  const resolveTitle = (r) => {
    const rc = titleNorm(r.rc_title);
    if (rc !== '') return rc;
    const j = titleNorm(r.type_title);
    if (j !== '') return j;
    return r.type_id ? (typeIdToTitle[idKey(r.type_id)] ?? '') : '';
  };

  const resolveRentalCollectionKind = (r, tid) => {
    if (tid != null && tid !== '') {
      if (tidEq(tid, ids.agreementFeesId)) return 'agreement_fees';
      if (tidEq(tid, ids.depositId)) return 'deposit';
      if (tidEq(tid, ids.tenantCommissionId)) return 'tenant_commission';
      if (tidEq(tid, ids.forfeitDepositId)) return 'forfeit_deposit';
      if (tidEq(tid, ids.ownerCommissionId)) return 'owner_commission';
      if (tidEq(tid, ids.rentalIncomeId)) return 'rental_income';
      if (tidEq(tid, ids.parkingFeesId)) return 'parking_fees';
      if (tidEq(tid, ids.managementFeesId)) return 'management_fees';
    }
    const t = resolveTitle(r);
    if (titleNorm(t) === '') return null;
    if (tEq(t, TYPE_AGREEMENT_FEES)) return 'agreement_fees';
    if (tEq(t, TYPE_DEPOSIT)) return 'deposit';
    if (tEq(t, TYPE_TENANT_COMMISSION, 'Tenant Comission')) return 'tenant_commission';
    if (isForfeitDepositByTitle(t)) return 'forfeit_deposit';
    if (isManagementFeesInvoiceByTitle(t)) return 'management_fees';
    if (isOwnerCommissionByTitle(t)) return 'owner_commission';
    if (isRentalByTitle(t)) return 'rental_income';
    return null;
  };

  const genericCollectionExpenseDesc = (kind, monthName, roomLabel) => {
    switch (kind) {
      case 'rental_income':
        return `${monthName} Rental - ${roomLabel}`;
      case 'forfeit_deposit':
        return `${monthName} Forfeit Deposit - ${roomLabel}`;
      case 'parking_fees':
        return `${monthName} Parking - ${roomLabel}`;
      case 'deposit':
        return `${monthName} Deposit - ${roomLabel}`;
      case 'agreement_fees':
        return `${monthName} Agreement Fees - ${roomLabel}`;
      case 'tenant_commission':
        return `${monthName} Tenant Commission - ${roomLabel}`;
      case 'management_fees':
        return `${monthName} Management Fees - ${roomLabel}`;
      default:
        return `${monthName} ${kind} - ${roomLabel}`;
    }
  };

  for (let idx = 0; idx < rentalRows.length; idx++) {
    const r = rentalRows[idx];
    if (!r.ispaid) continue;
    const tid = r.type_id;
    const monthName = new Date(r.date).toLocaleString('en-US', { month: 'short' });
    const roomLabel = r.room_title || 'Unknown Room';
    const amt = Number(r.amount);
    const amountStr = amt.toFixed(2);

    const kind = resolveRentalCollectionKind(r, tid);
    if (!kind) {
      const t = resolveTitle(r);
      if (t === '') {
        console.log('[generateOwnerPayout] rental ROW skipped: no type_id match and no title', { idx, type_id: tid, amount: r.amount });
      } else {
        console.log('[generateOwnerPayout] rental ROW skipped: unknown title (fallback)', { idx, title: t, amount: r.amount });
      }
      continue;
    }

    if (cls.expense.has(kind)) {
      if (kind === 'owner_commission') {
        ownerCommissionExpenses.push({
          no: String(expenseNo++),
          description: `Owner Commission - ${roomLabel}`,
          amount: amountStr,
          _rowBucket: 'expense'
        });
        totalExpenses += amt;
      } else {
        otherCollectionExpenses.push({
          no: String(expenseNo++),
          description: genericCollectionExpenseDesc(kind, monthName, roomLabel),
          amount: amountStr,
          _rowBucket: 'expense'
        });
        totalExpenses += amt;
      }
      continue;
    }

    if (cls.income.has(kind)) {
      switch (kind) {
        case 'rental_income':
          rows.push({
            no: String(incomeNo++),
            description: `${monthName} Rental - ${roomLabel}`,
            amount: amountStr,
            _rowBucket: 'income'
          });
          rentalIncome += amt;
          break;
        case 'forfeit_deposit':
          rows.push({
            no: String(incomeNo++),
            description: `${monthName} Forfeit Deposit - ${roomLabel}`,
            amount: amountStr,
            _rowBucket: 'income'
          });
          forfeitDepositIncome += amt;
          break;
        case 'parking_fees':
          rows.push({
            no: String(incomeNo++),
            description: `${monthName} Parking - ${roomLabel}`,
            amount: amountStr,
            _rowBucket: 'income'
          });
          parkingIncome += amt;
          break;
        case 'deposit':
          rows.push({
            no: String(incomeNo++),
            description: `${monthName} Deposit - ${roomLabel}`,
            amount: amountStr,
            _rowBucket: 'income'
          });
          depositIncome += amt;
          break;
        case 'agreement_fees':
          rows.push({
            no: String(incomeNo++),
            description: `${monthName} Agreement Fees - ${roomLabel}`,
            amount: amountStr,
            _rowBucket: 'income'
          });
          agreementFeesIncome += amt;
          break;
        case 'tenant_commission':
          rows.push({
            no: String(incomeNo++),
            description: `${monthName} Tenant Commission - ${roomLabel}`,
            amount: amountStr,
            _rowBucket: 'income'
          });
          tenantCommissionIncome += amt;
          break;
        case 'management_fees':
          rows.push({
            no: String(incomeNo++),
            description: `${monthName} Management Fees - ${roomLabel}`,
            amount: amountStr,
            _rowBucket: 'income'
          });
          managementFeesInvoiceIncome += amt;
          break;
        default:
          break;
      }
      continue;
    }
    // Not in income or expense set: excluded from owner report (e.g. standard deposit → excluded)
  }

  console.log('[generateOwnerPayout] rentalcollection summary', { rentalIncome, forfeitDepositIncome, parkingIncome, incomeRowsCount: rows.length });

  // Sort rental rows by description
  const rentalRowsOnly = rows.filter(x => x.description && x.description.includes('Rental'));
  const otherRows = rows.filter(x => !x.description || !x.description.includes('Rental'));
  rentalRowsOnly.sort((a, b) => (a.description || '').localeCompare(b.description || '', 'en', { numeric: true }));
  rows.length = 0;
  rows.push(...otherRows, ...rentalRowsOnly);

  // 2) MeterTransaction: success + isPaid，按房间汇总；这里都是 aircond topup，作为收入（Topup - Room）
  const [meterRows] = await pool.query(
    `SELECT mt.id, mt.amount, mt.tenancy_id, mt.created_at, t.room_id, rm.title_fld AS room_title
       FROM metertransaction mt
       LEFT JOIN tenancy t ON t.id = mt.tenancy_id
       LEFT JOIN roomdetail rm ON rm.id = t.room_id
       WHERE mt.property_id = ? AND mt.status = 'success' AND mt.ispaid = 1
         AND mt.created_at >= ? AND mt.created_at <= ?`,
    [propertyId, fromUtc, toUtc]
  );
  console.log('[generateOwnerPayout] metertransaction QUERY', { propertyId, fromUtc: String(fromUtc), toUtc: String(toUtc), rowCount: meterRows.length });
  const meterMap = {};
  for (const m of meterRows) {
    const key = m.room_id || m.tenancy_id || 'unknown';
    if (!meterMap[key]) {
      meterMap[key] = { title: m.room_title || 'Unknown Room', total: 0 };
    }
    meterMap[key].total += Number(m.amount || 0);
  }
  for (const v of Object.values(meterMap)) {
    const mtAmt = v.total;
    const mtStr = mtAmt.toFixed(2);
    if (cls.income.has('meter_topup')) {
      rows.push({
        no: String(incomeNo++),
        description: `Topup - ${v.title}`,
        amount: mtStr,
        _rowBucket: 'income'
      });
      topupIncome += mtAmt;
    } else if (cls.expense.has('meter_topup')) {
      otherCollectionExpenses.push({
        no: String(expenseNo++),
        description: `Meter topup - ${v.title}`,
        amount: mtStr,
        _rowBucket: 'expense'
      });
      totalExpenses += mtAmt;
    }
  }
  console.log('[generateOwnerPayout] metertransaction AFTER', { topupRows: Object.keys(meterMap).length, topupIncome });

  const grossIncome =
    rentalIncome +
    forfeitDepositIncome +
    parkingIncome +
    topupIncome +
    depositIncome +
    agreementFeesIncome +
    tenantCommissionIncome +
    managementFeesInvoiceIncome;
  rows.push({ no: '', description: 'Gross Income', amount: grossIncome.toFixed(2) });
  rows.push(...ownerCommissionExpenses);
  rows.push(...otherCollectionExpenses);

  // 供前端 #tablegr / #tablebillsgr 分表显示（含 Gross 之后、账单之前的 collection 行）
  const rentalCollectionRows = rows.map(r => ({ no: r.no, description: r.description, amount: r.amount }));

  // 3) Bills: supplierdetail_id → supplierdetail；supplierdetail.utility_type → 电费/水费/其他
  const [billRows] = await pool.query(
    `SELECT b.id, b.description, b.amount, b.period, b.supplierdetail_id,
            s.title AS bill_type_title, s.utility_type AS supplier_utility_type
       FROM bills b
       LEFT JOIN supplierdetail s ON s.id = b.supplierdetail_id
       WHERE (b.client_id = ? OR b.client_id IS NULL) AND b.property_id = ? AND b.period >= ? AND b.period <= ?
       ORDER BY COALESCE(b.description, s.title, '') ASC`,
    [clientId, propertyId, fromUtc, toUtc]
  );
  console.log('[generateOwnerPayout] bills', { propertyId, clientId, fromStr, toStr, itemCount: billRows.length, items: billRows.map(b => ({ id: b.id, description: b.description, amount: b.amount, period: b.period, utility_type: b.supplier_utility_type })) });
  if (billRows.length > 0) {
    console.log('[generateOwnerPayout] bills FULL (raw query result):', JSON.stringify(billRows.map(b => ({ id: b.id, description: b.description, amount: b.amount, period: b.period, bill_type_title: b.bill_type_title, supplier_utility_type: b.supplier_utility_type }))));
  }

  // Bills 显示：electric → "Electric"，water → "Water"，wifi → "Wifi"；其他 → 用 column description
  const billDescription = (b) => {
    const ut = b.supplier_utility_type ? String(b.supplier_utility_type).toLowerCase() : '';
    if (ut === 'electric') return 'Electric';
    if (ut === 'water') return 'Water';
    if (ut === 'wifi') return 'Wifi';
    return (b.description || b.bill_type_title || '').trim() || 'Other';
  };

  const billsRows = [];
  for (const b of billRows) {
    const desc = billDescription(b);
    const row = {
      no: String(expenseNo++),
      description: desc,
      amount: Number(b.amount).toFixed(2),
      _rowBucket: 'expense'
    };
    rows.push(row);
    billsRows.push(row);
    totalExpenses += Number(b.amount);
    totalUtilityBills += Number(b.amount);
  }

  // 4) Previous month negative balance (OwnerPayout)
  const startDateForPrev = new Date(fromUtc.replace(' ', 'T') + 'Z');
  const prevMonthStart = new Date(Date.UTC(startDateForPrev.getUTCFullYear(), startDateForPrev.getUTCMonth(), 0, 16, 0, 0));
  const prevMonthEnd = new Date(Date.UTC(startDateForPrev.getUTCFullYear(), startDateForPrev.getUTCMonth(), 25, 4, 0, 0));
  const [prevRows] = await pool.query(
    `SELECT netpayout
       FROM ownerpayout
      WHERE property_id = ?
        AND period >= ?
        AND period < ?
        AND carry_negative_to_next_month = 1
      ORDER BY period DESC
      LIMIT 1`,
    [propertyId, prevMonthStart, prevMonthEnd]
  );
  if (prevRows.length && Number(prevRows[0].netpayout) < 0) {
    const lastMonthBalance = Math.abs(Number(prevRows[0].netpayout));
    rows.push({
      no: String(expenseNo++),
      description: 'Last Month Balance',
      amount: lastMonthBalance.toFixed(2),
      _rowBucket: 'expense'
    });
    totalExpenses += lastMonthBalance;
  }

  // 与旧代码一致：对 expenses 段（Gross Income 之后的 collection 支出 → Owner Commission → bills → Last Month Balance）按 description A-Z 排序
  const grossIncomeIdx = rows.findIndex(r => r.description === 'Gross Income');
  let expenseStartIndex = -1;
  if (grossIncomeIdx !== -1) {
    for (let i = grossIncomeIdx + 1; i < rows.length; i++) {
      if (rows[i]._rowBucket === 'expense') {
        expenseStartIndex = i;
        break;
      }
    }
  }
  const expenseEndIndex = rows.findIndex(r => r.description === 'Last Month Balance');
  const expenseEnd = expenseEndIndex === -1 ? rows.length : expenseEndIndex + 1;
  if (expenseStartIndex !== -1 && expenseEnd > expenseStartIndex) {
    const expenseSection = rows.slice(expenseStartIndex, expenseEnd);
    expenseSection.sort((a, b) => (a.description || '').localeCompare(b.description || '', 'en', { numeric: true }));
    rows.splice(expenseStartIndex, expenseSection.length, ...expenseSection);
  }

  // 5) Owner settlement:
  // - management_percent_gross: fee = gross income * %
  // - management_percent_net: fee = net income * %
  // - management_fees_fixed: fixed fee amount
  // - rental_unit: fixed-rent model (kept for UI option compatibility)
  // - guarantee_return_fixed_plus_share: guaranteed owner rent + owner % share of remaining
  // Backward compatibility:
  // - management_percent => management_percent_gross
  // - fixed_rent_to_owner => rental_unit
  const [propRows] = await pool.query(
    'SELECT percentage, owner_settlement_model, fixed_rent_to_owner FROM propertydetail WHERE id = ?',
    [propertyId]
  );
  if (!propRows.length) throw new Error('PROPERTY_NOT_FOUND');
  const rawSettlementModel = String(propRows[0].owner_settlement_model || 'management_percent_gross').trim();
  const settlementModel = rawSettlementModel === 'management_percent_net'
    ? 'management_percent_net'
    : (rawSettlementModel === 'management_percent_rental_income_only')
      ? 'management_percent_rental_income_only'
    : (rawSettlementModel === 'guarantee_return_fixed_plus_share')
      ? 'guarantee_return_fixed_plus_share'
    : (rawSettlementModel === 'rental_unit' || rawSettlementModel === 'fixed_rent_to_owner')
      ? 'rental_unit'
      : (rawSettlementModel === 'management_fees_fixed')
        ? 'management_fees_fixed'
      : 'management_percent_gross';

  const netIncome = parseFloat((grossIncome - totalExpenses).toFixed(2));

  let managementFee;
  let ownerPayout;
  let ownerBonusShare = 0;
  let managementRowDescription;
  if (settlementModel === 'management_fees_fixed') {
    const fixed = Number(
      propRows[0].fixed_rent_to_owner != null && propRows[0].fixed_rent_to_owner !== ''
        ? propRows[0].fixed_rent_to_owner
        : propRows[0].percentage
    );
    if (fixed === undefined || fixed === null || isNaN(fixed) || fixed <= 0) {
      throw new Error('PROPERTY_MANAGEMENT_FIXED_FEE_REQUIRED');
    }
    managementFee = parseFloat(fixed.toFixed(2));
    managementRowDescription = 'Management Fees (Fixed)';
    ownerPayout = parseFloat((netIncome - managementFee).toFixed(2));
  } else if (settlementModel === 'rental_unit') {
    const fixedRental = Number(
      propRows[0].fixed_rent_to_owner != null && propRows[0].fixed_rent_to_owner !== ''
        ? propRows[0].fixed_rent_to_owner
        : propRows[0].percentage
    );
    if (fixedRental === undefined || fixedRental === null || isNaN(fixedRental) || fixedRental <= 0) {
      throw new Error('PROPERTY_RENTAL_UNIT_FIXED_RENT_REQUIRED');
    }
    // Rental unit model:
    // - owner gets fixed monthly rental (owner payout)
    // - operator keeps the rest as profit/loss
    ownerPayout = parseFloat(fixedRental.toFixed(2));
    managementFee = parseFloat((netIncome - ownerPayout).toFixed(2));
    managementRowDescription = 'Operator Profit (Net - Rental)';
  } else if (settlementModel === 'guarantee_return_fixed_plus_share') {
    const fixedRental = Number(
      propRows[0].fixed_rent_to_owner != null && propRows[0].fixed_rent_to_owner !== ''
        ? propRows[0].fixed_rent_to_owner
        : 0
    );
    const sharePct = Number(propRows[0].percentage);
    if (!Number.isFinite(fixedRental) || fixedRental <= 0) {
      throw new Error('PROPERTY_GUARANTEE_FIXED_RENT_REQUIRED');
    }
    if (!Number.isFinite(sharePct) || sharePct <= 0) {
      throw new Error('PROPERTY_GUARANTEE_SHARE_PERCENTAGE_REQUIRED');
    }
    const remainingAfterGuarantee = netIncome - fixedRental;
    ownerBonusShare = remainingAfterGuarantee > 0
      ? parseFloat((remainingAfterGuarantee * (sharePct / 100)).toFixed(2))
      : 0;
    ownerPayout = parseFloat((fixedRental + ownerBonusShare).toFixed(2));
    managementFee = parseFloat((netIncome - ownerPayout).toFixed(2));
    managementRowDescription = `Operator Profit (after Guarantee + ${sharePct}% owner share)`;
  } else if (settlementModel === 'management_percent_net') {
    const percentage = Number(propRows[0].percentage);
    if (percentage === undefined || percentage === null || isNaN(percentage)) {
      throw new Error('PROPERTY_PERCENTAGE_REQUIRED');
    }
    managementFee = parseFloat((netIncome * (percentage / 100)).toFixed(2));
    managementRowDescription = `Management Fees (${percentage}% Net Income)`;
    ownerPayout = parseFloat((netIncome - managementFee).toFixed(2));
  } else if (settlementModel === 'management_percent_rental_income_only') {
    const percentage = Number(propRows[0].percentage);
    if (percentage === undefined || percentage === null || isNaN(percentage)) {
      throw new Error('PROPERTY_PERCENTAGE_REQUIRED');
    }
    // "Rental Income Only" must exclude:
    // - Forfeit Deposit
    // - Parking Fees
    // - Topup (metertransaction)
    managementFee = parseFloat((rentalIncome * (percentage / 100)).toFixed(2));
    managementRowDescription = `Management Fees (${percentage}% Rental Income Only)`;
    ownerPayout = parseFloat((netIncome - managementFee).toFixed(2));
  } else {
    const percentage = Number(propRows[0].percentage);
    if (percentage === undefined || percentage === null || isNaN(percentage)) {
      throw new Error('PROPERTY_PERCENTAGE_REQUIRED');
    }
    managementFee = parseFloat((grossIncome * (percentage / 100)).toFixed(2));
    managementRowDescription = `Management Fees (${percentage}% Gross Income)`;
    ownerPayout = parseFloat((netIncome - managementFee).toFixed(2));
  }

  rentalIncome = parseFloat(rentalIncome.toFixed(2));
  forfeitDepositIncome = parseFloat(forfeitDepositIncome.toFixed(2));
  parkingIncome = parseFloat(parkingIncome.toFixed(2));
  topupIncome = parseFloat(topupIncome.toFixed(2));
  depositIncome = parseFloat(depositIncome.toFixed(2));
  agreementFeesIncome = parseFloat(agreementFeesIncome.toFixed(2));
  tenantCommissionIncome = parseFloat(tenantCommissionIncome.toFixed(2));
  managementFeesInvoiceIncome = parseFloat(managementFeesInvoiceIncome.toFixed(2));
  totalUtilityBills = parseFloat(totalUtilityBills.toFixed(2));
  totalExpenses = parseFloat(totalExpenses.toFixed(2));
  const fixedGross = parseFloat(
    (
      rentalIncome +
      forfeitDepositIncome +
      parkingIncome +
      topupIncome +
      depositIncome +
      agreementFeesIncome +
      tenantCommissionIncome +
      managementFeesInvoiceIncome
    ).toFixed(2)
  );

  rows.push({ no: '', description: 'Total Expenses', amount: totalExpenses.toFixed(2) });
  rows.push({ no: '', description: 'Net Income', amount: netIncome.toFixed(2) });
  if (settlementModel === 'guarantee_return_fixed_plus_share') {
    const guaranteeFixed = Number(propRows[0].fixed_rent_to_owner || 0);
    const sharePct = Number(propRows[0].percentage || 0);
    rows.push({ no: '', description: 'Guarantee Return (Fixed Rent)', amount: guaranteeFixed.toFixed(2) });
    rows.push({ no: '', description: `Owner Share (${sharePct}% of Remaining)`, amount: ownerBonusShare.toFixed(2) });
  }
  rows.push({ no: '', description: managementRowDescription, amount: managementFee.toFixed(2) });
  rows.push({ no: '', description: 'Owner Payout', amount: ownerPayout.toFixed(2) });

  // Renumber: income rows → 1,2,3...；expense 行（含 Owner Commission、bills、Last Month Balance）→ 1,2,3...；汇总行保持 no 为空
  const summaryDescriptions = ['Gross Income', 'Total Expenses', 'Net Income', 'Owner Payout'];
  // Management Fee(s) is a summary row and must not be numbered in the "No" column.
  // Make matching robust to case/extra spaces/plural "Fees".
  const isManagementRow = (d) => {
    if (d == null) return false;
    const s = String(d).trim();
    return /^management\s+fees?\b/i.test(s)
      || /^fixed\s+rent\s+to\s+owner\b/i.test(s)
      || /^operator\s+profit\b/i.test(s)
      || /^guarantee\s+return\b/i.test(s)
      || /^owner\s+share\b/i.test(s);
  };
  let incomeCounter = 1;
  let expenseCounter = 1;
  const stripBucket = (r) => {
    if (!r || typeof r !== 'object') return r;
    const { _rowBucket, ...rest } = r;
    return rest;
  };
  const out = rows.map(r => {
    if (!r.description) return stripBucket(r);
    if (r._rowBucket === 'income') {
      return { ...stripBucket(r), no: String(incomeCounter++) };
    }
    if (r._rowBucket === 'expense') {
      return { ...stripBucket(r), no: String(expenseCounter++) };
    }
    if (summaryDescriptions.includes(r.description) || isManagementRow(r.description)) {
      return { ...stripBucket(r), no: '' };
    }
    return { ...stripBucket(r), no: String(expenseCounter++) };
  });

  return {
    rows: out,
    rentalCollectionRows,
    billsRows,
    totalrental: rentalIncome,
    totalutility: totalUtilityBills,
    totalcollection: fixedGross,
    expenses: totalExpenses,
    managementfee: managementFee,
    netpayout: ownerPayout
  };
}

/**
 * Get payout rows + propertyName + billPeriod for PDF (by payoutId). Regenerates rows via generateOwnerPayout.
 * @returns {Promise<{ rows: Array, propertyName: string, billPeriod: string }>}
 */
async function getPayoutRowsForPdf(clientId, payoutId) {
  const [payoutRows] = await pool.query(
    'SELECT id, property_id, period FROM ownerpayout WHERE id = ? AND client_id = ?',
    [payoutId, clientId]
  );
  if (!payoutRows.length) throw new Error('NOT_FOUND');
  const payout = payoutRows[0];
  const [propRows] = await pool.query(
    'SELECT id, shortname FROM propertydetail WHERE id = ?',
    [payout.property_id]
  );
  if (!propRows.length) throw new Error('PROPERTY_NOT_FOUND');
  const propertyName = propRows[0].shortname || 'Unknown Property';
  const periodMy = utcDatetimeFromDbToMalaysiaDate(payout.period);
  const firstDay = new Date(periodMy.getFullYear(), periodMy.getMonth(), 1);
  const lastDay = new Date(periodMy.getFullYear(), periodMy.getMonth() + 1, 0);
  const payoutData = await generateOwnerPayout(
    clientId,
    payout.property_id,
    propertyName,
    firstDay,
    lastDay
  );
  const billPeriod = periodMy.toLocaleString('default', { month: 'long' }) + ' ' + periodMy.getFullYear();
  return {
    rows: payoutData.rows,
    propertyName,
    billPeriod
  };
}

/**
 * Bulk update owner reports (e.g. mark paid). IDs must all belong to client.
 */
async function bulkUpdateOwnerReport(clientId, ids, changes) {
  if (!Array.isArray(ids) || ids.length === 0) throw new Error('INVALID_IDS');
  changes = coerceMarkPaidPayload(changes);

  const allowed = ['paid', 'accountingStatus', 'paymentDate', 'paymentMethod', 'carryNegativeToNextMonth'];
  const dbMap = {
    accountingStatus: 'accounting_status',
    paymentDate: 'payment_date',
    paymentMethod: 'payment_method',
    carryNegativeToNextMonth: 'carry_negative_to_next_month'
  };
  const setCols = [];
  const setVals = [];
  for (const [k, v] of Object.entries(changes)) {
    if (!allowed.includes(k)) continue;
    const col = dbMap[k] || k;
    setCols.push(`${col} = ?`);
    setVals.push(
      k === 'paymentDate' && v ? new Date(v) :
      k === 'carryNegativeToNextMonth' ? (v ? 1 : 0) :
      v
    );
  }
  if (setCols.length === 0) return { success: true, updatedCount: 0 };

  const placeholders = ids.map(() => '?').join(',');
  const [check] = await pool.query(
    `SELECT id FROM ownerpayout WHERE id IN (${placeholders}) AND client_id = ?`,
    [...ids, clientId]
  );
  if (check.length !== ids.length) throw new Error('CROSS_CLIENT_ACCESS');

  const updateSql = `UPDATE ownerpayout SET ${setCols.join(', ')}, updated_at = NOW() WHERE id IN (${placeholders}) AND client_id = ?`;
  const [result] = await pool.query(updateSql, [...setVals, ...ids, clientId]);

  let accounting = null;
  if (result.affectedRows > 0 && changes.paid === true && changes.paymentDate != null && changes.paymentMethod != null) {
    try {
      const { createAccountingForOwnerPayoutBulk } = require('./generatereport-accounting.service');
      accounting = await createAccountingForOwnerPayoutBulk(clientId, ids, {
        paymentDate: changes.paymentDate,
        paymentMethod: changes.paymentMethod
      });
      console.log('[generatereport] accounting after bulk mark paid', {
        clientId,
        idsCount: ids.length,
        ok: accounting?.ok,
        skipped: accounting?.skipped,
        skipReason: accounting?.skipReason,
        provider: accounting?.provider,
        invoiceCreated: accounting?.invoiceCreated,
        billCreated: accounting?.billCreated,
        errors: accounting?.errors
      });
    } catch (e) {
      console.warn('[generatereport] createAccountingForOwnerPayoutBulk failed:', e?.message || e);
      accounting = { ok: false, errors: [e?.message || String(e)] };
    }
  }

  return { success: true, updatedCount: result.affectedRows || 0, accounting };
}

/**
 * Get client_id for a payout (for access check when serving PDF file).
 * @returns {Promise<string|null>}
 */
async function getPayoutClientId(payoutId) {
  const [rows] = await pool.query('SELECT client_id FROM ownerpayout WHERE id = ?', [payoutId]);
  return rows.length ? rows[0].client_id : null;
}

/**
 * Upload owner report PDF to the property's Google Drive folder (propertydetail.folder),
 * then write the file URL into ownerpayout.monthlyreport.
 */
async function uploadOwnerReportPdfToDrive({ buffer, fileName, payoutId, clientId }) {
  if (!buffer || !payoutId || !clientId) throw new Error('missing_buffer_payoutId_or_clientId');
  const [payoutRows] = await pool.query('SELECT id, property_id, client_id FROM ownerpayout WHERE id = ?', [payoutId]);
  if (!payoutRows.length) throw new Error('PAYOUT_NOT_FOUND');
  if (payoutRows[0].client_id !== clientId) throw new Error('CROSS_CLIENT_ACCESS');

  const [propRows] = await pool.query(
    'SELECT id, shortname, folder FROM propertydetail WHERE id = ?',
    [payoutRows[0].property_id]
  );
  if (!propRows.length) throw new Error('PROPERTY_NOT_FOUND');
  const folderId = extractFolderId(propRows[0].folder);
  if (!folderId) throw new Error('PROPERTY_FOLDER_NOT_SET');

  const authInfo = await getDriveAuthForClient(clientId);
  const auth = authInfo.auth;
  if (!auth) throw new Error('GOOGLE_CREDENTIALS_NOT_CONFIGURED');
  if (authInfo.source === 'oauth') {
    console.log('[generatereport] Drive API caller= GOOGLE OAUTH (operator-connected account)', { clientId });
  } else {
    console.log('[generatereport] Drive API caller= SERVICE ACCOUNT', { clientId });
  }

  const drive = google.drive({ version: 'v3', auth });
  const name = fileName && fileName.endsWith('.pdf') ? fileName : `${fileName || 'OwnerReport'}.pdf`;

  // googleapis multipartUpload expects a stream-like body (with `.pipe()`).
  // Use Readable.from() so Buffer won't crash with `part.body.pipe is not a function`.
  const { Readable } = require('stream');
  const pdfBuf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const bodyStream = Readable.from(pdfBuf);

  const createRes = await drive.files.create({
    requestBody: {
      name,
      parents: [folderId],
      mimeType: 'application/pdf'
    },
    media: {
      mimeType: 'application/pdf',
      body: bodyStream
    }
  });
  const fileId = createRes.data.id;
  if (!fileId) throw new Error('DRIVE_UPLOAD_FAILED');

  await drive.permissions.create({
    fileId,
    requestBody: { role: 'reader', type: 'anyone' }
  });

  const linkRes = await drive.files.get({
    fileId,
    fields: 'webViewLink, webContentLink'
  });
  const pdfUrl = linkRes.data.webContentLink || linkRes.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;

  await finalizeOwnerReportPdf(payoutId, pdfUrl);
  return { ok: true, id: payoutId, url: pdfUrl };
}

/** True when monthlyreport points at one-time ECS download (not a stored Drive/OSS document). */
function isEphemeralOwnerReportUrl(url) {
  if (url == null || url === '') return false;
  const s = String(url).trim();
  return /\/api\/download\//i.test(s);
}

/**
 * Finalize owner report PDF URL. Update monthlyreport, status, generated_at.
 */
async function finalizeOwnerReportPdf(payoutId, pdfUrl) {
  if (!payoutId || !pdfUrl) throw new Error('missing_id_or_url');

  const [rows] = await pool.query('SELECT id, monthlyreport FROM ownerpayout WHERE id = ?', [payoutId]);
  if (!rows.length) throw new Error('NOT_FOUND');
  const existing = rows[0].monthlyreport != null ? String(rows[0].monthlyreport).trim() : '';
  if (existing && !isEphemeralOwnerReportUrl(existing)) {
    return { ok: true, skipped: true };
  }

  await pool.query(
    `UPDATE ownerpayout SET monthlyreport = ?, status = 'completed', generated_at = NOW(), updated_at = NOW() WHERE id = ?`,
    [pdfUrl, payoutId]
  );
  return { ok: true, id: payoutId, url: pdfUrl };
}

/**
 * Read report settings from operatordetail.admin.reportSettings.ownerReport.
 * Defaults:
 * - defaultCarryNegativeForward: true
 * - automationEnabled: false
 * - automationDay: 5
 */
async function getReportSettings(clientId) {
  const [rows] = await pool.query('SELECT admin FROM operatordetail WHERE id = ? LIMIT 1', [clientId]);
  if (!rows.length) throw new Error('NO_CLIENT');
  let admin = rows[0].admin;
  if (typeof admin === 'string') {
    try { admin = JSON.parse(admin || '{}'); } catch { admin = {}; }
  }
  admin = admin && typeof admin === 'object' ? admin : {};
  const reportRaw = admin.reportSettings && typeof admin.reportSettings === 'object' ? admin.reportSettings : {};
  const ownerRaw = reportRaw.ownerReport && typeof reportRaw.ownerReport === 'object' ? reportRaw.ownerReport : {};
  const dayRaw = Number(ownerRaw.automationDay);
  const automationDay = Number.isFinite(dayRaw) ? Math.max(1, Math.min(31, Math.floor(dayRaw))) : 5;
  const reportClassificationMode = ownerRaw.reportClassificationMode === 'customize' ? 'customize' : 'standard';
  const reportIncomeKeys = normalizeReportClassificationKeys(ownerRaw.reportIncomeKeys);
  const reportExpenseKeys = normalizeReportClassificationKeys(ownerRaw.reportExpenseKeys);
  return {
    defaultCarryNegativeForward: ownerRaw.defaultCarryNegativeForward !== false,
    automationEnabled: ownerRaw.automationEnabled === true,
    automationDay,
    reportClassificationMode,
    reportIncomeKeys,
    reportExpenseKeys
  };
}

/**
 * Save report settings into operatordetail.admin.reportSettings.ownerReport.
 */
async function saveReportSettings(clientId, settings = {}) {
  const [rows] = await pool.query('SELECT admin FROM operatordetail WHERE id = ? LIMIT 1', [clientId]);
  if (!rows.length) throw new Error('NO_CLIENT');
  let admin = rows[0].admin;
  if (typeof admin === 'string') {
    try { admin = JSON.parse(admin || '{}'); } catch { admin = {}; }
  }
  admin = admin && typeof admin === 'object' ? admin : {};
  const dayRaw = Number(settings.automationDay);
  const automationDay = Number.isFinite(dayRaw) ? Math.max(1, Math.min(31, Math.floor(dayRaw))) : 5;
  const prevOwner =
    admin.reportSettings && admin.reportSettings.ownerReport && typeof admin.reportSettings.ownerReport === 'object'
      ? admin.reportSettings.ownerReport
      : {};
  const modeIn =
    settings.reportClassificationMode !== undefined && settings.reportClassificationMode !== null
      ? (settings.reportClassificationMode === 'customize' ? 'customize' : 'standard')
      : (prevOwner.reportClassificationMode === 'customize' ? 'customize' : 'standard');
  const incKeys = Array.isArray(settings.reportIncomeKeys)
    ? normalizeReportClassificationKeys(settings.reportIncomeKeys)
    : normalizeReportClassificationKeys(prevOwner.reportIncomeKeys);
  const expKeys = Array.isArray(settings.reportExpenseKeys)
    ? normalizeReportClassificationKeys(settings.reportExpenseKeys)
    : normalizeReportClassificationKeys(prevOwner.reportExpenseKeys);
  const nextOwnerReport = {
    ...prevOwner,
    defaultCarryNegativeForward: settings.defaultCarryNegativeForward !== false,
    automationEnabled: settings.automationEnabled === true,
    automationDay,
    reportClassificationMode: modeIn,
    reportIncomeKeys: incKeys,
    reportExpenseKeys: expKeys
  };
  const nextAdmin = {
    ...admin,
    reportSettings: {
      ...(admin.reportSettings && typeof admin.reportSettings === 'object' ? admin.reportSettings : {}),
      ownerReport: nextOwnerReport
    }
  };
  await pool.query('UPDATE operatordetail SET admin = ?, updated_at = NOW() WHERE id = ?', [JSON.stringify(nextAdmin), clientId]);
  return {
    ok: true,
    settings: {
      defaultCarryNegativeForward: settings.defaultCarryNegativeForward !== false,
      automationEnabled: settings.automationEnabled === true,
      automationDay,
      reportClassificationMode: modeIn,
      reportIncomeKeys: incKeys,
      reportExpenseKeys: expKeys
    }
  };
}

function extractDriveFileId(urlOrId) {
  if (!urlOrId || typeof urlOrId !== 'string') return null;
  const s = urlOrId.trim();
  const byPath = s.match(/\/d\/([-\w]{10,})/);
  if (byPath && byPath[1]) return byPath[1];
  const byParam = s.match(/[?&]id=([-\w]{10,})/);
  if (byParam && byParam[1]) return byParam[1];
  if (/^[-\w]{10,}$/.test(s)) return s;
  return null;
}

async function getOwnerReportDriveStatus(clientId, payoutId) {
  const [rows] = await pool.query(
    'SELECT id, monthlyreport FROM ownerpayout WHERE id = ? AND client_id = ? LIMIT 1',
    [payoutId, clientId]
  );
  if (!rows.length) throw new Error('NOT_FOUND');
  const url = rows[0].monthlyreport ? String(rows[0].monthlyreport) : '';
  if (!url) return { ok: true, exists: false, reason: 'NO_URL', url: null };
  const fileId = extractDriveFileId(url);
  if (!fileId) return { ok: true, exists: false, reason: 'INVALID_URL', url };

  const { auth } = await getDriveAuthForClient(clientId);
  if (!auth) return { ok: true, exists: false, reason: 'GOOGLE_CREDENTIALS_NOT_CONFIGURED', url };
  const drive = google.drive({ version: 'v3', auth });
  try {
    await drive.files.get({ fileId, fields: 'id', supportsAllDrives: true });
    return { ok: true, exists: true, url, fileId };
  } catch (err) {
    const code = Number(err?.code || err?.response?.status || 0);
    if (code === 404) return { ok: true, exists: false, reason: 'FILE_NOT_FOUND', url, fileId };
    if (code === 403) return { ok: true, exists: false, reason: 'FILE_NO_ACCESS', url, fileId };
    return { ok: true, exists: false, reason: 'CHECK_FAILED', url, fileId };
  }
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function getLastDayOfMonth(year, month1to12) {
  return new Date(year, month1to12, 0).getDate();
}

function getEffectiveAutomationDay(automationDay, year, month1to12) {
  const dayRaw = Number(automationDay);
  const day = Number.isFinite(dayRaw) ? Math.max(1, Math.min(31, Math.floor(dayRaw))) : 5;
  return Math.min(day, getLastDayOfMonth(year, month1to12));
}

/**
 * Daily cron job: auto-generate previous month owner reports.
 * Trigger rule per client:
 * effectiveDay = min(settings.automationDay, lastDayOfCurrentMonth)
 * run only when today.day === effectiveDay.
 */
async function runOwnerReportMonthlyAutomation(todayMalaysiaDate = getTodayMalaysiaDate()) {
  const parts = String(todayMalaysiaDate || '').substring(0, 10).split('-').map(Number);
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error('INVALID_TODAY_DATE');
  }
  const [year, month, day] = parts;
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prevStart = `${prevYear}-${pad2(prevMonth)}-01`;
  const prevEnd = `${prevYear}-${pad2(prevMonth)}-${pad2(getLastDayOfMonth(prevYear, prevMonth))}`;
  const billPeriod = `${prevStart} - ${prevEnd}`;

  const [clientRows] = await pool.query('SELECT id, admin FROM operatordetail WHERE id IS NOT NULL');
  const summary = {
    today: todayMalaysiaDate,
    period: { startDate: prevStart, endDate: prevEnd },
    triggeredClients: [],
    skippedClients: [],
    generated: [],
    skippedReports: [],
    errors: []
  };

  for (const c of clientRows || []) {
    const clientId = c.id;
    let admin = c.admin;
    if (typeof admin === 'string') {
      try { admin = JSON.parse(admin || '{}'); } catch { admin = {}; }
    }
    admin = admin && typeof admin === 'object' ? admin : {};
    const ownerRaw = (admin.reportSettings && admin.reportSettings.ownerReport && typeof admin.reportSettings.ownerReport === 'object')
      ? admin.reportSettings.ownerReport
      : {};
    const automationEnabled = ownerRaw.automationEnabled === true;
    if (!automationEnabled) {
      summary.skippedClients.push({ clientId, reason: 'automation_disabled' });
      continue;
    }
    const automationDay = Number(ownerRaw.automationDay ?? 5);
    const effectiveDay = getEffectiveAutomationDay(automationDay, year, month);
    if (day !== effectiveDay) {
      summary.skippedClients.push({ clientId, reason: 'not_trigger_day', automationDay: Number.isFinite(automationDay) ? automationDay : 5, effectiveDay });
      continue;
    }

    summary.triggeredClients.push({ clientId, automationDay: Number.isFinite(automationDay) ? automationDay : 5, effectiveDay });
    const [properties] = await pool.query(
      'SELECT id, shortname FROM propertydetail WHERE client_id = ? AND COALESCE(archived, 0) = 0 ORDER BY shortname ASC',
      [clientId]
    );
    for (const p of properties || []) {
      const propertyId = p.id;
      const propertyName = p.shortname || p.id;
      try {
        const [existing] = await pool.query(
          `SELECT id
             FROM ownerpayout
            WHERE client_id = ?
              AND property_id = ?
              AND YEAR(DATE_ADD(period, INTERVAL 8 HOUR)) = ?
              AND MONTH(DATE_ADD(period, INTERVAL 8 HOUR)) = ?
            LIMIT 1`,
          [clientId, propertyId, prevYear, prevMonth]
        );
        if (Array.isArray(existing) && existing.length > 0) {
          summary.skippedReports.push({ clientId, propertyId, reason: 'already_exists_for_month' });
          continue;
        }

        const payout = await generateOwnerPayout(clientId, propertyId, propertyName, prevStart, prevEnd);
        const monthName = new Date(`${prevStart}T12:00:00`).toLocaleString('en-US', { month: 'long' });
        const title = `${monthName} ${prevYear} ${propertyName}`;
        const inserted = await insertOwnerReport(clientId, {
          property: propertyId,
          period: prevStart,
          title,
          totalrental: payout?.totalrental ?? 0,
          totalutility: payout?.totalutility ?? 0,
          totalcollection: payout?.totalcollection ?? 0,
          expenses: payout?.expenses ?? 0,
          managementfee: payout?.managementfee ?? 0,
          netpayout: payout?.netpayout ?? 0
        });
        const payoutId = inserted?.record?._id;
        if (payoutId) {
          try {
            const buffer = await buildOwnerReportPdfBuffer(payout?.rows || [], propertyName, billPeriod);
            const fileName = `${billPeriod.replace(/\s+/g, '_')}_${String(propertyName).replace(/\s+/g, '_')}.pdf`;
            await uploadOwnerReportPdfToDrive({ buffer, fileName, payoutId, clientId });
          } catch (uploadErr) {
            summary.errors.push({ clientId, propertyId, reason: uploadErr?.message || String(uploadErr), stage: 'upload_pdf' });
          }
        }
        summary.generated.push({ clientId, propertyId, payoutId: payoutId || null });
      } catch (err) {
        summary.errors.push({ clientId, propertyId, reason: err?.message || String(err), stage: 'generate_report' });
      }
    }
  }

  return summary;
}

module.exports = {
  getClientIdByEmail,
  getPropertiesForClient,
  getOwnerReports,
  getOwnerReportsTotal,
  getOwnerReport,
  getPayoutRowsForPdf,
  getPayoutClientId,
  insertOwnerReport,
  updateOwnerReport,
  deleteOwnerReport,
  generateOwnerPayout,
  bulkUpdateOwnerReport,
  uploadOwnerReportPdfToDrive,
  finalizeOwnerReportPdf,
  getReportSettings,
  saveReportSettings,
  runOwnerReportMonthlyAutomation,
  getOwnerReportDriveStatus
};
