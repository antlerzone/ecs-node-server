/**
 * Billing – migrated from Wix backend/billing/billing.jsw.
 * Uses MySQL: operatordetail (id, title, currency, expired, pricingplandetail, credit),
 * pricingplan, pricingplanaddon. Access via getAccessContextByEmail (staff/client, permission).
 * Credit statements (getCreditStatements) use creditlogs table (see migration 0030).
 */

const pool = require('../../config/db');
const {
  malaysiaDateToUtcDatetimeForDb,
  getMalaysiaMonthStartYmd,
  getMalaysiaMonthStartMonthsAgo
} = require('../../utils/dateMalaysia');
const { isRetiredPricingPlanAddon } = require('../../utils/pricingPlanAddonCatalog');
const { getAccessContextByEmail, getAccessContextByEmailAndClient } = require('../access/access.service');
const { ensureMasterAdminUserForClient } = require('./indoor-admin.service');

let clientBillingCache = {};
let creditLogCache = {};

/**
 * Resolve billing context by email and optional clientId. When clientId given but no context,
 * ensures master admin for that client if company email matches, then retries. Used by getMyBillingInfo and getCreditStatements.
 */
async function getBillingContext(email, clientId) {
  let ctx = clientId
    ? await getAccessContextByEmailAndClient(email, clientId)
    : await getAccessContextByEmail(email);
  if (ctx.ok && ctx.client?.id) return ctx;
  if (clientId) {
    const reqEmail = String(email).trim().toLowerCase();
    const [clientRows] = await pool.query(
      'SELECT id, email, status FROM operatordetail WHERE id = ? LIMIT 1',
      [clientId]
    );
    const clientRow = clientRows[0];
    const clientEmailNorm = clientRow?.email ? String(clientRow.email).trim().toLowerCase() : '';
    if (clientRow && reqEmail && (clientEmailNorm === reqEmail || !clientEmailNorm)) {
      if (!clientEmailNorm) {
        await pool.query('UPDATE operatordetail SET email = ?, updated_at = NOW() WHERE id = ?', [email.trim(), clientId]);
      }
      try {
        await ensureMasterAdminUserForClient(clientId);
        if (clientRow.status !== 1 && clientRow.status !== true) {
          await pool.query('UPDATE operatordetail SET status = 1, updated_at = NOW() WHERE id = ?', [clientId]);
        }
        ctx = await getAccessContextByEmailAndClient(email, clientId);
      } catch (e) {}
    }
  }
  if (!ctx?.ok && !clientId) {
    const ctxByEmail = await getAccessContextByEmail(email);
    if (ctxByEmail?.ok && ctxByEmail?.client?.id) ctx = ctxByEmail;
  }
  return ctx;
}

/**
 * Parse JSON column from DB (string or already object).
 */
function parseJson(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  if (typeof val !== 'string') return null;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

function safeTrim(val) {
  if (val == null) return '';
  return String(val).trim();
}

function pickFirstNonEmpty(obj, keys) {
  if (!obj || typeof obj !== 'object') return '';
  for (const key of keys) {
    const v = safeTrim(obj[key]);
    if (v) return v;
  }
  return '';
}

function toMoneyFromCents(val) {
  const n = Number(val);
  if (!Number.isFinite(n)) return 0;
  return Number((n / 100).toFixed(2));
}

async function resolveProcessingFeeReferenceMap(referenceKeys) {
  const keys = Array.from(new Set((referenceKeys || []).map((k) => safeTrim(k)).filter(Boolean)));
  if (!keys.length) return new Map();
  const placeholders = keys.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT
       rc.referenceid,
       'rentalcollection' AS source,
       rc.id AS record_id,
       rc.invoiceid AS invoice_id,
       rc.tenancy_id,
       td.fullname AS tenant_name,
       rm.roomname AS room_name,
       p.shortname AS property_name
     FROM rentalcollection rc
     LEFT JOIN tenancy t ON t.id = rc.tenancy_id
     LEFT JOIN tenantdetail td ON td.id = COALESCE(t.tenant_id, rc.tenant_id)
     LEFT JOIN roomdetail rm ON rm.id = COALESCE(t.room_id, rc.room_id)
     LEFT JOIN propertydetail p ON p.id = COALESCE(rm.property_id, rc.property_id)
     WHERE rc.referenceid IN (${placeholders})
     UNION ALL
     SELECT
       mt.referenceid,
       'metertransaction' AS source,
       mt.id AS record_id,
       mt.invoiceid AS invoice_id,
       mt.tenancy_id,
       td.fullname AS tenant_name,
       rm.roomname AS room_name,
       p.shortname AS property_name
     FROM metertransaction mt
     LEFT JOIN tenancy t2 ON t2.id = mt.tenancy_id
     LEFT JOIN tenantdetail td ON td.id = COALESCE(t2.tenant_id, mt.tenant_id)
     LEFT JOIN roomdetail rm ON rm.id = t2.room_id
     LEFT JOIN propertydetail p ON p.id = rm.property_id
     WHERE mt.referenceid IN (${placeholders})
     ORDER BY record_id DESC`,
    [...keys, ...keys]
  );
  const map = new Map();
  for (const r of rows || []) {
    const ref = safeTrim(r.referenceid);
    if (!ref || map.has(ref)) continue;
    map.set(ref, {
      tenancyId: safeTrim(r.tenancy_id),
      tenantName: safeTrim(r.tenant_name),
      roomName: safeTrim(r.room_name),
      propertyName: safeTrim(r.property_name),
      source: safeTrim(r.source),
      recordId: safeTrim(r.record_id),
      invoiceId: safeTrim(r.invoice_id)
    });
  }
  return map;
}

/**
 * getMyBillingInfo – same contract as Velo getMyBillingInfo().
 * Requires email in request (body or query); returns { noPermission?, reason?, currency?, title?, plan?, credit?, expired?, pricingplandetail? }.
 * When access fails or client missing, returns { noPermission: true, reason } so API stays 200 and JSW does not show BACKEND_ERROR.
 */
async function getMyBillingInfo(email, clientId) {
  if (!email || typeof email !== 'string' || !String(email).trim()) {
    return { noPermission: true, reason: 'NO_EMAIL' };
  }

  const ctx = await getBillingContext(email, clientId);
  if (!ctx.ok) {
    return { noPermission: true, reason: ctx.reason || 'ACCESS_DENIED' };
  }

  // Permission check disabled for now – will re-enable later.
  const cid = ctx.client?.id;
  if (!cid) {
    return { noPermission: true, reason: 'NO_CLIENT_ID' };
  }

  // Credit balance: always from client_credit table (single source of truth for UI "Total Balance / Core / Flex")
  const [creditRows] = await pool.query(
    'SELECT type, COALESCE(SUM(amount), 0) AS total FROM client_credit WHERE client_id = ? GROUP BY type',
    [cid]
  );
  const creditFromTable = (creditRows || []).map((r) => ({ type: (r.type || 'flex').toLowerCase(), amount: Number(r.total) || 0 }));

  if (clientBillingCache[cid]) {
    return { ...clientBillingCache[cid], credit: creditFromTable };
  }

  const [clientRows] = await pool.query(
    'SELECT id, title, currency, expired, pricingplandetail, credit, creditusage FROM operatordetail WHERE id = ? LIMIT 1',
    [cid]
  );

  if (!clientRows.length) {
    return { noPermission: true, reason: 'CLIENT_NOT_FOUND' };
  }

  const client = clientRows[0];
  const rawPricingPlanDetail = parseJson(client.pricingplandetail);
  const pricingplandetail = Array.isArray(rawPricingPlanDetail) ? rawPricingPlanDetail : [];
  const credit = creditFromTable;

  const [planRows] = await pool.query('SELECT id, title FROM pricingplan');
  const planMap = {};
  planRows.forEach((p) => { planMap[p.id] = p.title; });

  const [addonRows] = await pool.query('SELECT id, title FROM pricingplanaddon');
  const addonMap = {};
  addonRows.forEach((a) => { addonMap[a.id] = a.title; });

  const hydrated = pricingplandetail.map((i) => {
    if (i.type === 'plan') {
      return { ...i, title: planMap[i.planId] || 'Plan' };
    }
    if (i.type === 'addon') {
      return { ...i, title: addonMap[i.planId] || 'Addon' };
    }
    return i;
  });

  const planItem = hydrated.find((i) => i.type === 'plan') || null;

  const result = {
    noPermission: false,
    currency: client.currency || undefined,
    title: client.title || undefined,
    plan: planItem
      ? {
          planId: planItem.planId,
          title: planItem.title,
          expired: planItem.expired
        }
      : null,
    credit,
    expired: client.expired || undefined,
    pricingplandetail: hydrated,
    creditusage: client.creditusage != null && String(client.creditusage).trim() ? String(client.creditusage).trim() : undefined
  };

  clientBillingCache[cid] = result;
  return result;
}

/**
 * Pricing plan ID → included user seats counted toward client_user limit (master + team; same unit as COUNT(client_user)).
 * Unknown plan → 1. Extra User addon qty is added in getClientUserLimitBreakdown; total capped at 10.
 */
const PLAN_INCLUDED_USERS = {
  // Enterprise / Enterprise Plus（已有高级方案）
  '896357c8-1155-47de-9d3c-15055a4820aa': 4,
  '06af7357-f9c8-4319-98c3-b24e1fa7ae27': 3,
  // 当前 pricingplan 表中的 Enterprise / Enterprise Plus（与 ACCOUNTING_PLAN_IDS 对齐）
  'dd81f45d-62e0-428a-af9b-ce436735a08d': 4,
  'd8bbcfcf-4e33-4fc5-8bcb-cbc0bb28fc1c': 4,
  // 之前配过的高级方案（保持向后兼容）
  'e119144a-24b1-4fc6-ba0d-4c5c3f3184c6': 2,
  '80991cd1-b17a-4d68-9b21-21a1df76120c': 2,
  // Elite：送 2 个 staff user
  '424d907f-d2bc-46f1-adc6-787ef2dc983b': 2
};

function getPlanIncludedUserCount(planId) {
  if (!planId || typeof planId !== 'string') return 1;
  const n = PLAN_INCLUDED_USERS[String(planId).trim()];
  return typeof n === 'number' && n >= 1 ? n : 1;
}

/**
 * Plan-included seats + Extra User addon (title match "extra" + "user" on pricingplanaddon) → max client_user rows. Cap 10.
 */
async function getClientUserLimitBreakdown(clientId) {
  if (!clientId) {
    return { planId: null, planIncluded: 1, extraUserAddon: 0, maxTotal: 1 };
  }
  let planId = null;
  const [planRows] = await pool.query(
    `SELECT plan_id FROM client_pricingplan_detail WHERE client_id = ? AND type = 'plan' LIMIT 1`,
    [clientId]
  );
  if (planRows && planRows[0] && planRows[0].plan_id) planId = planRows[0].plan_id;
  if (!planId) {
    const [clientRows] = await pool.query('SELECT pricingplan_id FROM operatordetail WHERE id = ? LIMIT 1', [clientId]);
    if (clientRows && clientRows[0] && clientRows[0].pricingplan_id) planId = clientRows[0].pricingplan_id;
  }
  const planIncluded = getPlanIncludedUserCount(planId);
  const caps = await getClientAddonCapabilities(clientId);
  const extraUserAddon = Number(caps.extraUserQty) || 0;
  const maxTotal = Math.min(10, Math.max(1, planIncluded + extraUserAddon));
  return { planId, planIncluded, extraUserAddon, maxTotal };
}

/**
 * Max client_user rows: plan included + Extra User addon（最多 10）.
 * Used by companysetting getStaffList / createStaff for #buttonnewuser and #repeaterusersetting limit.
 */
async function getClientMaxStaffAllowed(clientId) {
  const b = await getClientUserLimitBreakdown(clientId);
  return b.maxTotal;
}

/** Same cap as getClientMaxStaffAllowed; used for client_user count (Company Setting user limit). */
async function getClientMaxUserAllowed(clientId) {
  return getClientMaxStaffAllowed(clientId);
}

/**
 * getClientAddonCapabilities – by client_id only (no auth). Used to gate bank bulk transfer and extra-user count.
 * Reads client_pricingplan_detail (type='addon') with title from pricingplanaddon fallback.
 * Returns { hasBankBulkTransfer: boolean, extraUserQty: number }. Extra user addon matched by title containing "extra" and "user"; bank bulk by "bank" and "bulk transfer".
 */
async function getClientAddonCapabilities(clientId) {
  if (!clientId) return { hasBankBulkTransfer: false, extraUserQty: 0 };
  const [rows] = await pool.query(
    `SELECT cpd.plan_id, cpd.qty, COALESCE(NULLIF(TRIM(cpd.title), ''), ppa.title) AS title
     FROM client_pricingplan_detail cpd
     LEFT JOIN pricingplanaddon ppa ON ppa.id = cpd.plan_id
     WHERE cpd.client_id = ? AND cpd.type = 'addon'`,
    [clientId]
  );
  let hasBankBulkTransfer = false;
  let extraUserQty = 0;
  const bankPattern = /bank\s*bulk\s*transfer/i;
  const extraUserPattern = /extra\s*user/i;
  for (const r of rows || []) {
    const title = String(r.title || '').trim();
    if (bankPattern.test(title)) hasBankBulkTransfer = true;
    if (extraUserPattern.test(title)) extraUserQty += Number(r.qty) || 0;
  }
  return { hasBankBulkTransfer, extraUserQty };
}

/**
 * getCreditStatements – paginated credit logs from creditlogs table (id, client_id, type, title, amount, reference_number, created_at).
 * opts may include clientId; when provided, uses that client (with same ensure-master-admin fallback as my-info).
 */
async function getCreditStatements(email, { page = 1, pageSize = 10, sort = 'new', filterType = null, search = '', clientId: clientIdOpt = null } = {}) {
  const ctx = await getBillingContext(email, clientIdOpt);
  if (!ctx.ok) throw new Error(ctx.reason || 'ACCESS_DENIED');
  const clientId = ctx.client?.id;
  if (!clientId) throw new Error('NO_CLIENT_ID');

  const cacheKey = `${clientId}_${page}_${sort}_${filterType}_${search}`;
  if (creditLogCache[cacheKey]) return creditLogCache[cacheKey];

  let orderBy = 'created_at DESC';
  if (sort === 'old') orderBy = 'created_at ASC';
  else if (sort === 'amountAsc') orderBy = 'amount ASC';
  else if (sort === 'amountDesc') orderBy = 'amount DESC';

  const selectBase = 'SELECT id, type, title, amount, reference_number, created_at';
  const selectWithInvoice = selectBase + ', invoiceid, invoiceurl';
  let sql = selectWithInvoice + ' FROM creditlogs WHERE client_id = ? AND ' + SQL_EXCLUDE_UNPAID_ONLINE_TOPUP;
  const params = [clientId];
  if (filterType === 'Topup') { sql += ' AND type = ?'; params.push('Topup'); }
  if (filterType === 'Spending') { sql += ' AND type = ?'; params.push('Spending'); }
  if (search) {
    sql += ' AND (title LIKE ? OR reference_number LIKE ?)';
    const like = '%' + search + '%';
    params.push(like, like);
  }
  const countParams = [clientId];
  let countSql = 'SELECT COUNT(*) AS total FROM creditlogs WHERE client_id = ? AND ' + SQL_EXCLUDE_UNPAID_ONLINE_TOPUP;
  if (filterType === 'Topup') { countSql += ' AND type = ?'; countParams.push('Topup'); }
  if (filterType === 'Spending') { countSql += ' AND type = ?'; countParams.push('Spending'); }
  if (search) { countSql += ' AND (title LIKE ? OR reference_number LIKE ?)'; countParams.push('%' + search + '%', '%' + search + '%'); }
  const [countRows] = await pool.query(countSql, countParams);
  const total = countRows[0].total;
  sql += ' ORDER BY ' + orderBy + ' LIMIT ? OFFSET ?';
  params.push(pageSize, (page - 1) * pageSize);
  let rows;
  try {
    [rows] = await pool.query(sql, params);
  } catch (err) {
    if (String(err?.message || '').includes('Unknown column') && (err.message.includes('invoiceid') || err.message.includes('invoiceurl'))) {
      const fallbackSql = selectBase + ' FROM creditlogs WHERE client_id = ? AND ' + SQL_EXCLUDE_UNPAID_ONLINE_TOPUP + (filterType === 'Topup' ? ' AND type = ?' : '') + (filterType === 'Spending' ? ' AND type = ?' : '') + (search ? ' AND (title LIKE ? OR reference_number LIKE ?)' : '') + ' ORDER BY ' + orderBy + ' LIMIT ? OFFSET ?';
      [rows] = await pool.query(fallbackSql, params);
    } else throw err;
  }
  const bukkuSub = process.env.BUKKU_SAAS_SUBDOMAIN || process.env.BUKKU_SAAS_BUKKUSUBDOMAIN;
  const buildInvoiceUrl = (invoiceid, invoiceurl) => {
    const u = invoiceurl != null ? String(invoiceurl).trim() : '';
    if (u && /^https?:\/\//i.test(u)) return u;
    if (invoiceid != null && bukkuSub) return `https://${String(bukkuSub).trim()}.bukku.my/invoices/${invoiceid}`.replace(/\/+/g, '/');
    return null;
  };
  const result = {
    items: rows.map((r) => {
      const invId = r.invoiceid != null ? r.invoiceid : null;
      const invUrl = buildInvoiceUrl(invId, r.invoiceurl);
      return {
        id: r.id,
        type: r.type,
        title: r.title,
        amount: r.amount,
        reference_number: r.reference_number,
        created_at: r.created_at,
        invoiceId: invId,
        invoiceUrl: invUrl
      };
    }),
    total,
    page,
    pageSize
  };
  creditLogCache[cacheKey] = result;
  return result;
}

/**
 * clearBillingCache – clear in-memory caches for current client (and all credit log caches).
 */
async function clearBillingCache(email) {
  const ctx = await getAccessContextByEmail(email);
  const clientId = ctx.client?.id;
  if (clientId) delete clientBillingCache[clientId];
  creditLogCache = {};
}

/**
 * clearBillingCacheByClientId – clear caches for a given client (used by deduction).
 */
function clearBillingCacheByClientId(clientId) {
  if (clientId) delete clientBillingCache[clientId];
  creditLogCache = {};
}

let clientCache = null;

/**
 * getMyClient – same contract as Wix backend/query/operatordetail.jsw getMyClient().
 * Returns client row (id, title, status, currency, credit, pricingplandetail) or null.
 */
async function getMyClient(email) {
  if (clientCache) return clientCache;
  const ctx = await getAccessContextByEmail(email);
  if (!ctx?.ok || !ctx.client?.id) return null;
  const [rows] = await pool.query(
    'SELECT id, title, status, currency, credit, pricingplandetail, expired FROM operatordetail WHERE id = ? LIMIT 1',
    [ctx.client.id]
  );
  if (!rows.length || (rows[0].status !== 1 && rows[0].status !== true)) return null;
  clientCache = rows[0];
  return clientCache;
}

function clearClientCache() {
  clientCache = null;
}

/**
 * getPlans – list pricing plans for billing UI (access + billing permission).
 * Returns array of { id, title, description, sellingprice, corecredit } for repeater; frontend may use id as _id.
 */
async function getPlans(email, clientId) {
  const ctx = clientId
    ? await getAccessContextByEmailAndClient(email, clientId)
    : await getAccessContextByEmail(email);
  if (!ctx.ok) throw new Error(ctx.reason || 'ACCESS_DENIED');
  const [rows] = await pool.query(
    'SELECT id, title, description, sellingprice, corecredit FROM pricingplan ORDER BY sellingprice ASC'
  );
  return rows.map((r) => ({
    id: r.id,
    _id: r.id,
    title: r.title,
    description: r.description,
    sellingprice: r.sellingprice,
    corecredit: r.corecredit
  }));
}

/**
 * getAddons – list pricing plan addons for billing UI (table pricingplanaddon).
 * Returns array of { id, _id, title, description, credit, qty }; credit from credit_json for display.
 */
async function getAddons(email, clientId) {
  const ctx = clientId
    ? await getAccessContextByEmailAndClient(email, clientId)
    : await getAccessContextByEmail(email);
  if (!ctx.ok) throw new Error(ctx.reason || 'ACCESS_DENIED');
  const [rows] = await pool.query(
    'SELECT id, title, description_json, credit_json, qty FROM pricingplanaddon ORDER BY title ASC'
  );
  return rows.filter((r) => !isRetiredPricingPlanAddon(r.title)).map((r) => {
    const desc = parseJson(r.description_json);
    const creditRaw = parseJson(r.credit_json);
    const creditDisplay = Array.isArray(creditRaw) ? (creditRaw[0] != null ? String(creditRaw[0]) : '') : (creditRaw != null ? String(creditRaw) : '');
    return {
      id: r.id,
      _id: r.id,
      title: r.title,
      description: Array.isArray(desc) ? desc : desc != null ? [desc] : [],
      credit: creditDisplay || '',
      qty: r.qty
    };
  });
}

/**
 * getCreditPlans – list credit plans for topup UI.
 * Returns array of { id, _id, title, sellingprice, credit }.
 */
async function getCreditPlans(email, clientId) {
  const ctx = clientId
    ? await getAccessContextByEmailAndClient(email, clientId)
    : await getAccessContextByEmail(email);
  if (!ctx.ok) throw new Error(ctx.reason || 'ACCESS_DENIED');
  const [rows] = await pool.query(
    'SELECT id, title, sellingprice, credit FROM creditplan ORDER BY credit ASC'
  );
  return rows.map((r) => ({
    id: r.id,
    _id: r.id,
    title: r.title,
    sellingprice: r.sellingprice,
    credit: r.credit
  }));
}

/**
 * Operator Credit statement: friendly labels for SaaS processing fee lines (Spending + titles, or legacy PayexFee / BillplzFee / RentRelease).
 */
function formatOperatorProcessingFeeDisplayTitle(title, creditType, referenceNumber) {
  const ref = String(referenceNumber || '').trim();
  const ct = String(creditType || '');
  const rawTitle = String(title || '').trim();
  if (rawTitle === 'Stripe Processing Fees') return 'processing fees (stripe)';
  if (rawTitle === 'Xendit Processing Fees') return 'processing fees (xendit)';
  if (rawTitle === 'Billplz Processing Fees') return 'processing fees (billplz)';
  if (ct === 'BillplzFee') return 'processing fees (billplz)';
  if (ct === 'PayexFee') return 'processing fees (xendit)';
  if (ct === 'RentRelease') return 'processing fees (stripe)';

  const raw = rawTitle;
  const tl = raw.toLowerCase();
  if (tl === 'free credit') return 'Free Credit';
  const looksLikeGatewayFee =
    tl.includes('platform markup') ||
    tl.includes('xendit processing fee') ||
    (tl.includes('processing fee') && (tl.includes('1%') || tl.includes('pending')));
  if (looksLikeGatewayFee) {
    if (/^BP-/i.test(ref)) return 'processing fees (billplz)';
    if (/^PF-/i.test(ref)) return 'processing fees (xendit)';
    if (/^RR-/i.test(ref)) return 'processing fees (stripe)';
  }
  return raw || '-';
}

/**
 * Online checkout top-up placeholder: INSERT before redirect (topup.service), reference TP-{uuid}.
 * Unpaid rows must not appear in statement or running balance; manual bank requests use TOP-* refs.
 */
function isUnpaidOnlineTopupPlaceholder(row) {
  if (String(row.type || '') !== 'Topup') return false;
  if (row.is_paid === 1 || row.is_paid === true) return false;
  const amt = Number(row.amount);
  if (!(amt > 0)) return false;
  return /^TP-/i.test(String(row.reference_number || '').trim());
}

const SQL_EXCLUDE_UNPAID_ONLINE_TOPUP =
  " NOT (type = 'Topup' AND COALESCE(is_paid, 0) != 1 AND reference_number LIKE 'TP-%' AND amount > 0) ";

/**
 * getStatementItems – merged creditlogs + pricingplanlogs for event log repeater (sort/filter/paginate).
 * filterType: null | 'Topup' | 'Spending' | 'creditOnly' | 'planOnly'
 * sort: 'new' | 'old' | 'amountAsc' | 'amountDesc'
 * opts.clientId – when provided (e.g. from operator portal), use this client after verifying staff access.
 * Returns { items, total, page, pageSize, walletTotalCredits?, creditLogNetTotal?, creditsLedgerDelta? }.
 * walletTotalCredits = SUM(client_credit); creditLogNetTotal = SUM(creditlogs.amount).
 */
async function getStatementItems(email, { page = 1, pageSize = 10, sort = 'new', filterType = null, search = '', clientId: optsClientId } = {}) {
  const ctx = optsClientId
    ? await getAccessContextByEmailAndClient(email, optsClientId)
    : await getAccessContextByEmail(email);
  if (!ctx.ok) throw new Error(ctx.reason || 'ACCESS_DENIED');
  // Permission check disabled for now – will re-enable later.
  const clientId = ctx.client?.id != null ? String(ctx.client.id) : null;
  if (!clientId) throw new Error('NO_CLIENT_ID');

  const clientCurrency =
    ctx.client?.currency != null && String(ctx.client.currency).trim()
      ? String(ctx.client.currency).trim().toUpperCase()
      : null;

  // invoiceid/invoiceurl from migrations 0067+0068 – if columns missing, use fallback query (no invoice link).
  let creditRows;
  let planLogRows;
  const creditSelectFull = 'SELECT id, type, title, amount, created_at, currency, reference_number, is_paid, invoiceid, invoiceurl FROM creditlogs WHERE client_id = ? ORDER BY id';
  const creditSelectMin = 'SELECT id, type, title, amount, created_at, currency, reference_number, is_paid FROM creditlogs WHERE client_id = ? ORDER BY id';
  const planSelectFull = `SELECT l.id, l.title, l.amount, l.created_at, l.plan_id, l.status, l.invoiceid, l.invoiceurl, p.corecredit, p.sellingprice
     FROM pricingplanlogs l LEFT JOIN pricingplan p ON p.id = l.plan_id
     WHERE l.client_id = ? AND LOWER(TRIM(COALESCE(l.status,''))) = 'paid' ORDER BY l.id`;
  const planSelectMin = `SELECT l.id, l.title, l.amount, l.created_at, l.plan_id, l.status, p.corecredit, p.sellingprice
     FROM pricingplanlogs l LEFT JOIN pricingplan p ON p.id = l.plan_id
     WHERE l.client_id = ? AND LOWER(TRIM(COALESCE(l.status,''))) = 'paid' ORDER BY l.id`;

  try {
    [creditRows] = await pool.query(creditSelectFull, [clientId]);
    [planLogRows] = await pool.query(planSelectFull, [clientId]);
  } catch (err) {
    const msg = (err && err.message) ? String(err.message) : '';
    if (msg.includes("Unknown column 'invoiceid'") || msg.includes("Unknown column 'invoiceurl'")) {
      [creditRows] = await pool.query(creditSelectMin, [clientId]);
      [planLogRows] = await pool.query(planSelectMin, [clientId]);
      console.log('[BILLING statement-items] using fallback query (no invoiceid/invoiceurl columns); run 0067+0068 for invoice links.');
    } else {
      throw err;
    }
  }
  console.log('[BILLING statement-items] email=%s clientId=%s creditRows=%s', String(email).slice(0, 3) + '***', clientId, creditRows.length);

  /** Wallet (authoritative UI header) vs sum(creditlogs.amount) — differ if ledger adjustments or backfills were applied to one table only. */
  let walletTotalCredits = null;
  let creditLogNetTotal = null;
  try {
    const [wRows] = await pool.query(
      'SELECT COALESCE(SUM(amount), 0) AS t FROM client_credit WHERE client_id = ?',
      [clientId]
    );
    walletTotalCredits = Number(wRows[0]?.t) || 0;
    const [cRows] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS s FROM creditlogs WHERE client_id = ? AND ${SQL_EXCLUDE_UNPAID_ONLINE_TOPUP}`,
      [clientId]
    );
    creditLogNetTotal = Number(cRows[0]?.s) || 0;
  } catch (e) {
    console.warn('[BILLING statement-items] wallet vs creditlogs reconcile skipped:', e?.message || e);
  }

  const bukkuSub = process.env.BUKKU_SAAS_SUBDOMAIN || process.env.BUKKU_SAAS_BUKKUSUBDOMAIN;
  const buildInvoiceUrl = (invoiceid, invoiceurl) => {
    const u = invoiceurl != null ? String(invoiceurl).trim() : '';
    if (u && /^https?:\/\//i.test(u)) return u;
    if (invoiceid != null && bukkuSub) return `https://${String(bukkuSub).trim()}.bukku.my/invoices/${invoiceid}`.replace(/\/+/g, '/');
    return null;
  };
  let items = [];
  creditRows.forEach((r) => {
    if (isUnpaidOnlineTopupPlaceholder(r)) return;
    const curr = r.currency != null && String(r.currency).trim() ? String(r.currency).trim().toUpperCase() : null;
    const invId = r.invoiceid != null ? r.invoiceid : null;
    items.push({
      _id: 'credit_' + r.id,
      type: 'credit',
      title: formatOperatorProcessingFeeDisplayTitle(r.title, r.type, r.reference_number),
      amount: Number(r.amount) || 0,
      _createdDate: r.created_at,
      currency: curr,
      reference_number: r.reference_number || null,
      is_paid: r.is_paid === 1 || r.is_paid === true,
      invoiceId: invId,
      invoiceUrl: buildInvoiceUrl(invId, r.invoiceurl)
    });
  });
  planLogRows.forEach((r) => {
    const invId = r.invoiceid != null ? r.invoiceid : null;
    items.push({
      _id: 'plan_' + r.id,
      type: 'plan',
      title: r.title || '-',
      corecredit: Number(r.corecredit) || 0,
      sellingprice: Number(r.sellingprice) || Number(r.amount) || 0,
      _createdDate: r.created_at,
      currency: clientCurrency,
      invoiceId: invId,
      invoiceUrl: buildInvoiceUrl(invId, r.invoiceurl)
    });
  });

  if (filterType === 'Topup') items = items.filter((i) => i.type === 'credit' && i.amount >= 0);
  if (filterType === 'Spending') items = items.filter((i) => i.type === 'credit' && i.amount < 0);
  if (filterType === 'creditOnly') items = items.filter((i) => i._id.startsWith('credit_'));
  if (filterType === 'planOnly') items = items.filter((i) => i._id.startsWith('plan_'));

  // Balance: creditlogs table has no balance column; computed here (running balance by date asc).
  const creditOnlyForBalance = items.filter((i) => i.type === 'credit');
  if (creditOnlyForBalance.length > 0) {
    const byDateAsc = [...creditOnlyForBalance].sort((a, b) => (new Date(a._createdDate) || 0) - (new Date(b._createdDate) || 0));
    let running = 0;
    const balanceByKey = {};
    byDateAsc.forEach((i) => {
      running += Number(i.amount) || 0;
      balanceByKey[i._id] = running;
    });
    items.forEach((i) => {
      if (i.type === 'credit' && balanceByKey[i._id] !== undefined) i.balance = balanceByKey[i._id];
    });
    // Debug: log balance attachment (first 5 credit items)
    const withBalance = items.filter((i) => i.type === 'credit' && i.balance !== undefined);
    console.log('[BILLING statement-items] balance computed: creditOnlyForBalance=%s, withBalance=%s, sample=%s',
      creditOnlyForBalance.length, withBalance.length,
      withBalance.slice(0, 5).map((i) => ({ _id: i._id, amount: i.amount, balance: i.balance }))
    );
  }

  if (search && search.trim()) {
    const term = search.trim().toLowerCase();
    items = items.filter((i) => (i.title || '').toLowerCase().includes(term));
  }

  const orderBy = sort === 'old' ? (a, b) => (new Date(a._createdDate) || 0) - (new Date(b._createdDate) || 0)
    : sort === 'amountAsc' ? (a, b) => (Number(a.amount) || (a.sellingprice != null ? a.sellingprice : 0)) - (Number(b.amount) || (b.sellingprice != null ? b.sellingprice : 0))
    : sort === 'amountDesc' ? (a, b) => (Number(b.amount) || (b.sellingprice != null ? b.sellingprice : 0)) - (Number(a.amount) || (a.sellingprice != null ? a.sellingprice : 0))
    : (a, b) => (new Date(b._createdDate) || 0) - (new Date(a._createdDate) || 0);
  items.sort(orderBy);

  const total = items.length;
  const start = (page - 1) * pageSize;
  const paginated = items.slice(start, start + pageSize);
  const paginatedWithBalance = paginated.filter((i) => i.balance !== undefined);
  console.log('[BILLING statement-items] planLogRows=%s merged items=%s total=%s paginated=%s paginatedWithBalance=%s sample=%s',
    planLogRows.length, items.length, total, paginated.length, paginatedWithBalance.length,
    paginated.slice(0, 3).map((i) => ({ _id: i._id, type: i.type, balance: i.balance }))
  );

  return {
    items: paginated,
    total,
    page,
    pageSize,
    walletTotalCredits,
    creditLogNetTotal,
    creditsLedgerDelta:
      walletTotalCredits != null && creditLogNetTotal != null
        ? Math.round((walletTotalCredits - creditLogNetTotal) * 1000) / 1000
        : null
  };
}

/**
 * getManualBillingClients – list clients for manual billing dropdown and #repeaterclient.
 * Requires staff with admin or billing permission. Returns all clients with id, title, email, status, expired, hasPlan, planTitle.
 * planTitle = current plan name from pricingplandetail (type=plan item); expired formatted as YYYY-MM-DD for display.
 */
async function getManualBillingClients(email) {
  const ctx = await getAccessContextByEmail(email);
  if (!ctx.ok) throw new Error(ctx.reason || 'ACCESS_DENIED');
  // Permission check disabled for now – will re-enable later.

  const [rows] = await pool.query(
    'SELECT id, title, email, status, expired, pricingplandetail FROM operatordetail ORDER BY title ASC'
  );
  const [balanceRows] = await pool.query(
    'SELECT client_id, COALESCE(SUM(amount), 0) AS balance FROM client_credit GROUP BY client_id'
  );
  const balanceByClient = {};
  for (const r of balanceRows || []) {
    balanceByClient[r.client_id] = Number(r.balance) || 0;
  }

  return rows.map((r) => {
    const ppd = parseJson(r.pricingplandetail) || [];
    const planItem = Array.isArray(ppd) ? ppd.find((i) => i && (i.type === 'plan' || i.type === 'Plan')) : null;
    const hasPlan = !!planItem;
    const planTitle = (planItem && (planItem.title || planItem.planTitle)) ? String(planItem.title || planItem.planTitle).trim() : '';
    let expiredStr = r.expired == null ? '' : String(r.expired).trim();
    if (expiredStr && !/^\d{4}-\d{2}-\d{2}/.test(expiredStr)) {
      try { expiredStr = new Date(r.expired).toISOString().slice(0, 10); } catch { expiredStr = ''; }
    }
    return {
      id: r.id,
      _id: r.id,
      title: r.title,
      email: r.email,
      status: r.status,
      expired: r.expired,
      expiredStr: expiredStr.slice(0, 10),
      hasPlan: !!hasPlan,
      planTitle: planTitle || '',
      balanceCredit: balanceByClient[r.id] ?? 0
    };
  });
}

/**
 * getPendingManualBillingTickets – list tickets with mode in ('billing_manual', 'topup_manual') for manual billing dashboard repeater.
 * Requires staff with admin or billing permission. Returns items with id, mode, description, ticketid, created_at, client_id, clientTitle.
 * If ticket table does not exist (migration 0031 not run), returns [] so the page still loads.
 */
async function getPendingManualBillingTickets(email) {
  const ctx = await getAccessContextByEmail(email);
  if (!ctx.ok) throw new Error(ctx.reason || 'ACCESS_DENIED');
  // Permission check disabled for now – will re-enable later.

  try {
    const [rows] = await pool.query(
      `SELECT t.id, t.mode, t.description, t.ticketid, t.created_at, t.acknowledged_at, t.completed_at, t.client_id, c.title AS client_title
       FROM ticket t
       LEFT JOIN operatordetail c ON c.id = t.client_id
       WHERE t.mode IN ('billing_manual', 'topup_manual')
       ORDER BY (t.completed_at IS NULL) DESC, (t.acknowledged_at IS NULL) DESC, t.created_at DESC
       LIMIT 200`
    );
    return (rows || []).map((r) => ({
      _id: r.id,
      id: r.id,
      mode: r.mode,
      description: r.description || '',
      ticketid: r.ticketid,
      created_at: r.created_at,
      _createdDate: r.created_at ? new Date(r.created_at).toISOString() : '',
      acknowledgedAt: r.acknowledged_at
        ? (r.acknowledged_at instanceof Date
            ? r.acknowledged_at.toISOString()
            : typeof r.acknowledged_at === 'string'
              ? r.acknowledged_at
              : String(r.acknowledged_at))
        : null,
      completedAt: r.completed_at
        ? (r.completed_at instanceof Date
            ? r.completed_at.toISOString()
            : typeof r.completed_at === 'string'
              ? r.completed_at
              : String(r.completed_at))
        : null,
      client_id: r.client_id,
      clientTitle: r.client_title || ''
    }));
  } catch (err) {
    if (err?.message && /doesn't exist|Unknown table/i.test(err.message)) {
      console.warn('[billing] ticket table missing, run migration 0031:', err?.message);
      return [];
    }
    if (err?.message && /Unknown column ['`]completed_at/i.test(err.message)) {
      console.warn('[billing] ticket.completed_at missing — run migration 0259; listing without completed_at');
      const [rows] = await pool.query(
        `SELECT t.id, t.mode, t.description, t.ticketid, t.created_at, t.acknowledged_at, t.client_id, c.title AS client_title
         FROM ticket t
         LEFT JOIN operatordetail c ON c.id = t.client_id
         WHERE t.mode IN ('billing_manual', 'topup_manual')
         ORDER BY (t.acknowledged_at IS NULL) DESC, t.created_at DESC
         LIMIT 200`
      );
      return (rows || []).map((r) => ({
        _id: r.id,
        id: r.id,
        mode: r.mode,
        description: r.description || '',
        ticketid: r.ticketid,
        created_at: r.created_at,
        _createdDate: r.created_at ? new Date(r.created_at).toISOString() : '',
        acknowledgedAt: r.acknowledged_at
          ? (r.acknowledged_at instanceof Date
              ? r.acknowledged_at.toISOString()
              : typeof r.acknowledged_at === 'string'
                ? r.acknowledged_at
                : String(r.acknowledged_at))
          : null,
        completedAt: null,
        client_id: r.client_id,
        clientTitle: r.client_title || ''
      }));
    }
    if (err?.message && /Unknown column ['`]acknowledged_at/i.test(err.message)) {
      console.warn('[billing] ticket.acknowledged_at missing — run migration 0258; listing all manual tickets');
      const [rows] = await pool.query(
        `SELECT t.id, t.mode, t.description, t.ticketid, t.created_at, t.client_id, c.title AS client_title
         FROM ticket t
         LEFT JOIN operatordetail c ON c.id = t.client_id
         WHERE t.mode IN ('billing_manual', 'topup_manual')
         ORDER BY t.created_at DESC
         LIMIT 200`
      );
      return (rows || []).map((r) => ({
        _id: r.id,
        id: r.id,
        mode: r.mode,
        description: r.description || '',
        ticketid: r.ticketid,
        created_at: r.created_at,
        _createdDate: r.created_at ? new Date(r.created_at).toISOString() : '',
        acknowledgedAt: null,
        completedAt: null,
        client_id: r.client_id,
        clientTitle: r.client_title || ''
      }));
    }
    throw err;
  }
}

/**
 * Mark a manual billing/top-up ticket as acknowledged. Row remains listed with acknowledgedAt set. SaaS admin only.
 */
async function acknowledgeManualBillingTicket(email, ticketId) {
  const ctx = await getAccessContextByEmail(email);
  if (!ctx.ok) throw new Error(ctx.reason || 'ACCESS_DENIED');
  const id = ticketId != null ? String(ticketId).trim() : '';
  if (!id) throw new Error('TICKET_ID_REQUIRED');

  try {
    const [result] = await pool.query(
      `UPDATE ticket
       SET acknowledged_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
       WHERE id = ?
         AND mode IN ('billing_manual', 'topup_manual')
         AND (acknowledged_at IS NULL)`,
      [id]
    );
    const affected = result && typeof result.affectedRows === 'number' ? result.affectedRows : 0;
    return { ok: true, affected };
  } catch (err) {
    if (err?.message && /Unknown column ['`]acknowledged_at/i.test(err.message)) {
      console.warn('[billing] acknowledgeManualBillingTicket: run migration 0258_ticket_acknowledged_at.sql');
      throw new Error('MIGRATION_REQUIRED');
    }
    throw err;
  }
}

/**
 * getSaasCreditUsedStats – for SaaS admin dashboard: total credit used (spending) this month and by month (last 12).
 * Prefers payload.deduct_credits when present (e.g. processing-fee Spending rows where amount is 1% gross in currency).
 */
async function getSaasCreditUsedStats(email) {
  const ctx = await getAccessContextByEmail(email);
  if (!ctx.ok) throw new Error(ctx.reason || 'ACCESS_DENIED');

  const startOfThisMonthUtc = malaysiaDateToUtcDatetimeForDb(getMalaysiaMonthStartYmd());
  const twelveMonthsAgoUtc = malaysiaDateToUtcDatetimeForDb(getMalaysiaMonthStartMonthsAgo(11));

  const creditUsedExpr = `IF(
    JSON_EXTRACT(COALESCE(payload, '{}'), '$.deduct_credits') IS NOT NULL,
    ABS(CAST(JSON_UNQUOTE(JSON_EXTRACT(COALESCE(payload, '{}'), '$.deduct_credits')) AS DECIMAL(18,4))),
    ABS(COALESCE(amount, 0))
  )`;

  try {
    const [[thisRow]] = await pool.query(
      `SELECT COALESCE(SUM(${creditUsedExpr}), 0) AS total FROM creditlogs WHERE amount < 0 AND created_at >= ?`,
      [startOfThisMonthUtc]
    );
    const [byMonthRows] = await pool.query(
      `SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, COALESCE(SUM(${creditUsedExpr}), 0) AS total
       FROM creditlogs WHERE amount < 0 AND created_at >= ?
       GROUP BY DATE_FORMAT(created_at, '%Y-%m') ORDER BY month DESC LIMIT 12`,
      [twelveMonthsAgoUtc]
    );
    return {
      thisMonth: Number(thisRow?.total ?? 0) || 0,
      byMonth: (byMonthRows || []).map((r) => ({ month: r.month, total: Number(r.total) || 0 }))
    };
  } catch (err) {
    if (err?.message && /doesn't exist|Unknown table/i.test(err.message)) {
      return { thisMonth: 0, byMonth: [] };
    }
    throw err;
  }
}

const SAAS_PF_PAGE_SIZES = [10, 20, 50, 100, 200];

function normalizeSaasPfPageSize(raw) {
  const n = Number(raw);
  return SAAS_PF_PAGE_SIZES.includes(n) ? n : 20;
}

function normalizeSaasPfPage(raw) {
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** Normalize string compare across tables (avoids utf8mb4_0900_ai_ci vs utf8mb4_unicode_ci errors). */
const COLLATE_UC = 'utf8mb4_unicode_ci';

/**
 * SaaS admin: processing fee ledger (`processing_fees`) + operator payout joins for failed/payout_at.
 */
async function getSaasProcessingFeeTransactions(
  email,
  { dateFrom, dateTo, search = '', sort = 'date_desc', currency = 'all', page: pageRaw, pageSize: pageSizeRaw } = {}
) {
  const ctx = await getAccessContextByEmail(email);
  if (!ctx.ok) throw new Error(ctx.reason || 'ACCESS_DENIED');

  const page = normalizeSaasPfPage(pageRaw);
  const pageSize = normalizeSaasPfPageSize(pageSizeRaw);
  const offset = (page - 1) * pageSize;

  const from = String(dateFrom || '').slice(0, 10);
  const to = String(dateTo || '').slice(0, 10);
  const normalizedCurrency = safeTrim(currency).toUpperCase();
  const hasCurrencyFilter = normalizedCurrency === 'MYR' || normalizedCurrency === 'SGD';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new Error('DATE_RANGE_REQUIRED');
  }

  const orderByMap = {
    date_desc: 'pf.created_at DESC',
    date_asc: 'pf.created_at ASC',
    fee_desc: 'ABS(COALESCE(pf.platform_markup_amount, 0)) DESC',
    fee_asc: 'ABS(COALESCE(pf.platform_markup_amount, 0)) ASC',
    client_asc: 'd.title ASC',
    client_desc: 'd.title DESC'
  };
  const orderBy = orderByMap[sort] || orderByMap.date_desc;

  const params = [from, to];
  let searchSql = '';
  let currencySql = '';
  if (search && String(search).trim()) {
    const like = `%${String(search).trim()}%`;
    searchSql =
      ' AND (d.title LIKE ? OR pf.reference_number LIKE ? OR pf.payment_id LIKE ? OR CAST(pf.metadata_json AS CHAR) LIKE ?)';
    params.push(like, like, like, like);
  }
  if (hasCurrencyFilter) {
    currencySql = ` AND UPPER(COALESCE(NULLIF(TRIM(pf.currency), ''), NULLIF(TRIM(d.currency), ''), 'MYR')) = ?`;
    params.push(normalizedCurrency);
  }

  const baseWhere = `pf.created_at >= ? AND pf.created_at < DATE_ADD(?, INTERVAL 1 DAY)`;

  const pfJoins = `
     FROM processing_fees pf
     LEFT JOIN operatordetail d ON d.id COLLATE ${COLLATE_UC} = pf.client_id COLLATE ${COLLATE_UC}
     LEFT JOIN billplz_operator_payments bop ON pf.provider = 'billplz'
       AND bop.client_id COLLATE ${COLLATE_UC} = pf.client_id COLLATE ${COLLATE_UC}
       AND bop.payment_id COLLATE ${COLLATE_UC} = pf.payment_id COLLATE ${COLLATE_UC}
     LEFT JOIN xendit_operator_payments xop ON pf.provider = 'xendit'
       AND xop.client_id COLLATE ${COLLATE_UC} = pf.client_id COLLATE ${COLLATE_UC}
       AND xop.payment_id COLLATE ${COLLATE_UC} = pf.payment_id COLLATE ${COLLATE_UC}
  `;

  const [aggRows] = await pool.query(
    `SELECT
       COUNT(*) AS cnt,
       COALESCE(SUM(pf.gross_amount), 0) AS sum_all,
       COALESCE(SUM(CASE WHEN pf.status = 'settlement' THEN pf.gross_amount ELSE 0 END), 0) AS sum_settlement,
       COALESCE(SUM(CASE WHEN pf.status = 'pending' THEN pf.gross_amount ELSE 0 END), 0) AS sum_pending
     ${pfJoins}
     WHERE ${baseWhere}
       ${searchSql}
       ${currencySql}`,
    [...params]
  );
  const agg = aggRows[0] || {};
  const total = Number(agg.cnt) || 0;
  const sumAll = Number(agg.sum_all) || 0;
  const settlementTotal = Number(agg.sum_settlement) || 0;
  const pendingTotal = Number(agg.sum_pending) || 0;

  const [rows] = await pool.query(
    `SELECT
       pf.id,
       pf.client_id,
       d.title AS client_title,
       pf.created_at,
       pf.reference_number,
       pf.metadata_json,
       pf.currency,
       pf.charge_type,
       pf.provider,
       pf.payment_id,
       pf.gross_amount,
       pf.platform_markup_amount,
       pf.status AS pf_status,
       CASE
         WHEN pf.provider = 'billplz' AND LOWER(TRIM(COALESCE(bop.payout_status, ''))) = 'failed' THEN 'failed'
         WHEN pf.provider = 'xendit' AND LOWER(TRIM(COALESCE(xop.payout_status, ''))) = 'failed' THEN 'failed'
         WHEN pf.status = 'settlement' THEN 'settlement'
         ELSE 'pending'
       END AS api_status,
       COALESCE(bop.payout_at, xop.payout_at) AS payout_at
     ${pfJoins}
     WHERE ${baseWhere}
       ${searchSql}
       ${currencySql}
     ORDER BY ${orderBy}
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  const refMap = await resolveProcessingFeeReferenceMap((rows || []).map((r) => safeTrim(r.reference_number)));
  const items = (rows || []).map((r) => {
    const meta = parseJson(r.metadata_json) || {};
    const resolved = refMap.get(safeTrim(r.reference_number)) || null;
    const paymentId = safeTrim(r.payment_id) || safeTrim(r.reference_number);
    const tenantFromMeta = safeTrim(meta.tenant_name);
    const st = String(r.api_status || '').toLowerCase();
    const lineStatus = st === 'failed' ? 'failed' : st === 'settlement' ? 'settlement' : 'pending';
    const platformMarkupMajor = Number(r.platform_markup_amount) || 0;
    const metaDed = Number(meta.deduct_credits);
    const deductedCredits =
      Number.isFinite(metaDed) && metaDed > 0
        ? metaDed
        : platformMarkupMajor > 0
          ? Math.ceil(platformMarkupMajor)
          : 0;
    return {
      id: r.id,
      clientId: r.client_id,
      clientTitle: r.client_title || '',
      type: 'invoice',
      serviceProvider:
        r.provider === 'xendit' ? 'xendit' : r.provider === 'billplz' ? 'billplz' : 'stripe',
      status: lineStatus,
      processingFee: platformMarkupMajor,
      deductedCredits,
      paymentAmount: Number(r.gross_amount) || 0,
      currency: safeTrim(r.currency) || '',
      createdAt: r.created_at,
      referenceNumber: r.reference_number || '',
      payoutAt: r.payout_at || null,
      details: {
        tenantName: tenantFromMeta || safeTrim(resolved?.tenantName),
        propertyName: safeTrim(resolved?.propertyName),
        roomName: safeTrim(resolved?.roomName),
        tenancyId: safeTrim(resolved?.tenancyId),
        paymentId
      }
    };
  });

  return {
    items,
    total,
    page,
    pageSize,
    summary: {
      settlementTotal,
      pendingTotal,
      allTotal: sumAll
    }
  };
}

/**
 * getSaasEnquiries – list operatordetail (status=0) + client_profile for Enquiry tab (operator/SAAS enquiries).
 * Returns array of { id, title, email, contact, currency, accountNumber, bankId, createdAt, profilePhoto }.
 */
async function getSaasEnquiries() {
  try {
    const [rows] = await pool.query(
      `SELECT c.id, c.title, c.email, c.currency, c.profilephoto, c.created_at,
              p.contact, p.accountnumber, p.bank_id, p.enquiry_remark, p.enquiry_units, p.enquiry_plan_of_interest, p.enquiry_acknowledged_at
       FROM operatordetail c
       LEFT JOIN client_profile p ON p.client_id = c.id
       WHERE (c.status = 0 OR c.status IS NULL)
       ORDER BY c.created_at DESC`
    );
    const items = (rows || []).map((r) => ({
      id: r.id,
      title: r.title || '',
      email: r.email || '',
      contact: r.contact || '',
      currency: (r.currency || '').toString().trim(),
      accountNumber: r.accountnumber || '',
      bankId: r.bank_id || '',
      profilePhoto: r.profilephoto || '',
      createdAt: r.created_at,
      remark: r.enquiry_remark != null ? String(r.enquiry_remark).trim() : '',
      numberOfUnits: r.enquiry_units != null ? String(r.enquiry_units).trim() : '',
      planOfInterest: r.enquiry_plan_of_interest != null ? String(r.enquiry_plan_of_interest).trim() : '',
      acknowledgedAt: r.enquiry_acknowledged_at ? (typeof r.enquiry_acknowledged_at === 'string' ? r.enquiry_acknowledged_at : r.enquiry_acknowledged_at.toISOString?.()) : null
    }));
    if (items.length > 0) {
      console.log('[billing] getSaasEnquiries: returning', items.length, 'enquiries');
    }
    return items;
  } catch (err) {
    if (err?.message && (/Unknown column .*enquiry_/.test(err.message) || /enquiry_acknowledged_at/.test(err.message))) {
      // Try query with remark/units/plan but without enquiry_acknowledged_at (0113 run, 0114 not)
      try {
        const [rows] = await pool.query(
          `SELECT c.id, c.title, c.email, c.currency, c.profilephoto, c.created_at,
                  p.contact, p.accountnumber, p.bank_id, p.enquiry_remark, p.enquiry_units, p.enquiry_plan_of_interest
           FROM operatordetail c
           LEFT JOIN client_profile p ON p.client_id = c.id
           WHERE (c.status = 0 OR c.status IS NULL)
           ORDER BY c.created_at DESC`
        );
        const items = (rows || []).map((r) => ({
          id: r.id,
          title: r.title || '',
          email: r.email || '',
          contact: r.contact || '',
          currency: (r.currency || '').toString().trim(),
          accountNumber: r.accountnumber || '',
          bankId: r.bank_id || '',
          profilePhoto: r.profilephoto || '',
          createdAt: r.created_at,
          remark: r.enquiry_remark != null ? String(r.enquiry_remark).trim() : '',
          numberOfUnits: r.enquiry_units != null ? String(r.enquiry_units).trim() : '',
          planOfInterest: r.enquiry_plan_of_interest != null ? String(r.enquiry_plan_of_interest).trim() : '',
          acknowledgedAt: null
        }));
        if (items.length > 0) console.log('[billing] getSaasEnquiries: fallback (with remark/units/plan) returning', items.length, 'enquiries');
        return items;
      } catch (midErr) {
        if (midErr?.message && /Unknown column .*enquiry_/.test(midErr.message)) {
          try {
            const [rows] = await pool.query(
              `SELECT c.id, c.title, c.email, c.currency, c.profilephoto, c.created_at,
                      p.contact, p.accountnumber, p.bank_id
               FROM operatordetail c
               LEFT JOIN client_profile p ON p.client_id = c.id
               WHERE (c.status = 0 OR c.status IS NULL)
               ORDER BY c.created_at DESC`
            );
            const items = (rows || []).map((r) => ({
              id: r.id,
              title: r.title || '',
              email: r.email || '',
              contact: r.contact || '',
              currency: (r.currency || '').toString().trim(),
              accountNumber: r.accountnumber || '',
              bankId: r.bank_id || '',
              profilePhoto: r.profilephoto || '',
              createdAt: r.created_at,
              remark: '',
              numberOfUnits: '',
              planOfInterest: '',
              acknowledgedAt: null
            }));
            if (items.length > 0) console.log('[billing] getSaasEnquiries: fallback (minimal) returning', items.length, 'enquiries');
            return items;
          } catch (fallbackErr) {
            console.warn('[billing] getSaasEnquiries fallback failed:', fallbackErr?.message || fallbackErr);
          }
        } else {
          console.warn('[billing] getSaasEnquiries mid fallback:', midErr?.message || midErr);
        }
      }
    }
    console.warn('[billing] getSaasEnquiries:', err?.message || err);
    return [];
  }
}

/**
 * getOwnerEnquiries – list owner_enquiry for Management Enquiry tab (owners looking for operator).
 * Returns array of { id, name, company, email, phone, units, message, country, currency, createdAt }.
 * If table owner_enquiry does not exist (migration 0089 not run), returns [] and logs warning.
 */
async function getOwnerEnquiries() {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, company, email, phone, units, message, country, currency, created_at, acknowledged_at
       FROM owner_enquiry ORDER BY created_at DESC`
    );
    return (rows || []).map((r) => ({
      id: r.id,
      name: r.name || '',
      company: r.company || '',
      email: r.email || '',
      phone: r.phone || '',
      units: r.units || '',
      message: r.message || '',
      country: r.country || '',
      currency: r.currency || '',
      createdAt: r.created_at,
      acknowledgedAt: r.acknowledged_at ? (typeof r.acknowledged_at === 'string' ? r.acknowledged_at : r.acknowledged_at.toISOString?.()) : null
    }));
  } catch (err) {
    if (err?.message && /Unknown column 'acknowledged_at'/.test(err.message)) {
      const [rows] = await pool.query(
        `SELECT id, name, company, email, phone, units, message, country, currency, created_at FROM owner_enquiry ORDER BY created_at DESC`
      );
      return (rows || []).map((r) => ({
        id: r.id,
        name: r.name || '',
        company: r.company || '',
        email: r.email || '',
        phone: r.phone || '',
        units: r.units || '',
        message: r.message || '',
        country: r.country || '',
        currency: r.currency || '',
        createdAt: r.created_at,
        acknowledgedAt: null
      }));
    }
    console.warn('[billing] getOwnerEnquiries:', err?.message || err, '- run migration 0089_owner_enquiry.sql if table missing');
    return [];
  }
}

/**
 * acknowledgeSaasEnquiry – set enquiry_acknowledged_at = NOW() for client_profile where client_id = clientId.
 */
async function acknowledgeSaasEnquiry(clientId) {
  if (!clientId || !String(clientId).trim()) {
    throw new Error('CLIENT_ID_REQUIRED');
  }
  try {
    const [r] = await pool.query(
      'UPDATE client_profile SET enquiry_acknowledged_at = NOW(), updated_at = NOW() WHERE client_id = ?',
      [clientId]
    );
    return { ok: true, affected: r.affectedRows };
  } catch (err) {
    if (err?.message && /Unknown column 'enquiry_acknowledged_at'/.test(err.message)) {
      return { ok: true, affected: 0, reason: 'RUN_MIGRATION_0114' };
    }
    throw err;
  }
}

/**
 * acknowledgeOwnerEnquiry – set acknowledged_at = NOW() for owner_enquiry where id = id.
 */
async function acknowledgeOwnerEnquiry(id) {
  if (!id || !String(id).trim()) {
    throw new Error('ID_REQUIRED');
  }
  try {
    const [r] = await pool.query(
      'UPDATE owner_enquiry SET acknowledged_at = NOW(), updated_at = NOW() WHERE id = ?',
      [id]
    );
    return { ok: true, affected: r.affectedRows };
  } catch (err) {
    if (err?.message && /Unknown column 'acknowledged_at'/.test(err.message)) {
      return { ok: true, affected: 0, reason: 'RUN_MIGRATION_0114' };
    }
    throw err;
  }
}

/**
 * deleteOwnerEnquiry – remove one row from owner_enquiry (Management Enquiry tab).
 */
async function deleteOwnerEnquiry(id) {
  if (!id || !String(id).trim()) {
    throw new Error('ID_REQUIRED');
  }
  const [r] = await pool.query('DELETE FROM owner_enquiry WHERE id = ?', [id]);
  return { ok: true, affected: r.affectedRows };
}

/**
 * getOperatorTransactions – operator portal payment timeline (xendit_operator_payments / billplz_operator_payments / creditlogs).
 * PSP fees are not ledgered here; SaaS credit deductions are in creditlogs (PayexFee / BillplzFee / RentRelease).
 */
async function getOperatorTransactions(email, {
  provider = 'xendit',
  status = 'all',
  search = '',
  sort = 'date_desc',
  page = 1,
  pageSize = 20
} = {}) {
  const ctx = await getBillingContext(email);
  if (!ctx.ok) throw new Error(ctx.reason || 'ACCESS_DENIED');
  const clientId = ctx.client?.id != null ? String(ctx.client.id).trim() : null;
  if (!clientId) throw new Error('NO_CLIENT_ID');

  const providerRaw = String(provider || 'xendit').trim().toLowerCase();
  const p = providerRaw === 'stripe' || providerRaw === 'billplz' ? providerRaw : 'xendit';
  const st = String(status || 'all').trim().toLowerCase();
  const sortKey = String(sort || 'date_desc').trim();
  const pageNum = Math.max(1, Number(page) || 1);
  const sizeNum = Math.min(100, Math.max(10, Number(pageSize) || 20));
  const offset = (pageNum - 1) * sizeNum;

  // Xendit: use xendit_operator_payments as the source of truth for 3-stage status.
  if (p === 'xendit') {
    const orderByMap = {
      date_desc: 'xop.paid_at DESC, xop.created_at DESC',
      date_asc: 'xop.paid_at ASC, xop.created_at ASC',
      amount_desc: 'xop.gross_amount DESC, xop.paid_at DESC',
      amount_asc: 'xop.gross_amount ASC, xop.paid_at ASC'
    };
    const orderBy = orderByMap[sortKey] || orderByMap.date_desc;

    const params = [clientId];
    let where = "WHERE xop.client_id = ? AND xop.provider = 'xendit'";
    if (st === 'pending') {
      // Still waiting to be received in operator sub-account.
      where += " AND xop.payment_status = 'complete' AND xop.settlement_status = 'pending'";
    } else if (st === 'settlement' || st === 'settled') {
      where += " AND xop.payment_status = 'complete' AND xop.settlement_status = 'received'";
    }
    if (search && String(search).trim()) {
      const like = `%${String(search).trim()}%`;
      where += ' AND (xop.payment_id LIKE ? OR xop.reference_number LIKE ? OR xop.invoice_id LIKE ? OR xop.invoice_record_id LIKE ?)';
      params.push(like, like, like, like);
    }

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM xendit_operator_payments xop ${where}`,
      params
    );
    const total = Number(countRows?.[0]?.total ?? 0) || 0;

    const [rows] = await pool.query(
      `SELECT
          xop.id,
          xop.payment_id,
          xop.payment_status,
          xop.settlement_status,
          xop.payout_status,
          xop.estimated_receive_at,
          xop.received_at,
          xop.payout_at,
          xop.paid_at,
          xop.created_at,
          xop.currency AS xop_currency,
          xop.gross_amount,
          xop.reference_number,
          xop.invoice_source,
          xop.invoice_record_id,
          xop.invoice_id,
          xop.accounting_journal_id,
          NULL AS total_fee_amount,
          xop.currency AS pf_currency,
          NULL AS metadata_json
        FROM xendit_operator_payments xop
        ${where}
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?`,
      [...params, sizeNum, offset]
    );

    const paymentIds = (rows || []).flatMap((r) => [safeTrim(r.payment_id)]).filter(Boolean);
    const refMap = await resolveProcessingFeeReferenceMap(paymentIds);

    const items = (rows || []).map((r) => {
      const metadata = parseJson(r.metadata_json) || {};
      const paymentId = safeTrim(r.payment_id);
      const resolved = refMap.get(paymentId) || null;

      const tenantName = pickFirstNonEmpty(metadata, ['tenant_name', 'tenantName']) || safeTrim(resolved?.tenantName);
      const propertyName = pickFirstNonEmpty(metadata, ['property_name', 'propertyName']) || safeTrim(resolved?.propertyName);
      const roomName = pickFirstNonEmpty(metadata, ['room_name', 'roomName']) || safeTrim(resolved?.roomName);
      const tenancyId = pickFirstNonEmpty(metadata, ['tenancy_id', 'tenancyId']) || safeTrim(resolved?.tenancyId);

      const invoiceId = safeTrim(r.invoice_id) || safeTrim(resolved?.invoiceId);
      const recordId = safeTrim(r.invoice_record_id) || safeTrim(resolved?.recordId);
      const source = safeTrim(r.invoice_source) || safeTrim(resolved?.source) || '';

      return {
        id: r.id,
        provider: p,
        status: r.payment_status === 'complete' ? (r.settlement_status === 'received' ? 'settlement' : 'pending') : 'pending',
        paymentStatus: safeTrim(r.payment_status),
        settlementStatus: safeTrim(r.settlement_status),
        payoutStatus: safeTrim(r.payout_status),
        estimateReceiveAt: r.estimated_receive_at,
        receivedAt: r.received_at,
        payoutAt: r.payout_at,
        accountingJournalId: r.accounting_journal_id || null,

        currency: safeTrim(r.pf_currency) || safeTrim(r.xop_currency) || '',
        grossAmount: Number(r.gross_amount) || 0,
        processingFee: 0,

        createdAt: r.paid_at || r.created_at,
        estimatePayoutAt: r.estimated_receive_at,
        transactionId: paymentId,
        referenceNumber: safeTrim(r.reference_number) || paymentId,
        payBy: tenantName || '—',
        details: {
          tenantName,
          propertyName,
          roomName,
          tenancyId
        },
        invoice: {
          source,
          recordId,
          invoiceId
        }
      };
    });

    return { items, total, page: pageNum, pageSize: sizeNum };
  }

  if (p === 'billplz') {
    const orderByMap = {
      date_desc: 'bop.paid_at DESC, bop.created_at DESC',
      date_asc: 'bop.paid_at ASC, bop.created_at ASC',
      amount_desc: 'bop.gross_amount DESC, bop.paid_at DESC',
      amount_asc: 'bop.gross_amount ASC, bop.paid_at ASC'
    };
    const orderBy = orderByMap[sortKey] || orderByMap.date_desc;

    const params = [clientId];
    let where = "WHERE bop.client_id = ? AND bop.provider = 'billplz'";
    if (st === 'pending') {
      where += " AND bop.payment_status = 'complete' AND COALESCE(bop.payout_status, 'pending') <> 'paid'";
    } else if (st === 'settlement' || st === 'settled') {
      where += " AND bop.payment_status = 'complete' AND bop.payout_status = 'paid'";
    }
    if (search && String(search).trim()) {
      const like = `%${String(search).trim()}%`;
      where += ' AND (bop.payment_id LIKE ? OR bop.reference_number LIKE ? OR bop.bill_id LIKE ? OR bop.invoice_id LIKE ? OR bop.invoice_record_id LIKE ?)';
      params.push(like, like, like, like, like);
    }

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM billplz_operator_payments bop ${where}`,
      params
    );
    const total = Number(countRows?.[0]?.total ?? 0) || 0;

    const [rows] = await pool.query(
      `SELECT
          bop.id,
          bop.payment_id,
          bop.bill_id,
          bop.payment_status,
          bop.settlement_status,
          bop.payout_status,
          bop.estimated_receive_at,
          bop.received_at,
          bop.payout_at,
          bop.paid_at,
          bop.created_at,
          bop.currency AS bop_currency,
          bop.gross_amount,
          bop.reference_number,
          bop.invoice_source,
          bop.invoice_record_id,
          bop.invoice_id,
          bop.accounting_journal_id,
          NULL AS total_fee_amount,
          bop.currency AS pf_currency,
          NULL AS metadata_json
        FROM billplz_operator_payments bop
        ${where}
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?`,
      [...params, sizeNum, offset]
    );

    const paymentIds = (rows || []).flatMap((r) => [safeTrim(r.payment_id), safeTrim(r.reference_number)]).filter(Boolean);
    const refMap = await resolveProcessingFeeReferenceMap(paymentIds);

    const items = (rows || []).map((r) => {
      const metadata = parseJson(r.metadata_json) || {};
      const paymentId = safeTrim(r.payment_id);
      const resolved = refMap.get(paymentId) || refMap.get(safeTrim(r.reference_number)) || null;
      const tenantName = pickFirstNonEmpty(metadata, ['tenant_name', 'tenantName']) || safeTrim(resolved?.tenantName);
      const propertyName = pickFirstNonEmpty(metadata, ['property_name', 'propertyName']) || safeTrim(resolved?.propertyName);
      const roomName = pickFirstNonEmpty(metadata, ['room_name', 'roomName']) || safeTrim(resolved?.roomName);
      const tenancyId = pickFirstNonEmpty(metadata, ['tenancy_id', 'tenancyId']) || safeTrim(resolved?.tenancyId);
      const invoiceId = safeTrim(r.invoice_id) || safeTrim(resolved?.invoiceId);
      const recordId = safeTrim(r.invoice_record_id) || safeTrim(resolved?.recordId);
      const source = safeTrim(r.invoice_source) || safeTrim(resolved?.source) || '';

      return {
        id: r.id,
        provider: p,
        status: safeTrim(r.payout_status) === 'paid' ? 'settlement' : 'pending',
        paymentStatus: safeTrim(r.payment_status),
        settlementStatus: safeTrim(r.settlement_status),
        payoutStatus: safeTrim(r.payout_status),
        estimateReceiveAt: r.estimated_receive_at,
        receivedAt: r.received_at,
        payoutAt: r.payout_at,
        accountingJournalId: r.accounting_journal_id || null,

        currency: safeTrim(r.pf_currency) || safeTrim(r.bop_currency) || '',
        grossAmount: Number(r.gross_amount) || 0,
        processingFee: 0,

        createdAt: r.paid_at || r.created_at,
        estimatePayoutAt: r.received_at || r.paid_at || r.created_at,
        transactionId: paymentId || safeTrim(r.bill_id),
        referenceNumber: safeTrim(r.reference_number) || paymentId || safeTrim(r.bill_id),
        payBy: tenantName || '—',
        details: {
          tenantName,
          propertyName,
          roomName,
          tenancyId
        },
        invoice: {
          source,
          recordId,
          invoiceId
        }
      };
    });

    return { items, total, page: pageNum, pageSize: sizeNum };
  }

  // Stripe: tenant payment timeline from creditlogs (RentRelease) — no processing_fees table.
  const orderByMap = {
    date_desc: 'c.created_at DESC',
    date_asc: 'c.created_at ASC',
    amount_desc: 'gross_amt DESC',
    amount_asc: 'gross_amt ASC'
  };
  const orderBy = orderByMap[sortKey] || orderByMap.date_desc;

  const params = [clientId];
  let where =
    "WHERE c.client_id = ? AND (c.type = 'RentRelease' OR (c.type = 'Spending' AND c.title = 'Stripe Processing Fees'))";
  if (st === 'pending') {
    where += ' AND 1=0';
  } else if (st === 'settlement' || st === 'settled') {
    /* all RentRelease rows treated as settled for list */
  }
  if (search && String(search).trim()) {
    const like = `%${String(search).trim()}%`;
    where += ' AND (c.reference_number LIKE ? OR c.payload LIKE ?)';
    params.push(like, like);
  }

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM creditlogs c ${where}`,
    params
  );
  const total = Number(countRows?.[0]?.total ?? 0) || 0;

  const [rows] = await pool.query(
    `SELECT
       c.id,
       c.created_at,
       c.reference_number,
       c.payload,
       c.currency,
       c.charge_type,
       (COALESCE(
         CAST(JSON_UNQUOTE(JSON_EXTRACT(COALESCE(c.payload, '{}'), '$.gross_amount_cents')) AS UNSIGNED),
         CAST(JSON_UNQUOTE(JSON_EXTRACT(COALESCE(c.payload, '{}'), '$.amount_cents')) AS UNSIGNED),
         0
       ) / 100) AS gross_amt
     FROM creditlogs c
     ${where}
     ORDER BY ${orderBy}
     LIMIT ? OFFSET ?`,
    [...params, sizeNum, offset]
  );

  const refMap = await resolveProcessingFeeReferenceMap(
    (rows || []).map((r) => safeTrim(r.reference_number)).filter(Boolean)
  );

  const items = (rows || []).map((r) => {
    const metadata = parseJson(r.payload) || {};
    const paymentId = safeTrim(r.reference_number).replace(/^RR-/, '') || safeTrim(r.reference_number);
    const resolved = refMap.get(safeTrim(r.reference_number)) || null;
    const tenantName = pickFirstNonEmpty(metadata, ['tenant_name', 'tenantName']) || safeTrim(resolved?.tenantName);
    const propertyName = pickFirstNonEmpty(metadata, ['property_name', 'propertyName']) || safeTrim(resolved?.propertyName);
    const roomName = pickFirstNonEmpty(metadata, ['room_name', 'roomName']) || safeTrim(resolved?.roomName);
    const tenancyId = pickFirstNonEmpty(metadata, ['tenancy_id', 'tenancyId']) || safeTrim(resolved?.tenancyId);
    const invoiceId = pickFirstNonEmpty(metadata, ['invoice_id', 'invoiceId', 'invoiceid']) || safeTrim(resolved?.invoiceId);
    const recordId = pickFirstNonEmpty(metadata, ['record_id', 'recordId']) || safeTrim(resolved?.recordId);
    const source = pickFirstNonEmpty(metadata, ['source']) || safeTrim(resolved?.source) || '';

    let estimatePayoutAt = null;
    try {
      const t = r.created_at instanceof Date ? new Date(r.created_at) : new Date(String(r.created_at));
      if (!Number.isNaN(t.getTime())) {
        t.setDate(t.getDate() + 2);
        estimatePayoutAt = t.toISOString();
      }
    } catch (_) {}

    return {
      id: r.id,
      provider: p,
      status: 'settlement',
      currency: safeTrim(r.currency) || '',
      grossAmount: Number(r.gross_amt) || 0,
      processingFee: 0,
      createdAt: r.created_at,
      estimatePayoutAt,
      transactionId: paymentId,
      referenceNumber: safeTrim(r.reference_number) || paymentId,
      payBy: tenantName || '—',
      details: {
        tenantName,
        propertyName,
        roomName,
        tenancyId
      },
      invoice: {
        source,
        recordId,
        invoiceId
      }
    };
  });

  return { items, total, page: pageNum, pageSize: sizeNum };
}

function normalizePositiveInt(val, fallback, max) {
  const n = parseInt(String(val), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  if (typeof max === 'number' && n > max) return max;
  return n;
}

/**
 * SaaS admin: all meters across operators (for cross-operator transfer).
 */
async function getSaasAdminMeters(email, { search = '', operatorId = '', page = 1, pageSize = 50 } = {}) {
  const ctx = await getAccessContextByEmail(email);
  if (!ctx.ok) throw new Error(ctx.reason || 'ACCESS_DENIED');

  const safePage = normalizePositiveInt(page, 1);
  const safePageSize = normalizePositiveInt(pageSize, 50, 200);
  const offset = (safePage - 1) * safePageSize;

  const conditions = ['1=1'];
  const params = [];
  if (operatorId && String(operatorId).trim()) {
    conditions.push('m.client_id = ?');
    params.push(String(operatorId).trim());
  }
  if (search && String(search).trim()) {
    const like = `%${String(search).trim()}%`;
    conditions.push('(m.meterid LIKE ? OR m.title LIKE ? OR od.title LIKE ? OR p.shortname LIKE ? OR r.title_fld LIKE ?)');
    params.push(like, like, like, like, like);
  }
  const whereSql = conditions.join(' AND ');

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total
       FROM meterdetail m
       LEFT JOIN operatordetail od ON od.id = m.client_id
       LEFT JOIN propertydetail p ON p.id = m.property_id
       LEFT JOIN roomdetail r ON r.id = m.room_id
      WHERE ${whereSql}`,
    params
  );
  const total = Number(countRows?.[0]?.total || 0);

  const [rows] = await pool.query(
    `SELECT
       m.id,
       m.meterid,
       m.title,
       m.mode,
       m.rate,
       m.balance,
       m.status,
       m.isonline,
       m.client_id,
       od.title AS operator_title,
       m.property_id,
       p.shortname AS property_shortname,
       m.room_id,
       r.title_fld AS room_title,
       m.updated_at
     FROM meterdetail m
     LEFT JOIN operatordetail od ON od.id = m.client_id
     LEFT JOIN propertydetail p ON p.id = m.property_id
     LEFT JOIN roomdetail r ON r.id = m.room_id
     WHERE ${whereSql}
     ORDER BY m.updated_at DESC, m.id DESC
     LIMIT ? OFFSET ?`,
    [...params, safePageSize, offset]
  );

  const items = (rows || []).map((r) => ({
    id: r.id,
    meterId: r.meterid || '',
    title: r.title || '',
    mode: r.mode || '',
    rate: Number(r.rate) || 0,
    balance: Number(r.balance) || 0,
    status: !!r.status,
    isOnline: !!r.isonline,
    operatorId: r.client_id || '',
    operatorTitle: r.operator_title || '',
    propertyId: r.property_id || null,
    propertyTitle: r.property_shortname || '',
    roomId: r.room_id || null,
    roomTitle: r.room_title || '',
    updatedAt: r.updated_at || null
  }));

  return {
    items,
    total,
    page: safePage,
    pageSize: safePageSize
  };
}

/**
 * Move one meter from current operator to another operator.
 * Reset room/property/group assignment to avoid cross-operator stale links.
 */
async function moveMeterToOperator({ meterId, toOperatorId }) {
  const meterIdStr = meterId != null ? String(meterId).trim() : '';
  const targetOperatorId = toOperatorId != null ? String(toOperatorId).trim() : '';
  if (!meterIdStr || !targetOperatorId) {
    throw new Error('METER_ID_AND_OPERATOR_ID_REQUIRED');
  }

  const [meterRows] = await pool.query(
    'SELECT id, client_id, meterid, title FROM meterdetail WHERE id = ? LIMIT 1',
    [meterIdStr]
  );
  const meter = meterRows?.[0];
  if (!meter) throw new Error('METER_NOT_FOUND');
  if (String(meter.client_id || '') === targetOperatorId) {
    throw new Error('SAME_OPERATOR');
  }

  const [opRows] = await pool.query(
    'SELECT id, title FROM operatordetail WHERE id = ? LIMIT 1',
    [targetOperatorId]
  );
  if (!opRows?.length) throw new Error('TARGET_OPERATOR_NOT_FOUND');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Detach any room linked to this meter first.
    await conn.query('UPDATE roomdetail SET meter_id = NULL, updated_at = NOW() WHERE meter_id = ?', [meterIdStr]);
    await conn.query(
      `UPDATE meterdetail
          SET client_id = ?, property_id = NULL, room_id = NULL, metersharing_json = JSON_ARRAY(), updated_at = NOW()
        WHERE id = ?`,
      [targetOperatorId, meterIdStr]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  return {
    ok: true,
    meter: {
      id: meter.id,
      meterId: meter.meterid || '',
      title: meter.title || '',
      fromOperatorId: meter.client_id || '',
      toOperatorId: targetOperatorId,
      toOperatorTitle: opRows[0].title || ''
    }
  };
}

/**
 * SaaS admin: all properties across operators (for cross-operator transfer with rooms).
 */
async function getSaasAdminProperties(email, { search = '', operatorId = '', page = 1, pageSize = 50 } = {}) {
  const ctx = await getAccessContextByEmail(email);
  if (!ctx.ok) throw new Error(ctx.reason || 'ACCESS_DENIED');

  const safePage = normalizePositiveInt(page, 1);
  const safePageSize = normalizePositiveInt(pageSize, 50, 200);
  const offset = (safePage - 1) * safePageSize;

  const conditions = ['1=1'];
  const params = [];
  if (operatorId && String(operatorId).trim()) {
    conditions.push('p.client_id = ?');
    params.push(String(operatorId).trim());
  }
  if (search && String(search).trim()) {
    const like = `%${String(search).trim()}%`;
    conditions.push(
      '(p.shortname LIKE ? OR p.apartmentname LIKE ? OR p.address LIKE ? OR p.id LIKE ? OR od.title LIKE ?)'
    );
    params.push(like, like, like, like, like);
  }
  const whereSql = conditions.join(' AND ');

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total
       FROM propertydetail p
       LEFT JOIN operatordetail od ON od.id = p.client_id
      WHERE ${whereSql}`,
    params
  );
  const total = Number(countRows?.[0]?.total || 0);

  const [rows] = await pool.query(
    `SELECT
       p.id,
       p.shortname,
       p.apartmentname,
       p.address,
       p.client_id,
       od.title AS operator_title,
       p.meter_id,
       (SELECT COUNT(*) FROM roomdetail r WHERE r.property_id = p.id) AS room_count,
       p.updated_at
     FROM propertydetail p
     LEFT JOIN operatordetail od ON od.id = p.client_id
     WHERE ${whereSql}
     ORDER BY p.updated_at DESC, p.id DESC
     LIMIT ? OFFSET ?`,
    [...params, safePageSize, offset]
  );

  const items = (rows || []).map((r) => ({
    id: r.id,
    shortname: r.shortname || '',
    apartmentname: r.apartmentname || '',
    address: r.address || '',
    operatorId: r.client_id || '',
    operatorTitle: r.operator_title || '',
    roomCount: Number(r.room_count) || 0,
    meterId: r.meter_id || null,
    updatedAt: r.updated_at || null
  }));

  return {
    items,
    total,
    page: safePage,
    pageSize: safePageSize
  };
}

/**
 * Move one property (and its rooms, linked meters, tenancies, rentalcollection) to another operator.
 */
async function movePropertyToOperator({ propertyId, toOperatorId }) {
  const propertyIdStr = propertyId != null ? String(propertyId).trim() : '';
  const targetOperatorId = toOperatorId != null ? String(toOperatorId).trim() : '';
  if (!propertyIdStr || !targetOperatorId) {
    throw new Error('PROPERTY_ID_AND_OPERATOR_ID_REQUIRED');
  }

  const [propRows] = await pool.query(
    'SELECT id, client_id, shortname, meter_id FROM propertydetail WHERE id = ? LIMIT 1',
    [propertyIdStr]
  );
  const prop = propRows?.[0];
  if (!prop) throw new Error('PROPERTY_NOT_FOUND');
  if (String(prop.client_id || '') === targetOperatorId) {
    throw new Error('SAME_OPERATOR');
  }

  const [opRows] = await pool.query(
    'SELECT id, title FROM operatordetail WHERE id = ? LIMIT 1',
    [targetOperatorId]
  );
  if (!opRows?.length) throw new Error('TARGET_OPERATOR_NOT_FOUND');

  const [roomRows] = await pool.query('SELECT id FROM roomdetail WHERE property_id = ?', [propertyIdStr]);
  const roomIds = (roomRows || []).map((r) => r.id).filter(Boolean);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(
      'UPDATE roomdetail SET client_id = ?, updated_at = NOW() WHERE property_id = ?',
      [targetOperatorId, propertyIdStr]
    );

    const meterWhere = ['property_id = ?'];
    const meterWhereParams = [propertyIdStr];
    if (prop.meter_id) {
      meterWhere.push('id = ?');
      meterWhereParams.push(prop.meter_id);
    }
    if (roomIds.length) {
      meterWhere.push(`room_id IN (${roomIds.map(() => '?').join(',')})`);
      meterWhereParams.push(...roomIds);
    }
    await conn.query(
      `UPDATE meterdetail SET client_id = ?, updated_at = NOW() WHERE ${meterWhere.join(' OR ')}`,
      [targetOperatorId, ...meterWhereParams]
    );

    await conn.query(
      'UPDATE propertydetail SET client_id = ?, updated_at = NOW() WHERE id = ?',
      [targetOperatorId, propertyIdStr]
    );

    if (roomIds.length) {
      const ph = roomIds.map(() => '?').join(',');
      await conn.query(
        `UPDATE tenancy SET client_id = ?, updated_at = NOW() WHERE room_id IN (${ph})`,
        [targetOperatorId, ...roomIds]
      );
    }

    await conn.query(
      'UPDATE rentalcollection SET client_id = ?, updated_at = NOW() WHERE property_id = ?',
      [targetOperatorId, propertyIdStr]
    );

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  return {
    ok: true,
    property: {
      id: prop.id,
      shortname: prop.shortname || '',
      fromOperatorId: prop.client_id || '',
      toOperatorId: targetOperatorId,
      toOperatorTitle: opRows[0].title || '',
      roomCount: roomIds.length
    }
  };
}

module.exports = {
  getMyBillingInfo,
  getCreditStatements,
  getPlans,
  getAddons,
  getCreditPlans,
  getStatementItems,
  clearBillingCache,
  clearBillingCacheByClientId,
  getMyClient,
  clearClientCache,
  getClientAddonCapabilities,
  getClientUserLimitBreakdown,
  getClientMaxStaffAllowed,
  getClientMaxUserAllowed,
  getPlanIncludedUserCount,
  PLAN_INCLUDED_USERS,
  getManualBillingClients,
  getPendingManualBillingTickets,
  acknowledgeManualBillingTicket,
  getSaasCreditUsedStats,
  getSaasProcessingFeeTransactions,
  getOperatorTransactions,
  getSaasAdminMeters,
  moveMeterToOperator,
  getSaasAdminProperties,
  movePropertyToOperator,
  getSaasEnquiries,
  getOwnerEnquiries,
  acknowledgeSaasEnquiry,
  acknowledgeOwnerEnquiry,
  deleteOwnerEnquiry
};
