/**
 * Operator Portal SaaS Billplz：MYR credit top-up、operator billing plan、enquiry MYR plan（reference_2 分流）。
 * Webhook：POST /api/billplz/saas-coliving-callback；SGD SaaS 用 Xendit（xendit-saas-platform.service.js）。
 */

const pool = require('../../config/db');
const { utcDatetimeFromDbToMalaysiaDateOnly, getTodayMalaysiaDate } = require('../../utils/dateMalaysia');
const { createBill, getBill } = require('../billplz/wrappers/bill.wrapper');
const { getAccessContextByEmail } = require('../access/access.service');
const { resolveUseSandbox } = require('../billplz/wrappers/billplzrequest');
const { verifyBillplzXSignature } = require('../billplz/lib/signature');
const { syncSubtablesFromOperatordetail } = require('../../services/client-subtables');
const { handlePricingPlanPaymentSuccess } = require('./checkout.service');

function normalizeText(value) {
  return String(value || '').trim();
}

function getSaasBillplzCreds() {
  const apiKey = normalizeText(process.env.SAAS_COLIVING_BILLPLZ_API_KEY);
  const collectionId = normalizeText(process.env.SAAS_COLIVING_BILLPLZ_COLLECTION_ID);
  const xSignatureKey = normalizeText(process.env.SAAS_COLIVING_BILLPLZ_X_SIGNATURE_KEY);
  const requestedSandbox =
    String(process.env.SAAS_COLIVING_BILLPLZ_USE_SANDBOX || '').trim() === '1' ||
    String(process.env.SAAS_COLIVING_BILLPLZ_USE_SANDBOX || '').toLowerCase() === 'true';
  const useSandbox = resolveUseSandbox(requestedSandbox);
  return { apiKey, collectionId, xSignatureKey, useSandbox };
}

function getPublicApiBase() {
  return normalizeText(process.env.SAAS_COLIVING_PUBLIC_API_BASE || process.env.PORTAL_AUTH_BASE_URL || '').replace(
    /\/$/,
    ''
  );
}

function isBillplzPaid(data) {
  const state = normalizeText(data?.state).toLowerCase();
  const paid = data?.paid;
  return paid === true || paid === 'true' || paid === 1 || paid === '1' || state === 'paid';
}

const REF_OPERATOR_TOPUP = 'operator_credit_topup';
const REF_OPERATOR_PLAN = 'operator_pricing_plan';
/** Billplz reference_2 for Portal /enquiry plan checkout — not handled by tryProcessOperatorBillplzWebhook (SAAS_BILLPLZ scenario). */
const REF_SAAS_ENQUIRY_PLAN = 'saas_enquiry_pricing_plan';

const OPERATOR_PORTAL_BILLPLZ_SOURCE = 'operator_portal_billplz';
const SAAS_ENQUIRY_BILLPLZ_SOURCE = 'saas_enquiry_billplz';
/** Operator Portal SaaS checkout via platform Xendit (MYR/SGD). */
const OPERATOR_PORTAL_XENDIT_SAAS_SOURCE = 'operator_portal_xendit_saas';

async function resolveOperatorPricingPlanLogIdFromBillId(billId) {
  const id = normalizeText(billId);
  if (!id) return '';
  let [rows] = await pool.query(
    `SELECT id FROM pricingplanlogs
      WHERE JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.source')) = ?
        AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.billplz_bill_id')) = ?
      ORDER BY created_at DESC
      LIMIT 1`,
    [OPERATOR_PORTAL_BILLPLZ_SOURCE, id]
  );
  if (rows?.[0]?.id) return String(rows[0].id);
  const likeBill = `%"billplz_bill_id":"${id}"%`;
  [rows] = await pool.query(
    `SELECT id FROM pricingplanlogs
      WHERE payload_json LIKE ?
        AND payload_json LIKE '%"operator_portal_billplz"%'
      ORDER BY created_at DESC
      LIMIT 1`,
    [likeBill]
  );
  return rows?.[0]?.id ? String(rows[0].id) : '';
}

async function resolveOperatorCreditLogIdFromBillId(billId) {
  const id = normalizeText(billId);
  if (!id) return '';
  let [rows] = await pool.query(
    `SELECT id FROM creditlogs
      WHERE type = 'Topup'
        AND (is_paid IS NULL OR is_paid = 0)
        AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.source')) = ?
        AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.billplz_bill_id')) = ?
      ORDER BY created_at DESC
      LIMIT 1`,
    [OPERATOR_PORTAL_BILLPLZ_SOURCE, id]
  );
  if (rows?.[0]?.id) return String(rows[0].id);
  const likeBill = `%"billplz_bill_id":"${id}"%`;
  [rows] = await pool.query(
    `SELECT id FROM creditlogs
      WHERE type = 'Topup'
        AND (is_paid IS NULL OR is_paid = 0)
        AND payload LIKE ?
        AND payload LIKE '%"operator_portal_billplz"%'
      ORDER BY created_at DESC
      LIMIT 1`,
    [likeBill]
  );
  return rows?.[0]?.id ? String(rows[0].id) : '';
}

/**
 * Billplz webhook：reference_2 为 operator_* 时处理；部分回调不含 reference_*，用账单 id 关联 pricingplanlogs / creditlogs。
 */
async function tryProcessOperatorBillplzWebhook(payload) {
  let ref2 = normalizeText(payload?.reference_2 || payload?.reference2).toLowerCase();
  let ref1 = normalizeText(payload?.reference_1 || payload?.reference1);
  const billId = normalizeText(payload?.id || payload?.bill_id || payload?.billplz_id);
  const ref2IsOp = ref2 === REF_OPERATOR_TOPUP || ref2 === REF_OPERATOR_PLAN;

  if (billId && (!ref1 || !ref2IsOp)) {
    const planLogId = await resolveOperatorPricingPlanLogIdFromBillId(billId);
    if (planLogId) {
      ref1 = ref1 || planLogId;
      ref2 = REF_OPERATOR_PLAN;
    } else {
      const creditLogId = await resolveOperatorCreditLogIdFromBillId(billId);
      if (creditLogId) {
        ref1 = ref1 || creditLogId;
        ref2 = REF_OPERATOR_TOPUP;
      }
    }
  }

  if (ref2 !== REF_OPERATOR_TOPUP && ref2 !== REF_OPERATOR_PLAN) {
    return { handled: false };
  }
  if (!ref1) {
    return { handled: false };
  }

  const enrichedPayload = { ...payload, reference_1: ref1, reference_2: ref2 };

  const creds = getSaasBillplzCreds();
  if (!creds.xSignatureKey) {
    return { handled: true, result: { ok: false, reason: 'SAAS_BILLPLZ_NOT_CONFIGURED' } };
  }
  const providedSignature = payload?.x_signature;
  if (!verifyBillplzXSignature(payload, creds.xSignatureKey, providedSignature)) {
    return { handled: true, result: { ok: false, reason: 'BILLPLZ_X_SIGNATURE_MISMATCH' } };
  }

  if (ref2 === REF_OPERATOR_TOPUP) {
    const r = await finalizeOperatorCreditTopupFromWebhook(enrichedPayload);
    return { handled: true, result: r };
  }
  const r = await finalizeOperatorPricingPlanFromWebhook(enrichedPayload);
  return { handled: true, result: r };
}

async function finalizeOperatorCreditTopupFromWebhook(payload) {
  const creditlogId = normalizeText(payload?.reference_1 || payload?.reference1);
  if (!creditlogId) return { ok: false, reason: 'MISSING_REFERENCE' };

  const [rows] = await pool.query(
    `SELECT id, client_id, amount, payment, currency, title FROM creditlogs WHERE id = ? AND type = 'Topup' AND is_paid = 0 LIMIT 1`,
    [creditlogId]
  );
  if (!rows.length) {
    const [paidRows] = await pool.query(
      `SELECT id FROM creditlogs WHERE id = ? AND type = 'Topup' AND is_paid = 1 LIMIT 1`,
      [creditlogId]
    );
    if (paidRows.length) return { ok: true, paid: true, already: true };
    return { ok: false, reason: 'CREDITLOG_NOT_FOUND' };
  }
  const log = rows[0];
  const expectedCents = Math.round(Number(log.payment || 0) * 100);
  const amountCents = Math.round(Number(payload?.paid_amount ?? payload?.amount ?? 0));
  if (expectedCents > 0 && amountCents > 0 && amountCents !== expectedCents) {
    console.warn('[billplz-operator-saas] topup amount mismatch', creditlogId, expectedCents, amountCents);
    return { ok: false, reason: 'AMOUNT_MISMATCH' };
  }

  if (!isBillplzPaid(payload)) {
    return { ok: true, paid: false, state: normalizeText(payload?.state) };
  }

  return applyOperatorCreditTopupPaid({
    creditlogId,
    txnid: normalizeText(payload?.id || payload?.billplz_id || payload?.bill_id) || 'billplz',
    payloadStorable: { billplz: payload },
    paymentMethodLabel: 'Billplz',
    amountCentsForBukku: amountCents
  });
}

/**
 * After confirmed payment (Billplz or Xendit SaaS): credit flex, pending fees, SaaS Bukku invoice.
 * @param {{ creditlogId: string, txnid: string, payloadStorable: object, paymentMethodLabel: string, amountCentsForBukku?: number }} p
 */
async function applyOperatorCreditTopupPaid(p) {
  const creditlogId = normalizeText(p.creditlogId);
  const txnid = normalizeText(p.txnid) || 'paid';
  const paymentMethodLabel = normalizeText(p.paymentMethodLabel) || 'Online';

  const [rows] = await pool.query(
    `SELECT id, client_id, amount, payment, currency, title FROM creditlogs WHERE id = ? AND type = 'Topup' AND is_paid = 0 LIMIT 1`,
    [creditlogId]
  );
  if (!rows.length) {
    const [paidRows] = await pool.query(
      `SELECT id FROM creditlogs WHERE id = ? AND type = 'Topup' AND is_paid = 1 LIMIT 1`,
      [creditlogId]
    );
    if (paidRows.length) return { ok: true, paid: true, already: true, creditlog_id: creditlogId };
    return { ok: false, reason: 'CREDITLOG_NOT_FOUND' };
  }
  const log = rows[0];
  const creditAmount = Number(log.amount) || 0;
  if (creditAmount <= 0) return { ok: false, reason: 'INVALID_CREDIT_AMOUNT' };

  const [[totalRow]] = await pool.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM client_credit WHERE client_id = ?`, [
    log.client_id
  ]);
  const creditBefore = totalRow ? Number(totalRow.total) || 0 : 0;
  const creditAfter = creditBefore + creditAmount;

  const paiddate = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const payloadJson = JSON.stringify(p.payloadStorable && typeof p.payloadStorable === 'object' ? p.payloadStorable : {});

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      'UPDATE creditlogs SET is_paid = 1, txnid = ?, payload = ?, paiddate = ?, updated_at = NOW() WHERE id = ?',
      [txnid, payloadJson, paiddate, creditlogId]
    );
    const [clientRows] = await conn.query('SELECT id, credit FROM operatordetail WHERE id = ? LIMIT 1', [log.client_id]);
    if (!clientRows.length) throw new Error('client not found');
    const raw = clientRows[0].credit;
    let creditList = [];
    try {
      creditList = typeof raw === 'string' ? JSON.parse(raw || '[]') : Array.isArray(raw) ? raw : [];
    } catch (_) {
      creditList = [];
    }
    let flex = creditList.find((c) => c.type === 'flex');
    if (!flex) {
      flex = { type: 'flex', amount: 0 };
      creditList.push(flex);
    }
    flex.amount = Number(flex.amount) || 0;
    flex.amount += creditAmount;
    await conn.query('UPDATE operatordetail SET credit = ?, updated_at = NOW() WHERE id = ?', [
      JSON.stringify(creditList),
      log.client_id
    ]);
    await syncSubtablesFromOperatordetail(conn, log.client_id);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    console.error('[billplz-operator-saas] topup finalize', err?.message || err);
    throw err;
  } finally {
    conn.release();
  }

  try {
    const { processPayexPendingFees } = require('../payex/payex.service');
    await processPayexPendingFees(log.client_id);
  } catch (e) {
    console.warn('[billplz-operator-saas] processPayexPendingFees', e?.message);
  }
  try {
    const { processBillplzPendingFees } = require('../billplz/billplz.service');
    await processBillplzPendingFees(log.client_id);
  } catch (e) {
    console.warn('[billplz-operator-saas] processBillplzPendingFees', e?.message);
  }

  const amountCents = p.amountCentsForBukku != null ? Math.round(Number(p.amountCentsForBukku)) : 0;
  const paymentAmount = Number(log.payment) || (amountCents > 0 ? amountCents / 100 : 0);
  const currency = String(log.currency || 'MYR').trim().toUpperCase();
  try {
    const {
      createSaasBukkuCashInvoiceIfConfigured,
      buildTopupInvoiceTitle,
      buildTopupLineItemDescription,
      ensureClientBukkuContact,
      PRODUCT_TOPUPCREDIT,
      ACCOUNT_REVENUE,
      PAYMENT_BANK,
      PAYMENT_STRIPE,
      PAYMENT_XENDIT
    } = require('./saas-bukku.service');
    const defaultContactId = process.env.BUKKU_SAAS_DEFAULT_CONTACT_ID ? Number(process.env.BUKKU_SAAS_DEFAULT_CONTACT_ID) : null;
    const contactId = (await ensureClientBukkuContact(log.client_id)) ?? defaultContactId;
    const pm = String(paymentMethodLabel || '').toLowerCase();
    const paymentAccountId =
      pm.includes('xendit') || pm.includes('payex') || pm.includes('fpx') ? PAYMENT_XENDIT
      : pm.includes('stripe') ? PAYMENT_STRIPE
      : PAYMENT_BANK;
    const invRes = await createSaasBukkuCashInvoiceIfConfigured({
      contactId,
      productId: PRODUCT_TOPUPCREDIT,
      accountId: ACCOUNT_REVENUE,
      amount: paymentAmount,
      paidDate: utcDatetimeFromDbToMalaysiaDateOnly(paiddate),
      paymentAccountId,
      invoiceTitle: buildTopupInvoiceTitle({ creditAmount }),
      lineItemDescription: buildTopupLineItemDescription({
        creditAmount,
        when: paiddate,
        paymentMethod: paymentMethodLabel,
        amount: paymentAmount,
        currency,
        creditBefore,
        creditAfter
      }),
      currencyCode: currency
    });
    if (invRes.ok && (invRes.invoiceId != null || invRes.invoiceUrl)) {
      await pool.query('UPDATE creditlogs SET invoiceid = ?, invoiceurl = ? WHERE id = ?', [
        invRes.invoiceId != null ? String(invRes.invoiceId) : null,
        invRes.invoiceUrl || null,
        creditlogId
      ]);
    }
  } catch (bukkuErr) {
    console.warn('[billplz-operator-saas] Topup Bukku invoice failed', bukkuErr?.message || bukkuErr);
  }

  return { ok: true, paid: true, type: 'operator_credit_topup', creditlog_id: creditlogId };
}

async function finalizeOperatorPricingPlanFromWebhook(payload) {
  const logId = normalizeText(payload?.reference_1 || payload?.reference1);
  if (!logId) return { ok: false, reason: 'MISSING_REFERENCE' };

  const [logRows] = await pool.query(
    `SELECT id, client_id, plan_id, amount, status, scenario FROM pricingplanlogs WHERE id = ? LIMIT 1`,
    [logId]
  );
  if (!logRows.length) return { ok: false, reason: 'LOG_NOT_FOUND' };
  const log = logRows[0];
  if (normalizeText(log.scenario) === 'SAAS_BILLPLZ') {
    return { ok: false, reason: 'USE_ENQUIRY_WEBHOOK_PATH' };
  }

  const expectedCents = Math.round(Number(log.amount || 0) * 100);
  const amountCents = Math.round(Number(payload?.paid_amount ?? payload?.amount ?? 0));
  if (expectedCents > 0 && amountCents > 0 && amountCents !== expectedCents) {
    console.warn('[billplz-operator-saas] plan amount mismatch', logId, expectedCents, amountCents);
    return { ok: false, reason: 'AMOUNT_MISMATCH' };
  }

  if (!isBillplzPaid(payload)) {
    return { ok: true, paid: false, state: normalizeText(payload?.state) };
  }

  if (log.status === 'paid') {
    return { ok: true, paid: true, already: true };
  }

  const clientId = log.client_id;
  const planResult = await handlePricingPlanPaymentSuccess({ pricingplanlogId: logId, clientId });
  if (!planResult.ok) return planResult;

  if (planResult.already) {
    return { ok: true, paid: true, already: true };
  }

  try {
    await saasBukkuInvoiceForPricingPlan(logId, clientId, 'Billplz');
  } catch (bukkuErr) {
    console.warn('[billplz-operator-saas] pricing plan Bukku failed', bukkuErr?.message || bukkuErr);
  }

  return { ok: true, paid: true, type: 'operator_pricing_plan', pricingplanlogId: logId };
}

/**
 * SaaS Bukku cash invoice after pricing plan row is marked paid (Billplz or Xendit).
 */
async function saasBukkuInvoiceForPricingPlan(logId, clientId, paymentMethodLabel) {
  const [logRows] = await pool.query(
    `SELECT plan_id, amount FROM pricingplanlogs WHERE id = ? LIMIT 1`,
    [logId]
  );
  if (!logRows.length) return;
  const row = logRows[0];
  const {
    createSaasBukkuCashInvoiceIfConfigured,
    buildPlanDescription,
    ensureClientBukkuContact,
    PRODUCT_PRICINGPLAN,
    ACCOUNT_REVENUE,
    PAYMENT_BANK,
    PAYMENT_STRIPE,
    PAYMENT_XENDIT
  } = require('./saas-bukku.service');
  const amount = Number(row.amount) || 0;
  const paidDate = getTodayMalaysiaDate();
  const whenStr = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const [[clientRow]] = await pool.query('SELECT title, currency FROM operatordetail WHERE id = ? LIMIT 1', [clientId]);
  const clientName = clientRow?.title || '';
  const currency = String(clientRow?.currency || 'MYR').trim().toUpperCase();
  const [[planRow]] = await pool.query('SELECT title FROM pricingplan WHERE id = ? LIMIT 1', [row.plan_id]);
  const planTitle = planRow?.title || '';

  const defaultContactId = process.env.BUKKU_SAAS_DEFAULT_CONTACT_ID ? Number(process.env.BUKKU_SAAS_DEFAULT_CONTACT_ID) : null;
  const contactId = (await ensureClientBukkuContact(clientId)) ?? defaultContactId;
  if (!contactId) return;
  const pm = String(paymentMethodLabel || '').toLowerCase();
  const paymentAccountId =
    pm.includes('xendit') || pm.includes('payex') || pm.includes('fpx') ? PAYMENT_XENDIT
    : pm.includes('stripe') ? PAYMENT_STRIPE
    : PAYMENT_BANK;
  const invRes = await createSaasBukkuCashInvoiceIfConfigured({
    contactId,
    productId: PRODUCT_PRICINGPLAN,
    accountId: ACCOUNT_REVENUE,
    amount,
    paidDate,
    paymentAccountId,
    description: buildPlanDescription({
      clientName,
      when: whenStr,
      paymentMethod: paymentMethodLabel || 'Online',
      amount,
      currency,
      planTitle
    }),
    currencyCode: currency
  });
  if (invRes.ok && !invRes.skipped && (invRes.invoiceId != null || invRes.invoiceUrl)) {
    await pool.query('UPDATE pricingplanlogs SET invoiceid = ?, invoiceurl = ? WHERE id = ?', [
      invRes.invoiceId != null ? String(invRes.invoiceId) : null,
      invRes.invoiceUrl || null,
      logId
    ]);
  }
}

async function createOperatorCreditTopupBillplz({ creditLogId, returnUrl, email, customerName, amountRM }) {
  const creds = getSaasBillplzCreds();
  if (!creds.apiKey || !creds.collectionId || !creds.xSignatureKey) {
    return { ok: false, reason: 'SAAS_BILLPLZ_NOT_CONFIGURED' };
  }
  const apiBase = getPublicApiBase();
  if (!apiBase) return { ok: false, reason: 'SAAS_PUBLIC_API_BASE_NOT_SET' };

  const amountCents = Math.round(Number(amountRM) * 100);
  if (amountCents < 100) return { ok: false, reason: 'AMOUNT_TOO_SMALL' };

  const callbackUrl = `${apiBase}/api/billplz/saas-coliving-callback`;
  const redirectUrl = normalizeText(returnUrl) || 'https://portal.colivingjb.com/operator/credit';

  const result = await createBill({
    apiKey: creds.apiKey,
    collectionId: creds.collectionId,
    email: normalizeText(email).toLowerCase(),
    name: normalizeText(customerName).slice(0, 255) || 'Operator',
    amount: amountCents,
    callbackUrl,
    redirectUrl,
    description: normalizeText('Coliving SaaS — Credit top-up').slice(0, 200),
    reference1Label: 'Reference',
    reference1: creditLogId,
    reference2Label: 'Type',
    reference2: REF_OPERATOR_TOPUP,
    useSandbox: creds.useSandbox
  });

  if (!result?.ok) {
    const providerMessage =
      typeof result?.error === 'string'
        ? result.error
        : normalizeText(result?.error?.error?.message || result?.error?.message || result?.error);
    return { ok: false, reason: 'BILLPLZ_CREATE_FAILED', message: providerMessage };
  }
  const bill = result?.data || {};
  const billId = normalizeText(bill?.id);
  try {
    await pool.query('UPDATE creditlogs SET payload = ? WHERE id = ?', [
      JSON.stringify({
        source: OPERATOR_PORTAL_BILLPLZ_SOURCE,
        billplz_bill_id: billId,
        billplz_state: bill?.state || null
      }),
      creditLogId
    ]);
  } catch (e) {
    console.warn('[billplz-operator-saas] creditlogs payload update failed', e?.message);
  }
  return { ok: true, url: normalizeText(bill?.url), billId };
}

async function createOperatorPricingPlanBillplz({
  pricingplanlogId,
  returnUrl,
  email,
  customerName,
  amountRM,
  planTitle
}) {
  const creds = getSaasBillplzCreds();
  if (!creds.apiKey || !creds.collectionId || !creds.xSignatureKey) {
    return { ok: false, reason: 'SAAS_BILLPLZ_NOT_CONFIGURED' };
  }
  const apiBase = getPublicApiBase();
  if (!apiBase) return { ok: false, reason: 'SAAS_PUBLIC_API_BASE_NOT_SET' };

  const amountCents = Math.round(Number(amountRM) * 100);
  if (amountCents < 100) return { ok: false, reason: 'AMOUNT_TOO_SMALL' };

  const callbackUrl = `${apiBase}/api/billplz/saas-coliving-callback`;
  const redirectUrl = normalizeText(returnUrl) || 'https://portal.colivingjb.com/operator/billing';

  const result = await createBill({
    apiKey: creds.apiKey,
    collectionId: creds.collectionId,
    email: normalizeText(email).toLowerCase(),
    name: normalizeText(customerName).slice(0, 255) || 'Operator',
    amount: amountCents,
    callbackUrl,
    redirectUrl,
    description: normalizeText(`Coliving SaaS — ${planTitle || 'Plan'}`).slice(0, 200),
    reference1Label: 'Reference',
    reference1: pricingplanlogId,
    reference2Label: 'Type',
    reference2: REF_OPERATOR_PLAN,
    useSandbox: creds.useSandbox
  });

  if (!result?.ok) {
    const providerMessage =
      typeof result?.error === 'string'
        ? result.error
        : normalizeText(result?.error?.error?.message || result?.error?.message || result?.error);
    return { ok: false, reason: 'BILLPLZ_CREATE_FAILED', message: providerMessage };
  }
  const bill = result?.data || {};
  const billId = normalizeText(bill?.id);
  try {
    await pool.query('UPDATE pricingplanlogs SET payload_json = ? WHERE id = ?', [
      JSON.stringify({
        source: OPERATOR_PORTAL_BILLPLZ_SOURCE,
        billplz_bill_id: billId,
        billplz_state: bill?.state || null
      }),
      pricingplanlogId
    ]);
  } catch (e) {
    console.warn('[billplz-operator-saas] update payload_json failed', e?.message);
  }
  return { ok: true, url: normalizeText(bill?.url), billId };
}

/**
 * Portal /enquiry MYR plan payment — same as createOperatorPricingPlanBillplz but reference_2 routes to enquiry webhook path (not operator portal finalize).
 */
async function createEnquiryPricingPlanBillplz({
  pricingplanlogId,
  returnUrl,
  email,
  customerName,
  amountRM,
  planTitle
}) {
  const creds = getSaasBillplzCreds();
  if (!creds.apiKey || !creds.collectionId || !creds.xSignatureKey) {
    return { ok: false, reason: 'SAAS_BILLPLZ_NOT_CONFIGURED' };
  }
  const apiBase = getPublicApiBase();
  if (!apiBase) return { ok: false, reason: 'SAAS_PUBLIC_API_BASE_NOT_SET' };

  const amountCents = Math.round(Number(amountRM) * 100);
  if (amountCents < 100) return { ok: false, reason: 'AMOUNT_TOO_SMALL' };

  const callbackUrl = `${apiBase}/api/billplz/saas-coliving-callback`;
  const redirectUrl = normalizeText(returnUrl) || 'https://portal.colivingjb.com/enquiry?paid=1';

  const result = await createBill({
    apiKey: creds.apiKey,
    collectionId: creds.collectionId,
    email: normalizeText(email).toLowerCase(),
    name: normalizeText(customerName).slice(0, 255) || 'Operator',
    amount: amountCents,
    callbackUrl,
    redirectUrl,
    description: normalizeText(`Coliving SaaS — ${planTitle || 'Plan'}`).slice(0, 200),
    reference1Label: 'Reference',
    reference1: pricingplanlogId,
    reference2Label: 'Type',
    reference2: REF_SAAS_ENQUIRY_PLAN,
    useSandbox: creds.useSandbox
  });

  if (!result?.ok) {
    const providerMessage =
      typeof result?.error === 'string'
        ? result.error
        : normalizeText(result?.error?.error?.message || result?.error?.message || result?.error);
    return { ok: false, reason: 'BILLPLZ_CREATE_FAILED', message: providerMessage };
  }
  const bill = result?.data || {};
  const billId = normalizeText(bill?.id);
  try {
    await pool.query('UPDATE pricingplanlogs SET payload_json = ? WHERE id = ?', [
      JSON.stringify({
        source: SAAS_ENQUIRY_BILLPLZ_SOURCE,
        billplz_bill_id: billId,
        billplz_state: bill?.state || null
      }),
      pricingplanlogId
    ]);
  } catch (e) {
    console.warn('[billplz-operator-saas] enquiry update payload_json failed', e?.message);
  }
  return { ok: true, url: normalizeText(bill?.url), billId };
}

/**
 * After Billplz redirect: poll bill status and apply top-up if PAID (webhook delayed).
 */
async function syncSaasTopupFromBillplzAfterReturn(email, creditLogId) {
  const normalized = normalizeText(email).toLowerCase();
  const id = normalizeText(creditLogId);
  if (!normalized || !id) return { ok: false, reason: 'MISSING_PARAMS' };
  const ctx = await getAccessContextByEmail(normalized);
  if (!ctx.ok) return { ok: false, reason: ctx.reason || 'ACCESS_DENIED' };

  const creds = getSaasBillplzCreds();
  if (!creds.apiKey) return { ok: false, reason: 'SAAS_BILLPLZ_NOT_CONFIGURED' };

  const [rows] = await pool.query(
    `SELECT id, client_id, payment, payload, is_paid FROM creditlogs WHERE id = ? AND type = 'Topup' LIMIT 1`,
    [id]
  );
  if (!rows.length) return { ok: false, reason: 'CREDITLOG_NOT_FOUND' };
  const row = rows[0];
  if (normalizeText(row.client_id) !== normalizeText(ctx.client.id)) {
    return { ok: false, reason: 'CLIENT_MISMATCH' };
  }
  if (row.is_paid) return { ok: true, paid: true, already: true };

  let payload = {};
  try {
    payload = JSON.parse(row.payload || '{}');
  } catch {
    payload = {};
  }
  const billId = normalizeText(payload.billplz_bill_id);
  if (!billId) return { ok: false, reason: 'NO_BILLPLZ_BILL_ON_LOG' };

  const gb = await getBill({ apiKey: creds.apiKey, billId, useSandbox: creds.useSandbox });
  if (!gb?.ok) {
    const errMsg =
      typeof gb?.error === 'string' ? gb.error : normalizeText(gb?.error?.message || gb?.error);
    return { ok: false, reason: 'BILLPLZ_GET_BILL_FAILED', message: errMsg };
  }
  const data = gb?.data && typeof gb.data === 'object' ? gb.data : gb;
  if (!isBillplzPaid(data)) return { ok: true, paid: false };

  const amountCents = Math.round(Number(data?.paid_amount ?? data?.amount ?? 0));
  return applyOperatorCreditTopupPaid({
    creditlogId: id,
    txnid: normalizeText(data?.id || billId) || 'billplz',
    payloadStorable: { billplz: data },
    paymentMethodLabel: 'Billplz',
    amountCentsForBukku: amountCents
  });
}

/**
 * After Billplz redirect: poll bill and finalize pricing plan (operator or enquiry SAAS_BILLPLZ).
 */
async function syncSaasPricingPlanFromBillplzAfterReturn(email, pricingplanlogId) {
  const normalized = normalizeText(email).toLowerCase();
  const logId = normalizeText(pricingplanlogId);
  if (!normalized || !logId) return { ok: false, reason: 'MISSING_PARAMS' };
  const ctx = await getAccessContextByEmail(normalized);
  if (!ctx.ok) return { ok: false, reason: ctx.reason || 'ACCESS_DENIED' };

  const creds = getSaasBillplzCreds();
  if (!creds.apiKey) return { ok: false, reason: 'SAAS_BILLPLZ_NOT_CONFIGURED' };

  const [logRows] = await pool.query(
    `SELECT id, client_id, amount, status, scenario, payload_json FROM pricingplanlogs WHERE id = ? LIMIT 1`,
    [logId]
  );
  if (!logRows.length) return { ok: false, reason: 'LOG_NOT_FOUND' };
  const log = logRows[0];
  if (normalizeText(log.client_id) !== normalizeText(ctx.client.id)) {
    return { ok: false, reason: 'CLIENT_MISMATCH' };
  }
  if (log.status === 'paid') return { ok: true, paid: true, already: true };

  let p = {};
  try {
    p = JSON.parse(log.payload_json || '{}');
  } catch {
    p = {};
  }
  const billId = normalizeText(p.billplz_bill_id);
  if (!billId) return { ok: false, reason: 'NO_BILLPLZ_BILL_ON_LOG' };

  const gb = await getBill({ apiKey: creds.apiKey, billId, useSandbox: creds.useSandbox });
  if (!gb?.ok) {
    const errMsg =
      typeof gb?.error === 'string' ? gb.error : normalizeText(gb?.error?.message || gb?.error);
    return { ok: false, reason: 'BILLPLZ_GET_BILL_FAILED', message: errMsg };
  }
  const data = gb?.data && typeof gb.data === 'object' ? gb.data : gb;
  if (!isBillplzPaid(data)) return { ok: true, paid: false };

  if (normalizeText(log.scenario) === 'SAAS_BILLPLZ') {
    const expectedCents = Math.round(Number(log.amount || 0) * 100);
    const amountCents = Math.round(Number(data?.paid_amount ?? data?.amount ?? 0));
    if (expectedCents > 0 && amountCents > 0 && amountCents !== expectedCents) {
      return { ok: false, reason: 'AMOUNT_MISMATCH' };
    }
    const { finalizeSaasPlanAfterBillplzPayment } = require('./indoor-admin.service');
    const fin = await finalizeSaasPlanAfterBillplzPayment({
      pricingplanlogId: logId,
      paidDateStr: getTodayMalaysiaDate(),
      paymentMethodLabel: 'Billplz'
    });
    return { ok: fin.ok !== false, paid: true, finalize: fin };
  }

  const synthetic = {
    reference_1: logId,
    reference_2: REF_OPERATOR_PLAN,
    paid_amount: data.paid_amount ?? data.amount,
    amount: data.amount,
    state: data.state,
    paid: data.paid,
    id: data.id || billId
  };
  return finalizeOperatorPricingPlanFromWebhook(synthetic);
}

module.exports = {
  tryProcessOperatorBillplzWebhook,
  createOperatorCreditTopupBillplz,
  createOperatorPricingPlanBillplz,
  createEnquiryPricingPlanBillplz,
  syncSaasTopupFromBillplzAfterReturn,
  syncSaasPricingPlanFromBillplzAfterReturn,
  REF_OPERATOR_TOPUP,
  REF_OPERATOR_PLAN,
  REF_SAAS_ENQUIRY_PLAN,
  OPERATOR_PORTAL_XENDIT_SAAS_SOURCE,
  applyOperatorCreditTopupPaid,
  saasBukkuInvoiceForPricingPlan
};
