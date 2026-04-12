/**
 * Checkout – migrated from Wix backend/billing/checkout.jsw.
 * Operator pricing plan pay-in: Coliving SaaS platform Stripe (Malaysia test `STRIPE_SANDBOX_SECRET_KEY`), MYR or SGD from operatordetail.
 */

const pool = require('../../config/db');
const { randomUUID } = require('crypto');
const { getAccessContextByEmail, getAccessContextByEmailAndClient } = require('../access/access.service');

function parseJson(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return null; }
}

/** Normalise date (Date object or string) to YYYY-MM-DD for MySQL date columns. */
function toDateOnlyStr(val) {
  if (val == null || val === '') return null;
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseAddonYearlyCredit(raw) {
  if (!raw) return 0;
  if (Array.isArray(raw)) raw = raw[0];
  if (typeof raw === 'string') {
    const m = raw.match(/\d+/);
    return m ? Number(m[0]) : 0;
  }
  if (typeof raw === 'number') return raw;
  return 0;
}

function normalizeRedirectUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const s = String(url).trim();
  if (s.startsWith('https://portal.colivingjb.com')) return s;
  const portalBase = process.env.PORTAL_APP_URL && String(process.env.PORTAL_APP_URL).trim();
  if (portalBase && s.startsWith(portalBase)) return s;
  if (s.startsWith('https://www.colivingjb.com')) return s;
  return null;
}

function resolveNewExpiredDate({ scenario, today, currentExpiredDate }) {
  const y = today.getFullYear();
  const m = today.getMonth();
  if (scenario === 'NEW') return new Date(y + 1, m + 1, 0);
  if (scenario === 'RENEW' && currentExpiredDate) {
    const d = new Date(currentExpiredDate);
    return new Date(d.getFullYear() + 1, d.getMonth() + 1, 0);
  }
  if (scenario === 'UPGRADE' && currentExpiredDate) return new Date(y + 1, m + 1, 0);
  return null;
}

async function resolvePricingPlanAmount({ client, plan }) {
  const raw = client.pricingplandetail;
  const arr = Array.isArray(parseJson(raw)) ? parseJson(raw) : [];
  const planItem = arr.find((i) => i.type === 'plan') || null;
  const currentPlanId = planItem?.planId || null;
  const today = new Date();
  let scenario = 'NEW';
  let prorate = 0;
  if (currentPlanId) {
    const [rows] = await pool.query('SELECT id, sellingprice FROM pricingplan WHERE id = ? LIMIT 1', [currentPlanId]);
    const currentPlan = rows[0];
    if (currentPlan) {
      if (plan.id === currentPlanId) scenario = 'RENEW';
      else if (Number(plan.sellingprice) > Number(currentPlan.sellingprice)) scenario = 'UPGRADE';
      else scenario = 'DOWNGRADE';
    }
  }
  if (scenario === 'DOWNGRADE') return { scenario, totalPayment: 0, prorate: 0 };
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const nextMonthStart = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const daysInMonth = (nextMonthStart - monthStart) / (1000 * 60 * 60 * 24);
  const remainingDays = (nextMonthStart - today) / (1000 * 60 * 60 * 24);
  const yearPrice = Number(plan.sellingprice);
  const monthlyPrice = yearPrice / 12;
  const daily = monthlyPrice / daysInMonth;
  prorate = Math.ceil(daily * remainingDays);
  const totalPayment = yearPrice + prorate;
  return { scenario, yearPrice, prorate, totalPayment };
}

/**
 * Preview pricing plan change. Same contract as JSW previewPricingPlan.
 */
async function previewPricingPlan(email, { planId, clientId: optsClientId }) {
  const access = optsClientId
    ? await getAccessContextByEmailAndClient(email, optsClientId)
    : await getAccessContextByEmail(email);
  if (!access.ok) throw new Error(access.reason);
  const clientId = access.client.id;
  const [clientRows] = await pool.query(
    'SELECT id, title, status, currency, expired, credit, pricingplandetail FROM operatordetail WHERE id = ? LIMIT 1',
    [clientId]
  );
  if (!clientRows.length || clientRows[0].status !== 1 && clientRows[0].status !== true) throw new Error('CLIENT_INVALID');
  const client = clientRows[0];
  const currency = String(client.currency || '').trim().toUpperCase();
  if (!currency) throw new Error('CLIENT_CURRENCY_MISSING');
  if (!['MYR', 'SGD'].includes(currency)) throw new Error('UNSUPPORTED_CLIENT_CURRENCY');
  const [planRows] = await pool.query('SELECT id, title, sellingprice, corecredit FROM pricingplan WHERE id = ? LIMIT 1', [planId]);
  if (!planRows.length) throw new Error('PLAN_NOT_FOUND');
  const plan = planRows[0];
  const planItem = access.plan.mainPlan;
  let scenario = 'NEW';
  let fromPlanTitle = null;
  let currentPlan = null;
  if (planItem?.planId) {
    const [curRows] = await pool.query('SELECT id, title, sellingprice FROM pricingplan WHERE id = ? LIMIT 1', [planItem.planId]);
    currentPlan = curRows[0] || null;
    if (currentPlan) {
      if (currentPlan.id === plan.id) scenario = 'RENEW';
      else if (Number(plan.sellingprice) > Number(currentPlan.sellingprice)) scenario = 'UPGRADE';
      else scenario = 'DOWNGRADE';
      fromPlanTitle = currentPlan.title;
    }
  }
  if (scenario === 'DOWNGRADE') return { scenario };
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const prorateStart = today;
  const prorateEnd = new Date(year, month + 1, 0);
  const currentExpiredDate = access.expired.expiredAt ? new Date(access.expired.expiredAt) : null;
  const planEnd = resolveNewExpiredDate({ scenario, today, currentExpiredDate });
  const credits = Array.isArray(parseJson(client.credit)) ? parseJson(client.credit) : [];
  const currentCredit = credits.reduce((sum, c) => sum + Number(c.amount || 0), 0);
  const grantedCredit = Number(plan.corecredit || 0);
  let addonCreditRequired = 0;
  const existingAddons = access.plan.addons || [];
  if ((scenario === 'RENEW' || scenario === 'UPGRADE') && existingAddons.length) {
    for (const a of existingAddons) {
      const [addonRows] = await pool.query('SELECT id, credit_json FROM pricingplanaddon WHERE id = ? LIMIT 1', [a.planId]);
      const addon = addonRows[0];
      if (!addon) continue;
      const raw = addon.credit_json;
      const yearlyCredit = parseAddonYearlyCredit(typeof raw === 'string' ? parseJson(raw) : raw);
      const qty = Number(a.qty || 0);
      if (yearlyCredit <= 0 || qty <= 0) continue;
      if (scenario === 'RENEW') {
        addonCreditRequired += yearlyCredit * qty;
        continue;
      }
      if (scenario === 'UPGRADE') {
        if (!currentExpiredDate || planEnd <= currentExpiredDate) continue;
        const addonStart = new Date(currentExpiredDate.getFullYear(), currentExpiredDate.getMonth() + 1, 1);
        const msPerDay = 1000 * 60 * 60 * 24;
        const daysToCover = Math.ceil((planEnd.getTime() - addonStart.getTime()) / msPerDay);
        if (daysToCover <= 0) continue;
        addonCreditRequired += Math.ceil((yearlyCredit * daysToCover / 365) * qty);
      }
    }
  }
  const msPerDay = 1000 * 60 * 60 * 24;
  const prorateDays = Math.ceil((prorateEnd - prorateStart) / msPerDay) + 1;
  const yearPrice = Number(plan.sellingprice);
  const monthlyPrice = yearPrice / 12;
  const daysInMonth = prorateEnd.getDate();
  const dailyRate = monthlyPrice / daysInMonth;
  const prorate = Math.ceil(dailyRate * prorateDays);
  const totalPayment = yearPrice + prorate;
  return {
    scenario,
    fromPlanTitle,
    toPlanTitle: plan.title,
    yearPrice,
    prorate,
    totalPayment,
    expiredDate: planEnd,
    expiredDateText: planEnd.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
    credit: {
      current: currentCredit,
      grantedByPlan: grantedCredit,
      addonRequired: addonCreditRequired,
      availableAfterRenew: Math.max(0, currentCredit + grantedCredit - addonCreditRequired)
    },
    creditEnough: currentCredit + grantedCredit >= addonCreditRequired,
    period: { prorateStart, prorateEnd, planEnd }
  };
}

/**
 * Confirm pricing plan: insert pricingplanlogs (pending), then Stripe Checkout (Malaysia platform; sandbox vs live: COLIVING_SAAS_STRIPE_* env).
 */
async function confirmPricingPlan(email, { planId, returnUrl, clientId: optsClientId }) {
  const access = optsClientId
    ? await getAccessContextByEmailAndClient(email, optsClientId)
    : await getAccessContextByEmail(email);
  if (!access.ok) throw new Error(access.reason);
  const clientId = access.client.id;
  // pricingplanlogs.staff_id FK → staffdetail.id; client_user 身份没有 staffdetail 行，必须用 staffDetailId 或 NULL
  const staffId =
    access.staffDetailId != null && String(access.staffDetailId).trim()
      ? String(access.staffDetailId).trim()
      : null;
  const [clientRows] = await pool.query(
    'SELECT id, title, status, currency, pricingplandetail FROM operatordetail WHERE id = ? LIMIT 1',
    [clientId]
  );
  if (!clientRows.length || clientRows[0].status !== 1 && clientRows[0].status !== true) throw new Error('CLIENT_INVALID');
  const client = clientRows[0];
  const currency = String(client.currency || '').trim().toUpperCase();
  if (!currency) throw new Error('CLIENT_CURRENCY_MISSING');
  if (!['MYR', 'SGD'].includes(currency)) throw new Error('UNSUPPORTED_CLIENT_CURRENCY');
  const [planRows] = await pool.query('SELECT id, title, sellingprice, corecredit FROM pricingplan WHERE id = ? LIMIT 1', [planId]);
  if (!planRows.length) throw new Error('PLAN_NOT_FOUND');
  const pricingplan = planRows[0];
  const planItem = access.plan.mainPlan;
  let scenario = 'NEW';
  let currentPlan = null;
  if (planItem?.planId) {
    const [curRows] = await pool.query('SELECT id, sellingprice FROM pricingplan WHERE id = ? LIMIT 1', [planItem.planId]);
    currentPlan = curRows[0] || null;
    if (currentPlan) {
      if (currentPlan.id === pricingplan.id) scenario = 'RENEW';
      else if (Number(pricingplan.sellingprice) > Number(currentPlan.sellingprice)) scenario = 'UPGRADE';
      else scenario = 'DOWNGRADE';
    }
  }
  if (scenario === 'DOWNGRADE') throw new Error('SCENARIO_NOT_PAYABLE');
  const pricing = await resolvePricingPlanAmount({ client, plan: pricingplan });
  const amount = pricing.totalPayment;
  const amountCents = Math.round(amount * 100);
  if (amountCents < 100) throw new Error('AMOUNT_TOO_SMALL');
  const today = new Date();
  const currentExpiredDate = access.expired.expiredAt ? new Date(access.expired.expiredAt) : null;
  const planEnd = resolveNewExpiredDate({ scenario, today, currentExpiredDate });
  let addonDeductAmount = 0;
  const addons = {};
  const existingAddons = access.plan.addons || [];
  if ((scenario === 'RENEW' || scenario === 'UPGRADE') && existingAddons.length) {
    for (const a of existingAddons) {
      const [addonRows] = await pool.query('SELECT id, credit_json FROM pricingplanaddon WHERE id = ? LIMIT 1', [a.planId]);
      const addon = addonRows[0];
      if (!addon) continue;
      const yearlyCredit = parseAddonYearlyCredit(typeof addon.credit_json === 'string' ? parseJson(addon.credit_json) : addon.credit_json);
      const qty = Number(a.qty || 0);
      if (yearlyCredit <= 0 || qty <= 0) continue;
      if (scenario === 'RENEW') {
        addonDeductAmount += yearlyCredit * qty;
        addons[a.planId] = qty;
        continue;
      }
      if (scenario === 'UPGRADE') {
        if (!currentExpiredDate || planEnd <= currentExpiredDate) continue;
        const addonStart = new Date(currentExpiredDate.getFullYear(), currentExpiredDate.getMonth() + 1, 1);
        const msPerDay = 1000 * 60 * 60 * 24;
        const daysToCover = Math.ceil((planEnd.getTime() - addonStart.getTime()) / msPerDay);
        if (daysToCover <= 0) continue;
        addonDeductAmount += Math.ceil((yearlyCredit * daysToCover / 365) * qty);
        addons[a.planId] = qty;
      }
    }
  }
  const ref = `PP-${String(clientId).slice(-6)}-${Date.now()}`;
  const referenceNumber = ref.slice(0, 40);
  const samePageUrl = normalizeRedirectUrl(returnUrl);
  if (!samePageUrl) throw new Error('INVALID_RETURN_URL');
  const logId = randomUUID();
  const sep = samePageUrl.includes('?') ? '&' : '?';
  const returnUrlWithFinalize = `${samePageUrl}${sep}plan_finalize=${encodeURIComponent(logId)}`;
  const successSep = returnUrlWithFinalize.includes('?') ? '&' : '?';
  const successUrl = `${returnUrlWithFinalize}${successSep}session_id={CHECKOUT_SESSION_ID}`;
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await pool.query(
    `INSERT INTO pricingplanlogs (id, client_id, staff_id, plan_id, scenario, amount, amountcents, referencenumber, status, title, addondeductamount, addons_json, newexpireddate, redirecturl, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
    [
      logId, clientId, staffId, pricingplan.id, scenario, amount, amountCents, referenceNumber,
      pricingplan.title, addonDeductAmount, JSON.stringify(addons), planEnd, returnUrlWithFinalize, now, now
    ]
  );

  const { createColivingSaasPlatformCheckoutSession } = require('../stripe/stripe.service');
  const stripeCurrency = currency === 'SGD' ? 'sgd' : 'myr';
  try {
    const { url } = await createColivingSaasPlatformCheckoutSession({
      amountCents: amountCents,
      stripeCurrency,
      email: access.staff?.email || '',
      description: `Pricing plan: ${pricingplan.title}`,
      successUrl,
      cancelUrl: samePageUrl,
      metadata: {
        type: 'pricingplan',
        pricingplanlog_id: logId,
        client_id: String(clientId),
        plan_id: String(pricingplan.id),
        planId: String(pricingplan.id)
      }
    });
    return { provider: 'stripe', url, referenceNumber, pricingplanlogId: logId };
  } catch (e) {
    try {
      await pool.query("DELETE FROM pricingplanlogs WHERE id = ? AND status = 'pending'", [logId]);
    } catch (delErr) {
      console.warn('[checkout] confirmPricingPlan cleanup pending log failed', logId, delErr?.message);
    }
    throw e;
  }
}

/**
 * After Stripe checkout.session.completed for pricing plan: mark log paid, update client plan & credit.
 */
async function handlePricingPlanPaymentSuccess({ pricingplanlogId, clientId }) {
  const [rows] = await pool.query(
    'SELECT id, client_id, staff_id, plan_id, scenario, amount, addondeductamount, addons_json, newexpireddate, status FROM pricingplanlogs WHERE id = ? LIMIT 1',
    [pricingplanlogId]
  );
  if (!rows.length) return { ok: false, reason: 'log_not_found' };
  const log = rows[0];
  if (log.status === 'paid') return { ok: true, already: true };
  if (log.client_id !== clientId) return { ok: false, reason: 'client_mismatch' };
  const [planRows] = await pool.query('SELECT id, title, corecredit FROM pricingplan WHERE id = ? LIMIT 1', [log.plan_id]);
  const plan = planRows[0];
  if (!plan) return { ok: false, reason: 'plan_not_found' };
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await conn.query(
      "UPDATE pricingplanlogs SET status = 'paid', paidat = ?, updated_at = ? WHERE id = ?",
      [now, now, pricingplanlogId]
    );
    const [clientRows] = await conn.query(
      'SELECT id, credit, pricingplandetail, currency FROM operatordetail WHERE id = ? LIMIT 1',
      [clientId]
    );
    if (!clientRows.length) throw new Error('client not found');
    const client = clientRows[0];
    let creditList = Array.isArray(parseJson(client.credit)) ? parseJson(client.credit).map((c) => ({ ...c })) : [];
    const addonDeduct = Number(log.addondeductamount) || 0;
    const addonsObj = parseJson(log.addons_json) || {};
    if (addonDeduct > 0) {
      let need = addonDeduct;
      const coreCredits = creditList
        .filter((c) => c.type === 'core' && Number(c.amount) > 0 && c.expired)
        .sort((a, b) => new Date(a.expired).getTime() - new Date(b.expired).getTime());
      for (const c of coreCredits) {
        if (need <= 0) break;
        const used = Math.min(Number(c.amount), need);
        c.amount -= used;
        need -= used;
      }
      let flex = creditList.find((c) => c.type === 'flex');
      if (!flex) {
        flex = { type: 'flex', amount: 0 };
        creditList.push(flex);
      }
      if (need > 0) {
        flex.amount = Number(flex.amount) || 0;
        flex.amount -= need;
      }
    }
    const coreGrant = Number(plan.corecredit) || 0;
    if (coreGrant > 0) {
      const planEnd = log.newexpireddate ? new Date(log.newexpireddate) : null;
      const existingCore = creditList.filter((c) => c.type === 'core');
      creditList = creditList.filter((c) => c.type !== 'core' || Number(c.amount) > 0);
      creditList.push({
        type: 'core',
        amount: coreGrant,
        expired: planEnd ? planEnd.toISOString().slice(0, 10) : null,
        updatedAt: new Date()
      });
      creditList.push(...existingCore.filter((c) => Number(c.amount) > 0));
    }
    creditList = creditList
      .filter((c) => Number(c.amount) > 0 || c.type === 'flex')
      .map((c) => ({ ...c, amount: Number(c.amount) }));
    const expiredStr = toDateOnlyStr(log.newexpireddate);
    const newPricingplandetail = [
      { type: 'plan', planId: log.plan_id, title: plan.title, expired: expiredStr || log.newexpireddate },
      ...Object.entries(addonsObj).map(([planId, qty]) => ({ type: 'addon', planId, qty: Number(qty) || 0 }))
    ];
    await conn.query(
      'UPDATE operatordetail SET credit = ?, pricingplandetail = ?, expired = ?, status = 1, updated_at = ? WHERE id = ?',
      [JSON.stringify(creditList), JSON.stringify(newPricingplandetail), expiredStr, now, clientId]
    );
    if (coreGrant > 0) {
      const currency = String(client.currency || '').trim().toUpperCase();
      if (!currency) throw new Error('CLIENT_CURRENCY_MISSING');
      if (!['MYR', 'SGD'].includes(currency)) throw new Error('UNSUPPORTED_CLIENT_CURRENCY');
      const creditLogId = randomUUID();
      const ref = `PLAN-CREDIT-${creditLogId}`;
      await conn.query(
        `INSERT INTO creditlogs (id, title, type, client_id, staff_id, currency, amount, is_paid, reference_number, pricingplanlog_id, sourplan_id, paiddate, created_at, updated_at)
         VALUES (?, ?, 'Topup', ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
        [
          creditLogId,
          `Pricing plan: ${plan.title} (core credit)`,
          clientId,
          log.staff_id || null,
          currency,
          coreGrant,
          ref,
          pricingplanlogId,
          plan.id,
          now,
          now,
          now
        ]
      );
    }
    const { syncAll } = require('../../services/client-subtables');
    await syncAll(conn, {
      clientId,
      pricingplandetail: newPricingplandetail,
      credit: creditList
    });
    await conn.commit();
    try {
      const { clearBillingCacheByClientId } = require('./billing.service');
      clearBillingCacheByClientId(clientId);
    } catch (e) {
      console.warn('[checkout] clearBillingCacheByClientId after plan success', e?.message || e);
    }
    try {
      const { ensureMasterAdminUserForClient } = require('./indoor-admin.service');
      await ensureMasterAdminUserForClient(clientId);
    } catch (e) {
      console.warn('[checkout] ensureMasterAdminUserForClient after plan success', e?.message || e);
    }
    return { ok: true, planId: log.plan_id, expired: log.newexpireddate };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  previewPricingPlan,
  confirmPricingPlan,
  handlePricingPlanPaymentSuccess,
  buildPayexCustomer: async (email) => {
    const access = await getAccessContextByEmail(email);
    if (!access?.ok) throw new Error(access?.reason || 'ACCESS_DENIED');
    return { customerName: access.client.title, email };
  }
};
