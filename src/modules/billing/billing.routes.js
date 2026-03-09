/**
 * Billing API – migrated from Wix backend/billing (billing.jsw, topup.jsw, deduction.jsw, checkout.jsw).
 * All endpoints require email (POST body or GET query) to resolve access context, except deduction in system mode.
 */

const express = require('express');
const router = express.Router();
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
  getPendingManualBillingTickets
} = require('./billing.service');
const { startNormalTopup } = require('./topup.service');
const { deductAddonCredit, deductPricingPlanAddonCredit } = require('./deduction.service');
const { previewPricingPlan, confirmPricingPlan } = require('./checkout.service');
const { manualTopup, manualRenew, saveCnyiotSalesUser } = require('./indoor-admin.service');

function getEmail(req) {
  return req.body?.email ?? req.query?.email ?? null;
}

/**
 * GET or POST /api/billing/my-info
 * Body or query: { email }
 * Returns: { noPermission?: true, currency?, title?, plan?, credit?, expired?, pricingplandetail? }
 */
router.get('/my-info', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const result = await getMyBillingInfo(email);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/my-info', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const result = await getMyBillingInfo(email);
    res.json(result);
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
    const opts = {
      page: req.query.page != null ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize != null ? Number(req.query.pageSize) : 10,
      sort: req.query.sort || 'new',
      filterType: req.query.filterType || null,
      search: req.query.search || ''
    };
    const result = await getCreditStatements(email, opts);
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
      search: body.search || ''
    };
    const result = await getCreditStatements(email, opts);
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
    const result = await getPlans(email);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
router.post('/plans', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const result = await getPlans(email);
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
    const result = await getAddons(email);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
router.post('/addons', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const result = await getAddons(email);
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
    const result = await getCreditPlans(email);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
router.post('/credit-plans', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const result = await getCreditPlans(email);
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
      search: body.search || ''
    };
    const result = await getStatementItems(email, opts);
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
    const currency = (billing.currency || 'MYR').toUpperCase();
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
 * Body: { email, creditPlanId, returnUrl } — returnUrl = 支付完成/取消后回到的同一页（Stripe success/cancel 用），不存 DB
 * Returns { success, provider: 'stripe', url, referenceNumber }.
 */
router.post('/topup/start', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const { creditPlanId, returnUrl } = req.body || {};
    const result = await startNormalTopup(email, { creditPlanId, returnUrl });
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
    const { planId } = req.body || {};
    const result = await previewPricingPlan(email, { planId });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/checkout/confirm
 * Body: { email, planId, returnUrl } — returnUrl = 支付完成/取消后回到的同一页（Stripe success/cancel 用）
 * Returns { provider: 'stripe', url, referenceNumber }.
 */
router.post('/checkout/confirm', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const { planId, returnUrl } = req.body || {};
    const result = await confirmPricingPlan(email, { planId, returnUrl });
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
    if (!ctx.staff?.permission?.billing && !ctx.staff?.permission?.admin) {
      return res.status(403).json({ ok: false, reason: 'NO_PERMISSION' });
    }
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
    if (!ctx.staff?.permission?.billing && !ctx.staff?.permission?.admin) {
      return res.status(403).json({ ok: false, reason: 'NO_PERMISSION' });
    }
    const items = await getPendingManualBillingTickets(email);
    res.json({ ok: true, items });
  } catch (err) {
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
    if (!ctx.staff?.permission?.billing && !ctx.staff?.permission?.admin) {
      return res.status(403).json({ ok: false, reason: 'NO_PERMISSION' });
    }
    const { clientId, amount, paidDate } = req.body || {};
    const result = await manualTopup({
      clientId,
      amount: amount != null ? Number(amount) : undefined,
      paidDate: paidDate ? String(paidDate).slice(0, 10) : undefined,
      staffId: ctx.staff?.id
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/indoor-admin/manual-renew
 * SaaS indoor admin：手動續費。Body: { email, clientId, planId, paidDate }。先寫 DB，再開平台 Bukku cash invoice。
 * 需 admin 或 billing 權限。
 */
router.post('/indoor-admin/manual-renew', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const { getAccessContextByEmail } = require('../access/access.service');
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) return res.status(401).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    if (!ctx.staff?.permission?.billing && !ctx.staff?.permission?.admin) {
      return res.status(403).json({ ok: false, reason: 'NO_PERMISSION' });
    }
    const { clientId, planId, paidDate } = req.body || {};
    const result = await manualRenew({
      clientId,
      planId,
      paidDate: paidDate ? String(paidDate).slice(0, 10) : undefined,
      staffId: ctx.staff?.id
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
    if (!ctx.staff?.permission?.billing && !ctx.staff?.permission?.admin) {
      return res.status(403).json({ ok: false, reason: 'NO_PERMISSION' });
    }
    const { clientId, cnyiotUserId } = req.body || {};
    const result = await saveCnyiotSalesUser(clientId, cnyiotUserId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
