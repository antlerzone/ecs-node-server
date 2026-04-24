// Explicit path + override: machine/User env (e.g. DB_NAME on Windows) must not shadow repo `.env`,
// or the API pool connects to the wrong DB while migrations use `.env` → MIGRATION_REQUIRED on Dobi, etc.
require('dotenv').config({ path: require('path').join(__dirname, '.env'), override: true });

// Log once at startup whether SaaS Bukku (manual renew/topup invoice) can run
const _bukkuKey = process.env.BUKKU_SAAS_API_KEY || process.env.BUKKU_SAAS_BUKKU_API_KEY;
const _bukkuSub = process.env.BUKKU_SAAS_SUBDOMAIN || process.env.BUKKU_SAAS_BUKKUSUBDOMAIN;
const _bukkuOk = !!(_bukkuKey && String(_bukkuKey).trim() && _bukkuSub && String(_bukkuSub).trim());
console.log('[server] BUKKU_SAAS for invoice:', _bukkuOk ? 'configured=yes' : 'configured=no (set BUKKU_SAAS_API_KEY & BUKKU_SAAS_SUBDOMAIN in .env and restart)');

const { getExpectedSaaSPlatformCallbackToken } = require('./src/utils/xenditSaasPlatformCallbackToken');
const _xenditKey =
  process.env.XENDIT_PLATFORM_SECRET_KEY ||
  process.env.XENDIT_PLATFORM_TEST_SECRET_KEY ||
  '';
if (String(_xenditKey).trim() && !getExpectedSaaSPlatformCallbackToken()) {
  console.warn(
    '[server] SaaS Xendit webhook token not set for current mode — POST /api/payex/callback will reject SaaS callbacks. Set XENDIT_SAAS_PLATFORM_TEST_CALLBACK_TOKEN (sandbox) and/or XENDIT_SAAS_PLATFORM_LIVE_CALLBACK_TOKEN (live), or legacy XENDIT_SAAS_PLATFORM_CALLBACK_TOKEN. Must match Xendit Dashboard Verification Token for that environment. See docs/env-saas-payment.md'
  );
}

const express = require('express');
const cors = require('cors');

const clientresolver = require('./src/middleware/clientresolver');
const invoiceroutes = require('./src/modules/bukku/routes/invoice.routes');
const quoteroutes = require('./src/modules/bukku/routes/quote.routes');
const orderroutes = require('./src/modules/bukku/routes/order.routes');
const deliveryorderroutes = require('./src/modules/bukku/routes/deliveryOrder.routes');
const creditnoteroutes = require('./src/modules/bukku/routes/creditNote.routes');
const invoicepaymentroutes = require('./src/modules/bukku/routes/invoicepayment.routes');
const refundroutes = require('./src/modules/bukku/routes/refund.routes');
const purchaseorderroutes = require('./src/modules/bukku/routes/purchaseOrder.routes');
const goodsreceivednoteroutes = require('./src/modules/bukku/routes/goodsReceivedNote.routes');
const purchasebillroutes = require('./src/modules/bukku/routes/purchaseBill.routes');
const purchasecreditnoteroutes = require('./src/modules/bukku/routes/purchaseCreditNote.routes');
const purchasepaymentroutes = require('./src/modules/bukku/routes/purchasePayment.routes');
const purchaserefundroutes = require('./src/modules/bukku/routes/purchaseRefund.routes');
const bankingincomeroutes = require('./src/modules/bukku/routes/bankingIncome.routes');
const bankingexpenseroutes = require('./src/modules/bukku/routes/bankingExpense.routes');
const bankingtransferroutes = require('./src/modules/bukku/routes/bankingTransfer.routes');
const contactroutes = require('./src/modules/bukku/routes/contact.routes');
const productroutes = require('./src/modules/bukku/routes/product.routes');
const journalentryroutes = require('./src/modules/bukku/routes/journalEntry.routes');
const accountroutes = require('./src/modules/bukku/routes/account.routes');
const listroutes = require('./src/modules/bukku/routes/list.routes');
const xeroAccountRoutes = require('./src/modules/xero/routes/account.routes');
const xeroInvoiceRoutes = require('./src/modules/xero/routes/invoice.routes');
const autocountInvoiceRoutes = require('./src/modules/autocount/routes/invoice.routes');
const fileroutes = require('./src/modules/bukku/routes/file.routes');
const locationroutes = require('./src/modules/bukku/routes/location.routes');
const tagroutes = require('./src/modules/bukku/routes/tag.routes');
const ttlockLockRoutes = require('./src/modules/ttlock/routes/lock.routes');
const ttlockGatewayRoutes = require('./src/modules/ttlock/routes/gateway.routes');
const ttlockUserRoutes = require('./src/modules/ttlock/routes/user.routes');
const cnyiotMeterRoutes = require('./src/modules/cnyiot/routes/meter.routes');
const cnyiotPriceRoutes = require('./src/modules/cnyiot/routes/price.routes');
const cnyiotUserRoutes = require('./src/modules/cnyiot/routes/user.routes');
const clientroutes = require('./src/modules/client/routes/client.routes');
const apiAuth = require('./src/middleware/apiAuth');
const uploadAuthOrLocalhost = require('./src/middleware/uploadAuthOrLocalhost');
const apiClientScope = require('./src/middleware/apiClientScope');
const accessroutes = require('./src/modules/access/access.routes');
const apiUserRoutes = require('./src/modules/api-user/api-user.routes');
const errorhandler = require('./src/middleware/errorhandler');
const stripeRoutes = require('./src/modules/stripe/stripe.routes');
const { webhookHandler: stripeWebhookHandler } = require('./src/modules/stripe/stripe.routes');
const { webhookHandler: xeroWebhookHandler } = require('./src/modules/xero/webhook');
const billingRoutes = require('./src/modules/billing/billing.routes');
const agreementRoutes = require('./src/modules/agreement/agreement.routes');
const contactRoutes = require('./src/modules/contact/contact.routes');
const accountSaaSRoutes = require('./src/modules/account/account.routes');
const admindashboardRoutes = require('./src/modules/admindashboard/admindashboard.routes');
const tenancyCronRoutes = require('./src/modules/tenancysetting/tenancy-cron.routes');
const tenancysettingRoutes = require('./src/modules/tenancysetting/tenancysetting.routes');
const metersettingRoutes = require('./src/modules/metersetting/metersetting.routes');
const tenantdashboardRoutes = require('./src/modules/tenantdashboard/tenantdashboard.routes');
const tenantinvoiceRoutes = require('./src/modules/tenantinvoice/tenantinvoice.routes');
const smartdoorsettingRoutes = require('./src/modules/smartdoorsetting/smartdoorsetting.routes');
const agreementsettingRoutes = require('./src/modules/agreementsetting/agreementsetting.routes');
const companysettingRoutes = require('./src/modules/companysetting/companysetting.routes');
const propertysettingRoutes = require('./src/modules/propertysetting/propertysetting.routes');
const ownersettingRoutes = require('./src/modules/ownersetting/ownersetting.routes');
const roomsettingRoutes = require('./src/modules/roomsetting/roomsetting.routes');
const portalAuthRoutes = require('./src/modules/portal-auth/portal-auth.routes');
const docsAuthRoutes = require('./src/modules/docs-auth/docs-auth.routes');
const payexRoutes = require('./src/modules/payex/payex.routes');
const billplzRoutes = require('./src/modules/billplz/billplz.routes');
const availableunitRoutes = require('./src/modules/availableunit/availableunit.routes');
const termsRoutes = require('./src/modules/terms/terms.routes');
const generatereportRoutes = require('./src/modules/generatereport/generatereport.routes');
const bookingRoutes = require('./src/modules/booking/booking.routes');
const bankBulkTransferRoutes = require('./src/modules/bankbulktransfer/bankbulktransfer.routes');
const expensesRoutes = require('./src/modules/expenses/expenses.routes');
const ownerportalRoutes = require('./src/modules/ownerportal/ownerportal.routes');
const enquiryRoutes = require('./src/modules/enquiry/enquiry.routes');
const ownerEnquiryRoutes = require('./src/modules/owner-enquiry/owner-enquiry.routes');
const sandboxRoutes = require('./src/modules/sandbox/sandbox.routes');
const helpRoutes = require('./src/modules/help/help.routes');
const paymentVerificationRoutes = require('./src/modules/payment-verification/payment-verification.routes');
const finverseCallbackRoutes = require('./src/modules/finverse/finverse-callback.routes');
const uploadRoutes = require('./src/modules/upload/upload.routes');
const downloadRoutes = require('./src/modules/download/download.routes');
const publicRoutes = require('./src/modules/public/public.routes');
const cleanlemonRoutes = require('./src/modules/cleanlemon/cleanlemon.routes');
const cleanlemonAntlerzoneSyncRoutes = require('./src/modules/cleanlemon/cleanlemon-antlerzone-sync.routes');
const clnOperatorAiSvc = require('./src/modules/cleanlemon/cln-operator-ai.service');
const { getOperatorMasterTableName } = require('./src/config/operatorMasterTable');

// Google / Facebook OAuth for portal login (strategies register on require)
require('./src/modules/portal-auth/passport-strategies');
const passport = require('passport');

const app = express();
const cleanlemonApiGateEnabled =
  String(process.env.CLEANLEMON_API_GATE_ENABLED || '').toLowerCase() === '1' ||
  String(process.env.CLEANLEMON_API_GATE_ENABLED || '').toLowerCase() === 'true';

app.use(cors({
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'x-request-id',
    'X-Request-Id',
    'x-sync-secret',
    'X-Sync-Secret',
    'X-Cleanlemons-Portal',
    'x-cleanlemons-portal',
  ],
}));
// Finverse Link (link.prod.finverse.net) XHR to our callback must pass preflight; ensure OPTIONS and GET get CORS.
app.use('/api/finverse', (req, res, next) => {
  const origin = req.headers.origin;
  if (origin === 'https://link.prod.finverse.net') {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-request-id, X-Request-Id');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') return res.status(204).end();
  }
  next();
});
app.use(passport.initialize());
// Webhooks need raw body for signature verification; mount before express.json()
// Use type: () => true so we always get Buffer (Stripe may send application/json; charset=utf-8)
app.post('/api/stripe/webhook', express.raw({ type: () => true, limit: '1mb' }), stripeWebhookHandler);
// Xero may send application/json; charset=utf-8 — use same raw capture as Stripe
app.post('/api/xero/webhook', express.raw({ type: () => true, limit: '1mb' }), xeroWebhookHandler);
app.use(express.json());
app.use((req, res, next) => {
  const p = req.path || req.url?.split('?')[0] || '';
  if (p.includes('availableunit') || p.includes('available-unit')) {
    console.log('[server] request', { method: req.method, path: p, url: req.originalUrl });
  }
  next();
});
app.use(clientresolver);
const recordApiErrorMiddleware = require('./src/middleware/recordApiErrorMiddleware');
app.use(recordApiErrorMiddleware);

app.use('/api/bukku/invoices', invoiceroutes);
app.use('/api/bukku/quotes', quoteroutes);
app.use('/api/bukku/orders', orderroutes);
app.use('/api/bukku/delivery_orders', deliveryorderroutes);
app.use('/api/bukku/credit_notes', creditnoteroutes);
app.use('/api/bukku/payments', invoicepaymentroutes);
app.use('/api/bukku/refunds', refundroutes);
app.use('/api/bukku/purchases/orders', purchaseorderroutes);
app.use('/api/bukku/purchases/goods_received_notes', goodsreceivednoteroutes);
app.use('/api/bukku/purchases/bills', purchasebillroutes);
app.use('/api/bukku/purchases/credit_notes', purchasecreditnoteroutes);
app.use('/api/bukku/purchases/payments', purchasepaymentroutes);
app.use('/api/bukku/purchases/refunds', purchaserefundroutes);
app.use('/api/bukku/banking/incomes', bankingincomeroutes);
app.use('/api/bukku/banking/expenses', bankingexpenseroutes);
app.use('/api/bukku/banking/transfers', bankingtransferroutes);
app.use('/api/bukku/contacts', contactroutes);
app.use('/api/bukku/products', productroutes);
app.use('/api/bukku/journal_entries', journalentryroutes);
app.use('/api/bukku/accounts', accountroutes);
app.use('/api/bukku/lists', listroutes);
app.use('/api/xero/accounts', xeroAccountRoutes);
app.use('/api/xero/invoices', xeroInvoiceRoutes);
app.use('/api/autocount/invoices', autocountInvoiceRoutes);
app.use('/api/bukku/files', fileroutes);
app.use('/api/bukku/locations', locationroutes);
app.use('/api/bukku/tags', tagroutes);
app.use('/api/ttlock/locks', ttlockLockRoutes);
app.use('/api/ttlock/gateways', ttlockGatewayRoutes);
app.use('/api/ttlock/users', ttlockUserRoutes);
app.use('/api/cnyiot/meters', cnyiotMeterRoutes);
app.use('/api/cnyiot/prices', cnyiotPriceRoutes);
app.use('/api/cnyiot/users', cnyiotUserRoutes);
app.use('/api/client', clientroutes);
app.use('/api/stripe', stripeRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/agreement', agreementRoutes);
// Bank bulk transfer (Excel / CSV / ZIP)
app.use('/api/bank-bulk-transfer', bankBulkTransferRoutes);
// Fallback when Nginx sends portal proxy path to Node: same routes under /api/portal/proxy/...
// (If these requests hit Next first, Next forwards to /api/agreementsetting/* instead.)
app.use('/api/portal/proxy/billing', billingRoutes);
app.use('/api/portal/proxy/agreementsetting', apiAuth, apiClientScope, agreementsettingRoutes);
// OSS logo / company chop (multipart). app.js had these; server.js is production entry — must match Next proxy → /api/upload
// Loopback: skip apiAuth so Next→Node proxy works without mirroring ECS_API_TOKEN (see uploadAuthOrLocalhost.js)
app.use('/api/portal/proxy/upload', uploadAuthOrLocalhost, uploadRoutes);
app.use('/api/portal/proxy/download', downloadRoutes);
// apiClientScope: operator API can only access data for api_user.client_id (no cross-operator data)
app.use('/api/contact', apiAuth, apiClientScope, contactRoutes);
app.use('/api/account', apiAuth, apiClientScope, accountSaaSRoutes);
app.use('/api/admindashboard', apiAuth, apiClientScope, admindashboardRoutes);
app.use('/api/terms', apiAuth, apiClientScope, termsRoutes);
app.use('/api/access', apiAuth, accessroutes);
app.use('/api/admin/api-users', apiUserRoutes);
app.use('/api/cron', tenancyCronRoutes);
app.use('/api/tenancysetting', apiAuth, apiClientScope, tenancysettingRoutes);
app.use('/api/metersetting', apiAuth, apiClientScope, metersettingRoutes);
app.use('/api/tenantdashboard', apiAuth, tenantdashboardRoutes);
app.use('/api/tenantinvoice', apiAuth, apiClientScope, tenantinvoiceRoutes);
app.use('/api/smartdoorsetting', apiAuth, apiClientScope, smartdoorsettingRoutes);
app.use('/api/agreementsetting', apiAuth, apiClientScope, agreementsettingRoutes);
app.use('/api/companysetting', companysettingRoutes);
app.use('/api/upload', uploadAuthOrLocalhost, uploadRoutes);
app.use('/api/propertysetting', apiAuth, apiClientScope, propertysettingRoutes);
app.use('/api/ownersetting', apiAuth, apiClientScope, ownersettingRoutes);
app.use('/api/roomsetting', apiAuth, apiClientScope, roomsettingRoutes);
app.use('/api/generatereport', apiAuth, apiClientScope, generatereportRoutes);
app.use('/api/booking', apiAuth, bookingRoutes);
app.use('/api/expenses', apiAuth, apiClientScope, expensesRoutes);
app.use('/api/ownerportal', apiAuth, ownerportalRoutes);
app.use('/api/portal-auth', portalAuthRoutes);
app.use('/api/docs-auth', docsAuthRoutes);
app.use('/api/payex', payexRoutes);
app.use('/api/billplz', billplzRoutes);
app.use('/api/sandbox', apiAuth, sandboxRoutes);
// Enquiry – public (plans, addons, banks, credit-plans, submit); used by portal pricing page
app.use('/api/enquiry', enquiryRoutes);
// Owner enquiry – kept behind API auth to match legacy behavior.
app.use('/api/owner-enquiry', apiAuth, ownerEnquiryRoutes);
// Help – FAQ + ticket (topup_manual / manual billing ticket from portal credit page)
app.use('/api/help', helpRoutes);
// Payment verification: receipt upload, invoices, matching, approve/reject, Finverse sync
app.use('/api/payment-verification', apiAuth, apiClientScope, paymentVerificationRoutes);
app.use('/api/finverse', finverseCallbackRoutes);
// Portal may proxy /api/pricing/* to Node; same handler as enquiry (credit-plans)
app.use('/api/pricing', enquiryRoutes);
app.use('/api/download', downloadRoutes);
app.use('/api/public', publicRoutes);
// Antlerzone → cln_property (Bearer secret; not behind CLEANLEMON_API_GATE / apiAuth)
app.use('/api/cleanlemon-sync', cleanlemonAntlerzoneSyncRoutes);
// Backfill: single KL calendar day for all operators (does not mark midnight batch)
app.post('/api/internal/cleanlemon-schedule-ai-daily', async (req, res) => {
  const want = String(process.env.CLEANLEMON_SCHEDULE_AI_CRON_SECRET || '').trim();
  const got = String(req.headers['x-internal-secret'] || '').trim();
  if (!want || got !== want) {
    return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
  }
  try {
    const workingDay = req.body?.workingDay ? String(req.body.workingDay).slice(0, 10) : undefined;
    const summary = await clnOperatorAiSvc.runDailyScheduleAiAllOperators({ workingDay });
    return res.json({ ok: true, ...summary });
  } catch (e) {
    console.error('[server] cleanlemon-schedule-ai-daily', e);
    return res.status(500).json({ ok: false, reason: e?.message || 'ERROR' });
  }
});
// Rebalance (progress watch): same secret as daily; optional body.workingDay
app.post('/api/internal/cleanlemon-schedule-ai-rebalance', async (req, res) => {
  const want = String(process.env.CLEANLEMON_SCHEDULE_AI_CRON_SECRET || '').trim();
  const got = String(req.headers['x-internal-secret'] || '').trim();
  if (!want || got !== want) {
    return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
  }
  try {
    const workingDay = req.body?.workingDay ? String(req.body.workingDay).slice(0, 10) : undefined;
    const summary = await clnOperatorAiSvc.runRebalanceAllOperatorsWithWatch({ workingDay });
    return res.json({ ok: true, ...summary });
  } catch (e) {
    console.error('[server] cleanlemon-schedule-ai-rebalance', e);
    return res.status(500).json({ ok: false, reason: e?.message || 'ERROR' });
  }
});
// Midnight batch (KL): horizon days per operator; optional body.anchorYmd (YYYY-MM-DD), body.skipIfAlreadyRan (default true)
app.post('/api/internal/cleanlemon-schedule-ai-midnight', async (req, res) => {
  const want = String(process.env.CLEANLEMON_SCHEDULE_AI_CRON_SECRET || '').trim();
  const got = String(req.headers['x-internal-secret'] || '').trim();
  if (!want || got !== want) {
    return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
  }
  try {
    const anchorYmd = req.body?.anchorYmd ? String(req.body.anchorYmd).slice(0, 10) : undefined;
    const skipIfAlreadyRan = req.body?.skipIfAlreadyRan !== false;
    const summary = await clnOperatorAiSvc.runMidnightScheduleAiBatch({ anchorYmd, skipIfAlreadyRan });
    return res.json(summary);
  } catch (e) {
    console.error('[server] cleanlemon-schedule-ai-midnight', e);
    return res.status(500).json({ ok: false, reason: e?.message || 'ERROR' });
  }
});
// Available Unit list – public (no login), for portal /available-unit page
app.use('/api/availableunit', availableunitRoutes);
app.use('/api/available-unit', availableunitRoutes);
// Cleanlemons SaaS (cln_* tables; portal.cleanlemons.com → ECS)
if (cleanlemonApiGateEnabled) {
  app.use('/api/cleanlemon', apiAuth, cleanlemonRoutes);
  console.log('[server] CLEANLEMON API gate: enabled');
} else {
  app.use('/api/cleanlemon', cleanlemonRoutes);
  console.log('[server] CLEANLEMON API gate: disabled');
}
app.use(errorhandler);

app.get('/', (req, res) => {
  res.json({ ok: true, message: 'server running' });
});

// Log unmatched API requests (404) to see what path hit the server
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    console.log('[server] 404 (no route)', { method: req.method, path: req.path, url: req.originalUrl });
  }
  next();
});

const port = process.env.PORT || 5000;

app.listen(port, '0.0.0.0', () => {
  console.log(`server running on port ${port}`);
  console.log('[server] availableunit routes mounted: /api/availableunit/list, /api/available-unit/list');
  getOperatorMasterTableName().catch((e) =>
    console.warn('[server] operator master table name check failed:', e?.message || e)
  );
  const rebalanceMin = Number(process.env.CLEANLEMON_SCHEDULE_AI_REBALANCE_TIMER_MINUTES || 0);
  if (rebalanceMin > 0) {
    const ms = Math.max(5, rebalanceMin) * 60 * 1000;
    setInterval(() => {
      clnOperatorAiSvc.runRebalanceAllOperatorsWithWatch({}).catch((e) =>
        console.error('[server] cleanlemon-schedule-ai-rebalance tick', e?.message || e)
      );
    }, ms);
    console.log('[server] Cleanlemon schedule AI rebalance timer: every', rebalanceMin, 'min');
  }
  const midnightPollMin = Number(process.env.CLEANLEMON_SCHEDULE_AI_MIDNIGHT_POLL_MINUTES || 0);
  if (midnightPollMin > 0) {
    const ms = Math.max(1, midnightPollMin) * 60 * 1000;
    setInterval(() => {
      clnOperatorAiSvc.runMidnightScheduleAiTick({}).catch((e) =>
        console.error('[server] cleanlemon-schedule-ai-midnight tick', e?.message || e)
      );
    }, ms);
    console.log(
      '[server] Cleanlemon schedule AI midnight window check: every',
      midnightPollMin,
      'min (KL 00:00–00:05; or use OS cron POST /api/internal/cleanlemon-schedule-ai-midnight)'
    );
  }
});