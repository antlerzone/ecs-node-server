/**
 * Checkout – migrated from Wix backend/billing/checkout.jsw.
 * Stripe only (no Payex). Uses MySQL: clientdetail, pricingplan, pricingplanaddon, pricingplanlogs, client_pricingplan_detail.
 */

const pool = require('../../config/db');
const { randomUUID } = require('crypto');
const { syncSubtablesFromClientdetail } = require('../../services/client-subtables');
const { getAccessContextByEmail } = require('../access/access.service');

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
  if (!url.startsWith('https://www.colivingjb.com')) return null;
  return url;
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
async function previewPricingPlan(email, { planId }) {
  const access = await getAccessContextByEmail(email);
  if (!access.ok) throw new Error(access.reason);
  const clientId = access.client.id;
  const [clientRows] = await pool.query(
    'SELECT id, title, status, currency, expired, credit, pricingplandetail FROM clientdetail WHERE id = ? LIMIT 1',
    [clientId]
  );
  if (!clientRows.length || clientRows[0].status !== 1 && clientRows[0].status !== true) throw new Error('CLIENT_INVALID');
  const client = clientRows[0];
  const currency = String(client.currency || '').toUpperCase() === 'SGD' ? 'SGD' : 'MYR';
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

/** Amount (in client currency) above which we do not use Stripe; manual invoice and manual plan update. */
const PRICING_PLAN_STRIPE_MAX_AMOUNT = 1000;

/**
 * Confirm pricing plan: insert pricingplanlogs (pending). If amount < 1000, create Stripe Checkout; else return provider 'manual' and create a help ticket for visibility.
 */
async function confirmPricingPlan(email, { planId, returnUrl }) {
  const access = await getAccessContextByEmail(email);
  if (!access.ok) throw new Error(access.reason);
  if (!access.staff?.permission?.billing && !access.staff?.permission?.admin) throw new Error('NO_PERMISSION');
  const clientId = access.client.id;
  const staffId = access.staff.id;
  const [clientRows] = await pool.query(
    'SELECT id, title, status, currency, pricingplandetail FROM clientdetail WHERE id = ? LIMIT 1',
    [clientId]
  );
  if (!clientRows.length || clientRows[0].status !== 1 && clientRows[0].status !== true) throw new Error('CLIENT_INVALID');
  const client = clientRows[0];
  const currency = String(client.currency || '').toUpperCase() === 'SGD' ? 'SGD' : 'MYR';
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
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await pool.query(
    `INSERT INTO pricingplanlogs (id, client_id, staff_id, plan_id, scenario, amount, amountcents, referencenumber, status, title, addondeductamount, addons_json, newexpireddate, redirecturl, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
    [
      logId, clientId, staffId, pricingplan.id, scenario, amount, amountCents, referenceNumber,
      pricingplan.title, addonDeductAmount, JSON.stringify(addons), planEnd, samePageUrl, now, now
    ]
  );

  if (amount >= PRICING_PLAN_STRIPE_MAX_AMOUNT) {
    try {
      const { recordManualBillingTicket } = require('../help/help.service');
      await recordManualBillingTicket(clientId, access.staff?.email, {
        scenario,
        referenceNumber,
        amount,
        currency,
        planTitle: pricingplan.title
      });
    } catch (err) {
      console.warn('[checkout] recordManualBillingTicket failed', err?.message);
    }
    return {
      provider: 'manual',
      referenceNumber,
      pricingplanlogId: logId,
      amount,
      currency,
      message: 'Amount 1000 or above: we will send you an invoice; please pay manually. We will update your plan after payment.'
    };
  }

  const { createCheckoutSession } = require('../stripe/stripe.service');
  const stripeRes = await createCheckoutSession({
    amountCents,
    currency: currency.toLowerCase(),
    email: access.staff.email,
    description: `Pricing Plan: ${pricingplan.title}`,
    returnUrl: samePageUrl,
    cancelUrl: samePageUrl,
    clientId,
    metadata: {
      type: 'pricingplan',
      pricingplanlog_id: logId,
      scenario,
      planId: pricingplan.id,
      client_id: clientId
    }
  });
  return { provider: 'stripe', url: stripeRes.url, referenceNumber };
}

/**
 * After Stripe checkout.session.completed for pricing plan: mark log paid, update client plan & credit.
 */
async function handlePricingPlanPaymentSuccess({ pricingplanlogId, clientId }) {
  const [rows] = await pool.query(
    'SELECT id, client_id, plan_id, scenario, amount, addondeductamount, addons_json, newexpireddate, status FROM pricingplanlogs WHERE id = ? LIMIT 1',
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
      'SELECT id, credit, pricingplandetail FROM clientdetail WHERE id = ? LIMIT 1',
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
      'UPDATE clientdetail SET credit = ?, pricingplandetail = ?, expired = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(creditList), JSON.stringify(newPricingplandetail), expiredStr, now, clientId]
    );
    const { syncAll } = require('../../services/client-subtables');
    await syncAll(conn, {
      clientId,
      pricingplandetail: newPricingplandetail,
      credit: creditList
    });
    await conn.commit();
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
