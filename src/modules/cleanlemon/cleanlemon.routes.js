/**
 * Cleanlemons API — mounted at /api/cleanlemon (ECS Node).
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const Stripe = require('stripe');
const svc = require('./cleanlemon.service');
const plr = require('./cleanlemon-property-link-request.service');
const clnPropGroup = require('./cleanlemon-property-group.service');
const clnInt = require('./cleanlemon-integration.service');
const clnOpAi = require('./cln-operator-ai.service');
const clnSaasAiMd = require('./cln-saasadmin-ai-md.service');
const clnSalary = require('./cleanlemon-operator-salary.service');
const clnOpCompanyEmail = require('./cln-operator-company-email.service');
const clnDriverTrip = require('./cleanlemon-driver-trip.service');
const clnDobi = require('./cleanlemon-dobi.service');
const clnOpPropGroup = require('./cleanlemon-operator-property-group.service');
const clnPropLock = require('./cleanlemon-property-lock.service');
const accessSvc = require('../access/access.service');
const { verifyPortalToken } = require('../portal-auth/portal-auth.service');
const clnReview = require('./cleanlemon-review.service');

function isMissingClnOperatorAiTable(err) {
  const msg = String(err?.message || '');
  const c = String(err?.code || '');
  return c === 'ER_NO_SUCH_TABLE' || msg.includes("doesn't exist") || msg.includes('Unknown table');
}

/** Operator invoice create: accounting / validation failures (not server bugs). */
function isOperatorInvoiceClientError(err) {
  const sc = Number(err?.statusCode);
  if (sc === 400) return true;
  const codeOnly = String(err?.code || '').trim();
  if (codeOnly.startsWith('BUKKU_') || codeOnly.startsWith('XERO_')) return true;
  const r = String(err?.message || err?.code || '').trim();
  if (!r) return false;
  if (r === 'OPERATOR_ID_REQUIRED') return true;
  if (r === 'ACCOUNTING_INVOICE_FAILED') return true;
  if (r === 'ACCOUNT_MAPPING_MISSING' || r === 'MISSING_CLIENT_ID' || r === 'INVALID_AMOUNT' || r === 'NO_LINE_ITEMS') {
    return true;
  }
  if (r.startsWith('BUKKU_') || r.startsWith('XERO_')) return true;
  return false;
}

/** MySQL pool or axios (Bukku/Xero) closed the socket mid-request — not a validation bug. */
function isTransientNetworkError(err) {
  const msg = [err?.message, err?.code, err?.cause?.message, err?.errors?.[0]?.message]
    .map((x) => String(x || ''))
    .join(' ');
  return /ECONNRESET|ETIMEDOUT|socket hang up|ECONNREFUSED|EPIPE|ENETUNREACH/i.test(msg);
}

/**
 * Prefer Portal JWT email over JSON body. `jwtVerified` means Bearer was present and signature valid.
 */
function clientPortalAuthFromRequest(req, bodyEmail) {
  const auth = String(req.headers.authorization || '');
  const m = /^Bearer\s+(\S+)/i.exec(auth);
  if (m) {
    const payload = verifyPortalToken(m[1].trim());
    if (payload?.email) {
      return {
        email: String(payload.email).trim().toLowerCase(),
        jwtVerified: true,
      };
    }
    return { email: String(bodyEmail || '').trim().toLowerCase(), jwtVerified: false };
  }
  return { email: String(bodyEmail || '').trim().toLowerCase(), jwtVerified: false };
}

function employeePortalEmailStrict(req) {
  const auth = String(req.headers.authorization || '');
  const m = /^Bearer\s+(\S+)/i.exec(auth);
  if (!m) return null;
  const payload = verifyPortalToken(m[1].trim());
  return payload?.email ? String(payload.email).trim().toLowerCase() : null;
}

function portalJwtPayload(req) {
  const auth = String(req.headers.authorization || '');
  const m = /^Bearer\s+(\S+)/i.exec(auth);
  if (!m) return null;
  return verifyPortalToken(m[1].trim());
}

/** SaaS platform admin only — Cleanlemons admin API (JWT email in `saasadmin`). */
async function ensureCleanlemonSaasAdmin(req, res) {
  const email = employeePortalEmailStrict(req);
  if (!email) {
    res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    return null;
  }
  try {
    const mr = await accessSvc.getMemberRoles(email);
    const ok =
      mr?.ok &&
      (mr.roles || []).some((r) => String(r.type || '').toLowerCase() === 'saas_admin');
    if (!ok) {
      res.status(403).json({ ok: false, reason: 'SAAS_ADMIN_ONLY' });
      return null;
    }
    return email;
  } catch (err) {
    console.error('[cleanlemon] ensureCleanlemonSaasAdmin', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
    return null;
  }
}

/** Portal JWT email must be operator master or staff of `operatorId`. */
async function requireOperatorStaffForPortal(req, res, operatorIdRaw) {
  const email = employeePortalEmailStrict(req);
  if (!email) {
    res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    return null;
  }
  const operatorId = String(operatorIdRaw ?? '').trim();
  if (!operatorId) {
    res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    return null;
  }
  try {
    await svc.assertClnOperatorStaffEmail(operatorId, email);
    return { email, operatorId };
  } catch (err) {
    const code = String(err?.code || '');
    if (
      code === 'OPERATOR_ACCESS_DENIED' ||
      code === 'OPERATORDETAIL_REQUIRED' ||
      code === 'MISSING_OPERATOR_OR_EMAIL'
    ) {
      res.status(403).json({ ok: false, reason: code });
      return null;
    }
    console.error('[cleanlemon] requireOperatorStaffForPortal', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
    return null;
  }
}

const { getBanksPublic } = require('../enquiry/enquiry.service');

function sanitizeRedirectUriForXero(raw) {
  const input = raw != null ? String(raw).trim() : '';
  if (!input) return '';
  try {
    const u = new URL(input);
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return input;
  }
}
const { uploadToOss } = require('../upload/oss.service');

/** Employee damage / profile uploads may include short videos (images stay small). */
const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
}).single('file');

const STRIPE_API_VERSION = '2024-11-20.acacia';
let cleanlemonStripe = null;

function getCleanlemonStripe() {
  if (cleanlemonStripe) return cleanlemonStripe;
  const key = String(
    process.env.CLEANLEMON_STRIPE_SECRET_KEY ||
      process.env.STRIPE_SECRET_KEY ||
      ''
  ).trim();
  if (!key) throw new Error('CLEANLEMON_STRIPE_SECRET_KEY_OR_STRIPE_SECRET_KEY_MISSING');
  cleanlemonStripe = new Stripe(key, { apiVersion: STRIPE_API_VERSION });
  return cleanlemonStripe;
}

function normalizePlanCode(input) {
  const x = String(input || '').trim().toLowerCase();
  if (x === 'basic') return 'starter';
  if (x === 'grow') return 'growth';
  if (x === 'scale') return 'enterprise';
  if (x === 'starter' || x === 'growth' || x === 'enterprise') return x;
  return '';
}

function normalizeInterval(input) {
  const x = String(input || '').trim().toLowerCase();
  if (x === 'year' || x === 'month' || x === 'quarter') return x;
  return 'month';
}

router.get('/health', async (req, res) => {
  try {
    const body = await svc.health();
    res.json(body);
  } catch (err) {
    console.error('[cleanlemon] health', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const body = await svc.stats();
    res.json({ ok: true, ...body });
  } catch (err) {
    console.error('[cleanlemon] stats', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/banks', async (req, res) => {
  try {
    const result = await getBanksPublic();
    res.json(result);
  } catch (err) {
    console.error('[cleanlemon] banks', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/subscription/pricing', async (req, res) => {
  try {
    const items = await svc.listClnPricingplanCatalog();
    res.json({ ok: true, items });
  } catch (err) {
    console.error('[cleanlemon] subscription/pricing', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/subscription/addon-catalog', async (req, res) => {
  try {
    const items = await svc.listClnAddonCatalog();
    res.json({ ok: true, items });
  } catch (err) {
    console.error('[cleanlemon] subscription/addon-catalog', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/subscription/addon-quote', async (req, res) => {
  try {
    const addonCode = String(req.query.addonCode || '').trim();
    const operatorId = String(req.query.operatorId || '').trim();
    const email = String(req.query.email || '').trim().toLowerCase();
    if (!addonCode) return res.status(400).json({ ok: false, reason: 'MISSING_ADDON_CODE' });
    const q = await svc.computeAddonProrationQuote({ operatorId, email, addonCode });
    if (!q.ok) return res.status(400).json({ ok: false, reason: q.reason || 'QUOTE_FAILED', ...q });
    return res.json({ ok: true, ...q });
  } catch (err) {
    console.error('[cleanlemon] subscription/addon-quote', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/subscription/addon-checkout', async (req, res) => {
  try {
    const addonCode = String(req.body?.addonCode || '').trim();
    const operatorId = String(req.body?.operatorId || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const name = String(req.body?.name || '').trim();
    const successUrl = String(req.body?.successUrl || '').trim();
    const cancelUrl = String(req.body?.cancelUrl || '').trim();
    if (!addonCode) return res.status(400).json({ ok: false, reason: 'MISSING_ADDON_CODE' });
    if (!operatorId || !email) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_OR_EMAIL' });
    if (!successUrl || !cancelUrl) return res.status(400).json({ ok: false, reason: 'MISSING_RETURN_URL' });
    const out = await svc.createAddonCheckoutSession({
      operatorId,
      email,
      name,
      addonCode,
      successUrl,
      cancelUrl,
    });
    return res.json({ ok: true, url: out.url, sessionId: out.sessionId, quote: out.quote });
  } catch (err) {
    const code = err?.code || err?.message;
    if (
      [
        'OPERATOR_EMAIL_MISMATCH',
        'NO_ACTIVE_SUBSCRIPTION',
        'SUBSCRIPTION_TERMINATED',
        'SUBSCRIPTION_PERIOD_ENDED',
        'ADDON_NOT_FOUND',
        'ADDON_ALREADY_ACTIVE',
        'ADDON_NOT_YEARLY_CATALOG',
        'PRORATION_BELOW_STRIPE_MINIMUM',
        'MISSING_OPERATOR_ID_OR_EMAIL',
        'MISSING_ADDON_CODE',
        'NO_EXPIRY_DATE',
        'ADDON_REQUIRES_YEARLY_SUBSCRIPTION',
      ].includes(String(code))
    ) {
      return res.status(400).json({ ok: false, reason: String(code), details: err?.details });
    }
    console.error('[cleanlemon] subscription/addon-checkout', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'CHECKOUT_FAILED' });
  }
});

router.post('/subscription/checkout', async (req, res) => {
  try {
    const plan = normalizePlanCode(req.body?.plan);
    const interval = normalizeInterval(req.body?.interval);
    const email = String(req.body?.email || '').trim().toLowerCase();
    const name = String(req.body?.name || '').trim();
    const successUrl = String(req.body?.successUrl || '').trim();
    const cancelUrl = String(req.body?.cancelUrl || '').trim();
    const checkoutAction = String(req.body?.checkoutAction || req.body?.checkout_action || '').trim().toLowerCase();
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!plan) return res.status(400).json({ ok: false, reason: 'INVALID_PLAN' });
    if (!successUrl || !cancelUrl) return res.status(400).json({ ok: false, reason: 'MISSING_RETURN_URL' });
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });

    const elig = await svc.getSubscriptionCheckoutEligibility({
      email,
      operatorId: operatorId || '',
      planCode: plan,
      checkoutAction,
    });
    if (!elig.ok) return res.status(400).json({ ok: false, reason: elig.code || 'CHECKOUT_NOT_ALLOWED' });

    let mainLineItem;
    try {
      mainLineItem = await svc.buildClnSubscriptionCheckoutLineItem(plan, interval);
    } catch (buildErr) {
      const c = String(buildErr?.code || '');
      if (c === 'PRICE_NOT_CONFIGURED' || c === 'INVALID_PLAN' || c === 'INVALID_INTERVAL') {
        return res.status(400).json({ ok: false, reason: c || 'PRICE_NOT_CONFIGURED' });
      }
      throw buildErr;
    }

    const stripe = getCleanlemonStripe();
    const resolvedAction = (checkoutAction || 'subscribe').toLowerCase() === 'new' ? 'subscribe' : (checkoutAction || 'subscribe').toLowerCase();
    const billingOid = String(operatorId || elig.current?.operatorId || '').trim();
    let renewAddonLineItems = [];
    let renewAddonCodesStr = '';
    if (['renew', 'upgrade'].includes(resolvedAction) && billingOid) {
      try {
        const pack = await svc.resolveRenewalAddonStripeLineItems(billingOid, interval);
        renewAddonLineItems = pack.lineItems || [];
        renewAddonCodesStr = (pack.addonCodes || []).join(',');
      } catch (addErr) {
        const code = String(addErr?.code || '');
        if (
          code === 'ADDON_PRICE_INVALID' ||
          code === 'ADDON_CATALOG_MISMATCH' ||
          code === 'RENEW_WITH_ADDONS_REQUIRES_YEARLY_BILLING'
        ) {
          return res.status(400).json({
            ok: false,
            reason: code,
            addonCode: addErr.addonCode || null,
          });
        }
        throw addErr;
      }
    }
    const metaBase = {
      type: 'cleanlemon_subscription',
      plan_code: plan,
      interval_code: interval,
      customer_email: email || '',
      customer_name: name || '',
      checkout_action: resolvedAction,
      operator_id: operatorId || '',
      renew_addon_codes: renewAddonCodesStr ? String(renewAddonCodesStr).slice(0, 450) : '',
    };
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [mainLineItem, ...renewAddonLineItems],
      customer_email: email || undefined,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: metaBase,
      subscription_data: {
        metadata: {
          type: 'cleanlemon_subscription',
          plan_code: plan,
          interval_code: interval,
          operator_email: email || '',
          customer_email: email || '',
          operator_name: name || '',
          checkout_action: metaBase.checkout_action,
          operator_id: operatorId || '',
          renew_addon_codes: metaBase.renew_addon_codes || '',
        },
      },
    });
    return res.json({ ok: true, url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('[cleanlemon] subscription/checkout', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'CHECKOUT_FAILED' });
  }
});

router.post('/operator/onboarding-profile', async (req, res) => {
  try {
    const result = await svc.upsertOperatorOnboardingProfile(req.body || {});
    return res.json({ ok: true, ...result });
  } catch (err) {
    if (err?.code === 'MISSING_EMAIL') {
      return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    }
    console.error('[cleanlemon] operator/onboarding-profile', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/operator/onboarding-enquiry-status', async (req, res) => {
  try {
    const email = String(req.query.email || '').trim();
    const out = await svc.getOnboardingEnquiryStatusByEmail(email);
    return res.json(out);
  } catch (err) {
    console.error('[cleanlemon] operator/onboarding-enquiry-status', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/upload', uploadMiddleware, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, reason: 'FILE_REQUIRED' });
    }
    const clientId = req.body?.clientId != null ? String(req.body.clientId).trim() : '';
    if (!clientId) {
      return res.status(400).json({ ok: false, reason: 'CLIENT_ID_REQUIRED' });
    }
    const result = await uploadToOss(req.file.buffer, req.file.originalname || 'file', clientId);
    if (!result.ok) {
      const status = result.reason === 'OSS_CREDENTIAL_INVALID' ? 503 : 400;
      return res.status(status).json({ ok: false, reason: result.reason || 'UPLOAD_FAILED' });
    }
    return res.json({ ok: true, url: result.url });
  } catch (err) {
    console.error('[cleanlemon] upload', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'UPLOAD_FAILED' });
  }
});

router.get('/employee/profile', async (req, res) => {
  try {
    const email = String(req.query.email || '').trim();
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    const operatorId = String(req.query.operatorId || req.query.operator_id || '').trim();
    const profile = await svc.getEmployeeProfileByEmail(email, operatorId || null);
    return res.json({ ok: true, profile: profile || null });
  } catch (err) {
    console.error('[cleanlemon] employee/profile:get', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.put('/employee/profile', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim();
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    const saved = await svc.upsertEmployeeProfileByEmail(email, req.body || {});
    return res.json({ ok: true, profile: saved });
  } catch (err) {
    console.error('[cleanlemon] employee/profile:put', err);
    if (err?.code === 'MISSING_EMAIL') {
      return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    }
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

/** Driver vehicle photo — OSS path scoped by employeedetail id (Portal JWT). */
router.post('/employee/driver-vehicle-photo', uploadMiddleware, async (req, res) => {
  try {
    const email = employeePortalEmailStrict(req);
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    if (!req.file) return res.status(400).json({ ok: false, reason: 'FILE_REQUIRED' });
    const pool = require('../../config/db');
    const [[row]] = await pool.query('SELECT id FROM cln_employeedetail WHERE LOWER(TRIM(email)) = ? LIMIT 1', [
      email,
    ]);
    const eid = row?.id ? String(row.id).trim() : '';
    if (!eid) return res.status(400).json({ ok: false, reason: 'EMPLOYEE_ROW_MISSING' });
    const result = await uploadToOss(req.file.buffer, req.file.originalname || 'photo.jpg', eid);
    if (!result.ok) {
      const status = result.reason === 'OSS_CREDENTIAL_INVALID' ? 503 : 400;
      return res.status(status).json({ ok: false, reason: result.reason || 'UPLOAD_FAILED' });
    }
    return res.json({ ok: true, url: result.url });
  } catch (err) {
    console.error('[cleanlemon] employee/driver-vehicle-photo', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'UPLOAD_FAILED' });
  }
});

router.get('/employee/driver-vehicle', async (req, res) => {
  try {
    const email = employeePortalEmailStrict(req);
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const out = await svc.getDriverVehicleByEmail(email);
    return res.json(out);
  } catch (err) {
    console.error('[cleanlemon] employee/driver-vehicle:get', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.put('/employee/driver-vehicle', async (req, res) => {
  try {
    const email = employeePortalEmailStrict(req);
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const out = await svc.updateDriverVehicleByEmail(email, req.body || {});
    return res.json(out);
  } catch (err) {
    const code = err?.code;
    if (code === 'MISSING_EMAIL' || code === 'MIGRATION_REQUIRED') {
      return res.status(code === 'MIGRATION_REQUIRED' ? 503 : 400).json({ ok: false, reason: code });
    }
    console.error('[cleanlemon] employee/driver-vehicle:put', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

/** Employee — driver route order (`cln_driver_trip`). */
router.post('/employee/driver-trip', async (req, res) => {
  try {
    const email = employeePortalEmailStrict(req);
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const body = req.body || {};
    const out = await clnDriverTrip.createDriverTrip({
      email,
      operatorId: body.operatorId,
      pickup: body.pickup,
      dropoff: body.dropoff,
      scheduleOffset: body.scheduleOffset,
      orderTimeIso: body.orderTimeIso,
    });
    return res.json(out);
  } catch (err) {
    const code = String(err?.code || '');
    if (
      code === 'MISSING_FIELDS' ||
      code === 'PICKUP_DROPOFF_SAME' ||
      code === 'EMPLOYEE_PROFILE_REQUIRED' ||
      code === 'ACTIVE_TRIP_EXISTS'
    ) {
      return res.status(400).json({ ok: false, reason: code });
    }
    if (code === 'OPERATOR_ACCESS_DENIED' || code === 'OPERATORDETAIL_REQUIRED') {
      return res.status(403).json({ ok: false, reason: code });
    }
    if (code === 'MIGRATION_REQUIRED') {
      return res.status(503).json({ ok: false, reason: code });
    }
    console.error('[cleanlemon] employee/driver-trip:post', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/employee/driver-trip/active', async (req, res) => {
  try {
    const email = employeePortalEmailStrict(req);
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const operatorId = String(req.query.operatorId || '').trim();
    const out = await clnDriverTrip.getActiveTripForEmployee({ email, operatorId });
    return res.json(out);
  } catch (err) {
    const code = String(err?.code || '');
    if (code === 'MISSING_OPERATOR_ID') return res.status(400).json({ ok: false, reason: code });
    if (code === 'OPERATOR_ACCESS_DENIED' || code === 'OPERATORDETAIL_REQUIRED') {
      return res.status(403).json({ ok: false, reason: code });
    }
    console.error('[cleanlemon] employee/driver-trip/active:get', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/employee/driver-trip/cancel', async (req, res) => {
  try {
    const email = employeePortalEmailStrict(req);
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const body = req.body || {};
    await clnDriverTrip.cancelDriverTrip({
      email,
      operatorId: body.operatorId,
      tripId: body.tripId,
    });
    return res.json({ ok: true });
  } catch (err) {
    const code = String(err?.code || '');
    if (code === 'MISSING_FIELDS' || code === 'EMPLOYEE_PROFILE_REQUIRED' || code === 'TRIP_NOT_CANCELLABLE') {
      return res.status(400).json({ ok: false, reason: code });
    }
    if (code === 'NOT_FOUND') return res.status(404).json({ ok: false, reason: code });
    if (code === 'FORBIDDEN') return res.status(403).json({ ok: false, reason: code });
    if (code === 'OPERATOR_ACCESS_DENIED' || code === 'OPERATORDETAIL_REQUIRED') {
      return res.status(403).json({ ok: false, reason: code });
    }
    console.error('[cleanlemon] employee/driver-trip/cancel:post', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/employee/driver-trip/open', async (req, res) => {
  try {
    const email = employeePortalEmailStrict(req);
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const operatorId = String(req.query.operatorId || '').trim();
    const out = await clnDriverTrip.listOpenTripsForDriver({ email, operatorId });
    return res.json(out);
  } catch (err) {
    const code = String(err?.code || '');
    if (code === 'MISSING_OPERATOR_ID') return res.status(400).json({ ok: false, reason: code });
    if (code === 'DRIVER_ROLE_REQUIRED') return res.status(403).json({ ok: false, reason: code });
    if (code === 'OPERATOR_ACCESS_DENIED' || code === 'OPERATORDETAIL_REQUIRED') {
      return res.status(403).json({ ok: false, reason: code });
    }
    console.error('[cleanlemon] employee/driver-trip/open:get', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/employee/driver-trip/accept', async (req, res) => {
  try {
    const email = employeePortalEmailStrict(req);
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const body = req.body || {};
    const out = await clnDriverTrip.acceptTripAsDriver({
      email,
      operatorId: body.operatorId,
      tripId: body.tripId,
    });
    return res.json(out);
  } catch (err) {
    const code = String(err?.code || '');
    if (code === 'MISSING_FIELDS' || code === 'EMPLOYEE_PROFILE_REQUIRED' || code === 'TRIP_NOT_OPEN') {
      return res.status(400).json({ ok: false, reason: code });
    }
    if (code === 'NOT_FOUND') return res.status(404).json({ ok: false, reason: code });
    if (code === 'CANNOT_ACCEPT_OWN_TRIP') return res.status(400).json({ ok: false, reason: code });
    if (code === 'ACTIVE_TRIP_EXISTS') return res.status(409).json({ ok: false, reason: code });
    if (code === 'DRIVER_ROLE_REQUIRED') return res.status(403).json({ ok: false, reason: code });
    if (code === 'OPERATOR_ACCESS_DENIED' || code === 'OPERATORDETAIL_REQUIRED') {
      return res.status(403).json({ ok: false, reason: code });
    }
    console.error('[cleanlemon] employee/driver-trip/accept:post', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/employee/driver-trip/start', async (req, res) => {
  try {
    const email = employeePortalEmailStrict(req);
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const body = req.body || {};
    const out = await clnDriverTrip.startDriverTrip({
      email,
      operatorId: body.operatorId,
      tripId: body.tripId,
    });
    return res.json(out);
  } catch (err) {
    const code = String(err?.code || '');
    if (code === 'MISSING_FIELDS' || code === 'EMPLOYEE_PROFILE_REQUIRED' || code === 'TRIP_START_DENIED') {
      return res.status(400).json({ ok: false, reason: code });
    }
    if (code === 'MIGRATION_REQUIRED') return res.status(503).json({ ok: false, reason: code });
    if (code === 'DRIVER_ROLE_REQUIRED') return res.status(403).json({ ok: false, reason: code });
    if (code === 'OPERATOR_ACCESS_DENIED' || code === 'OPERATORDETAIL_REQUIRED') {
      return res.status(403).json({ ok: false, reason: code });
    }
    console.error('[cleanlemon] employee/driver-trip/start:post', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/employee/driver-trip/release-accept', async (req, res) => {
  try {
    const email = employeePortalEmailStrict(req);
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const body = req.body || {};
    const out = await clnDriverTrip.releaseDriverAcceptance({
      email,
      operatorId: body.operatorId,
      tripId: body.tripId,
    });
    return res.json(out);
  } catch (err) {
    const code = String(err?.code || '');
    if (code === 'MISSING_FIELDS' || code === 'EMPLOYEE_PROFILE_REQUIRED' || code === 'RELEASE_DENIED') {
      return res.status(400).json({ ok: false, reason: code });
    }
    if (code === 'DRIVER_ROLE_REQUIRED') return res.status(403).json({ ok: false, reason: code });
    if (code === 'OPERATOR_ACCESS_DENIED' || code === 'OPERATORDETAIL_REQUIRED') {
      return res.status(403).json({ ok: false, reason: code });
    }
    console.error('[cleanlemon] employee/driver-trip/release-accept:post', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/employee/driver-trip/driver-active', async (req, res) => {
  try {
    const email = employeePortalEmailStrict(req);
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const operatorId = String(req.query.operatorId || '').trim();
    const out = await clnDriverTrip.getActiveTripForDriver({ email, operatorId });
    return res.json(out);
  } catch (err) {
    const code = String(err?.code || '');
    if (code === 'MISSING_OPERATOR_ID') return res.status(400).json({ ok: false, reason: code });
    if (code === 'DRIVER_ROLE_REQUIRED') return res.status(403).json({ ok: false, reason: code });
    if (code === 'OPERATOR_ACCESS_DENIED' || code === 'OPERATORDETAIL_REQUIRED') {
      return res.status(403).json({ ok: false, reason: code });
    }
    console.error('[cleanlemon] employee/driver-trip/driver-active:get', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/employee/driver-trip/finish', async (req, res) => {
  try {
    const email = employeePortalEmailStrict(req);
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const body = req.body || {};
    const out = await clnDriverTrip.finishTripAsDriver({
      email,
      operatorId: body.operatorId,
      tripId: body.tripId,
    });
    return res.json(out);
  } catch (err) {
    const code = String(err?.code || '');
    if (code === 'MISSING_FIELDS' || code === 'EMPLOYEE_PROFILE_REQUIRED' || code === 'TRIP_FINISH_DENIED') {
      return res.status(code === 'TRIP_FINISH_DENIED' ? 409 : 400).json({ ok: false, reason: code });
    }
    if (code === 'TRIP_NOT_STARTED') return res.status(409).json({ ok: false, reason: code });
    if (code === 'DRIVER_ROLE_REQUIRED') return res.status(403).json({ ok: false, reason: code });
    if (code === 'OPERATOR_ACCESS_DENIED' || code === 'OPERATORDETAIL_REQUIRED') {
      return res.status(403).json({ ok: false, reason: code });
    }
    console.error('[cleanlemon] employee/driver-trip/finish:post', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/employee/driver-trip/driver-history', async (req, res) => {
  try {
    const email = employeePortalEmailStrict(req);
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const operatorId = String(req.query.operatorId || '').trim();
    const out = await clnDriverTrip.listCompletedTripsForDriver({
      email,
      operatorId,
      limit: req.query.limit,
    });
    return res.json(out);
  } catch (err) {
    const code = String(err?.code || '');
    if (code === 'MISSING_OPERATOR_ID') return res.status(400).json({ ok: false, reason: code });
    if (code === 'DRIVER_ROLE_REQUIRED') return res.status(403).json({ ok: false, reason: code });
    if (code === 'OPERATOR_ACCESS_DENIED' || code === 'OPERATORDETAIL_REQUIRED') {
      return res.status(403).json({ ok: false, reason: code });
    }
    console.error('[cleanlemon] employee/driver-trip/driver-history:get', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

/** Dobi laundry (`cln_dobi_*`) — employee + operator (same JWT + operator binding). */
function dobiHttpError(res, err) {
  const code = String(err?.code || '');
  if (code === 'MIGRATION_REQUIRED') return res.status(503).json({ ok: false, reason: code });
  if (code === 'OPERATOR_ACCESS_DENIED' || code === 'MISSING_OPERATOR_OR_EMAIL') {
    return res.status(403).json({ ok: false, reason: 'OPERATOR_ACCESS_DENIED' });
  }
    const bad400 = new Set([
    'INVALID_STAGE',
    'MACHINE_REQUIRED',
    'INVALID_MACHINE',
    'HANDOFF_REMARK_REQUIRED',
    'EMPTY_LINES',
    'UNKNOWN_ACTION',
    'LOT_NOT_FOUND',
    'INTAKE_LOCKED',
    'INVALID_BUSINESS_DATE',
    'MISSING_REMARK',
    'NO_LINEN_ITEM_TYPE_MATCH',
    'INVALID_TARGET_STAGE',
    'INVALID_TAKEOUTS',
    'TAKEOUT_REQUIRED',
    'INVALID_ITEM_LINE',
    'TAKEOUT_EXCEEDS',
  ]);
  if (bad400.has(code)) {
    const out = { ok: false, reason: code };
    if (code === 'HANDOFF_REMARK_REQUIRED' && err?.gapMinutes != null) out.gapMinutes = err.gapMinutes;
    if (code === 'NO_LINEN_ITEM_TYPE_MATCH' && err?.missingKeys) out.missingKeys = err.missingKeys;
    return res.status(400).json(out);
  }
  return null;
}

router.get('/employee/dobi/day', async (req, res) => {
  try {
    const email = employeePortalEmailStrict(req);
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const operatorId = String(req.query.operatorId || '').trim();
    const businessDate = String(req.query.businessDate || '').trim().slice(0, 10);
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const out = await clnDobi.getDayBundle(operatorId, businessDate, email);
    return res.json(out);
  } catch (err) {
    const d = dobiHttpError(res, err);
    if (d) return d;
    console.error('[cleanlemon] employee/dobi/day:get', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/employee/dobi/preview-split', async (req, res) => {
  try {
    const email = employeePortalEmailStrict(req);
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const out = await clnDobi.previewSplit(operatorId, email, req.body?.lines || []);
    return res.json(out);
  } catch (err) {
    const d = dobiHttpError(res, err);
    if (d) return d;
    console.error('[cleanlemon] employee/dobi/preview-split:post', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/employee/dobi/commit-intake', async (req, res) => {
  try {
    const email = employeePortalEmailStrict(req);
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const operatorId = String(req.body?.operatorId || '').trim();
    const businessDate = String(req.body?.businessDate || '').trim().slice(0, 10);
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const out = await clnDobi.commitIntake(operatorId, email, businessDate, req.body?.lines || []);
    return res.json(out);
  } catch (err) {
    const d = dobiHttpError(res, err);
    if (d) return d;
    console.error('[cleanlemon] employee/dobi/commit-intake:post', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

/** Dobi staff: add pending-wash batches manually (no QR), same packing rules as intake. */
router.post('/employee/dobi/append-intake', async (req, res) => {
  try {
    const email = employeePortalEmailStrict(req);
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const operatorId = String(req.body?.operatorId || '').trim();
    const businessDate = String(req.body?.businessDate || '').trim().slice(0, 10);
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const rawTs = String(req.body?.targetStage || req.body?.target_stage || '').trim().toLowerCase();
    const targetStage = rawTs === 'ready' ? 'ready' : 'pending_wash';
    const out = await clnDobi.appendIntakeLots(operatorId, email, businessDate, req.body?.lines || [], {
      source: 'manual_append',
      targetStage,
    });
    return res.json(out);
  } catch (err) {
    const d = dobiHttpError(res, err);
    if (d) return d;
    console.error('[cleanlemon] employee/dobi/append-intake:post', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/employee/dobi/lot-action', async (req, res) => {
  try {
    const email = employeePortalEmailStrict(req);
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const out = await clnDobi.lotAction(operatorId, email, req.body || {});
    return res.json(out);
  } catch (err) {
    const d = dobiHttpError(res, err);
    if (d) return d;
    console.error('[cleanlemon] employee/dobi/lot-action:post', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/employee/dobi/damage-linen', async (req, res) => {
  try {
    const email = employeePortalEmailStrict(req);
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const body = req.body || {};
    const out = await clnDobi.submitDobiDamageLinen({
      operatorId,
      email,
      businessDate: body.businessDate,
      remark: body.remark,
      lines: body.lines,
      photoUrls: body.photoUrls,
    });
    return res.json(out);
  } catch (err) {
    const d = dobiHttpError(res, err);
    if (d) return d;
    console.error('[cleanlemon] employee/dobi/damage-linen:post', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

/** Linen handoff: cleaner requests QR → dobi scans to approve (no signature). */
router.get('/employee/linens/qr-mode', async (req, res) => {
  try {
    const email = employeePortalEmailStrict(req);
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const operatorId = String(req.query.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    await svc.assertClnOperatorStaffEmail(operatorId, email);
    const cfg = await clnDobi.getConfig(operatorId);
    return res.json({ ok: true, linenQrStyle: cfg.linenQrStyle });
  } catch (err) {
    const code = String(err?.code || '');
    if (code === 'OPERATOR_ACCESS_DENIED' || code === 'MISSING_OPERATOR_OR_EMAIL') {
      return res.status(403).json({ ok: false, reason: 'OPERATOR_ACCESS_DENIED' });
    }
    console.error('[cleanlemon] employee/linens/qr-mode:get', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/employee/linens/qr-request', async (req, res) => {
  try {
    const email = employeePortalEmailStrict(req);
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const body = req.body || {};
    const cfg = await clnDobi.getConfig(operatorId);
    const ttlMs = clnDobi.linenQrTtlMsForStyle(cfg.linenQrStyle);
    const out = await svc.createLinenQrApprovalRequest({
      email,
      operatorId,
      date: body.date,
      action: body.action,
      team: body.team,
      totals: body.totals,
      lines: body.lines,
      missingQty: body.missingQty,
      remark: body.remark,
      ttlMs,
    });
    return res.json({ ...out, linenQrStyle: cfg.linenQrStyle });
  } catch (err) {
    const code = String(err?.code || '');
    if (code === 'INVALID_PAYLOAD' || code === 'REMARK_REQUIRED' || code === 'INVALID_ITEM_TYPE') {
      return res.status(400).json({ ok: false, reason: code });
    }
    if (code === 'OPERATOR_ACCESS_DENIED' || code === 'MISSING_OPERATOR_OR_EMAIL') {
      return res.status(403).json({ ok: false, reason: code });
    }
    console.error('[cleanlemon] employee/linens/qr-request:post', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/employee/dobi/linen-qr', async (req, res) => {
  try {
    const email = employeePortalEmailStrict(req);
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const operatorId = String(req.query.operatorId || '').trim();
    const token = String(req.query.token || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    if (!token) return res.status(400).json({ ok: false, reason: 'MISSING_TOKEN' });
    const out = await svc.getLinenQrApprovalForDobi({ email, operatorId, token });
    return res.json(out);
  } catch (err) {
    const code = String(err?.code || '');
    if (code === 'DOBI_ROLE_REQUIRED') return res.status(403).json({ ok: false, reason: code });
    if (code === 'NOT_FOUND') return res.status(404).json({ ok: false, reason: code });
    if (code === 'EXPIRED') return res.status(410).json({ ok: false, reason: code });
    if (code === 'ALREADY_DONE') return res.status(409).json({ ok: false, reason: code });
    console.error('[cleanlemon] employee/dobi/linen-qr:get', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/employee/dobi/linen-qr-approve', async (req, res) => {
  try {
    const email = employeePortalEmailStrict(req);
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const operatorId = String(req.body?.operatorId || '').trim();
    const token = String(req.body?.token || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    if (!token) return res.status(400).json({ ok: false, reason: 'MISSING_TOKEN' });
    const out = await svc.approveLinenQrApproval({ email, operatorId, token });
    return res.json(out);
  } catch (err) {
    const code = String(err?.code || '');
    if (code === 'DOBI_ROLE_REQUIRED') return res.status(403).json({ ok: false, reason: code });
    if (code === 'NOT_FOUND') return res.status(404).json({ ok: false, reason: code });
    if (code === 'EXPIRED') return res.status(410).json({ ok: false, reason: code });
    if (code === 'ALREADY_DONE') return res.status(409).json({ ok: false, reason: code });
    if (code === 'NO_LINEN_ITEM_TYPE_MATCH') {
      return res.status(400).json({ ok: false, reason: code, missingKeys: err?.missingKeys });
    }
    if (code === 'INVALID_ITEM_TYPE') return res.status(400).json({ ok: false, reason: code });
    const d = dobiHttpError(res, err);
    if (d) return d;
    console.error('[cleanlemon] employee/dobi/linen-qr-approve:post', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/employee/dobi/report', async (req, res) => {
  try {
    const email = employeePortalEmailStrict(req);
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const operatorId = String(req.query.operatorId || '').trim();
    const fromDate = String(req.query.fromDate || '').trim().slice(0, 10);
    const toDate = String(req.query.toDate || '').trim().slice(0, 10);
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const out = await clnDobi.report(operatorId, email, fromDate, toDate);
    return res.json(out);
  } catch (err) {
    const d = dobiHttpError(res, err);
    if (d) return d;
    console.error('[cleanlemon] employee/dobi/report:get', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/employee/dobi/summary', async (req, res) => {
  try {
    const email = employeePortalEmailStrict(req);
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const operatorId = String(req.query.operatorId || '').trim();
    const fromDate = String(req.query.fromDate || '').trim().slice(0, 10);
    const toDate = String(req.query.toDate || '').trim().slice(0, 10);
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const out = await clnDobi.summary(operatorId, email, fromDate, toDate);
    return res.json(out);
  } catch (err) {
    const d = dobiHttpError(res, err);
    if (d) return d;
    console.error('[cleanlemon] employee/dobi/summary:get', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/employee/dobi/day-events', async (req, res) => {
  try {
    const email = employeePortalEmailStrict(req);
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const operatorId = String(req.query.operatorId || '').trim();
    const businessDate = String(req.query.businessDate || '').trim().slice(0, 10);
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    if (!businessDate) return res.status(400).json({ ok: false, reason: 'MISSING_BUSINESS_DATE' });
    const out = await clnDobi.listWorkflowEventsForDay(operatorId, email, businessDate);
    return res.json(out);
  } catch (err) {
    const code = String(err?.code || '');
    if (code === 'INVALID_BUSINESS_DATE') return res.status(400).json({ ok: false, reason: code });
    const d = dobiHttpError(res, err);
    if (d) return d;
    console.error('[cleanlemon] employee/dobi/day-events:get', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/operator/dobi/config', async (req, res) => {
  try {
    const email = employeePortalEmailStrict(req);
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const operatorId = String(req.query.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    await svc.assertClnOperatorStaffEmail(operatorId, email);
    const cfg = await clnDobi.getConfig(operatorId);
    const itemTypes = await clnDobi.listItemTypes(operatorId);
    const machines = await clnDobi.listMachines(operatorId);
    return res.json({ ok: true, config: cfg, itemTypes, machines });
  } catch (err) {
    const d = dobiHttpError(res, err);
    if (d) return d;
    console.error('[cleanlemon] operator/dobi/config:get', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.put('/operator/dobi/config', async (req, res) => {
  try {
    const email = employeePortalEmailStrict(req);
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const cfg = await clnDobi.putConfig(operatorId, email, req.body || {});
    return res.json({ ok: true, config: cfg });
  } catch (err) {
    const d = dobiHttpError(res, err);
    if (d) return d;
    console.error('[cleanlemon] operator/dobi/config:put', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.put('/operator/dobi/item-types', async (req, res) => {
  try {
    const email = employeePortalEmailStrict(req);
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const itemTypes = await clnDobi.replaceItemTypes(operatorId, email, req.body?.items || []);
    return res.json({ ok: true, itemTypes });
  } catch (err) {
    const d = dobiHttpError(res, err);
    if (d) return d;
    console.error('[cleanlemon] operator/dobi/item-types:put', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.put('/operator/dobi/machines', async (req, res) => {
  try {
    const email = employeePortalEmailStrict(req);
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const machines = await clnDobi.replaceMachines(operatorId, email, req.body?.machines || []);
    return res.json({ ok: true, machines });
  } catch (err) {
    const d = dobiHttpError(res, err);
    if (d) return d;
    console.error('[cleanlemon] operator/dobi/machines:put', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/operator/dobi/day', async (req, res) => {
  try {
    const email = employeePortalEmailStrict(req);
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const operatorId = String(req.query.operatorId || '').trim();
    const businessDate = String(req.query.businessDate || '').trim().slice(0, 10);
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const out = await clnDobi.getDayBundle(operatorId, businessDate, email);
    return res.json(out);
  } catch (err) {
    const d = dobiHttpError(res, err);
    if (d) return d;
    console.error('[cleanlemon] operator/dobi/day:get', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/employee/schedule-jobs/group-start', async (req, res) => {
  try {
    const email = employeePortalEmailStrict(req);
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const operatorId = String(req.body?.operatorId || '').trim();
    const jobIds = Array.isArray(req.body?.jobIds) ? req.body.jobIds : [];
    const out = await svc.groupStartEmployeeScheduleJobs({
      email,
      operatorId,
      jobIds,
      estimateCompleteAt: req.body?.estimateCompleteAt,
      estimatePhotoCount: req.body?.estimatePhotoCount,
    });
    res.json(out);
  } catch (err) {
    const code = err?.code;
    if (code === 'GROUP_MIN_JOBS') return res.status(400).json({ ok: false, reason: code });
    if (code === 'JOB_NOT_FOUND_OR_DENIED') return res.status(404).json({ ok: false, reason: code });
    if (code === 'OPERATOR_MISMATCH') return res.status(403).json({ ok: false, reason: code });
    if (code === 'GROUP_REQUIRES_COLIVING_PROPERTY' || code === 'GROUP_MISMATCH') {
      return res.status(400).json({ ok: false, reason: code });
    }
    if (code === 'GROUP_STATUS_MISMATCH') return res.status(409).json({ ok: false, reason: code });
    if (code === 'OPERATOR_ACCESS_DENIED' || code === 'MISSING_OPERATOR_OR_EMAIL') {
      return res.status(403).json({ ok: false, reason: code });
    }
    console.error('[cleanlemon] employee/schedule-jobs/group-start', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/employee/job-completion-addons', async (req, res) => {
  try {
    const email = employeePortalEmailStrict(req);
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const operatorId = String(req.query.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const out = await svc.getEmployeeJobCompletionAddons({ email, operatorId });
    res.json(out);
  } catch (err) {
    const code = err?.code;
    if (code === 'OPERATOR_ACCESS_DENIED' || code === 'MISSING_OPERATOR_OR_EMAIL') {
      return res.status(403).json({ ok: false, reason: code });
    }
    console.error('[cleanlemon] employee/job-completion-addons:get', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/employee/schedule-jobs/group-end', async (req, res) => {
  try {
    const email = employeePortalEmailStrict(req);
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const operatorId = String(req.body?.operatorId || '').trim();
    const jobIds = Array.isArray(req.body?.jobIds) ? req.body.jobIds : [];
    const photos = Array.isArray(req.body?.photos) ? req.body.photos : [];
    const remark = req.body?.remark;
    const completionAddons = Array.isArray(req.body?.completionAddons) ? req.body.completionAddons : [];
    const out = await svc.groupEndEmployeeScheduleJobs({
      email,
      operatorId,
      jobIds,
      photos,
      remark,
      completionAddons,
    });
    if (out?.ok && Array.isArray(jobIds) && jobIds.length) {
      clnOpAi.maybeRunProgressRebalanceAfterGroupEnd(operatorId, jobIds);
    }
    res.json(out);
  } catch (err) {
    const code = err?.code;
    if (code === 'GROUP_MIN_JOBS') return res.status(400).json({ ok: false, reason: code });
    if (code === 'JOB_NOT_FOUND_OR_DENIED') return res.status(404).json({ ok: false, reason: code });
    if (code === 'OPERATOR_MISMATCH') return res.status(403).json({ ok: false, reason: code });
    if (code === 'GROUP_REQUIRES_COLIVING_PROPERTY' || code === 'GROUP_MISMATCH') {
      return res.status(400).json({ ok: false, reason: code });
    }
    if (code === 'GROUP_END_STATUS_MISMATCH') return res.status(409).json({ ok: false, reason: code });
    if (code === 'OPERATOR_ACCESS_DENIED' || code === 'MISSING_OPERATOR_OR_EMAIL') {
      return res.status(403).json({ ok: false, reason: code });
    }
    console.error('[cleanlemon] employee/schedule-jobs/group-end', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

/** Employee portal — damage report (OSS photos + remark); persisted in cln_damage_report. */
router.post('/employee/schedule-jobs/:scheduleId/damage-report', async (req, res) => {
  try {
    const email = employeePortalEmailStrict(req);
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const operatorId = String(req.body?.operatorId || '').trim();
    const scheduleId = String(req.params.scheduleId || '').trim();
    const remark = req.body?.remark;
    const photos = Array.isArray(req.body?.photos) ? req.body.photos : [];
    const location = req.body?.location;
    const out = await svc.createEmployeeScheduleDamageReport({
      email,
      operatorId,
      scheduleId,
      remark,
      photos,
      location,
    });
    res.json(out);
  } catch (err) {
    const code = err?.code;
    if (code === 'MISSING_SCHEDULE_ID' || code === 'MISSING_REMARK') {
      return res.status(400).json({ ok: false, reason: code });
    }
    if (code === 'JOB_NOT_FOUND') return res.status(404).json({ ok: false, reason: code });
    if (code === 'OPERATOR_MISMATCH') return res.status(403).json({ ok: false, reason: code });
    if (code === 'OPERATOR_ACCESS_DENIED' || code === 'MISSING_OPERATOR_OR_EMAIL') {
      return res.status(403).json({ ok: false, reason: code });
    }
    if (code === 'DAMAGE_REPORT_TABLE_MISSING') {
      return res.status(503).json({ ok: false, reason: code });
    }
    console.error('[cleanlemon] employee/schedule-jobs/damage-report', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/employee/task/unlock-targets', async (req, res) => {
  try {
    const email = employeePortalEmailStrict(req);
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const operatorId = String(req.body?.operatorId || '').trim();
    const jobId = String(req.body?.jobId || '').trim();
    if (!jobId) return res.status(400).json({ ok: false, reason: 'MISSING_JOB_ID' });
    const out = await svc.listEmployeeTaskUnlockTargets({ email, operatorId, jobId });
    res.json(out);
  } catch (err) {
    const code = err?.code;
    if (code === 'JOB_NOT_FOUND') return res.status(404).json({ ok: false, reason: code });
    if (code === 'OPERATOR_MISMATCH') return res.status(403).json({ ok: false, reason: code });
    if (code === 'OPERATOR_ACCESS_DENIED' || code === 'MISSING_OPERATOR_OR_EMAIL') {
      return res.status(403).json({ ok: false, reason: code });
    }
    console.error('[cleanlemon] employee/task/unlock-targets', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/employee/task/unlock', async (req, res) => {
  try {
    const email = employeePortalEmailStrict(req);
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const operatorId = String(req.body?.operatorId || '').trim();
    const jobId = String(req.body?.jobId || '').trim();
    const lockDetailId = String(req.body?.lockDetailId || '').trim();
    if (!jobId || !lockDetailId) return res.status(400).json({ ok: false, reason: 'MISSING_IDS' });
    const out = await svc.employeeTaskRemoteUnlock({ email, operatorId, jobId, lockDetailId });
    res.json(out);
  } catch (err) {
    const code = err?.code;
    if (
      code === 'LOCK_NOT_ALLOWED' ||
      code === 'LOCK_NOT_FOUND' ||
      code === 'LOCK_SCOPE_DENIED' ||
      code === 'OPERATOR_DOOR_USE_PASSWORD' ||
      code === 'OPERATOR_DOOR_NO_BOOKING_TODAY'
    ) {
      return res.status(400).json({ ok: false, reason: code });
    }
    if (code === 'OPERATOR_ACCESS_DENIED' || code === 'MISSING_OPERATOR_OR_EMAIL') {
      return res.status(403).json({ ok: false, reason: code });
    }
    if (err.message && String(err.message).startsWith('TTLOCK_')) {
      return res.status(400).json({ ok: false, reason: err.message });
    }
    console.error('[cleanlemon] employee/task/unlock', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

/** Client portal — TTLock per B2B client (cln_client_integration + cln_ttlocktoken). */
router.post('/client/ttlock/onboard-status', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email);
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    if (!jwtVerified && !operatorId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL_OR_OPERATOR' });
    }
    const clientdetailId = await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: jwtVerified,
    });
    const st = await clnInt.getTtlockOnboardStatusClnClientdetail(clientdetailId);
    return res.json({ ok: true, ...st });
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') {
      return res.status(409).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] client/ttlock/onboard-status', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

router.post('/client/ttlock/credentials', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email);
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    if (!jwtVerified && !operatorId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL_OR_OPERATOR' });
    }
    const clientdetailId = await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: jwtVerified,
    });
    const slot = req.body?.ttlockSlot ?? req.body?.ttlock_slot ?? 0;
    const data = await clnInt.getTtlockCredentialsClnClientdetail(clientdetailId, Number(slot) || 0);
    return res.json(data);
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') {
      return res.status(409).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] client/ttlock/credentials', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

router.post('/client/ttlock/connect', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email);
    const operatorId = String(req.body?.operatorId || '').trim();
    const username = req.body?.username;
    const password = req.body?.password;
    const accountName = req.body?.accountName ?? req.body?.account_name ?? req.body?.name;
    const slotRaw = req.body?.ttlockSlot ?? req.body?.ttlock_slot;
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    if (!jwtVerified && !operatorId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL_OR_OPERATOR' });
    }
    const clientdetailId = await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: jwtVerified,
    });
    const result = await clnInt.ttlockConnectClnClientdetail(clientdetailId, {
      username,
      password,
      accountName,
      slot: slotRaw != null && slotRaw !== '' ? Number(slotRaw) : undefined,
      source: 'manual'
    });
    return res.json(result);
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') {
      return res.status(409).json({ ok: false, reason: err.code });
    }
    const msg = err?.message || 'TTLOCK_CONNECT_FAILED';
    console.error('[cleanlemon] client/ttlock/connect', err);
    return res.status(400).json({ ok: false, reason: msg });
  }
});

router.post('/client/ttlock/disconnect', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email);
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    if (!jwtVerified && !operatorId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL_OR_OPERATOR' });
    }
    const clientdetailId = await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: jwtVerified,
    });
    const slot = req.body?.ttlockSlot ?? req.body?.ttlock_slot ?? 0;
    await clnInt.ttlockDisconnectClnClientdetail(clientdetailId, Number(slot) || 0);
    return res.json({ ok: true });
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') {
      return res.status(409).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'TTLOCK_COLIVING_MANAGED' || err?.message === 'TTLOCK_COLIVING_MANAGED') {
      return res.status(400).json({ ok: false, reason: 'TTLOCK_COLIVING_MANAGED' });
    }
    console.error('[cleanlemon] client/ttlock/disconnect', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

/** B2B client portal — linked Cleanlemons operators + Coliving bridge (which Coliving company account). */
router.post('/client/integration/context', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email);
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    if (!jwtVerified && !operatorId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL_OR_OPERATOR' });
    }
    const clientdetailId = await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: jwtVerified,
    });
    const [linkedOperators, coliving] = await Promise.all([
      svc.listClientPortalLinkedCleanlemonsOperators(clientdetailId),
      clnInt.getColivingBridgeInfoClnClientdetail(clientdetailId),
    ]);
    return res.json({ ok: true, linkedOperators, coliving });
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') {
      return res.status(409).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] client/integration/context', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

/** B2B client portal — list properties where `cln_property.clientdetail_id` matches the logged-in client. */
router.post('/client/properties/list', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email);
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    const clientdetailId = await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: jwtVerified,
    });
    const items = await svc.listClientPortalProperties({ clientdetailId, loginEmail: email });
    return res.json({ ok: true, items });
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') {
      return res.status(409).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] client/properties/list', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

/** B2B client portal — explicit Coliving → cln_property sync (same upsert as operator link confirm). */
router.post('/client/properties/sync-coliving', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email);
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    if (!jwtVerified && !operatorId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL_OR_OPERATOR' });
    }
    const clientdetailId = await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: jwtVerified,
    });
    const result = await svc.syncClientPortalPropertiesFromColiving({ clientdetailId });
    if (!result.ok) {
      const code = result.reason || 'SYNC_FAILED';
      if (code === 'NO_COLIVING_OPERATOR_LINK') return res.status(404).json({ ok: false, reason: code });
      if (code === 'COLIVING_COLUMNS_UNAVAILABLE' || code === 'SYNC_MODULE_UNAVAILABLE') {
        return res.status(503).json({ ok: false, reason: code });
      }
      return res.status(400).json({ ok: false, reason: code });
    }
    return res.json({
      ok: true,
      syncedOperators: result.syncedOperators,
      itemCount: result.itemCount,
    });
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') {
      return res.status(409).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] client/properties/sync-coliving', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

/** B2B client portal — single property for edit dialog (contact + pricing + mirror fields). */
router.post('/client/properties/detail', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email);
    const operatorId = String(req.body?.operatorId || '').trim();
    const propertyId = String(req.body?.propertyId || '').trim();
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    if (!jwtVerified && !operatorId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL_OR_OPERATOR' });
    }
    if (!propertyId) return res.status(400).json({ ok: false, reason: 'MISSING_PROPERTY_ID' });
    const clientdetailId = await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: jwtVerified,
    });
    const detail = await svc.getClientPortalPropertyDetail({ clientdetailId, propertyId });
    if (!detail) return res.status(404).json({ ok: false, reason: 'NOT_FOUND' });
    return res.json({ ok: true, property: detail });
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') {
      return res.status(409).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] client/properties/detail', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

/** Operator portal — list native lock binds (`cln_property_lock`). */
router.post('/operator/property-locks/list', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    const propertyId = String(req.body?.propertyId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    if (!propertyId) return res.status(400).json({ ok: false, reason: 'MISSING_PROPERTY_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const items = await clnPropLock.listNativeLocksForOperatorPortal({ operatorId, propertyId });
    return res.json({ ok: true, items });
  } catch (err) {
    const code = err?.code;
    if (code === 'MISSING_IDS') return res.status(400).json({ ok: false, reason: code });
    if (code === 'OPERATOR_MISMATCH') return res.status(403).json({ ok: false, reason: code });
    if (code === 'UNSUPPORTED') return res.status(501).json({ ok: false, reason: code });
    console.error('[cleanlemon] operator/property-locks/list', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

router.post('/operator/property-locks/bind', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    const propertyId = String(req.body?.propertyId || '').trim();
    const lockdetailId = String(req.body?.lockdetailId || '').trim();
    const ttlockSlot = req.body?.ttlockSlot != null ? Number(req.body.ttlockSlot) : 0;
    const integrationSource = String(req.body?.integrationSource || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    if (!propertyId) return res.status(400).json({ ok: false, reason: 'MISSING_PROPERTY_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const out = await clnPropLock.bindNativeLockOperator({
      operatorId,
      propertyId,
      lockdetailId,
      ttlockSlot,
      integrationSource,
    });
    return res.json({ ok: true, bindId: out.bindId });
  } catch (err) {
    const code = err?.code;
    if (code === 'MISSING_IDS' || code === 'MISSING_LOCK_ID') return res.status(400).json({ ok: false, reason: code });
    if (code === 'OPERATOR_MISMATCH') return res.status(403).json({ ok: false, reason: code });
    if (code === 'PROPERTY_COLIVING_LOCK_MANAGED') return res.status(409).json({ ok: false, reason: code });
    if (code === 'LOCK_NOT_IN_SCOPE') return res.status(400).json({ ok: false, reason: code });
    if (code === 'ALREADY_BOUND') return res.status(409).json({ ok: false, reason: code });
    if (code === 'UNSUPPORTED') return res.status(501).json({ ok: false, reason: code });
    console.error('[cleanlemon] operator/property-locks/bind', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

router.post('/operator/property-locks/unbind', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    const propertyId = String(req.body?.propertyId || '').trim();
    const lockdetailId = String(req.body?.lockdetailId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    if (!propertyId) return res.status(400).json({ ok: false, reason: 'MISSING_PROPERTY_ID' });
    if (!lockdetailId) return res.status(400).json({ ok: false, reason: 'MISSING_LOCK_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    await clnPropLock.unbindNativeLockOperator({ operatorId, propertyId, lockdetailId });
    return res.json({ ok: true });
  } catch (err) {
    const code = err?.code;
    if (code === 'MISSING_IDS') return res.status(400).json({ ok: false, reason: code });
    if (code === 'OPERATOR_MISMATCH') return res.status(403).json({ ok: false, reason: code });
    if (code === 'UNSUPPORTED') return res.status(501).json({ ok: false, reason: code });
    console.error('[cleanlemon] operator/property-locks/unbind', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

/** B2B client portal — native lock binds (same table; client TTLock scope). */
router.post('/client/property-locks/list', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email);
    const operatorId = String(req.body?.operatorId || '').trim();
    const propertyId = String(req.body?.propertyId || '').trim();
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    if (!jwtVerified && !operatorId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL_OR_OPERATOR' });
    }
    if (!propertyId) return res.status(400).json({ ok: false, reason: 'MISSING_PROPERTY_ID' });
    const clientdetailId = await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: jwtVerified,
    });
    const items = await clnPropLock.listNativeLocksForClientPortal({ clientdetailId, propertyId });
    return res.json({ ok: true, items });
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') {
      return res.status(409).json({ ok: false, reason: err.code });
    }
    const code = err?.code;
    if (code === 'MISSING_IDS') return res.status(400).json({ ok: false, reason: code });
    if (code === 'CLIENT_PROPERTY_MISMATCH') return res.status(403).json({ ok: false, reason: code });
    if (code === 'UNSUPPORTED') return res.status(501).json({ ok: false, reason: code });
    console.error('[cleanlemon] client/property-locks/list', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

router.post('/client/property-locks/bind', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email);
    const operatorId = String(req.body?.operatorId || '').trim();
    const propertyId = String(req.body?.propertyId || '').trim();
    const lockdetailId = String(req.body?.lockdetailId || '').trim();
    const ttlockSlot = req.body?.ttlockSlot != null ? Number(req.body.ttlockSlot) : 0;
    const integrationSource = String(req.body?.integrationSource || '').trim();
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    if (!jwtVerified && !operatorId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL_OR_OPERATOR' });
    }
    if (!propertyId) return res.status(400).json({ ok: false, reason: 'MISSING_PROPERTY_ID' });
    const clientdetailId = await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: jwtVerified,
    });
    const out = await clnPropLock.bindNativeLockClient({
      clientdetailId,
      propertyId,
      lockdetailId,
      ttlockSlot,
      integrationSource,
    });
    return res.json({ ok: true, bindId: out.bindId });
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') {
      return res.status(409).json({ ok: false, reason: err.code });
    }
    const code = err?.code;
    if (code === 'MISSING_IDS' || code === 'MISSING_LOCK_ID') return res.status(400).json({ ok: false, reason: code });
    if (code === 'CLIENT_PROPERTY_MISMATCH') return res.status(403).json({ ok: false, reason: code });
    if (code === 'PROPERTY_COLIVING_LOCK_MANAGED') return res.status(409).json({ ok: false, reason: code });
    if (code === 'LOCK_NOT_IN_SCOPE') return res.status(400).json({ ok: false, reason: code });
    if (code === 'ALREADY_BOUND') return res.status(409).json({ ok: false, reason: code });
    if (code === 'UNSUPPORTED') return res.status(501).json({ ok: false, reason: code });
    console.error('[cleanlemon] client/property-locks/bind', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

router.post('/client/property-locks/unbind', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email);
    const operatorId = String(req.body?.operatorId || '').trim();
    const propertyId = String(req.body?.propertyId || '').trim();
    const lockdetailId = String(req.body?.lockdetailId || '').trim();
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    if (!jwtVerified && !operatorId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL_OR_OPERATOR' });
    }
    if (!propertyId) return res.status(400).json({ ok: false, reason: 'MISSING_PROPERTY_ID' });
    if (!lockdetailId) return res.status(400).json({ ok: false, reason: 'MISSING_LOCK_ID' });
    const clientdetailId = await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: jwtVerified,
    });
    await clnPropLock.unbindNativeLockClient({ clientdetailId, propertyId, lockdetailId });
    return res.json({ ok: true });
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') {
      return res.status(409).json({ ok: false, reason: err.code });
    }
    const code = err?.code;
    if (code === 'MISSING_IDS') return res.status(400).json({ ok: false, reason: code });
    if (code === 'CLIENT_PROPERTY_MISMATCH') return res.status(403).json({ ok: false, reason: code });
    if (code === 'UNSUPPORTED') return res.status(501).json({ ok: false, reason: code });
    console.error('[cleanlemon] client/property-locks/unbind', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

/** B2B client portal — patch cln_property (+ Coliving propertydetail when linked). */
router.post('/client/properties/patch', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email);
    const operatorId = String(req.body?.operatorId || '').trim();
    const propertyId = String(req.body?.propertyId || '').trim();
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    if (!jwtVerified && !operatorId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL_OR_OPERATOR' });
    }
    if (!propertyId) return res.status(400).json({ ok: false, reason: 'MISSING_PROPERTY_ID' });
    const clientdetailId = await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: jwtVerified,
    });
    const property = await svc.patchClientPortalProperty({
      clientdetailId,
      propertyId,
      body: req.body?.patch || req.body,
    });
    return res.json({ ok: true, property });
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') {
      return res.status(409).json({ ok: false, reason: err.code });
    }
    const code = err?.code;
    if (code === 'PROPERTY_NOT_FOUND') return res.status(404).json({ ok: false, reason: code });
    if (code === 'GROUP_PERMISSION_DENIED') return res.status(403).json({ ok: false, reason: code });
    if (
      code === 'AUTHORIZE_PROPERTY_TTLOCK_REQUIRED' ||
      code === 'MISSING_OPERATOR_ID' ||
      code === 'OPERATOR_NOT_FOUND' ||
      code === 'MISSING_IDS' ||
      code === 'INVALID_OPERATOR_DOOR_ACCESS_MODE' ||
      code === 'OPERATOR_DOOR_GATEWAY_REQUIRED'
    ) {
      return res.status(400).json({ ok: false, reason: code });
    }
    console.error('[cleanlemon] client/properties/patch', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

/** B2B client portal — bulk request operator binding (pending approval), same as single-property Connect flow. */
router.post('/client/properties/bulk-request-operator', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email);
    const operatorId = String(req.body?.operatorId || '').trim();
    const targetOperatorId = String(req.body?.targetOperatorId || '').trim();
    const propertyIds = req.body?.propertyIds;
    const auth = !!req.body?.authorizePropertyAndTtlock;
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    if (!jwtVerified && !operatorId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL_OR_OPERATOR' });
    }
    if (!targetOperatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    if (!auth) {
      return res.status(400).json({ ok: false, reason: 'AUTHORIZE_PROPERTY_TTLOCK_REQUIRED' });
    }
    if (!Array.isArray(propertyIds) || propertyIds.length === 0) {
      return res.status(400).json({ ok: false, reason: 'MISSING_PROPERTY_IDS' });
    }
    const clientdetailId = await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: jwtVerified,
    });
    const replaceExistingBindings = !!req.body?.replaceExistingBindings;
    const result = await svc.bulkRequestClientPortalOperatorBinding({
      clientdetailId,
      propertyIds,
      targetOperatorId,
      replaceExistingBindings,
    });
    return res.json({ ok: true, succeeded: result.succeeded, failed: result.failed });
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') {
      return res.status(409).json({ ok: false, reason: err.code });
    }
    const code = err?.code;
    if (
      code === 'MISSING_IDS' ||
      code === 'MISSING_PROPERTY_IDS' ||
      code === 'OPERATOR_NOT_FOUND' ||
      code === 'OPERATOR_COLUMN_MISSING' ||
      code === 'CLIENT_PORTAL_PROPERTIES_UNSUPPORTED'
    ) {
      return res.status(400).json({ ok: false, reason: code });
    }
    console.error('[cleanlemon] client/properties/bulk-request-operator', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

/** B2B client portal — clear Cleanlemons operator on many properties. */
router.post('/client/properties/bulk-disconnect', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email);
    const operatorId = String(req.body?.operatorId || '').trim();
    const propertyIds = req.body?.propertyIds;
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    if (!jwtVerified && !operatorId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL_OR_OPERATOR' });
    }
    if (!Array.isArray(propertyIds) || propertyIds.length === 0) {
      return res.status(400).json({ ok: false, reason: 'MISSING_PROPERTY_IDS' });
    }
    const clientdetailId = await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: jwtVerified,
    });
    const result = await svc.bulkClearClientPortalOperator({
      clientdetailId,
      propertyIds,
    });
    return res.json({ ok: true, succeeded: result.succeeded, failed: result.failed });
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') {
      return res.status(409).json({ ok: false, reason: err.code });
    }
    const code = err?.code;
    if (
      code === 'MISSING_IDS' ||
      code === 'MISSING_PROPERTY_IDS' ||
      code === 'OPERATOR_COLUMN_MISSING' ||
      code === 'CLIENT_PORTAL_PROPERTIES_UNSUPPORTED'
    ) {
      return res.status(400).json({ ok: false, reason: code });
    }
    console.error('[cleanlemon] client/properties/bulk-disconnect', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

/** B2B client — property groups (shared access by email). Operator may be unset until client links one. */
router.post('/client/property-groups/list', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email);
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    const clientdetailId = await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: jwtVerified,
    });
    const items = await clnPropGroup.listGroupsForClientPortal(clientdetailId, { operatorId, loginEmail: email });
    return res.json({ ok: true, items });
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') {
      return res.status(409).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] client/property-groups/list', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

router.post('/client/property-groups/create', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email);
    const operatorId = String(req.body?.operatorId || '').trim();
    const name = String(req.body?.name || '').trim();
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    const clientdetailId = await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: jwtVerified,
    });
    const out = await clnPropGroup.createPropertyGroup({
      ownerClientdetailId: clientdetailId,
      operatorId,
      name,
    });
    return res.json({ ok: true, group: out });
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') {
      return res.status(409).json({ ok: false, reason: err.code });
    }
    if (
      err?.code === 'MISSING_IDS' ||
      err?.code === 'OPERATOR_NOT_FOUND' ||
      err?.code === 'CLIENTDETAIL_NOT_LINKED' ||
      err?.code === 'GROUP_FEATURE_UNAVAILABLE'
    ) {
      return res.status(400).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] client/property-groups/create', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

router.post('/client/property-groups/detail', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email);
    const operatorId = String(req.body?.operatorId || '').trim();
    const groupId = String(req.body?.groupId || '').trim();
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    if (!groupId) return res.status(400).json({ ok: false, reason: 'MISSING_GROUP_ID' });
    const clientdetailId = await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: jwtVerified,
    });
    const detail = await clnPropGroup.getGroupDetailForClient({
      groupId,
      clientdetailId,
      loginEmail: email,
    });
    return res.json({ ok: true, group: detail });
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') {
      return res.status(409).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'GROUP_NOT_FOUND' || err?.code === 'GROUP_ACCESS_DENIED') {
      return res.status(err?.code === 'GROUP_ACCESS_DENIED' ? 403 : 404).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] client/property-groups/detail', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

router.post('/client/property-groups/add-property', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email);
    const operatorId = String(req.body?.operatorId || '').trim();
    const groupId = String(req.body?.groupId || '').trim();
    const rawIds = req.body?.propertyIds;
    const propertyIds = Array.isArray(rawIds)
      ? rawIds.map((x) => String(x || '').trim()).filter(Boolean)
      : [];
    const propertyId = String(req.body?.propertyId || '').trim();
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    const clientdetailId = await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: jwtVerified,
    });
    if (propertyIds.length) {
      for (const pid of propertyIds) {
        await clnPropGroup.addPropertyToGroup({ groupId, ownerClientdetailId: clientdetailId, propertyId: pid });
      }
      return res.json({ ok: true, added: propertyIds.length });
    }
    await clnPropGroup.addPropertyToGroup({ groupId, ownerClientdetailId: clientdetailId, propertyId });
    return res.json({ ok: true });
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') {
      return res.status(409).json({ ok: false, reason: err.code });
    }
    if (
      err?.code === 'GROUP_NOT_FOUND_OR_FORBIDDEN' ||
      err?.code === 'PROPERTY_NOT_FOUND' ||
      err?.code === 'PROPERTY_OWNER_MISMATCH' ||
      err?.code === 'PROPERTY_OPERATOR_MISMATCH' ||
      err?.code === 'PROPERTY_ALREADY_IN_GROUP' ||
      err?.code === 'MISSING_PROPERTY_ID'
    ) {
      return res.status(400).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] client/property-groups/add-property', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

router.post('/client/property-groups/remove-property', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email);
    const operatorId = String(req.body?.operatorId || '').trim();
    const groupId = String(req.body?.groupId || '').trim();
    const propertyId = String(req.body?.propertyId || '').trim();
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    const clientdetailId = await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: jwtVerified,
    });
    await clnPropGroup.removePropertyFromGroup({ groupId, ownerClientdetailId: clientdetailId, propertyId });
    return res.json({ ok: true });
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') {
      return res.status(409).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'GROUP_NOT_FOUND_OR_FORBIDDEN') {
      return res.status(400).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] client/property-groups/remove-property', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

router.post('/client/property-groups/invite', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email);
    const operatorId = String(req.body?.operatorId || '').trim();
    const groupId = String(req.body?.groupId || '').trim();
    const inviteEmail = String(req.body?.inviteEmail || '').trim();
    const b = req.body || {};
    const perm = clnPropGroup.parsePermFromRequestBody(b);
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    const clientdetailId = await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: jwtVerified,
    });
    const out = await clnPropGroup.inviteMemberByEmail({
      groupId,
      ownerClientdetailId: clientdetailId,
      inviteEmail,
      perm,
    });
    return res.json({ ok: true, member: out });
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') {
      return res.status(409).json({ ok: false, reason: err.code });
    }
    if (
      err?.code === 'GROUP_NOT_FOUND_OR_FORBIDDEN' ||
      err?.code === 'INVALID_EMAIL' ||
      err?.code === 'CANNOT_INVITE_SELF' ||
      err?.code === 'INVITE_DUPLICATE'
    ) {
      return res.status(400).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] client/property-groups/invite', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

router.post('/client/property-groups/members', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email);
    const operatorId = String(req.body?.operatorId || '').trim();
    const groupId = String(req.body?.groupId || '').trim();
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    if (!groupId) return res.status(400).json({ ok: false, reason: 'MISSING_GROUP_ID' });
    const clientdetailId = await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: jwtVerified,
    });
    const items = await clnPropGroup.listGroupMembers({ groupId, clientdetailId, loginEmail: email });
    return res.json({ ok: true, items });
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') {
      return res.status(409).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'GROUP_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] client/property-groups/members', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

router.post('/client/property-groups/member-permissions', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email);
    const operatorId = String(req.body?.operatorId || '').trim();
    const groupId = String(req.body?.groupId || '').trim();
    const memberId = String(req.body?.memberId || '').trim();
    const perm = clnPropGroup.parsePermFromRequestBody(req.body || {});
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    const clientdetailId = await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: jwtVerified,
    });
    await clnPropGroup.updateMemberPermissions({
      groupId,
      ownerClientdetailId: clientdetailId,
      memberId,
      perm,
    });
    return res.json({ ok: true });
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') {
      return res.status(409).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'GROUP_NOT_FOUND_OR_FORBIDDEN') {
      return res.status(400).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] client/property-groups/member-permissions', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

router.post('/client/property-groups/kick', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email);
    const operatorId = String(req.body?.operatorId || '').trim();
    const groupId = String(req.body?.groupId || '').trim();
    const memberId = String(req.body?.memberId || '').trim();
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    const clientdetailId = await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: jwtVerified,
    });
    await clnPropGroup.kickMember({ groupId, ownerClientdetailId: clientdetailId, memberId });
    return res.json({ ok: true });
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') {
      return res.status(409).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'GROUP_NOT_FOUND_OR_FORBIDDEN') {
      return res.status(400).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] client/property-groups/kick', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

router.post('/client/property-groups/delete', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email);
    const operatorId = String(req.body?.operatorId || '').trim();
    const groupId = String(req.body?.groupId || '').trim();
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    const clientdetailId = await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: jwtVerified,
    });
    await clnPropGroup.deletePropertyGroup({ groupId, ownerClientdetailId: clientdetailId });
    return res.json({ ok: true });
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') {
      return res.status(409).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'GROUP_NOT_FOUND_OR_FORBIDDEN') {
      return res.status(400).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] client/property-groups/delete', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

/** B2B client — list pending property link requests (operator must approve client, or client must approve operator). */
router.get('/client/property-link-requests', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.query?.email || req.body?.email);
    const operatorId = String(req.query?.operatorId || req.body?.operatorId || '').trim();
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    if (!jwtVerified && !operatorId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL_OR_OPERATOR' });
    }
    const clientdetailId = await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: jwtVerified,
    });
    const status = String(req.query?.status || 'pending').trim();
    const kind = String(req.query?.kind || '').trim() || null;
    const items = await plr.listPropertyLinkRequestsForClientdetail(clientdetailId, { status, kind });
    return res.json({ ok: true, items });
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') {
      return res.status(409).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] client/property-link-requests:get', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

/** B2B client — approve or reject operator_requests_client (operator bound client; client decides). */
/** B2B client — invoices (clientdetail-scoped; optional filter by issuing operator). */
router.get('/client/invoices', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.query?.email || req.body?.email);
    const operatorId = String(req.query?.operatorId || req.body?.operatorId || '').trim();
    const filterOperatorId = String(req.query?.filterOperatorId || '').trim();
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    if (!jwtVerified && !operatorId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL_OR_OPERATOR' });
    }
    const clientdetailId = await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: jwtVerified,
    });
    const limit = req.query?.limit;
    const out = await svc.listClientPortalInvoices({
      clientdetailId,
      filterOperatorId: filterOperatorId || undefined,
      limit: limit != null ? Number(limit) : undefined,
    });
    return res.json({ ok: true, items: out.items, operators: out.operators });
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') {
      return res.status(409).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] client/invoices:get', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

/** Billplz server callback (form POST) — marks invoices paid when signature + amount match checkout row. */
router.post(
  '/client/invoices/billplz-callback',
  express.urlencoded({ extended: true }),
  async (req, res) => {
    try {
      const checkoutId = String(req.query?.checkout_id || req.body?.checkout_id || '').trim();
      const out = await svc.handleB2bInvoiceBillplzCallback(checkoutId, { ...req.body, ...req.query });
      if (!out.ok) {
        const status =
          out.reason === 'BILLPLZ_SIGNATURE_INVALID' || out.reason === 'BILLPLZ_NOT_CONFIGURED' ? 403 : 400;
        return res.status(status).type('text/plain').send(String(out.reason || 'ERROR'));
      }
      return res.status(200).type('text/plain').send('OK');
    } catch (err) {
      console.error('[cleanlemon] client/invoices:billplz-callback', err);
      return res.status(500).type('text/plain').send('SERVER_ERROR');
    }
  },
);

/** Xendit invoice webhook (JSON) — `X-Callback-Token` must match operator settings. */
router.post('/client/invoices/xendit-webhook', async (req, res) => {
  try {
    const out = await svc.handleB2bInvoiceXenditWebhook({
      headers: req.headers,
      body: req.body || {},
      query: req.query || {},
    });
    if (!out.ok) {
      const status = out.reason === 'XENDIT_CALLBACK_TOKEN_INVALID' ? 403 : 400;
      return res.status(status).json({ ok: false, reason: out.reason || 'ERROR' });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[cleanlemon] client/invoices:xendit-webhook', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

/** B2B client — same pattern as Coliving tenant `create-payment`: optional return/cancel URLs, auto gateway, `{ ok, type: 'redirect', url, provider }`. */
router.post('/client/invoices/create-payment', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email);
    const operatorId = String(req.body?.operatorId || '').trim();
    const invoiceIds = req.body?.invoiceIds;
    const returnUrl = String(req.body?.returnUrl || '').trim();
    const cancelUrl = String(req.body?.cancelUrl || '').trim();
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    if (!jwtVerified && !operatorId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL_OR_OPERATOR' });
    }
    if (!Array.isArray(invoiceIds) || !invoiceIds.length) {
      return res.status(400).json({ ok: false, reason: 'MISSING_INVOICE_IDS' });
    }
    const clientdetailId = await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: jwtVerified,
    });
    const paymentProvider = String(req.body?.paymentProvider || req.body?.provider || '').trim().toLowerCase();
    const out = await svc.createClientPortalInvoicePayment({
      clientdetailId,
      operatorId,
      invoiceIds,
      email,
      returnUrl: returnUrl || undefined,
      cancelUrl: cancelUrl || undefined,
      ...(paymentProvider ? { paymentProvider } : {}),
    });
    if (!out.ok) {
      return res.status(400).json({ ok: false, reason: out.code || 'CREATE_PAYMENT_FAILED' });
    }
    return res.json({
      ok: true,
      type: 'redirect',
      url: out.url,
      sessionId: out.sessionId,
      provider: out.provider,
    });
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') {
      return res.status(409).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] client/invoices:create-payment', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

/** B2B client — after redirect (`success=1` + `session_id` / `bill_id` / `checkout_id`), same role as tenant `confirm-payment`. */
router.post('/client/invoices/confirm-payment', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email);
    const operatorId = String(req.body?.operatorId || '').trim();
    const b = req.body || {};
    const sessionId = String(b.session_id || b.sessionId || '').trim();
    const billId = String(b.bill_id || b.billId || '').trim();
    const checkoutId = String(b.checkout_id || b.checkoutId || '').trim();
    const provider = String(b.provider || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    if (!jwtVerified && !operatorId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL_OR_OPERATOR' });
    }
    const clientdetailId = await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: jwtVerified,
    });
    const out = await svc.confirmClientPortalInvoicePayment({
      clientdetailId,
      provider: provider || undefined,
      sessionId: sessionId || undefined,
      billId: billId || undefined,
      checkoutId: checkoutId || undefined,
    });
    return res.json(out);
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') {
      return res.status(409).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] client/invoices:confirm-payment', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

/** B2B client — Stripe Checkout for one operator’s unpaid invoices (same operator only; Connect destination). */
router.post('/client/invoices/checkout', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email);
    const operatorId = String(req.body?.operatorId || '').trim();
    const invoiceIds = req.body?.invoiceIds;
    const successUrl = String(req.body?.successUrl || '').trim();
    const cancelUrl = String(req.body?.cancelUrl || '').trim();
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    if (!jwtVerified && !operatorId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL_OR_OPERATOR' });
    }
    if (!Array.isArray(invoiceIds) || !invoiceIds.length) {
      return res.status(400).json({ ok: false, reason: 'MISSING_INVOICE_IDS' });
    }
    if (!successUrl || !cancelUrl) {
      return res.status(400).json({ ok: false, reason: 'MISSING_RETURN_URL' });
    }
    const clientdetailId = await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: jwtVerified,
    });
    const paymentProvider = String(req.body?.paymentProvider || req.body?.provider || 'stripe')
      .trim()
      .toLowerCase();
    const out = await svc.createClientPortalInvoiceCheckoutSession({
      clientdetailId,
      operatorId,
      invoiceIds,
      email,
      successUrl,
      cancelUrl,
      paymentProvider,
    });
    if (!out.ok) {
      return res.status(400).json({ ok: false, reason: out.code || 'CHECKOUT_FAILED' });
    }
    return res.json({
      ok: true,
      url: out.url,
      sessionId: out.sessionId,
      provider: out.provider || paymentProvider,
    });
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') {
      return res.status(409).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] client/invoices:checkout', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

/** B2B client — upload payment receipt (multipart: file, invoiceIds JSON array string, email, operatorId). */
router.post('/client/invoices/receipt-upload', uploadMiddleware, async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email);
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    if (!jwtVerified && !operatorId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL_OR_OPERATOR' });
    }
    if (!req.file || !req.file.buffer) return res.status(400).json({ ok: false, reason: 'FILE_REQUIRED' });
    const invoiceIdsRaw = req.body?.invoiceIds ?? req.body?.invoice_ids;
    let invoiceIds = [];
    try {
      invoiceIds =
        typeof invoiceIdsRaw === 'string'
          ? JSON.parse(invoiceIdsRaw)
          : Array.isArray(invoiceIdsRaw)
            ? invoiceIdsRaw
            : [];
    } catch {
      invoiceIds = [];
    }
    invoiceIds = [...new Set(invoiceIds.map((x) => String(x).trim()).filter(Boolean))];
    if (!invoiceIds.length) return res.status(400).json({ ok: false, reason: 'MISSING_INVOICE_IDS' });
    const clientdetailId = await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: jwtVerified,
    });
    const oss = await uploadToOss(req.file.buffer, req.file.originalname || 'receipt', `cln-client-${clientdetailId}`);
    if (!oss.ok) {
      const status = oss.reason === 'OSS_CREDENTIAL_INVALID' ? 503 : 400;
      return res.status(status).json({ ok: false, reason: oss.reason || 'UPLOAD_FAILED' });
    }
    const out = await svc.attachClientPortalInvoiceReceipt({
      clientdetailId,
      invoiceIds,
      receiptUrl: oss.url,
    });
    if (!out.ok) return res.status(400).json({ ok: false, reason: out.code || 'ATTACH_FAILED' });
    return res.json({ ok: true, url: oss.url, updated: out.updated });
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') {
      return res.status(409).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] client/invoices:receipt-upload', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

/** B2B client — operator bank transfer details from Company settings (for pay when Stripe Connect is off). */
router.get('/client/operator/bank-transfer-info', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.query?.email);
    const operatorId = String(req.query?.operatorId || '').trim();
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    if (!jwtVerified && !operatorId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL_OR_OPERATOR' });
    }
    await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: jwtVerified,
    });
    const out = await svc.getClientPortalOperatorBankTransferInfo(operatorId);
    if (!out.ok) {
      return res.status(400).json({ ok: false, reason: out.code || 'FAILED' });
    }
    return res.json({ ok: true, ...out });
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') {
      return res.status(409).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] client/operator/bank-transfer-info', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

/** B2B client — list schedule jobs (single-operator scope, or whole group when groupId set — mixed property operators). */
router.get('/client/schedule-jobs', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.query?.email || req.body?.email);
    const operatorId = String(req.query?.operatorId || req.body?.operatorId || '').trim();
    const groupId = String(req.query?.groupId || '').trim();
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    if (!jwtVerified && !operatorId && !groupId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL_OR_OPERATOR' });
    }
    const clientdetailId = await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: jwtVerified,
    });
    const limit = req.query?.limit;
    const items = await svc.listClientPortalScheduleJobs({
      clientdetailId,
      operatorId,
      limit,
      groupId: groupId || undefined,
    });
    return res.json({ ok: true, items });
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') {
      return res.status(409).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] client/schedule-jobs:get', err?.message || err, err?.sqlMessage);
    return res.status(500).json({
      ok: false,
      reason: err?.message || 'SERVER_ERROR',
      sqlMessage: err?.sqlMessage,
      errno: err?.errno,
    });
  }
});

/** B2B client — create a cleaning job (cln_property must match client + operator). */
router.post('/client/schedule-jobs', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email);
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    const clientdetailId = await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: jwtVerified,
    });
    const propertyId = String(req.body?.propertyId || '').trim();
    const date = String(req.body?.date || '').slice(0, 10);
    const time = req.body?.time != null ? String(req.body.time).trim() : '09:00';
    const timeEnd = req.body?.timeEnd != null ? String(req.body.timeEnd).trim() : undefined;
    const serviceProvider = String(req.body?.serviceProvider || 'general-cleaning').trim();
    const addons = req.body?.addons;
    const price = req.body?.price;
    const clientRemark = req.body?.clientRemark != null ? String(req.body.clientRemark) : undefined;
    const groupId = String(req.body?.groupId || '').trim();
    const btob = req.body?.btob;
    if (!propertyId || !date) {
      return res.status(400).json({ ok: false, reason: 'MISSING_PROPERTY_OR_DATE' });
    }
    const id = await svc.createClientPortalScheduleJob({
      clientdetailId,
      operatorId,
      propertyId,
      date,
      time,
      timeEnd,
      serviceProvider,
      createdByEmail: email,
      addons,
      price,
      clientRemark,
      groupId: groupId || undefined,
      btob,
    });
    return res.json({ ok: true, id });
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') {
      return res.status(409).json({ ok: false, reason: err.code });
    }
    if (
      err?.code === 'CLIENTDETAIL_NOT_LINKED' ||
      err?.code === 'PROPERTY_NOT_FOUND' ||
      err?.code === 'PROPERTY_CLIENT_MISMATCH' ||
      err?.code === 'PROPERTY_OPERATOR_MISMATCH' ||
      err?.code === 'MISSING_IDS' ||
      err?.code === 'GROUP_ACCESS_DENIED' ||
      err?.code === 'GROUP_PROPERTY_MISMATCH' ||
      err?.code === 'GROUP_OPERATOR_MISMATCH' ||
      err?.code === 'GROUP_FEATURE_UNAVAILABLE'
    ) {
      return res.status(400).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'GROUP_PERMISSION_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'BOOKING_LEAD_TIME_NOT_MET' || err?.code === 'BOOKING_SERVICE_NOT_ALLOWED') {
      return res.status(400).json({ ok: false, reason: err.code, message: err.message });
    }
    if (err?.code === 'MISSING_PROPERTY_ID' || err?.code === 'MISSING_DATE') {
      return res.status(400).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] client/schedule-jobs:post', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

router.put('/client/schedule-jobs/:id', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email);
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    if (!jwtVerified && !operatorId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL_OR_OPERATOR' });
    }
    const clientdetailId = await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: jwtVerified,
    });
    const workingDay = req.body?.workingDay ?? req.body?.working_day;
    const status = req.body?.status;
    const statusSetByEmail = req.body?.statusSetByEmail;
    const groupId = String(req.body?.groupId || '').trim();
    const btob = req.body?.btob;
    await svc.updateClientPortalScheduleJob({
      clientdetailId,
      operatorId,
      scheduleId: req.params.id,
      workingDay,
      status,
      statusSetByEmail,
      groupId: groupId || undefined,
      btob,
      loginEmail: email,
    });
    return res.json({ ok: true });
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') {
      return res.status(409).json({ ok: false, reason: err.code });
    }
    if (
      err?.code === 'PROPERTY_CLIENT_MISMATCH' ||
      err?.code === 'PROPERTY_OPERATOR_MISMATCH' ||
      err?.code === 'NOT_FOUND' ||
      err?.code === 'MISSING_IDS' ||
      err?.code === 'GROUP_PROPERTY_MISMATCH'
    ) {
      return res.status(400).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'GROUP_PERMISSION_DENIED' || err?.code === 'GROUP_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'OPERATOR_MISMATCH' || err?.code === 'BAD_REQUEST') {
      return res.status(400).json({ ok: false, reason: err?.code || err?.message || 'BAD_REQUEST' });
    }
    console.error('[cleanlemon] client/schedule-jobs:put', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

router.delete('/client/schedule-jobs/:id', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email || req.query?.email);
    const operatorId = String(req.body?.operatorId || req.query?.operatorId || '').trim();
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    if (!jwtVerified && !operatorId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL_OR_OPERATOR' });
    }
    const clientdetailId = await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: jwtVerified,
    });
    const groupId = String(req.body?.groupId || req.query?.groupId || '').trim();
    const out = await svc.deleteClientPortalScheduleJob({
      clientdetailId,
      operatorId,
      scheduleId: req.params.id,
      groupId: groupId || undefined,
      loginEmail: email,
    });
    return res.json(out);
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') {
      return res.status(409).json({ ok: false, reason: err.code });
    }
    if (
      err?.code === 'PROPERTY_OPERATOR_MISMATCH' ||
      err?.code === 'NOT_FOUND' ||
      err?.code === 'MISSING_IDS' ||
      err?.code === 'GROUP_PROPERTY_MISMATCH'
    ) {
      return res.status(400).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'GROUP_PERMISSION_DENIED' || err?.code === 'GROUP_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] client/schedule-jobs:delete', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

router.get('/client/damage-reports', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.query?.email || req.body?.email);
    const operatorId = String(req.query?.operatorId || req.body?.operatorId || '').trim();
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    if (!jwtVerified && !operatorId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL_OR_OPERATOR' });
    }
    /** Do not auto-create `cln_clientdetail` on read — that UUID would not match properties bound to the real B2B client (e.g. Antlerzone). */
    const clientdetailId = await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: false,
    });
    const items = await svc.listClientPortalDamageReports({
      clientdetailId,
      operatorId,
      limit: req.query?.limit,
      loginEmail: email,
    });
    return res.json({ ok: true, items });
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') {
      return res.status(409).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] client/damage-reports:get', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

router.post('/client/damage-reports/:id/acknowledge', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email);
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    if (!jwtVerified && !operatorId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL_OR_OPERATOR' });
    }
    const clientdetailId = await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: false,
    });
    const reportId = String(req.params.id || '').trim();
    const out = await svc.acknowledgeClientPortalDamageReport({
      clientdetailId,
      operatorId,
      reportId,
      acknowledgedByEmail: email,
      loginEmail: email,
    });
    return res.json(out);
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') {
      return res.status(409).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'MISSING_IDS') return res.status(400).json({ ok: false, reason: err.code });
    if (err?.code === 'REPORT_NOT_FOUND') return res.status(404).json({ ok: false, reason: err.code });
    if (err?.code === 'REPORT_ACCESS_DENIED') return res.status(403).json({ ok: false, reason: err.code });
    if (err?.code === 'DAMAGE_REPORT_TABLE_MISSING') {
      return res.status(503).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] client/damage-reports:acknowledge', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

router.post('/client/property-link-requests/:id/decide', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email);
    const operatorId = String(req.body?.operatorId || '').trim();
    const decision = String(req.body?.decision || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    if (!jwtVerified && !operatorId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL_OR_OPERATOR' });
    }
    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({ ok: false, reason: 'INVALID_DECISION' });
    }
    const clientdetailId = await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: jwtVerified,
    });
    const rid = String(req.params.id || '').trim();
    const pool = require('../../config/db');
    const [[row]] = await pool.query('SELECT * FROM cln_property_link_request WHERE id = ? LIMIT 1', [rid]);
    if (!row) return res.status(404).json({ ok: false, reason: 'REQUEST_NOT_FOUND' });
    if (String(row.kind) !== plr.KIND_OP_CLIENT) {
      return res.status(403).json({ ok: false, reason: 'WRONG_REQUEST_KIND' });
    }
    if (String(row.clientdetail_id) !== String(clientdetailId)) {
      return res.status(403).json({ ok: false, reason: 'ACCESS_DENIED' });
    }
    if (decision === 'approve') {
      await plr.approvePropertyLinkRequest({
        requestId: rid,
        decidedByEmail: email,
        getClnAccountProviderForOperator: svc.getClnAccountProviderForOperator,
      });
    } else {
      await plr.rejectPropertyLinkRequest({
        requestId: rid,
        decidedByEmail: email,
        remarks: req.body?.remarks,
      });
    }
    return res.json({ ok: true });
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'REQUEST_NOT_FOUND' || err?.code === 'REQUEST_NOT_PENDING') {
      return res.status(400).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] client/property-link-requests/:id/decide', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

/** Operator — list property link requests by status, or `counts=1` for tab badges. */
router.get('/operator/property-link-requests', async (req, res) => {
  try {
    const operatorId = String(req.query?.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const kind = String(req.query?.kind || '').trim() || null;
    if (String(req.query?.counts || '').trim() === '1') {
      const counts = await plr.countPropertyLinkRequestsForOperator(operatorId, { kind });
      return res.json({ ok: true, counts });
    }
    const status = String(req.query?.status || 'pending').trim();
    const limitRaw = req.query?.limit;
    const limit =
      limitRaw != null && String(limitRaw).trim() !== ''
        ? Number.parseInt(String(limitRaw), 10)
        : undefined;
    const items = await plr.listPropertyLinkRequestsForOperator(operatorId, { status, kind, limit });
    return res.json({ ok: true, items });
  } catch (err) {
    console.error('[cleanlemon] operator/property-link-requests:get', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

/** Operator — bulk approve/reject pending `client_requests_operator` rows. */
router.post('/operator/property-link-requests/bulk-decide', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    const decision = String(req.body?.decision || '').trim().toLowerCase();
    const requestIds = Array.isArray(req.body?.requestIds) ? req.body.requestIds : [];
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({ ok: false, reason: 'INVALID_DECISION' });
    }
    if (!requestIds.length) return res.status(400).json({ ok: false, reason: 'MISSING_REQUEST_IDS' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const email = gate.email;
    const pool = require('../../config/db');
    const results = [];
    for (const rawId of requestIds) {
      const rid = String(rawId || '').trim();
      if (!rid) continue;
      try {
        const [[row]] = await pool.query('SELECT * FROM cln_property_link_request WHERE id = ? LIMIT 1', [rid]);
        if (!row) {
          results.push({ id: rid, ok: false, reason: 'REQUEST_NOT_FOUND' });
          continue;
        }
        if (String(row.kind) !== plr.KIND_CLIENT_OP) {
          results.push({ id: rid, ok: false, reason: 'WRONG_REQUEST_KIND' });
          continue;
        }
        if (String(row.operator_id) !== String(operatorId)) {
          results.push({ id: rid, ok: false, reason: 'ACCESS_DENIED' });
          continue;
        }
        if (String(row.status) !== 'pending') {
          results.push({ id: rid, ok: false, reason: 'REQUEST_NOT_PENDING' });
          continue;
        }
        if (decision === 'approve') {
          await plr.approvePropertyLinkRequest({
            requestId: rid,
            decidedByEmail: email,
            getClnAccountProviderForOperator: svc.getClnAccountProviderForOperator,
          });
        } else {
          await plr.rejectPropertyLinkRequest({
            requestId: rid,
            decidedByEmail: email,
            remarks: req.body?.remarks,
          });
        }
        results.push({ id: rid, ok: true });
      } catch (e) {
        results.push({ id: rid, ok: false, reason: e?.code || e?.message || 'ERROR' });
      }
    }
    const succeeded = results.filter((r) => r.ok).length;
    return res.json({ ok: true, succeeded, results });
  } catch (err) {
    if (err?.code === 'OPERATOR_ACCESS_DENIED' || err?.code === 'OPERATORDETAIL_REQUIRED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] operator/property-link-requests:bulk-decide', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

/** Operator — approve or reject client_requests_operator (client picked operator; operator decides). */
router.post('/operator/property-link-requests/:id/decide', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    const decision = String(req.body?.decision || '').trim().toLowerCase();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({ ok: false, reason: 'INVALID_DECISION' });
    }
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const email = gate.email;
    const rid = String(req.params.id || '').trim();
    const pool = require('../../config/db');
    const [[row]] = await pool.query('SELECT * FROM cln_property_link_request WHERE id = ? LIMIT 1', [rid]);
    if (!row) return res.status(404).json({ ok: false, reason: 'REQUEST_NOT_FOUND' });
    if (String(row.kind) !== plr.KIND_CLIENT_OP) {
      return res.status(403).json({ ok: false, reason: 'WRONG_REQUEST_KIND' });
    }
    if (String(row.operator_id) !== String(operatorId)) {
      return res.status(403).json({ ok: false, reason: 'ACCESS_DENIED' });
    }
    if (decision === 'approve') {
      await plr.approvePropertyLinkRequest({
        requestId: rid,
        decidedByEmail: email,
        getClnAccountProviderForOperator: svc.getClnAccountProviderForOperator,
      });
    } else {
      await plr.rejectPropertyLinkRequest({
        requestId: rid,
        decidedByEmail: email,
        remarks: req.body?.remarks,
      });
    }
    return res.json({ ok: true });
  } catch (err) {
    if (err?.code === 'OPERATOR_ACCESS_DENIED' || err?.code === 'OPERATORDETAIL_REQUIRED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'REQUEST_NOT_FOUND' || err?.code === 'REQUEST_NOT_PENDING') {
      return res.status(400).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] operator/property-link-requests/:id/decide', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

/** B2B client portal — third-party integration API key (one per operator; get-or-create). */
router.post('/client/integration-api-key', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email);
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    if (!jwtVerified && !operatorId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL_OR_OPERATOR' });
    }
    const clientdetailId = await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: jwtVerified,
    });
    const result = await clnInt.getOrCreateThirdPartyIntegrationApiKeyClnClientdetail(clientdetailId);
    return res.json(result);
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') {
      return res.status(409).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] client/integration-api-key', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

router.post('/client/integration-api-key/rotate', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email);
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    if (!jwtVerified && !operatorId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL_OR_OPERATOR' });
    }
    const clientdetailId = await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: jwtVerified,
    });
    const result = await clnInt.rotateThirdPartyIntegrationApiKeyClnClientdetail(clientdetailId);
    return res.json(result);
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') {
      return res.status(409).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] client/integration-api-key/rotate', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

router.get('/employee/attendance', async (req, res) => {
  try {
    const email = String(req.query.email || '').trim();
    if (!email) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    const operatorId = String(req.query.operatorId || '').trim();
    const items = await svc.listEmployeeAttendanceByEmail(email, operatorId);
    return res.json({ ok: true, items });
  } catch (err) {
    console.error('[cleanlemon] employee/attendance:get', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/employee/attendance/check-in', async (req, res) => {
  try {
    await svc.employeeCheckIn(req.body || {});
    return res.json({ ok: true });
  } catch (err) {
    if (err?.code === 'MISSING_OPERATOR_ID') {
      return res.status(400).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'MISSING_EMAIL_OR_DATE') {
      return res.status(400).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] employee/attendance:check-in', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/employee/attendance/check-out', async (req, res) => {
  try {
    await svc.employeeCheckOut(req.body || {});
    return res.json({ ok: true });
  } catch (err) {
    if (err?.code === 'MISSING_OPERATOR_ID') {
      return res.status(400).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'MISSING_EMAIL_OR_DATE') {
      return res.status(400).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] employee/attendance:check-out', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/employee/invites', async (req, res) => {
  try {
    const email = String(req.query.email || '').trim();
    const name = String(req.query.name || '').trim();
    if (!email && !name) return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL_OR_NAME' });
    const items = await svc.listEmployeeInvitesByIdentity({ email, name });
    return res.json({ ok: true, items });
  } catch (err) {
    console.error('[cleanlemon] employee/invites:get', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/properties', async (req, res) => {
  try {
    const limit = req.query.limit;
    const offset = req.query.offset;
    const items = await svc.listProperties({ limit, offset });
    res.json({ ok: true, items });
  } catch (err) {
    console.error('[cleanlemon] properties', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/schedules', async (req, res) => {
  try {
    const limit = req.query.limit;
    const offset = req.query.offset;
    const items = await svc.listSchedules({ limit, offset });
    res.json({ ok: true, items });
  } catch (err) {
    console.error('[cleanlemon] schedules', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/pricing-config', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || '').trim();
    if (!operatorId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    }
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const config = await svc.getPricingConfig(operatorId);
    res.json({ ok: true, config: config || null });
  } catch (err) {
    console.error('[cleanlemon] pricing-config:get', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.put('/pricing-config', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    const config = req.body?.config;
    if (!operatorId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    }
    if (!config || typeof config !== 'object') {
      return res.status(400).json({ ok: false, reason: 'INVALID_CONFIG' });
    }
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    await svc.upsertPricingConfig(operatorId, config);
    res.json({ ok: true });
  } catch (err) {
    console.error('[cleanlemon] pricing-config:put', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/operator/dashboard', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || '').trim();
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const body = await svc.operatorDashboard({ operatorId: gate.operatorId });
    res.json({ ok: true, ...body });
  } catch (err) {
    console.error('[cleanlemon] operator/dashboard', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/operator/properties', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || '').trim();
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const includeArchived =
      req.query.includeArchived === '1' ||
      req.query.includeArchived === 'true' ||
      req.query.includeArchived === 'yes';
    const body = await svc.listOperatorProperties({
      limit: req.query.limit,
      offset: req.query.offset,
      operatorId,
      includeArchived,
    });
    res.json({ ok: true, items: body });
  } catch (err) {
    console.error('[cleanlemon] operator/properties:get', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

/** Single property — Coliving security credentials for operator edit dialog (matches client portal shape). */
router.get('/operator/properties/:id', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || '').trim();
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const property = await svc.getOperatorPropertyDetail({
      propertyId: req.params.id,
      operatorId,
    });
    res.json({ ok: true, property });
  } catch (err) {
    console.error('[cleanlemon] operator/properties/:id:get', err);
    if (err && err.code === 'MISSING_IDS') {
      return res.status(400).json({ ok: false, reason: 'MISSING_IDS' });
    }
    if (err && err.code === 'NOT_FOUND') {
      return res.status(404).json({ ok: false, reason: 'NOT_FOUND' });
    }
    if (err && err.code === 'OPERATOR_MISMATCH') {
      return res.status(403).json({ ok: false, reason: 'OPERATOR_MISMATCH' });
    }
    if (err && err.code === 'UNSUPPORTED') {
      return res.status(501).json({ ok: false, reason: 'UNSUPPORTED' });
    }
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/operator/property-names', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || '').trim();
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const items = await svc.listOperatorDistinctPropertyNames({ operatorId });
    res.json({ ok: true, items });
  } catch (err) {
    console.error('[cleanlemon] operator/property-names:get', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

/** Distinct building names for apartment combobox — scoped to one operator (`operatorId` required). */
router.get('/operator/property-names-global', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || '').trim();
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const q = String(req.query.q || '').trim();
    const limit = req.query.limit;
    const items = await svc.listGlobalDistinctPropertyNames({ q, limit, operatorId: gate.operatorId });
    res.json({ ok: true, items });
  } catch (err) {
    console.error('[cleanlemon] operator/property-names-global:get', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

/** Most-used address + Waze + Google Maps for a `property_name` within one operator (`operatorId` required). */
router.get('/operator/property-name-defaults', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || '').trim();
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const name = String(req.query.name || '').trim();
    const body = await svc.getGlobalPropertyNameDefaults({ propertyName: name, operatorId: gate.operatorId });
    res.json({ ok: true, ...body });
  } catch (err) {
    console.error('[cleanlemon] operator/property-name-defaults:get', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

/** OpenStreetMap Nominatim address search (server proxy; `countrycodes` default my). */
router.get('/operator/address-search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const limit = req.query.limit;
    const countrycodes = req.query.countrycodes != null ? String(req.query.countrycodes) : 'my';
    const propertyName = String(req.query.propertyName || '').trim();
    const items = await svc.searchAddressPlaces({ q, limit, countrycodes, propertyName });
    res.json({ ok: true, items });
  } catch (err) {
    console.error('[cleanlemon] operator/address-search:get', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

/** `cln_clientdetail` rows linked to this operator via `cln_client_operator` (property binding picker). */
router.get('/operator/linked-clientdetails', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || '').trim();
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const items = await svc.listOperatorLinkedClientdetails({ operatorId });
    res.json({ ok: true, items });
  } catch (err) {
    console.error('[cleanlemon] operator/linked-clientdetails:get', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/operator/lookup', async (req, res) => {
  try {
    if (!employeePortalEmailStrict(req)) {
      return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    }
    const q = String(req.query.q || '').trim();
    const limit = req.query.limit;
    const items = await svc.listOperatorLookup({ q, limit });
    const enriched = await clnReview.enrichOperatorLookupItemsWithReviewStats(items);
    res.json({ ok: true, items: enriched });
  } catch (err) {
    console.error('[cleanlemon] operator/lookup:get', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

/** Portal JWT — create cln_review (client_to_operator | operator_to_client | operator_to_staff). */
router.post('/portal/reviews', async (req, res) => {
  try {
    const payload = portalJwtPayload(req);
    if (!payload?.email) {
      return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    }
    const out = await clnReview.createClnReview({
      jwtEmail: payload.email,
      cleanlemonsJwt: payload.cleanlemons,
      body: req.body || {},
    });
    if (!out?.ok) {
      const st =
        out?.reason === 'NOT_YOUR_PROPERTY' || out?.reason === 'OPERATOR_MISMATCH'
          ? 403
          : out?.reason === 'SCHEDULE_NOT_FOUND' || out?.reason === 'OPERATOR_NOT_FOUND'
            ? 404
            : 400;
      return res.status(st).json(out);
    }
    res.json(out);
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, reason: 'DUPLICATE_REVIEW' });
    }
    console.error('[cleanlemon] portal/reviews:post', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/operator/properties', async (req, res) => {
  try {
    const b = req.body || {};
    const oid = String(b.operatorId || b.operator_id || '').trim();
    const gate = await requireOperatorStaffForPortal(req, res, oid);
    if (!gate) return;
    const out = await svc.createOperatorProperty(b);
    const id = out && typeof out === 'object' ? out.id : out;
    res.json({
      ok: true,
      id,
      deferClientBinding: !!(out && out.deferClientBinding),
      linkRequestId: out && out.linkRequestId ? out.linkRequestId : undefined,
    });
  } catch (err) {
    console.error('[cleanlemon] operator/properties:post', err);
    if (err && err.code === 'CLIENTDETAIL_NOT_LINKED') {
      return res.status(400).json({ ok: false, reason: 'CLIENTDETAIL_NOT_LINKED' });
    }
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.put('/operator/properties/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const oid = String(b.operatorId || b.operator_id || '').trim();
    const gate = await requireOperatorStaffForPortal(req, res, oid);
    if (!gate) return;
    await svc.updateOperatorProperty(req.params.id, b);
    res.json({ ok: true });
  } catch (err) {
    console.error('[cleanlemon] operator/properties:put', err);
    if (err && err.code === 'CLIENTDETAIL_NOT_LINKED') {
      return res.status(400).json({ ok: false, reason: 'CLIENTDETAIL_NOT_LINKED' });
    }
    if (err && err.code === 'NOT_CLIENT_PORTAL_OWNED') {
      return res.status(400).json({ ok: false, reason: 'NOT_CLIENT_PORTAL_OWNED' });
    }
    if (err && err.code === 'OPERATOR_MISMATCH') {
      return res.status(403).json({ ok: false, reason: 'OPERATOR_MISMATCH' });
    }
    if (err && err.code === 'PROPERTY_DELETE_BLOCKED') {
      return res.status(409).json({ ok: false, reason: 'PROPERTY_DELETE_BLOCKED' });
    }
    if (err && err.code === 'UNSUPPORTED') {
      return res.status(501).json({ ok: false, reason: 'UNSUPPORTED' });
    }
    if (err && err.code === 'TRANSFER_REQUIRES_BOUND_CLIENT') {
      return res.status(400).json({ ok: false, reason: 'TRANSFER_REQUIRES_BOUND_CLIENT' });
    }
    if (err && err.code === 'ALREADY_CLIENT_OWNED') {
      return res.status(400).json({ ok: false, reason: 'ALREADY_CLIENT_OWNED' });
    }
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.delete('/operator/properties/:id', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || '').trim();
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    await svc.deleteOperatorProperty(req.params.id, { operatorId });
    res.json({ ok: true });
  } catch (err) {
    console.error('[cleanlemon] operator/properties:delete', err);
    if (err && err.code === 'OPERATOR_MISMATCH') {
      return res.status(403).json({ ok: false, reason: 'OPERATOR_MISMATCH' });
    }
    if (err && err.code === 'CLIENT_PORTAL_OWNED') {
      return res.status(400).json({ ok: false, reason: 'CLIENT_PORTAL_OWNED' });
    }
    if (err && err.code === 'PROPERTY_NOT_ARCHIVED') {
      return res.status(400).json({ ok: false, reason: 'PROPERTY_NOT_ARCHIVED' });
    }
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

/** Operator portal — property groups (independent of client `cln_property_group`). */
router.post('/operator/property-groups/list', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const items = await clnOpPropGroup.listGroupsForOperatorPortal(operatorId);
    return res.json({ ok: true, items });
  } catch (err) {
    console.error('[cleanlemon] operator/property-groups/list', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

router.post('/operator/property-groups/create', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    const name = String(req.body?.name || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const group = await clnOpPropGroup.createOperatorPropertyGroup({ operatorId, name });
    return res.json({ ok: true, group });
  } catch (err) {
    if (err?.code === 'MISSING_FIELDS' || err?.code === 'GROUP_FEATURE_UNAVAILABLE') {
      return res.status(400).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] operator/property-groups/create', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

router.post('/operator/property-groups/detail', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    const groupId = String(req.body?.groupId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    if (!groupId) return res.status(400).json({ ok: false, reason: 'MISSING_GROUP_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const group = await clnOpPropGroup.getGroupDetailForOperator({ operatorId, groupId });
    return res.json({ ok: true, group });
  } catch (err) {
    if (err?.code === 'GROUP_NOT_FOUND' || err?.code === 'MISSING_FIELDS') {
      return res.status(404).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] operator/property-groups/detail', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

router.post('/operator/property-groups/add-properties', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    const groupId = String(req.body?.groupId || '').trim();
    const propertyIds = Array.isArray(req.body?.propertyIds) ? req.body.propertyIds : [];
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    if (!groupId) return res.status(400).json({ ok: false, reason: 'MISSING_GROUP_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    await clnOpPropGroup.addPropertiesToOperatorGroup({ operatorId, groupId, propertyIds });
    return res.json({ ok: true });
  } catch (err) {
    if (
      err?.code === 'MISSING_FIELDS' ||
      err?.code === 'GROUP_FEATURE_UNAVAILABLE' ||
      err?.code === 'OPERATOR_PROPERTY_MISMATCH'
    ) {
      return res.status(400).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'GROUP_NOT_FOUND') {
      return res.status(404).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] operator/property-groups/add-properties', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

router.post('/operator/property-groups/remove-property', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    const groupId = String(req.body?.groupId || '').trim();
    const propertyId = String(req.body?.propertyId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    if (!groupId) return res.status(400).json({ ok: false, reason: 'MISSING_GROUP_ID' });
    if (!propertyId) return res.status(400).json({ ok: false, reason: 'MISSING_PROPERTY_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    await clnOpPropGroup.removePropertyFromOperatorGroup({ operatorId, groupId, propertyId });
    return res.json({ ok: true });
  } catch (err) {
    if (err?.code === 'MISSING_FIELDS' || err?.code === 'GROUP_FEATURE_UNAVAILABLE') {
      return res.status(400).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'GROUP_NOT_FOUND') {
      return res.status(404).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] operator/property-groups/remove-property', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

router.post('/operator/property-groups/delete', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    const groupId = String(req.body?.groupId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    if (!groupId) return res.status(400).json({ ok: false, reason: 'MISSING_GROUP_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    await clnOpPropGroup.deleteOperatorPropertyGroup({ operatorId, groupId });
    return res.json({ ok: true });
  } catch (err) {
    if (err?.code === 'MISSING_FIELDS' || err?.code === 'GROUP_FEATURE_UNAVAILABLE') {
      return res.status(400).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'GROUP_NOT_FOUND') {
      return res.status(404).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] operator/property-groups/delete', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

router.get('/operator/invoices', async (req, res) => {
  try {
    const operatorId = String(req.query?.operatorId || req.query?.operator_id || '').trim();
    if (!operatorId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    }
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const items = await svc.listOperatorInvoices({ limit: req.query.limit, operatorId });
    res.json({ ok: true, items });
  } catch (err) {
    console.error('[cleanlemon] operator/invoices:get', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.put('/operator/invoices/:id/status', async (req, res) => {
  try {
    const status = String(req.body?.status || '').trim();
    if (!status) return res.status(400).json({ ok: false, reason: 'MISSING_STATUS' });
    const operatorId = String(req.body?.operatorId || req.query?.operatorId || '').trim();
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    await svc.updateInvoiceStatus(req.params.id, status, {
      operatorId,
      paymentMethod: req.body?.paymentMethod,
      paymentDate: req.body?.paymentDate,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[cleanlemon] operator/invoices:status', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

/** Operator — payment reminder to client bill-to email via CLEANLEMON_SMTP_* (server). */
router.post('/operator/invoices/:id/send-payment-reminder', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || req.query?.operatorId || '').trim();
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const out = await svc.sendOperatorInvoicePaymentReminder(req, {
      invoiceId: req.params.id,
      operatorId,
    });
    if (!out?.ok) {
      const reason = String(out?.reason || 'FAILED');
      if (['MISSING_OPERATOR_ID', 'MISSING_INVOICE_ID', 'MISSING_CLIENT_EMAIL'].includes(reason)) {
        return res.status(400).json({ ok: false, reason });
      }
      if (['INVOICE_NOT_FOUND', 'FORBIDDEN_OPERATOR'].includes(reason)) {
        return res.status(404).json({ ok: false, reason });
      }
      if (['INVOICE_ALREADY_PAID', 'REMINDER_NOT_APPLICABLE'].includes(reason)) {
        return res.status(400).json({ ok: false, reason });
      }
      if (reason === 'SMTP_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, reason });
      }
      return res.status(502).json({ ok: false, reason });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[cleanlemon] operator/invoices:send-payment-reminder', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

/** Operator — client invoice payments (Stripe / manual) for Approval → Payment tab. */
router.get('/operator/payment-queue', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const out = await svc.listOperatorClientPaymentQueue({
      operatorId,
      limit: req.query.limit != null ? Number(req.query.limit) : undefined,
    });
    return res.json({ ok: true, items: out.items });
  } catch (err) {
    console.error('[cleanlemon] operator/payment-queue:get', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

router.post('/operator/payment-queue/:paymentId/acknowledge', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || req.query.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const out = await svc.acknowledgeOperatorClientPayment({
      operatorId,
      paymentId: req.params.paymentId,
    });
    if (!out.ok) return res.status(400).json({ ok: false, reason: out.reason || 'FAILED' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[cleanlemon] operator/payment-queue:ack', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

router.post('/operator/payment-queue/:paymentId/reject-client-receipt', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || req.query.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const out = await svc.rejectOperatorClientPortalReceipt({
      operatorId,
      paymentId: req.params.paymentId,
    });
    if (!out.ok) {
      const st = out.reason === 'NOT_FOUND' ? 404 : 400;
      return res.status(st).json({ ok: false, reason: out.reason || 'FAILED' });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[cleanlemon] operator/payment-queue:reject-client-receipt', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

router.post('/operator/payment-queue/reject-client-receipt-batch', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || req.query.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const receiptBatchId = req.body?.receiptBatchId != null ? String(req.body.receiptBatchId).trim() : '';
    const paymentIds = Array.isArray(req.body?.paymentIds) ? req.body.paymentIds : [];
    const out = await svc.rejectOperatorClientPortalReceiptBatch({
      operatorId,
      receiptBatchId: receiptBatchId || undefined,
      paymentIds,
    });
    if (!out.ok) {
      const st = out.reason === 'NOT_FOUND' ? 404 : 400;
      return res.status(st).json({ ok: false, reason: out.reason || 'FAILED' });
    }
    return res.json({ ok: true, deleted: out.deleted });
  } catch (err) {
    console.error('[cleanlemon] operator/payment-queue:reject-client-receipt-batch', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

router.delete('/operator/invoices/:id', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || '').trim();
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    await svc.deleteInvoice(req.params.id, operatorId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[cleanlemon] operator/invoices:delete', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/operator/invoices', async (req, res) => {
  try {
    const b = req.body || {};
    const oid = String(b.operatorId || b.operator_id || '').trim();
    const gate = await requireOperatorStaffForPortal(req, res, oid);
    if (!gate) return;
    const out = await svc.createOperatorInvoice(b);
    const id = typeof out === 'object' && out?.id ? out.id : out;
    const invoiceNo = typeof out === 'object' && out?.invoiceNo != null ? out.invoiceNo : undefined;
    const pdfUrl =
      typeof out === 'object' && out?.pdfUrl != null && String(out.pdfUrl).trim() !== ''
        ? String(out.pdfUrl).trim()
        : undefined;
    const accountingMeta = typeof out === 'object' && out?.accountingMeta != null ? out.accountingMeta : undefined;
    res.json({
      ok: true,
      id,
      ...(invoiceNo != null ? { invoiceNo } : {}),
      ...(pdfUrl ? { pdfUrl } : {}),
      ...(accountingMeta ? { accountingMeta } : {})
    });
  } catch (err) {
    if (isOperatorInvoiceClientError(err)) {
      const body400 = {
        ok: false,
        code: String(err?.code || err?.message || 'FAILED').slice(0, 120),
        reason: String(err?.message || 'FAILED'),
        ...(err?.detail ? { detail: err.detail } : {}),
      };
      console.warn('[cleanlemon] operator/invoices:post → 400', JSON.stringify(body400));
      return res.status(400).json(body400);
    }
    console.error('[cleanlemon] operator/invoices:post', err);
    if (isTransientNetworkError(err)) {
      return res.status(503).json({
        ok: false,
        code: 'UPSTREAM_UNAVAILABLE',
        reason:
          'Connection to accounting (Bukku/Xero) or database was interrupted. Check API host can reach MySQL and api.bukku.my, then retry.',
        detail: String(err?.message || '').slice(0, 300),
      });
    }
    const reason500 =
      (err && typeof err === 'object' && err.message != null && String(err.message).trim() !== ''
        ? String(err.message)
        : typeof err === 'string' && err.trim() !== ''
          ? err
          : '') || 'DB_ERROR';
    res.status(500).json({
      ok: false,
      code: String(err?.code || 'SERVER_ERROR').slice(0, 120),
      reason: reason500.slice(0, 2000),
    });
  }
});

router.put('/operator/invoices/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const oid = String(b.operatorId || b.operator_id || '').trim();
    const gate = await requireOperatorStaffForPortal(req, res, oid);
    if (!gate) return;
    await svc.updateOperatorInvoice(req.params.id, b);
    res.json({ ok: true });
  } catch (err) {
    console.error('[cleanlemon] operator/invoices:put', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/operator/invoice-form-options', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || '').trim();
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const body = await svc.listOperatorInvoiceFormOptions(operatorId);
    res.json({ ok: true, ...body });
  } catch (err) {
    console.error('[cleanlemon] operator/invoice-form-options:get', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/operator/agreements', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || '').trim();
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const items = await svc.listAgreements(operatorId);
    res.json({ ok: true, items });
  } catch (err) {
    console.error('[cleanlemon] operator/agreements:get', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/operator/agreements', async (req, res) => {
  try {
    const b = req.body || {};
    const oid = String(b.operatorId || b.operator_id || '').trim();
    const gate = await requireOperatorStaffForPortal(req, res, oid);
    if (!gate) return;
    const id = await svc.createAgreement(b);
    res.json({ ok: true, id });
  } catch (err) {
    const msg = String(err?.message || '');
    console.error('[cleanlemon] operator/agreements:post', err);
    if (msg === 'TEMPLATE_NOT_FOUND') {
      return res.status(404).json({ ok: false, reason: 'TEMPLATE_NOT_FOUND' });
    }
    if (msg === 'TEMPLATE_FORBIDDEN') {
      return res.status(403).json({ ok: false, reason: 'TEMPLATE_FORBIDDEN' });
    }
    if (msg === 'GOOGLE_DRIVE_REQUIRED') {
      return res.status(400).json({ ok: false, reason: 'GOOGLE_DRIVE_REQUIRED' });
    }
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

/** Re-generate final merged PDF + upload to template Drive folder (complete agreements only). */
router.post('/operator/agreements/:id/finalize-pdf', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!operatorId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    }
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const result = await svc.retryFinalizeClnOperatorAgreementPdf(operatorId, req.params.id);
    if (!result?.ok) {
      const r = String(result?.reason || '').toUpperCase();
      const code = r === 'NOT_FOUND' ? 404 : r === 'FORBIDDEN' ? 403 : 400;
      return res.status(code).json({ ok: false, reason: result.reason || 'FINALIZE_FAILED' });
    }
    res.json({ ok: true, finalAgreementUrl: result.finalAgreementUrl });
  } catch (err) {
    console.error('[cleanlemon] operator/agreements/:id/finalize-pdf', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.put('/operator/agreements/:id/sign', async (req, res) => {
  try {
    const { email } = clientPortalAuthFromRequest(req, req.body?.email);
    const payload = { ...(req.body || {}) };
    if (String(payload.signedFrom || '').trim() === 'client_portal') {
      if (!email) {
        return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
      }
      payload.portalClientEmail = email;
    }
    const result = await svc.signAgreement(req.params.id, payload);
    if (!result?.ok) {
      const code = result?.reason === 'AGREEMENT_NOT_FOUND' ? 404 : 400;
      return res.status(code).json({ ok: false, reason: result?.reason || 'SIGN_FAILED' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[cleanlemon] operator/agreements:sign', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

/** Operator portal — filled agreement PDF; sets hash_draft on first successful generation. */
router.post('/operator/agreements/:id/preview-pdf', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || req.query.operatorId || '').trim();
    if (!operatorId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    }
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const buffer = await svc.previewClnAgreementInstancePdfForOperator(operatorId, req.params.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="agreement-preview.pdf"');
    res.send(buffer);
  } catch (err) {
    const msg = String(err?.message || '');
    console.error('[cleanlemon] operator/agreements/:id/preview-pdf', err);
    if (msg === 'NOT_FOUND') return res.status(404).json({ ok: false, reason: 'NOT_FOUND' });
    if (msg === 'FORBIDDEN') return res.status(403).json({ ok: false, reason: 'FORBIDDEN' });
    if (msg === 'MISSING_TEMPLATE' || msg === 'INVALID_TEMPLATE_URL') {
      return res.status(400).json({ ok: false, reason: msg });
    }
    if (msg === 'GOOGLE_DRIVE_NOT_CONNECTED' || msg === 'GOOGLE_CREDENTIALS_NOT_CONFIGURED') {
      return res.status(503).json({ ok: false, reason: 'PDF_UNAVAILABLE' });
    }
    if (err?.code === 'ENOENT' || /ENOENT/i.test(msg)) {
      return res.status(503).json({ ok: false, reason: 'PDF_UNAVAILABLE' });
    }
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

/** Delete agreement when not finalized (no hash_final / final URL / complete). Body: { operatorId }. */
router.post('/operator/agreements/:id/delete', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!operatorId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    }
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const result = await svc.deleteClnOperatorAgreement(operatorId, req.params.id);
    if (!result?.ok) {
      const r = String(result?.reason || '').toUpperCase();
      const code = r === 'NOT_FOUND' ? 404 : 400;
      return res.status(code).json({ ok: false, reason: result.reason || 'DELETE_FAILED' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[cleanlemon] operator/agreements/:id/delete', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

/**
 * B2B client — list operator–client agreements for this login email (same auth pattern as `client/properties/list`).
 */
router.post('/client/agreements/list', async (req, res) => {
  try {
    const { email } = clientPortalAuthFromRequest(req, req.body?.email);
    if (!email) {
      return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    }
    const items = await svc.listAgreementsForClientPortal(email);
    res.json({ ok: true, items });
  } catch (err) {
    console.error('[cleanlemon] client/agreements/list', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/client/agreements/:id/preview-pdf', async (req, res) => {
  try {
    const { email } = clientPortalAuthFromRequest(req, req.body?.email);
    if (!email) {
      return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    }
    const buffer = await svc.previewClnAgreementInstancePdfForRecipient(req.params.id, email);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="agreement-preview.pdf"');
    res.send(buffer);
  } catch (err) {
    const msg = String(err?.message || '');
    if (msg === 'NOT_FOUND') {
      return res.status(404).json({ ok: false, reason: 'NOT_FOUND' });
    }
    if (msg === 'FORBIDDEN') {
      return res.status(403).json({ ok: false, reason: 'FORBIDDEN' });
    }
    if (msg === 'MISSING_TEMPLATE' || msg === 'INVALID_TEMPLATE_URL') {
      return res.status(400).json({ ok: false, reason: msg });
    }
    if (msg === 'GOOGLE_DRIVE_NOT_CONNECTED' || msg === 'GOOGLE_CREDENTIALS_NOT_CONFIGURED') {
      return res.status(503).json({ ok: false, reason: 'PDF_UNAVAILABLE' });
    }
    if (err?.code === 'ENOENT' || /ENOENT/i.test(msg)) {
      return res.status(503).json({ ok: false, reason: 'PDF_UNAVAILABLE' });
    }
    console.error('[cleanlemon] client/agreements/:id/preview-pdf', err);
    res.status(500).json({ ok: false, reason: err?.message || 'PDF_FAILED' });
  }
});

/** GET — one Word file: table column A = {{variable}}, column B = example (all operator–staff + operator–client keys). */
router.get('/operator/agreement-variables-reference.docx', async (req, res) => {
  try {
    const buffer = await svc.buildClnAgreementVariablesReferenceDocxBuffer();
    const filename = 'cleanlemons-agreement-variables-reference.docx';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('[cleanlemon] operator/agreement-variables-reference.docx', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DOCX_FAILED' });
  }
});

router.get('/operator/agreement-templates', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || '').trim();
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const items = await svc.listAgreementTemplates(operatorId);
    res.json({ ok: true, items });
  } catch (err) {
    console.error('[cleanlemon] operator/agreement-templates:get', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/operator/agreement-templates', async (req, res) => {
  try {
    const b = req.body || {};
    const oid = String(b.operatorId || b.operator_id || '').trim();
    const gate = await requireOperatorStaffForPortal(req, res, oid);
    if (!gate) return;
    const id = await svc.createAgreementTemplate(b);
    res.json({ ok: true, id });
  } catch (err) {
    const msg = String(err?.message || '');
    console.error('[cleanlemon] operator/agreement-templates:post', err);
    if (msg === 'MISSING_OPERATOR_ID') {
      return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    }
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

/** POST body: { operatorId?, templateId } — PDF binary; same generation path as Coliving agreementsetting preview (Node + Google). */
router.post('/operator/agreement-templates/preview-pdf', async (req, res) => {
  const body = req.body || {};
  const operatorId = String(body.operatorId || req.query?.operatorId || '').trim();
  const templateId = String(body.templateId || body.id || '').trim();
  try {
    if (!operatorId) {
      return res.status(400).json({
        ok: false,
        reason: 'MISSING_OPERATOR_ID',
        message: 'operatorId is required for template preview.',
      });
    }
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    if (!templateId) {
      return res.status(400).json({ ok: false, reason: 'NO_TEMPLATE_ID', message: 'templateId is required' });
    }
    const buffer = await svc.previewOperatorAgreementTemplatePdf(operatorId, templateId);
    const filename = `agreement-preview-${templateId.slice(0, 8)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    const msg = String(err?.message || '');
    console.error('[cleanlemon] operator/agreement-templates/preview-pdf', msg);
    if (msg === 'NOT_FOUND') {
      return res.status(404).json({ ok: false, reason: 'NOT_FOUND', message: 'Template not found' });
    }
    if (msg === 'MISSING_OPERATOR_ID') {
      return res.status(400).json({
        ok: false,
        reason: 'MISSING_OPERATOR_ID',
        message: 'operatorId is required for template preview.'
      });
    }
    if (msg === 'TEMPLATE_FORBIDDEN') {
      return res.status(403).json({
        ok: false,
        reason: 'TEMPLATE_FORBIDDEN',
        message: 'This template does not belong to the selected operator.'
      });
    }
    if (msg === 'MISSING_TEMPLATE_OR_FOLDER') {
      return res.status(400).json({
        ok: false,
        reason: 'MISSING_URLS',
        message: 'Add both Google Doc template URL and Drive folder URL for this template.'
      });
    }
    if (msg === 'GOOGLE_CREDENTIALS_NOT_CONFIGURED') {
      return res.status(400).json({
        ok: false,
        reason: 'GOOGLE_AUTH_REQUIRED',
        message: 'Connect Google Drive in Company Settings or configure GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_APPLICATION_CREDENTIALS.'
      });
    }
    if (msg.includes('missing template url') || msg.includes('missing folder url')) {
      return res.status(400).json({
        ok: false,
        reason: 'INVALID_URLS',
        message: 'Could not read Doc or folder ID from the pasted links.'
      });
    }
    if (msg === 'EMPTY_PDF') {
      return res.status(500).json({ ok: false, reason: 'EMPTY_PDF', message: 'Preview generation returned an empty PDF' });
    }
    return res.status(500).json({ ok: false, reason: 'PREVIEW_FAILED', message: msg || 'DB_ERROR' });
  }
});

router.get('/operator/kpi', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || '').trim();
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const items = await svc.listKpi(operatorId);
    res.json({ ok: true, items });
  } catch (err) {
    console.error('[cleanlemon] operator/kpi:get', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/operator/notifications', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || '').trim();
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const items = await svc.listNotifications(operatorId);
    res.json({ ok: true, items });
  } catch (err) {
    console.error('[cleanlemon] operator/notifications:get', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.put('/operator/notifications/:id/read', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || '').trim();
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    await svc.markNotificationRead(req.params.id, gate.operatorId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[cleanlemon] operator/notifications:read', err);
    if (err && err.code === 'NOT_FOUND') {
      return res.status(404).json({ ok: false, reason: 'NOT_FOUND' });
    }
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.delete('/operator/notifications/:id', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || '').trim();
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    await svc.dismissNotification(req.params.id, gate.operatorId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[cleanlemon] operator/notifications:delete', err);
    if (err && err.code === 'NOT_FOUND') {
      return res.status(404).json({ ok: false, reason: 'NOT_FOUND' });
    }
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/operator/settings', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || '').trim();
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const settings = await svc.getOperatorSettings(operatorId);
    res.json({ ok: true, settings: settings || {} });
  } catch (err) {
    console.error('[cleanlemon] operator/settings:get', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/operator/setup-status', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || '').trim();
    const email = String(req.query.email || '').trim();
    const jwtEmail = employeePortalEmailStrict(req);
    if (!jwtEmail || jwtEmail !== String(email || '').trim().toLowerCase()) {
      return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    }
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const out = await svc.getOperatorPortalSetupStatus(operatorId, email);
    if (!out.ok) {
      return res.status(400).json(out);
    }
    return res.json(out);
  } catch (err) {
    console.error('[cleanlemon] operator/setup-status', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/operator/subscription', async (req, res) => {
  try {
    const jwtEmail = employeePortalEmailStrict(req);
    if (!jwtEmail) {
      return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    }
    const operatorId = String(req.query.operatorId || '').trim();
    const email = String(req.query.email || '').trim().toLowerCase();
    if (email && email !== jwtEmail) {
      return res.status(403).json({ ok: false, reason: 'EMAIL_MISMATCH' });
    }
    if (operatorId) {
      const gate = await requireOperatorStaffForPortal(req, res, operatorId);
      if (!gate) return;
    }
    const item = await svc.getOperatorSubscription(operatorId, email || jwtEmail);
    return res.json({ ok: true, item: item || null });
  } catch (err) {
    if (err?.code === 'MISSING_OPERATOR_ID_OR_EMAIL') {
      return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID_OR_EMAIL' });
    }
    console.error('[cleanlemon] operator/subscription:get', err);
    /** Local / partial schema: avoid 500 so portal cards degrade like “no subscription” instead of breaking the page. */
    return res.status(200).json({
      ok: false,
      item: null,
      reason: err?.message || 'SUBSCRIPTION_LOOKUP_FAILED',
    });
  }
});

const PORTAL_OPERATOR_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** SaaS platform invoices (Bukku): `cln_pricingplanlog` + `cln_addonlog`. Resolves real operator id from email when JWT sends a non-UUID placeholder (e.g. op_demo_001). */
router.get('/operator/saas-billing-history', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || '').trim();
    const email = String(req.query.email || '').trim().toLowerCase();
    if (!operatorId && !email) {
      return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID_OR_EMAIL' });
    }
    let billingOperatorId = '';
    if (PORTAL_OPERATOR_UUID_RE.test(operatorId)) {
      const sub = await svc.getOperatorSubscription(operatorId, email);
      if (sub?.operatorId) billingOperatorId = String(sub.operatorId).trim();
    }
    if (!billingOperatorId && email) {
      const sub = await svc.getOperatorSubscription('', email);
      if (sub?.operatorId) billingOperatorId = String(sub.operatorId).trim();
    }
    if (!billingOperatorId && operatorId) {
      billingOperatorId = operatorId;
    }
    if (!billingOperatorId) {
      return res.json({ ok: true, items: [] });
    }
    const gate = await requireOperatorStaffForPortal(req, res, billingOperatorId);
    if (!gate) return;
    const items = await svc.listOperatorSaasBillingHistory(billingOperatorId);
    return res.json({ ok: true, items });
  } catch (err) {
    console.error('[cleanlemon] operator/saas-billing-history:get', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.put('/operator/settings', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!operatorId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    }
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const settings = req.body?.settings || {};
    await svc.upsertOperatorSettings(operatorId, settings);
    res.json({ ok: true });
  } catch (err) {
    const code = String(err?.code || '');
    if (
      code === 'SUBDOMAIN_REQUIRED' ||
      code === 'SUBDOMAIN_RESERVED' ||
      code === 'SUBDOMAIN_TAKEN' ||
      code === 'SUBDOMAIN_INVALID_FORMAT' ||
      code === 'SUBDOMAIN_TOO_LONG' ||
      code === 'PUBLIC_SUBDOMAIN_COLUMN_MISSING'
    ) {
      return res.status(400).json({ ok: false, reason: code });
    }
    console.error('[cleanlemon] operator/settings:put', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

/** Master operator: TAC to new company email → schedule +7 days (cln_operatordetail.email + portal_account). */
router.post('/operator/company-email-change/request', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email);
    if (!jwtVerified) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!operatorId || !email) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_OR_EMAIL' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const r = await clnOpCompanyEmail.requestClnOperatorCompanyEmailChange(email, req.body?.newEmail, operatorId, req);
    return res.json(r);
  } catch (err) {
    console.error('[cleanlemon] operator/company-email-change/request', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/operator/company-email-change/confirm', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email);
    if (!jwtVerified) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!operatorId || !email) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_OR_EMAIL' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const r = await clnOpCompanyEmail.confirmClnOperatorCompanyEmailChange(
      email,
      req.body?.newEmail,
      req.body?.code,
      operatorId,
      req
    );
    return res.json(r);
  } catch (err) {
    console.error('[cleanlemon] operator/company-email-change/confirm', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/operator/company-email-change/status', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email);
    if (!jwtVerified) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!operatorId || !email) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_OR_EMAIL' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const r = await clnOpCompanyEmail.getClnOperatorCompanyEmailChangeStatus(email, operatorId);
    return res.json(r);
  } catch (err) {
    console.error('[cleanlemon] operator/company-email-change/status', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/operator/company-email-change/cancel', async (req, res) => {
  try {
    const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email);
    if (!jwtVerified) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!operatorId || !email) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_OR_EMAIL' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const r = await clnOpCompanyEmail.cancelClnOperatorCompanyEmailChange(email, operatorId);
    return res.json(r);
  } catch (err) {
    console.error('[cleanlemon] operator/company-email-change/cancel', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

/** Bukku: secret + subdomain (same as Coliving companysetting). */
router.post('/operator/bukku-connect', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    await clnInt.bukkuConnect(operatorId, {
      token: req.body?.token,
      subdomain: req.body?.subdomain,
      einvoice: req.body?.einvoice
    });
    res.json({ ok: true });
  } catch (err) {
    const msg = err?.message || 'DB_ERROR';
    if (msg === 'TOKEN_AND_SUBDOMAIN_REQUIRED') {
      return res.status(400).json({ ok: false, reason: msg });
    }
    console.error('[cleanlemon] operator/bukku-connect', err);
    res.status(500).json({ ok: false, reason: msg });
  }
});

router.get('/operator/bukku-credentials', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const data = await clnInt.getBukkuCredentials(operatorId);
    res.json(data);
  } catch (err) {
    console.error('[cleanlemon] operator/bukku-credentials', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/operator/bukku-disconnect', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    await clnInt.bukkuDisconnect(operatorId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[cleanlemon] operator/bukku-disconnect', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

/** Operator portal — TTLock Open Platform (token in `cln_ttlocktoken.operator_id`). */
router.get('/operator/ttlock/onboard-status', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const st = await clnInt.getTtlockOnboardStatusClnOperator(operatorId);
    return res.json({ ok: true, ...st });
  } catch (err) {
    console.error('[cleanlemon] operator/ttlock/onboard-status', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

router.get('/operator/ttlock/credentials', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const slotRaw = req.query?.ttlockSlot ?? req.query?.ttlock_slot;
    const slot = slotRaw != null && slotRaw !== '' ? Number(slotRaw) : 0;
    const sl = Number.isFinite(slot) && slot >= 0 ? slot : 0;
    const data = await clnInt.getTtlockCredentialsClnOperator(operatorId, sl);
    return res.json(data);
  } catch (err) {
    console.error('[cleanlemon] operator/ttlock/credentials', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

router.post('/operator/ttlock/connect', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    const username = req.body?.username;
    const password = req.body?.password;
    const accountName = req.body?.accountName;
    const slotRaw = req.body?.ttlockSlot ?? req.body?.ttlock_slot;
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const result = await clnInt.ttlockConnectClnOperator(operatorId, {
      username,
      password,
      accountName,
      slot: slotRaw != null && slotRaw !== '' ? Number(slotRaw) : undefined
    });
    return res.json(result);
  } catch (err) {
    const msg = err?.message || 'TTLOCK_CONNECT_FAILED';
    console.error('[cleanlemon] operator/ttlock/connect', err);
    return res.status(400).json({ ok: false, reason: msg });
  }
});

router.post('/operator/ttlock/disconnect', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const slot = Number(req.body?.ttlockSlot ?? req.body?.ttlock_slot ?? 0) || 0;
    await clnInt.ttlockDisconnectClnOperator(operatorId, slot);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[cleanlemon] operator/ttlock/disconnect', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'SERVER_ERROR' });
  }
});

/** Xero OAuth (same token exchange as Coliving). */
router.post('/operator/xero-connect', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const result = await clnInt.xeroConnect(operatorId, req.body || {});
    res.json(result);
  } catch (err) {
    const msg = err?.message || 'DB_ERROR';
    console.error('[cleanlemon] operator/xero-connect', err);
    res.status(500).json({ ok: false, reason: msg });
  }
});

router.get('/operator/xero-auth-url', async (req, res) => {
  try {
    const redirectUriRaw = req.query.redirectUri ?? req.query.redirect_uri;
    const redirectUri = sanitizeRedirectUriForXero(redirectUriRaw);
    if (!redirectUri) return res.status(400).json({ ok: false, reason: 'REDIRECT_URI_REQUIRED' });
    const result = clnInt.getXeroAuthUrl(redirectUri, req.query.state || '');
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[cleanlemon] operator/xero-auth-url', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/operator/xero-disconnect', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    await clnInt.xeroDisconnect(operatorId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[cleanlemon] operator/xero-disconnect', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

/** AI Agent: store operator API key encrypted in `cln_operator_integration` (`aiAgent` + provider). */
router.post('/operator/ai-agent/connect', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    const provider = String(req.body?.provider || '').trim().toLowerCase();
    const apiKey = String(req.body?.apiKey ?? req.body?.api_key ?? '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    await clnInt.aiAgentConnect(operatorId, { provider, apiKey });
    return res.json({ ok: true });
  } catch (err) {
    const msg = String(err?.message || '');
    if (
      [
        'INVALID_AI_PROVIDER',
        'API_KEY_REQUIRED',
        'AI_KEY_VERIFY_FAILED',
        'AI_VERIFY_TIMEOUT',
        'OPERATOR_INTEGRATION_SECRET_NOT_SET',
      ].includes(msg) ||
      msg.includes('OPERATOR_INTEGRATION_SECRET')
    ) {
      return res.status(400).json({ ok: false, reason: msg });
    }
    console.error('[cleanlemon] operator/ai-agent/connect', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/operator/ai-agent/disconnect', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    await clnInt.aiAgentDisconnect(operatorId);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[cleanlemon] operator/ai-agent/disconnect', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

/** Per-operator AI schedule rules + chat (`cln_operator_ai`). */
router.get('/operator/schedule/ai-settings', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const data = await clnOpAi.getOperatorAiSettingsForApi(operatorId);
    return res.json({ ok: true, data });
  } catch (err) {
    if (err?.code === 'OPERATOR_ACCESS_DENIED' || err?.code === 'OPERATORDETAIL_REQUIRED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'MISSING_OPERATOR_OR_EMAIL') {
      return res.status(400).json({ ok: false, reason: err.code });
    }
    if (isMissingClnOperatorAiTable(err)) {
      return res.status(503).json({ ok: false, reason: 'CLN_OPERATOR_AI_MIGRATION_REQUIRED' });
    }
    console.error('[cleanlemon] operator/schedule/ai-settings:get', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.put('/operator/schedule/ai-settings', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const patch = { ...(req.body || {}) };
    delete patch.operatorId;
    const data = await clnOpAi.saveOperatorAiSettingsFromApi(operatorId, patch);
    return res.json({ ok: true, data });
  } catch (err) {
    if (err?.code === 'OPERATOR_ACCESS_DENIED' || err?.code === 'OPERATORDETAIL_REQUIRED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'MISSING_OPERATOR_OR_EMAIL') {
      return res.status(400).json({ ok: false, reason: err.code });
    }
    if (isMissingClnOperatorAiTable(err)) {
      return res.status(503).json({ ok: false, reason: 'CLN_OPERATOR_AI_MIGRATION_REQUIRED' });
    }
    console.error('[cleanlemon] operator/schedule/ai-settings:put', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/operator/schedule/ai-chat', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const limit = req.query.limit ? Number(req.query.limit) : 40;
    const items = await clnOpAi.listChatMessages(operatorId, limit);
    const itemsForPortal = (items || []).map((row) => {
      const base = {
        id: row.id,
        role: row.role,
        content: row.content,
        createdAt: row.createdAt,
      };
      if (String(row.role) !== 'assistant') return base;
      const raw = String(base.content || '');
      return {
        ...base,
        content: clnOpAi.shortenVerboseEnglishConsentFooter(clnOpAi.stripJarvisChineseConsentTokens(raw)),
      };
    });
    return res.json({ ok: true, items: itemsForPortal });
  } catch (err) {
    if (err?.code === 'OPERATOR_ACCESS_DENIED' || err?.code === 'OPERATORDETAIL_REQUIRED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'MISSING_OPERATOR_OR_EMAIL') {
      return res.status(400).json({ ok: false, reason: err.code });
    }
    if (isMissingClnOperatorAiTable(err)) {
      return res.status(503).json({ ok: false, reason: 'CLN_OPERATOR_AI_MIGRATION_REQUIRED' });
    }
    console.error('[cleanlemon] operator/schedule/ai-chat:get', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/operator/schedule/ai-chat', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    const message = String(req.body?.message || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    if (!message) return res.status(400).json({ ok: false, reason: 'EMPTY_MESSAGE' });
    const mergeExtractedConstraints = !!req.body?.mergeExtractedConstraints;
    const contextWorkingDay = String(req.body?.contextWorkingDay || '').trim().slice(0, 10);
    let out = await clnOpAi.runOperatorAiChat({
      operatorId,
      userMessage: message,
      mergeExtractedConstraints,
      contextWorkingDay: contextWorkingDay || undefined,
      portalEmail: gate.email,
    });
    if (out && typeof out.reply === 'string' && !/[\u4e00-\u9fff]/u.test(message)) {
      out = {
        ...out,
        reply: clnOpAi.shortenVerboseEnglishConsentFooter(clnOpAi.stripJarvisChineseConsentTokens(out.reply)),
      };
    }
    return res.json({ ok: true, ...out });
  } catch (err) {
    if (err?.code === 'OPERATOR_ACCESS_DENIED' || err?.code === 'OPERATORDETAIL_REQUIRED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'MISSING_OPERATOR_OR_EMAIL') {
      return res.status(400).json({ ok: false, reason: err.code });
    }
    if (isMissingClnOperatorAiTable(err)) {
      return res.status(503).json({ ok: false, reason: 'CLN_OPERATOR_AI_MIGRATION_REQUIRED' });
    }
    console.error('[cleanlemon] operator/schedule/ai-chat:post', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/operator/schedule/bulk-create-homestay-by-name', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    const workingDay = String(req.body?.workingDay || '').trim().slice(0, 10);
    const nameContains = String(req.body?.nameContains || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workingDay)) {
      return res.status(400).json({ ok: false, reason: 'INVALID_WORKING_DAY' });
    }
    const out = await svc.bulkCreateHomestayJobsByPropertyNameSubstring({
      operatorId,
      dateYmd: workingDay,
      nameContains,
      createdByEmail: gate.email,
    });
    return res.json({ ok: true, ...out });
  } catch (err) {
    if (err?.code === 'OPERATOR_ACCESS_DENIED' || err?.code === 'OPERATORDETAIL_REQUIRED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'MISSING_OPERATOR_OR_EMAIL') {
      return res.status(400).json({ ok: false, reason: err.code });
    }
    const c = String(err?.code || '');
    if (c === 'BAD_DATE' || c === 'NAME_TOO_SHORT' || c === 'MISSING_OPERATOR_ID' || c === 'PAST_DAY') {
      return res.status(400).json({ ok: false, reason: c });
    }
    console.error('[cleanlemon] operator/schedule/bulk-create-homestay-by-name:post', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/operator/schedule/ai-suggest', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    const workingDay = String(req.body?.workingDay || '').slice(0, 10);
    const apply = !!req.body?.apply;
    const mode = String(req.body?.mode || 'full').toLowerCase();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workingDay)) {
      return res.status(400).json({ ok: false, reason: 'INVALID_WORKING_DAY' });
    }
    let out;
    if (mode === 'incremental') {
      const newJobIds = Array.isArray(req.body?.newJobIds) ? req.body.newJobIds.map(String) : [];
      out = await clnOpAi.runScheduleAiSuggestIncremental({ operatorId, workingDay, newJobIds, apply });
    } else if (mode === 'rebalance') {
      const force = !!req.body?.force;
      const rc = String(req.body?.rebalanceContext || '').toLowerCase();
      const rebalanceContext = rc === 'post_completion' ? 'post_completion' : undefined;
      out = await clnOpAi.runScheduleAiRebalance({ operatorId, workingDay, apply, force, rebalanceContext });
    } else {
      out = await clnOpAi.runScheduleAiSuggest({ operatorId, workingDay, apply });
    }
    return res.json({ ok: out.ok !== false, ...out });
  } catch (err) {
    if (err?.code === 'OPERATOR_ACCESS_DENIED' || err?.code === 'OPERATORDETAIL_REQUIRED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'MISSING_OPERATOR_OR_EMAIL') {
      return res.status(400).json({ ok: false, reason: err.code });
    }
    const msg = String(err?.message || '');
    if (msg === 'AI_NOT_CONFIGURED' || msg === 'INVALID_PARAMS') {
      return res.status(400).json({ ok: false, reason: msg });
    }
    if (err?.code === 'OPERATOR_AI_DISABLED_BY_PLATFORM' || err?.code === 'OPERATOR_AI_SCOPE_SCHEDULE_DISABLED') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (isMissingClnOperatorAiTable(err)) {
      return res.status(503).json({ ok: false, reason: 'CLN_OPERATOR_AI_MIGRATION_REQUIRED' });
    }
    console.error('[cleanlemon] operator/schedule/ai-suggest:post', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

/** Google Drive OAuth — reuse Coliving env (GOOGLE_DRIVE_OAUTH_*, GOOGLE_CLIENT_*, CLEANLEMON_GOOGLE_*). */
router.post('/operator/google-drive/oauth-url', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || req.query.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const result = await clnInt.getGoogleDriveOAuthAuthUrl(operatorId);
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    console.error('[cleanlemon] operator/google-drive/oauth-url', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/operator/google-drive/oauth-callback', async (req, res) => {
  const code = req.query.code;
  const state = req.query.state;
  const oauthErr = req.query.error;
  const base = clnInt.getCleanlemonPortalCompanyUrl();
  const sep = base.includes('?') ? '&' : '?';
  if (oauthErr) {
    return res.redirect(
      302,
      `${base}${sep}google_drive=error&reason=${encodeURIComponent(String(oauthErr))}`
    );
  }
  try {
    const { redirectUrl } = await clnInt.completeGoogleDriveOAuthFromCallback(code, state);
    return res.redirect(302, redirectUrl);
  } catch (err) {
    console.error('[cleanlemon] operator/google-drive/oauth-callback', err);
    return res.redirect(302, `${base}${sep}google_drive=error&reason=callback_failed`);
  }
});

router.post('/operator/google-drive/disconnect', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    await clnInt.disconnectGoogleDrive(operatorId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[cleanlemon] operator/google-drive/disconnect', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

/** Stripe Connect OAuth — redirect_uri must match Stripe Dashboard → Connect → OAuth. */
router.post('/operator/stripe-connect/oauth-url', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || req.query.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const result = await clnInt.getStripeConnectOAuthAuthUrl(operatorId);
    if (!result.ok) return res.status(400).json(result);
    res.json({ ok: true, url: result.url });
  } catch (err) {
    console.error('[cleanlemon] operator/stripe-connect/oauth-url', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/operator/stripe-connect/oauth-callback', async (req, res) => {
  const code = req.query.code;
  const state = req.query.state;
  const oauthErr = req.query.error;
  const base = clnInt.getCleanlemonPortalCompanyUrl();
  const sep = base.includes('?') ? '&' : '?';
  if (oauthErr) {
    return res.redirect(
      302,
      `${base}${sep}stripe_connect=error&reason=${encodeURIComponent(String(oauthErr))}`
    );
  }
  const oid = String(state || '').trim();
  if (!oid || !code) {
    return res.redirect(302, `${base}${sep}stripe_connect=error&reason=missing_params`);
  }
  try {
    await clnInt.completeOperatorStripeConnectOAuth(oid, code);
    return res.redirect(302, `${base}${sep}stripe_connect=connected`);
  } catch (err) {
    console.error('[cleanlemon] operator/stripe-connect/oauth-callback', err);
    const msg = encodeURIComponent(String(err?.message || 'callback_failed').slice(0, 200));
    return res.redirect(302, `${base}${sep}stripe_connect=error&reason=${msg}`);
  }
});

router.post('/operator/stripe-connect/disconnect', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    await clnInt.disconnectStripeConnect(operatorId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[cleanlemon] operator/stripe-connect/disconnect', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

/** Client-invoice Xendit (operator’s own key + callback token), same UX model as Coliving Payex direct. */
router.post('/operator/client-invoice-xendit-credentials', async (req, res) => {
  try {
    const body = req.body || {};
    const operatorId = String(body.operatorId || '').trim();
    const secretKey = Object.prototype.hasOwnProperty.call(body, 'secretKey') ? body.secretKey : undefined;
    const callbackToken = Object.prototype.hasOwnProperty.call(body, 'callbackToken') ? body.callbackToken : undefined;
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    await svc.saveClnOperatorClientInvoiceXenditCredentials(operatorId, { secretKey, callbackToken });
    return res.json({ ok: true });
  } catch (err) {
    if (err?.code === 'MISSING_KEYS') {
      return res.status(400).json({ ok: false, reason: 'MISSING_KEYS' });
    }
    if (err?.code === 'MISSING_OPERATOR_ID') {
      return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    }
    console.error('[cleanlemon] operator/client-invoice-xendit-credentials', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/operator/client-invoice-xendit-disconnect', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    await svc.clearClnOperatorClientInvoiceXenditCredentials(operatorId);
    return res.json({ ok: true });
  } catch (err) {
    if (err?.code === 'MISSING_OPERATOR_ID') {
      return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    }
    console.error('[cleanlemon] operator/client-invoice-xendit-disconnect', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/operator/salaries', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || '').trim();
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const period = String(req.query.period || '').trim();
    const items = await svc.listOperatorSalaries(operatorId, period || undefined);
    res.json({ ok: true, items });
  } catch (err) {
    console.error('[cleanlemon] operator/salaries:get', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/operator/salary-settings', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const settings = await clnSalary.getSalarySettings(operatorId);
    res.json({ ok: true, settings });
  } catch (err) {
    console.error('[cleanlemon] operator/salary-settings:get', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.put('/operator/salary-settings', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const payDays = Array.isArray(req.body?.payDays) ? req.body.payDays : [];
    const payrollDefaults =
      req.body?.payrollDefaults !== undefined ? req.body.payrollDefaults : undefined;
    const settings = await clnSalary.saveSalarySettings(operatorId, payDays, payrollDefaults);
    res.json({ ok: true, settings });
  } catch (err) {
    const code = err?.code;
    if (code === 'MISSING_OPERATOR_ID' || code === 'SALARY_TABLES_MISSING') {
      return res.status(400).json({ ok: false, reason: code });
    }
    console.error('[cleanlemon] operator/salary-settings:put', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/operator/salary-lines', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || '').trim();
    const period = String(req.query.period || '').trim();
    if (!operatorId || !/^\d{4}-\d{2}$/.test(period)) {
      return res.status(400).json({ ok: false, reason: 'MISSING_PARAMS' });
    }
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const items = await clnSalary.listSalaryLines(operatorId, period);
    res.json({ ok: true, items });
  } catch (err) {
    console.error('[cleanlemon] operator/salary-lines:get', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/operator/salary-lines', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const item = await clnSalary.addSalaryLine(operatorId, req.body || {});
    res.json({ ok: true, item });
  } catch (err) {
    const code = err?.code;
    if (code === 'RECORD_NOT_FOUND' || code === 'MISSING_OPERATOR_ID' || code === 'SALARY_TABLES_MISSING') {
      return res.status(400).json({ ok: false, reason: code });
    }
    console.error('[cleanlemon] operator/salary-lines:post', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.delete('/operator/salary-lines/:id', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const ok = await clnSalary.deleteSalaryLine(operatorId, req.params.id);
    res.json({ ok, deleted: ok });
  } catch (err) {
    console.error('[cleanlemon] operator/salary-lines:delete', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.patch('/operator/salary-lines/:id', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const item = await clnSalary.updateSalaryLine(operatorId, req.params.id, req.body || {});
    res.json({ ok: true, item });
  } catch (err) {
    const code = err?.code;
    if (code === 'LINE_NOT_FOUND' || code === 'MISSING_PARAMS' || code === 'MISSING_OPERATOR_ID' || code === 'SALARY_TABLES_MISSING') {
      return res.status(400).json({ ok: false, reason: code });
    }
    console.error('[cleanlemon] operator/salary-lines:patch', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/operator/salaries/compute-preview', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const result = await clnSalary.previewFlexiblePayroll(operatorId, req.body || {});
    res.json({ ok: true, result });
  } catch (err) {
    const code = err?.code;
    if (
      code === 'MISSING_OPERATOR_ID' ||
      code === 'RECORD_NOT_FOUND' ||
      code === 'SALARY_TABLES_MISSING'
    ) {
      return res.status(400).json({ ok: false, reason: code });
    }
    console.error('[cleanlemon] operator/salaries/compute-preview', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/operator/salaries/sync-from-contacts', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    const period = String(req.body?.period || '').trim();
    if (!operatorId || !/^\d{4}-\d{2}$/.test(period)) {
      return res.status(400).json({ ok: false, reason: 'INVALID_PARAMS' });
    }
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const items = await svc.listOperatorContacts(operatorId);
    const result = await clnSalary.syncSalaryRecordsFromContacts(operatorId, period, items);
    res.json(result);
  } catch (err) {
    const code = err?.code;
    if (code === 'INVALID_PARAMS' || code === 'SALARY_TABLES_MISSING') {
      return res.status(400).json({ ok: false, reason: code });
    }
    console.error('[cleanlemon] operator/salaries/sync-from-contacts', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/operator/salaries', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const item = await clnSalary.createSalaryRecord(operatorId, req.body || {});
    res.json({ ok: true, item });
  } catch (err) {
    const code = err?.code;
    if (code === 'INVALID_PERIOD' || code === 'MISSING_OPERATOR_ID' || code === 'SALARY_TABLES_MISSING') {
      return res.status(400).json({ ok: false, reason: code });
    }
    console.error('[cleanlemon] operator/salaries:post', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.patch('/operator/salaries/:id', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const action = String(req.body?.action || '').trim().toLowerCase();
    if (action === 'void_payment') {
      const item = await clnSalary.voidSalaryRecordPayment(operatorId, req.params.id);
      return res.json({ ok: true, item });
    }
    if (action === 'unvoid') {
      const item = await clnSalary.restoreSalaryRecordFromVoid(operatorId, req.params.id);
      return res.json({ ok: true, item });
    }
    if (action === 'unarchive') {
      const item = await clnSalary.restoreSalaryRecordFromArchive(operatorId, req.params.id);
      return res.json({ ok: true, item });
    }
    const status = String(req.body?.status || '').trim();
    if (status === 'void' || status === 'archived') {
      const item = await clnSalary.patchSalaryRecordStatus(operatorId, req.params.id, status);
      return res.json({ ok: true, item });
    }
    const item = await clnSalary.updateSalaryRecord(operatorId, req.params.id, req.body || {});
    res.json({ ok: true, item });
  } catch (err) {
    const code = err?.code;
    if (
      code === 'INVALID_STATUS' ||
      code === 'MISSING_OPERATOR_ID' ||
      code === 'SALARY_TABLES_MISSING' ||
      code === 'RECORD_NOT_FOUND' ||
      code === 'RECORD_LOCKED' ||
      code === 'MISSING_PARAMS' ||
      code === 'BUKKU_NOT_CONNECTED' ||
      code === 'BUKKU_VOID_FAILED' ||
      code === 'VOID_BUKKU_EXCEPTION' ||
      code === 'VOID_XERO_SPEND_FAILED' ||
      code === 'VOID_XERO_EXCEPTION' ||
      code === 'ACCOUNTING_VOID_FAILED'
    ) {
      return res.status(400).json({ ok: false, reason: code, detail: err?.detail });
    }
    console.error('[cleanlemon] operator/salaries:patch', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/operator/salaries/sync-accounting', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    const recordIds = Array.isArray(req.body?.recordIds) ? req.body.recordIds : [];
    const journalDate = String(req.body?.journalDate || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const result = await clnSalary.syncSalaryRecordsToAccounting(
      operatorId,
      recordIds,
      journalDate || undefined
    );
    res.json(result);
  } catch (err) {
    console.error('[cleanlemon] operator/salaries/sync-accounting', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

/** @deprecated Use POST /operator/salaries/sync-accounting (same behaviour: Bukku or Xero by integration). */
router.post('/operator/salaries/sync-bukku', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    const recordIds = Array.isArray(req.body?.recordIds) ? req.body.recordIds : [];
    const journalDate = String(req.body?.journalDate || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const result = await clnSalary.syncSalaryRecordsToAccounting(
      operatorId,
      recordIds,
      journalDate || undefined
    );
    res.json(result);
  } catch (err) {
    console.error('[cleanlemon] operator/salaries/sync-bukku', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/operator/salaries/mark-paid', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    const recordIds = Array.isArray(req.body?.recordIds) ? req.body.recordIds : [];
    const paymentDate = String(req.body?.paymentDate || '').trim();
    const paymentMethod = String(req.body?.paymentMethod || '').trim();
    const releaseAmounts =
      req.body?.releaseAmounts != null && typeof req.body.releaseAmounts === 'object' && !Array.isArray(req.body.releaseAmounts)
        ? req.body.releaseAmounts
        : null;
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const result = await clnSalary.markSalaryRecordsPaid(
      operatorId,
      recordIds,
      paymentDate,
      paymentMethod,
      releaseAmounts
    );
    res.json(result);
  } catch (err) {
    console.error('[cleanlemon] operator/salaries/mark-paid', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/operator/contacts', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || '').trim();
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const items = await svc.listOperatorContacts(operatorId || undefined);
    res.json({ ok: true, items });
  } catch (err) {
    console.error('[cleanlemon] operator/contacts:get', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

/** POST body: { operatorId, direction: 'to-accounting' | 'from-accounting' } — maps staff/driver/dobi/supervisor→employee, clients→customer (Bukku). */
router.post('/operator/contacts/sync-all', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    const direction = String(req.body?.direction || 'to-accounting').toLowerCase();
    if (!operatorId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    }
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const result = await svc.syncClnOperatorContactsWithAccounting(operatorId, direction);
    res.json(result);
  } catch (err) {
    if (err?.code === 'OPERATORDETAIL_REQUIRED') {
      return res.status(400).json({ ok: false, reason: 'OPERATORDETAIL_REQUIRED' });
    }
    console.error('[cleanlemon] operator/contacts/sync-all', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/operator/contacts', async (req, res) => {
  try {
    const b = req.body || {};
    const oid = String(b.operatorId || b.operator_id || '').trim();
    const gate = await requireOperatorStaffForPortal(req, res, oid);
    if (!gate) return;
    const id = await svc.createOperatorContact(b);
    res.json({ ok: true, id });
  } catch (err) {
    if (err?.code === 'SINGLE_ROLE_REQUIRED') {
      return res.status(400).json({
        ok: false,
        reason: 'SINGLE_ROLE_REQUIRED',
        message: 'Select exactly one role (Staff, Driver, Dobi, Supervisor, or Client) per contact.',
      });
    }
    if (err?.code === 'SUPERVISOR_EMAIL_IN_USE') {
      return res.status(409).json({
        ok: false,
        reason: 'SUPERVISOR_EMAIL_IN_USE',
        message: 'This email is already used for a supervisor account.',
      });
    }
    if (err?.code === 'EMAIL_IN_USE') {
      return res.status(409).json({
        ok: false,
        reason: 'EMAIL_IN_USE',
        message: 'This email is already used by another contact for this operator.',
      });
    }
    if (err?.code === 'DOMAIN_CONTACT_SCHEMA_MISSING') {
      return res.status(503).json({
        ok: false,
        reason: 'DOMAIN_CONTACT_SCHEMA_MISSING',
        message: 'Contact storage tables (cln_employeedetail / cln_clientdetail) are not available.',
      });
    }
    console.error('[cleanlemon] operator/contacts:post', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.put('/operator/contacts/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const oid = String(b.operatorId || b.operator_id || '').trim();
    const gate = await requireOperatorStaffForPortal(req, res, oid);
    if (!gate) return;
    await svc.updateOperatorContact(req.params.id, b);
    res.json({ ok: true });
  } catch (err) {
    if (err?.code === 'CONTACT_NOT_FOUND') {
      return res.status(404).json({ ok: false, reason: 'CONTACT_NOT_FOUND' });
    }
    if (err?.code === 'SUPERVISOR_EMAIL_IN_USE') {
      return res.status(409).json({
        ok: false,
        reason: 'SUPERVISOR_EMAIL_IN_USE',
        message: 'This email is already used for a supervisor account.',
      });
    }
    if (err?.code === 'EMAIL_IN_USE') {
      return res.status(409).json({
        ok: false,
        reason: 'EMAIL_IN_USE',
        message: 'This email is already used by another contact for this operator.',
      });
    }
    if (err?.code === 'ARCHIVE_REQUIRES_RESIGN') {
      return res.status(400).json({
        ok: false,
        reason: 'ARCHIVE_REQUIRES_RESIGN',
        message: 'Archive is only allowed after resign.',
      });
    }
    if (err?.code === 'DOMAIN_CONTACT_SCHEMA_MISSING') {
      return res.status(503).json({
        ok: false,
        reason: 'DOMAIN_CONTACT_SCHEMA_MISSING',
        message: 'Contact storage tables (cln_employeedetail / cln_clientdetail) are not available.',
      });
    }
    console.error('[cleanlemon] operator/contacts:put', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.delete('/operator/contacts/:id', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || '').trim();
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    await svc.deleteOperatorContact(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    if (err?.code === 'CONTACT_NOT_FOUND') {
      return res.status(404).json({ ok: false, reason: 'CONTACT_NOT_FOUND' });
    }
    if (err?.code === 'DOMAIN_CONTACT_SCHEMA_MISSING') {
      return res.status(503).json({
        ok: false,
        reason: 'DOMAIN_CONTACT_SCHEMA_MISSING',
        message: 'Contact storage tables (cln_employeedetail / cln_clientdetail) are not available.',
      });
    }
    console.error('[cleanlemon] operator/contacts:delete', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/operator/teams', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || '').trim() || undefined;
    const gate = await requireOperatorStaffForPortal(req, res, operatorId || '');
    if (!gate) return;
    const items = await svc.listOperatorTeams(operatorId);
    res.json({ ok: true, items });
  } catch (err) {
    console.error('[cleanlemon] operator/teams:get', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/operator/teams', async (req, res) => {
  try {
    const b = req.body || {};
    const oid = String(b.operatorId || b.operator_id || '').trim();
    const gate = await requireOperatorStaffForPortal(req, res, oid);
    if (!gate) return;
    const id = await svc.createOperatorTeam(b);
    res.json({ ok: true, id });
  } catch (err) {
    if (err?.code === 'MISSING_OPERATOR_ID') {
      return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    }
    console.error('[cleanlemon] operator/teams:post', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.put('/operator/teams/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const oid = String(b.operatorId || b.operator_id || '').trim();
    const gate = await requireOperatorStaffForPortal(req, res, oid);
    if (!gate) return;
    await svc.updateOperatorTeam(req.params.id, b);
    res.json({ ok: true });
  } catch (err) {
    if (err?.code === 'TEAM_NOT_FOUND') {
      return res.status(404).json({ ok: false, reason: 'TEAM_NOT_FOUND' });
    }
    if (err?.code === 'MISSING_OPERATOR_ID') {
      return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    }
    console.error('[cleanlemon] operator/teams:put', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.delete('/operator/teams/:id', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || '').trim();
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    await svc.deleteOperatorTeam(req.params.id, operatorId);
    res.json({ ok: true });
  } catch (err) {
    if (err?.code === 'TEAM_NOT_FOUND') {
      return res.status(404).json({ ok: false, reason: 'TEAM_NOT_FOUND' });
    }
    if (err?.code === 'MISSING_OPERATOR_ID') {
      return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    }
    console.error('[cleanlemon] operator/teams:delete', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/operator/schedule-jobs', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || '').trim() || undefined;
    const gate = await requireOperatorStaffForPortal(req, res, operatorId || '');
    if (!gate) return;
    const items = await svc.listOperatorScheduleJobs({
      limit: req.query.limit,
      operatorId,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
    });
    res.json({ ok: true, items });
  } catch (err) {
    console.error('[cleanlemon] operator/schedule-jobs:get', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

/** Pending client booking jobs (Pricing → request booking & approve). */
router.get('/operator/pending-client-booking-requests', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const items = await svc.listOperatorPendingClientBookingRequests({
      operatorId,
      limit: req.query.limit,
    });
    res.json({ ok: true, items });
  } catch (err) {
    console.error('[cleanlemon] operator/pending-client-booking-requests:get', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/operator/pending-client-booking-requests/:id/decide', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || req.query?.operatorId || '').trim();
    const decision = String(req.body?.decision || '').trim().toLowerCase();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    if (decision !== 'approve' && decision !== 'reject') {
      return res.status(400).json({ ok: false, reason: 'INVALID_DECISION' });
    }
    const statusSetByEmail = String(req.body?.email || req.body?.statusSetByEmail || '').trim().toLowerCase();
    await svc.decideOperatorClientBookingRequest({
      operatorId,
      scheduleId: req.params.id,
      decision,
      statusSetByEmail: statusSetByEmail || undefined,
    });
    res.json({ ok: true });
  } catch (err) {
    if (err?.code === 'MISSING_PARAMS') {
      return res.status(400).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'NOT_FOUND') {
      return res.status(404).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'OPERATOR_MISMATCH' || err?.code === 'NOT_CLIENT_BOOKING_REQUEST' || err?.code === 'NOT_PENDING_APPROVAL') {
      return res.status(400).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] operator/pending-client-booking-requests:decide', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/operator/damage-reports', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const items = await svc.listOperatorDamageReports({
      operatorId,
      limit: req.query.limit,
    });
    res.json({ ok: true, items });
  } catch (err) {
    console.error('[cleanlemon] operator/damage-reports:get', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.put('/operator/schedule-jobs/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const oid = String(b.operatorId || b.operator_id || '').trim();
    const gate = await requireOperatorStaffForPortal(req, res, oid);
    if (!gate) return;
    await svc.updateOperatorScheduleJob(req.params.id, b);
    res.json({ ok: true });
  } catch (err) {
    if (err?.code === 'OPERATOR_MISMATCH') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'BAD_REQUEST') {
      return res.status(400).json({ ok: false, reason: err.message || err.code });
    }
    console.error('[cleanlemon] operator/schedule-jobs:put', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.delete('/operator/schedule-jobs/:id', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || req.body?.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    await svc.deleteOperatorScheduleJob({ scheduleId: req.params.id, operatorId });
    res.json({ ok: true });
  } catch (err) {
    if (err?.code === 'MISSING_PARAMS') {
      return res.status(400).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'OPERATOR_MISMATCH') {
      return res.status(403).json({ ok: false, reason: err.code });
    }
    if (err?.code === 'NOT_FOUND') {
      return res.status(404).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] operator/schedule-jobs:delete', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/operator/schedule-jobs', async (req, res) => {
  try {
    const body = req.body || {};
    const operatorId = String(body.operatorId || '').trim();
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const id = await svc.createCleaningScheduleJobUnified(body);
    const date = String(body.date || '').slice(0, 10);
    if (operatorId && id) {
      clnOpAi.maybeRunIncrementalAfterJobCreate(operatorId, date, id);
    }
    res.json({ ok: true, id });
  } catch (err) {
    if (err?.code === 'MISSING_PROPERTY_ID' || err?.code === 'MISSING_DATE') {
      return res.status(400).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] operator/schedule-jobs:post', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/operator/accounting-mappings', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const items = await svc.listOperatorAccountingMappings(operatorId);
    res.json({ ok: true, items });
  } catch (err) {
    console.error('[cleanlemon] operator/accounting-mappings:get', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.put('/operator/accounting-mappings', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const item = req.body?.item || {};
    await svc.upsertOperatorAccountingMapping(operatorId, item);
    res.json({ ok: true });
  } catch (err) {
    console.error('[cleanlemon] operator/accounting-mappings:put', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/operator/accounting-mappings/sync', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || req.query?.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const result = await svc.syncOperatorAccountingMappings(operatorId);
    if (!result?.ok) {
      return res.status(400).json({ ok: false, ...result });
    }
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[cleanlemon] operator/accounting-mappings:sync', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/operator/calendar-adjustments', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const items = await svc.listOperatorCalendarAdjustments(operatorId);
    res.json({ ok: true, items });
  } catch (err) {
    console.error('[cleanlemon] operator/calendar-adjustments:get', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/operator/calendar-adjustments', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const payload = req.body?.payload || {};
    const id = await svc.createOperatorCalendarAdjustment(operatorId, payload);
    res.json({ ok: true, id });
  } catch (err) {
    console.error('[cleanlemon] operator/calendar-adjustments:post', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.put('/operator/calendar-adjustments/:id', async (req, res) => {
  try {
    const operatorId = String(req.body?.operatorId || req.query?.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    const payload = req.body?.payload || {};
    await svc.updateOperatorCalendarAdjustment(req.params.id, operatorId, payload);
    res.json({ ok: true });
  } catch (err) {
    if (err?.code === 'NOT_FOUND') {
      return res.status(404).json({ ok: false, reason: 'NOT_FOUND' });
    }
    console.error('[cleanlemon] operator/calendar-adjustments:put', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.delete('/operator/calendar-adjustments/:id', async (req, res) => {
  try {
    const operatorId = String(req.query.operatorId || req.body?.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const gate = await requireOperatorStaffForPortal(req, res, operatorId);
    if (!gate) return;
    await svc.deleteOperatorCalendarAdjustment(req.params.id, operatorId);
    res.json({ ok: true });
  } catch (err) {
    if (err?.code === 'NOT_FOUND') {
      return res.status(404).json({ ok: false, reason: 'NOT_FOUND' });
    }
    console.error('[cleanlemon] operator/calendar-adjustments:delete', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/admin/operatordetail-by-email', async (req, res) => {
  try {
    const out = await svc.getAdminOperatordetailByEmail(req.query.email);
    return res.json(out);
  } catch (err) {
    console.error('[cleanlemon] admin/operatordetail-by-email', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/admin/subscriptions', async (req, res) => {
  try {
    const items = await svc.listAdminSubscriptions({
      search: req.query.search,
      plan: req.query.plan,
      status: req.query.status,
      approvalStatus: req.query.approvalStatus,
    });
    res.json({ ok: true, items });
  } catch (err) {
    console.error('[cleanlemon] admin/subscriptions:get', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/admin/lock-unlock-logs', async (req, res) => {
  try {
    const out = await svc.listAdminLockUnlockLogs({
      q: req.query.q,
      lockdetailId: req.query.lockdetailId,
      from: req.query.from,
      to: req.query.to,
      page: req.query.page,
      pageSize: req.query.pageSize,
    });
    res.json(out);
  } catch (err) {
    console.error('[cleanlemon] admin/lock-unlock-logs:get', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/admin/lock-unlock-logs/lock-options', async (req, res) => {
  try {
    const out = await svc.listAdminLockUnlockLogLockOptions();
    res.json(out);
  } catch (err) {
    console.error('[cleanlemon] admin/lock-unlock-logs/lock-options:get', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.put('/admin/subscriptions/:operatorId/plan', async (req, res) => {
  try {
    await svc.updateAdminSubscriptionPlan(req.params.operatorId, req.body || {});
    res.json({ ok: true });
  } catch (err) {
    if (err?.code === 'MISSING_PLAN_CODE') {
      return res.status(400).json({ ok: false, reason: 'MISSING_PLAN_CODE' });
    }
    if (err?.code === 'MISSING_OPERATOR_ID') {
      return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    }
    console.error('[cleanlemon] admin/subscriptions:plan:put', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.put('/admin/subscriptions/:operatorId/approval', async (req, res) => {
  try {
    await svc.updateAdminSubscriptionApproval(req.params.operatorId, req.body || {});
    res.json({ ok: true });
  } catch (err) {
    if (err?.code === 'INVALID_DECISION') {
      return res.status(400).json({ ok: false, reason: 'INVALID_DECISION' });
    }
    if (err?.code === 'MISSING_OPERATOR_ID') {
      return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    }
    console.error('[cleanlemon] admin/subscriptions:approval:put', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/admin/subscriptions/manual-create', async (req, res) => {
  try {
    const result = await svc.manualCreateAdminSubscription(req.body || {});
    res.json({ ok: true, ...result });
  } catch (err) {
    if (err?.code === 'MISSING_EMAIL') {
      return res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    }
    if (err?.code === 'OPERATORDETAIL_REQUIRED') {
      return res.status(400).json({ ok: false, reason: 'OPERATORDETAIL_REQUIRED' });
    }
    if (err?.code === 'MISSING_COMPANY_FOR_NEW_OPERATOR') {
      return res.status(400).json({ ok: false, reason: 'MISSING_COMPANY_FOR_NEW_OPERATOR' });
    }
    if (err?.code === 'ACCOUNTING_REQUIRES_GROWTH_OR_ENTERPRISE') {
      return res.status(400).json({ ok: false, reason: 'ACCOUNTING_REQUIRES_GROWTH_OR_ENTERPRISE' });
    }
    if (err?.code === 'ACCOUNTING_REQUIRES_PAYMENT_METHOD') {
      return res.status(400).json({ ok: false, reason: 'ACCOUNTING_REQUIRES_PAYMENT_METHOD' });
    }
    if (err?.code === 'INVOICE_AMOUNT_INVALID') {
      return res.status(400).json({ ok: false, reason: 'INVOICE_AMOUNT_INVALID' });
    }
    console.error('[cleanlemon] admin/subscriptions:manual-create:post', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.put('/admin/subscriptions/:operatorId', async (req, res) => {
  try {
    await svc.updateAdminSubscription(req.params.operatorId, req.body || {});
    res.json({ ok: true });
  } catch (err) {
    if (err?.code === 'MISSING_OPERATOR_ID') {
      return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    }
    if (err?.code === 'UPGRADE_MUST_BE_HIGHER_TIER') {
      return res.status(400).json({ ok: false, reason: 'UPGRADE_MUST_BE_HIGHER_TIER' });
    }
    if (err?.code === 'RENEW_PLAN_MISMATCH') {
      return res.status(400).json({ ok: false, reason: 'RENEW_PLAN_MISMATCH' });
    }
    if (err?.code === 'MANUAL_BILLING_REQUIRES_PAYMENT') {
      return res.status(400).json({ ok: false, reason: 'MANUAL_BILLING_REQUIRES_PAYMENT' });
    }
    console.error('[cleanlemon] admin/subscriptions:update:put', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.put('/admin/subscriptions/:operatorId/terminate', async (req, res) => {
  try {
    await svc.terminateAdminSubscription(req.params.operatorId, req.body || {});
    res.json({ ok: true });
  } catch (err) {
    if (err?.code === 'MISSING_OPERATOR_ID') {
      return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    }
    console.error('[cleanlemon] admin/subscriptions:terminate:put', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/admin/property-names', async (req, res) => {
  try {
    const q = req.query.q;
    const limit = req.query.limit;
    const names = await svc.adminListGlobalDistinctPropertyNamesAdmin({
      q: q != null ? String(q) : '',
      limit: limit != null ? Number(limit) : 200,
    });
    res.json({ ok: true, names });
  } catch (err) {
    console.error('[cleanlemon] admin/property-names:get', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/admin/properties', async (req, res) => {
  try {
    const q = req.query.q;
    const limit = req.query.limit;
    const items = await svc.adminListAllClnPropertiesBrief({
      q: q != null ? String(q) : '',
      limit: limit != null ? Number(limit) : 100,
    });
    res.json({ ok: true, items });
  } catch (err) {
    console.error('[cleanlemon] admin/properties:get', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/admin/properties/:propertyId/delete-preview', async (req, res) => {
  try {
    const out = await svc.adminGetClnPropertyDeletePreview(req.params.propertyId);
    res.json({ ok: true, ...out });
  } catch (err) {
    if (err?.code === 'MISSING_PROPERTY_ID' || err?.code === 'PROPERTY_NOT_FOUND') {
      return res.status(404).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] admin/properties/:propertyId/delete-preview:get', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/admin/properties/:propertyId/delete', async (req, res) => {
  try {
    const out = await svc.adminDeleteClnPropertyCascade(req.params.propertyId);
    res.json({ ok: true, ...out });
  } catch (err) {
    if (err?.code === 'MISSING_PROPERTY_ID' || err?.code === 'PROPERTY_NOT_FOUND') {
      return res.status(404).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] admin/properties/:propertyId/delete:post', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/admin/operators-brief', async (req, res) => {
  try {
    const q = req.query.q;
    const limit = req.query.limit;
    const items = await svc.adminSearchOperatorsBrief({
      q: q != null ? String(q) : '',
      limit: limit != null ? Number(limit) : 80,
    });
    res.json({ ok: true, items });
  } catch (err) {
    console.error('[cleanlemon] admin/operators-brief:get', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.get('/admin/clientdetails-brief', async (req, res) => {
  try {
    const q = req.query.q;
    const limit = req.query.limit;
    const items = await svc.adminSearchClientdetailsBrief({
      q: q != null ? String(q) : '',
      limit: limit != null ? Number(limit) : 80,
    });
    res.json({ ok: true, items });
  } catch (err) {
    console.error('[cleanlemon] admin/clientdetails-brief:get', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/admin/properties/merge-names', async (req, res) => {
  try {
    const out = await svc.adminMergeClnPropertyNames(req.body || {});
    res.json({ ok: true, ...out });
  } catch (err) {
    if (err?.code === 'MISSING_NAMES' || err?.code === 'SAME_NAME') {
      return res.status(400).json({ ok: false, reason: err.code });
    }
    console.error('[cleanlemon] admin/properties/merge-names:post', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/admin/properties/transfer', async (req, res) => {
  try {
    const out = await svc.adminTransferClnProperty(req.body || {});
    res.json({ ok: true, ...out });
  } catch (err) {
    const code = err?.code;
    if (
      code === 'MISSING_PROPERTY_ID' ||
      code === 'MISSING_TARGET' ||
      code === 'PROPERTY_NOT_FOUND' ||
      code === 'CLIENTDETAIL_NOT_FOUND' ||
      code === 'OPERATOR_COLUMN_MISSING' ||
      code === 'CLIENTDETAIL_COLUMN_MISSING' ||
      code === 'NOTHING_TO_UPDATE'
    ) {
      return res.status(400).json({ ok: false, reason: code });
    }
    if (code === 'OPERATORDETAIL_REQUIRED' || code === 'MISSING_OPERATOR_ID') {
      return res.status(400).json({ ok: false, reason: code });
    }
    console.error('[cleanlemon] admin/properties/transfer:post', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/admin/subscriptions/:operatorId/addons', async (req, res) => {
  try {
    await svc.addAdminSubscriptionAddon(req.params.operatorId, req.body || {});
    res.json({ ok: true });
  } catch (err) {
    if (err?.code === 'MISSING_ADDON_CODE') {
      return res.status(400).json({ ok: false, reason: 'MISSING_ADDON_CODE' });
    }
    if (err?.code === 'ADDON_ALREADY_ACTIVE') {
      return res.status(400).json({ ok: false, reason: 'ADDON_ALREADY_ACTIVE' });
    }
    if (err?.code === 'ACCOUNTING_REQUIRES_PAYMENT_METHOD') {
      return res.status(400).json({ ok: false, reason: 'ACCOUNTING_REQUIRES_PAYMENT_METHOD' });
    }
    if (err?.code === 'ADDON_INVOICE_AMOUNT_INVALID') {
      return res.status(400).json({ ok: false, reason: 'ADDON_INVOICE_AMOUNT_INVALID' });
    }
    if (err?.code === 'MISSING_OPERATOR_ID') {
      return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    }
    console.error('[cleanlemon] admin/subscriptions:addon:post', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

/** Platform operator-AI constraint rules (`cln_saasadmin_ai_md`). SaaS admin JWT only. */
router.get('/admin/saasadmin-ai-md', async (req, res) => {
  try {
    const allowed = await ensureCleanlemonSaasAdmin(req, res);
    if (!allowed) return;
    const items = await clnSaasAiMd.listSaasadminAiMd();
    res.json({ ok: true, items });
  } catch (err) {
    console.error('[cleanlemon] admin/saasadmin-ai-md:get', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/admin/saasadmin-ai-md', async (req, res) => {
  try {
    const allowed = await ensureCleanlemonSaasAdmin(req, res);
    if (!allowed) return;
    const row = await clnSaasAiMd.createSaasadminAiMd(req.body || {});
    res.json({ ok: true, item: row });
  } catch (err) {
    const msg = String(err?.message || '');
    if (msg === 'TITLE_REQUIRED') {
      return res.status(400).json({ ok: false, reason: msg });
    }
    console.error('[cleanlemon] admin/saasadmin-ai-md:post', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.put('/admin/saasadmin-ai-md/:id', async (req, res) => {
  try {
    const allowed = await ensureCleanlemonSaasAdmin(req, res);
    if (!allowed) return;
    const row = await clnSaasAiMd.updateSaasadminAiMd(req.params.id, req.body || {});
    res.json({ ok: true, item: row });
  } catch (err) {
    const msg = String(err?.message || '');
    if (msg === 'TITLE_REQUIRED' || msg === 'NOTHING_TO_UPDATE') {
      return res.status(400).json({ ok: false, reason: msg });
    }
    if (msg === 'NOT_FOUND') {
      return res.status(404).json({ ok: false, reason: msg });
    }
    console.error('[cleanlemon] admin/saasadmin-ai-md:put', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.delete('/admin/saasadmin-ai-md/:id', async (req, res) => {
  try {
    const allowed = await ensureCleanlemonSaasAdmin(req, res);
    if (!allowed) return;
    await clnSaasAiMd.deleteSaasadminAiMd(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    const msg = String(err?.message || '');
    if (msg === 'MISSING_ID' || msg === 'NOT_FOUND') {
      return res.status(msg === 'NOT_FOUND' ? 404 : 400).json({ ok: false, reason: msg });
    }
    console.error('[cleanlemon] admin/saasadmin-ai-md:delete', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

/** Assist chat for drafting rules — uses `CLEANLEMON_SAASADMIN_AI_*` env (not operator keys). */
router.post('/admin/saasadmin-ai-chat', async (req, res) => {
  try {
    const allowed = await ensureCleanlemonSaasAdmin(req, res);
    if (!allowed) return;
    const out = await clnSaasAiMd.runSaasadminAiChat(req.body || {});
    res.json({ ok: true, ...out });
  } catch (err) {
    const msg = String(err?.message || '');
    const code = String(err?.code || '');
    if (msg === 'EMPTY_MESSAGES') {
      return res.status(400).json({ ok: false, reason: msg });
    }
    if (code === 'SAASADMIN_AI_NOT_CONFIGURED' || msg === 'SAASADMIN_AI_NOT_CONFIGURED') {
      return res.status(503).json({ ok: false, reason: 'SAASADMIN_AI_NOT_CONFIGURED' });
    }
    console.error('[cleanlemon] admin/saasadmin-ai-chat:post', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

/** Singleton: allow operator schedule AI + optional scope list (`cln_saasadmin_operator_ai_policy`). SaaS admin JWT. */
router.get('/admin/operator-ai-access', async (req, res) => {
  try {
    const allowed = await ensureCleanlemonSaasAdmin(req, res);
    if (!allowed) return;
    const policy = await clnSaasAiMd.getOperatorAiAccessPolicy();
    res.json({ ok: true, policy });
  } catch (err) {
    console.error('[cleanlemon] admin/operator-ai-access:get', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.put('/admin/operator-ai-access', async (req, res) => {
  try {
    const allowed = await ensureCleanlemonSaasAdmin(req, res);
    if (!allowed) return;
    const policy = await clnSaasAiMd.updateOperatorAiAccessPolicy(req.body || {});
    res.json({ ok: true, policy });
  } catch (err) {
    console.error('[cleanlemon] admin/operator-ai-access:put', err);
    res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

/** Employee (requester) — active route order they placed (not the driver “active trip” endpoint). */
router.get('/employee/driver-trips/requester-active', async (req, res) => {
  try {
    const email = employeePortalEmailStrict(req);
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const operatorId = String(req.query.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const out = await svc.getActiveRequesterDriverTripForEmail({ email, operatorId });
    if (!out.ok && out.reason === 'MIGRATION_REQUIRED') {
      return res.status(503).json(out);
    }
    return res.json(out);
  } catch (err) {
    const code = err?.code;
    if (code === 'OPERATOR_ACCESS_DENIED' || code === 'MISSING_OPERATOR_OR_EMAIL') {
      return res.status(403).json({ ok: false, reason: code });
    }
    console.error('[cleanlemon] employee/driver-trips/requester-active', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

/** Employee (requester) — past route orders (completed / cancelled) for this operator. */
router.get('/employee/driver-trips/requester-history', async (req, res) => {
  try {
    const email = employeePortalEmailStrict(req);
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const operatorId = String(req.query.operatorId || '').trim();
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const out = await svc.listRequesterDriverTripHistoryForEmail({
      email,
      operatorId,
      limit: req.query.limit,
    });
    if (!out.ok && out.reason === 'MIGRATION_REQUIRED') {
      return res.status(503).json(out);
    }
    return res.json(out);
  } catch (err) {
    const code = err?.code;
    if (code === 'OPERATOR_ACCESS_DENIED' || code === 'MISSING_OPERATOR_OR_EMAIL') {
      return res.status(403).json({ ok: false, reason: code });
    }
    console.error('[cleanlemon] employee/driver-trips/requester-history', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/employee/driver-trips/requester-cancel', async (req, res) => {
  try {
    const email = employeePortalEmailStrict(req);
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    const operatorId = String(req.body?.operatorId || '').trim();
    const tripId = String(req.body?.tripId || '').trim();
    const out = await svc.cancelRequesterDriverTrip({ email, operatorId, tripId });
    return res.json(out);
  } catch (err) {
    const code = err?.code;
    if (code === 'TRIP_NOT_CANCELLABLE' || code === 'BAD_REQUEST') {
      return res.status(400).json({ ok: false, reason: code });
    }
    if (code === 'NOT_FOUND') return res.status(404).json({ ok: false, reason: code });
    if (code === 'OPERATOR_ACCESS_DENIED' || code === 'MISSING_OPERATOR_OR_EMAIL') {
      return res.status(403).json({ ok: false, reason: code });
    }
    console.error('[cleanlemon] employee/driver-trips/requester-cancel', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

/** Operator — list + Grab booking. */
router.get('/operator/driver-trips', async (req, res) => {
  try {
    const { email } = clientPortalAuthFromRequest(req, req.query?.email);
    const operatorId = String(req.query.operatorId || '').trim();
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const statusFilter = String(req.query.status || '').trim();
    const limit = req.query.limit;
    const businessDate = String(req.query.businessDate || req.query.date || '').trim();
    const team = String(req.query.team || '').trim();
    const fulfillment = String(req.query.fulfillment || '').trim();
    const acceptedDriverEmployeeId = String(req.query.acceptedDriverEmployeeId || '').trim();
    const out = await svc.listOperatorDriverTrips({
      email,
      operatorId,
      statusFilter,
      limit,
      businessDate: businessDate || undefined,
      team: team || undefined,
      fulfillment: fulfillment || undefined,
      acceptedDriverEmployeeId: acceptedDriverEmployeeId || undefined,
    });
    if (!out.ok && out.reason === 'MIGRATION_REQUIRED') {
      return res.status(503).json(out);
    }
    return res.json(out);
  } catch (err) {
    const code = err?.code;
    if (code === 'OPERATOR_ACCESS_DENIED' || code === 'MISSING_OPERATOR_OR_EMAIL') {
      return res.status(403).json({ ok: false, reason: code });
    }
    console.error('[cleanlemon] operator/driver-trips:get', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

/** Operator — driver staff rows (for A/B/C filters). */
router.get('/operator/driver-employees', async (req, res) => {
  try {
    const { email } = clientPortalAuthFromRequest(req, req.query?.email);
    const operatorId = String(req.query.operatorId || '').trim();
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const out = await svc.listOperatorDriverEmployees({ email, operatorId });
    return res.json(out);
  } catch (err) {
    const code = err?.code;
    if (code === 'OPERATOR_ACCESS_DENIED' || code === 'MISSING_OPERATOR_OR_EMAIL') {
      return res.status(403).json({ ok: false, reason: code });
    }
    console.error('[cleanlemon] operator/driver-employees:get', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

/** Operator — live driver vacancy / waiting / pickup / ongoing. */
router.get('/operator/driver-fleet-status', async (req, res) => {
  try {
    const { email } = clientPortalAuthFromRequest(req, req.query?.email);
    const operatorId = String(req.query.operatorId || '').trim();
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const out = await svc.listOperatorDriverFleetStatus({ email, operatorId });
    if (!out.ok && out.reason === 'MIGRATION_REQUIRED') {
      return res.status(503).json(out);
    }
    return res.json(out);
  } catch (err) {
    const code = err?.code;
    if (code === 'OPERATOR_ACCESS_DENIED' || code === 'MISSING_OPERATOR_OR_EMAIL') {
      return res.status(403).json({ ok: false, reason: code });
    }
    console.error('[cleanlemon] operator/driver-fleet-status:get', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.post('/operator/driver-trip/grab', async (req, res) => {
  try {
    const { email } = clientPortalAuthFromRequest(req, req.body?.email);
    const body = req.body || {};
    const operatorId = String(body.operatorId || '').trim();
    if (!email) return res.status(401).json({ ok: false, reason: 'UNAUTHORIZED' });
    if (!operatorId) return res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    const out = await svc.bookGrabOperatorDriverTrip({
      email,
      operatorId,
      tripId: body.tripId,
      grabCarPlate: body.grabCarPlate ?? body.grab_car_plate,
      grabPhone: body.grabPhone ?? body.grab_phone,
      grabProofImageUrl: body.grabProofImageUrl ?? body.grab_proof_image_url,
    });
    return res.json(out);
  } catch (err) {
    const code = err?.code;
    if (code === 'GRAB_DETAILS_REQUIRED' || code === 'TRIP_NOT_OPEN' || code === 'BAD_REQUEST') {
      return res.status(400).json({ ok: false, reason: code });
    }
    if (code === 'NOT_FOUND') return res.status(404).json({ ok: false, reason: code });
    if (code === 'OPERATOR_ACCESS_DENIED' || code === 'MISSING_OPERATOR_OR_EMAIL') {
      return res.status(403).json({ ok: false, reason: code });
    }
    console.error('[cleanlemon] operator/driver-trip/grab:post', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'DB_ERROR' });
  }
});

router.use(require('./cleanlemon-smartdoor.routes'));

module.exports = router;
