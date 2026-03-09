/**
 * Billing – migrated from Wix backend/billing/billing.jsw.
 * Uses MySQL: clientdetail (id, title, currency, expired, pricingplandetail, credit),
 * pricingplan, pricingplanaddon. Access via getAccessContextByEmail (staff/client, permission).
 * Credit statements (getCreditStatements) use creditlogs table (see migration 0030).
 */

const pool = require('../../config/db');
const { getAccessContextByEmail } = require('../access/access.service');

let clientBillingCache = {};
let creditLogCache = {};

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

/**
 * getMyBillingInfo – same contract as Velo getMyBillingInfo().
 * Requires email in request (body or query); returns { noPermission?, reason?, currency?, title?, plan?, credit?, expired?, pricingplandetail? }.
 * When access fails or client missing, returns { noPermission: true, reason } so API stays 200 and JSW does not show BACKEND_ERROR.
 */
async function getMyBillingInfo(email) {
  if (!email || typeof email !== 'string' || !String(email).trim()) {
    return { noPermission: true, reason: 'NO_EMAIL' };
  }

  const ctx = await getAccessContextByEmail(email);

  if (!ctx.ok) {
    return { noPermission: true, reason: ctx.reason || 'ACCESS_DENIED' };
  }

  if (!ctx.staff?.permission?.billing && !ctx.staff?.permission?.admin) {
    return { noPermission: true, reason: 'NO_PERMISSION' };
  }

  const clientId = ctx.client?.id;
  if (!clientId) {
    return { noPermission: true, reason: 'NO_CLIENT_ID' };
  }

  if (clientBillingCache[clientId]) {
    return clientBillingCache[clientId];
  }

  const [clientRows] = await pool.query(
    'SELECT id, title, currency, expired, pricingplandetail, credit FROM clientdetail WHERE id = ? LIMIT 1',
    [clientId]
  );

  if (!clientRows.length) {
    return { noPermission: true, reason: 'CLIENT_NOT_FOUND' };
  }

  const client = clientRows[0];
  const rawPricingPlanDetail = parseJson(client.pricingplandetail);
  const pricingplandetail = Array.isArray(rawPricingPlanDetail) ? rawPricingPlanDetail : [];
  const rawCredit = parseJson(client.credit);
  const credit = Array.isArray(rawCredit) ? rawCredit : [];

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
    pricingplandetail: hydrated
  };

  clientBillingCache[clientId] = result;
  return result;
}

/**
 * Pricing plan ID → number of included (free) user accounts for staff.
 * Plan not in map defaults to 1. Addon extra users are on top of this.
 */
const PLAN_INCLUDED_USERS = {
  '896357c8-1155-47de-9d3c-15055a4820aa': 4, // Up to 4 user accounts
  '06af7357-f9c8-4319-98c3-b24e1fa7ae27': 3, // Up to 3 user accounts
  'e119144a-24b1-4fc6-ba0d-4c5c3f3184c6': 2, // Up to 2 user accounts
  '80991cd1-b17a-4d68-9b21-21a1df76120c': 2  // Up to 2 user accounts
};

function getPlanIncludedUserCount(planId) {
  if (!planId || typeof planId !== 'string') return 1;
  const n = PLAN_INCLUDED_USERS[String(planId).trim()];
  return typeof n === 'number' && n >= 1 ? n : 1;
}

/**
 * Max staff (user accounts) allowed for client: plan included users + Extra User addon qty.
 * Used by companysetting getStaffList / createStaff for #buttonnewuser and #repeaterusersetting limit.
 */
async function getClientMaxStaffAllowed(clientId) {
  if (!clientId) return 1;
  let planId = null;
  const [planRows] = await pool.query(
    `SELECT plan_id FROM client_pricingplan_detail WHERE client_id = ? AND type = 'plan' LIMIT 1`,
    [clientId]
  );
  if (planRows && planRows[0] && planRows[0].plan_id) planId = planRows[0].plan_id;
  if (!planId) {
    const [clientRows] = await pool.query('SELECT pricingplan_id FROM clientdetail WHERE id = ? LIMIT 1', [clientId]);
    if (clientRows && clientRows[0] && clientRows[0].pricingplan_id) planId = clientRows[0].pricingplan_id;
  }
  const planIncluded = getPlanIncludedUserCount(planId);
  const caps = await getClientAddonCapabilities(clientId);
  const extra = Number(caps.extraUserQty) || 0;
  return Math.max(1, planIncluded + extra);
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
 */
async function getCreditStatements(email, { page = 1, pageSize = 10, sort = 'new', filterType = null, search = '' }) {
  const ctx = await getAccessContextByEmail(email);
  if (!ctx.ok) throw new Error(ctx.reason || 'ACCESS_DENIED');
  if (!ctx.staff?.permission?.billing && !ctx.staff?.permission?.admin) throw new Error('NO_PERMISSION');
  const clientId = ctx.client?.id;
  if (!clientId) throw new Error('NO_CLIENT_ID');

  const cacheKey = `${clientId}_${page}_${sort}_${filterType}_${search}`;
  if (creditLogCache[cacheKey]) return creditLogCache[cacheKey];

  let orderBy = 'created_at DESC';
  if (sort === 'old') orderBy = 'created_at ASC';
  else if (sort === 'amountAsc') orderBy = 'amount ASC';
  else if (sort === 'amountDesc') orderBy = 'amount DESC';

  let sql = 'SELECT id, type, title, amount, reference_number, created_at FROM creditlogs WHERE client_id = ?';
  const params = [clientId];
  if (filterType === 'Topup') { sql += ' AND type = ?'; params.push('Topup'); }
  if (filterType === 'Spending') { sql += ' AND type = ?'; params.push('Spending'); }
  if (search) {
    sql += ' AND (title LIKE ? OR reference_number LIKE ?)';
    const like = '%' + search + '%';
    params.push(like, like);
  }
  const countParams = [clientId];
  let countSql = 'SELECT COUNT(*) AS total FROM creditlogs WHERE client_id = ?';
  if (filterType === 'Topup') { countSql += ' AND type = ?'; countParams.push('Topup'); }
  if (filterType === 'Spending') { countSql += ' AND type = ?'; countParams.push('Spending'); }
  if (search) { countSql += ' AND (title LIKE ? OR reference_number LIKE ?)'; countParams.push('%' + search + '%', '%' + search + '%'); }
  const [countRows] = await pool.query(countSql, countParams);
  const total = countRows[0].total;
  sql += ' ORDER BY ' + orderBy + ' LIMIT ? OFFSET ?';
  params.push(pageSize, (page - 1) * pageSize);
  const [rows] = await pool.query(sql, params);

  const result = {
    items: rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      amount: r.amount,
      reference_number: r.reference_number,
      created_at: r.created_at
    })),
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
 * getMyClient – same contract as Wix backend/query/clientdetail.jsw getMyClient().
 * Returns client row (id, title, status, currency, credit, pricingplandetail) or null.
 */
async function getMyClient(email) {
  if (clientCache) return clientCache;
  const ctx = await getAccessContextByEmail(email);
  if (!ctx?.ok || !ctx.client?.id) return null;
  const [rows] = await pool.query(
    'SELECT id, title, status, currency, credit, pricingplandetail, expired FROM clientdetail WHERE id = ? LIMIT 1',
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
async function getPlans(email) {
  const ctx = await getAccessContextByEmail(email);
  if (!ctx.ok) throw new Error(ctx.reason || 'ACCESS_DENIED');
  if (!ctx.staff?.permission?.billing && !ctx.staff?.permission?.admin) throw new Error('NO_PERMISSION');
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
 * getAddons – list pricing plan addons for billing UI.
 * Returns array of { id, _id, title, description, credit, qty }; credit from credit_json for display.
 */
async function getAddons(email) {
  const ctx = await getAccessContextByEmail(email);
  if (!ctx.ok) throw new Error(ctx.reason || 'ACCESS_DENIED');
  if (!ctx.staff?.permission?.billing && !ctx.staff?.permission?.admin) throw new Error('NO_PERMISSION');
  const [rows] = await pool.query(
    'SELECT id, title, description_json, credit_json, qty FROM pricingplanaddon'
  );
  return rows.map((r) => {
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
async function getCreditPlans(email) {
  const ctx = await getAccessContextByEmail(email);
  if (!ctx.ok) throw new Error(ctx.reason || 'ACCESS_DENIED');
  if (!ctx.staff?.permission?.billing && !ctx.staff?.permission?.admin) throw new Error('NO_PERMISSION');
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
 * getStatementItems – merged creditlogs + pricingplanlogs for event log repeater (sort/filter/paginate).
 * filterType: null | 'Topup' | 'Spending' | 'creditOnly' | 'planOnly'
 * sort: 'new' | 'old' | 'amountAsc' | 'amountDesc'
 * Returns { items, total, page, pageSize }; items have _id, type ('credit'|'plan'), title, amount, _createdDate, corecredit?, sellingprice?, invoiceUrl?.
 */
async function getStatementItems(email, { page = 1, pageSize = 10, sort = 'new', filterType = null, search = '' }) {
  const ctx = await getAccessContextByEmail(email);
  if (!ctx.ok) throw new Error(ctx.reason || 'ACCESS_DENIED');
  if (!ctx.staff?.permission?.billing && !ctx.staff?.permission?.admin) throw new Error('NO_PERMISSION');
  const clientId = ctx.client?.id != null ? String(ctx.client.id) : null;
  if (!clientId) throw new Error('NO_CLIENT_ID');

  const clientCurrency = (ctx.client && ctx.client.currency) ? String(ctx.client.currency).trim().toUpperCase() : 'MYR';

  const [creditRows] = await pool.query(
    'SELECT id, type, title, amount, created_at, currency FROM creditlogs WHERE client_id = ? ORDER BY id',
    [clientId]
  );
  console.log('[BILLING statement-items] email=%s clientId=%s creditRows=%s', String(email).slice(0, 3) + '***', clientId, creditRows.length);

  const [planLogRows] = await pool.query(
    `SELECT l.id, l.title, l.amount, l.created_at, l.plan_id, p.corecredit, p.sellingprice
     FROM pricingplanlogs l
     LEFT JOIN pricingplan p ON p.id = l.plan_id
     WHERE l.client_id = ? ORDER BY l.id`,
    [clientId]
  );

  const pickInvoice = (r) => ({
    invoiceId: r.invoiceid != null && String(r.invoiceid).trim() ? String(r.invoiceid).trim() : null,
    invoiceUrl: r.invoiceurl != null && String(r.invoiceurl).trim() ? String(r.invoiceurl).trim() : null
  });
  let items = [];
  creditRows.forEach((r) => {
    const curr = r.currency != null && String(r.currency).trim() ? String(r.currency).trim().toUpperCase() : null;
    items.push({
      _id: 'credit_' + r.id,
      type: 'credit',
      title: r.title || '-',
      amount: Number(r.amount) || 0,
      _createdDate: r.created_at,
      currency: curr,
      ...pickInvoice(r)
    });
  });
  planLogRows.forEach((r) => {
    items.push({
      _id: 'plan_' + r.id,
      type: 'plan',
      title: r.title || '-',
      corecredit: Number(r.corecredit) || 0,
      sellingprice: Number(r.sellingprice) || Number(r.amount) || 0,
      _createdDate: r.created_at,
      currency: clientCurrency,
      ...pickInvoice(r)
    });
  });

  if (filterType === 'Topup') items = items.filter((i) => i.type === 'credit' && i.amount >= 0);
  if (filterType === 'Spending') items = items.filter((i) => i.type === 'credit' && i.amount < 0);
  if (filterType === 'creditOnly') items = items.filter((i) => i._id.startsWith('credit_'));
  if (filterType === 'planOnly') items = items.filter((i) => i._id.startsWith('plan_'));

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
  console.log('[BILLING statement-items] planLogRows=%s merged items=%s total=%s paginated=%s', planLogRows.length, items.length, total, paginated.length);

  return { items: paginated, total, page, pageSize };
}

/**
 * getManualBillingClients – list clients for manual billing dropdown and #repeaterclient.
 * Requires staff with admin or billing permission. Returns all clients with id, title, email, status, expired, hasPlan, planTitle.
 * planTitle = current plan name from pricingplandetail (type=plan item); expired formatted as YYYY-MM-DD for display.
 */
async function getManualBillingClients(email) {
  const ctx = await getAccessContextByEmail(email);
  if (!ctx.ok) throw new Error(ctx.reason || 'ACCESS_DENIED');
  if (!ctx.staff?.permission?.billing && !ctx.staff?.permission?.admin) throw new Error('NO_PERMISSION');

  const [rows] = await pool.query(
    'SELECT id, title, email, status, expired, pricingplandetail FROM clientdetail ORDER BY title ASC'
  );
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
      planTitle: planTitle || ''
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
  if (!ctx.staff?.permission?.billing && !ctx.staff?.permission?.admin) throw new Error('NO_PERMISSION');

  try {
    const [rows] = await pool.query(
      `SELECT t.id, t.mode, t.description, t.ticketid, t.created_at, t.client_id, c.title AS client_title
       FROM ticket t
       LEFT JOIN clientdetail c ON c.id = t.client_id
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
      client_id: r.client_id,
      clientTitle: r.client_title || ''
    }));
  } catch (err) {
    if (err?.message && /doesn't exist|Unknown table/i.test(err.message)) {
      console.warn('[billing] ticket table missing, run migration 0031:', err?.message);
      return [];
    }
    throw err;
  }
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
  getClientMaxStaffAllowed,
  getPlanIncludedUserCount,
  PLAN_INCLUDED_USERS,
  getManualBillingClients,
  getPendingManualBillingTickets
};
