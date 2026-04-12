/**
 * Billing API – migrated from Wix backend/billing (billing.jsw, topup.jsw, deduction.jsw, checkout.jsw).
 * All endpoints require email (POST body or GET query) to resolve access context, except deduction in system mode.
 */

const express = require('express');
const router = express.Router();
const { formatApiResponseDates } = require('../../utils/dateMalaysia');
const XLSX = require('xlsx');
const downloadStore = require('../download/download.store');
const {
  getMyBillingInfo,
  getCreditStatements,
  getPlans,
  getAddons,
  getCreditPlans,
  getStatementItems,
  clearBillingCache,
  getMyClient,
  clearClientCache,
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
} = require('./billing.service');
const { startNormalTopup, submitManualTopupRequest } = require('./topup.service');
const { syncSaasTopupFromXenditAfterReturn, syncSaasPricingPlanFromXenditAfterReturn } = require('./xendit-saas-platform.service');
const {
  syncSaasTopupFromBillplzAfterReturn,
  syncSaasPricingPlanFromBillplzAfterReturn
} = require('./billplz-operator-saas.service');
const {
  syncSaasTopupFromStripeAfterReturn,
  syncSaasPricingPlanFromStripeAfterReturn
} = require('./saas-stripe-platform.service');
const { deductAddonCredit, deductPricingPlanAddonCredit } = require('./deduction.service');
const { previewPricingPlan, confirmPricingPlan } = require('./checkout.service');
const { manualTopup, manualRenew, saveCnyiotSalesUser, ensureBukkuContactForClient } = require('./indoor-admin.service');
const apiUserService = require('../api-user/api-user.service');

function getEmail(req) {
  return req.body?.email ?? req.query?.email ?? null;
}

function getClientId(req) {
  return req.body?.clientId ?? req.body?.client ?? req.query?.clientId ?? req.query?.client ?? null;
}

/**
 * GET or POST /api/billing/my-info
 * Body or query: { email }
 * Returns: { noPermission?: true, currency?, title?, plan?, credit?, expired?, pricingplandetail? }
 */
router.get('/my-info', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const clientId = getClientId(req);
    const result = await getMyBillingInfo(email, clientId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/my-info', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const clientId = getClientId(req);
    const result = await getMyBillingInfo(email, clientId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/api-docs-my-access
 * Body: { email }（portal 登入后的 email）。若该用户为 staff 且其 client 已开通 API Docs（有 api_user 且 can_access_docs=1），返回 hasAccess + username/token；否则 hasAccess: false。供 /portal 显示是否显示 API Docs 卡片、/docs 是否直接展示文档与 API key。
 */
router.post('/api-docs-my-access', async (req, res, next) => {
  try {
    const email = getEmail(req);
    if (!email) return res.json({ ok: true, hasAccess: false });
    const { getAccessContextByEmail } = require('../access/access.service');
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok || !ctx.client?.id) return res.json({ ok: true, hasAccess: false });
    const apiUser = await apiUserService.getByClientId(ctx.client.id);
    if (!apiUser) return res.json({ ok: true, hasAccess: false });
    return res.json({
      ok: true,
      hasAccess: true,
      user: { username: apiUser.username, token: apiUser.token }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/saas-stripe-fee-preview
 * Body: { subtotalMajor: number, currency: 'MYR'|'SGD' } — no login required; returns estimated fee breakdown for Coliving SaaS Stripe Checkout.
 */
router.post('/saas-stripe-fee-preview', async (req, res, next) => {
  try {
    const { computeColivingSaasStripeCheckoutBreakdown } = require('../../constants/payment-fees');
    const subtotalMajor = Number(req.body?.subtotalMajor);
    const currency = String(req.body?.currency || 'MYR')
      .trim()
      .toUpperCase();
    if (!Number.isFinite(subtotalMajor) || subtotalMajor < 0) {
      return res.status(400).json({ ok: false, reason: 'BAD_SUBTOTAL' });
    }
    if (currency !== 'MYR' && currency !== 'SGD') {
      return res.status(400).json({ ok: false, reason: 'BAD_CURRENCY' });
    }
    const baseCents = Math.round(subtotalMajor * 100);
    const stripeCurrency = currency === 'SGD' ? 'sgd' : 'myr';
    const br = computeColivingSaasStripeCheckoutBreakdown(baseCents, stripeCurrency);
    return res.json({
      ok: true,
      currency,
      baseMajor: br.baseCents / 100,
      transactionFeeMajor: br.transactionFeeCents / 100,
      totalMajor: br.totalCents / 100,
      transactionFeePercent: br.transactionFeePercent
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET or POST /api/billing/credit-statements
 * Body or query: { email, page?, pageSize?, sort?, filterType?, search? }
 * sort: 'new' | 'old' | 'amountAsc' | 'amountDesc'
 * filterType: null | 'Topup' | 'Spending'
 * Returns: { items, total, page, pageSize }
 */
router.get('/credit-statements', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const clientId = getClientId(req);
    const opts = {
      page: req.query.page != null ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize != null ? Number(req.query.pageSize) : 10,
      sort: req.query.sort || 'new',
      filterType: req.query.filterType || null,
      search: req.query.search || '',
      clientId
    };
    const result = await getCreditStatements(email, opts);
    formatApiResponseDates(result);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/credit-statements', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const body = req.body || {};
    const opts = {
      page: body.page != null ? Number(body.page) : 1,
      pageSize: body.pageSize != null ? Number(body.pageSize) : 10,
      sort: body.sort || 'new',
      filterType: body.filterType || null,
      search: body.search || '',
      clientId: getClientId(req)
    };
    const result = await getCreditStatements(email, opts);
    formatApiResponseDates(result);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/clear-cache
 * Body or query: { email }
 */
router.post('/clear-cache', async (req, res, next) => {
  try {
    const email = getEmail(req);
    await clearBillingCache(email);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * GET or POST /api/billing/my-client
 * Body or query: { email }
 * Returns client row (id, title, status, currency, credit, pricingplandetail, expired) or null.
 */
router.get('/my-client', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const client = await getMyClient(email);
    res.json(client);
  } catch (err) {
    next(err);
  }
});
router.post('/my-client', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const client = await getMyClient(email);
    res.json(client);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/clear-client-cache
 * Body or query: { email }
 */
router.post('/clear-client-cache', async (req, res, next) => {
  try {
    clearClientCache();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * GET or POST /api/billing/plans
 * Body or query: { email }
 * Returns array of { id, _id, title, description, sellingprice, corecredit }.
 */
router.get('/plans', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const clientId = getClientId(req);
    const result = await getPlans(email, clientId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
router.post('/plans', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const clientId = getClientId(req);
    const result = await getPlans(email, clientId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET or POST /api/billing/addons
 * Body or query: { email }
 * Returns array of { id, _id, title, description, credit, qty }.
 */
router.get('/addons', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const clientId = getClientId(req);
    const result = await getAddons(email, clientId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
router.post('/addons', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const clientId = getClientId(req);
    const result = await getAddons(email, clientId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET or POST /api/billing/credit-plans
 * Body or query: { email }
 * Returns array of { id, _id, title, sellingprice, credit }.
 */
router.get('/credit-plans', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const clientId = getClientId(req);
    const result = await getCreditPlans(email, clientId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
router.post('/credit-plans', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const clientId = getClientId(req);
    const result = await getCreditPlans(email, clientId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET or POST /api/billing/statement-items
 * Body or query: { email, page?, pageSize?, sort?, filterType?, search? }
 * sort: 'new'|'old'|'amountAsc'|'amountDesc'; filterType: null|'Topup'|'Spending'|'creditOnly'|'planOnly'
 * Returns { items, total, page, pageSize } (merged credit + plan logs).
 */
router.get('/statement-items', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const opts = {
      page: req.query.page != null ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize != null ? Number(req.query.pageSize) : 10,
      sort: req.query.sort || 'new',
      filterType: req.query.filterType || null,
      search: req.query.search || ''
    };
    const result = await getStatementItems(email, opts);
    formatApiResponseDates(result);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
router.post('/statement-items', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const body = req.body || {};
    const opts = {
      page: body.page != null ? Number(body.page) : 1,
      pageSize: body.pageSize != null ? Number(body.pageSize) : 10,
      sort: body.sort || 'new',
      filterType: body.filterType || null,
      search: body.search || '',
      clientId: body.clientId || null
    };
    const result = await getStatementItems(email, opts);
    formatApiResponseDates(result);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

const STATEMENT_EXPORT_PAGE_SIZE = 5000;

/**
 * POST /api/billing/statement-export
 * Body: { email?, sort?, filterType?, search? } — same as statement-items. Returns { downloadUrl }.
 * Node generates Excel and returns one-time download URL.
 */
router.post('/statement-export', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const body = req.body || {};
    const opts = {
      page: 1,
      pageSize: STATEMENT_EXPORT_PAGE_SIZE,
      sort: body.sort || 'new',
      filterType: body.filterType || null,
      search: body.search || ''
    };
    const [result, billing] = await Promise.all([
      getStatementItems(email, opts),
      getMyBillingInfo(email)
    ]);
    if (billing.noPermission || billing.reason) {
      return res.status(403).json({ ok: false, reason: billing.reason || 'NO_PERMISSION' });
    }
    const currency = (billing.currency || '').toString().trim().toUpperCase();
    const items = result.items || [];
    const exportRows = items.map((item) => {
      const date = item._createdDate
        ? new Date(item._createdDate).toLocaleDateString('en-GB')
        : '';
      if (item.type === 'credit') {
        const amount = Number(item.amount) || 0;
        return {
          Date: date,
          Title: item.title,
          Type: amount >= 0 ? '+credit' : '-credit',
          Credit: amount,
          [`Amount (${currency})`]: ''
        };
      }
      return {
        Date: date,
        Title: item.title,
        Type: '+credit',
        Credit: Number(item.corecredit) || 0,
        [`Amount (${currency})`]: Number(item.sellingprice) || 0
      };
    });
    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Billing');
    const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
    const buffer = Buffer.from(wbout);
    const filename = `Billing_${new Date().toISOString().slice(0, 10)}.xlsx`;
    const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const token = downloadStore.set(buffer, filename, mime);
    const baseUrl = process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get('host')}`;
    res.json({ downloadUrl: `${baseUrl}/api/download/${token}` });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/topup/start
 * Body: { email, creditPlanId?, returnUrl, credits?, amount? } — either creditPlanId OR credits (optional amount check); returnUrl = 支付完成/取消后回到的同一页
 * Returns { success, provider: 'stripe', url, referenceNumber } (platform Malaysia Stripe test).
 */
router.post('/topup/start', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const { creditPlanId, returnUrl, credits, amount } = req.body || {};
    const result = await startNormalTopup(email, { creditPlanId, returnUrl, credits, amount });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/topup/xendit-sync
 * After Xendit redirect: poll invoice PAID and apply credit if webhook was late/missing.
 * Body: { email?, creditLogId } — creditLogId = same as creditlogs.id (UUID in TP-{uuid} reference).
 */
router.post('/topup/xendit-sync', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const creditLogId = req.body?.creditLogId ?? req.body?.creditlogId;
    const result = await syncSaasTopupFromXenditAfterReturn(email, creditLogId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/plan/xendit-sync
 * After Xendit redirect: poll invoice PAID and apply plan + core creditlog + Bukku if webhook was late/missing.
 * Body: { email?, pricingplanlogId } — same id as pricingplanlogs.id (UUID; external_id saas-pp-{id}).
 */
router.post('/plan/xendit-sync', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const pricingplanlogId = req.body?.pricingplanlogId ?? req.body?.pricingPlanLogId;
    const result = await syncSaasPricingPlanFromXenditAfterReturn(email, pricingplanlogId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/topup/billplz-sync
 * After Billplz redirect: poll bill PAID and apply credit if webhook was late/missing.
 */
router.post('/topup/billplz-sync', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const creditLogId = req.body?.creditLogId ?? req.body?.creditlogId;
    const result = await syncSaasTopupFromBillplzAfterReturn(email, creditLogId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/plan/billplz-sync
 * After Billplz redirect: poll bill PAID and apply plan if webhook was late/missing.
 */
router.post('/plan/billplz-sync', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const pricingplanlogId = req.body?.pricingplanlogId ?? req.body?.pricingPlanLogId;
    const result = await syncSaasPricingPlanFromBillplzAfterReturn(email, pricingplanlogId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/plan/stripe-sync
 * After Stripe redirect (?plan_finalize=…&session_id=cs_…): apply plan if webhook was late.
 * Body: { pricingplanlogId, sessionId }
 */
router.post('/plan/stripe-sync', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const pricingplanlogId = req.body?.pricingplanlogId ?? req.body?.pricingPlanLogId;
    const sessionId = req.body?.sessionId ?? req.body?.session_id;
    const result = await syncSaasPricingPlanFromStripeAfterReturn(email, pricingplanlogId, sessionId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/topup/stripe-sync
 * Body: { creditLogId, sessionId }
 */
router.post('/topup/stripe-sync', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const creditLogId = req.body?.creditLogId ?? req.body?.creditlogId;
    const sessionId = req.body?.sessionId ?? req.body?.session_id;
    const result = await syncSaasTopupFromStripeAfterReturn(email, creditLogId, sessionId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/topup/request-manual
 * Manual bank transfer: create pending creditlog (is_paid=0). Admin processes later.
 * Body: { email, clientId?, creditPlanId?, credits?, amount? } — creditPlanId or (credits+amount) for custom.
 */
router.post('/topup/request-manual', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const clientId = getClientId(req);
    const { creditPlanId, credits, amount } = req.body || {};
    const result = await submitManualTopupRequest(email, { clientId, creditPlanId, credits, amount });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/deduction/addon
 * Body: { email?, amount, title, addons, system? }
 * If system=true, addons must include __clientId.
 */
router.post('/deduction/addon', async (req, res, next) => {
  try {
    const body = req.body || {};
    const email = body.email ?? getEmail(req);
    const result = await deductAddonCredit(email, {
      amount: body.amount,
      title: body.title,
      addons: body.addons,
      system: body.system === true
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/deduction/pricing-plan-addon
 * Body: { clientId, amount, title, addons?, staffId? }
 */
router.post('/deduction/pricing-plan-addon', async (req, res, next) => {
  try {
    const { clientId, amount, title, addons, staffId } = req.body || {};
    const result = await deductPricingPlanAddonCredit({ clientId, amount, title, addons, staffId });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/checkout/preview
 * Body: { email, planId }
 */
router.post('/checkout/preview', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const clientId = getClientId(req);
    const { planId } = req.body || {};
    const result = await previewPricingPlan(email, { planId, clientId });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/checkout/confirm
 * Body: { email, clientId?, planId, returnUrl } — returnUrl = 支付完成/取消后回到的同一页（Stripe success/cancel 用）
 * Returns { provider: 'payex', url, referenceNumber, pricingplanlogId } (platform Xendit).
 */
router.post('/checkout/confirm', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const clientId = getClientId(req);
    const { planId, returnUrl } = req.body || {};
    const result = await confirmPricingPlan(email, { planId, returnUrl, clientId });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/indoor-admin/clients
 * Manual billing 下拉：列出所有 client（id, title, email, status, expired, hasPlan）。需 admin 或 billing 權限。
 */
router.post('/indoor-admin/clients', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const { getAccessContextByEmail } = require('../access/access.service');
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) return res.status(401).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    // Permission check disabled for now – will re-enable later.
    const items = await getManualBillingClients(email);
    res.json({ ok: true, items });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/indoor-admin/pending-tickets
 * Manual billing dashboard：待處理工單（mode=billing_manual / topup_manual），供 #repeaterpending 顯示。需 admin 或 billing 權限。
 */
router.post('/indoor-admin/pending-tickets', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const { getAccessContextByEmail } = require('../access/access.service');
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) return res.status(401).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    // Permission check disabled for now – will re-enable later.
    const items = await getPendingManualBillingTickets(email);
    res.json({ ok: true, items });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/indoor-admin/pending-tickets/acknowledge
 * Body: { email, ticketId } — ticket row id (UUID), same as table _id / id from pending-tickets.
 */
router.post('/indoor-admin/pending-tickets/acknowledge', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const ticketId = req.body?.ticketId ?? req.body?.id ?? req.body?._id;
    const { getAccessContextByEmail } = require('../access/access.service');
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) return res.status(401).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    const result = await acknowledgeManualBillingTicket(email, ticketId);
    res.json(result);
  } catch (err) {
    if (err?.message === 'MIGRATION_REQUIRED') {
      return res.status(503).json({ ok: false, reason: 'MIGRATION_REQUIRED' });
    }
    next(err);
  }
});

/**
 * POST /api/billing/indoor-admin/manual-topup
 * SaaS indoor admin：手動充值。Body: { email, clientId, amount, paidDate }。先寫 DB，再開平台 Bukku cash invoice。
 * 需 admin 或 billing 權限。
 */
router.post('/indoor-admin/manual-topup', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const { getAccessContextByEmail } = require('../access/access.service');
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) return res.status(401).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    // Permission check disabled for now – will re-enable later.
    const body = req.body || {};
    const clientId = body.clientId ?? body.client ?? null;
    const { amount, paidDate, topupMode, ticketRowId, ticketId } = body;
    const ticketRow =
      ticketRowId != null && String(ticketRowId).trim()
        ? String(ticketRowId).trim()
        : ticketId != null && String(ticketId).trim()
          ? String(ticketId).trim()
          : null;
    const result = await manualTopup({
      clientId: clientId != null ? String(clientId).trim() || null : null,
      amount: amount != null ? Number(amount) : undefined,
      paidDate: paidDate ? String(paidDate).slice(0, 10) : undefined,
      // creditlogs.staff_id / pricingplanlogs.staff_id FK -> staffdetail.id
      // when identity resolved from client_user, access service returns staffDetailId = null
      staffId: ctx.staffDetailId ?? null,
      topupMode: topupMode === 'free_credit' ? 'free_credit' : 'manual_credit',
      ticketRowId: ticketRow
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/indoor-admin/credit-used-stats
 * SaaS admin dashboard: this month total credit used + by month (last 12). Credit used = spending (amount < 0 in creditlogs).
 */
router.post('/indoor-admin/credit-used-stats', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const { getAccessContextByEmail } = require('../access/access.service');
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) return res.status(401).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    const result = await getSaasCreditUsedStats(email);
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/indoor-admin/processing-fees
 * SaaS admin: list tenant-payment SaaS credit deductions (creditlogs: PayexFee, BillplzFee, RentRelease).
 * Not PSP gateway fees — those are taken by Stripe/Xendit/Billplz before operator payout.
 */
router.post('/indoor-admin/processing-fees', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const { getAccessContextByEmail } = require('../access/access.service');
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) return res.status(401).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    const body = req.body || {};
    const result = await getSaasProcessingFeeTransactions(email, {
      dateFrom: body.dateFrom,
      dateTo: body.dateTo,
      search: body.search || '',
      sort: body.sort || 'date_desc',
      currency: body.currency || 'all',
      page: body.page,
      pageSize: body.pageSize
    });
    const out = { ok: true, ...result };
    formatApiResponseDates(out);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/indoor-admin/meters
 * SaaS admin: list all meters (cross-operator), for meter transfer.
 */
router.post('/indoor-admin/meters', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const { getAccessContextByEmail } = require('../access/access.service');
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) return res.status(401).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    if (!ctx.isSaasAdmin) return res.status(403).json({ ok: false, reason: 'SAAS_ADMIN_ONLY' });
    const body = req.body || {};
    const result = await getSaasAdminMeters(email, {
      search: body.search || '',
      operatorId: body.operatorId || '',
      page: body.page,
      pageSize: body.pageSize
    });
    return res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/indoor-admin/meters/move
 * SaaS admin: move one meter from source operator to target operator.
 */
router.post('/indoor-admin/meters/move', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const { getAccessContextByEmail } = require('../access/access.service');
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) return res.status(401).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    if (!ctx.isSaasAdmin) return res.status(403).json({ ok: false, reason: 'SAAS_ADMIN_ONLY' });
    const body = req.body || {};
    const result = await moveMeterToOperator({
      meterId: body.meterId,
      toOperatorId: body.toOperatorId
    });
    return res.json(result);
  } catch (err) {
    if (String(err?.message || '') === 'SAME_OPERATOR') {
      return res.status(400).json({ ok: false, reason: 'SAME_OPERATOR' });
    }
    if (String(err?.message || '') === 'TARGET_OPERATOR_NOT_FOUND') {
      return res.status(404).json({ ok: false, reason: 'TARGET_OPERATOR_NOT_FOUND' });
    }
    if (String(err?.message || '') === 'METER_NOT_FOUND') {
      return res.status(404).json({ ok: false, reason: 'METER_NOT_FOUND' });
    }
    if (String(err?.message || '') === 'METER_ID_AND_OPERATOR_ID_REQUIRED') {
      return res.status(400).json({ ok: false, reason: 'METER_ID_AND_OPERATOR_ID_REQUIRED' });
    }
    next(err);
  }
});

/**
 * POST /api/billing/indoor-admin/properties
 * SaaS admin: list all properties (cross-operator), for property + rooms transfer.
 */
router.post('/indoor-admin/properties', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const { getAccessContextByEmail } = require('../access/access.service');
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) return res.status(401).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    if (!ctx.isSaasAdmin) return res.status(403).json({ ok: false, reason: 'SAAS_ADMIN_ONLY' });
    const body = req.body || {};
    const result = await getSaasAdminProperties(email, {
      search: body.search || '',
      operatorId: body.operatorId || '',
      page: body.page,
      pageSize: body.pageSize
    });
    return res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/indoor-admin/properties/move
 * SaaS admin: move property + rooms (+ meters / tenancy / rentalcollection under it) to target operator.
 */
router.post('/indoor-admin/properties/move', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const { getAccessContextByEmail } = require('../access/access.service');
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) return res.status(401).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    if (!ctx.isSaasAdmin) return res.status(403).json({ ok: false, reason: 'SAAS_ADMIN_ONLY' });
    const body = req.body || {};
    const result = await movePropertyToOperator({
      propertyId: body.propertyId,
      toOperatorId: body.toOperatorId
    });
    return res.json(result);
  } catch (err) {
    if (String(err?.message || '') === 'SAME_OPERATOR') {
      return res.status(400).json({ ok: false, reason: 'SAME_OPERATOR' });
    }
    if (String(err?.message || '') === 'TARGET_OPERATOR_NOT_FOUND') {
      return res.status(404).json({ ok: false, reason: 'TARGET_OPERATOR_NOT_FOUND' });
    }
    if (String(err?.message || '') === 'PROPERTY_NOT_FOUND') {
      return res.status(404).json({ ok: false, reason: 'PROPERTY_NOT_FOUND' });
    }
    if (String(err?.message || '') === 'PROPERTY_ID_AND_OPERATOR_ID_REQUIRED') {
      return res.status(400).json({ ok: false, reason: 'PROPERTY_ID_AND_OPERATOR_ID_REQUIRED' });
    }
    next(err);
  }
});

/**
 * POST /api/billing/operator/transactions
 * Operator portal: payment timeline — Xendit/Payex and Billplz from operator payment tables; Stripe from creditlogs (RentRelease). No processing_fees ledger.
 * Body: { email, provider?, status?, search?, sort?, page?, pageSize? }
 */
router.post('/operator/transactions', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const body = req.body || {};
    const items = await getOperatorTransactions(email, {
      provider: body.provider || 'xendit',
      status: body.status || 'all',
      search: body.search || '',
      sort: body.sort || 'date_desc',
      page: body.page != null ? Number(body.page) : 1,
      pageSize: body.pageSize != null ? Number(body.pageSize) : 20
    });
    const out = { ok: true, ...items };
    formatApiResponseDates(out);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/indoor-admin/ensure-bukku-contact
 * 用 client 資料（email/legal name）在平台 Bukku 先查 contact，有則回傳 id 並寫回 operatordetail.bukku_saas_contact_id；無則新建並寫回。供 SaaS Admin 在建立 plan 或 topup 前先確保 contact 存在。
 * Body: { email, clientId }。返回 { ok, bukku_saas_contact_id }。
 */
router.post('/indoor-admin/ensure-bukku-contact', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const { getAccessContextByEmail } = require('../access/access.service');
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) return res.status(401).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    const clientId = req.body?.clientId ?? req.body?.client ?? null;
    const result = await ensureBukkuContactForClient({ clientId: clientId != null ? String(clientId).trim() || null : null });
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/indoor-admin/manual-renew
 * SaaS indoor admin：手動續費。Body: { email, clientId, planId, paidDate, remark? }。remark: new_customer|renew|upgrade。先寫 DB，再開平台 Bukku cash invoice。
 * 需 admin 或 billing 權限。
 */
router.post('/indoor-admin/manual-renew', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const { getAccessContextByEmail } = require('../access/access.service');
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) return res.status(401).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    // Permission check disabled for now – will re-enable later.
    const body = req.body || {};
    // Frontend may send clientId or client (dropdown value)
    const clientId = body.clientId ?? body.client ?? null;
    const { planId, paidDate, remark } = body;
    const result = await manualRenew({
      clientId: clientId != null ? String(clientId).trim() || null : null,
      planId,
      paidDate: paidDate ? String(paidDate).slice(0, 10) : undefined,
      // creditlogs.staff_id / pricingplanlogs.staff_id FK -> staffdetail.id
      // when identity resolved from client_user, access service returns staffDetailId = null
      staffId: ctx.staffDetailId ?? null,
      remark: remark ? String(remark).trim() : null
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/indoor-admin/save-cnyiot-sales-user
 * Manual billing：把售电员户口 id 存入 client_integration。Body: { email, clientId, cnyiotUserId }。密码固定 0123456789。
 * 需 admin 或 billing 權限。
 */
router.post('/indoor-admin/save-cnyiot-sales-user', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const { getAccessContextByEmail } = require('../access/access.service');
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) return res.status(401).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    // Permission check disabled for now – will re-enable later.
    const { clientId, cnyiotUserId } = req.body || {};
    const result = await saveCnyiotSalesUser(clientId, cnyiotUserId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/indoor-admin/enquiries
 * SaaS Admin Enquiry tab: list SAAS enquiries (operatordetail status=0 + client_profile). Same auth as other indoor-admin.
 */
router.post('/indoor-admin/enquiries', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const { getAccessContextByEmail } = require('../access/access.service');
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) return res.status(401).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    const items = await getSaasEnquiries();
    res.json({ ok: true, items });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/indoor-admin/owner-enquiries
 * SaaS Admin Enquiry tab: list Management enquiries (owner_enquiry). Same auth as other indoor-admin.
 */
router.post('/indoor-admin/owner-enquiries', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const { getAccessContextByEmail } = require('../access/access.service');
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) return res.status(401).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    const items = await getOwnerEnquiries();
    res.json({ ok: true, items });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/indoor-admin/enquiries/acknowledge
 * SaaS Admin Enquiry tab: mark SAAS enquiry as acknowledged. Body: { clientId }.
 */
router.post('/indoor-admin/enquiries/acknowledge', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const { getAccessContextByEmail } = require('../access/access.service');
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) return res.status(401).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    const { clientId } = req.body || {};
    const result = await acknowledgeSaasEnquiry(clientId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/indoor-admin/owner-enquiries/acknowledge
 * SaaS Admin Enquiry tab: mark Management enquiry as acknowledged. Body: { id }.
 */
router.post('/indoor-admin/owner-enquiries/acknowledge', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const { getAccessContextByEmail } = require('../access/access.service');
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) return res.status(401).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    const { id } = req.body || {};
    const result = await acknowledgeOwnerEnquiry(id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/indoor-admin/owner-enquiries/delete
 * SaaS Admin Enquiry tab: delete one Management enquiry row. Body: { id }.
 */
router.post('/indoor-admin/owner-enquiries/delete', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const { getAccessContextByEmail } = require('../access/access.service');
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) return res.status(401).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    const { id } = req.body || {};
    const result = await deleteOwnerEnquiry(id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/indoor-admin/saas-bukku-status
 * 檢查 env 是否已配置 SaaS platform Bukku（BUKKU_SAAS_API_KEY、BUKKU_SAAS_SUBDOMAIN）。
 * 開單流程：ensureClientBukkuContact(clientId) 用 operatordetail+email+name 先 search，有則寫 id 回 operatordetail.bukku_saas_contact_id，沒有則 create 再寫回，然後開 cash invoice。
 * 若剛改 .env，需重啟 Node 進程後新值才會生效。
 */
router.post('/indoor-admin/saas-bukku-status', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const { getAccessContextByEmail } = require('../access/access.service');
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) return res.status(401).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    const { checkSaasBukkuConfigured } = require('./saas-bukku.service');
    const status = checkSaasBukkuConfigured();
    res.json({
      ok: true,
      ...status,
      message: status.configured
        ? 'SaaS Bukku configured. Operator-as-customer: search by operatordetail email+name → write id to operatordetail.bukku_saas_contact_id or create → then open cash invoice.'
        : 'Set BUKKU_SAAS_API_KEY and BUKKU_SAAS_SUBDOMAIN in .env, then restart the Node process (e.g. pm2 restart app or restart dev server).'
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/billing/indoor-admin/api-docs-users – 列表 api_user（仅 SaaS Admin）。供 SaaS Admin 页「API Docs 访问」管理。
 */
router.post('/indoor-admin/api-docs-users', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const { getAccessContextByEmail } = require('../access/access.service');
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) return res.status(401).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    if (!ctx.isSaasAdmin) return res.status(403).json({ ok: false, reason: 'SAAS_ADMIN_ONLY' });
    const list = await apiUserService.list();
    return res.json({ ok: true, items: list });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/indoor-admin/api-docs-users/create – 按 client 开通 API Docs：自动生成 username/password，仅 SaaS Admin。Body: { email, clientId }。返回 user + plainPassword（仅此一次，供 admin 抄送 operator）。
 */
router.post('/indoor-admin/api-docs-users/create', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const { getAccessContextByEmail } = require('../access/access.service');
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) return res.status(401).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    if (!ctx.isSaasAdmin) return res.status(403).json({ ok: false, reason: 'SAAS_ADMIN_ONLY' });
    const clientId = req.body?.clientId;
    if (!clientId || typeof clientId !== 'string' || !clientId.trim()) {
      return res.status(400).json({ ok: false, reason: 'CLIENT_ID_REQUIRED' });
    }
    const result = await apiUserService.createForClient(clientId.trim());
    if (!result.ok) return res.status(409).json({ ok: false, reason: result.reason || 'CLIENT_ALREADY_HAS_API_DOCS_USER' });
    return res.status(201).json({ ok: true, user: result.user, plainPassword: result.plainPassword });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/indoor-admin/api-docs-users/:id/can-access-docs – 更新 can_access_docs。Body: { email, can_access_docs: true|false }。
 */
router.post('/indoor-admin/api-docs-users/:id/can-access-docs', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const { getAccessContextByEmail } = require('../access/access.service');
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) return res.status(401).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    if (!ctx.isSaasAdmin) return res.status(403).json({ ok: false, reason: 'SAAS_ADMIN_ONLY' });
    const id = req.params.id;
    const canAccessDocs = req.body?.can_access_docs;
    if (canAccessDocs !== true && canAccessDocs !== false) {
      return res.status(400).json({ ok: false, reason: 'CAN_ACCESS_DOCS_REQUIRED' });
    }
    const updated = await apiUserService.updateCanAccessDocs(id, !!canAccessDocs);
    if (!updated) return res.status(404).json({ ok: false, reason: 'USER_NOT_FOUND' });
    return res.json({ ok: true, user: updated });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
