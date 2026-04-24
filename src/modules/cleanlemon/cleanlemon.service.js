/**
 * Cleanlemons SaaS — read models backed by cln_* tables (Wix CSV import).
 */

const crypto = require('crypto');
const axios = require('axios');
const pool = require('../../config/db');
const { resolveClnOperatordetailTable } = require('../../config/clnOperatordetailTable');
const clnIntegration = require('./cleanlemon-integration.service');
const { syncClnOperatorAccountingMappings } = require('../account/account.service');
const {
  getPortalProfile,
  updatePortalProfile,
  ensurePortalAccountByEmail,
} = require('../portal-auth/portal-auth.service');
const { sendTransactionalEmail } = require('../portal-auth/portal-password-reset-sender');
const contactSync = require('../contact/contact-sync.service');
const contactService = require('../contact/contact.service');
const clnOpInvAccounting = require('./cleanlemon-operator-invoice-accounting.service');
const clnDc = require('./cleanlemon-cln-domain-contacts');
const saasBukku = require('../billing/saas-bukku.service');
const { splitAddressWazeGoogleFromText, resolveClnPropertyNavigationUrls } = require('./cln-property-address-split');
const {
  malaysiaWallClockToUtcDatetimeForDb,
  getTodayMalaysiaDate,
  getMalaysiaMonthStartYmd,
  malaysiaDateToUtcDatetimeForDb,
} = require('../../utils/dateMalaysia');
const {
  validateBookingLeadTimeForConfig,
  validateServiceInSelectedServices,
} = require('../../utils/cleanlemonBookingEligibility');
const { schedulePhotoDisplayUrl } = require('../../utils/schedulePhotoDisplayUrl');
const clnPropGroup = require('./cleanlemon-property-group.service');
const clnOperatorSalary = require('./cleanlemon-operator-salary.service');

/** Malaysia YYYY-MM-DD from UTC-stored `cln_schedule.working_day` (pool +00:00). Matches operator schedule filter + AI chat. */
const SQL_CLN_SCHEDULE_JOB_DATE_KL_YMD = `DATE_FORMAT(CONVERT_TZ(s.working_day, '+00:00', 'Asia/Kuala_Lumpur'), '%Y-%m-%d')`;
const SQL_CLN_SCHEDULE_WORKING_DAY_KL_YMD_BARE = `DATE_FORMAT(CONVERT_TZ(working_day, '+00:00', 'Asia/Kuala_Lumpur'), '%Y-%m-%d')`;

/**
 * Scalar SQL fragment: human name for `s.staff_start_email` / `s.staff_end_email` (KPI report).
 * Order: employeedetail.full_name (when linked to this operator) → portal_account.fullname → first+last.
 * Fallback: portal_account only (staff may have login profile without employeedetail row or with empty full_name).
 */
function sqlScheduleStaffDisplayNameRaw(staffEmailCol) {
  return `COALESCE(
  (SELECT NULLIF(TRIM(COALESCE(
       NULLIF(TRIM(d.full_name), ''),
       NULLIF(TRIM(pa.fullname), ''),
       NULLIF(TRIM(CONCAT_WS(' ', NULLIF(TRIM(pa.first_name),''), NULLIF(TRIM(pa.last_name),''))), '')
     )), '')
   FROM cln_employeedetail d
   INNER JOIN cln_employee_operator eo ON eo.employee_id = d.id AND eo.operator_id = p.operator_id
   LEFT JOIN portal_account pa ON LOWER(TRIM(pa.email)) = LOWER(TRIM(d.email))
   WHERE NULLIF(TRIM(s.${staffEmailCol}), '') IS NOT NULL
     AND LOWER(TRIM(d.email)) = LOWER(TRIM(s.${staffEmailCol}))
   LIMIT 1),
  (SELECT NULLIF(TRIM(COALESCE(
       NULLIF(TRIM(pa2.fullname), ''),
       NULLIF(TRIM(CONCAT_WS(' ', NULLIF(TRIM(pa2.first_name),''), NULLIF(TRIM(pa2.last_name),''))), '')
     )), '')
   FROM portal_account pa2
   WHERE NULLIF(TRIM(s.${staffEmailCol}), '') IS NOT NULL
     AND LOWER(TRIM(pa2.email)) = LOWER(TRIM(s.${staffEmailCol}))
   LIMIT 1)
)`;
}

const CLN_ACCOUNT_PROVIDERS = ['bukku', 'xero', 'autocount', 'sql'];
const CLN_DEFAULT_CURRENCY = (process.env.CLEANLEMON_DEFAULT_CURRENCY || 'MYR').trim().toUpperCase() || 'MYR';
let _clnAgreementExtraColsEnsured = false;

function normalizeOperatorCleaningPricingRowInput(o) {
  const service = String(o?.service ?? o?.serviceKey ?? '').trim().slice(0, 64);
  const line = String(o?.line ?? '').trim().slice(0, 128);
  const n = Number(o?.myr);
  const myr =
    o?.myr === null || o?.myr === '' || o?.myr === undefined
      ? null
      : Number.isFinite(n) && n >= 0
        ? n
        : null;
  return { service: service || 'general', line, myr };
}

function normalizeOperatorCleaningPricingRowsInput(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((x) => normalizeOperatorCleaningPricingRowInput(x)).filter((r) => r.service);
}

function parseOperatorCleaningPricingRowsFromDb({
  jsonRaw,
  operatorCleaningPricingService,
  operatorCleaningPricingLine,
  operatorCleaningPriceMyr,
  /** Legacy Wix / import column `cleaning_fees` when operator_* pricing columns were never set. */
  cleaningFeesMyr,
}) {
  const legacySvc = String(operatorCleaningPricingService ?? '').trim();
  const legacyLine = String(operatorCleaningPricingLine ?? '').trim();
  const lp = operatorCleaningPriceMyr;
  const legacyMyr =
    lp != null && lp !== '' && Number.isFinite(Number(lp)) && Number(lp) >= 0 ? Number(lp) : null;
  const raw = jsonRaw != null ? String(jsonRaw).trim() : '';
  if (raw) {
    try {
      const j = JSON.parse(raw);
      if (Array.isArray(j) && j.length) {
        const n = normalizeOperatorCleaningPricingRowsInput(j);
        if (n.length) return n;
      }
    } catch (_) {
      /* ignore */
    }
  }
  if (legacySvc || legacyLine || legacyMyr != null) {
    return [
      normalizeOperatorCleaningPricingRowInput({
        service: legacySvc || 'general',
        line: legacyLine,
        myr: legacyMyr,
      }),
    ];
  }
  const cf = cleaningFeesMyr;
  const feeMyr =
    cf != null && cf !== '' && Number.isFinite(Number(cf)) && Number(cf) >= 0 ? Number(cf) : null;
  if (feeMyr != null) {
    return [normalizeOperatorCleaningPricingRowInput({ service: 'homestay', line: '', myr: feeMyr })];
  }
  return [];
}

/** `min_value` minutes → operator UI placeholder style e.g. `2h 30m`. */
function formatClnMinValueAsEstimatedTimeLabel(minVal) {
  if (minVal == null || minVal === '') return '';
  const n = Math.max(0, Math.floor(Number(minVal)));
  if (!Number.isFinite(n) || n <= 0) return '';
  const h = Math.floor(n / 60);
  const r = n % 60;
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (r) parts.push(`${r}m`);
  return parts.join(' ') || '';
}

/** Parse optional estimate field into minutes for `cln_property.min_value`. */
function parseClnEstimateTimeInputToMinutes(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  let total = 0;
  const hMatch = s.match(/(\d+)\s*h/);
  const mMatch = s.match(/(\d+)\s*m/);
  if (hMatch) total += parseInt(hMatch[1], 10) * 60;
  if (mMatch) total += parseInt(mMatch[1], 10);
  if (hMatch || mMatch) return total;
  const n = Number(s);
  if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  return null;
}

/**
 * Wix `warmcleaning` / `deepcleaning` / … columns on `cln_property` → extra operator pricing rows.
 * Skips a service key already present in `rows` (so JSON / operator_* wins over legacy columns).
 */
function mergeClnLegacyWixCleaningPricesIntoPricingRows(rows, legacy) {
  const out = Array.isArray(rows) ? rows.map((r) => ({ ...r })) : [];
  const seen = new Set(
    out.map((r) => String(r.service || '').trim().toLowerCase()).filter(Boolean)
  );
  const pushIf = (serviceKey, myrRaw) => {
    const sk = String(serviceKey || '').trim().toLowerCase();
    if (!sk || seen.has(sk)) return;
    if (myrRaw == null || myrRaw === '') return;
    const n = Number(myrRaw);
    if (!Number.isFinite(n) || n < 0) return;
    const rowN = normalizeOperatorCleaningPricingRowInput({ service: sk, line: '', myr: n });
    if (!rowN.service) return;
    out.push(rowN);
    seen.add(sk);
  };
  if (!legacy || typeof legacy !== 'object') return out;
  pushIf('warm', legacy.warmCleaning ?? legacy.warmcleaning);
  pushIf('deep', legacy.deepCleaning ?? legacy.deepcleaning);
  pushIf('general', legacy.generalCleaning ?? legacy.generalcleaning);
  pushIf('renovation', legacy.renovationCleaning ?? legacy.renovationcleaning);
  pushIf('homestay', legacy.cleaningFees ?? legacy.cleaning_fees);
  return out;
}

/** Cached: Cleanlemons company master — `cln_operatordetail` (0198), else `cln_operator` / `cln_client`. */
let _clnCompanyTableCache = null;

async function getClnCompanyTable() {
  if (_clnCompanyTableCache) return _clnCompanyTableCache;
  try {
    const t = await resolveClnOperatordetailTable();
    _clnCompanyTableCache = t;
    if (t === 'cln_client') {
      console.warn('[cleanlemon] Using legacy table `cln_client`; run 0182 then 0198 when ready.');
    } else if (t === 'cln_operator') {
      console.warn(
        '[cleanlemon] Using `cln_operator`; run 0198_rename_cln_operator_to_cln_operatordetail.sql for `cln_operatordetail`.'
      );
    } else {
      console.log('[cleanlemon] company master table: %s', t);
    }
  } catch (_) {
    _clnCompanyTableCache = 'cln_operator';
  }
  return _clnCompanyTableCache;
}

/** Subscription rows must reference an existing Cleanlemons company master row (cln_operatordetail after 0198). */
async function assertClnOperatorMasterRowExists(operatorId) {
  const id = String(operatorId || '').trim();
  if (!id) {
    const err = new Error('MISSING_OPERATOR_ID');
    err.code = 'MISSING_OPERATOR_ID';
    throw err;
  }
  const ct = await getClnCompanyTable();
  const [[row]] = await pool.query(`SELECT 1 AS ok FROM \`${ct}\` WHERE id = ? LIMIT 1`, [id]);
  if (!row?.ok) {
    const err = new Error(
      'OPERATORDETAIL_REQUIRED: create the company row (cln_operatordetail) before subscription or portal operator access.'
    );
    err.code = 'OPERATORDETAIL_REQUIRED';
    throw err;
  }
}

function ymdKualaLumpurFromUnixSeconds(sec) {
  const n = Number(sec);
  const ms = Number.isFinite(n) && n > 0 ? n * 1000 : Date.now();
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

/** Kuala Lumpur calendar date for “today” (form item Active date). */
function todayYmdKualaLumpurFromNow() {
  return ymdKualaLumpurFromUnixSeconds(Math.floor(Date.now() / 1000));
}

/**
 * Read company display fields from `cln_operatordetail` (or legacy company master table name).
 */
async function fetchClnOperatordetailCompanyAndEmail(operatorId) {
  const id = String(operatorId || '').trim();
  if (!id) return null;
  const ct = await getClnCompanyTable();
  try {
    const [[r]] = await pool.query(
      `SELECT COALESCE(name, '') AS name, COALESCE(email, '') AS email FROM \`${ct}\` WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!r) return null;
    return {
      companyName: String(r.name || '').trim() || `Operator ${id}`.slice(0, 100),
      email: String(r.email || '').trim(),
    };
  } catch (e) {
    if (e?.code === 'ER_BAD_FIELD_ERROR') return null;
    throw e;
  }
}

/** Reserved URL segments — keep aligned with `cleanlemon/next-app/lib/cleanlemon-public-subdomain-reserved.ts`. */
const CLN_PUBLIC_SUBDOMAIN_RESERVED = new Set([
  'login',
  'register',
  'pricing',
  'privacy-policy',
  'refund-policy',
  'terms-and-conditions',
  'enquiry',
  'admin',
  'portal',
  'auth',
  'operator',
  'client',
  'employee',
  'linens',
  'api',
  '_next',
  'favicon',
  'favicon.ico',
  'robots',
  'robots.txt',
  'static',
  'assets',
  'images',
  'payment',
  'm',
  'p',
  'staff',
  'supervisor',
  'dobi',
  'driver',
  'saas-admin',
  'api-integration',
  'null',
  'undefined',
  'wp-admin',
]);

function normalizePublicSubdomainInput(raw) {
  if (raw == null) return '';
  return String(raw).trim().toLowerCase();
}

function validatePublicSubdomainValue(normalized) {
  if (!normalized) return { ok: true, normalized: null, clear: true };
  if (normalized.length > 64) return { ok: false, reason: 'SUBDOMAIN_TOO_LONG' };
  if (CLN_PUBLIC_SUBDOMAIN_RESERVED.has(normalized)) return { ok: false, reason: 'SUBDOMAIN_RESERVED' };
  if (!/^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/.test(normalized)) {
    return { ok: false, reason: 'SUBDOMAIN_INVALID_FORMAT' };
  }
  return { ok: true, normalized, clear: false };
}

/** Subdomain is mandatory: must be set and valid on `settings.publicSubdomain` (from DB via getOperatorSettings). */
function clnOperatorPublicSubdomainComplete(settings) {
  if (!settings || typeof settings !== 'object') return false;
  const pubSub = normalizePublicSubdomainInput(settings.publicSubdomain);
  if (!pubSub) return false;
  const v = validatePublicSubdomainValue(pubSub);
  return !!(v.ok && !v.clear);
}

async function fetchClnOperatordetailPublicSubdomain(operatorId) {
  const id = String(operatorId || '').trim();
  if (!id) return '';
  const ct = await getClnCompanyTable();
  const has = await databaseHasColumn(ct, 'public_subdomain');
  if (!has) return '';
  try {
    const [[r]] = await pool.query(`SELECT public_subdomain FROM \`${ct}\` WHERE id = ? LIMIT 1`, [id]);
    const v = r?.public_subdomain;
    return v != null ? String(v).trim().toLowerCase() : '';
  } catch (e) {
    if (e?.code === 'ER_BAD_FIELD_ERROR') return '';
    throw e;
  }
}

async function upsertOperatorPublicSubdomain(operatorId, raw) {
  const id = String(operatorId || '').trim();
  if (!id) return { ok: false, reason: 'MISSING_OPERATOR_ID' };
  await assertClnOperatorMasterRowExists(id);
  const ct = await getClnCompanyTable();
  const has = await databaseHasColumn(ct, 'public_subdomain');
  if (!has) return { ok: false, reason: 'PUBLIC_SUBDOMAIN_COLUMN_MISSING' };
  const norm = normalizePublicSubdomainInput(raw);
  const v = validatePublicSubdomainValue(norm);
  if (!v.ok) return { ok: false, reason: v.reason };
  if (v.clear) {
    return { ok: false, reason: 'SUBDOMAIN_REQUIRED' };
  }
  const [[taken]] = await pool.query(
    `SELECT id FROM \`${ct}\` WHERE public_subdomain <=> ? AND id != ? LIMIT 1`,
    [v.normalized, id]
  );
  if (taken?.id) return { ok: false, reason: 'SUBDOMAIN_TAKEN' };
  await pool.query(`UPDATE \`${ct}\` SET public_subdomain = ?, updated_at = NOW(3) WHERE id = ?`, [
    v.normalized,
    id,
  ]);
  return { ok: true };
}

function sanitizePricingConfigForPublic(cfg) {
  if (!cfg || typeof cfg !== 'object') return null;
  const keys = [
    'selectedServices',
    'activeServiceTab',
    'serviceConfigs',
    'bookingMode',
    'bookingModeByService',
    'leadTime',
    'leadTimeByService',
  ];
  const out = {};
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(cfg, k)) out[k] = cfg[k];
  }
  return Object.keys(out).length ? out : null;
}

/** Public marketing page: safe subset of `companyProfile` (no bank, chop, etc.). */
function sanitizeCompanyProfileForPublicMarketing(settings) {
  const cp =
    settings && typeof settings === 'object' && settings.companyProfile && typeof settings.companyProfile === 'object'
      ? settings.companyProfile
      : {};
  return {
    displayName: String(cp.companyName || '').trim(),
    logoUrl: String(cp.logoUrl || '').trim(),
    contact: String(cp.contact || '').trim(),
    address: String(cp.address || '').trim(),
  };
}

async function getPublicMarketingPricingBySubdomain(slugRaw) {
  const slug = normalizePublicSubdomainInput(slugRaw);
  if (!slug) return { ok: false, reason: 'MISSING_SLUG' };
  if (CLN_PUBLIC_SUBDOMAIN_RESERVED.has(slug)) return { ok: false, reason: 'NOT_FOUND' };
  const v = validatePublicSubdomainValue(slug);
  if (!v.ok || v.clear) return { ok: false, reason: 'NOT_FOUND' };
  const ct = await getClnCompanyTable();
  const has = await databaseHasColumn(ct, 'public_subdomain');
  if (!has) return { ok: false, reason: 'NOT_CONFIGURED' };
  const [[row]] = await pool.query(
    `SELECT id, COALESCE(name, '') AS name FROM \`${ct}\` WHERE public_subdomain <=> ? LIMIT 1`,
    [slug]
  );
  if (!row?.id) return { ok: false, reason: 'NOT_FOUND' };
  const oid = String(row.id);
  const pricing = await getPricingConfig(oid);
  const config = sanitizePricingConfigForPublic(pricing);
  const settings = await getOperatorSettings(oid);
  const pubCo = sanitizeCompanyProfileForPublicMarketing(settings);
  const dbName = String(row.name || '').trim();
  const displayName = pubCo.displayName || dbName || 'Cleaning services';
  return {
    ok: true,
    operatorId: oid,
    companyName: displayName,
    company: {
      displayName,
      logoUrl: pubCo.logoUrl || '',
      contact: pubCo.contact || '',
      address: pubCo.address || '',
    },
    pricing: config,
  };
}

/**
 * Some DBs have `cln_operator_subscription` but no matching `cln_operatordetail` (e.g. demo / migrated rows).
 * Platform Bukku + `cln_addonlog` FK require a company row. Backfill minimal fields from subscription when possible.
 */
/**
 * @param {string} operatorId
 * @param {{ fallbackEmail?: string, fallbackName?: string }} [opts] — Stripe metadata when subscription row is missing under this id (legacy client id vs canonical UUID).
 */
async function ensureClnOperatordetailRowFromSubscription(operatorId, opts = {}) {
  const id = String(operatorId || '').trim();
  if (!id) return { ok: false, reason: 'MISSING_OPERATOR_ID' };
  const ct = await getClnCompanyTable();
  const [[exists]] = await pool.query(`SELECT 1 AS ok FROM \`${ct}\` WHERE id = ? LIMIT 1`, [id]);
  if (exists?.ok) return { ok: true, backfilled: false };

  async function insertMinimalOperatordetail(emailInput, nameInput, source) {
    const email = String(emailInput || '').trim().toLowerCase() || null;
    const name = String(nameInput || '').trim() || `Operator ${id}`.slice(0, 120);
    try {
      await pool.query(
        `INSERT INTO \`${ct}\` (id, email, name, phone, created_at, updated_at)
         VALUES (?, ?, ?, NULL, NOW(3), NOW(3))`,
        [id, email, name]
      );
      console.log('[cleanlemon] backfilled operatordetail row', { operatorId: id, source });
      return { ok: true, backfilled: true, source };
    } catch (e) {
      console.warn('[cleanlemon] backfill operatordetail failed', { operatorId: id, source, err: e?.message || e });
      return { ok: false, reason: e?.code || 'INSERT_OPERATORDETAIL_FAILED' };
    }
  }

  await ensureOperatorSubscriptionTable();
  const [[sub]] = await pool.query(
    `SELECT COALESCE(operator_name, '') AS operatorName, COALESCE(operator_email, '') AS operatorEmail
     FROM cln_operator_subscription WHERE operator_id = ? LIMIT 1`,
    [id]
  );
  const fbEmail = String(opts.fallbackEmail || '').trim().toLowerCase();
  if (!sub) {
    if (fbEmail) {
      const fallbackName =
        String(opts.fallbackName || '').trim() ||
        String(fbEmail.split('@')[0] || '').trim() ||
        `Operator ${id}`.slice(0, 120);
      return insertMinimalOperatordetail(fbEmail, fallbackName, 'stripe_fallback');
    }
    return insertMinimalOperatordetail('', '', 'minimal_no_subscription');
  }
  const email = String(sub.operatorEmail || '').trim().toLowerCase();
  const name = String(sub.operatorName || '').trim() || `Operator ${id}`.slice(0, 120);
  if (!email) {
    return insertMinimalOperatordetail('', name, 'subscription_without_email');
  }
  return insertMinimalOperatordetail(email, name, 'subscription');
}

/** Add `bukku_saas_contact_id` on company master if missing (same as migration 0201). */
async function ensureClnOperatordetailBukkuSaasContactColumn() {
  const ct = await getClnCompanyTable();
  const [[col]] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'bukku_saas_contact_id'`,
    [ct]
  );
  if (Number(col?.c || 0) > 0) return;
  const [[afterBk]] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'bukku_contact_id'`,
    [ct]
  );
  try {
    if (Number(afterBk?.c || 0) > 0) {
      await pool.query(
        `ALTER TABLE \`${ct}\` ADD COLUMN bukku_saas_contact_id INT NULL COMMENT 'Platform SaaS Bukku customer (Cleanlemons billing)' AFTER bukku_contact_id`
      );
    } else {
      await pool.query(
        `ALTER TABLE \`${ct}\` ADD COLUMN bukku_saas_contact_id INT NULL COMMENT 'Platform SaaS Bukku customer (Cleanlemons billing)'`
      );
    }
    console.log('[cleanlemon] added bukku_saas_contact_id on', ct);
  } catch (e) {
    console.warn('[cleanlemon] ensureClnOperatordetailBukkuSaasContactColumn failed', e?.message || e);
  }
}

/**
 * Platform SaaS Bukku contact for Cleanlemons — must run before cash invoice.
 * 1) Read `cln_operatordetail.bukku_saas_contact_id`.
 * 2) If set → return it.
 * 3) Else search platform Bukku by email + legal name (same as company row).
 * 4) If found → persist id on `cln_operatordetail` and return.
 * 5) Else create contact → persist id → return.
 */
async function ensureClnOperatordetailBukkuSaasContact(operatorId) {
  const id = String(operatorId || '').trim();
  if (!id) return null;
  if (!saasBukku.checkSaasBukkuConfiguredForCleanlemons().configured) {
    console.log('[cleanlemon] Bukku SaaS not configured for Cleanlemons — skip ensure contact', { operatorId: id });
    return null;
  }

  /** Cash sales invoice requires Bukku contact type to include `customer` (supplier-only → API 422). */
  async function finalizeBukkuSalesContact(contactId) {
    const n = Number(contactId);
    if (!n) return null;
    const ens = await saasBukku.ensureSaasBukkuContactHasCustomerType(n, true);
    if (!ens.ok) {
      console.warn('[cleanlemon] Bukku contact not usable for sales invoice', {
        operatorId: id,
        contactId: n,
        error: ens.error,
      });
      return null;
    }
    return ens.contactId;
  }

  await ensureClnOperatordetailBukkuSaasContactColumn();
  const ct = await getClnCompanyTable();
  let row;
  try {
    const [[r]] = await pool.query(
      `SELECT id, COALESCE(name, '') AS title, COALESCE(email, '') AS email, bukku_saas_contact_id
       FROM \`${ct}\` WHERE id = ? LIMIT 1`,
      [id]
    );
    row = r;
  } catch (e) {
    if (e?.code === 'ER_BAD_FIELD_ERROR') {
      console.warn('[cleanlemon] bukku_saas_contact_id column still missing after ensure — run migration 0201');
      return null;
    }
    throw e;
  }
  if (!row?.id) return null;
  if (row.bukku_saas_contact_id != null && Number(row.bukku_saas_contact_id) > 0) {
    console.log('[cleanlemon] Bukku SaaS contact: using cached bukku_saas_contact_id', {
      operatorId: id,
      contactId: Number(row.bukku_saas_contact_id),
    });
    return finalizeBukkuSalesContact(row.bukku_saas_contact_id);
  }
  const legalName = String(row.title || '').trim() || `Operator ${id}`.slice(0, 100);
  const email = row.email ? String(row.email).trim() : undefined;
  console.log('[cleanlemon] Bukku SaaS contact: resolving via search/create', { operatorId: id, hasEmail: Boolean(email) });
  const existingId = await saasBukku.findSaasBukkuContactByEmailOrName({ email, legalName, forCleanlemons: true });
  if (existingId != null) {
    await pool.query(`UPDATE \`${ct}\` SET bukku_saas_contact_id = ?, updated_at = NOW(3) WHERE id = ?`, [existingId, id]);
    console.log('[cleanlemon] Bukku SaaS contact: linked existing Bukku contact', { operatorId: id, contactId: existingId });
    return finalizeBukkuSalesContact(existingId);
  }
  const created = await saasBukku.createSaasBukkuContact({
    legalName,
    email,
    defaultCurrencyCode: CLN_DEFAULT_CURRENCY,
    forCleanlemons: true,
  });
  if (!created.ok || created.contactId == null) {
    if (saasBukku.isBukkuDuplicateLegalNameError(created.error)) {
      console.log('[cleanlemon] Bukku contact: duplicate legal_name on create — resolving existing contact', {
        operatorId: id,
      });
      const recovered = await saasBukku.findSaasBukkuContactByEmailOrName({
        email,
        legalName,
        forCleanlemons: true,
      });
      if (recovered != null) {
        await pool.query(`UPDATE \`${ct}\` SET bukku_saas_contact_id = ?, updated_at = NOW(3) WHERE id = ?`, [
          recovered,
          id,
        ]);
        console.log('[cleanlemon] Bukku SaaS contact: recovered after duplicate → saved', {
          operatorId: id,
          contactId: recovered,
        });
        return finalizeBukkuSalesContact(recovered);
      }
    }
    console.warn('[cleanlemon] createSaasBukkuContact failed', id, created.error);
    return null;
  }
  await pool.query(`UPDATE \`${ct}\` SET bukku_saas_contact_id = ?, updated_at = NOW(3) WHERE id = ?`, [created.contactId, id]);
  console.log('[cleanlemon] Bukku SaaS contact: created new and saved', { operatorId: id, contactId: created.contactId });
  return finalizeBukkuSalesContact(created.contactId);
}

/**
 * Cash invoice on platform Bukku for Cleanlemons subscription / add-on (Stripe or manual bank/cash).
 * Order: load company row → ensure Bukku contact id on row → open cash invoice.
 * Form line description: company name + email from DB; Active date = today (Asia/Kuala_Lumpur).
 */
async function issueCleanlemonsPlatformBukkuCashInvoice(opts = {}) {
  const operatorId = String(opts.operatorId || '').trim();
  const amountMyr = Number(opts.amountMyr);
  const invoiceDateYmd = String(opts.invoiceDateYmd || '').slice(0, 10);
  if (!operatorId || !(amountMyr > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(invoiceDateYmd)) {
    console.warn('[cleanlemon] Bukku cash invoice: invalid params', { operatorId, amountMyr, invoiceDateYmd });
    return { ok: false, error: 'INVALID_INVOICE_PARAMS' };
  }
  let profile = await fetchClnOperatordetailCompanyAndEmail(operatorId);
  if (!profile) {
    await ensureClnOperatordetailRowFromSubscription(operatorId, {
      fallbackEmail: opts.fallbackCustomerEmail,
      fallbackName: opts.fallbackCustomerName,
    });
    profile = await fetchClnOperatordetailCompanyAndEmail(operatorId);
  }
  if (!profile) {
    console.warn('[cleanlemon] Bukku cash invoice: no operatordetail row', { operatorId });
    return { ok: false, error: 'OPERATORDETAIL_ROW_MISSING' };
  }
  console.log('[cleanlemon] Bukku cash invoice: start', {
    operatorId,
    amountMyr,
    invoiceDateYmd,
    paymentKind: String(opts.paymentKind || 'stripe').toLowerCase(),
    scenario: opts.scenario || opts.itemSummary || '',
  });
  const contactId = await ensureClnOperatordetailBukkuSaasContact(operatorId);
  if (!contactId) {
    console.warn('[cleanlemon] Bukku cash invoice: skipped — no contact or Bukku not configured', { operatorId });
    return { ok: false, skipped: true, reason: 'no_bukku_contact_or_not_configured' };
  }
  const paymentKind = String(opts.paymentKind || 'stripe').toLowerCase();
  let paymentAccountId = saasBukku.PAYMENT_CLEANLEMON_STRIPE;
  if (paymentKind === 'bank') paymentAccountId = saasBukku.PAYMENT_CLEANLEMON_BANK;
  else if (paymentKind === 'cash') paymentAccountId = saasBukku.PAYMENT_CLEANLEMON_CASH;

  /** Bukku deposit row Payment Method (optional); from Bukku Settings → Payment Methods IDs. */
  let depositPaymentMethodId = null;
  const pmManual = process.env.BUKKU_SAAS_CLEANLEMON_MANUAL_PAYMENT_METHOD_ID;
  const pmStripe = process.env.BUKKU_SAAS_CLEANLEMON_STRIPE_PAYMENT_METHOD_ID;
  if (paymentKind === 'stripe') {
    const v = pmStripe != null && String(pmStripe).trim() ? Number(pmStripe) : NaN;
    if (Number.isFinite(v) && v > 0) depositPaymentMethodId = v;
  } else {
    const v = pmManual != null && String(pmManual).trim() ? Number(pmManual) : NaN;
    if (Number.isFinite(v) && v > 0) depositPaymentMethodId = v;
  }

  const lineDesc = saasBukku.buildCleanlemonPlatformLineDescription({
    companyName: profile.companyName,
    activeDate: todayYmdKualaLumpurFromNow(),
    paymentLabel: opts.paymentLabel,
    email: profile.email || '-',
    itemSummary: opts.itemSummary,
  });

  const inv = await saasBukku.createSaasBukkuCashInvoice({
    contactId,
    productId: saasBukku.PRODUCT_CLEANLEMON,
    accountId: saasBukku.ACCOUNT_CLEANLEMON_REVENUE,
    amount: amountMyr,
    paidDate: invoiceDateYmd,
    paymentAccountId,
    depositPaymentMethodId,
    currencyCode: opts.currencyCode || CLN_DEFAULT_CURRENCY,
    invoiceTitle: String(opts.invoiceTitle || 'Cleanlemons').slice(0, 255),
    lineItemDescription: lineDesc,
    forCleanlemons: true,
  });
  if (inv?.ok) {
    console.log('[cleanlemon] Bukku cash invoice: done', {
      operatorId,
      invoiceId: inv.invoiceId,
      hasUrl: Boolean(inv.invoiceUrl),
    });
    return { ...inv, lineItemDescription: inv.lineItemDescription || lineDesc };
  }
  console.warn('[cleanlemon] Bukku cash invoice: API error', { operatorId, error: inv?.error });
  return inv;
}

/** Audit log for SaaS pricing / platform Bukku invoices (subscription row stays plan + expiry only). */
async function ensureClnPricingplanlogTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS cln_pricingplanlog (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      operator_id CHAR(36) NOT NULL,
      subscription_addon_id VARCHAR(64) DEFAULT NULL,
      log_kind VARCHAR(24) NOT NULL,
      source VARCHAR(64) DEFAULT NULL,
      scenario VARCHAR(64) DEFAULT NULL,
      plan_code VARCHAR(32) DEFAULT NULL,
      billing_cycle VARCHAR(16) DEFAULT NULL,
      addon_code VARCHAR(64) DEFAULT NULL,
      amount_myr DECIMAL(12,2) DEFAULT NULL,
      amount_total_cents INT DEFAULT NULL,
      stripe_session_id VARCHAR(128) DEFAULT NULL,
      invoice_id VARCHAR(100) DEFAULT NULL,
      invoice_url VARCHAR(512) DEFAULT NULL,
      form_item_description VARCHAR(512) DEFAULT NULL,
      meta_json TEXT NULL,
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      KEY idx_cln_ppl_operator_kind_created (operator_id, log_kind, created_at),
      KEY idx_cln_ppl_addon (subscription_addon_id),
      KEY idx_cln_ppl_stripe_kind (stripe_session_id, log_kind)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
  const [fkRows] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'cln_pricingplanlog'
       AND CONSTRAINT_NAME = 'fk_cln_ppl_operatordetail'`
  );
  if (!Number(fkRows?.[0]?.c || 0)) {
    try {
      await pool.query(
        `ALTER TABLE cln_pricingplanlog
         ADD CONSTRAINT fk_cln_ppl_operatordetail
         FOREIGN KEY (operator_id) REFERENCES cln_operatordetail (id)
         ON DELETE RESTRICT ON UPDATE CASCADE`
      );
    } catch (e) {
      if (!String(e?.message || '').includes('Duplicate') && !String(e?.code || '').includes('ER_DUP')) {
        console.warn('[cleanlemon] ensureClnPricingplanlogTable: FK fk_cln_ppl_operatordetail not added', e?.message);
      }
    }
  }
  const [[colPpl]] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cln_pricingplanlog' AND COLUMN_NAME = 'form_item_description'`
  );
  if (!Number(colPpl?.c || 0)) {
    try {
      await pool.query(
        `ALTER TABLE cln_pricingplanlog
         ADD COLUMN form_item_description VARCHAR(512) DEFAULT NULL COMMENT 'Bukku form_items line description'
         AFTER invoice_url`
      );
    } catch (e) {
      if (!String(e?.message || '').includes('Duplicate') && !String(e?.code || '').includes('ER_DUP')) {
        console.warn('[cleanlemon] ensureClnPricingplanlogTable: form_item_description not added', e?.message);
      }
    }
  }
}

/** Add-on lifecycle + platform invoice refs (Bukku); not written to `cln_pricingplanlog`. */
async function ensureClnAddonlogTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS cln_addonlog (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      operator_id CHAR(36) NOT NULL,
      subscription_addon_id VARCHAR(64) DEFAULT NULL,
      event_kind VARCHAR(32) NOT NULL,
      addon_code VARCHAR(64) DEFAULT NULL,
      addon_name VARCHAR(255) DEFAULT NULL,
      amount_myr DECIMAL(12,2) DEFAULT NULL,
      stripe_session_id VARCHAR(128) DEFAULT NULL,
      pricingplanlog_id VARCHAR(64) DEFAULT NULL,
      invoice_id VARCHAR(100) DEFAULT NULL,
      invoice_url VARCHAR(512) DEFAULT NULL,
      form_item_description VARCHAR(512) DEFAULT NULL,
      meta_json TEXT NULL,
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      KEY idx_cln_al_operator_created (operator_id, created_at),
      KEY idx_cln_al_addon_row (subscription_addon_id),
      KEY idx_cln_al_ppl (pricingplanlog_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
  const [fkRowsAl] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'cln_addonlog'
       AND CONSTRAINT_NAME = 'fk_cln_al_operatordetail'`
  );
  if (!Number(fkRowsAl?.[0]?.c || 0)) {
    try {
      await pool.query(
        `ALTER TABLE cln_addonlog
         ADD CONSTRAINT fk_cln_al_operatordetail
         FOREIGN KEY (operator_id) REFERENCES cln_operatordetail (id)
         ON DELETE RESTRICT ON UPDATE CASCADE`
      );
    } catch (e) {
      if (!String(e?.message || '').includes('Duplicate') && !String(e?.code || '').includes('ER_DUP')) {
        console.warn('[cleanlemon] ensureClnAddonlogTable: FK fk_cln_al_operatordetail not added', e?.message);
      }
    }
  }
}

/**
 * After Stripe checkout is paid: link portal operator login via `cln_employeedetail` + `cln_employee_operator`
 * (`staff_role = supervisor`, `crm_json.permissions` includes supervisor). Not called during onboarding pre-payment.
 */
async function linkOperatorSupervisorEmployeeAfterPayment(opts = {}) {
  const operatorId = String(opts.operatorId || '').trim();
  const email = String(opts.email || '')
    .trim()
    .toLowerCase();
  if (!operatorId || !email) return { ok: false, reason: 'MISSING_OPERATOR_OR_EMAIL' };
  if (
    !(await clnDc.databaseHasTable(pool, 'cln_employeedetail')) ||
    !(await clnDc.databaseHasTable(pool, 'cln_employee_operator'))
  ) {
    return { ok: false, reason: 'EMPLOYEE_TABLES_MISSING' };
  }
  await clnDc.ensureClnDomainContactExtras(pool);
  await assertClnOperatorMasterRowExists(operatorId);

  const ct = await getClnCompanyTable();
  let phoneFromCompany = null;
  try {
    const [[crow]] = await pool.query(`SELECT phone FROM \`${ct}\` WHERE id = ? LIMIT 1`, [operatorId]);
    if (crow?.phone != null && String(crow.phone).trim()) phoneFromCompany = String(crow.phone).trim();
  } catch (_) {
    /* ignore */
  }
  const displayName =
    String(opts.displayName || opts.companyName || '').trim() || email.split('@')[0];
  const phone =
    opts.phone != null && String(opts.phone).trim() ? String(opts.phone).trim() : phoneFromCompany;

  const [existEmp] = await pool.query(
    'SELECT id FROM cln_employeedetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
    [email]
  );
  let employeeId;
  if (!existEmp.length) {
    employeeId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO cln_employeedetail (id, email, full_name, phone, account, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
      [employeeId, email, displayName, phone || null, '[]']
    );
  } else {
    employeeId = existEmp[0].id;
    await pool.query(
      `UPDATE cln_employeedetail
       SET full_name = COALESCE(NULLIF(?, ''), full_name),
           phone = COALESCE(?, phone),
           updated_at = CURRENT_TIMESTAMP(3)
       WHERE id = ?`,
      [displayName, phone || null, employeeId]
    );
  }

  const hasCrm = await databaseHasColumn('cln_employee_operator', 'crm_json');
  const [eoRows] = await pool.query(
    hasCrm
      ? 'SELECT id, staff_role, crm_json FROM cln_employee_operator WHERE employee_id = ? AND operator_id = ? LIMIT 1'
      : 'SELECT id, staff_role FROM cln_employee_operator WHERE employee_id = ? AND operator_id = ? LIMIT 1',
    [employeeId, operatorId]
  );

  if (eoRows.length) {
    const junctionId = eoRows[0].id;
    await pool.query(`UPDATE cln_employee_operator SET staff_role = 'supervisor' WHERE id = ?`, [junctionId]);
    if (hasCrm) {
      let crm = clnDc.safeJson(eoRows[0]?.crm_json, {});
      if (!crm || typeof crm !== 'object' || Array.isArray(crm)) crm = {};
      const perms = new Set(
        Array.isArray(crm.permissions) ? crm.permissions.map((x) => String(x).toLowerCase()) : []
      );
      perms.add('supervisor');
      crm.permissions = [...perms];
      await pool.query(`UPDATE cln_employee_operator SET crm_json = ? WHERE id = ?`, [
        JSON.stringify(crm),
        junctionId,
      ]);
    }
  } else {
    const junctionId = crypto.randomUUID();
    if (hasCrm) {
      await pool.query(
        `INSERT INTO cln_employee_operator (id, employee_id, operator_id, staff_role, crm_json, created_at)
         VALUES (?, ?, ?, 'supervisor', ?, CURRENT_TIMESTAMP(3))`,
        [junctionId, employeeId, operatorId, JSON.stringify({ permissions: ['supervisor'] })]
      );
    } else {
      await pool.query(
        `INSERT INTO cln_employee_operator (id, employee_id, operator_id, staff_role, created_at)
         VALUES (?, ?, ?, 'supervisor', CURRENT_TIMESTAMP(3))`,
        [junctionId, employeeId, operatorId]
      );
    }
  }

  return { ok: true, operatorId, employeeId, email };
}

/**
 * @param {{ operatorId: string, subscriptionAddonId: string, eventKind: string, addonCode?: string|null, addonName?: string|null, amountMyr?: number|null, stripeSessionId?: string|null, pricingplanlogId?: string|null, invoiceId?: unknown, invoiceUrl?: unknown, formItemDescription?: string|null, metaJson?: object|string|null, fallbackCustomerEmail?: string|null, fallbackCustomerName?: string|null }}
 */
async function insertClnAddonlog(opts = {}) {
  const operatorId = String(opts.operatorId || '').trim();
  const subscriptionAddonId = String(opts.subscriptionAddonId || '').trim();
  const eventKind = String(opts.eventKind || '').trim().slice(0, 32);
  if (!operatorId || !subscriptionAddonId || !eventKind) return null;
  await ensureClnOperatordetailRowFromSubscription(operatorId, {
    fallbackEmail: opts.fallbackCustomerEmail,
    fallbackName: opts.fallbackCustomerName,
  });
  await ensureClnAddonlogTable();
  const id = makeId('cln-al');
  const metaJson =
    opts.metaJson != null ? (typeof opts.metaJson === 'string' ? opts.metaJson : JSON.stringify(opts.metaJson)) : null;
  const fid =
    opts.formItemDescription != null && String(opts.formItemDescription).trim()
      ? String(opts.formItemDescription).slice(0, 512)
      : null;
  await pool.query(
    `INSERT INTO cln_addonlog (
      id, operator_id, subscription_addon_id, event_kind, addon_code, addon_name, amount_myr, stripe_session_id,
      pricingplanlog_id, invoice_id, invoice_url, form_item_description, meta_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      operatorId,
      subscriptionAddonId,
      eventKind,
      opts.addonCode != null ? String(opts.addonCode).slice(0, 64) : null,
      opts.addonName != null ? String(opts.addonName).slice(0, 255) : null,
      opts.amountMyr != null && Number.isFinite(Number(opts.amountMyr)) ? Number(opts.amountMyr) : null,
      opts.stripeSessionId != null && String(opts.stripeSessionId).trim() ? String(opts.stripeSessionId).slice(0, 128) : null,
      opts.pricingplanlogId != null && String(opts.pricingplanlogId).trim() ? String(opts.pricingplanlogId).slice(0, 64) : null,
      opts.invoiceId != null ? String(opts.invoiceId).slice(0, 100) : null,
      opts.invoiceUrl != null && String(opts.invoiceUrl).trim() ? String(opts.invoiceUrl).slice(0, 512) : null,
      fid,
      metaJson,
    ]
  );
  return { id };
}

/**
 * @returns {Promise<{ id: string } | { duplicate: true, id: string } | null>}
 */
async function insertClnSubscriptionPricingplanlogFromInvoice(opts = {}) {
  const operatorId = String(opts.operatorId || '').trim();
  const inv = opts.inv;
  if (!operatorId || !inv || inv.ok === false) return null;
  const idStr = inv.invoiceId != null ? String(inv.invoiceId) : null;
  const urlStr = inv.invoiceUrl != null && String(inv.invoiceUrl).trim() ? String(inv.invoiceUrl).trim() : null;
  if (!idStr && !urlStr) return null;
  const stripeSessionId =
    opts.stripeSessionId != null && String(opts.stripeSessionId).trim()
      ? String(opts.stripeSessionId).trim()
      : null;
  if (stripeSessionId) {
    const [[dup]] = await pool.query(
      `SELECT id FROM cln_pricingplanlog WHERE log_kind = 'subscription' AND stripe_session_id = ? LIMIT 1`,
      [stripeSessionId]
    );
    if (dup?.id) return { duplicate: true, id: String(dup.id) };
  }
  await ensureClnPricingplanlogTable();
  const id = makeId('cln-ppl');
  const metaJson =
    opts.metaJson != null ? (typeof opts.metaJson === 'string' ? opts.metaJson : JSON.stringify(opts.metaJson)) : null;
  const formItemDesc =
    opts.formItemDescription != null && String(opts.formItemDescription).trim()
      ? String(opts.formItemDescription).slice(0, 512)
      : null;
  await pool.query(
    `INSERT INTO cln_pricingplanlog (
      id, operator_id, subscription_addon_id, log_kind, source, scenario, plan_code, billing_cycle,
      addon_code, amount_myr, amount_total_cents, stripe_session_id, invoice_id, invoice_url, form_item_description, meta_json
    ) VALUES (?, ?, NULL, 'subscription', ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      operatorId,
      opts.source != null ? String(opts.source).slice(0, 64) : null,
      opts.scenario != null ? String(opts.scenario).slice(0, 64) : null,
      opts.planCode != null ? String(opts.planCode).slice(0, 32) : null,
      opts.billingCycle != null ? String(opts.billingCycle).slice(0, 16) : null,
      opts.amountMyr != null && Number.isFinite(Number(opts.amountMyr)) ? Number(opts.amountMyr) : null,
      opts.amountTotalCents != null && Number.isFinite(Number(opts.amountTotalCents))
        ? Math.round(Number(opts.amountTotalCents))
        : null,
      stripeSessionId,
      idStr,
      urlStr,
      formItemDesc,
      metaJson,
    ]
  );
  return { id };
}

async function mapLatestClnSubscriptionInvoiceByOperatorIds(operatorIds) {
  const ids = [...new Set((operatorIds || []).map((x) => String(x || '').trim()).filter(Boolean))];
  if (!ids.length) return new Map();
  await ensureClnPricingplanlogTable();
  const ph = ids.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT operator_id AS operatorId, invoice_id AS invoiceId, invoice_url AS invoiceUrl FROM (
       SELECT operator_id, invoice_id, invoice_url,
         ROW_NUMBER() OVER (PARTITION BY operator_id ORDER BY created_at DESC, id DESC) AS rn
       FROM cln_pricingplanlog
       WHERE log_kind = 'subscription' AND operator_id COLLATE utf8mb4_unicode_ci IN (${ph})
         AND (
           (invoice_id IS NOT NULL AND TRIM(invoice_id) <> '')
           OR (invoice_url IS NOT NULL AND TRIM(invoice_url) <> '')
         )
     ) t WHERE rn = 1`,
    ids
  );
  return new Map(
    (rows || []).map((r) => [
      String(r.operatorId),
      {
        saasBukkuInvoiceId: r.invoiceId != null && String(r.invoiceId).trim() ? String(r.invoiceId) : null,
        saasBukkuInvoiceUrl: r.invoiceUrl != null && String(r.invoiceUrl).trim() ? String(r.invoiceUrl) : null,
      },
    ])
  );
}

async function mapLatestClnAddonInvoiceByAddonRowIds(addonRowIds) {
  const ids = [...new Set((addonRowIds || []).map((x) => String(x || '').trim()).filter(Boolean))];
  if (!ids.length) return new Map();
  await ensureClnAddonlogTable();
  const ph = ids.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT subscription_addon_id AS addonRowId, invoice_id AS invoiceId, invoice_url AS invoiceUrl FROM (
       SELECT subscription_addon_id, invoice_id, invoice_url,
         ROW_NUMBER() OVER (PARTITION BY subscription_addon_id ORDER BY created_at DESC, id DESC) AS rn
       FROM cln_addonlog
       WHERE subscription_addon_id IN (${ph})
         AND (
           (invoice_id IS NOT NULL AND TRIM(invoice_id) <> '')
           OR (invoice_url IS NOT NULL AND TRIM(invoice_url) <> '')
         )
     ) t WHERE rn = 1`,
    ids
  );
  return new Map(
    (rows || []).map((r) => [
      String(r.addonRowId),
      {
        saasBukkuInvoiceId: r.invoiceId != null && String(r.invoiceId).trim() ? String(r.invoiceId) : null,
        saasBukkuInvoiceUrl: r.invoiceUrl != null && String(r.invoiceUrl).trim() ? String(r.invoiceUrl) : null,
      },
    ])
  );
}

function canonicalSubscriptionPlanCode(input) {
  const x = String(input || '').trim().toLowerCase();
  if (x === 'basic' || x === 'starter') return 'starter';
  if (x === 'grow' || x === 'growth') return 'growth';
  if (x === 'scale' || x === 'enterprise') return 'enterprise';
  return x;
}

function subscriptionPlanRank(input) {
  const c = canonicalSubscriptionPlanCode(input);
  if (c === 'starter') return 0;
  if (c === 'growth') return 1;
  if (c === 'enterprise') return 2;
  return -1;
}

/** Stored `monthly_price` (monthly equivalent) from `cln_pricingplan` for this plan + billing cycle. */
async function monthlyPriceStoredFromCatalog(planCode, billingCycle) {
  const plan = canonicalSubscriptionPlanCode(planCode || 'starter');
  const bc = normalizeBillingCycleForRow(billingCycle || 'monthly');
  let interval = 'month';
  if (bc === 'yearly') interval = 'year';
  else if (bc === 'quarterly') interval = 'quarter';
  await seedClnPricingplanIfEmpty();
  const [[row]] = await pool.query(
    `SELECT amount_myr AS amountMyr
     FROM cln_pricingplan
     WHERE plan_code = ? AND interval_code = ? AND is_active = 1
     LIMIT 1`,
    [plan, interval]
  );
  const amt = Number(row?.amountMyr || 0);
  if (amt > 0) {
    if (interval === 'year') return Number((amt / 12).toFixed(2));
    if (interval === 'quarter') return Number((amt / 3).toFixed(2));
    return Number(amt.toFixed(2));
  }
  const fallback = { starter: 699, growth: 1299, enterprise: 1599 };
  return Number(fallback[plan] || 0);
}

/** Catalog list price for the billing period (MYR), for platform Bukku cash invoices. */
async function catalogInvoicePeriodAmountMyr(planCode, billingCycle) {
  const plan = canonicalSubscriptionPlanCode(planCode || 'starter');
  const bc = normalizeBillingCycleForRow(billingCycle || 'monthly');
  let interval = 'month';
  if (bc === 'yearly') interval = 'year';
  else if (bc === 'quarterly') interval = 'quarter';
  await seedClnPricingplanIfEmpty();
  const [[row]] = await pool.query(
    `SELECT amount_myr AS amountMyr
     FROM cln_pricingplan
     WHERE plan_code = ? AND interval_code = ? AND is_active = 1
     LIMIT 1`,
    [plan, interval]
  );
  const amt = Number(row?.amountMyr || 0);
  if (amt > 0) return Number(amt.toFixed(2));
  const moEq = await monthlyPriceStoredFromCatalog(planCode, billingCycle);
  if (bc === 'yearly') return Number((moEq * 12).toFixed(2));
  if (bc === 'quarterly') return Number((moEq * 3).toFixed(2));
  return Number(moEq.toFixed(2));
}

function billingCycleFromIntervalCode(intervalCode) {
  const x = String(intervalCode || '').trim().toLowerCase();
  if (x === 'year') return 'yearly';
  if (x === 'quarter') return 'quarterly';
  return 'monthly';
}

function subscriptionPlanProductLabel(planCode) {
  const p = canonicalSubscriptionPlanCode(planCode || 'starter');
  if (p === 'starter') return 'Basic';
  if (p === 'growth') return 'Grow';
  if (p === 'enterprise') return 'Enterprise';
  const s = String(p || '').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Plan';
}

function clnIntervalBillingLabelEn(intervalCode) {
  const iv = String(intervalCode || 'month').trim().toLowerCase();
  if (iv === 'year') return 'yearly';
  if (iv === 'quarter') return 'quarterly';
  return 'monthly';
}

/**
 * Single Stripe Checkout subscription line item from `cln_pricingplan.amount_myr` (no catalog Price id).
 */
async function buildClnSubscriptionCheckoutLineItem(planCode, intervalCode) {
  const plan = canonicalSubscriptionPlanCode(planCode || 'starter');
  const iv = String(intervalCode || 'month').trim().toLowerCase();
  if (!['starter', 'growth', 'enterprise'].includes(plan)) {
    const err = new Error('INVALID_PLAN');
    err.code = 'INVALID_PLAN';
    throw err;
  }
  if (!['month', 'quarter', 'year'].includes(iv)) {
    const err = new Error('INVALID_INTERVAL');
    err.code = 'INVALID_INTERVAL';
    throw err;
  }
  const billingCycle = billingCycleFromIntervalCode(iv);
  const amountMyr = await catalogInvoicePeriodAmountMyr(plan, billingCycle);
  const unitAmount = Math.round(Number(amountMyr) * 100);
  if (!(unitAmount > 0)) {
    const err = new Error('PRICE_NOT_CONFIGURED');
    err.code = 'PRICE_NOT_CONFIGURED';
    throw err;
  }
  const recurring =
    iv === 'year'
      ? { interval: 'year', interval_count: 1 }
      : iv === 'quarter'
        ? { interval: 'month', interval_count: 3 }
        : { interval: 'month', interval_count: 1 };
  const planLbl = subscriptionPlanProductLabel(plan);
  const cycleLbl = clnIntervalBillingLabelEn(iv);
  return {
    quantity: 1,
    price_data: {
      currency: 'myr',
      unit_amount: unitAmount,
      product_data: {
        name: `Cleanlemons ${planLbl} — ${cycleLbl}`,
      },
      recurring,
    },
  };
}

function normalizeBillingCycleForRow(input) {
  const x = String(input || '').trim().toLowerCase();
  if (x === 'yearly') return 'yearly';
  if (x === 'quarterly') return 'quarterly';
  return 'monthly';
}

/** SQL: period end from active_from + billing_cycle (exclusive upper bound style DATE_ADD). */
function subscriptionPeriodEndExpr(activeCol = 's.active_from', cycleCol = 's.billing_cycle') {
  return `CASE
    WHEN ${activeCol} IS NULL THEN NULL
    WHEN ${cycleCol} = 'yearly' THEN DATE_ADD(${activeCol}, INTERVAL 1 YEAR)
    WHEN ${cycleCol} = 'quarterly' THEN DATE_ADD(${activeCol}, INTERVAL 3 MONTH)
    ELSE DATE_ADD(${activeCol}, INTERVAL 1 MONTH)
  END`;
}

async function health() {
  await pool.query('SELECT 1 AS ok');
  const [[{ c }]] = await pool.query(
    'SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE ?',
    ['cln_%']
  );
  return { ok: true, module: 'cleanlemon', clnTables: Number(c) };
}

async function stats() {
  const ct = await getClnCompanyTable();
  const [[clients]] = await pool.query(`SELECT COUNT(*) AS n FROM \`${ct}\``);
  const [[properties]] = await pool.query('SELECT COUNT(*) AS n FROM cln_property');
  const [[schedules]] = await pool.query('SELECT COUNT(*) AS n FROM cln_schedule');
  return {
    clients: Number(clients.n),
    properties: Number(properties.n),
    schedules: Number(schedules.n)
  };
}

async function listProperties({ limit = 50, offset = 0 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const hasCid = await databaseHasColumn('cln_property', 'client_id');
  const sel = hasCid
    ? 'id, client_id, property_name, unit_name, team, address, created_at'
    : 'id, property_name, unit_name, team, address, created_at';
  const [rows] = await pool.query(
    `SELECT ${sel}
     FROM cln_property
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [lim, off]
  );
  return rows;
}

async function listSchedules({ limit = 50, offset = 0 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const [rows] = await pool.query(
    `SELECT id, property_id, working_day, status, cleaning_type, team, price, created_at
     FROM cln_schedule
     ORDER BY working_day DESC
     LIMIT ? OFFSET ?`,
    [lim, off]
  );
  return rows;
}

async function ensurePricingConfigTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS cln_operator_pricing_config (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      operator_id VARCHAR(64) NOT NULL,
      config_json LONGTEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_operator_id (operator_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
  try {
    await pool.query(
      `ALTER TABLE cln_operator_pricing_config MODIFY COLUMN id VARCHAR(64) NOT NULL`
    );
  } catch (e) {
    const msg = String(e?.message || '');
    if (!msg.includes("doesn't exist") && !msg.includes('Unknown table')) {
      console.warn('[cleanlemon] ensurePricingConfigTable: id column widen', e?.message);
    }
  }
}

async function getPricingConfig(operatorId) {
  await ensurePricingConfigTable();
  const [rows] = await pool.query(
    `SELECT config_json
     FROM cln_operator_pricing_config
     WHERE operator_id = ?
     LIMIT 1`,
    [String(operatorId)]
  );
  if (!rows.length) return null;
  try {
    return JSON.parse(rows[0].config_json);
  } catch {
    return null;
  }
}

async function upsertPricingConfig(operatorId, config) {
  await ensurePricingConfigTable();
  const oid = String(operatorId).trim().slice(0, 64);
  const id = oid;
  await pool.query(
    `INSERT INTO cln_operator_pricing_config (id, operator_id, config_json)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE config_json = VALUES(config_json), updated_at = CURRENT_TIMESTAMP`,
    [id, oid, JSON.stringify(config || {})]
  );
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function safeJson(str, fallback) {
  if (str == null || str === '') return fallback;
  /** mysql2 returns JSON columns as objects; LONGTEXT still returns a string. */
  if (typeof str === 'object' && !Buffer.isBuffer(str)) return str;
  try {
    return JSON.parse(String(str));
  } catch {
    return fallback;
  }
}

/** Cleanlemons profile UI ↔ `portal_account` (one email, shared across operator/employee/client/…). */
function mapPortalProfileToUnifiedEmployee(portalResult, normalizedEmail) {
  if (!portalResult?.ok || !portalResult.profile) return null;
  const p = portalResult.profile;
  const parts = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
  const fullName = String(p.fullname || parts || '').trim();
  const reg = String(p.reg_no_type || p.id_type || 'NRIC').toUpperCase();
  const idType = ['NRIC', 'PASSPORT', 'BRN'].includes(reg) ? reg : 'NRIC';
  const approvalPending = (() => {
    const raw = p.approvalpending ?? p.approval_pending ?? null;
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  })();
  return {
    id: null,
    clientId: null,
    email: normalizedEmail,
    fullName,
    legalName: String(p.fullname || fullName || '').trim(),
    nickname: String(p.first_name || '').trim(),
    phone: String(p.phone || '').trim(),
    address: String(p.address || '').trim(),
    entityType: String(p.entity_type || 'MALAYSIAN_INDIVIDUAL'),
    idType,
    idNumber: String(p.nric || '').trim(),
    taxIdNo: String(p.tax_id_no || '').trim(),
    bankId: p.bankname_id != null ? String(p.bankname_id) : '',
    bankAccountNo: String(p.bankaccount || '').trim(),
    bankAccountHolder: String(p.accountholder || '').trim(),
    nricFrontUrl: String(p.nricfront || '').trim(),
    nricBackUrl: String(p.nricback || '').trim(),
    avatarUrl: String(p.avatar_url || '').trim(),
    approvalPending,
    aliyunEkycLocked: !!p.aliyun_ekyc_locked,
    passportExpiryDate:
      p.passport_expiry_date != null && String(p.passport_expiry_date).trim() !== ''
        ? String(p.passport_expiry_date).trim().slice(0, 10)
        : '',
    profileSelfVerifiedAt:
      p.profileSelfVerifiedAt != null && String(p.profileSelfVerifiedAt).trim() !== ''
        ? String(p.profileSelfVerifiedAt).trim()
        : null,
    profileIdentityVerified:
      !!p.aliyun_ekyc_locked ||
      (p.profileSelfVerifiedAt != null && String(p.profileSelfVerifiedAt).trim() !== ''),
  };
}

function buildPortalPayloadFromUnifiedEmployeePayload(payload = {}) {
  const fullname = payload.fullName != null ? String(payload.fullName).trim() : '';
  const legal = payload.legalName != null ? String(payload.legalName).trim() : '';
  const bid = payload.bankId != null && String(payload.bankId).trim() !== '' ? String(payload.bankId).trim() : null;
  return {
    fullname: fullname || legal || null,
    first_name: payload.nickname != null ? String(payload.nickname).trim() || null : null,
    phone: payload.phone != null ? String(payload.phone).trim() || null : null,
    address: payload.address != null ? String(payload.address).trim() || null : null,
    nric: payload.idNumber != null ? String(payload.idNumber).trim() || null : null,
    tax_id_no: payload.taxIdNo != null ? String(payload.taxIdNo).trim() || null : null,
    entity_type: payload.entityType != null ? String(payload.entityType).trim() || null : null,
    reg_no_type: payload.idType != null ? String(payload.idType).trim() || null : null,
    id_type: payload.idType != null ? String(payload.idType).trim() || null : null,
    bankname_id: bid,
    bankaccount: payload.bankAccountNo != null ? String(payload.bankAccountNo).trim() || null : null,
    accountholder: payload.bankAccountHolder != null ? String(payload.bankAccountHolder).trim() || null : null,
    avatar_url: payload.avatarUrl != null ? String(payload.avatarUrl).trim() || null : null,
    nricfront: payload.nricFrontUrl != null ? String(payload.nricFrontUrl).trim() || null : null,
    nricback: payload.nricBackUrl != null ? String(payload.nricBackUrl).trim() || null : null,
  };
}

const CLN_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function getEmployeeProfileByEmail(email, operatorIdOptional = null) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return null;
  const portal = await getPortalProfile(normalizedEmail);
  const profile = mapPortalProfileToUnifiedEmployee(portal, normalizedEmail);
  if (!profile) return null;

  const oid = String(operatorIdOptional || '').trim();
  let resolvedClientId = null;

  if (oid && normalizedEmail) {
    try {
      resolvedClientId = await resolveClnClientdetailIdForClientPortal(normalizedEmail, oid);
    } catch {
      /* same paths as client-portal APIs; fall through */
    }
  }

  if (!resolvedClientId) {
    try {
      const [clientRows] = await pool.query(
        'SELECT id FROM cln_clientdetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
        [normalizedEmail]
      );
      if (Array.isArray(clientRows) && clientRows.length > 0 && clientRows[0]?.id) {
        resolvedClientId = String(clientRows[0].id).trim();
      }
    } catch (err) {
      if (err?.code !== 'ER_NO_SUCH_TABLE' && err?.errno !== 1146) {
        console.warn('[cleanlemon] getEmployeeProfileByEmail: email lookup failed', err?.message || err);
      }
    }
  }

  // Portal JWT often stores cln_clientdetail.id as roles[].clientId (auth-context → operatorId).
  // Profile may live only in portal_account while cln_clientdetail.email stays NULL — email-only SQL never matches.
  if (!resolvedClientId && oid && CLN_UUID_RE.test(oid)) {
    try {
      const [[row]] = await pool.query('SELECT id FROM cln_clientdetail WHERE id = ? LIMIT 1', [oid]);
      if (row?.id) resolvedClientId = String(row.id).trim();
    } catch (err) {
      if (err?.code !== 'ER_NO_SUCH_TABLE' && err?.errno !== 1146) {
        console.warn('[cleanlemon] getEmployeeProfileByEmail: id fallback failed', err?.message || err);
      }
    }
  }

  if (resolvedClientId) {
    profile.clientId = resolvedClientId;
    profile.id = resolvedClientId;
  }

  try {
    const [[paRow]] = await pool.query(
      'SELECT id FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [normalizedEmail]
    );
    if (paRow?.id) {
      profile.portalAccountId = String(paRow.id).trim();
    }
  } catch (err) {
    if (err?.code !== 'ER_NO_SUCH_TABLE' && err?.errno !== 1146) {
      console.warn('[cleanlemon] getEmployeeProfileByEmail: portal_account id', err?.message || err);
    }
  }

  return profile;
}

/**
 * Client portal (B2B): same rules as resolveClnClientdetailIdForClientPortal (junction or direct clientdetail + email).
 */
async function assertClnClientPortalOperatorAccess(email, operatorId, options) {
  await resolveClnClientdetailIdForClientPortal(email, operatorId, options);
}

/**
 * Client portal: Cleanlemons operators (`cln_operatordetail`) linked to this B2B client via `cln_client_operator`.
 */
async function listClientPortalLinkedCleanlemonsOperators(clientdetailId) {
  const cid = String(clientdetailId || '').trim();
  if (!cid) return [];
  const ct = await getClnCompanyTable();
  try {
    const [rows] = await pool.query(
      `SELECT o.id, COALESCE(o.name, '') AS name, COALESCE(o.email, '') AS email
       FROM cln_client_operator j
       INNER JOIN \`${ct}\` o ON o.id = j.operator_id
       WHERE j.clientdetail_id = ?
       ORDER BY name ASC`,
      [cid]
    );
    return (rows || []).map((r) => ({
      operatorId: String(r.id || '').trim(),
      operatorName: String(r.name || '').trim() || String(r.id || '').trim(),
      operatorEmail: String(r.email || '').trim(),
    }));
  } catch (e) {
    const msg = String(e?.sqlMessage || e?.message || '');
    if (!/doesn't exist/i.test(msg) && !/Unknown table/i.test(msg)) {
      console.warn('[cleanlemon] listClientPortalLinkedCleanlemonsOperators:', e?.message || e);
    }
    return [];
  }
}

/**
 * Operator portal: email must be staff of operator (junction) or match company master email.
 */
async function assertClnOperatorStaffEmail(operatorId, email) {
  const oid = String(operatorId || '').trim();
  const em = String(email || '').trim().toLowerCase();
  if (!oid || !em) {
    const err = new Error('MISSING_OPERATOR_OR_EMAIL');
    err.code = 'MISSING_OPERATOR_OR_EMAIL';
    throw err;
  }
  await assertClnOperatorMasterRowExists(oid);
  const company = await fetchClnOperatordetailCompanyAndEmail(oid);
  if (company?.email && String(company.email).trim().toLowerCase() === em) {
    return;
  }
  if (
    !(await clnDc.databaseHasTable(pool, 'cln_employee_operator')) ||
    !(await clnDc.databaseHasTable(pool, 'cln_employeedetail'))
  ) {
    const err = new Error('OPERATOR_ACCESS_DENIED');
    err.code = 'OPERATOR_ACCESS_DENIED';
    throw err;
  }
  const [rows] = await pool.query(
    `SELECT eo.id FROM cln_employee_operator eo
     INNER JOIN cln_employeedetail d ON d.id = eo.employee_id
     WHERE eo.operator_id = ? AND LOWER(TRIM(d.email)) = ? LIMIT 1`,
    [oid, em]
  );
  if (!rows?.length) {
    const err = new Error('OPERATOR_ACCESS_DENIED');
    err.code = 'OPERATOR_ACCESS_DENIED';
    throw err;
  }
}

async function getDriverVehicleByEmail(email) {
  const em = String(email || '')
    .trim()
    .toLowerCase();
  if (!em) return { ok: false, reason: 'MISSING_EMAIL', vehicle: null };
  if (!(await clnDc.databaseHasTable(pool, 'cln_employeedetail'))) {
    return { ok: false, reason: 'MIGRATION_REQUIRED', vehicle: null };
  }
  const hasPlate = await databaseHasColumn('cln_employeedetail', 'driver_car_plate');
  if (!hasPlate) {
    return { ok: true, vehicle: { carPlate: '', carFrontUrl: '', carBackUrl: '' }, legacy: true };
  }
  const [[row]] = await pool.query(
    'SELECT driver_car_plate, driver_car_front_url, driver_car_back_url FROM cln_employeedetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
    [em]
  );
  if (!row) return { ok: true, vehicle: { carPlate: '', carFrontUrl: '', carBackUrl: '' } };
  return {
    ok: true,
    vehicle: {
      carPlate: row.driver_car_plate != null ? String(row.driver_car_plate).trim() : '',
      carFrontUrl: row.driver_car_front_url != null ? String(row.driver_car_front_url).trim() : '',
      carBackUrl: row.driver_car_back_url != null ? String(row.driver_car_back_url).trim() : '',
    },
  };
}

async function updateDriverVehicleByEmail(email, patch) {
  const em = String(email || '')
    .trim()
    .toLowerCase();
  if (!em) {
    const err = new Error('MISSING_EMAIL');
    err.code = 'MISSING_EMAIL';
    throw err;
  }
  if (!(await databaseHasColumn('cln_employeedetail', 'driver_car_plate'))) {
    const err = new Error('MIGRATION_REQUIRED');
    err.code = 'MIGRATION_REQUIRED';
    throw err;
  }
  const carPlate = patch?.carPlate != null ? String(patch.carPlate).trim().slice(0, 32) : '';
  const carFrontUrl = patch?.carFrontUrl != null ? String(patch.carFrontUrl).trim().slice(0, 2000) : '';
  const carBackUrl = patch?.carBackUrl != null ? String(patch.carBackUrl).trim().slice(0, 2000) : '';
  await pool.query(
    `UPDATE cln_employeedetail
     SET driver_car_plate = ?, driver_car_front_url = ?, driver_car_back_url = ?, updated_at = CURRENT_TIMESTAMP(3)
     WHERE LOWER(TRIM(email)) = ?
     LIMIT 1`,
    [carPlate || null, carFrontUrl || null, carBackUrl || null, em]
  );
  return getDriverVehicleByEmail(em);
}

/**
 * Resolves B2B client scope for client-portal APIs.
 * With valid Portal JWT (`ensureClientdetailIfMissing`), creates `cln_clientdetail` for that email if missing — logged-in portal users always have email.
 * Tries: portal_account (login email) → cln_clientdetail.portal_account_id; (1–3) junction / direct id when `operatorId` non-empty; (4) exactly one row by email; (5) insert row when JWT path and none found.
 * @param {{ ensureClientdetailIfMissing?: boolean }} [options]
 * @returns {Promise<string>} cln_clientdetail.id
 */
async function resolveClnClientdetailIdForClientPortal(email, operatorId, options = {}) {
  const em = String(email || '').trim().toLowerCase();
  const oid = String(operatorId || '').trim();
  if (!em) {
    const err = new Error('MISSING_EMAIL');
    err.code = 'MISSING_EMAIL';
    throw err;
  }

  /** Login email may differ from `cln_clientdetail.email` (Antlerzone CRM email); link is portal_account.id → portal_account_id. */
  try {
    const [[pa]] = await pool.query(
      'SELECT id FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [em]
    );
    const paId = pa?.id != null && String(pa.id).trim() !== '' ? String(pa.id).trim() : '';
    if (paId) {
      try {
        const [[cdByPa]] = await pool.query(
          'SELECT id FROM cln_clientdetail WHERE portal_account_id = ? LIMIT 1',
          [paId]
        );
        if (cdByPa?.id) return String(cdByPa.id).trim();
      } catch (inner) {
        const im = String(inner?.sqlMessage || inner?.message || '');
        const missingCol = inner?.code === 'ER_BAD_FIELD_ERROR' || /Unknown column/i.test(im);
        if (!missingCol && !/doesn't exist/i.test(im) && !/Unknown table/i.test(im)) throw inner;
      }
    }
  } catch (e) {
    const msg = String(e?.sqlMessage || e?.message || '');
    if (!/doesn't exist/i.test(msg) && !/Unknown table/i.test(msg)) throw e;
  }

  if (oid) {
    try {
      const [[row]] = await pool.query(
        `SELECT j.clientdetail_id AS id
         FROM cln_client_operator j
         INNER JOIN cln_clientdetail d ON d.id = j.clientdetail_id
         WHERE j.operator_id = ? AND LOWER(TRIM(d.email)) = ?
         LIMIT 1`,
        [oid, em]
      );
      if (row?.id) return String(row.id).trim();
    } catch (e) {
      const msg = String(e?.sqlMessage || e?.message || '');
      if (!/doesn't exist/i.test(msg) && !/Unknown table/i.test(msg)) throw e;
    }
    try {
      const [[rowByClient]] = await pool.query(
        `SELECT j.clientdetail_id AS id
         FROM cln_client_operator j
         INNER JOIN cln_clientdetail d ON d.id = j.clientdetail_id
         WHERE j.clientdetail_id = ? AND LOWER(TRIM(d.email)) = ?
         LIMIT 1`,
        [oid, em]
      );
      if (rowByClient?.id) return String(rowByClient.id).trim();
    } catch (e) {
      const msg = String(e?.sqlMessage || e?.message || '');
      if (!/doesn't exist/i.test(msg) && !/Unknown table/i.test(msg)) throw e;
    }
    try {
      const [[direct]] = await pool.query(
        `SELECT d.id AS id FROM cln_clientdetail d
         WHERE d.id = ? AND LOWER(TRIM(d.email)) = ?
         LIMIT 1`,
        [oid, em]
      );
      if (direct?.id) return String(direct.id).trim();
    } catch (e) {
      const msg = String(e?.sqlMessage || e?.message || '');
      if (!/doesn't exist/i.test(msg) && !/Unknown table/i.test(msg)) throw e;
    }
  }

  try {
    const [byEmail] = await pool.query(
      `SELECT id FROM cln_clientdetail WHERE LOWER(TRIM(email)) = ? LIMIT 3`,
      [em]
    );
    const emailRows = Array.isArray(byEmail) ? byEmail : [];
    if (emailRows.length === 1 && emailRows[0]?.id) {
      return String(emailRows[0].id).trim();
    }
    if (emailRows.length >= 2) {
      const amb = new Error('CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL');
      amb.code = 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL';
      throw amb;
    }
    if (emailRows.length === 0 && options.ensureClientdetailIfMissing) {
      const id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO cln_clientdetail (id, email, fullname, phone, address, account, created_at, updated_at)
         VALUES (?, ?, NULL, NULL, NULL, '[]', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
        [id, em]
      );
      return id;
    }
  } catch (e) {
    if (e?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') throw e;
    const msg = String(e?.sqlMessage || e?.message || '');
    if (!/doesn't exist/i.test(msg) && !/Unknown table/i.test(msg)) throw e;
  }

  const err = new Error('CLIENT_PORTAL_ACCESS_DENIED');
  err.code = 'CLIENT_PORTAL_ACCESS_DENIED';
  throw err;
}

async function upsertEmployeeProfileByEmail(email, payload = {}) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) {
    const err = new Error('MISSING_EMAIL');
    err.code = 'MISSING_EMAIL';
    throw err;
  }
  const ensured = await ensurePortalAccountByEmail(normalizedEmail);
  if (!ensured.ok) {
    const err = new Error(ensured.reason || 'PORTAL_ACCOUNT_ENSURE_FAILED');
    err.code = ensured.reason || 'PORTAL_ACCOUNT_ENSURE_FAILED';
    throw err;
  }
  const portalPayload = buildPortalPayloadFromUnifiedEmployeePayload(payload);
  if (payload.selfVerify === true) {
    portalPayload.selfVerify = true;
  }
  const result = await updatePortalProfile(normalizedEmail, portalPayload);
  if (!result.ok) {
    const err = new Error(result.reason || 'UPDATE_FAILED');
    err.code = result.reason || 'UPDATE_FAILED';
    throw err;
  }
  return getEmployeeProfileByEmail(normalizedEmail);
}

async function databaseHasColumn(tableName, columnName) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [tableName, columnName]
  );
  return Number(row?.n) > 0;
}

async function databaseHasTable(tableName) {
  try {
    const [[row]] = await pool.query(
      `SELECT COUNT(*) AS n FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [String(tableName || '')]
    );
    return Number(row?.n) > 0;
  } catch {
    return false;
  }
}

/**
 * Display name for schedule/damage rows: prefer B2B `clientdetail_id` → cln_clientdetail;
 * else legacy `client_id` → company master (migration 0239 may drop `client_id`).
 */
async function buildClnPropertyClientDisplaySql(companyTableName) {
  const ct = companyTableName;
  const hasPropClientId = await databaseHasColumn('cln_property', 'client_id');
  const hasClientdetailId = await databaseHasColumn('cln_property', 'clientdetail_id');
  if (hasClientdetailId) {
    return {
      joinSql: `LEFT JOIN cln_clientdetail cd ON cd.id = p.clientdetail_id`,
      nameExpr: `COALESCE(NULLIF(TRIM(cd.fullname),''), NULLIF(TRIM(cd.email),''), p.client_label, '')`,
    };
  }
  if (hasPropClientId) {
    return {
      joinSql: `LEFT JOIN \`${ct}\` c ON c.id = p.client_id`,
      nameExpr: `COALESCE(c.name, p.client_label, '')`,
    };
  }
  return { joinSql: '', nameExpr: `COALESCE(p.client_label, '')` };
}

/**
 * When `client_id` still exists (pre–0239 or partial deploy), keep it aligned with binding:
 * `clientdetail_id` if set, else `operator_id` (legacy list fallback). Canonical B2B key is `clientdetail_id`.
 */
async function syncClnPropertyLegacyClientIdColumn(propertyId) {
  const pid = String(propertyId || '').trim();
  if (!pid) return;
  if (!(await databaseHasColumn('cln_property', 'client_id'))) return;
  const hasCd = await databaseHasColumn('cln_property', 'clientdetail_id');
  const hasOp = await databaseHasColumn('cln_property', 'operator_id');
  const sel = [];
  if (hasCd) sel.push('clientdetail_id');
  if (hasOp) sel.push('operator_id');
  if (!sel.length) return;
  const [[row]] = await pool.query(`SELECT ${sel.join(', ')} FROM cln_property WHERE id = ? LIMIT 1`, [pid]);
  if (!row) return;
  const cd =
    hasCd && row.clientdetail_id != null && String(row.clientdetail_id).trim() !== ''
      ? String(row.clientdetail_id).trim()
      : null;
  const op =
    hasOp && row.operator_id != null && String(row.operator_id).trim() !== ''
      ? String(row.operator_id).trim()
      : null;
  const next = cd || op || null;
  await pool.query('UPDATE cln_property SET client_id = ?, updated_at = NOW(3) WHERE id = ? LIMIT 1', [next, pid]);
}

async function getClnAccountProviderForOperator(operatorId) {
  const oid = String(operatorId || '').trim();
  if (!oid) return null;
  const [rows] = await pool.query(
    `SELECT provider FROM cln_operator_integration
     WHERE operator_id = ? AND \`key\` IN ('Account', 'addonAccount') AND enabled = 1
     ORDER BY FIELD(provider, 'bukku', 'xero', 'autocount', 'sql') LIMIT 1`,
    [oid]
  );
  const p = rows[0]?.provider;
  if (p && CLN_ACCOUNT_PROVIDERS.includes(p)) return p;
  return null;
}

/**
 * Accounting push roles for operator contact permissions (Bukku: staff→employee, tenant→customer).
 * Both employee-type and clients → ['staff','tenant'] so remote gets employee + customer on same contact where supported.
 */
function clnAccountingPushRolesForPermissions(perms) {
  const p = Array.isArray(perms) ? perms : [];
  const roles = [];
  const hasEmployee =
    p.includes('staff') ||
    p.includes('driver') ||
    p.includes('dobi') ||
    p.includes('supervisor');
  if (hasEmployee) roles.push('staff');
  if (p.includes('clients')) roles.push('tenant');
  return roles;
}

function clnNormEmail(v) {
  return String(v || '')
    .trim()
    .toLowerCase();
}

function clnNormName(v) {
  return String(v || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function clnFindLocalContactRow(locals, rc) {
  const email = clnNormEmail(rc.email);
  const name = clnNormName(rc.name);
  for (const l of locals) {
    if (email && clnNormEmail(l.email) === email) return l;
  }
  for (const l of locals) {
    if (name && clnNormName(l.name) === name) return l;
  }
  return null;
}

/** Remote accounting role → Cleanlemons permissions_json (customer vs employee). */
function clnPermissionsFromRemoteRole(rc) {
  const r = String(rc.role || '').toLowerCase();
  if (r === 'staff') return ['staff'];
  return ['clients'];
}

/**
 * Import from accounting → Cleanlemons `permissions` for new rows; `null` = skip (no link / no create).
 * Bukku: use `bukkuTypes` from API — **supplier-only** contacts are not imported (avoids KWSP-style AP vendors as Clients).
 * Priority when combined: employee → staff; else customer → clients.
 * Other providers: fall back to {@link clnPermissionsFromRemoteRole} (no `bukkuTypes` on list items).
 */
function clnImportPermissionsFromRemote(rc, provider) {
  const p = String(provider || '').toLowerCase();
  if (p === 'bukku' && Array.isArray(rc.bukkuTypes) && rc.bukkuTypes.length > 0) {
    const t = new Set(rc.bukkuTypes.map((x) => String(x).toLowerCase()));
    const hasCust = t.has('customer');
    const hasEmp = t.has('employee');
    const hasSup = t.has('supplier');
    if (hasSup && !hasCust && !hasEmp) return null;
    if (hasEmp) return ['staff'];
    if (hasCust) return ['clients'];
    return null;
  }
  return clnPermissionsFromRemoteRole(rc);
}

async function syncClnContactsToAccounting(operatorId) {
  const provider = await getClnAccountProviderForOperator(operatorId);
  if (!provider) return { ok: false, reason: 'NO_ACCOUNT_PROVIDER' };
  await clnDc.ensureClnDomainContactExtras(pool);
  const rows = await listOperatorContacts(operatorId);
  const counters = { scanned: 0, synced: 0, created: 0, failed: 0 };
  const failureSamples = [];
  for (const row of rows) {
    counters.scanned += 1;
    const perms = Array.isArray(row.permissions) ? row.permissions : [];
    const roles = clnAccountingPushRolesForPermissions(perms);
    if (roles.length === 0) {
      continue;
    }
    const phoneRaw = row.phone != null && String(row.phone).trim() !== '-' ? String(row.phone).trim() : '';
    const rec = { name: row.name, email: row.email, phone: phoneRaw };
    const src = row.contactSource || '';
    if (src === 'employee' && row.employeeDetailId) {
      const pushRes = await clnDc.pushEmployeeAccounting(
        pool,
        getClnAccountProviderForOperator,
        operatorId,
        row.employeeDetailId,
        perms,
        rec
      );
      if (pushRes.ok === false && pushRes.failures) {
        counters.failed += 1;
        if (failureSamples.length < 15) {
          failureSamples.push({
            stage: 'pushEmployeeAccounting',
            email: String(row.email || ''),
            name: String(row.name || ''),
            reason: String(pushRes.failures[0]?.reason || 'SYNC_FAILED').slice(0, 380)
          });
        }
        continue;
      }
      counters.synced += 1;
      continue;
    }
    if (src === 'client' && row.clientDetailId) {
      const pushRes = await clnDc.pushClientAccounting(
        pool,
        getClnAccountProviderForOperator,
        operatorId,
        row.clientDetailId,
        rec
      );
      if (pushRes.ok === false && pushRes.failures) {
        counters.failed += 1;
        if (failureSamples.length < 15) {
          failureSamples.push({
            stage: 'pushClientAccounting',
            email: String(row.email || ''),
            name: String(row.name || ''),
            reason: String(pushRes.failures[0]?.reason || 'SYNC_FAILED').slice(0, 380)
          });
        }
        continue;
      }
      counters.synced += 1;
      continue;
    }
  }
  return { ok: true, ...counters, failureSamples, provider };
}

async function syncClnContactsFromAccounting(operatorId) {
  const provider = await getClnAccountProviderForOperator(operatorId);
  if (!provider) return { ok: false, reason: 'NO_ACCOUNT_PROVIDER' };
  const remoteRes = await contactService.listRemoteContacts(operatorId, provider);
  if (!remoteRes.ok) return { ok: false, reason: remoteRes.reason || 'REMOTE_LIST_FAILED' };
  const remote = remoteRes.items || [];
  await clnDc.ensureClnDomainContactExtras(pool);
  if (!(await clnDc.clnDomainContactSchemaReady(pool))) {
    return {
      ok: false,
      reason: 'DOMAIN_CONTACT_SCHEMA_MISSING',
      scanned: remote.length,
      linked: 0,
      created: 0,
      failed: remote.length,
      failureSamples: [],
      provider
    };
  }
  const unified = await listOperatorContacts(operatorId);
  const locals = unified.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    account: JSON.stringify(Array.isArray(r.account) ? r.account : safeJson(r.account, [])),
    contactSource: r.contactSource,
    employeeDetailId: r.employeeDetailId,
    clientDetailId: r.clientDetailId,
  }));
  const counters = { scanned: remote.length, linked: 0, created: 0, failed: 0, skipped: 0 };
  const failureSamples = [];
  for (const rc of remote) {
    try {
      const importPerms = clnImportPermissionsFromRemote(rc, provider);
      if (importPerms == null) {
        counters.skipped += 1;
        continue;
      }
      const local = clnFindLocalContactRow(locals, rc);
      if (local) {
        if (local.contactSource === 'employee' && local.employeeDetailId) {
          const account = safeJson(local.account, []);
          const merged = contactSync.mergeAccountEntry(account, operatorId, provider, rc.id);
          const mergedJson = JSON.stringify(merged);
          await pool.query(
            'UPDATE cln_employeedetail SET account = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
            [mergedJson, local.employeeDetailId]
          );
          local.account = mergedJson;
        } else if (local.contactSource === 'client' && local.clientDetailId) {
          const account = safeJson(local.account, []);
          const merged = contactSync.mergeAccountEntry(account, operatorId, provider, rc.id);
          const mergedJson = JSON.stringify(merged);
          await pool.query(
            'UPDATE cln_clientdetail SET account = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
            [mergedJson, local.clientDetailId]
          );
          local.account = mergedJson;
        }
        counters.linked += 1;
        continue;
      }
      const title = rc.name || rc.email || 'Synced contact';
      const email = rc.email != null ? String(rc.email) : '';
      const remark = [`Imported from accounting (${provider}) ${new Date().toISOString().slice(0, 10)}`];
      const accountArr = [{ clientId: operatorId, provider, id: rc.id }];
      const newId = await createOperatorContact({
        operatorId,
        name: title,
        email,
        phone: '-',
        permissions: importPerms,
        status: 'active',
        joinedAt: new Date().toISOString().slice(0, 10),
        employmentStatus: 'full-time',
        salaryBasic: 0,
        trainings: [],
        remarkHistory: remark,
        account: accountArr,
        skipAccountingPush: true,
        skipAutomationAfterCreate: true,
      });
      const accStr = JSON.stringify(accountArr);
      if (importPerms.length === 1 && importPerms[0] === 'clients') {
        const [[co]] = await pool.query(
          'SELECT clientdetail_id FROM cln_client_operator WHERE id = ? LIMIT 1',
          [newId]
        );
        locals.push({
          id: newId,
          email,
          name: title,
          account: accStr,
          contactSource: 'client',
          clientDetailId: co?.clientdetail_id,
        });
      } else {
        const [[eo]] = await pool.query(
          'SELECT employee_id FROM cln_employee_operator WHERE id = ? LIMIT 1',
          [newId]
        );
        locals.push({
          id: newId,
          email,
          name: title,
          account: accStr,
          contactSource: 'employee',
          employeeDetailId: eo?.employee_id,
        });
      }
      counters.created += 1;
    } catch (err) {
      counters.failed += 1;
      if (failureSamples.length < 12) {
        failureSamples.push({
          remoteId: rc.id,
          reason: String(err?.sqlMessage || err?.message || err).slice(0, 400)
        });
      }
    }
  }
  return { ok: true, ...counters, failureSamples, provider };
}

async function syncClnOperatorContactsWithAccounting(operatorId, direction) {
  const oid = String(operatorId || '').trim();
  if (!oid) return { ok: false, reason: 'MISSING_OPERATOR_ID' };
  await ensureClnOperatordetailRowFromSubscription(oid);
  await assertClnOperatorMasterRowExists(oid);

  const dir = String(direction || 'to-accounting').toLowerCase();
  if (dir === 'to-accounting') {
    const res = await syncClnContactsToAccounting(oid);
    return { ...res, direction: dir };
  }
  if (dir === 'from-accounting') {
    const res = await syncClnContactsFromAccounting(oid);
    return { ...res, direction: dir };
  }
  return { ok: false, reason: 'INVALID_DIRECTION' };
}

async function listOperatorContacts(operatorId) {
  await clnDc.ensureClnDomainContactExtras(pool);
  const oid = String(operatorId || '').trim();
  if (!(await clnDc.clnDomainContactSchemaReady(pool)) || !oid) {
    return [];
  }
  const em = await clnDc.loadEmployeeContactsForOperator(pool, oid);
  const cl = await clnDc.loadClientContactsForOperator(pool, oid);
  return [...em, ...cl];
}

/**
 * Supervisor email is globally unique among active supervisor rows.
 * After resign (or archive), supervisor role no longer blocks that email elsewhere.
 */
async function assertSupervisorEmailAvailable(email, excludeContactId) {
  const e = String(email || '')
    .trim()
    .toLowerCase();
  if (!e) return;
  if (
    (await clnDc.databaseHasTable(pool, 'cln_employee_operator')) &&
    (await clnDc.databaseHasTable(pool, 'cln_employeedetail'))
  ) {
    try {
      const hasCrm = await databaseHasColumn('cln_employee_operator', 'crm_json');
      const crmSel = hasCrm ? 'eo.crm_json' : 'NULL AS crm_json';
      const [eoRows] = await pool.query(
        `SELECT eo.id, ${crmSel} AS crm_json FROM cln_employee_operator eo
         INNER JOIN cln_employeedetail d ON d.id = eo.employee_id
         WHERE LOWER(TRIM(d.email)) = ? AND eo.staff_role = 'supervisor'`,
        [e]
      );
      for (const r of eoRows) {
        if (excludeContactId != null && String(r.id) === String(excludeContactId)) continue;
        const st = clnDc.crmStatusFromJson(clnDc.safeJson(r.crm_json, {}));
        if (st === 'resigned' || st === 'archived') continue;
        const err = new Error('SUPERVISOR_EMAIL_IN_USE');
        err.code = 'SUPERVISOR_EMAIL_IN_USE';
        throw err;
      }
    } catch (err) {
      if (err?.code === 'SUPERVISOR_EMAIL_IN_USE') throw err;
      if (err?.code !== 'ER_NO_SUCH_TABLE') {
        console.warn('[cleanlemon] assertSupervisorEmailAvailable employeedetail', err?.message || err);
      }
    }
  }
}

/** Same operator: one active row per email; resigned/archived rows do not block reuse. */
async function assertContactEmailUniqueForOperator(email, operatorId, excludeContactId) {
  const e = String(email || '')
    .trim()
    .toLowerCase();
  if (!e) return;
  const oid = String(operatorId || '').trim();
  if (!oid) return;
  if (await clnDc.clnDomainContactSchemaReady(pool)) {
    await clnDc.assertDomainEmailUnique(pool, e, oid, excludeContactId);
  }
}

async function createOperatorContact(input) {
  await clnDc.ensureClnDomainContactExtras(pool);
  if (!(await clnDc.clnDomainContactSchemaReady(pool))) {
    const err = new Error('DOMAIN_CONTACT_SCHEMA_MISSING');
    err.code = 'DOMAIN_CONTACT_SCHEMA_MISSING';
    throw err;
  }
  const opId = String(input.operatorId || input.operator_id || '').trim() || null;
  const permsArr = Array.isArray(input.permissions) ? input.permissions : [];
  const picked = [...new Set(permsArr.map((x) => String(x).toLowerCase()))].filter((p) =>
    ['staff', 'driver', 'dobi', 'supervisor', 'clients'].includes(p)
  );
  const employeePicked = picked.filter((p) => p !== 'clients');
  if (picked.includes('clients')) {
    if (picked.length !== 1) {
      const err = new Error('SINGLE_ROLE_REQUIRED');
      err.code = 'SINGLE_ROLE_REQUIRED';
      err.message = 'B2B client contacts must have only the clients role';
      throw err;
    }
  } else if (employeePicked.length < 1) {
    const err = new Error('SINGLE_ROLE_REQUIRED');
    err.code = 'SINGLE_ROLE_REQUIRED';
    err.message = 'Select at least one employee role';
    throw err;
  }
  if (employeePicked.includes('supervisor')) {
    await assertSupervisorEmailAvailable(String(input.email || ''), null);
  }
  await assertContactEmailUniqueForOperator(String(input.email || ''), opId, null);
  const domainId = await clnDc.createOperatorContactDomain(pool, getClnAccountProviderForOperator, input);
  return domainId;
}

async function updateOperatorContact(id, input) {
  await clnDc.ensureClnDomainContactExtras(pool);
  if (!(await clnDc.clnDomainContactSchemaReady(pool))) {
    const err = new Error('DOMAIN_CONTACT_SCHEMA_MISSING');
    err.code = 'DOMAIN_CONTACT_SCHEMA_MISSING';
    throw err;
  }
  await clnDc.updateOperatorContactDomain(
    pool,
    getClnAccountProviderForOperator,
    id,
    input,
    assertSupervisorEmailAvailable
  );
}

async function deleteDraftAgreementsForOperatorEmail(operatorId, emailNorm) {
  await ensureAgreementTables();
  const oid = String(operatorId || '').trim();
  const em = String(emailNorm || '')
    .trim()
    .toLowerCase();
  if (!oid || !em) return;
  const hasOpAgr = await databaseHasColumn('cln_operator_agreement', 'operator_id');
  if (hasOpAgr) {
    await pool.query(
      `DELETE FROM cln_operator_agreement
       WHERE operator_id <=> ? AND LOWER(TRIM(recipient_email)) = ?
         AND LOWER(TRIM(status)) NOT IN ('complete', 'signed')`,
      [oid, em]
    );
  }
}

async function deleteOperatorContact(id) {
  await clnDc.ensureClnDomainContactExtras(pool);
  const cid = String(id);
  if (!(await clnDc.clnDomainContactSchemaReady(pool))) {
    const err = new Error('DOMAIN_CONTACT_SCHEMA_MISSING');
    err.code = 'DOMAIN_CONTACT_SCHEMA_MISSING';
    throw err;
  }
  const done = await clnDc.deleteOperatorContactDomain(pool, cid, deleteDraftAgreementsForOperatorEmail);
  if (!done) {
    const err = new Error('CONTACT_NOT_FOUND');
    err.code = 'CONTACT_NOT_FOUND';
    throw err;
  }
}

async function ensureOperatorTeamTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS cln_operator_team (
      id VARCHAR(36) NOT NULL PRIMARY KEY,
      operator_id CHAR(36) NULL COMMENT 'FK cln_operatordetail.id',
      name VARCHAR(255) NOT NULL,
      member_ids_json LONGTEXT NOT NULL,
      authorize_mode VARCHAR(32) NOT NULL DEFAULT 'full',
      selected_property_ids_json LONGTEXT NOT NULL,
      rest_days_json LONGTEXT NOT NULL,
      created_at DATE NULL,
      created_ts TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

function mapTeamRow(r) {
  const memberIds = safeJson(r.member_ids_json, []);
  const selectedPropertyIds = safeJson(r.selected_property_ids_json, []);
  const restDays = safeJson(r.rest_days_json, []);
  return {
    id: r.id,
    operatorId: r.operator_id != null ? String(r.operator_id) : undefined,
    name: r.name,
    memberIds: Array.isArray(memberIds) ? memberIds : [],
    createdAt: r.created_at
      ? String(r.created_at).slice(0, 10)
      : r.created_ts
        ? String(r.created_ts).slice(0, 10)
        : '',
    authorizeMode: r.authorize_mode || 'full',
    selectedPropertyIds: Array.isArray(selectedPropertyIds) ? selectedPropertyIds : [],
    restDays: Array.isArray(restDays) ? restDays : [],
  };
}

/**
 * @param {string} [operatorId] When `cln_operator_team.operator_id` exists and this is set, filter to that operator. If column exists but this is omitted, return all rows (legacy / employee views).
 */
async function listOperatorTeams(operatorId) {
  await ensureOperatorTeamTable();
  const hasOpCol = await databaseHasColumn('cln_operator_team', 'operator_id');
  const oid = String(operatorId || '').trim();
  if (hasOpCol && oid) {
    const [rows] = await pool.query(
      'SELECT * FROM cln_operator_team WHERE operator_id <=> ? ORDER BY updated_at DESC, created_ts DESC',
      [oid]
    );
    return rows.map(mapTeamRow);
  }
  const [rows] = await pool.query(
    'SELECT * FROM cln_operator_team ORDER BY updated_at DESC, created_ts DESC'
  );
  return rows.map(mapTeamRow);
}

async function createOperatorTeam(input) {
  await ensureOperatorTeamTable();
  const hasOpCol = await databaseHasColumn('cln_operator_team', 'operator_id');
  const opId = String(input.operatorId || input.operator_id || '').trim() || null;
  if (hasOpCol && !opId) {
    const err = new Error('MISSING_OPERATOR_ID');
    err.code = 'MISSING_OPERATOR_ID';
    throw err;
  }
  const id = input.id || makeId('cln-team');
  const memberIds = JSON.stringify(Array.isArray(input.memberIds) ? input.memberIds : []);
  const selectedPropertyIds = JSON.stringify(
    Array.isArray(input.selectedPropertyIds) ? input.selectedPropertyIds : []
  );
  const restDays = JSON.stringify(Array.isArray(input.restDays) ? input.restDays : []);
  const createdAt = input.createdAt || new Date().toISOString().slice(0, 10);
  if (hasOpCol) {
    await pool.query(
      `INSERT INTO cln_operator_team (
        id, operator_id, name, member_ids_json, authorize_mode, selected_property_ids_json, rest_days_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        opId,
        String(input.name || ''),
        memberIds,
        String(input.authorizeMode || 'full'),
        selectedPropertyIds,
        restDays,
        createdAt,
      ]
    );
  } else {
    await pool.query(
      `INSERT INTO cln_operator_team (
        id, name, member_ids_json, authorize_mode, selected_property_ids_json, rest_days_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        String(input.name || ''),
        memberIds,
        String(input.authorizeMode || 'full'),
        selectedPropertyIds,
        restDays,
        createdAt,
      ]
    );
  }
  return id;
}

async function updateOperatorTeam(id, input) {
  await ensureOperatorTeamTable();
  const hasOpCol = await databaseHasColumn('cln_operator_team', 'operator_id');
  const reqOp = String(input.operatorId || input.operator_id || '').trim();
  if (hasOpCol && !reqOp) {
    const err = new Error('MISSING_OPERATOR_ID');
    err.code = 'MISSING_OPERATOR_ID';
    throw err;
  }
  const [existingRows] = await pool.query(
    'SELECT * FROM cln_operator_team WHERE id = ? LIMIT 1',
    [String(id)]
  );
  if (!existingRows.length) {
    const err = new Error('TEAM_NOT_FOUND');
    err.code = 'TEAM_NOT_FOUND';
    throw err;
  }
  const row = existingRows[0];
  if (hasOpCol && reqOp && String(row.operator_id || '') !== reqOp) {
    const err = new Error('TEAM_NOT_FOUND');
    err.code = 'TEAM_NOT_FOUND';
    throw err;
  }
  const cur = mapTeamRow(row);
  const m = {
    ...cur,
    ...input,
    memberIds: input.memberIds != null ? input.memberIds : cur.memberIds,
    selectedPropertyIds:
      input.selectedPropertyIds != null ? input.selectedPropertyIds : cur.selectedPropertyIds,
    restDays: input.restDays != null ? input.restDays : cur.restDays,
  };
  await pool.query(
    `UPDATE cln_operator_team SET
      name = ?, member_ids_json = ?, authorize_mode = ?, selected_property_ids_json = ?,
      rest_days_json = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?`,
    [
      m.name,
      JSON.stringify(m.memberIds || []),
      String(m.authorizeMode || 'full'),
      JSON.stringify(m.selectedPropertyIds || []),
      JSON.stringify(m.restDays || []),
      String(id),
    ]
  );
}

async function deleteOperatorTeam(id, operatorId) {
  await ensureOperatorTeamTable();
  const hasOpCol = await databaseHasColumn('cln_operator_team', 'operator_id');
  const oid = String(operatorId || '').trim();
  if (hasOpCol) {
    if (!oid) {
      const err = new Error('MISSING_OPERATOR_ID');
      err.code = 'MISSING_OPERATOR_ID';
      throw err;
    }
    const [res] = await pool.query(
      'DELETE FROM cln_operator_team WHERE id = ? AND operator_id <=> ? LIMIT 1',
      [String(id), oid]
    );
    if (!res.affectedRows) {
      const err = new Error('TEAM_NOT_FOUND');
      err.code = 'TEAM_NOT_FOUND';
      throw err;
    }
    return;
  }
  await pool.query('DELETE FROM cln_operator_team WHERE id = ? LIMIT 1', [String(id)]);
}

async function getOperatorTeamNameById(teamId) {
  if (!teamId) return null;
  await ensureOperatorTeamTable();
  const [rows] = await pool.query('SELECT name FROM cln_operator_team WHERE id = ? LIMIT 1', [
    String(teamId),
  ]);
  return rows.length ? rows[0].name : null;
}

function cleaningTypeToProvider(ct) {
  const s = String(ct || '').toLowerCase();
  if (s.includes('warm')) return 'warm-cleaning';
  if (s.includes('deep')) return 'deep-cleaning';
  if (s.includes('homestay') || s.includes('home')) return 'homestay-cleaning';
  if (s.includes('room rental')) return 'room-rental-cleaning';
  return 'general-cleaning';
}

function providerToCleaningType(provider) {
  const raw = String(provider || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  if (raw === 'warm-cleaning' || raw === 'warm') return 'Warm Cleaning';
  if (raw === 'deep-cleaning' || raw === 'deep') return 'Deep Cleaning';
  if (raw === 'homestay-cleaning' || raw === 'homestay') return 'Homestay Cleaning';
  if (raw === 'room-rental-cleaning' || raw === 'room-rental' || raw === 'roomrental') return 'Room Rental Cleaning';
  if (raw === 'commercial-cleaning' || raw === 'commercial') return 'Commercial Cleaning';
  if (raw === 'office-cleaning' || raw === 'office') return 'Office Cleaning';
  if (raw === 'renovation-cleaning' || raw === 'renovation') return 'Renovation Cleaning';
  if (raw === 'general-cleaning' || raw === 'general') return 'General Cleaning';
  return 'General Cleaning';
}

function normalizeScheduleStatus(s) {
  const raw = String(s ?? '').trim();
  if (raw === '') return 'pending-checkout';
  const x = raw.toLowerCase().replace(/\s+/g, '-');
  if (x.includes('complete')) return 'completed';
  if (x === 'done') return 'completed';
  if (x.includes('progress')) return 'in-progress';
  if (x.includes('cancel')) return 'cancelled';
  if (
    x.includes('checkout') ||
    x.includes('check-out') ||
    x === 'pending-checkout' ||
    x === 'pending-check-out'
  ) {
    return 'pending-checkout';
  }
  if (x.includes('customer') && x.includes('missing')) return 'pending-checkout';
  if (x.includes('ready') && x.includes('clean')) return 'ready-to-clean';
  return 'pending-checkout';
}

function extractPhotoList(finalPhotoJson) {
  if (finalPhotoJson == null || finalPhotoJson === '') return [];
  const raw =
    typeof finalPhotoJson === 'string' ? safeJson(finalPhotoJson, null) : finalPhotoJson;
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (typeof item === 'string') return schedulePhotoDisplayUrl(item);
        if (item && typeof item === 'object' && typeof item.src === 'string')
          return schedulePhotoDisplayUrl(item.src);
        return null;
      })
      .filter((u) => u != null && String(u).trim() !== '');
  }
  if (raw && typeof raw === 'object' && Array.isArray(raw.urls)) {
    return raw.urls
      .filter((u) => typeof u === 'string')
      .map((u) => schedulePhotoDisplayUrl(u));
  }
  return [];
}

function parseSubmitByMeta(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** Portal property map + schedule: lat/lng from Waze `ll=` or Google `@lat,lng` in stored URLs (not KL placeholder). */
function parseLatLngFromPropertyNavigationUrls(wazeUrl, googleMapsUrl) {
  const s = `${String(wazeUrl || '')} ${String(googleMapsUrl || '')}`;
  const ll = s.match(/[?&]ll=([\d.+-]+)(?:%2C|,)([\d.+-]+)/i);
  if (ll) {
    const lat = parseFloat(ll[1]);
    const lng = parseFloat(ll[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng };
    }
  }
  const at = s.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)(?:[,z]|\?|\/|$)/);
  if (at) {
    const lat = parseFloat(at[1]);
    const lng = parseFloat(at[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng };
    }
  }
  return null;
}

const DEFAULT_SCHEDULE_JOB_MAP_LAT = 1.492659;
const DEFAULT_SCHEDULE_JOB_MAP_LNG = 103.741359;

/** mysql2 may still surface BigInt on some types; stringify before mapping to JSON-safe payloads. */
function rowToJsonSafeFields(row) {
  if (!row || typeof row !== 'object') return row;
  const o = { ...row };
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (typeof v === 'bigint') o[k] = v.toString();
  }
  return o;
}

function resolveScheduleJobLatLngFromRow(r) {
  const la = r.propertyLatitude != null && r.propertyLatitude !== '' ? Number(r.propertyLatitude) : NaN;
  const lo = r.propertyLongitude != null && r.propertyLongitude !== '' ? Number(r.propertyLongitude) : NaN;
  if (Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180) {
    return { lat: la, lng: lo };
  }
  const parsed = parseLatLngFromPropertyNavigationUrls(r.propertyWazeUrl, r.propertyGoogleMapsUrl);
  if (parsed) return parsed;
  return { lat: DEFAULT_SCHEDULE_JOB_MAP_LAT, lng: DEFAULT_SCHEDULE_JOB_MAP_LNG };
}

async function sqlPropertyNavigationUrlColumns() {
  const [hasW, hasG, hasLa, hasLo] = await Promise.all([
    databaseHasColumn('cln_property', 'waze_url'),
    databaseHasColumn('cln_property', 'google_maps_url'),
    databaseHasColumn('cln_property', 'latitude'),
    databaseHasColumn('cln_property', 'longitude'),
  ]);
  const w = hasW ? `NULLIF(TRIM(p.waze_url), '') AS propertyWazeUrl` : `'' AS propertyWazeUrl`;
  const g = hasG ? `NULLIF(TRIM(p.google_maps_url), '') AS propertyGoogleMapsUrl` : `'' AS propertyGoogleMapsUrl`;
  const la = hasLa ? `p.latitude AS propertyLatitude` : `NULL AS propertyLatitude`;
  const lo = hasLo ? `p.longitude AS propertyLongitude` : `NULL AS propertyLongitude`;
  return `${w},\n            ${g},\n            ${la},\n            ${lo}`;
}

function mapScheduleRowToJobItem(r, teams) {
  const teamName = r.teamDbName || null;
  const teamId = teamName ? teams.find((t) => t.name === teamName)?.id || null : null;
  const aiAssignmentLocked = Number(r.aiAssignmentLockedRaw) === 1;
  let timeStr;
  if (r.staffStartTime && r.staffEndTime) {
    timeStr = `${r.staffStartTime} - ${r.staffEndTime}`;
  } else if (r.staffStartTime) {
    timeStr = r.staffStartTime;
  } else {
    timeStr = undefined;
  }
  const photos = extractPhotoList(r.finalPhotoJson);
  const submitMeta = parseSubmitByMeta(r.submitBy);
  const estimateCompleteAt =
    submitMeta && typeof submitMeta.estimateCompleteAt === 'string'
      ? submitMeta.estimateCompleteAt
      : undefined;
  let pricingAddons = [];
  if (r.pricingAddonsJson != null && String(r.pricingAddonsJson).trim() !== '') {
    try {
      const p = JSON.parse(String(r.pricingAddonsJson));
      pricingAddons = Array.isArray(p) ? p : [];
    } catch (_) {
      pricingAddons = [];
    }
  }
  const colivingPid =
    r.colivingPropertydetailId != null && String(r.colivingPropertydetailId).trim() !== ''
      ? String(r.colivingPropertydetailId).trim()
      : null;
  const colivingRid =
    r.colivingRoomdetailId != null && String(r.colivingRoomdetailId).trim() !== ''
      ? String(r.colivingRoomdetailId).trim()
      : null;
  const clnOp =
    r.clnOperatorId != null && String(r.clnOperatorId).trim() !== '' ? String(r.clnOperatorId).trim() : null;
  const clnCd =
    r.clnClientdetailId != null && String(r.clnClientdetailId).trim() !== ''
      ? String(r.clnClientdetailId).trim()
      : null;
  const { lat: jobLat, lng: jobLng } = resolveScheduleJobLatLngFromRow(r);
  return {
    id: r.id,
    propertyId: r.propertyId,
    property: r.propertyName,
    unitNumber: r.unitNumber || '',
    unit: r.unitNumber || '',
    bedCount: Number(r.bedCount) > 0 ? Number(r.bedCount) : 1,
    client: r.clientName || '—',
    address: r.address || '—',
    propertyType: 'homestay',
    cleaningType: r.cleaningType,
    serviceProvider: cleaningTypeToProvider(r.cleaningType),
    date: r.jobDate || new Date().toISOString().slice(0, 10),
    time: timeStr,
    status: normalizeScheduleStatus(r.rawStatus),
    /** DB `cln_schedule.status` before normalize (e.g. `Customer Missing` vs `pending-checkout`). */
    statusRaw: r.rawStatus != null && String(r.rawStatus).trim() !== '' ? String(r.rawStatus).trim() : undefined,
    estimateKpi: Math.max(0, Math.min(100, 100 - (Number(r.kpiPoint) || 0))),
    teamId,
    teamName,
    team: teamName,
    createdByEmail: r.createdByEmail != null && String(r.createdByEmail).trim() ? String(r.createdByEmail).trim() : undefined,
    readyToCleanByEmail:
      r.readyToCleanByEmail != null && String(r.readyToCleanByEmail).trim()
        ? String(r.readyToCleanByEmail).trim()
        : undefined,
    readyToCleanAt: r.readyToCleanAt != null ? String(r.readyToCleanAt) : undefined,
    staffStartEmail:
      r.staffStartEmailRaw != null && String(r.staffStartEmailRaw).trim()
        ? String(r.staffStartEmailRaw).trim()
        : undefined,
    staffEndEmail:
      r.staffEndEmailRaw != null && String(r.staffEndEmailRaw).trim()
        ? String(r.staffEndEmailRaw).trim()
        : undefined,
    staffEmail: (() => {
      const end =
        r.staffEndEmailRaw != null && String(r.staffEndEmailRaw).trim()
          ? String(r.staffEndEmailRaw).trim()
          : '';
      const start =
        r.staffStartEmailRaw != null && String(r.staffStartEmailRaw).trim()
          ? String(r.staffStartEmailRaw).trim()
          : '';
      const primary = end || start;
      return primary || undefined;
    })(),
    staffStartFullName:
      r.staffStartFullNameRaw != null && String(r.staffStartFullNameRaw).trim()
        ? String(r.staffStartFullNameRaw).trim()
        : undefined,
    staffEndFullName:
      r.staffEndFullNameRaw != null && String(r.staffEndFullNameRaw).trim()
        ? String(r.staffEndFullNameRaw).trim()
        : undefined,
    remarks: r.submitBy || undefined,
    price: (() => {
      const v = r.schedulePrice;
      if (v == null || v === '') return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    })(),
    pricingAddons,
    colivingPropertydetailId: colivingPid,
    colivingRoomdetailId: colivingRid,
    clnOperatorId: clnOp,
    clnClientdetailId: clnCd,
    lat: jobLat,
    lng: jobLng,
    staffStartTime: r.staffStartTime || undefined,
    staffEndTime: r.staffEndTime || undefined,
    estimateCompleteAt,
    staffRemark: undefined,
    completedPhotos: photos,
    aiAssignmentLocked,
    btob: Number(r.btobRaw) === 1,
    mailboxPassword: r.mailboxPasswordRaw != null && String(r.mailboxPasswordRaw).trim()
      ? String(r.mailboxPasswordRaw).trim()
      : undefined,
    doorPin: (() => {
      const jobPin =
        r.jobSmartdoorPinRaw != null && String(r.jobSmartdoorPinRaw).trim()
          ? String(r.jobSmartdoorPinRaw).trim()
          : '';
      if (jobPin) return jobPin;
      return r.smartdoorPasswordRaw != null && String(r.smartdoorPasswordRaw).trim()
        ? String(r.smartdoorPasswordRaw).trim()
        : undefined;
    })(),
    smartdoorTokenEnabled: Number(r.smartdoorTokenEnabledRaw) === 1,
    propertySmartdoorId:
      r.propertySmartdoorIdRaw != null && String(r.propertySmartdoorIdRaw).trim()
        ? String(r.propertySmartdoorIdRaw).trim()
        : null,
    operatorDoorAccessMode:
      r.operatorDoorAccessModeRaw != null && String(r.operatorDoorAccessModeRaw).trim() !== ''
        ? String(r.operatorDoorAccessModeRaw).trim()
        : 'temporary_password_only',
  };
}

async function listOperatorScheduleJobs({ limit = 500, operatorId, dateFrom, dateTo } = {}) {
  await ensureOperatorTeamTable();
  const oid = String(operatorId || '').trim();
  const teams = await listOperatorTeams(oid || undefined);
  const df = String(dateFrom || '')
    .trim()
    .slice(0, 10);
  const dt = String(dateTo || '')
    .trim()
    .slice(0, 10);
  const hasDateRange = Boolean(df && dt && oid);
  const maxLim = hasDateRange ? 5000 : 1000;
  const lim = Math.min(Math.max(Number(limit) || (hasDateRange ? 3000 : 500), 1), maxLim);
  const ct = await getClnCompanyTable();
  const clientDisp = await buildClnPropertyClientDisplaySql(ct);
  const dateClause = hasDateRange
    ? ` AND (${SQL_CLN_SCHEDULE_JOB_DATE_KL_YMD}) >= ? AND (${SQL_CLN_SCHEDULE_JOB_DATE_KL_YMD}) <= ? `
    : '';
  const whereSql = oid ? `WHERE p.operator_id = ?${dateClause}` : '';
  const params = [];
  if (oid) params.push(oid);
  if (hasDateRange) params.push(df, dt);
  params.push(lim);
  const [hasMailboxPwd, hasSmartdoorPwd, hasSmartdoorTok, hasSmartdoorIdCol] = await Promise.all([
    databaseHasColumn('cln_property', 'mailbox_password'),
    databaseHasColumn('cln_property', 'smartdoor_password'),
    databaseHasColumn('cln_property', 'smartdoor_token_enabled'),
    databaseHasColumn('cln_property', 'smartdoor_id'),
  ]);
  const keyAccessSqlParts = [];
  keyAccessSqlParts.push(
    hasMailboxPwd
      ? `NULLIF(TRIM(p.mailbox_password), '') AS mailboxPasswordRaw`
      : `NULL AS mailboxPasswordRaw`,
  );
  keyAccessSqlParts.push(
    hasSmartdoorPwd
      ? `NULLIF(TRIM(p.smartdoor_password), '') AS smartdoorPasswordRaw`
      : `NULL AS smartdoorPasswordRaw`,
  );
  keyAccessSqlParts.push(
    hasSmartdoorTok ? `COALESCE(p.smartdoor_token_enabled, 0) AS smartdoorTokenEnabledRaw` : `0 AS smartdoorTokenEnabledRaw`,
  );
  keyAccessSqlParts.push(
    hasSmartdoorIdCol ? `NULLIF(TRIM(p.smartdoor_id), '') AS propertySmartdoorIdRaw` : `NULL AS propertySmartdoorIdRaw`,
  );
  const keyAccessSql = `,\n            ${keyAccessSqlParts.join(',\n            ')}`;
  const hasAiLockCol = await databaseHasColumn('cln_schedule', 'ai_assignment_locked');
  const aiLockSelect = hasAiLockCol ? 's.ai_assignment_locked AS aiAssignmentLockedRaw,' : '0 AS aiAssignmentLockedRaw,';
  const hasColivingCols =
    (await databaseHasColumn('cln_property', 'coliving_propertydetail_id')) &&
    (await databaseHasColumn('cln_property', 'coliving_roomdetail_id'));
  const hasClientdetailCol = await databaseHasColumn('cln_property', 'clientdetail_id');
  const clientdetailSelect = hasClientdetailCol ? 'p.clientdetail_id AS clnClientdetailId,' : 'NULL AS clnClientdetailId,';
  const hasPricingAddonsCol = await databaseHasColumn('cln_schedule', 'pricing_addons_json');
  const pricingAddonsSelect = hasPricingAddonsCol
    ? 's.pricing_addons_json AS pricingAddonsJson,'
    : 'NULL AS pricingAddonsJson,';
  const hasJobSmartdoorPin = await databaseHasColumn('cln_schedule', 'job_smartdoor_pin');
  const jobPinSelect = hasJobSmartdoorPin
    ? `NULLIF(TRIM(s.job_smartdoor_pin), '') AS jobSmartdoorPinRaw`
    : `NULL AS jobSmartdoorPinRaw`;
  const hasOperatorDoorMode = await databaseHasColumn('cln_property', 'operator_door_access_mode');
  const operatorDoorModeSelect = hasOperatorDoorMode
    ? `NULLIF(TRIM(p.operator_door_access_mode), '') AS operatorDoorAccessModeRaw`
    : `NULL AS operatorDoorAccessModeRaw`;
  const hasScheduleAuditCols = await databaseHasColumn('cln_schedule', 'created_by_email');
  const auditSelect = hasScheduleAuditCols
    ? `NULLIF(TRIM(s.created_by_email), '') AS createdByEmail,
            NULLIF(TRIM(s.ready_to_clean_by_email), '') AS readyToCleanByEmail,
            s.ready_to_clean_at AS readyToCleanAt,`
    : `NULL AS createdByEmail,
            NULL AS readyToCleanByEmail,
            NULL AS readyToCleanAt,`;
  const colivingSelect = hasColivingCols
    ? `p.operator_id AS clnOperatorId,
            ${clientdetailSelect}
            p.coliving_propertydetail_id AS colivingPropertydetailId,
            p.coliving_roomdetail_id AS colivingRoomdetailId`
    : `p.operator_id AS clnOperatorId,
            ${clientdetailSelect}
            NULL AS colivingPropertydetailId,
            NULL AS colivingRoomdetailId`;
  const propNavCols = await sqlPropertyNavigationUrlColumns();
  const [rows] = await pool.query(
    `SELECT s.id,
            s.property_id AS propertyId,
            COALESCE(p.property_name, p.unit_name, 'Property') AS propertyName,
            COALESCE(p.unit_name, '') AS unitNumber,
            COALESCE(p.bed_count, 1) AS bedCount,
            ${clientDisp.nameExpr} AS clientName,
            COALESCE(p.address, '') AS address,
            ${propNavCols}
            ${keyAccessSql},
            ${jobPinSelect},
            ${operatorDoorModeSelect},
            ${SQL_CLN_SCHEDULE_JOB_DATE_KL_YMD} AS jobDate,
            s.status AS rawStatus,
            s.cleaning_type AS cleaningType,
            s.team AS teamDbName,
            ${aiLockSelect}
            s.point AS kpiPoint,
            TIME_FORMAT(s.start_time, '%H:%i') AS staffStartTime,
            TIME_FORMAT(s.end_time, '%H:%i') AS staffEndTime,
            s.finalphoto_json AS finalPhotoJson,
            s.submit_by AS submitBy,
            COALESCE(s.btob, 0) AS btobRaw,
            s.price AS schedulePrice,
            NULLIF(TRIM(s.staff_start_email), '') AS staffStartEmailRaw,
            NULLIF(TRIM(s.staff_end_email), '') AS staffEndEmailRaw,
            ${sqlScheduleStaffDisplayNameRaw('staff_start_email')} AS staffStartFullNameRaw,
            ${sqlScheduleStaffDisplayNameRaw('staff_end_email')} AS staffEndFullNameRaw,
            ${auditSelect}
            ${pricingAddonsSelect}
            ${colivingSelect}
     FROM cln_schedule s
     LEFT JOIN cln_property p ON p.id = s.property_id
     ${clientDisp.joinSql}
     ${whereSql}
     ORDER BY ${hasDateRange ? 's.working_day ASC' : 's.working_day DESC'}, s.created_at DESC
     LIMIT ?`,
    params
  );
  return (rows || []).map((r) => mapScheduleRowToJobItem(r, teams));
}

/** Marker in `cln_schedule.submit_by` for jobs created from the B2B client portal. */
const CLN_SCHEDULE_SUBMIT_BY_CLIENT_PORTAL = 'cleanlemons-client';

/**
 * Client booking requests awaiting operator approval (Pricing → Request booking & approve).
 * Rows: `pending-checkout` + client-portal marker in `submit_by`. Homestay "customer missing" uses
 * the same status but does not use this submit_by value.
 */
async function listOperatorPendingClientBookingRequests({ operatorId, limit = 200 } = {}) {
  const oid = String(operatorId || '').trim();
  if (!oid) return [];
  await ensureOperatorTeamTable();
  const teams = await listOperatorTeams(oid);
  const lim = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const ct = await getClnCompanyTable();
  const clientDisp = await buildClnPropertyClientDisplaySql(ct);
  const hasAiLockCol = await databaseHasColumn('cln_schedule', 'ai_assignment_locked');
  const aiLockSelect = hasAiLockCol ? 's.ai_assignment_locked AS aiAssignmentLockedRaw,' : '0 AS aiAssignmentLockedRaw,';
  const hasColivingCols =
    (await databaseHasColumn('cln_property', 'coliving_propertydetail_id')) &&
    (await databaseHasColumn('cln_property', 'coliving_roomdetail_id'));
  const hasClientdetailCol = await databaseHasColumn('cln_property', 'clientdetail_id');
  const clientdetailSelect = hasClientdetailCol ? 'p.clientdetail_id AS clnClientdetailId,' : 'NULL AS clnClientdetailId,';
  const hasPricingAddonsCol = await databaseHasColumn('cln_schedule', 'pricing_addons_json');
  const pricingAddonsSelect = hasPricingAddonsCol
    ? 's.pricing_addons_json AS pricingAddonsJson,'
    : 'NULL AS pricingAddonsJson,';
  const hasScheduleAuditCols = await databaseHasColumn('cln_schedule', 'created_by_email');
  const auditSelect = hasScheduleAuditCols
    ? `NULLIF(TRIM(s.created_by_email), '') AS createdByEmail,
            NULLIF(TRIM(s.ready_to_clean_by_email), '') AS readyToCleanByEmail,
            s.ready_to_clean_at AS readyToCleanAt,`
    : `NULL AS createdByEmail,
            NULL AS readyToCleanByEmail,
            NULL AS readyToCleanAt,`;
  const colivingSelect = hasColivingCols
    ? `p.operator_id AS clnOperatorId,
            ${clientdetailSelect}
            p.coliving_propertydetail_id AS colivingPropertydetailId,
            p.coliving_roomdetail_id AS colivingRoomdetailId`
    : `p.operator_id AS clnOperatorId,
            ${clientdetailSelect}
            NULL AS colivingPropertydetailId,
            NULL AS colivingRoomdetailId`;
  const propNavColsPending = await sqlPropertyNavigationUrlColumns();
  const [rows] = await pool.query(
    `SELECT s.id,
            s.property_id AS propertyId,
            COALESCE(p.property_name, p.unit_name, 'Property') AS propertyName,
            COALESCE(p.unit_name, '') AS unitNumber,
            COALESCE(p.bed_count, 1) AS bedCount,
            ${clientDisp.nameExpr} AS clientName,
            COALESCE(p.address, '') AS address,
            ${propNavColsPending},
            ${SQL_CLN_SCHEDULE_JOB_DATE_KL_YMD} AS jobDate,
            s.status AS rawStatus,
            s.cleaning_type AS cleaningType,
            s.team AS teamDbName,
            ${aiLockSelect}
            s.point AS kpiPoint,
            TIME_FORMAT(s.start_time, '%H:%i') AS staffStartTime,
            TIME_FORMAT(s.end_time, '%H:%i') AS staffEndTime,
            s.finalphoto_json AS finalPhotoJson,
            s.submit_by AS submitBy,
            COALESCE(s.btob, 0) AS btobRaw,
            s.price AS schedulePrice,
            NULLIF(TRIM(s.staff_start_email), '') AS staffStartEmailRaw,
            NULLIF(TRIM(s.staff_end_email), '') AS staffEndEmailRaw,
            ${sqlScheduleStaffDisplayNameRaw('staff_start_email')} AS staffStartFullNameRaw,
            ${sqlScheduleStaffDisplayNameRaw('staff_end_email')} AS staffEndFullNameRaw,
            ${auditSelect}
            ${pricingAddonsSelect}
            ${colivingSelect}
     FROM cln_schedule s
     INNER JOIN cln_property p ON p.id = s.property_id
     ${clientDisp.joinSql}
     WHERE p.operator_id = ?
       AND LOWER(REPLACE(TRIM(s.status), ' ', '-')) = 'pending-checkout'
       AND TRIM(IFNULL(s.submit_by, '')) = ?
     ORDER BY s.working_day ASC, s.created_at ASC
     LIMIT ?`,
    [oid, CLN_SCHEDULE_SUBMIT_BY_CLIENT_PORTAL, lim]
  );
  return (rows || []).map((r) => mapScheduleRowToJobItem(r, teams));
}

async function decideOperatorClientBookingRequest({ operatorId, scheduleId, decision, statusSetByEmail } = {}) {
  const oid = String(operatorId || '').trim();
  const sid = String(scheduleId || '').trim();
  const dec = String(decision || '').trim().toLowerCase();
  if (!oid || !sid || (dec !== 'approve' && dec !== 'reject')) {
    const e = new Error('MISSING_PARAMS');
    e.code = 'MISSING_PARAMS';
    throw e;
  }
  const [[row]] = await pool.query(
    `SELECT s.id, s.status AS rawStatus, s.submit_by AS submitBy, p.operator_id AS operatorId
       FROM cln_schedule s
       INNER JOIN cln_property p ON p.id = s.property_id
      WHERE s.id = ?
      LIMIT 1`,
    [sid]
  );
  if (!row) {
    const e = new Error('NOT_FOUND');
    e.code = 'NOT_FOUND';
    throw e;
  }
  if (String(row.operatorId || '').trim() !== oid) {
    const e = new Error('OPERATOR_MISMATCH');
    e.code = 'OPERATOR_MISMATCH';
    throw e;
  }
  if (String(row.submitBy || '').trim() !== CLN_SCHEDULE_SUBMIT_BY_CLIENT_PORTAL) {
    const e = new Error('NOT_CLIENT_BOOKING_REQUEST');
    e.code = 'NOT_CLIENT_BOOKING_REQUEST';
    throw e;
  }
  if (normalizeScheduleStatus(row.rawStatus) !== 'pending-checkout') {
    const e = new Error('NOT_PENDING_APPROVAL');
    e.code = 'NOT_PENDING_APPROVAL';
    throw e;
  }
  if (dec === 'approve') {
    await updateOperatorScheduleJob(sid, {
      status: 'ready-to-clean',
      statusSetByEmail: statusSetByEmail != null ? String(statusSetByEmail).trim().slice(0, 255) : undefined,
    });
  } else {
    await updateOperatorScheduleJob(sid, { status: 'cancelled' });
  }
  return { ok: true };
}

/**
 * Pricing config keys: `general`, `homestay`, …; serviceProvider: `general-cleaning`, `general`, etc.
 */
function pricingKeyFromServiceProvider(serviceProvider) {
  const s = String(serviceProvider || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  if (s === 'general-cleaning' || s === 'general') return 'general';
  if (s === 'warm-cleaning' || s === 'warm') return 'warm';
  if (s === 'deep-cleaning' || s === 'deep') return 'deep';
  if (s === 'renovation-cleaning' || s === 'renovation') return 'renovation';
  if (s === 'homestay-cleaning' || s === 'homestay') return 'homestay';
  if (s === 'room-rental-cleaning' || s === 'room-rental' || s === 'roomrental') return 'room-rental';
  if (s === 'commercial-cleaning' || s === 'commercial') return 'commercial';
  if (s === 'office-cleaning' || s === 'office') return 'office';
  if (s === 'dobi') return 'dobi';
  if (s === 'other') return 'other';
  return null;
}

function resolveScheduleStatusFromPricingConfig(cfg, serviceProvider) {
  const sp = String(serviceProvider || 'general-cleaning').trim();
  const pkey = pricingKeyFromServiceProvider(sp);
  let mode = null;
  if (cfg && typeof cfg.bookingModeByService === 'object' && cfg.bookingModeByService != null) {
    const bm = cfg.bookingModeByService;
    mode = bm[pkey] ?? bm[sp] ?? (pkey ? bm[pkey] : null);
  }
  if (mode == null && cfg && cfg.bookingMode != null) {
    mode = cfg.bookingMode;
  }
  const m = String(mode ?? 'instant').toLowerCase();
  if (m === 'request_approve' || m === 'request' || (m.includes('request') && !m.includes('instant'))) {
    return 'pending-checkout';
  }
  return 'ready-to-clean';
}

/**
 * Operator portal / Jarvis create when `price` omitted: property cleaning rows first, then Finance → Pricing (by-hour / homestay propertyPrices).
 */
async function resolveOperatorPortalCreateJobDefaultPriceMyr(operatorId, propertyId, serviceProvider) {
  const oid = String(operatorId || '').trim();
  const pid = String(propertyId || '').trim();
  const sp = String(serviceProvider || 'general-cleaning').trim();
  const pkey = pricingKeyFromServiceProvider(sp);
  if (!oid || !pid || !pkey) return null;

  const props = await listOperatorProperties({ operatorId: oid, limit: 500, offset: 0, includeArchived: true });
  const pr = (Array.isArray(props) ? props : []).find((p) => String(p.id) === pid);
  if (!pr) return null;

  const rows = Array.isArray(pr.operatorCleaningPricingRows) ? pr.operatorCleaningPricingRows : [];
  const rowMatch = rows.find(
    (r) => String(r.service || '').trim().toLowerCase() === pkey && r.myr != null && Number(r.myr) > 0
  );
  if (rowMatch && Number.isFinite(Number(rowMatch.myr))) {
    return Math.round(Number(rowMatch.myr) * 100) / 100;
  }

  const cfg = await getPricingConfig(oid);
  if (!cfg || typeof cfg !== 'object') return null;
  const svc = cfg[pkey];
  if (!svc || typeof svc !== 'object') return null;
  if (svc.quotationEnabled && !svc.byHourEnabled && !svc.byPropertyEnabled) return null;

  if (svc.byHourEnabled && svc.byHour && typeof svc.byHour === 'object') {
    const bh = svc.byHour;
    const price = Number(bh.price);
    const blockHours = Math.max(0, Number(bh.hours) || 0);
    const workers = Math.max(0, Number(bh.workers) || 0);
    if (Number.isFinite(price) && price > 0 && blockHours > 0 && workers > 0) {
      const total = Math.round(price * blockHours * workers * 100) / 100;
      const minSp = Math.max(0, Number(bh.minSellingPrice) || 0);
      return minSp > 0 ? Math.max(total, Math.round(minSp * 100) / 100) : total;
    }
  }

  if (pkey === 'homestay' && svc && typeof svc === 'object') {
    const h = svc.homestay && typeof svc.homestay === 'object' ? svc.homestay : svc;
    const pname = String(pr.name || '').trim().toLowerCase();
    if (h.propertyPrices && typeof h.propertyPrices === 'object' && pname) {
      const pp = h.propertyPrices;
      for (const [k, v] of Object.entries(pp)) {
        if (String(k).trim().toLowerCase() === pname && Number(v) > 0) {
          return Math.round(Number(v) * 100) / 100;
        }
      }
      const vals = Object.values(pp)
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (vals.length) return Math.round(Math.min(...vals) * 100) / 100;
    }
  }

  return null;
}

/**
 * Single entry for cleaning jobs: applies operator pricing (bookingMode + bookingModeByService) when operatorId set.
 */
async function createCleaningScheduleJobUnified(input = {}) {
  const propertyId = String(input.propertyId || '').trim();
  const date = String(input.date || '').slice(0, 10);
  const time = input.time != null && String(input.time).trim() !== '' ? String(input.time).trim() : '09:00';
  const serviceProvider = String(input.serviceProvider || 'general-cleaning').trim();
  const remarks = input.remarks != null ? String(input.remarks).slice(0, 2000) : '';
  const operatorId = input.operatorId != null ? String(input.operatorId).trim() : '';
  const source = String(input.source || '').trim();
  let status = input.status;
  /** Operator portal Create Job: default pending check out; explicit `status` from caller is kept. */
  if (source === 'operator_portal') {
    status =
      input.status != null && String(input.status).trim() !== ''
        ? String(input.status).trim()
        : 'pending-checkout';
  } else if (operatorId) {
    const cfg = await getPricingConfig(operatorId);
    if (source === 'client_portal') {
      const pkey = pricingKeyFromServiceProvider(serviceProvider);
      const svcCheck = validateServiceInSelectedServices(cfg?.selectedServices, pkey);
      if (!svcCheck.ok) {
        const e = new Error(svcCheck.message || svcCheck.code);
        e.code = svcCheck.code || 'BOOKING_SERVICE_NOT_ALLOWED';
        throw e;
      }
      const isHomestay = pkey === 'homestay';
      let leadTimeRaw = cfg?.leadTime != null ? String(cfg.leadTime) : 'same_day';
      if (
        cfg &&
        typeof cfg.leadTimeByService === 'object' &&
        cfg.leadTimeByService != null &&
        pkey
      ) {
        const lts = cfg.leadTimeByService;
        const per = lts[pkey] != null ? String(lts[pkey]).trim() : '';
        if (per) leadTimeRaw = per;
      }
      const lt = validateBookingLeadTimeForConfig({
        leadTimeRaw,
        dateYmd: date,
        timeHm: time,
        isHomestay,
      });
      if (!lt.ok) {
        const e = new Error(lt.message || lt.code);
        e.code = lt.code || 'BOOKING_LEAD_TIME_NOT_MET';
        throw e;
      }
    }
    if (status == null) {
      status = resolveScheduleStatusFromPricingConfig(cfg, serviceProvider);
    }
  } else if (status == null) {
    status = 'ready-to-clean';
  }
  if (status == null) status = 'ready-to-clean';

  let priceResolved = input.price;
  if (
    source === 'operator_portal' &&
    operatorId &&
    propertyId &&
    (priceResolved === undefined || priceResolved === null || priceResolved === '')
  ) {
    const auto = await resolveOperatorPortalCreateJobDefaultPriceMyr(operatorId, propertyId, serviceProvider);
    if (auto != null) priceResolved = auto;
  }

  return createOperatorScheduleJob({
    propertyId,
    date,
    time,
    serviceProvider,
    remarks: remarks || undefined,
    status,
    teamId: input.teamId,
    id: input.id,
    addons: input.addons,
    createdByEmail: input.createdByEmail,
    price: priceResolved,
    clientPortalGroupId: input.clientPortalGroupId,
    btob: input.btob,
  });
}

/**
 * Create homestay-cleaning rows for every operator property whose name contains `nameContains` (case-insensitive),
 * for Malaysia calendar `dateYmd`, skipping units that already have any schedule row on that day.
 */
async function bulkCreateHomestayJobsByPropertyNameSubstring({
  operatorId,
  dateYmd,
  nameContains,
  createdByEmail,
} = {}) {
  const oid = String(operatorId || '').trim();
  const day = String(dateYmd || '').trim().slice(0, 10);
  const needle = String(nameContains || '').trim().toLowerCase();
  if (!oid) {
    const e = new Error('MISSING_OPERATOR_ID');
    e.code = 'MISSING_OPERATOR_ID';
    throw e;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const e = new Error('BAD_DATE');
    e.code = 'BAD_DATE';
    throw e;
  }
  if (needle.length < 2) {
    const e = new Error('NAME_TOO_SHORT');
    e.code = 'NAME_TOO_SHORT';
    throw e;
  }
  const todayMy = getTodayMalaysiaDate();
  if (day < todayMy) {
    const e = new Error('PAST_DAY');
    e.code = 'PAST_DAY';
    throw e;
  }

  const props = await listOperatorProperties({ operatorId: oid, limit: 1000, offset: 0, includeArchived: false });
  const arr = Array.isArray(props) ? props : [];
  const candidates = arr.filter((p) => String(p.name || '').trim().toLowerCase().includes(needle));

  let created = 0;
  let skipped = 0;
  const errors = [];
  for (const p of candidates) {
    const pid = String(p.id || '').trim();
    if (!pid) continue;
    try {
      const [existRows] = await pool.query(
        `SELECT 1 AS ok FROM cln_schedule s WHERE s.property_id = ? AND ${SQL_CLN_SCHEDULE_JOB_DATE_KL_YMD} = ? LIMIT 1`,
        [pid, day]
      );
      if (Array.isArray(existRows) && existRows.length) {
        skipped += 1;
        continue;
      }
      await createCleaningScheduleJobUnified({
        propertyId: pid,
        date: day,
        time: '09:00',
        serviceProvider: 'homestay-cleaning',
        remarks: 'Bulk homestay (property name match)',
        operatorId: oid,
        source: 'operator_portal',
        status: 'pending-checkout',
        createdByEmail: createdByEmail ? String(createdByEmail).trim().toLowerCase() : undefined,
      });
      created += 1;
    } catch (err) {
      errors.push({
        propertyId: pid,
        propertyName: String(p.name || '').trim(),
        unitNumber: String(p.unitNumber || '').trim(),
        message: String(err?.message || err).slice(0, 300),
        code: String(err?.code || '').slice(0, 64),
      });
    }
  }

  return {
    ok: true,
    workingDay: day,
    nameContains: needle,
    matched: candidates.length,
    created,
    skipped,
    errors,
  };
}

async function listClientPortalScheduleJobs({ clientdetailId, operatorId, limit = 200, groupId } = {}) {
  const cid = String(clientdetailId || '').trim();
  const oid = String(operatorId || '').trim();
  const gid = String(groupId || '').trim();
  if (!cid) return [];
  const hasGroupTables = await clnPropGroup.propertyGroupTablesExist();
  /** One group may contain properties under different operators — do not filter by a single p.operator_id. */
  const multiOperatorGroupScope = Boolean(gid && hasGroupTables);
  if (!multiOperatorGroupScope && !oid) return [];
  await ensureOperatorTeamTable();
  const teams = multiOperatorGroupScope ? [] : await listOperatorTeams(oid);
  const lim = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  const ct = await getClnCompanyTable();
  const [
    hasPricingAddonsCol,
    hasAuditCreatedBy,
    hasAuditReadyBy,
    hasAuditReadyAt,
    hasScheduleCreatedAt,
    hasPropOperatorId,
    hasPropClientdetailId,
    hasClientOpJunction,
  ] = await Promise.all([
    databaseHasColumn('cln_schedule', 'pricing_addons_json'),
    databaseHasColumn('cln_schedule', 'created_by_email'),
    databaseHasColumn('cln_schedule', 'ready_to_clean_by_email'),
    databaseHasColumn('cln_schedule', 'ready_to_clean_at'),
    databaseHasColumn('cln_schedule', 'created_at'),
    databaseHasColumn('cln_property', 'operator_id'),
    databaseHasColumn('cln_property', 'clientdetail_id'),
    databaseHasTable('cln_client_operator'),
  ]);
  /** Last column in SELECT — no trailing comma (MySQL rejects comma before FROM). */
  const pricingAddonsSelect = hasPricingAddonsCol
    ? 's.pricing_addons_json AS pricingAddonsJson'
    : 'NULL AS pricingAddonsJson';
  /** Only select audit columns when all three exist (partial migrations caused ER_BAD_FIELD_ERROR). */
  const hasFullScheduleAuditCols = hasAuditCreatedBy && hasAuditReadyBy && hasAuditReadyAt;
  const auditSelect = hasFullScheduleAuditCols
    ? `NULLIF(TRIM(s.created_by_email), '') AS createdByEmail,
            NULLIF(TRIM(s.ready_to_clean_by_email), '') AS readyToCleanByEmail,
            s.ready_to_clean_at AS readyToCleanAt,`
    : `NULL AS createdByEmail,
            NULL AS readyToCleanByEmail,
            NULL AS readyToCleanAt,`;
  const scheduleOrderBy = hasScheduleCreatedAt
    ? 's.working_day DESC, s.created_at DESC'
    : 's.working_day DESC, s.id DESC';
  const propNavColsClient = await sqlPropertyNavigationUrlColumns();
  const clientDisp = await buildClnPropertyClientDisplaySql(ct);
  let groupSql = '';
  const params = [];
  let operatorWhere = '';
  if (!multiOperatorGroupScope) {
    if (hasPropOperatorId) {
      operatorWhere = 'p.operator_id = ?';
      params.push(oid);
    } else if (hasPropClientdetailId && hasClientOpJunction) {
      operatorWhere = `EXISTS (
        SELECT 1 FROM cln_client_operator jco
        WHERE jco.operator_id = ? AND jco.clientdetail_id = p.clientdetail_id
      )`;
      params.push(oid);
    } else {
      console.warn(
        '[cleanlemon] listClientPortalScheduleJobs: cannot scope by operator (missing cln_property.operator_id and junction fallback)'
      );
      return [];
    }
  } else {
    operatorWhere = '1=1';
  }
  if (hasGroupTables) {
    if (hasPropClientdetailId) {
      groupSql = ` AND (
      p.clientdetail_id = ?
      OR EXISTS (
        SELECT 1 FROM cln_property_group_property gpp
        INNER JOIN cln_property_group_member m ON m.group_id = gpp.group_id
        WHERE gpp.property_id = p.id AND m.grantee_clientdetail_id = ? AND m.invite_status = 'active'
      )
    )`;
      params.push(cid, cid);
    } else {
      groupSql = ` AND EXISTS (
        SELECT 1 FROM cln_property_group_property gpp
        INNER JOIN cln_property_group_member m ON m.group_id = gpp.group_id
        WHERE gpp.property_id = p.id AND m.grantee_clientdetail_id = ? AND m.invite_status = 'active'
      )`;
      params.push(cid);
    }
  } else if (hasPropClientdetailId) {
    groupSql = ' AND p.clientdetail_id = ?';
    params.push(cid);
  } else {
    console.warn(
      '[cleanlemon] listClientPortalScheduleJobs: missing cln_property.clientdetail_id — cannot scope client rows'
    );
    return [];
  }
  if (gid && hasGroupTables) {
    groupSql += ` AND EXISTS (
      SELECT 1 FROM cln_property_group_property gpp2
      INNER JOIN cln_property_group gpg2 ON gpg2.id = gpp2.group_id
      WHERE gpp2.property_id = p.id AND gpg2.id = ?
        AND (gpg2.owner_clientdetail_id = ? OR EXISTS (
          SELECT 1 FROM cln_property_group_member m3
          WHERE m3.group_id = gpg2.id AND m3.grantee_clientdetail_id = ? AND m3.invite_status = 'active'
        ))
    )`;
    params.push(gid, cid, cid);
  }
  params.push(lim);
  const [rows] = await pool.query(
    `SELECT s.id,
            s.property_id AS propertyId,
            COALESCE(p.property_name, p.unit_name, 'Property') AS propertyName,
            COALESCE(p.unit_name, '') AS unitNumber,
            COALESCE(p.bed_count, 1) AS bedCount,
            ${clientDisp.nameExpr} AS clientName,
            COALESCE(p.address, '') AS address,
            ${propNavColsClient},
            ${SQL_CLN_SCHEDULE_JOB_DATE_KL_YMD} AS jobDate,
            s.status AS rawStatus,
            s.cleaning_type AS cleaningType,
            s.team AS teamDbName,
            s.point AS kpiPoint,
            TIME_FORMAT(s.start_time, '%H:%i') AS staffStartTime,
            TIME_FORMAT(s.end_time, '%H:%i') AS staffEndTime,
            s.finalphoto_json AS finalPhotoJson,
            s.submit_by AS submitBy,
            COALESCE(s.btob, 0) AS btobRaw,
            s.price AS schedulePrice,
            ${auditSelect}
            ${pricingAddonsSelect}
     FROM cln_schedule s
     INNER JOIN cln_property p ON p.id = s.property_id
     ${clientDisp.joinSql}
     WHERE ${operatorWhere}
     ${groupSql}
     ORDER BY ${scheduleOrderBy}
     LIMIT ?`,
    params
  );
  return (rows || []).map((r) => mapScheduleRowToJobItem(rowToJsonSafeFields(r), teams));
}

async function createClientPortalScheduleJob({
  clientdetailId,
  operatorId,
  propertyId,
  date,
  time,
  timeEnd,
  serviceProvider,
  createdByEmail,
  addons,
  price,
  clientRemark,
  groupId,
  btob,
}) {
  const cid = String(clientdetailId || '').trim();
  const oid = String(operatorId || '').trim();
  const pid = String(propertyId || '').trim();
  const gid = String(groupId || '').trim();
  if (!cid || !oid || !pid) {
    const e = new Error('MISSING_IDS');
    e.code = 'MISSING_IDS';
    throw e;
  }
  await assertClientdetailLinkedToOperator(oid, cid);
  const [[prop]] = await pool.query(
    'SELECT id, clientdetail_id, operator_id FROM cln_property WHERE id = ? LIMIT 1',
    [pid]
  );
  if (!prop) {
    const e = new Error('PROPERTY_NOT_FOUND');
    e.code = 'PROPERTY_NOT_FOUND';
    throw e;
  }
  if (gid) {
    try {
      const scope = await clnPropGroup.assertGroupPropertyInScope({
        clientdetailId: cid,
        groupId: gid,
        propertyId: pid,
        operatorId: oid,
      });
      if (!scope.perm.booking.create) {
        const e = new Error('GROUP_PERMISSION_DENIED');
        e.code = 'GROUP_PERMISSION_DENIED';
        throw e;
      }
    } catch (e) {
      if (
        e?.code === 'GROUP_ACCESS_DENIED' ||
        e?.code === 'GROUP_PROPERTY_MISMATCH' ||
        e?.code === 'GROUP_OPERATOR_MISMATCH'
      ) {
        const err = new Error(e.code);
        err.code = e.code;
        throw err;
      }
      throw e;
    }
  } else {
    if (String(prop.clientdetail_id || '') !== cid) {
      const e = new Error('PROPERTY_CLIENT_MISMATCH');
      e.code = 'PROPERTY_CLIENT_MISMATCH';
      throw e;
    }
    const po = prop.operator_id != null ? String(prop.operator_id).trim() : '';
    if (!po || po !== oid) {
      const e = new Error('PROPERTY_OPERATOR_MISMATCH');
      e.code = 'PROPERTY_OPERATOR_MISMATCH';
      throw e;
    }
  }
  const sp = String(serviceProvider || 'general-cleaning').trim();
  const pkey = pricingKeyFromServiceProvider(sp);
  const isHomestay = pkey === 'homestay';
  const timeStart = time != null && String(time).trim() !== '' ? String(time).trim() : '09:00';
  let remarks = 'cleanlemons-client';
  if (!isHomestay && timeEnd != null && String(timeEnd).trim() !== '') {
    remarks = `${timeStart} - ${String(timeEnd).trim()} | ${remarks}`;
  } else if (!isHomestay && timeStart) {
    remarks = `${timeStart} | ${remarks}`;
  }
  const note = clientRemark != null ? String(clientRemark).trim().slice(0, 2000) : '';
  if (note) {
    remarks = `${remarks} | ${note}`;
  }
  const btobFlag = isHomestay && (btob === true || btob === 1 || String(btob || '').toLowerCase() === 'true');
  if (btobFlag) {
    remarks = `${remarks} | BTOB: Same-day checkout + new check-in — please prioritize cleaning`;
  }
  return createCleaningScheduleJobUnified({
    propertyId: pid,
    date: String(date || '').slice(0, 10),
    time: timeStart,
    serviceProvider: sp,
    operatorId: oid,
    remarks,
    createdByEmail: createdByEmail != null ? String(createdByEmail).trim().slice(0, 255) : undefined,
    addons,
    price,
    source: 'client_portal',
    clientPortalGroupId: gid || undefined,
    btob: btobFlag,
  });
}

/**
 * Client portal: patch schedule row (e.g. Extend = new working day + status) after property ownership checks.
 */
async function updateClientPortalScheduleJob({
  clientdetailId,
  operatorId,
  scheduleId,
  workingDay,
  status,
  statusSetByEmail,
  groupId,
  btob,
  loginEmail,
}) {
  const cid = String(clientdetailId || '').trim();
  const oidIn = String(operatorId || '').trim();
  const sid = String(scheduleId || '').trim();
  const gidIn = String(groupId || '').trim();
  const loginEmailNorm = loginEmail != null ? String(loginEmail).trim().toLowerCase() : '';
  if (!cid || !sid) {
    const e = new Error('MISSING_IDS');
    e.code = 'MISSING_IDS';
    throw e;
  }
  const [[row]] = await pool.query(
    `SELECT p.id AS propertyId, p.clientdetail_id AS cd, p.operator_id AS op
     FROM cln_schedule s
     INNER JOIN cln_property p ON p.id = s.property_id
     WHERE s.id = ?
     LIMIT 1`,
    [sid]
  );
  if (!row) {
    const e = new Error('NOT_FOUND');
    e.code = 'NOT_FOUND';
    throw e;
  }
  const oid = String(row.op || '').trim();
  if (!oid) {
    const e = new Error('PROPERTY_OPERATOR_MISMATCH');
    e.code = 'PROPERTY_OPERATOR_MISMATCH';
    throw e;
  }
  if (oidIn && oidIn !== oid) {
    const e = new Error('PROPERTY_OPERATOR_MISMATCH');
    e.code = 'PROPERTY_OPERATOR_MISMATCH';
    throw e;
  }
  const pid = String(row.propertyId || '').trim();
  if ((await clnPropGroup.propertyGroupTablesExist()) && loginEmailNorm) {
    await clnPropGroup.activatePendingInvitesForClientPortal(cid, loginEmailNorm);
  }
  const acc = await clnPropGroup.getClientPropertyGroupAccess(cid, pid);
  if (acc.access === 'none') {
    const e = new Error('NOT_FOUND');
    e.code = 'NOT_FOUND';
    throw e;
  }
  if (acc.access === 'owner') {
    await assertClientdetailLinkedToOperator(oid, cid);
  }
  if (gidIn && (await clnPropGroup.propertyGroupTablesExist())) {
    try {
      const scope = await clnPropGroup.assertGroupPropertyInScope({
        clientdetailId: cid,
        groupId: gidIn,
        propertyId: pid,
        operatorId: oid,
      });
      if (acc.access === 'member' && acc.groupId && acc.groupId !== gidIn) {
        const e = new Error('GROUP_PROPERTY_MISMATCH');
        e.code = 'GROUP_PROPERTY_MISMATCH';
        throw e;
      }
      const stIn = status !== undefined ? status : null;
      const newNorm = stIn != null ? normalizeScheduleStatus(stIn) : '';
      const isCancel =
        newNorm === 'cancelled' ||
        String(stIn || '')
          .toLowerCase()
          .includes('cancel');
      if (workingDay !== undefined) {
        if (!scope.perm.booking.edit) {
          const e = new Error('GROUP_PERMISSION_DENIED');
          e.code = 'GROUP_PERMISSION_DENIED';
          throw e;
        }
      }
      if (btob !== undefined) {
        if (!scope.perm.booking.edit) {
          const e = new Error('GROUP_PERMISSION_DENIED');
          e.code = 'GROUP_PERMISSION_DENIED';
          throw e;
        }
      }
      if (stIn != null) {
        if (isCancel) {
          if (!scope.perm.booking.delete) {
            const e = new Error('GROUP_PERMISSION_DENIED');
            e.code = 'GROUP_PERMISSION_DENIED';
            throw e;
          }
        } else if (!scope.perm.status.edit && !scope.perm.status.create) {
          const e = new Error('GROUP_PERMISSION_DENIED');
          e.code = 'GROUP_PERMISSION_DENIED';
          throw e;
        }
      }
    } catch (e) {
      if (e?.code === 'GROUP_ACCESS_DENIED' || e?.code === 'GROUP_PROPERTY_MISMATCH') throw e;
      throw e;
    }
  } else if (String(row.cd || '').trim() !== cid) {
    const stIn = status !== undefined ? status : null;
    const newNorm = stIn != null ? normalizeScheduleStatus(stIn) : '';
    const isCancel =
      newNorm === 'cancelled' ||
      String(stIn || '')
        .toLowerCase()
        .includes('cancel');
    if (workingDay !== undefined) {
      if (!acc.perm.booking.edit) {
        const e = new Error('GROUP_PERMISSION_DENIED');
        e.code = 'GROUP_PERMISSION_DENIED';
        throw e;
      }
    }
    if (btob !== undefined) {
      if (!acc.perm.booking.edit) {
        const e = new Error('GROUP_PERMISSION_DENIED');
        e.code = 'GROUP_PERMISSION_DENIED';
        throw e;
      }
    }
    if (stIn != null) {
      if (isCancel) {
        if (!acc.perm.booking.delete) {
          const e = new Error('GROUP_PERMISSION_DENIED');
          e.code = 'GROUP_PERMISSION_DENIED';
          throw e;
        }
      } else if (!acc.perm.status.edit && !acc.perm.status.create) {
        const e = new Error('GROUP_PERMISSION_DENIED');
        e.code = 'GROUP_PERMISSION_DENIED';
        throw e;
      }
    }
  }
  const patch = { operatorId: oid };
  if (workingDay !== undefined) patch.workingDay = workingDay;
  if (status !== undefined) patch.status = status;
  if (statusSetByEmail !== undefined) patch.statusSetByEmail = statusSetByEmail;
  if (btob !== undefined) patch.btob = btob === true || btob === 1 || String(btob || '').toLowerCase() === 'true';
  await updateOperatorScheduleJob(sid, patch);
}

/**
 * Client portal: remove one schedule row (e.g. “Customer extend” — guest extended, job no longer needed).
 * Requires same property access as updates; grantees need `booking.delete`. Deletes `cln_damage_report` rows
 * for this schedule first (FK RESTRICT on `cln_damage_report.schedule_id`).
 */
async function deleteClientPortalScheduleJob({
  clientdetailId,
  operatorId,
  scheduleId,
  groupId,
  loginEmail,
}) {
  const cid = String(clientdetailId || '').trim();
  const oidIn = String(operatorId || '').trim();
  const sid = String(scheduleId || '').trim();
  const gidIn = String(groupId || '').trim();
  const loginEmailNorm = loginEmail != null ? String(loginEmail).trim().toLowerCase() : '';
  if (!cid || !sid) {
    const e = new Error('MISSING_IDS');
    e.code = 'MISSING_IDS';
    throw e;
  }
  const [[row]] = await pool.query(
    `SELECT p.id AS propertyId, p.clientdetail_id AS cd, p.operator_id AS op
     FROM cln_schedule s
     INNER JOIN cln_property p ON p.id = s.property_id
     WHERE s.id = ?
     LIMIT 1`,
    [sid]
  );
  if (!row) {
    const e = new Error('NOT_FOUND');
    e.code = 'NOT_FOUND';
    throw e;
  }
  const oid = String(row.op || '').trim();
  if (!oid) {
    const e = new Error('PROPERTY_OPERATOR_MISMATCH');
    e.code = 'PROPERTY_OPERATOR_MISMATCH';
    throw e;
  }
  if (oidIn && oidIn !== oid) {
    const e = new Error('PROPERTY_OPERATOR_MISMATCH');
    e.code = 'PROPERTY_OPERATOR_MISMATCH';
    throw e;
  }
  const pid = String(row.propertyId || '').trim();
  if ((await clnPropGroup.propertyGroupTablesExist()) && loginEmailNorm) {
    await clnPropGroup.activatePendingInvitesForClientPortal(cid, loginEmailNorm);
  }
  const acc = await clnPropGroup.getClientPropertyGroupAccess(cid, pid);
  if (acc.access === 'none') {
    const e = new Error('NOT_FOUND');
    e.code = 'NOT_FOUND';
    throw e;
  }
  if (acc.access === 'owner') {
    await assertClientdetailLinkedToOperator(oid, cid);
  }
  if (gidIn && (await clnPropGroup.propertyGroupTablesExist())) {
    try {
      const scope = await clnPropGroup.assertGroupPropertyInScope({
        clientdetailId: cid,
        groupId: gidIn,
        propertyId: pid,
        operatorId: oid,
      });
      if (acc.access === 'member' && acc.groupId && acc.groupId !== gidIn) {
        const e = new Error('GROUP_PROPERTY_MISMATCH');
        e.code = 'GROUP_PROPERTY_MISMATCH';
        throw e;
      }
      if (!scope.perm.booking.delete) {
        const e = new Error('GROUP_PERMISSION_DENIED');
        e.code = 'GROUP_PERMISSION_DENIED';
        throw e;
      }
    } catch (e) {
      if (e?.code === 'GROUP_ACCESS_DENIED' || e?.code === 'GROUP_PROPERTY_MISMATCH') throw e;
      throw e;
    }
  } else if (String(row.cd || '').trim() !== cid) {
    if (!acc.perm.booking.delete) {
      const e = new Error('GROUP_PERMISSION_DENIED');
      e.code = 'GROUP_PERMISSION_DENIED';
      throw e;
    }
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (await clnDamageReportTableExists()) {
      await conn.query('DELETE FROM cln_damage_report WHERE schedule_id = ?', [sid]);
    }
    const [del] = await conn.query('DELETE FROM cln_schedule WHERE id = ? LIMIT 1', [sid]);
    if (!del.affectedRows) {
      await conn.rollback();
      const e = new Error('NOT_FOUND');
      e.code = 'NOT_FOUND';
      throw e;
    }
    await conn.commit();
  } catch (e) {
    try {
      await conn.rollback();
    } catch (_) {
      /* ignore */
    }
    throw e;
  } finally {
    conn.release();
  }
  return { ok: true };
}

/**
 * Operator portal: delete one schedule row for this operator's property.
 * Deletes `cln_damage_report` rows first (FK RESTRICT on `cln_damage_report.schedule_id`).
 */
async function deleteOperatorScheduleJob({ scheduleId, operatorId }) {
  const sid = String(scheduleId || '').trim();
  const oidIn = String(operatorId || '').trim();
  if (!sid || !oidIn) {
    const e = new Error('MISSING_PARAMS');
    e.code = 'MISSING_PARAMS';
    throw e;
  }
  const [[row]] = await pool.query(
    `SELECT p.operator_id AS op
     FROM cln_schedule s
     INNER JOIN cln_property p ON p.id = s.property_id
     WHERE s.id = ?
     LIMIT 1`,
    [sid]
  );
  if (!row) {
    const e = new Error('NOT_FOUND');
    e.code = 'NOT_FOUND';
    throw e;
  }
  const dbOp = String(row.op || '').trim();
  if (!dbOp || dbOp !== oidIn) {
    const e = new Error('OPERATOR_MISMATCH');
    e.code = 'OPERATOR_MISMATCH';
    throw e;
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (await clnDamageReportTableExists()) {
      await conn.query('DELETE FROM cln_damage_report WHERE schedule_id = ?', [sid]);
    }
    const [del] = await conn.query('DELETE FROM cln_schedule WHERE id = ? LIMIT 1', [sid]);
    if (!del.affectedRows) {
      await conn.rollback();
      const e = new Error('NOT_FOUND');
      e.code = 'NOT_FOUND';
      throw e;
    }
    await conn.commit();
  } catch (e) {
    try {
      await conn.rollback();
    } catch (_) {
      /* ignore */
    }
    throw e;
  } finally {
    conn.release();
  }
  return { ok: true };
}

function safeParseScheduleSubmitByJson(raw) {
  try {
    const o = JSON.parse(String(raw || '{}'));
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

/**
 * Merges incoming submitByMeta into existing `cln_schedule.submit_by` JSON (does not wipe prior keys).
 * When completing with `completionAddons`, adds sum(priceMyr) to `cln_schedule.price` if column exists.
 */
async function resolveMergedSubmitByAndPrice(scheduleId, incomingMeta, patch, connection) {
  const q = connection ? connection.query.bind(connection) : pool.query.bind(pool);
  const [rows] = await q(
    'SELECT submit_by AS sb, price AS pr FROM cln_schedule WHERE id = ? LIMIT 1',
    [String(scheduleId)]
  );
  const row = rows && rows[0];
  const prev = safeParseScheduleSubmitByJson(row?.sb);
  const safeMeta =
    incomingMeta && typeof incomingMeta === 'object' ? { ...incomingMeta } : { raw: incomingMeta };
  const merged = { ...prev, ...safeMeta };
  let newPrice = null;
  const completing = patch.status !== undefined && normalizeScheduleStatus(patch.status) === 'completed';
  const addons = Array.isArray(safeMeta.completionAddons) ? safeMeta.completionAddons : [];
  if (completing && addons.length > 0) {
    const sum = addons.reduce((a, x) => a + Math.max(0, Number(x?.priceMyr) || 0), 0);
    if (Number.isFinite(sum) && sum > 0) {
      const cur = row?.pr != null && row.pr !== '' ? Number(row.pr) : 0;
      newPrice = Math.round((cur + sum) * 100) / 100;
    }
  }
  return { mergedJson: JSON.stringify(merged), newPrice };
}

async function getEmployeeJobCompletionAddons({ email, operatorId }) {
  await assertClnOperatorStaffEmail(operatorId, email);
  const settings = await getOperatorSettings(operatorId);
  const raw = Array.isArray(settings.jobCompletionAddons) ? settings.jobCompletionAddons : [];
  const items = raw
    .filter((x) => x && String(x.id || '').trim() && String(x.name || '').trim())
    .map((x) => ({
      id: String(x.id).trim(),
      name: String(x.name).trim().slice(0, 200),
      priceMyr: Math.max(0, Number(x.priceMyr) || 0),
    }));
  return { ok: true, items };
}

async function updateOperatorScheduleJob(id, patch) {
  const sid = String(id);
  const opFromPatch = patch.operatorId != null ? String(patch.operatorId).trim() : '';
  if (opFromPatch) {
    const [[opRow]] = await pool.query(
      `SELECT p.operator_id AS op
       FROM cln_schedule s
       INNER JOIN cln_property p ON p.id = s.property_id
       WHERE s.id = ? LIMIT 1`,
      [sid]
    );
    const dbOp = opRow && opRow.op != null ? String(opRow.op).trim() : '';
    if (!dbOp || dbOp !== opFromPatch) {
      const e = new Error('OPERATOR_MISMATCH');
      e.code = 'OPERATOR_MISMATCH';
      throw e;
    }
  }

  const hasReadyAudit = await databaseHasColumn('cln_schedule', 'ready_to_clean_by_email');
  let prepReadyAudit = null;
  if (hasReadyAudit && patch.status !== undefined) {
    const [[cur]] = await pool.query(
      'SELECT status AS rawStatus, ready_to_clean_at AS readyToCleanAt FROM cln_schedule WHERE id = ? LIMIT 1',
      [sid]
    );
    if (cur) {
      const prevNorm = normalizeScheduleStatus(cur.rawStatus);
      const newNorm = normalizeScheduleStatus(patch.status);
      if (newNorm === 'ready-to-clean' && prevNorm !== 'ready-to-clean' && !cur.readyToCleanAt) {
        prepReadyAudit = {
          email:
            patch.statusSetByEmail != null && String(patch.statusSetByEmail).trim()
              ? String(patch.statusSetByEmail).trim().slice(0, 255)
              : '',
        };
      }
    }
  }

  const fields = [];
  const vals = [];
  if (patch.workingDay !== undefined || patch.working_day !== undefined) {
    const d = String(patch.workingDay ?? patch.working_day ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      const e = new Error('INVALID_WORKING_DAY');
      e.code = 'BAD_REQUEST';
      throw e;
    }
    const wdSql = malaysiaLocalDateTimeForSchedule(d, '09:00') || `${d} 09:00:00.000`;
    fields.push('working_day = ?');
    vals.push(wdSql);
    fields.push('start_time = ?');
    vals.push(wdSql);
  }
  /** Operator portal edit booking: move job calendar day + wall-clock start (Malaysia HH:mm). */
  if (patch.date !== undefined) {
    const d = String(patch.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      const e = new Error('INVALID_DATE');
      e.code = 'BAD_REQUEST';
      throw e;
    }
    const tsRaw =
      patch.timeStart != null && String(patch.timeStart).trim()
        ? String(patch.timeStart).trim()
        : patch.time != null && String(patch.time).trim()
          ? String(patch.time).trim()
          : '09:00';
    const tsM = tsRaw.match(/^(\d{1,2}):(\d{2})/);
    const timePart = tsM ? `${String(Math.min(23, Math.max(0, parseInt(tsM[1], 10)))).padStart(2, '0')}:${String(Math.min(59, Math.max(0, parseInt(tsM[2], 10)))).padStart(2, '0')}` : '09:00';
    const wdSql = malaysiaLocalDateTimeForSchedule(d, timePart) || malaysiaWallClockToUtcDatetimeForDb(d, 9, 0);
    fields.push('working_day = ?');
    vals.push(wdSql);
    fields.push('start_time = ?');
    vals.push(wdSql);
  }
  if (patch.propertyId !== undefined) {
    const pid = String(patch.propertyId || '').trim();
    if (pid) {
      const [[okRow]] = await pool.query(
        `SELECT p.id AS okId
         FROM cln_schedule s
         INNER JOIN cln_property p0 ON p0.id = s.property_id
         INNER JOIN cln_property p ON p.id = ? AND p.operator_id = p0.operator_id
         WHERE s.id = ? LIMIT 1`,
        [pid, sid]
      );
      if (!okRow?.okId) {
        const e = new Error('PROPERTY_NOT_ALLOWED');
        e.code = 'BAD_REQUEST';
        throw e;
      }
      fields.push('property_id = ?');
      vals.push(pid);
    }
  }
  if (patch.serviceProvider !== undefined) {
    const ct = providerToCleaningType(patch.serviceProvider);
    fields.push('cleaning_type = ?');
    vals.push(ct);
  }
  if (patch.remarks !== undefined) {
    const r = patch.remarks != null ? String(patch.remarks).slice(0, 2000) : '';
    fields.push('submit_by = ?');
    vals.push(r || null);
  }
  if (patch.price !== undefined && (await databaseHasColumn('cln_schedule', 'price'))) {
    const n = Number(patch.price);
    if (Number.isFinite(n)) {
      fields.push('price = ?');
      vals.push(Math.round(Math.max(0, n) * 100) / 100);
    }
  }
  if (patch.addons !== undefined && (await databaseHasColumn('cln_schedule', 'pricing_addons_json'))) {
    const addonsSanitized = sanitizeScheduleJobAddons(patch.addons);
    fields.push('pricing_addons_json = ?');
    vals.push(addonsSanitized.length ? JSON.stringify(addonsSanitized) : null);
  }
  if (patch.teamId !== undefined) {
    const name = patch.teamId ? await getOperatorTeamNameById(patch.teamId) : null;
    fields.push('team = ?');
    vals.push(name);
  }
  if (patch.status !== undefined) {
    fields.push('status = ?');
    vals.push(String(patch.status));
  }
  if (patch.startTime !== undefined) {
    fields.push('start_time = ?');
    vals.push(patch.startTime ? new Date(patch.startTime) : null);
  }
  if (patch.endTime !== undefined) {
    fields.push('end_time = ?');
    vals.push(patch.endTime ? new Date(patch.endTime) : null);
  }
  if (patch.photos !== undefined) {
    const photoList = Array.isArray(patch.photos) ? patch.photos.filter((x) => typeof x === 'string') : [];
    fields.push('finalphoto_json = ?');
    vals.push(JSON.stringify(photoList));
  }
  if (patch.submitByMeta !== undefined) {
    const { mergedJson, newPrice } = await resolveMergedSubmitByAndPrice(sid, patch.submitByMeta, patch, null);
    fields.push('submit_by = ?');
    vals.push(mergedJson);
    if (newPrice != null && (await databaseHasColumn('cln_schedule', 'price'))) {
      fields.push('price = ?');
      vals.push(newPrice);
    }
  }
  const hasAiLockCol = await databaseHasColumn('cln_schedule', 'ai_assignment_locked');
  if (hasAiLockCol) {
    const terminal =
      patch.status !== undefined &&
      ['completed', 'cancelled'].includes(normalizeScheduleStatus(patch.status));
    if (terminal) {
      fields.push('ai_assignment_locked = ?');
      vals.push(1);
    } else   if (patch.aiAssignmentLocked !== undefined) {
      fields.push('ai_assignment_locked = ?');
      vals.push(patch.aiAssignmentLocked ? 1 : 0);
    }
  }
  if (patch.btob !== undefined && (await databaseHasColumn('cln_schedule', 'btob'))) {
    fields.push('btob = ?');
    vals.push(patch.btob ? 1 : 0);
  }
  if (prepReadyAudit) {
    if (prepReadyAudit.email) {
      fields.push('ready_to_clean_by_email = ?');
      vals.push(prepReadyAudit.email);
    }
    fields.push('ready_to_clean_at = NOW(3)');
  }
  if (!fields.length) return;
  vals.push(String(id));
  await pool.query(
    `UPDATE cln_schedule SET ${fields.join(', ')}, updated_at = NOW(3) WHERE id = ? LIMIT 1`,
    vals
  );
}

async function updateOperatorScheduleJobOnConnection(connection, id, patch) {
  const fields = [];
  const vals = [];
  if (patch.status !== undefined) {
    fields.push('status = ?');
    vals.push(String(patch.status));
  }
  if (patch.startTime !== undefined) {
    fields.push('start_time = ?');
    vals.push(patch.startTime ? new Date(patch.startTime) : null);
  }
  if (patch.endTime !== undefined) {
    fields.push('end_time = ?');
    vals.push(patch.endTime ? new Date(patch.endTime) : null);
  }
  if (patch.photos !== undefined) {
    const photoList = Array.isArray(patch.photos) ? patch.photos.filter((x) => typeof x === 'string') : [];
    fields.push('finalphoto_json = ?');
    vals.push(JSON.stringify(photoList));
  }
  if (patch.submitByMeta !== undefined) {
    const { mergedJson, newPrice } = await resolveMergedSubmitByAndPrice(
      String(id),
      patch.submitByMeta,
      patch,
      connection
    );
    fields.push('submit_by = ?');
    vals.push(mergedJson);
    if (newPrice != null && (await databaseHasColumn('cln_schedule', 'price'))) {
      fields.push('price = ?');
      vals.push(newPrice);
    }
  }
  if (patch.status !== undefined && (await databaseHasColumn('cln_schedule', 'ai_assignment_locked'))) {
    const n = normalizeScheduleStatus(patch.status);
    if (n === 'completed' || n === 'cancelled') {
      fields.push('ai_assignment_locked = ?');
      vals.push(1);
    }
  }
  if (!fields.length) return;
  vals.push(String(id));
  await connection.query(
    `UPDATE cln_schedule SET ${fields.join(', ')}, updated_at = NOW(3) WHERE id = ? LIMIT 1`,
    vals
  );
}

async function loadScheduleJobsForEmployeeGroup(jobIds, operatorId) {
  const ids = [...new Set((jobIds || []).map((x) => String(x || '').trim()).filter(Boolean))];
  if (!ids.length) return [];
  const oid = String(operatorId || '').trim();
  const hasCp = await databaseHasColumn('cln_property', 'coliving_propertydetail_id');
  if (!hasCp) {
    const e = new Error('GROUP_REQUIRES_COLIVING_PROPERTY');
    e.code = 'GROUP_REQUIRES_COLIVING_PROPERTY';
    throw e;
  }
  const ph = ids.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT s.id, s.property_id, s.working_day, s.status,
            ${SQL_CLN_SCHEDULE_JOB_DATE_KL_YMD} AS jobDate,
            p.operator_id AS clnOperatorId,
            p.clientdetail_id AS clnClientdetailId,
            p.coliving_propertydetail_id AS colivingPid,
            p.coliving_roomdetail_id AS colivingRid
     FROM cln_schedule s
     INNER JOIN cln_property p ON p.id = s.property_id
     WHERE s.id IN (${ph}) AND p.operator_id = ?`,
    [...ids, oid]
  );
  return rows || [];
}

function assertEmployeeScheduleGroupInvariant(rows, operatorId) {
  const oid = String(operatorId || '').trim();
  const dates = new Set();
  const pids = new Set();
  for (const r of rows) {
    if (String(r.clnOperatorId || '').trim() !== oid) {
      const e = new Error('OPERATOR_MISMATCH');
      e.code = 'OPERATOR_MISMATCH';
      throw e;
    }
    const pid = r.colivingPid != null ? String(r.colivingPid).trim() : '';
    if (!pid) {
      const e = new Error('GROUP_REQUIRES_COLIVING_PROPERTY');
      e.code = 'GROUP_REQUIRES_COLIVING_PROPERTY';
      throw e;
    }
    pids.add(pid);
    dates.add(String(r.jobDate || '').slice(0, 10));
  }
  if (pids.size !== 1 || dates.size !== 1) {
    const e = new Error('GROUP_MISMATCH');
    e.code = 'GROUP_MISMATCH';
    throw e;
  }
}

async function groupStartEmployeeScheduleJobs({ email, operatorId, jobIds, estimateCompleteAt, estimatePhotoCount }) {
  await assertClnOperatorStaffEmail(operatorId, email);
  const uniqueIds = [...new Set((jobIds || []).map((x) => String(x).trim()).filter(Boolean))];
  if (uniqueIds.length < 2) {
    const e = new Error('GROUP_MIN_JOBS');
    e.code = 'GROUP_MIN_JOBS';
    throw e;
  }
  const rows = await loadScheduleJobsForEmployeeGroup(uniqueIds, operatorId);
  if (rows.length !== uniqueIds.length) {
    const e = new Error('JOB_NOT_FOUND_OR_DENIED');
    e.code = 'JOB_NOT_FOUND_OR_DENIED';
    throw e;
  }
  assertEmployeeScheduleGroupInvariant(rows, operatorId);
  for (const r of rows) {
    if (normalizeScheduleStatus(r.status) !== 'ready-to-clean') {
      const e = new Error('GROUP_STATUS_MISMATCH');
      e.code = 'GROUP_STATUS_MISMATCH';
      throw e;
    }
  }
  const { randomUUID } = require('crypto');
  const groupOperationId = randomUUID();
  const startIso = new Date().toISOString();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const r of rows) {
      await updateOperatorScheduleJobOnConnection(conn, r.id, {
        status: 'in-progress',
        startTime: startIso,
        submitByMeta: {
          action: 'group-start-clean',
          groupOperationId,
          estimateCompleteAt: estimateCompleteAt != null ? String(estimateCompleteAt) : undefined,
          estimatePhotoCount: Number(estimatePhotoCount) || 3,
        },
      });
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  return { ok: true, groupOperationId, updatedIds: uniqueIds };
}

async function groupEndEmployeeScheduleJobs({ email, operatorId, jobIds, photos, remark }) {
  await assertClnOperatorStaffEmail(operatorId, email);
  const uniqueIds = [...new Set((jobIds || []).map((x) => String(x).trim()).filter(Boolean))];
  if (uniqueIds.length < 2) {
    const e = new Error('GROUP_MIN_JOBS');
    e.code = 'GROUP_MIN_JOBS';
    throw e;
  }
  const rows = await loadScheduleJobsForEmployeeGroup(uniqueIds, operatorId);
  if (rows.length !== uniqueIds.length) {
    const e = new Error('JOB_NOT_FOUND_OR_DENIED');
    e.code = 'JOB_NOT_FOUND_OR_DENIED';
    throw e;
  }
  assertEmployeeScheduleGroupInvariant(rows, operatorId);
  for (const r of rows) {
    if (normalizeScheduleStatus(r.status) !== 'in-progress') {
      const e = new Error('GROUP_END_STATUS_MISMATCH');
      e.code = 'GROUP_END_STATUS_MISMATCH';
      throw e;
    }
  }
  const { randomUUID } = require('crypto');
  const groupOperationId = randomUUID();
  const endIso = new Date().toISOString();
  const photoList = Array.isArray(photos) ? photos.filter((x) => typeof x === 'string') : [];
  const addonList = Array.isArray(completionAddons)
    ? completionAddons
        .filter((x) => x && String(x.id || '').trim() && String(x.name || '').trim())
        .map((x) => ({
          id: String(x.id).trim(),
          name: String(x.name).trim().slice(0, 200),
          priceMyr: Math.max(0, Number(x.priceMyr) || 0),
        }))
    : [];
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const r of rows) {
      await updateOperatorScheduleJobOnConnection(conn, r.id, {
        status: 'completed',
        endTime: endIso,
        photos: photoList,
        submitByMeta: {
          action: 'group-end-clean',
          groupOperationId,
          remark: remark != null ? String(remark).slice(0, 2000) : '',
          completedAt: endIso,
          sharedPhotos: photoList,
          ...(addonList.length ? { completionAddons: addonList } : {}),
        },
      });
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  return { ok: true, groupOperationId, updatedIds: uniqueIds };
}

function resolveSmartDoorScopeForEmployeeLock(lockRow, jobClnOperatorId, jobClnClientdetailId) {
  const jOid = String(jobClnOperatorId || '').trim();
  const jCid = String(jobClnClientdetailId || '').trim();
  if (lockRow.cln_operatorid != null && String(lockRow.cln_operatorid).trim() !== '') {
    const lid = String(lockRow.cln_operatorid).trim();
    if (jOid && lid === jOid) {
      return { kind: 'cln_operator', clnOperatorId: lid };
    }
  }
  if (lockRow.cln_clientid != null && String(lockRow.cln_clientid).trim() !== '') {
    const cc = String(lockRow.cln_clientid).trim();
    if (!jCid || cc === jCid) {
      return { kind: 'cln_client', clnClientId: cc };
    }
  }
  if (lockRow.client_id != null && String(lockRow.client_id).trim() !== '') {
    return { kind: 'coliving', clientId: String(lockRow.client_id).trim() };
  }
  return null;
}

async function colivingLockDetailIdsForPropertyRoom(colivingPropertydetailId, colivingRoomdetailId) {
  const pid = String(colivingPropertydetailId || '').trim();
  const propertyLockIds = [];
  const roomLockIds = [];
  if (!pid) return { propertyLockIds, roomLockIds };
  try {
    const [[prop]] = await pool.query('SELECT smartdoor_id FROM propertydetail WHERE id = ? LIMIT 1', [pid]);
    if (prop?.smartdoor_id) propertyLockIds.push(String(prop.smartdoor_id).trim());
  } catch (_) {
    /* missing table/column in some envs */
  }
  const rid = String(colivingRoomdetailId || '').trim();
  if (rid) {
    try {
      const [[room]] = await pool.query('SELECT smartdoor_id FROM roomdetail WHERE id = ? LIMIT 1', [rid]);
      if (room?.smartdoor_id) roomLockIds.push(String(room.smartdoor_id).trim());
    } catch (_) {
      /* */
    }
  }
  return { propertyLockIds, roomLockIds };
}

async function listEmployeeTaskUnlockTargets({ email, operatorId, jobId }) {
  await assertClnOperatorStaffEmail(operatorId, email);
  const jid = String(jobId || '').trim();
  const oid = String(operatorId || '').trim();
  const hasCp = await databaseHasColumn('cln_property', 'coliving_propertydetail_id');
  if (!hasCp) {
    return { ok: true, targets: [] };
  }
  const hasCd = await databaseHasColumn('cln_property', 'clientdetail_id');
  const cdSel = hasCd ? 'p.clientdetail_id AS clnClientdetailId' : 'NULL AS clnClientdetailId';
  const [[row]] = await pool.query(
    `SELECT p.operator_id AS clnOperatorId, ${cdSel},
            p.coliving_propertydetail_id AS colivingPid, p.coliving_roomdetail_id AS colivingRid
     FROM cln_schedule s
     INNER JOIN cln_property p ON p.id = s.property_id
     WHERE s.id = ? LIMIT 1`,
    [jid]
  );
  if (!row) {
    const e = new Error('JOB_NOT_FOUND');
    e.code = 'JOB_NOT_FOUND';
    throw e;
  }
  if (String(row.clnOperatorId || '').trim() !== oid) {
    const e = new Error('OPERATOR_MISMATCH');
    e.code = 'OPERATOR_MISMATCH';
    throw e;
  }
  const colivingPid = row.colivingPid != null ? String(row.colivingPid).trim() : '';
  if (!colivingPid) {
    return { ok: true, targets: [] };
  }
  const { propertyLockIds, roomLockIds } = await colivingLockDetailIdsForPropertyRoom(colivingPid, row.colivingRid);
  const ordered = [];
  const seen = new Set();
  for (const id of propertyLockIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ordered.push({ id, role: 'property' });
  }
  for (const id of roomLockIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ordered.push({ id, role: 'room' });
  }
  const sd = require('../smartdoorsetting/smartdoorsetting.service');
  const targets = [];
  const jOid = String(row.clnOperatorId || '').trim();
  const jCid = row.clnClientdetailId != null ? String(row.clnClientdetailId).trim() : '';
  for (const { id: lockDetailId, role } of ordered) {
    const [lockRows] = await pool.query(
      'SELECT id, lockid, lockalias, lockname, client_id, cln_clientid, cln_operatorid FROM lockdetail WHERE id = ? LIMIT 1',
      [lockDetailId]
    );
    const lockRow = lockRows?.[0];
    if (!lockRow || lockRow.lockid == null) continue;
    const scope = resolveSmartDoorScopeForEmployeeLock(lockRow, jOid, jCid);
    if (!scope) continue;
    const label =
      role === 'property'
        ? `Property door: ${lockRow.lockalias || lockRow.lockname || lockDetailId}`
        : `Room door: ${lockRow.lockalias || lockRow.lockname || lockDetailId}`;
    let scopeArg;
    if (scope.kind === 'coliving') scopeArg = scope.clientId;
    else if (scope.kind === 'cln_client') scopeArg = { kind: 'cln_client', clnClientId: scope.clnClientId };
    else scopeArg = { kind: 'cln_operator', clnOperatorId: scope.clnOperatorId };
    const gated = await sd.getLock(scopeArg, lockDetailId);
    if (!gated) continue;
    targets.push({
      lockDetailId: String(lockRow.id),
      lockId: String(lockRow.lockid),
      label,
      role,
      scopeKind: scope.kind,
    });
  }
  return { ok: true, targets };
}

async function employeeTaskRemoteUnlock({ email, operatorId, jobId, lockDetailId }) {
  const preview = await listEmployeeTaskUnlockTargets({ email, operatorId, jobId });
  const lid = String(lockDetailId || '').trim();
  const allowed = (preview.targets || []).some((x) => String(x.lockDetailId) === lid);
  if (!allowed) {
    const e = new Error('LOCK_NOT_ALLOWED');
    e.code = 'LOCK_NOT_ALLOWED';
    throw e;
  }
  const hasCd = await databaseHasColumn('cln_property', 'clientdetail_id');
  const cdSel = hasCd ? 'p.clientdetail_id AS cd' : 'NULL AS cd';
  const [[jobRow]] = await pool.query(
    `SELECT p.operator_id AS op, ${cdSel} FROM cln_schedule s INNER JOIN cln_property p ON p.id = s.property_id WHERE s.id = ? LIMIT 1`,
    [String(jobId).trim()]
  );
  const [lockRows] = await pool.query(
    'SELECT id, lockid, client_id, cln_clientid, cln_operatorid FROM lockdetail WHERE id = ? LIMIT 1',
    [lid]
  );
  const lockRow = lockRows?.[0];
  if (!lockRow) {
    const e = new Error('LOCK_NOT_FOUND');
    e.code = 'LOCK_NOT_FOUND';
    throw e;
  }
  const scope = resolveSmartDoorScopeForEmployeeLock(lockRow, String(jobRow?.op || '').trim(), String(jobRow?.cd || '').trim());
  if (!scope) {
    const e = new Error('LOCK_SCOPE_DENIED');
    e.code = 'LOCK_SCOPE_DENIED';
    throw e;
  }
  const sd = require('../smartdoorsetting/smartdoorsetting.service');
  const [[propDoor]] = await pool.query(
    `SELECT COALESCE(NULLIF(TRIM(p.operator_door_access_mode), ''), 'temporary_password_only') AS mode
     FROM cln_schedule s INNER JOIN cln_property p ON p.id = s.property_id WHERE s.id = ? LIMIT 1`,
    [String(jobId).trim()]
  );
  let dm = String(propDoor?.mode || 'temporary_password_only').toLowerCase();
  if (dm === 'working_date_only') dm = 'temporary_password_only';
  if (dm === 'fixed_password') {
    const e = new Error('OPERATOR_DOOR_USE_PASSWORD');
    e.code = 'OPERATOR_DOOR_USE_PASSWORD';
    throw e;
  }
  if (dm === 'temporary_password_only') {
    const ymd = getTodayMalaysiaDate();
    const [[hit]] = await pool.query(
      `SELECT 1 AS ok FROM cln_schedule WHERE id = ? AND working_day IS NOT NULL AND (${SQL_CLN_SCHEDULE_WORKING_DAY_KL_YMD_BARE}) = ? LIMIT 1`,
      [String(jobId).trim(), ymd]
    );
    if (!hit) {
      const e = new Error('OPERATOR_DOOR_NO_BOOKING_TODAY');
      e.code = 'OPERATOR_DOOR_NO_BOOKING_TODAY';
      throw e;
    }
  }
  let scopeArg;
  if (scope.kind === 'coliving') scopeArg = scope.clientId;
  else if (scope.kind === 'cln_client') scopeArg = { kind: 'cln_client', clnClientId: scope.clnClientId };
  else scopeArg = { kind: 'cln_operator', clnOperatorId: scope.clnOperatorId };
  await sd.remoteUnlockLock(scopeArg, lid, {
    actorEmail: email,
    portalSource: 'cln_employee_task',
    jobId: String(jobId).trim(),
  });
  return { ok: true };
}

/** Operator Create Job: selected pricing add-ons (name, basis, price, quantity, subtotal). */
function sanitizeScheduleJobAddons(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const a of raw) {
    if (!a || typeof a !== 'object') continue;
    const name = String(a.name || '')
      .trim()
      .slice(0, 200);
    if (!name) continue;
    const basisRaw = String(a.basis || 'fixed').toLowerCase();
    const basis =
      basisRaw === 'quantity' || basisRaw === 'bed' || basisRaw === 'room' || basisRaw === 'fixed'
        ? basisRaw
        : 'fixed';
    const price = Math.max(0, Math.min(1e9, Number(a.price) || 0));
    let qty = Math.max(1, Math.min(9999, Math.floor(Number(a.quantity) || 1)));
    if (basis === 'fixed') qty = 1;
    const id = a.id != null ? String(a.id).trim().slice(0, 128) : '';
    const subtotal = Math.round(price * qty * 100) / 100;
    const row = { name, basis, price, quantity: qty, subtotal };
    if (id) row.id = id;
    out.push(row);
  }
  return out;
}

function malaysiaLocalDateTimeForSchedule(dateStr, timeStr) {
  const d = String(dateStr || '').slice(0, 10);
  const t = String(timeStr || '09:00').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const tm = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!tm) return null;
  const hh = Math.min(23, Math.max(0, parseInt(tm[1], 10)));
  const mm = Math.min(59, Math.max(0, parseInt(tm[2], 10)));
  return malaysiaWallClockToUtcDatetimeForDb(d, hh, mm);
}

async function createOperatorScheduleJob(input) {
  const id = input.id || makeId('cln-sch');
  const propertyId = String(input.propertyId || '');
  if (!propertyId) {
    const err = new Error('MISSING_PROPERTY_ID');
    err.code = 'MISSING_PROPERTY_ID';
    throw err;
  }
  const date = String(input.date || '').slice(0, 10);
  if (!date) {
    const err = new Error('MISSING_DATE');
    err.code = 'MISSING_DATE';
    throw err;
  }
  const cleaningType = providerToCleaningType(input.serviceProvider);
  const status = String(input.status || 'pending-checkout');
  let teamName = null;
  if (input.teamId) teamName = await getOperatorTeamNameById(input.teamId);
  const timePart = input.time != null && String(input.time).trim() !== '' ? String(input.time).trim() : '09:00';
  const workingDay =
    malaysiaLocalDateTimeForSchedule(date, timePart) || malaysiaWallClockToUtcDatetimeForDb(date, 9, 0);
  const remark = String(input.remarks || '').slice(0, 2000) || null;
  const addonsSanitized = sanitizeScheduleJobAddons(input.addons);
  const [hasAddonsCol, hasBtobCol] = await Promise.all([
    databaseHasColumn('cln_schedule', 'pricing_addons_json'),
    databaseHasColumn('cln_schedule', 'btob'),
  ]);
  const addonsJson =
    hasAddonsCol && addonsSanitized.length > 0 ? JSON.stringify(addonsSanitized) : null;
  const startAt = workingDay;
  const createdBy =
    input.createdByEmail != null && String(input.createdByEmail).trim()
      ? String(input.createdByEmail).trim().slice(0, 255)
      : null;
  const hasAuditCols = await databaseHasColumn('cln_schedule', 'created_by_email');
  const statusNorm = normalizeScheduleStatus(status);
  const isReady = statusNorm === 'ready-to-clean';

  let priceNum = null;
  if (input.price != null && input.price !== '') {
    const n = Number(input.price);
    if (Number.isFinite(n)) priceNum = Math.round(Math.max(0, n) * 100) / 100;
  }

  const btobVal =
    hasBtobCol && (input.btob === true || input.btob === 1 || String(input.btob || '').toLowerCase() === 'true')
      ? 1
      : 0;
  const insertParams = [id, propertyId, workingDay, startAt, status, cleaningType, teamName, remark];
  let colList =
    'id, property_id, working_day, start_time, status, cleaning_type, team, submit_by';
  if (hasBtobCol) {
    colList += ', btob';
    insertParams.push(btobVal);
  }
  if (hasAddonsCol) {
    colList += ', pricing_addons_json';
    insertParams.push(addonsJson);
  }
  if (hasAuditCols) {
    colList += ', created_by_email';
    insertParams.push(createdBy);
    if (isReady && createdBy) {
      colList += ', ready_to_clean_by_email, ready_to_clean_at';
      insertParams.push(createdBy);
    }
  }
  colList += ', price';
  insertParams.push(priceNum);
  colList += ', created_at, updated_at';
  const valParts = insertParams.map(() => '?');
  if (hasAuditCols && isReady && createdBy) {
    valParts.push('NOW(3)');
  }
  valParts.push('NOW(3)', 'NOW(3)');
  const hasGroupCol = await databaseHasColumn('cln_schedule', 'client_portal_group_id');
  const gidIn = input.clientPortalGroupId != null ? String(input.clientPortalGroupId).trim() : '';
  if (hasGroupCol && gidIn) {
    const pos = colList.split(', ').indexOf('property_id');
    if (pos >= 0) {
      const parts = colList.split(', ');
      const pi = parts.indexOf('property_id');
      parts.splice(pi + 1, 0, 'client_portal_group_id');
      colList = parts.join(', ');
      const ip = insertParams.indexOf(propertyId);
      insertParams.splice(ip + 1, 0, gidIn);
      valParts.splice(ip + 1, 0, '?');
    }
  }
  await pool.query(
    `INSERT INTO cln_schedule (${colList}) VALUES (${valParts.join(', ')})`,
    insertParams
  );
  try {
    const clnSmartPin = require('./cleanlemon-smartdoor-operator-pin.service');
    await clnSmartPin.syncJobTemporaryPasscodeForSchedule(id);
  } catch (e) {
    console.warn('[cleanlemon] syncJobTemporaryPasscodeForSchedule', id, e?.message || e);
  }
  return id;
}

function clnSanitizePersistableUrl(v) {
  const s = String(v ?? '').trim();
  if (!s || s.startsWith('blob:')) return null;
  return s;
}

/** WGS84 pair for `cln_property.latitude` / `longitude`; both required or both null. */
function parseClnOptionalLatLng(latIn, lngIn) {
  const latRaw = latIn === undefined || latIn === null || latIn === '' ? null : Number(latIn);
  const lngRaw = lngIn === undefined || lngIn === null || lngIn === '' ? null : Number(lngIn);
  if (latRaw == null && lngRaw == null) return { lat: null, lng: null };
  if (latRaw == null || lngRaw == null) return { lat: null, lng: null };
  if (!Number.isFinite(latRaw) || !Number.isFinite(lngRaw)) return { lat: null, lng: null };
  if (Math.abs(latRaw) > 90 || Math.abs(lngRaw) > 180) return { lat: null, lng: null };
  return { lat: latRaw, lng: lngRaw };
}

/** B2B clients linked to this operator (`cln_clientdetail` via `cln_client_operator`). */
async function listOperatorLinkedClientdetails({ operatorId } = {}) {
  const oid = String(operatorId || '').trim();
  if (!oid) return [];
  try {
    const [rows] = await pool.query(
      `SELECT d.id AS id,
              TRIM(COALESCE(NULLIF(TRIM(d.fullname), ''), NULLIF(TRIM(d.email), ''), d.id)) AS name,
              COALESCE(TRIM(d.email), '') AS email
       FROM cln_clientdetail d
       INNER JOIN cln_client_operator j ON j.clientdetail_id = d.id AND j.operator_id = ?
       ORDER BY name ASC`,
      [oid]
    );
    return (rows || []).map((r) => ({
      id: String(r.id || '').trim(),
      name: String(r.name || r.email || r.id || '').trim(),
      email: String(r.email || '').trim(),
    }));
  } catch (_) {
    return [];
  }
}

async function assertClientdetailLinkedToOperator(operatorId, clientdetailId) {
  const oid = String(operatorId || '').trim();
  const cid = String(clientdetailId || '').trim();
  if (!oid || !cid) return;
  try {
    const [[row]] = await pool.query(
      'SELECT 1 AS ok FROM cln_client_operator WHERE operator_id = ? AND clientdetail_id = ? LIMIT 1',
      [oid, cid]
    );
    if (!row) {
      const e = new Error('CLIENTDETAIL_NOT_LINKED');
      e.code = 'CLIENTDETAIL_NOT_LINKED';
      throw e;
    }
  } catch (e) {
    if (e && e.code === 'CLIENTDETAIL_NOT_LINKED') throw e;
  }
}

async function listOperatorProperties({ limit = 200, offset = 0, operatorId, includeArchived = false } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const off = Math.max(Number(offset) || 0, 0);
  const oid = String(operatorId || '').trim();
  const ct = await getClnCompanyTable();
  const hasClientdetailCol = await databaseHasColumn('cln_property', 'clientdetail_id');
  const hasOpCol = await databaseHasColumn('cln_property', 'operator_id');
  const hasClientIdCol = await databaseHasColumn('cln_property', 'client_id');
  const hasOpPortalArchived = await databaseHasColumn('cln_property', 'operator_portal_archived');
  const [
    hasPortalOwned,
    hasPremisesType,
    hasSecuritySystem,
    hasSecurityUsername,
    hasAfterPhoto,
    hasKeyPhoto,
    hasSmartdoorPwd,
    hasSmartdoorTok,
    hasMailboxPwd,
    hasWazeUrl,
    hasGoogleMapsUrl,
    hasLatitudeCol,
    hasLongitudeCol,
    hasOperatorCleaningLine,
    hasOperatorCleaningPrice,
    hasOperatorCleaningService,
    hasOperatorCleaningRowsJson,
    hasOpGroupTable,
    hasOpGroupPropTable,
    hasBedCountList,
    hasRoomCountList,
    hasBathroomCountList,
    hasKitchenList,
    hasLivingRoomList,
    hasBalconyList,
    hasStaircaseList,
    hasLiftLevelList,
    hasSpecialAreaCountList,
    hasMinValueList,
  ] = await Promise.all([
    databaseHasColumn('cln_property', 'client_portal_owned'),
    databaseHasColumn('cln_property', 'premises_type'),
    databaseHasColumn('cln_property', 'security_system'),
    databaseHasColumn('cln_property', 'security_username'),
    databaseHasColumn('cln_property', 'after_clean_photo_url'),
    databaseHasColumn('cln_property', 'key_photo_url'),
    databaseHasColumn('cln_property', 'smartdoor_password'),
    databaseHasColumn('cln_property', 'smartdoor_token_enabled'),
    databaseHasColumn('cln_property', 'mailbox_password'),
    databaseHasColumn('cln_property', 'waze_url'),
    databaseHasColumn('cln_property', 'google_maps_url'),
    databaseHasColumn('cln_property', 'latitude'),
    databaseHasColumn('cln_property', 'longitude'),
    databaseHasColumn('cln_property', 'operator_cleaning_pricing_line'),
    databaseHasColumn('cln_property', 'operator_cleaning_price_myr'),
    databaseHasColumn('cln_property', 'operator_cleaning_pricing_service'),
    databaseHasColumn('cln_property', 'operator_cleaning_pricing_rows_json'),
    databaseHasTable('cln_operator_property_group'),
    databaseHasTable('cln_operator_property_group_property'),
    databaseHasColumn('cln_property', 'bed_count'),
    databaseHasColumn('cln_property', 'room_count'),
    databaseHasColumn('cln_property', 'bathroom_count'),
    databaseHasColumn('cln_property', 'kitchen'),
    databaseHasColumn('cln_property', 'living_room'),
    databaseHasColumn('cln_property', 'balcony'),
    databaseHasColumn('cln_property', 'staircase'),
    databaseHasColumn('cln_property', 'lift_level'),
    databaseHasColumn('cln_property', 'special_area_count'),
    databaseHasColumn('cln_property', 'min_value'),
  ]);
  const hasOpGroupSchema = hasOpGroupTable && hasOpGroupPropTable;
  const archivedClause =
    hasOpPortalArchived && !includeArchived ? ' AND COALESCE(p.operator_portal_archived, 0) = 0 ' : '';
  const scopeWhere = oid
    ? hasOpCol
      ? ` WHERE p.operator_id = ? ${archivedClause}`
      : hasClientIdCol
        ? ` WHERE p.client_id = ? ${archivedClause}`
        : ' WHERE 1=0 '
    : ' WHERE 1=0 ';
  const scopeParams = oid && (hasOpCol || hasClientIdCol) ? [oid] : oid ? [] : [];
  const extraSelect = [];
  if (hasPortalOwned) extraSelect.push('COALESCE(p.client_portal_owned, 0) AS clientPortalOwned');
  else extraSelect.push('0 AS clientPortalOwned');
  if (hasOpPortalArchived) extraSelect.push('COALESCE(p.operator_portal_archived, 0) AS operatorPortalArchived');
  else extraSelect.push('0 AS operatorPortalArchived');
  if (hasClientdetailCol) extraSelect.push('NULLIF(TRIM(p.clientdetail_id), \'\') AS clientdetailId');
  if (hasPremisesType) extraSelect.push('p.premises_type AS premisesType');
  if (hasSecuritySystem) extraSelect.push('p.security_system AS securitySystem');
  if (hasSecurityUsername) extraSelect.push('p.security_username AS securityUsername');
  if (hasAfterPhoto) extraSelect.push('p.after_clean_photo_url AS afterCleanPhotoUrl');
  if (hasKeyPhoto) extraSelect.push('p.key_photo_url AS keyPhotoUrl');
  if (hasMailboxPwd) extraSelect.push('p.mailbox_password AS mailboxPassword');
  if (hasSmartdoorPwd) extraSelect.push('p.smartdoor_password AS smartdoorPassword');
  if (hasSmartdoorTok) extraSelect.push('COALESCE(p.smartdoor_token_enabled, 0) AS smartdoorTokenEnabled');
  if (hasWazeUrl) extraSelect.push('NULLIF(TRIM(p.waze_url), \'\') AS wazeUrl');
  if (hasGoogleMapsUrl) extraSelect.push('NULLIF(TRIM(p.google_maps_url), \'\') AS googleMapsUrl');
  if (hasLatitudeCol) extraSelect.push('p.latitude AS latitude');
  if (hasLongitudeCol) extraSelect.push('p.longitude AS longitude');
  if (hasOperatorCleaningLine) extraSelect.push('NULLIF(TRIM(p.operator_cleaning_pricing_line), \'\') AS operatorCleaningPricingLine');
  if (hasOperatorCleaningPrice) extraSelect.push('p.operator_cleaning_price_myr AS operatorCleaningPriceMyr');
  if (hasOperatorCleaningService) extraSelect.push('NULLIF(TRIM(p.operator_cleaning_pricing_service), \'\') AS operatorCleaningPricingService');
  if (hasOperatorCleaningRowsJson) extraSelect.push('p.operator_cleaning_pricing_rows_json AS operatorCleaningPricingRowsJson');
  if (hasOpGroupSchema && hasOpCol) {
    extraSelect.push(`(
      SELECT NULLIF(TRIM(og.name), '')
      FROM cln_operator_property_group_property ogp
      INNER JOIN cln_operator_property_group og ON og.id = ogp.group_id AND og.operator_id = p.operator_id
      WHERE ogp.property_id = p.id
      LIMIT 1
    ) AS operatorPropertyGroupName`);
  } else {
    extraSelect.push('NULL AS operatorPropertyGroupName');
  }
  if (hasBedCountList) extraSelect.push('p.bed_count AS bedCount');
  else extraSelect.push('NULL AS bedCount');
  if (hasRoomCountList) extraSelect.push('p.room_count AS roomCount');
  else extraSelect.push('NULL AS roomCount');
  if (hasBathroomCountList) extraSelect.push('p.bathroom_count AS bathroomCount');
  else extraSelect.push('NULL AS bathroomCount');
  if (hasKitchenList) extraSelect.push('p.kitchen AS kitchen');
  else extraSelect.push('NULL AS kitchen');
  if (hasLivingRoomList) extraSelect.push('p.living_room AS livingRoom');
  else extraSelect.push('NULL AS livingRoom');
  if (hasBalconyList) extraSelect.push('p.balcony AS balcony');
  else extraSelect.push('NULL AS balcony');
  if (hasStaircaseList) extraSelect.push('p.staircase AS staircase');
  else extraSelect.push('NULL AS staircase');
  if (hasLiftLevelList) extraSelect.push('NULLIF(TRIM(p.lift_level), \'\') AS liftLevel');
  else extraSelect.push('NULL AS liftLevel');
  if (hasSpecialAreaCountList) extraSelect.push('p.special_area_count AS specialAreaCount');
  else extraSelect.push('NULL AS specialAreaCount');
  if (hasMinValueList) extraSelect.push('p.min_value AS minValue');
  else extraSelect.push('NULL AS minValue');
  const extraSql = extraSelect.length ? `,\n      ${extraSelect.join(',\n      ')}` : '';
  const [rows] = await pool.query(
    `SELECT
      p.id,
      ${
        hasOpCol
          ? hasClientIdCol
            ? 'COALESCE(NULLIF(TRIM(p.operator_id), \'\'), NULLIF(TRIM(p.client_id), \'\'), \'\')'
            : 'COALESCE(NULLIF(TRIM(p.operator_id), \'\'), \'\')'
          : hasClientIdCol
            ? 'COALESCE(NULLIF(TRIM(p.client_id), \'\'), \'\')'
            : 'NULL'
      } AS operatorId,
      COALESCE(p.property_name, '') AS name,
      COALESCE(p.address, '') AS address,
      COALESCE(p.unit_name, '') AS unitNumber,
      ${
        hasClientdetailCol
          ? hasClientIdCol
            ? `COALESCE(
      NULLIF(TRIM(p.client_label), ''),
      NULLIF(TRIM(cd.fullname), ''),
      NULLIF(TRIM(cd.email), ''),
      NULLIF(TRIM(c.name), ''),
      NULLIF(TRIM(cd.id), ''),
      ''
    )`
            : `COALESCE(
      NULLIF(TRIM(p.client_label), ''),
      NULLIF(TRIM(cd.fullname), ''),
      NULLIF(TRIM(cd.email), ''),
      NULLIF(TRIM(cd.id), ''),
      ''
    )`
          : hasClientIdCol
            ? `COALESCE(
      NULLIF(TRIM(p.client_label), ''),
      NULLIF(TRIM(c.name), ''),
      ''
    )`
            : `COALESCE(NULLIF(TRIM(p.client_label), ''), '')`
      } AS client,
      COALESCE(p.team, '') AS team,
      p.created_at,
      p.updated_at,
      p.cleaning_fees AS cleaningFees,
      p.warmcleaning AS warmCleaning,
      p.deepcleaning AS deepCleaning,
      p.generalcleaning AS generalCleaning,
      p.renovationcleaning AS renovationCleaning
      ${extraSql}
     FROM cln_property p
     ${hasClientIdCol ? `LEFT JOIN \`${ct}\` c ON c.id = p.client_id` : ''}
     ${hasClientdetailCol ? 'LEFT JOIN cln_clientdetail cd ON cd.id = p.clientdetail_id' : ''}
     ${scopeWhere}
     ORDER BY p.updated_at DESC, p.created_at DESC
     LIMIT ? OFFSET ?`,
    [...scopeParams, lim, off]
  );
  return (rows || []).map((row) => {
    const operatorCleaningPricingRows = mergeClnLegacyWixCleaningPricesIntoPricingRows(
      parseOperatorCleaningPricingRowsFromDb({
        jsonRaw: hasOperatorCleaningRowsJson ? row.operatorCleaningPricingRowsJson : null,
        operatorCleaningPricingService: row.operatorCleaningPricingService,
        operatorCleaningPricingLine: row.operatorCleaningPricingLine,
        operatorCleaningPriceMyr: row.operatorCleaningPriceMyr,
        cleaningFeesMyr: row.cleaningFees,
      }),
      {
        warmCleaning: row.warmCleaning,
        deepCleaning: row.deepCleaning,
        generalCleaning: row.generalCleaning,
        renovationCleaning: row.renovationCleaning,
        cleaningFees: row.cleaningFees,
      }
    );
    /** Match operator form: whole minutes as digits (not `2h 30m`). */
    const estimatedTime =
      hasMinValueList && row.minValue != null && String(row.minValue).trim() !== ''
        ? String(Math.max(0, Math.floor(Number(row.minValue))))
        : '';
    return { ...row, operatorCleaningPricingRows, estimatedTime };
  });
}

/**
 * Coliving propertydetail / roomdetail smartdoor_id → lockdetail (read-only), same shape as client portal detail.
 */
async function loadColivingSmartdoorBindingsForDetail(colivingPdId, colivingRoomId) {
  const pd = String(colivingPdId || '').trim();
  let smartdoorBindings = { property: null, rooms: [] };
  if (!pd) return smartdoorBindings;
  const rid = String(colivingRoomId || '').trim();
  try {
    const [[pdJoin]] = await pool.query(
      `SELECT pd.smartdoor_id AS psd,
              COALESCE(NULLIF(TRIM(l.lockalias), ''), NULLIF(TRIM(l.lockname), ''), CAST(l.id AS CHAR)) AS plbl
         FROM propertydetail pd
         LEFT JOIN lockdetail l ON l.id = pd.smartdoor_id
        WHERE pd.id = ?
        LIMIT 1`,
      [pd]
    );
    let propBinding = null;
    if (pdJoin?.psd != null && String(pdJoin.psd).trim() !== '') {
      const psid = String(pdJoin.psd).trim();
      propBinding = {
        lockdetailId: psid,
        displayLabel: String(pdJoin.plbl || psid).trim() || psid,
      };
    }
    let rowRoomBinding = null;
    if (rid) {
      const [[rrJoin]] = await pool.query(
        `SELECT r.smartdoor_id AS rsd,
                COALESCE(NULLIF(TRIM(l2.lockalias), ''), NULLIF(TRIM(l2.lockname), ''), CAST(l2.id AS CHAR)) AS rlbl
           FROM roomdetail r
           LEFT JOIN lockdetail l2 ON l2.id = r.smartdoor_id
          WHERE r.id = ? AND r.property_id = ?
          LIMIT 1`,
        [rid, pd]
      );
      if (rrJoin?.rsd != null && String(rrJoin.rsd).trim() !== '') {
        const rsid = String(rrJoin.rsd).trim();
        rowRoomBinding = {
          lockdetailId: rsid,
          displayLabel: String(rrJoin.rlbl || rsid).trim() || rsid,
        };
      }
    }
    smartdoorBindings.property = rowRoomBinding || propBinding;
    const [rrows] = await pool.query(
      `SELECT r.id AS rid,
              COALESCE(NULLIF(TRIM(r.title_fld), ''), NULLIF(TRIM(r.roomname), ''), CAST(r.id AS CHAR)) AS room_lbl,
              r.smartdoor_id AS sid,
              COALESCE(NULLIF(TRIM(l3.lockalias), ''), NULLIF(TRIM(l3.lockname), ''), CAST(l3.id AS CHAR)) AS lock_lbl
         FROM roomdetail r
         LEFT JOIN lockdetail l3 ON l3.id = r.smartdoor_id
        WHERE r.property_id = ?
          AND r.smartdoor_id IS NOT NULL
          AND NULLIF(TRIM(r.smartdoor_id), '') IS NOT NULL`,
      [pd]
    );
    smartdoorBindings.rooms = (rrows || []).map((rr) => ({
      roomId: String(rr.rid),
      roomDisplayLabel: String(rr.room_lbl || rr.rid),
      lockdetailId: String(rr.sid).trim(),
      lockDisplayLabel: String(rr.lock_lbl || rr.sid).trim(),
    }));
  } catch (e) {
    const isUnknown = e.code === 'ER_BAD_FIELD_ERROR' || e.errno === 1054;
    if (!isUnknown) console.error('[cleanlemon] loadColivingSmartdoorBindingsForDetail', e?.message || e);
    smartdoorBindings = { property: null, rooms: [] };
  }
  return smartdoorBindings;
}

/**
 * Operator portal — Coliving security credentials + link id for edit dialog (GET).
 * Verifies `cln_property.operator_id` matches `operatorId`.
 */
async function getOperatorPropertyDetail({ propertyId, operatorId } = {}) {
  const pid = String(propertyId || '').trim();
  const oid = String(operatorId || '').trim();
  if (!pid || !oid) {
    const e = new Error('MISSING_IDS');
    e.code = 'MISSING_IDS';
    throw e;
  }
  const hasOpCol = await databaseHasColumn('cln_property', 'operator_id');
  if (!hasOpCol) {
    const e = new Error('UNSUPPORTED');
    e.code = 'UNSUPPORTED';
    throw e;
  }
  const hasColivingPd = await databaseHasColumn('cln_property', 'coliving_propertydetail_id');
  const hasClientdetailCol = await databaseHasColumn('cln_property', 'clientdetail_id');
  const hasSmartdoorId = await databaseHasColumn('cln_property', 'smartdoor_id');
  const hasMailbox = await databaseHasColumn('cln_property', 'mailbox_password');
  const hasSdp = await databaseHasColumn('cln_property', 'smartdoor_password');
  const hasMode = await databaseHasColumn('cln_property', 'operator_door_access_mode');
  const hasColivingRd = await databaseHasColumn('cln_property', 'coliving_roomdetail_id');
  const hasCleaningLine = await databaseHasColumn('cln_property', 'operator_cleaning_pricing_line');
  const hasCleaningPrice = await databaseHasColumn('cln_property', 'operator_cleaning_price_myr');
  const hasCleaningService = await databaseHasColumn('cln_property', 'operator_cleaning_pricing_service');
  const hasCleaningRowsJson = await databaseHasColumn('cln_property', 'operator_cleaning_pricing_rows_json');
  const [
    hasBedCountD,
    hasRoomCountD,
    hasBathroomCountD,
    hasKitchenD,
    hasLivingRoomD,
    hasBalconyD,
    hasStaircaseD,
    hasLiftLevelD,
    hasSpecialAreaCountD,
    hasMinValueD,
    hasCleaningFeesD,
    hasWarmcleaningD,
    hasDeepcleaningD,
    hasGeneralcleaningD,
    hasRenovationcleaningD,
  ] = await Promise.all([
    databaseHasColumn('cln_property', 'bed_count'),
    databaseHasColumn('cln_property', 'room_count'),
    databaseHasColumn('cln_property', 'bathroom_count'),
    databaseHasColumn('cln_property', 'kitchen'),
    databaseHasColumn('cln_property', 'living_room'),
    databaseHasColumn('cln_property', 'balcony'),
    databaseHasColumn('cln_property', 'staircase'),
    databaseHasColumn('cln_property', 'lift_level'),
    databaseHasColumn('cln_property', 'special_area_count'),
    databaseHasColumn('cln_property', 'min_value'),
    databaseHasColumn('cln_property', 'cleaning_fees'),
    databaseHasColumn('cln_property', 'warmcleaning'),
    databaseHasColumn('cln_property', 'deepcleaning'),
    databaseHasColumn('cln_property', 'generalcleaning'),
    databaseHasColumn('cln_property', 'renovationcleaning'),
  ]);
  let sel = `SELECT p.id,
            p.operator_id,
            COALESCE(p.client_portal_owned, 0) AS client_portal_owned
            ${hasColivingPd ? ', p.coliving_propertydetail_id AS colivingPropertydetailId' : ', NULL AS colivingPropertydetailId'}`;
  if (hasClientdetailCol) sel += ', p.clientdetail_id AS clientdetail_id';
  else sel += ', NULL AS clientdetail_id';
  if (hasSmartdoorId) sel += ', p.smartdoor_id AS smartdoor_id';
  else sel += ', NULL AS smartdoor_id';
  if (hasMailbox) sel += ', p.mailbox_password AS mailbox_password';
  else sel += ', NULL AS mailbox_password';
  if (hasSdp) sel += ', p.smartdoor_password AS smartdoor_password';
  else sel += ', NULL AS smartdoor_password';
  if (hasMode) sel += ', p.operator_door_access_mode AS operator_door_access_mode';
  else sel += ', NULL AS operator_door_access_mode';
  if (hasColivingRd) sel += ', p.coliving_roomdetail_id AS coliving_roomdetail_id';
  else sel += ', NULL AS coliving_roomdetail_id';
  if (hasCleaningLine) sel += ', p.operator_cleaning_pricing_line AS operator_cleaning_pricing_line';
  else sel += ', NULL AS operator_cleaning_pricing_line';
  if (hasCleaningPrice) sel += ', p.operator_cleaning_price_myr AS operator_cleaning_price_myr';
  else sel += ', NULL AS operator_cleaning_price_myr';
  if (hasCleaningService) sel += ', p.operator_cleaning_pricing_service AS operator_cleaning_pricing_service';
  else sel += ', NULL AS operator_cleaning_pricing_service';
  if (hasCleaningRowsJson) sel += ', p.operator_cleaning_pricing_rows_json AS operator_cleaning_pricing_rows_json';
  else sel += ', NULL AS operator_cleaning_pricing_rows_json';
  if (hasBedCountD) sel += ', p.bed_count AS bed_count';
  else sel += ', NULL AS bed_count';
  if (hasRoomCountD) sel += ', p.room_count AS room_count';
  else sel += ', NULL AS room_count';
  if (hasBathroomCountD) sel += ', p.bathroom_count AS bathroom_count';
  else sel += ', NULL AS bathroom_count';
  if (hasKitchenD) sel += ', p.kitchen AS kitchen';
  else sel += ', NULL AS kitchen';
  if (hasLivingRoomD) sel += ', p.living_room AS living_room';
  else sel += ', NULL AS living_room';
  if (hasBalconyD) sel += ', p.balcony AS balcony';
  else sel += ', NULL AS balcony';
  if (hasStaircaseD) sel += ', p.staircase AS staircase';
  else sel += ', NULL AS staircase';
  if (hasLiftLevelD) sel += ', NULLIF(TRIM(p.lift_level), \'\') AS lift_level';
  else sel += ', NULL AS lift_level';
  if (hasSpecialAreaCountD) sel += ', p.special_area_count AS special_area_count';
  else sel += ', NULL AS special_area_count';
  if (hasMinValueD) sel += ', p.min_value AS min_value';
  else sel += ', NULL AS min_value';
  if (hasCleaningFeesD) sel += ', p.cleaning_fees AS cleaning_fees';
  else sel += ', NULL AS cleaning_fees';
  if (hasWarmcleaningD) sel += ', p.warmcleaning AS warmCleaning';
  else sel += ', NULL AS warmCleaning';
  if (hasDeepcleaningD) sel += ', p.deepcleaning AS deepCleaning';
  else sel += ', NULL AS deepCleaning';
  if (hasGeneralcleaningD) sel += ', p.generalcleaning AS generalCleaning';
  else sel += ', NULL AS generalCleaning';
  if (hasRenovationcleaningD) sel += ', p.renovationcleaning AS renovationCleaning';
  else sel += ', NULL AS renovationCleaning';
  sel += ' FROM cln_property p WHERE p.id = ? LIMIT 1';
  const [[row]] = await pool.query(sel, [pid]);
  if (!row) {
    const e = new Error('NOT_FOUND');
    e.code = 'NOT_FOUND';
    throw e;
  }
  const curOp = row.operator_id != null ? String(row.operator_id).trim() : '';
  if (!curOp || curOp !== oid) {
    const e = new Error('OPERATOR_MISMATCH');
    e.code = 'OPERATOR_MISMATCH';
    throw e;
  }
  let colivingPdId = '';
  if (hasColivingPd && row.colivingPropertydetailId != null && String(row.colivingPropertydetailId).trim() !== '') {
    colivingPdId = String(row.colivingPropertydetailId).trim();
  }
  let securitySystemCredentials = null;
  if (colivingPdId && (await databaseHasColumn('propertydetail', 'security_system_credentials_json'))) {
    try {
      const [[credRow]] = await pool.query(
        'SELECT security_system_credentials_json AS j FROM propertydetail WHERE id = ? LIMIT 1',
        [colivingPdId]
      );
      if (credRow?.j != null && String(credRow.j).trim() !== '') {
        try {
          securitySystemCredentials =
            typeof credRow.j === 'string' ? JSON.parse(credRow.j) : credRow.j;
        } catch (_) {
          securitySystemCredentials = null;
        }
      }
    } catch (_) {
      /* optional */
    }
  }
  let smartdoorGatewayReady = false;
  try {
    smartdoorGatewayReady = await clnPropertyHasRemoteGatewayReady(pid);
  } catch (_) {
    smartdoorGatewayReady = false;
  }
  const ymdToday = getTodayMalaysiaDate();
  let hasBookingToday = false;
  try {
    const [[hb]] = await pool.query(
      `SELECT 1 AS ok FROM cln_schedule
       WHERE property_id = ?
         AND working_day IS NOT NULL
         AND (${SQL_CLN_SCHEDULE_WORKING_DAY_KL_YMD_BARE}) = ?
       LIMIT 1`,
      [pid, ymdToday]
    );
    hasBookingToday = !!hb?.ok;
  } catch (_) {
    hasBookingToday = false;
  }

  const colivingRoomId =
    hasColivingRd && row.coliving_roomdetail_id != null && String(row.coliving_roomdetail_id).trim() !== ''
      ? String(row.coliving_roomdetail_id).trim()
      : '';
  const smartdoorBindings = await loadColivingSmartdoorBindingsForDetail(colivingPdId, colivingRoomId);

  let nativeLockBindings = [];
  try {
    const clnPl = require('./cleanlemon-property-lock.service');
    nativeLockBindings = await clnPl.listNativeLocksForClnProperty(pid);
  } catch (_) {
    nativeLockBindings = [];
  }
  const smartdoorBindManualAllowed = !colivingPdId;

  const parsedCleaningRows = parseOperatorCleaningPricingRowsFromDb({
    jsonRaw: hasCleaningRowsJson ? row.operator_cleaning_pricing_rows_json : null,
    operatorCleaningPricingService: hasCleaningService ? row.operator_cleaning_pricing_service : '',
    operatorCleaningPricingLine: hasCleaningLine ? row.operator_cleaning_pricing_line : '',
    operatorCleaningPriceMyr: hasCleaningPrice ? row.operator_cleaning_price_myr : null,
    cleaningFeesMyr: hasCleaningFeesD ? row.cleaning_fees : null,
  });
  const operatorCleaningPricingRows = mergeClnLegacyWixCleaningPricesIntoPricingRows(parsedCleaningRows, {
    warmCleaning: hasWarmcleaningD ? row.warmCleaning : undefined,
    deepCleaning: hasDeepcleaningD ? row.deepCleaning : undefined,
    generalCleaning: hasGeneralcleaningD ? row.generalCleaning : undefined,
    renovationCleaning: hasRenovationcleaningD ? row.renovationCleaning : undefined,
    cleaningFees: hasCleaningFeesD ? row.cleaning_fees : undefined,
  });
  const firstMerged = operatorCleaningPricingRows[0];

  return {
    id: String(row.id),
    clientPortalOwned: Number(row.client_portal_owned) === 1,
    colivingPropertydetailId: colivingPdId || '',
    nativeLockBindings,
    smartdoorBindManualAllowed,
    securitySystemCredentials,
    smartdoorId: row.smartdoor_id != null ? String(row.smartdoor_id).trim() : '',
    mailboxPassword: row.mailbox_password != null ? String(row.mailbox_password) : '',
    smartdoorPassword: row.smartdoor_password != null ? String(row.smartdoor_password) : '',
    operatorDoorAccessMode:
      row.operator_door_access_mode != null && String(row.operator_door_access_mode).trim() !== ''
        ? String(row.operator_door_access_mode).trim()
        : 'temporary_password_only',
    smartdoorGatewayReady,
    hasBookingToday,
    smartdoorBindings,
    operatorCleaningPricingLine:
      firstMerged && String(firstMerged.line || '').trim() !== ''
        ? String(firstMerged.line).trim()
        : hasCleaningLine && row.operator_cleaning_pricing_line != null
          ? String(row.operator_cleaning_pricing_line).trim()
          : '',
    operatorCleaningPriceMyr:
      firstMerged &&
      firstMerged.myr != null &&
      Number.isFinite(Number(firstMerged.myr)) &&
      Number(firstMerged.myr) >= 0
        ? Number(firstMerged.myr)
        : hasCleaningPrice &&
            row.operator_cleaning_price_myr != null &&
            Number.isFinite(Number(row.operator_cleaning_price_myr)) &&
            Number(row.operator_cleaning_price_myr) >= 0
          ? Number(row.operator_cleaning_price_myr)
          : null,
    operatorCleaningPricingService:
      firstMerged && String(firstMerged.service || '').trim() !== ''
        ? String(firstMerged.service).trim()
        : hasCleaningService && row.operator_cleaning_pricing_service != null
          ? String(row.operator_cleaning_pricing_service).trim()
          : '',
    operatorCleaningPricingRows,
    /** Digits only — same as list API / operator “Estimate time” field (minutes). */
    estimatedTime:
      hasMinValueD && row.min_value != null && String(row.min_value).trim() !== ''
        ? String(Math.max(0, Math.floor(Number(row.min_value))))
        : '',
    /** Whole minutes for operator portal form (same as `cln_property.min_value`). */
    minValue:
      hasMinValueD && row.min_value != null && String(row.min_value).trim() !== ''
        ? Math.max(0, Math.floor(Number(row.min_value)))
        : null,
    bedCount: hasBedCountD && row.bed_count != null ? Number(row.bed_count) : null,
    roomCount: hasRoomCountD && row.room_count != null ? Number(row.room_count) : null,
    bathroomCount: hasBathroomCountD && row.bathroom_count != null ? Number(row.bathroom_count) : null,
    kitchen: hasKitchenD && row.kitchen != null ? Number(row.kitchen) : null,
    livingRoom: hasLivingRoomD && row.living_room != null ? Number(row.living_room) : null,
    balcony: hasBalconyD && row.balcony != null ? Number(row.balcony) : null,
    staircase: hasStaircaseD && row.staircase != null ? Number(row.staircase) : null,
    liftLevel:
      hasLiftLevelD && row.lift_level != null && String(row.lift_level).trim() !== ''
        ? String(row.lift_level).trim()
        : '',
    specialAreaCount: hasSpecialAreaCountD && row.special_area_count != null ? Number(row.special_area_count) : null,
  };
}

/** Distinct non-empty `property_name` for operator (building / condo names for apartment flow). */
async function listOperatorDistinctPropertyNames({ operatorId } = {}) {
  const oid = String(operatorId || '').trim();
  const hasOpCol = await databaseHasColumn('cln_property', 'operator_id');
  const hasClientIdCol = await databaseHasColumn('cln_property', 'client_id');
  let where = 'WHERE NULLIF(TRIM(p.property_name), \'\') IS NOT NULL';
  const params = [];
  if (oid && hasOpCol) {
    where = 'WHERE p.operator_id = ? AND NULLIF(TRIM(p.property_name), \'\') IS NOT NULL';
    params.push(oid);
  } else if (oid && hasClientIdCol) {
    where = 'WHERE p.client_id = ? AND NULLIF(TRIM(p.property_name), \'\') IS NOT NULL';
    params.push(oid);
  } else if (oid) {
    where = 'WHERE 1=0';
  }
  const [rows] = await pool.query(
    `SELECT DISTINCT TRIM(p.property_name) AS name
     FROM cln_property p
     ${where}
     ORDER BY name`,
    params
  );
  return rows.map((r) => String(r.name || '').trim()).filter(Boolean);
}

/** Distinct `property_name` for building search; when `operatorId` set, only that operator's rows. */
async function listGlobalDistinctPropertyNames({ q = '', limit = 50, operatorId = '' } = {}) {
  const term = String(q || '').trim();
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const oid = String(operatorId || '').trim();
  const hasOpCol = await databaseHasColumn('cln_property', 'operator_id');
  const params = [];
  let where = 'WHERE NULLIF(TRIM(p.property_name), \'\') IS NOT NULL';
  if (oid && hasOpCol) {
    where += ' AND p.operator_id = ?';
    params.push(oid);
  } else if (oid && !hasOpCol) {
    where += ' AND 1=0';
  }
  if (term) {
    where += ' AND TRIM(p.property_name) LIKE ?';
    params.push(`%${term}%`);
  }
  params.push(lim);
  const [rows] = await pool.query(
    `SELECT DISTINCT TRIM(p.property_name) AS name
     FROM cln_property p
     ${where}
     ORDER BY name ASC
     LIMIT ?`,
    params
  );
  return rows.map((r) => String(r.name || '').trim()).filter(Boolean);
}

/**
 * Most common address + Waze + Google Maps for this `property_name` (all operators).
 * Normalizes legacy `address` blobs (strip embedded URLs) so "SPACE RESIDENCY" rows vote on the same prose.
 * Picks the plurality normalized address, then plurality Waze / Google among rows in that bucket
 * (dedicated columns override parsed URLs from text).
 */
async function getGlobalPropertyNameDefaults({ propertyName, operatorId = '' } = {}) {
  const name = String(propertyName || '').trim();
  if (!name) return { address: '', wazeUrl: '', googleMapsUrl: '' };

  const hasW = await databaseHasColumn('cln_property', 'waze_url');
  const hasG = await databaseHasColumn('cln_property', 'google_maps_url');
  const hasOpCol = await databaseHasColumn('cln_property', 'operator_id');
  const oid = String(operatorId || '').trim();
  const sel = ['TRIM(p.address) AS address'];
  if (hasW) sel.push('TRIM(p.waze_url) AS waze_url');
  else sel.push('NULL AS waze_url');
  if (hasG) sel.push('TRIM(p.google_maps_url) AS google_maps_url');
  else sel.push('NULL AS google_maps_url');

  let rows = [];
  try {
    const opClause = oid && hasOpCol ? ' AND p.operator_id = ? ' : oid && !hasOpCol ? ' AND 1=0 ' : '';
    const params = oid && hasOpCol ? [name, oid] : [name];
    const [r] = await pool.query(
      `SELECT ${sel.join(', ')}
       FROM cln_property p
       WHERE LOWER(TRIM(p.property_name)) = LOWER(TRIM(?))${opClause}`,
      params
    );
    rows = Array.isArray(r) ? r : [];
  } catch (_) {
    return { address: '', wazeUrl: '', googleMapsUrl: '' };
  }

  if (rows.length === 0) return { address: '', wazeUrl: '', googleMapsUrl: '' };

  const enriched = rows.map((row) => {
    const rawAddr = String(row.address ?? '');
    const sw = splitAddressWazeGoogleFromText(rawAddr);
    const wazeCol = String(row.waze_url ?? '').trim();
    const gCol = String(row.google_maps_url ?? '').trim();
    const waze = wazeCol || sw.wazeUrl || '';
    const google = gCol || sw.googleUrl || '';
    const addrNorm = (sw.address || '').trim() || rawAddr.trim();
    return { addrNorm, waze, google };
  });

  const addrStats = new Map();
  for (const e of enriched) {
    const a = String(e.addrNorm || '').trim();
    if (!a) continue;
    const low = a.toLowerCase();
    const cur = addrStats.get(low);
    if (!cur) addrStats.set(low, { count: 1, example: a });
    else cur.count += 1;
  }

  let bestLow = '';
  let bestN = -1;
  for (const [low, st] of addrStats) {
    if (st.count > bestN || (st.count === bestN && low.localeCompare(bestLow) < 0)) {
      bestN = st.count;
      bestLow = low;
    }
  }

  const subset =
    bestLow !== '' ? enriched.filter((e) => String(e.addrNorm || '').trim().toLowerCase() === bestLow) : enriched;

  function pickMode(strings) {
    const m = new Map();
    for (const s of strings) {
      const t = String(s || '').trim();
      if (!t) continue;
      m.set(t, (m.get(t) || 0) + 1);
    }
    let best = '';
    let bc = 0;
    for (const [k, c] of m) {
      if (c > bc || (c === bc && k.localeCompare(best) < 0)) {
        bc = c;
        best = k;
      }
    }
    return best;
  }

  const wazeUrl = pickMode(subset.map((e) => e.waze));
  const googleMapsUrl = pickMode(subset.map((e) => e.google));
  const address = bestLow !== '' && addrStats.has(bestLow) ? addrStats.get(bestLow).example : '';

  return { address, wazeUrl, googleMapsUrl };
}

/** Nominatim `q`: trim, collapse spaces, lowercase — OSM matching is effectively case-insensitive; we normalize so CiTyWoOdS and citywoods behave the same. */
function normalizeNominatimQuery(s) {
  return String(s || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** Drop duplicate OSM rows that match on coords + lowercased display name (avoids near-duplicate labels differing only by case). */
function dedupeAddressPlaceRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return rows || [];
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const dn = String(row.displayName || '')
      .trim()
      .toLowerCase();
    const key = `${String(row.lat || '').trim()}|${String(row.lon || '').trim()}|${dn}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

/**
 * Fuzzy query variants for Nominatim: OSM often lists "Paragon Suites" while users type "Paragon Suite".
 * Tries plural/singular and a light locality suffix before giving up.
 */
function expandAddressSearchQueryVariants(q) {
  const base = String(q || '').trim();
  if (!base) return [];
  const out = [];
  const seen = new Set();
  function push(s) {
    const t = String(s || '').trim();
    if (t.length < 2) return;
    const k = normalizeNominatimQuery(t);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(t);
  }
  push(base);
  const b = base;
  if (/\bSuite\b/i.test(b) && !/\bSuites\b/i.test(b)) {
    push(b.replace(/\bSuite\b/gi, 'Suites'));
  }
  if (/\bSuites\b/i.test(b)) {
    push(b.replace(/\bSuites\b/gi, 'Suite'));
  }
  if (/\bTower\b/i.test(b) && !/\bTowers\b/i.test(b)) {
    push(b.replace(/\bTower\b/gi, 'Towers'));
  }
  if (/\bTowers\b/i.test(b)) {
    push(b.replace(/\bTowers\b/gi, 'Tower'));
  }
  if (
    base.length <= 48 &&
    !/malaysia|kuala|johor|penang|selangor|melaka|ipoh|kuching|sabah|sarawak|labuan/i.test(base)
  ) {
    push(`${base}, Malaysia`);
  }
  return out;
}

/** Common OSM spelling vs user input (Google tolerates apostrophe / letter swaps). */
function pushDesplanadeTypoSeeds(push, raw) {
  const b = String(raw || '').trim();
  if (!b || /'/.test(b)) return;
  if (/desplnade/i.test(b)) push(b.replace(/desplnade/gi, "d'esplanade"));
  if (/desplanade/i.test(b)) push(b.replace(/desplanade/gi, "d'esplanade"));
  if (/desplande/i.test(b)) push(b.replace(/desplande/gi, "d'esplanade"));
  if (/\bd\s+esplanade\b/i.test(b)) push(b.replace(/\bd\s+esplanade\b/gi, "d'esplanade"));
}

/** Short tokens (e.g. "ksl") rarely hit in OSM without a city; bias to Johor Bahru when country = MY. */
function pushShortQueryMalaysiaSeeds(push, raw, countrycodes) {
  if (String(countrycodes || '').trim().toLowerCase() !== 'my') return;
  const b = String(raw || '').trim();
  if (b.length < 2 || b.length > 42) return;
  if (/johor|jb\b|malaysia|singapore|kuala|penang|selangor|melaka|negeri|sabah|sarawak|labuan/i.test(b)) return;
  const compact = b.replace(/\s+/g, '');
  if (/\bksl\b/i.test(b) || compact.length <= 5) {
    push(`${b} Johor Bahru`);
    push(`${b}, Johor Bahru, Malaysia`);
  }
}

/**
 * Ordered unique search strings: user text, property name, combined, typo seeds, then expandAddressSearchQueryVariants each.
 */
function collectAddressSearchQueries(q, propertyName, countrycodes) {
  const seeds = [];
  const seenSeed = new Set();
  function pushSeed(s) {
    const t = String(s || '').trim();
    if (t.length < 2) return;
    const k = normalizeNominatimQuery(t);
    if (seenSeed.has(k)) return;
    seenSeed.add(k);
    seeds.push(t);
  }
  const q0 = String(q || '').trim();
  const pn0 = String(propertyName || '').trim();
  pushSeed(q0);
  pushDesplanadeTypoSeeds(pushSeed, q0);
  pushShortQueryMalaysiaSeeds(pushSeed, q0, countrycodes);
  if (pn0 && normalizeNominatimQuery(pn0) !== normalizeNominatimQuery(q0)) {
    pushSeed(pn0);
    pushDesplanadeTypoSeeds(pushSeed, pn0);
    pushShortQueryMalaysiaSeeds(pushSeed, pn0, countrycodes);
  }
  if (pn0 && q0) {
    pushSeed(`${pn0} ${q0}`.trim());
    pushSeed(`${q0} ${pn0}`.trim());
    pushDesplanadeTypoSeeds(pushSeed, `${pn0} ${q0}`.trim());
  }
  const ordered = [];
  const seenQ = new Set();
  for (const seed of seeds) {
    for (const v of expandAddressSearchQueryVariants(seed)) {
      const k = normalizeNominatimQuery(v);
      if (k.length < 2 || seenQ.has(k)) continue;
      seenQ.add(k);
      ordered.push(v);
    }
  }
  return ordered;
}

function isPhotonFeatureMalaysia(f) {
  const p = f?.properties || {};
  if (String(p.countrycode || '').trim().toUpperCase() === 'MY') return true;
  if (/malaysia/i.test(String(p.country || ''))) return true;
  const coords = f?.geometry?.coordinates;
  if (Array.isArray(coords) && coords.length >= 2) {
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    if (Number.isFinite(lon) && Number.isFinite(lat) && lon >= 99.5 && lon <= 119.6 && lat >= 0.5 && lat <= 7.6) {
      return true;
    }
  }
  return false;
}

/** Photon (OSM-based, different indexer) — used when Nominatim returns nothing. */
async function fetchPhotonPlaces(queryStr, limit, bbox) {
  const q = String(queryStr || '').trim();
  if (normalizeNominatimQuery(q).length < 2) return [];
  const lim = Math.min(Math.max(Number(limit) || 8, 1), 15);
  async function runPhoton(useBbox) {
    const params = { q, limit: lim, lang: 'en' };
    if (useBbox && bbox) params.bbox = bbox;
    const { data } = await axios.get('https://photon.komoot.io/api', {
      params,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'CleanlemonsPortal/1.0 (https://portal.cleanlemons.com)',
      },
      timeout: 12000,
      validateStatus: (s) => s >= 200 && s < 300,
    });
    return Array.isArray(data?.features) ? data.features : [];
  }
  try {
    let features = await runPhoton(true);
    if (bbox && features.length === 0) {
      const wide = await runPhoton(false);
      features = wide.filter(isPhotonFeatureMalaysia);
    }
    return features
      .map((f) => {
        const coords = f.geometry?.coordinates;
        const lon = Array.isArray(coords) ? coords[0] : null;
        const lat = Array.isArray(coords) ? coords[1] : null;
        const p = f.properties || {};
        const streetLine =
          p.housenumber && p.street ? `${p.housenumber} ${p.street}` : p.street ? String(p.street) : '';
        const parts = [p.name, streetLine, p.district, p.city, p.state, p.country]
          .map((x) => (x != null ? String(x).trim() : ''))
          .filter(Boolean);
        const displayName = parts.length ? parts.join(', ') : '';
        const osmId = p.osm_id != null ? String(p.osm_id) : '';
        const osmT = p.osm_type != null ? String(p.osm_type) : '';
        const placeId = osmId ? `photon:${osmT}:${osmId}` : `photon:${lat},${lon}`;
        return {
          displayName,
          lat: lat != null && Number.isFinite(Number(lat)) ? String(lat) : '',
          lon: lon != null && Number.isFinite(Number(lon)) ? String(lon) : '',
          placeId,
        };
      })
      .filter((x) => x.displayName && x.lat && x.lon);
  } catch (e) {
    console.warn('[cleanlemon] fetchPhotonPlaces', e?.message || e);
    return [];
  }
}

/** Nominatim first, then Photon fallback (both OSM; improves hits vs Nominatim-only). */
async function searchAddressPlaces({ q, limit = 8, countrycodes = 'my', propertyName = '' } = {}) {
  const termNorm = normalizeNominatimQuery(q);
  if (termNorm.length < 2) return [];
  const lim = Math.min(Math.max(Number(limit) || 8, 1), 10);
  const cc = String(countrycodes || '').trim().toLowerCase();
  const pnRaw = String(propertyName || '').trim();
  const queries = collectAddressSearchQueries(q, pnRaw, cc);
  const photonBbox = cc === 'my' || cc === '' ? '99.5,0.5,119.6,7.6' : '';

  async function fetchNominatim(queryStr) {
    const qs = normalizeNominatimQuery(queryStr);
    if (qs.length < 2) return [];
    try {
      const params = {
        q: queryStr.trim(),
        format: 'json',
        limit: lim,
        addressdetails: 1,
      };
      if (cc) params.countrycodes = cc;
      const { data } = await axios.get('https://nominatim.openstreetmap.org/search', {
        params,
        headers: {
          'User-Agent': 'CleanlemonsPortal/1.0 (https://portal.cleanlemons.com)',
          Accept: 'application/json',
        },
        timeout: 10000,
        validateStatus: (s) => s >= 200 && s < 300,
      });
      if (!Array.isArray(data)) return [];
      return data
        .map((r) => ({
          displayName: String(r.display_name || ''),
          lat: r.lat != null ? String(r.lat) : '',
          lon: r.lon != null ? String(r.lon) : '',
          placeId: r.place_id != null ? String(r.place_id) : '',
        }))
        .filter((x) => x.displayName);
    } catch (e) {
      console.warn('[cleanlemon] searchAddressPlaces nominatim', e?.message || e);
      return [];
    }
  }

  for (const queryStr of queries) {
    const out = dedupeAddressPlaceRows(await fetchNominatim(queryStr));
    if (out.length > 0) return out.slice(0, lim);
  }

  for (const queryStr of queries) {
    const raw = await fetchPhotonPlaces(queryStr, lim, photonBbox || null);
    const out = dedupeAddressPlaceRows(raw);
    if (out.length > 0) return out.slice(0, lim);
  }

  return [];
}

/**
 * B2B client portal — rows Coliving bridge (and manual creates) attach with `clientdetail_id` → cln_clientdetail.
 * Legacy `client_id` points at cln_client (Wix); do not use it for building clients.
 */
/**
 * Coliving `operatordetail.id` values that own this Cleanlemons B2B client:
 * (1) `propertydetail.client_id` via any `cln_property.coliving_propertydetail_id`
 * (2) `client_integration` (saasIntegration / cleanlemons) where `values_json.cleanlemons_clientdetail_id` matches.
 */
async function resolveColivingOperatordetailIdsForCleanlemonsClientdetail(clientdetailId) {
  const cid = String(clientdetailId || '').trim();
  if (!cid) return [];
  const opIds = new Set();
  const hasPdCol = await databaseHasColumn('cln_property', 'coliving_propertydetail_id');
  if (hasPdCol) {
    const [pdRows] = await pool.query(
      `SELECT DISTINCT coliving_propertydetail_id AS pid
         FROM cln_property
        WHERE clientdetail_id = ?
          AND coliving_propertydetail_id IS NOT NULL
          AND TRIM(coliving_propertydetail_id) <> ''
        LIMIT 200`,
      [cid]
    );
    for (const pr of pdRows || []) {
      const pdi = String(pr.pid || '').trim();
      if (!pdi) continue;
      try {
        const [[pd]] = await pool.query('SELECT client_id FROM propertydetail WHERE id = ? LIMIT 1', [pdi]);
        if (pd?.client_id != null && String(pd.client_id).trim() !== '') {
          opIds.add(String(pd.client_id).trim());
        }
      } catch (_) {
        /* propertydetail missing */
      }
    }
  }
  try {
    const [intRows] = await pool.query(
      `SELECT client_id, values_json FROM client_integration
        WHERE \`key\` = 'saasIntegration' AND provider = 'cleanlemons' AND enabled = 1`
    );
    for (const r of intRows || []) {
      let v = r.values_json;
      if (typeof v === 'string') {
        try {
          v = JSON.parse(v || '{}');
        } catch {
          v = {};
        }
      } else v = v || {};
      const clnId =
        v.cleanlemons_clientdetail_id != null ? String(v.cleanlemons_clientdetail_id).trim() : '';
      if (clnId === cid && r.client_id != null && String(r.client_id).trim() !== '') {
        opIds.add(String(r.client_id).trim());
      }
    }
  } catch (e) {
    const msg = String(e?.sqlMessage || e?.message || '');
    if (!/doesn't exist/i.test(msg) && !/Unknown table/i.test(msg)) {
      console.error('[cleanlemon] resolveColivingOperatordetailIds client_integration', e?.message || e);
    }
  }
  return [...opIds];
}

/**
 * Backfill missing per-room `cln_property` rows (same as Coliving link confirm).
 */
async function ensureColivingPropertyTreeSyncedForClientdetail(clientdetailId) {
  const cid = String(clientdetailId || '').trim();
  if (!cid) return;
  const hasPdCol = await databaseHasColumn('cln_property', 'coliving_propertydetail_id');
  if (!hasPdCol) return;
  let syncFn;
  try {
    ({ syncPropertiesToCleanlemons: syncFn } = require('../coliving-cleanlemons/coliving-cleanlemons-link.service'));
  } catch (e) {
    console.error('[cleanlemon] ensureColivingPropertyTree import', e?.message || e);
    return;
  }
  if (typeof syncFn !== 'function') return;
  const opIds = await resolveColivingOperatordetailIdsForCleanlemonsClientdetail(cid);
  for (const opId of opIds) {
    try {
      await syncFn(opId, cid);
    } catch (e) {
      console.error('[cleanlemon] ensureColivingPropertyTree sync', opId, e?.message || e);
    }
  }
}

/**
 * B2B client portal — manual Coliving sync (explicit button); returns row count after upsert.
 */
async function syncClientPortalPropertiesFromColiving({ clientdetailId } = {}) {
  const cid = String(clientdetailId || '').trim();
  if (!cid) return { ok: false, reason: 'MISSING_CLIENTDETAIL_ID' };
  const hasPdCol = await databaseHasColumn('cln_property', 'coliving_propertydetail_id');
  if (!hasPdCol) return { ok: false, reason: 'COLIVING_COLUMNS_UNAVAILABLE' };
  let syncFn;
  try {
    ({ syncPropertiesToCleanlemons: syncFn } = require('../coliving-cleanlemons/coliving-cleanlemons-link.service'));
  } catch (e) {
    return { ok: false, reason: 'SYNC_MODULE_UNAVAILABLE' };
  }
  if (typeof syncFn !== 'function') return { ok: false, reason: 'SYNC_MODULE_UNAVAILABLE' };
  const opIds = await resolveColivingOperatordetailIdsForCleanlemonsClientdetail(cid);
  if (!opIds.length) return { ok: false, reason: 'NO_COLIVING_OPERATOR_LINK' };
  for (const opId of opIds) {
    await syncFn(opId, cid);
  }
  const [[cntRow]] = await pool.query(`SELECT COUNT(*) AS n FROM cln_property WHERE clientdetail_id = ?`, [cid]);
  const itemCount = cntRow != null ? Number(cntRow.n) : 0;
  return { ok: true, syncedOperators: opIds.length, itemCount };
}

async function listClientPortalProperties({ clientdetailId, limit = 500, loginEmail } = {}) {
  const cid = String(clientdetailId || '').trim();
  if (!cid) return [];
  const hasClientdetailCol = await databaseHasColumn('cln_property', 'clientdetail_id');
  if (!hasClientdetailCol) return [];
  await ensureColivingPropertyTreeSyncedForClientdetail(cid);
  if (await clnPropGroup.propertyGroupTablesExist()) {
    await clnPropGroup.activatePendingInvitesForClientPortal(cid, loginEmail);
  }
  const hasOpCol = await databaseHasColumn('cln_property', 'operator_id');
  const hasPremisesType = await databaseHasColumn('cln_property', 'premises_type');
  const ct = hasOpCol ? await getClnCompanyTable() : null;
  const lim = Math.min(Math.max(Number(limit) || 500, 1), 500);
  const hasSyncArch = await databaseHasColumn('cln_property', 'coliving_sync_archived');
  const archWhere = hasSyncArch ? ' AND (p.coliving_sync_archived IS NULL OR p.coliving_sync_archived = 0)' : '';
  const hasOpPortalArchHide = await databaseHasColumn('cln_property', 'operator_portal_archived');
  /** Operator-archived units: hide from client portal until restored. */
  const hideOperatorArchivedWhere = hasOpPortalArchHide ? ' AND COALESCE(p.operator_portal_archived, 0) = 0' : '';
  const hasPortalOwnedList = await databaseHasColumn('cln_property', 'client_portal_owned');
  const portalOwnedSql = hasPortalOwnedList ? ', COALESCE(p.client_portal_owned, 0) AS clientPortalOwnedRaw' : '';
  const ptSql = hasPremisesType ? ', p.premises_type AS premisesTypeRaw' : '';
  const opSelect =
    hasOpCol && ct
      ? `, NULLIF(TRIM(p.operator_id), '') AS operatorIdRaw,
         TRIM(COALESCE(NULLIF(TRIM(op.name), ''), NULLIF(TRIM(op.email), ''), NULLIF(TRIM(p.operator_id), ''), '')) AS operatorNameRaw,
         COALESCE(NULLIF(TRIM(op.email), ''), '') AS operatorEmailRaw`
      : '';
  const joinSql = hasOpCol && ct ? `LEFT JOIN \`${ct}\` op ON op.id = p.operator_id` : '';
  let plrPendingSql = '';
  try {
    const plr = require('./cleanlemon-property-link-request.service');
    await plr.ensurePropertyLinkRequestTable();
    plrPendingSql = `, EXISTS (
      SELECT 1 FROM cln_property_link_request r
      WHERE r.property_id = p.id
        AND r.clientdetail_id = p.clientdetail_id
        AND r.kind = 'client_requests_operator'
        AND r.status = 'pending'
    ) AS clientOperatorLinkPendingRaw`;
  } catch (_) {
    plrPendingSql = ', 0 AS clientOperatorLinkPendingRaw';
  }
  const [rows] = await pool.query(
    `SELECT
      p.id AS id,
      COALESCE(p.property_name, '') AS name,
      COALESCE(p.address, '') AS address,
      COALESCE(p.unit_name, '') AS unitNumber,
      p.created_at AS createdAt,
      p.updated_at AS updatedAt
      ${ptSql}
      ${portalOwnedSql}
      ${opSelect}
      ${plrPendingSql}
     FROM cln_property p
     ${joinSql}
     WHERE p.clientdetail_id = ?${archWhere}${hideOperatorArchivedWhere}
     ORDER BY p.updated_at DESC, p.created_at DESC
     LIMIT ?`,
    [cid, lim]
  );
  const rowMap = new Map();
  for (const r of rows || []) {
    rowMap.set(String(r.id), { ...r, _portalAccess: 'owner' });
  }
  if ((await clnPropGroup.propertyGroupTablesExist()) && rowMap.size < lim) {
    const remaining = lim - rowMap.size;
    if (remaining > 0) {
      const [extraRows] = await pool.query(
        `SELECT
          p.id AS id,
          COALESCE(p.property_name, '') AS name,
          COALESCE(p.address, '') AS address,
          COALESCE(p.unit_name, '') AS unitNumber,
          p.created_at AS createdAt,
          p.updated_at AS updatedAt
          ${ptSql}
          ${portalOwnedSql}
          ${opSelect}
          ${plrPendingSql}
         FROM cln_property p
         ${joinSql}
         INNER JOIN cln_property_group_property gpp ON gpp.property_id = p.id
         INNER JOIN cln_property_group gpg ON gpg.id = gpp.group_id
         INNER JOIN cln_property_group_member m ON m.group_id = gpg.id
           AND m.grantee_clientdetail_id = ?
           AND m.invite_status = 'active'
         WHERE p.clientdetail_id <> ?${archWhere}${hideOperatorArchivedWhere}
         ORDER BY p.updated_at DESC, p.created_at DESC
         LIMIT ?`,
        [cid, cid, remaining]
      );
      for (const r of extraRows || []) {
        const rid = String(r.id);
        if (!rowMap.has(rid)) rowMap.set(rid, { ...r, _portalAccess: 'shared' });
      }
    }
  }
  const merged = Array.from(rowMap.values())
    .sort((a, b) => {
      const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
      const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
      return tb - ta;
    })
    .slice(0, lim);
  const groupNamesByPropertyId = new Map();
  if ((await clnPropGroup.propertyGroupTablesExist()) && merged.length) {
    const ids = merged.map((row) => String(row.id || '').trim()).filter(Boolean);
    if (ids.length) {
      const ph = ids.map(() => '?').join(',');
      const [gRows] = await pool.query(
        `SELECT gpp.property_id AS pid, COALESCE(gpg.name, '') AS gname
         FROM cln_property_group_property gpp
         INNER JOIN cln_property_group gpg ON gpg.id = gpp.group_id
         WHERE gpp.property_id IN (${ph})`,
        ids
      );
      for (const gr of gRows || []) {
        const pid = String(gr.pid || '').trim();
        const nm = String(gr.gname || '').trim();
        if (!pid) continue;
        if (!groupNamesByPropertyId.has(pid)) groupNamesByPropertyId.set(pid, []);
        if (nm) groupNamesByPropertyId.get(pid).push(nm);
      }
    }
  }
  return merged.map((r) => {
    const oid = hasOpCol && r.operatorIdRaw ? String(r.operatorIdRaw).trim() : '';
    const email = hasOpCol && r.operatorEmailRaw != null ? String(r.operatorEmailRaw).trim() : '';
    let operatorName = '—';
    if (hasOpCol) {
      const rawName = r.operatorNameRaw != null ? String(r.operatorNameRaw).trim() : '';
      operatorName = rawName || email || oid || 'Not connected';
    }
    const pending =
      r.clientOperatorLinkPendingRaw === true ||
      r.clientOperatorLinkPendingRaw === 1 ||
      Number(r.clientOperatorLinkPendingRaw) === 1;
    const pid = String(r.id || '');
    const gList = groupNamesByPropertyId.get(pid) || [];
    const groupNames = [...new Set(gList)].sort((a, b) => a.localeCompare(b));
    const portalAccess = r._portalAccess === 'shared' ? 'shared' : 'owner';
    const clientPortalOwned =
      hasPortalOwnedList &&
      (r.clientPortalOwnedRaw === true || r.clientPortalOwnedRaw === 1 || Number(r.clientPortalOwnedRaw) === 1);
    return {
      id: pid,
      name: String(r.name || ''),
      address: String(r.address || ''),
      unitNumber: String(r.unitNumber || ''),
      premisesType: hasPremisesType ? String(r.premisesTypeRaw || '').trim() : '',
      operatorId: oid,
      operatorName,
      operatorEmail: email,
      clientOperatorLinkPending: pending,
      groupNames,
      portalAccess,
      clientPortalOwned: hasPortalOwnedList ? !!clientPortalOwned : true,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  });
}

/** Coliving `propertydetail` mirror: only columns that exist in DB are written. */
const CLIENT_PORTAL_PD_MIRROR_SPECS = [
  { patchKey: 'mailboxPassword', dbCol: 'mailbox_password', kind: 'str' },
  { patchKey: 'securitySystem', dbCol: 'security_system', kind: 'str' },
  { patchKey: 'securityUsername', dbCol: 'security_username', kind: 'str' },
  { patchKey: 'bedCount', dbCol: 'bed_count', kind: 'int' },
  { patchKey: 'roomCount', dbCol: 'room_count', kind: 'int' },
  { patchKey: 'bathroomCount', dbCol: 'bathroom_count', kind: 'int' },
  { patchKey: 'kitchen', dbCol: 'kitchen', kind: 'int' },
  { patchKey: 'livingRoom', dbCol: 'living_room', kind: 'int' },
  { patchKey: 'balcony', dbCol: 'balcony', kind: 'int' },
  { patchKey: 'staircase', dbCol: 'staircase', kind: 'int' },
  { patchKey: 'specialAreaCount', dbCol: 'special_area_count', kind: 'int' },
  { patchKey: 'liftLevel', dbCol: 'lift_level', kind: 'lift' },
];

function clientPortalToNullableInt(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n));
}

function clientPortalNormalizeLiftLevel(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return null;
  return ['slow', 'medium', 'fast'].includes(s) ? s : null;
}

function formatMyrLabel(n) {
  if (n == null || n === '') return null;
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return `MYR ${x.toFixed(2)}`;
}

async function pickExistingColumns(table, colNames) {
  const out = [];
  for (const c of colNames) {
    if (await databaseHasColumn(table, c)) out.push(c);
  }
  return out;
}

/** Remote TTLock unlock needs gateway linked in DB: lockdetail.hasgateway + gateway_id for this property's smartdoor. */
async function clnPropertyHasRemoteGatewayReady(propertyId) {
  const pid = String(propertyId || '').trim();
  if (!pid) return false;
  const hasSd = await databaseHasColumn('cln_property', 'smartdoor_id');
  if (!hasSd) return false;
  const [[row]] = await pool.query(
    `SELECT l.hasgateway AS hg, l.gateway_id AS gwf
     FROM cln_property p
     LEFT JOIN lockdetail l ON l.id = p.smartdoor_id
     WHERE p.id = ?
     LIMIT 1`,
    [pid]
  );
  if (!row) return false;
  const gw = row.gwf != null && String(row.gwf).trim() !== '';
  const hg = Number(row.hg) === 1;
  return hg && gw;
}

/**
 * B2B client portal — one property row + Coliving bridge contact (owner-portal pattern) + cleaning prices when present.
 */
async function getClientPortalPropertyDetail({ clientdetailId, propertyId } = {}) {
  const cid = String(clientdetailId || '').trim();
  const pid = String(propertyId || '').trim();
  if (!cid || !pid) return null;
  const hasClientdetailCol = await databaseHasColumn('cln_property', 'clientdetail_id');
  if (!hasClientdetailCol) return null;
  const gAcc = await clnPropGroup.getClientPropertyGroupAccess(cid, pid);
  if (gAcc.access === 'none') return null;
  const hasOpCol = await databaseHasColumn('cln_property', 'operator_id');
  const hasColivingPd = await databaseHasColumn('cln_property', 'coliving_propertydetail_id');
  const hasColivingRd = await databaseHasColumn('cln_property', 'coliving_roomdetail_id');

  const clnOptional = [
    'mailbox_password',
    'bed_count',
    'room_count',
    'bathroom_count',
    'kitchen',
    'living_room',
    'balcony',
    'staircase',
    'lift_level',
    'special_area_count',
    'premises_type',
    'security_system',
    'security_username',
    'after_clean_photo_url',
    'key_photo_url',
    'smartdoor_password',
    'smartdoor_token_enabled',
    'operator_door_access_mode',
    'operator_smartdoor_passcode_name',
    'warmcleaning',
    'deepcleaning',
    'generalcleaning',
    'renovationcleaning',
    'cleaning_fees',
    'cleang_fees',
    'contact',
    'latitude',
    'longitude',
  ];
  const clnCols = ['id', 'property_name', 'address', 'unit_name'];
  if (hasOpCol) clnCols.push('operator_id');
  if (hasColivingPd) clnCols.push('coliving_propertydetail_id');
  if (hasColivingRd) clnCols.push('coliving_roomdetail_id');
  if (await databaseHasColumn('cln_property', 'coliving_sync_archived')) clnCols.push('coliving_sync_archived');
  const hasClientPortalOwnedCol = await databaseHasColumn('cln_property', 'client_portal_owned');
  if (hasClientPortalOwnedCol) clnCols.push('client_portal_owned');
  if (hasClientdetailCol) clnCols.push('clientdetail_id');
  for (const c of clnOptional) {
    if (await databaseHasColumn('cln_property', c)) clnCols.push(c);
  }
  if (await databaseHasColumn('cln_property', 'updated_at')) clnCols.push('updated_at');

  const [[row]] = await pool.query(
    `SELECT ${clnCols.map((c) => `p.\`${c}\``).join(', ')}
     FROM cln_property p
     WHERE p.id = ?
     LIMIT 1`,
    [pid]
  );
  if (!row) return null;
  if (row.coliving_sync_archived != null && Number(row.coliving_sync_archived) === 1) return null;

  let cleanlemonsOperatorName = '';
  let cleanlemonsOperatorEmail = '';
  if (hasOpCol && row.operator_id) {
    const ct = await getClnCompanyTable();
    try {
      const [[op]] = await pool.query(
        `SELECT COALESCE(name, '') AS name, COALESCE(email, '') AS email FROM \`${ct}\` WHERE id = ? LIMIT 1`,
        [String(row.operator_id)]
      );
      if (op) {
        cleanlemonsOperatorName = String(op.name || '');
        cleanlemonsOperatorEmail = String(op.email || '');
      }
    } catch (_) {
      /* optional */
    }
  }

  let colivingOperatorTitle = '';
  let colivingOperatorContact = '';
  const colivingPdId = hasColivingPd && row.coliving_propertydetail_id ? String(row.coliving_propertydetail_id) : '';
  if (colivingPdId) {
    try {
      const [[contactRow]] = await pool.query(
        `SELECT COALESCE(c.title, '') AS title,
                TRIM(COALESCE(cp.contact, '')) AS contact
           FROM propertydetail pd
           LEFT JOIN operatordetail c ON c.id = pd.client_id
           LEFT JOIN client_profile cp ON cp.client_id = c.id
          WHERE pd.id = ?
          LIMIT 1`,
        [colivingPdId]
      );
      if (contactRow) {
        colivingOperatorTitle = String(contactRow.title || '');
        colivingOperatorContact = String(contactRow.contact || '');
      }
    } catch (_) {
      /* client_profile / FK variance */
    }
  }

  const priceDefs = [
    { keys: ['warmcleaning'], labelKey: 'warmCleaning', label: 'Warm cleaning' },
    { keys: ['deepcleaning'], labelKey: 'deepCleaning', label: 'Deep cleaning' },
    { keys: ['generalcleaning'], labelKey: 'generalCleaning', label: 'General cleaning' },
    { keys: ['renovationcleaning'], labelKey: 'renovationCleaning', label: 'Renovation cleaning' },
    {
      keys: ['cleaning_fees', 'cleang_fees'],
      labelKey: 'homestayCleaning',
      label: 'Homestay cleaning',
    },
  ];

  const allPriceCols = [...new Set(priceDefs.flatMap((d) => d.keys))];
  const pdPriceCols = colivingPdId ? await pickExistingColumns('propertydetail', allPriceCols) : [];
  const clnPriceCols = await pickExistingColumns('cln_property', allPriceCols);

  let pdRow = null;
  if (colivingPdId && pdPriceCols.length) {
    const [pdRows] = await pool.query(
      `SELECT ${pdPriceCols.map((c) => `\`${c}\``).join(', ')} FROM propertydetail WHERE id = ? LIMIT 1`,
      [colivingPdId]
    );
    pdRow = pdRows[0] || null;
  }

  const pricing = [];
  for (const def of priceDefs) {
    let raw = null;
    let source = 'cln_property';
    for (const k of def.keys) {
      if (pdRow && pdPriceCols.includes(k) && pdRow[k] != null) {
        raw = pdRow[k];
        source = 'propertydetail';
        break;
      }
    }
    if (raw == null) {
      for (const k of def.keys) {
        if (clnPriceCols.includes(k) && row[k] != null) {
          raw = row[k];
          source = 'cln_property';
          break;
        }
      }
    }
    const formatted = formatMyrLabel(raw);
    if (formatted) pricing.push({ key: def.labelKey, label: def.label, display: formatted, source });
  }

  /** Coliving propertydetail / roomdetail smartdoor_id → lockdetail (read-only). JOIN avoids information_schema misses; room-scoped cln rows prefer that room's lock. */
  let smartdoorBindings = { property: null, rooms: [] };
  const colivingRoomId =
    hasColivingRd && row.coliving_roomdetail_id != null && String(row.coliving_roomdetail_id).trim() !== ''
      ? String(row.coliving_roomdetail_id).trim()
      : '';
  if (colivingPdId) {
    try {
      const [[pdJoin]] = await pool.query(
        `SELECT pd.smartdoor_id AS psd,
                COALESCE(NULLIF(TRIM(l.lockalias), ''), NULLIF(TRIM(l.lockname), ''), CAST(l.id AS CHAR)) AS plbl
           FROM propertydetail pd
           LEFT JOIN lockdetail l ON l.id = pd.smartdoor_id
          WHERE pd.id = ?
          LIMIT 1`,
        [colivingPdId]
      );
      let propBinding = null;
      if (pdJoin?.psd != null && String(pdJoin.psd).trim() !== '') {
        const psid = String(pdJoin.psd).trim();
        propBinding = {
          lockdetailId: psid,
          displayLabel: String(pdJoin.plbl || psid).trim() || psid
        };
      }
      let rowRoomBinding = null;
      if (colivingRoomId) {
        const [[rrJoin]] = await pool.query(
          `SELECT r.smartdoor_id AS rsd,
                  COALESCE(NULLIF(TRIM(l2.lockalias), ''), NULLIF(TRIM(l2.lockname), ''), CAST(l2.id AS CHAR)) AS rlbl
             FROM roomdetail r
             LEFT JOIN lockdetail l2 ON l2.id = r.smartdoor_id
            WHERE r.id = ? AND r.property_id = ?
            LIMIT 1`,
          [colivingRoomId, colivingPdId]
        );
        if (rrJoin?.rsd != null && String(rrJoin.rsd).trim() !== '') {
          const rsid = String(rrJoin.rsd).trim();
          rowRoomBinding = {
            lockdetailId: rsid,
            displayLabel: String(rrJoin.rlbl || rsid).trim() || rsid
          };
        }
      }
      smartdoorBindings.property = rowRoomBinding || propBinding;
      const [rrows] = await pool.query(
        `SELECT r.id AS rid,
                COALESCE(NULLIF(TRIM(r.title_fld), ''), NULLIF(TRIM(r.roomname), ''), CAST(r.id AS CHAR)) AS room_lbl,
                r.smartdoor_id AS sid,
                COALESCE(NULLIF(TRIM(l3.lockalias), ''), NULLIF(TRIM(l3.lockname), ''), CAST(l3.id AS CHAR)) AS lock_lbl
           FROM roomdetail r
           LEFT JOIN lockdetail l3 ON l3.id = r.smartdoor_id
          WHERE r.property_id = ?
            AND r.smartdoor_id IS NOT NULL
            AND NULLIF(TRIM(r.smartdoor_id), '') IS NOT NULL`,
        [colivingPdId]
      );
      smartdoorBindings.rooms = (rrows || []).map((rr) => ({
        roomId: String(rr.rid),
        roomDisplayLabel: String(rr.room_lbl || rr.rid),
        lockdetailId: String(rr.sid).trim(),
        lockDisplayLabel: String(rr.lock_lbl || rr.sid).trim()
      }));
    } catch (e) {
      const isUnknown = e.code === 'ER_BAD_FIELD_ERROR' || e.errno === 1054;
      if (!isUnknown) console.error('[cleanlemon] getClientPortalPropertyDetail smartdoorBindings', e?.message || e);
      smartdoorBindings = { property: null, rooms: [] };
    }
  }

  let securitySystemCredentials = null;
  if (colivingPdId && (await databaseHasColumn('propertydetail', 'security_system_credentials_json'))) {
    try {
      const [[credRow]] = await pool.query(
        'SELECT security_system_credentials_json AS j FROM propertydetail WHERE id = ? LIMIT 1',
        [colivingPdId]
      );
      if (credRow?.j != null && String(credRow.j).trim() !== '') {
        try {
          securitySystemCredentials =
            typeof credRow.j === 'string' ? JSON.parse(credRow.j) : credRow.j;
        } catch (_) {
          securitySystemCredentials = null;
        }
      }
    } catch (_) {
      /* optional */
    }
  }

  const clientPortalOwned = !hasClientPortalOwnedCol ? true : Number(row.client_portal_owned) === 1;
  const propClientdetailId =
    hasClientdetailCol && row.clientdetail_id != null ? String(row.clientdetail_id).trim() : '';
  const hasBoundB2bClient = propClientdetailId !== '';
  const hasCleaningOperator =
    hasOpCol && row.operator_id != null && String(row.operator_id).trim() !== '';
  /** Full client-portal edit: client-created, or operator-linked unit with a bound B2B client (not Coliving-list-only). */
  const clientPortalAllowsFullEdit =
    !hasClientPortalOwnedCol || clientPortalOwned || (hasCleaningOperator && hasBoundB2bClient);

  let smartdoorGatewayReady = false;
  try {
    smartdoorGatewayReady = await clnPropertyHasRemoteGatewayReady(pid);
  } catch (_) {
    smartdoorGatewayReady = false;
  }

  let nativeLockBindings = [];
  try {
    const clnPl = require('./cleanlemon-property-lock.service');
    nativeLockBindings = await clnPl.listNativeLocksForClnProperty(pid);
  } catch (_) {
    nativeLockBindings = [];
  }
  const smartdoorBindManualAllowed = !colivingPdId;

  return {
    id: String(row.id || ''),
    name: String(row.property_name || '').trim() || 'Property',
    address: String(row.address || '').trim() || '—',
    unitNumber: String(row.unit_name || '').trim(),
    clientPortalOwned,
    clientPortalAllowsFullEdit,
    operatorId: hasOpCol && row.operator_id ? String(row.operator_id) : '',
    cleanlemonsOperatorName,
    cleanlemonsOperatorEmail,
    colivingPropertydetailId: colivingPdId || '',
    colivingRoomdetailId: colivingRoomId,
    mailboxPassword: row.mailbox_password != null ? String(row.mailbox_password) : '',
    bedCount: row.bed_count != null ? Number(row.bed_count) : null,
    roomCount: row.room_count != null ? Number(row.room_count) : null,
    bathroomCount: row.bathroom_count != null ? Number(row.bathroom_count) : null,
    kitchen: row.kitchen != null ? Number(row.kitchen) : null,
    livingRoom: row.living_room != null ? Number(row.living_room) : null,
    balcony: row.balcony != null ? Number(row.balcony) : null,
    staircase: row.staircase != null ? Number(row.staircase) : null,
    specialAreaCount: row.special_area_count != null ? Number(row.special_area_count) : null,
    liftLevel: row.lift_level != null ? String(row.lift_level) : '',
    contact: row.contact != null ? String(row.contact) : '',
    colivingOperatorTitle,
    colivingOperatorContact,
    pricing,
    premisesType: row.premises_type != null ? String(row.premises_type) : '',
    securitySystem: row.security_system != null ? String(row.security_system) : '',
    securityUsername: row.security_username != null ? String(row.security_username) : '',
    securitySystemCredentials,
    afterCleanPhotoUrl: row.after_clean_photo_url != null ? String(row.after_clean_photo_url) : '',
    keyPhotoUrl: row.key_photo_url != null ? String(row.key_photo_url) : '',
    smartdoorPassword: row.smartdoor_password != null ? String(row.smartdoor_password) : '',
    smartdoorTokenEnabled: Number(row.smartdoor_token_enabled) === 1,
    operatorSmartdoorPasscodeName:
      row.operator_smartdoor_passcode_name != null && String(row.operator_smartdoor_passcode_name).trim() !== ''
        ? String(row.operator_smartdoor_passcode_name).trim()
        : '',
    smartdoorGatewayReady,
    operatorDoorAccessMode:
      row.operator_door_access_mode != null && String(row.operator_door_access_mode).trim() !== ''
        ? String(row.operator_door_access_mode).trim()
        : 'temporary_password_only',
    updatedAt: row.updated_at != null ? row.updated_at : null,
    latitude:
      row.latitude != null && String(row.latitude).trim() !== ''
        ? Number(row.latitude)
        : null,
    longitude:
      row.longitude != null && String(row.longitude).trim() !== ''
        ? Number(row.longitude)
        : null,
    smartdoorBindings,
    nativeLockBindings,
    smartdoorBindManualAllowed,
    groupAccess: {
      access: gAcc.access,
      groupId: gAcc.groupId,
      perm: gAcc.perm,
    },
  };
}

async function mirrorClientPortalPatchToPropertydetail(colivingPropertydetailId, normalizedPatch) {
  const pdId = String(colivingPropertydetailId || '').trim();
  if (!pdId) return;
  const sets = [];
  const vals = [];
  for (const spec of CLIENT_PORTAL_PD_MIRROR_SPECS) {
    if (normalizedPatch[spec.patchKey] === undefined) continue;
    if (!(await databaseHasColumn('propertydetail', spec.dbCol))) continue;
    let v = normalizedPatch[spec.patchKey];
    if (spec.kind === 'str') v = v == null ? null : String(v);
    if (spec.kind === 'int') v = v === null ? null : v;
    if (spec.kind === 'lift') v = v === null || v === '' ? null : String(v);
    sets.push(`\`${spec.dbCol}\` = ?`);
    vals.push(v);
  }
  if (!sets.length) return;
  vals.push(pdId);
  await pool.query(`UPDATE propertydetail SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ?`, vals);
}

/**
 * B2B client portal — patch fields + optional bind/disconnect Cleanlemons operator (requires TTLock/property auth when binding).
 */
async function patchClientPortalProperty({ clientdetailId, propertyId, body } = {}) {
  const cid = String(clientdetailId || '').trim();
  const pid = String(propertyId || '').trim();
  if (!cid || !pid) {
    const e = new Error('MISSING_IDS');
    e.code = 'MISSING_IDS';
    throw e;
  }
  const hasClientdetailCol = await databaseHasColumn('cln_property', 'clientdetail_id');
  if (!hasClientdetailCol) {
    const e = new Error('CLIENT_PORTAL_PROPERTIES_UNSUPPORTED');
    e.code = 'CLIENT_PORTAL_PROPERTIES_UNSUPPORTED';
    throw e;
  }
  await clnPropGroup.assertPropertyActionAllowed(cid, pid, 'property', 'edit');
  const [hasWNavCol, hasGNavCol, hasLatColPatch, hasLngColPatch, hasPortalOwnedPatch, hasOpColPatch] =
    await Promise.all([
      databaseHasColumn('cln_property', 'waze_url'),
      databaseHasColumn('cln_property', 'google_maps_url'),
      databaseHasColumn('cln_property', 'latitude'),
      databaseHasColumn('cln_property', 'longitude'),
      databaseHasColumn('cln_property', 'client_portal_owned'),
      databaseHasColumn('cln_property', 'operator_id'),
    ]);
  let selExisting = 'id, clientdetail_id AS propOwnerClientdetailId, coliving_propertydetail_id AS colivingPd, address';
  if (hasOpColPatch) selExisting += ', operator_id';
  if (hasWNavCol) selExisting += ', waze_url';
  if (hasGNavCol) selExisting += ', google_maps_url';
  if (hasLatColPatch) selExisting += ', latitude';
  if (hasLngColPatch) selExisting += ', longitude';
  if (hasPortalOwnedPatch) selExisting += ', COALESCE(client_portal_owned, 0) AS client_portal_owned';
  const [[existing]] = await pool.query(
    `SELECT ${selExisting} FROM cln_property WHERE id = ? LIMIT 1`,
    [pid]
  );
  if (!existing) {
    const e = new Error('PROPERTY_NOT_FOUND');
    e.code = 'PROPERTY_NOT_FOUND';
    throw e;
  }
  const colivingPdId = existing.colivingPd != null ? String(existing.colivingPd) : '';
  const isPropertyOwner = String(existing.propOwnerClientdetailId || '').trim() === cid;
  const hasBoundB2bClient =
    existing.propOwnerClientdetailId != null && String(existing.propOwnerClientdetailId).trim() !== '';
  const hasCleaningOperatorPatch =
    hasOpColPatch &&
    existing.operator_id != null &&
    String(existing.operator_id).trim() !== '';
  /** 1 = client portal–created (full); 0 + operator + bound client = operator-linked B2B (full); 0 + no operator = Coliving-list style (limited). */
  const portalOwnedFullEdit =
    !hasPortalOwnedPatch ||
    Number(existing.client_portal_owned) === 1 ||
    (hasCleaningOperatorPatch && hasBoundB2bClient);

  const b = body && typeof body === 'object' ? body : {};
  const hasOpCol = hasOpColPatch || (await databaseHasColumn('cln_property', 'operator_id'));

  if (b.clearCleanlemonsOperator) {
    if (!isPropertyOwner) {
      const e = new Error('GROUP_PERMISSION_DENIED');
      e.code = 'GROUP_PERMISSION_DENIED';
      throw e;
    }
    if (!hasOpCol) {
      const e = new Error('OPERATOR_COLUMN_MISSING');
      e.code = 'OPERATOR_COLUMN_MISSING';
      throw e;
    }
    await pool.query('UPDATE cln_property SET operator_id = NULL, updated_at = NOW(3) WHERE id = ?', [pid]);
  } else if (b.setCleanlemonsOperator && typeof b.setCleanlemonsOperator === 'object') {
    if (!isPropertyOwner) {
      const e = new Error('GROUP_PERMISSION_DENIED');
      e.code = 'GROUP_PERMISSION_DENIED';
      throw e;
    }
    const opId = String(b.setCleanlemonsOperator.operatorId || '').trim();
    const auth = !!b.setCleanlemonsOperator.authorizePropertyAndTtlock;
    if (!opId) {
      const e = new Error('MISSING_OPERATOR_ID');
      e.code = 'MISSING_OPERATOR_ID';
      throw e;
    }
    if (!auth) {
      const e = new Error('AUTHORIZE_PROPERTY_TTLOCK_REQUIRED');
      e.code = 'AUTHORIZE_PROPERTY_TTLOCK_REQUIRED';
      throw e;
    }
    if (!hasOpCol) {
      const e = new Error('OPERATOR_COLUMN_MISSING');
      e.code = 'OPERATOR_COLUMN_MISSING';
      throw e;
    }
    const ct = await getClnCompanyTable();
    const [[opOk]] = await pool.query(`SELECT id FROM \`${ct}\` WHERE id = ? LIMIT 1`, [opId]);
    if (!opOk) {
      const e = new Error('OPERATOR_NOT_FOUND');
      e.code = 'OPERATOR_NOT_FOUND';
      throw e;
    }
    await pool.query('UPDATE cln_property SET operator_id = ?, updated_at = NOW(3) WHERE id = ?', [opId, pid]);
    try {
      const plr = require('./cleanlemon-property-link-request.service');
      await plr.assignClnOperatorToPropertySmartDoorRows(pid, cid, opId);
    } catch (e) {
      console.warn('[cleanlemon] assignClnOperatorToPropertySmartDoorRows', e?.message || e);
    }
  }

  const normalized = {};
  if (b.mailboxPassword !== undefined) {
    normalized.mailboxPassword = String(b.mailboxPassword ?? '');
  }
  if (b.bedCount !== undefined) normalized.bedCount = clientPortalToNullableInt(b.bedCount);
  if (b.roomCount !== undefined) normalized.roomCount = clientPortalToNullableInt(b.roomCount);
  if (b.bathroomCount !== undefined) normalized.bathroomCount = clientPortalToNullableInt(b.bathroomCount);
  if (b.kitchen !== undefined) normalized.kitchen = clientPortalToNullableInt(b.kitchen);
  if (b.livingRoom !== undefined) normalized.livingRoom = clientPortalToNullableInt(b.livingRoom);
  if (b.balcony !== undefined) normalized.balcony = clientPortalToNullableInt(b.balcony);
  if (b.staircase !== undefined) normalized.staircase = clientPortalToNullableInt(b.staircase);
  if (b.specialAreaCount !== undefined) normalized.specialAreaCount = clientPortalToNullableInt(b.specialAreaCount);
  if (b.liftLevel !== undefined) {
    const ll = String(b.liftLevel ?? '').trim();
    normalized.liftLevel = ll === '' ? null : clientPortalNormalizeLiftLevel(ll) ?? ll;
  }
  if (b.name !== undefined) normalized.propertyName = String(b.name ?? '').trim();
  if (b.address !== undefined) normalized.address = String(b.address ?? '').trim();
  if (b.unitNumber !== undefined) normalized.unitName = String(b.unitNumber ?? '').trim();
  if (b.premisesType !== undefined) {
    const pt = String(b.premisesType ?? '').trim().toLowerCase();
    normalized.premisesType = pt === '' ? null : pt;
  }
  if (b.securitySystem !== undefined) {
    normalized.securitySystem = String(b.securitySystem ?? '').trim() || null;
  }
  if (b.securityUsername !== undefined) {
    normalized.securityUsername = String(b.securityUsername ?? '').trim() || null;
  }
  const afterPh = b.afterCleanPhotoUrl !== undefined ? b.afterCleanPhotoUrl : b.afterCleanPhoto;
  if (afterPh !== undefined) normalized.afterCleanPhotoUrl = afterPh;
  const keyPh = b.keyPhotoUrl !== undefined ? b.keyPhotoUrl : b.keyPhoto;
  if (keyPh !== undefined) normalized.keyPhotoUrl = keyPh;
  if (b.smartdoorPassword !== undefined) normalized.smartdoorPassword = String(b.smartdoorPassword ?? '');
  if (b.smartdoorTokenEnabled !== undefined) normalized.smartdoorTokenEnabled = b.smartdoorTokenEnabled;
  if (b.operatorDoorAccessMode !== undefined) {
    const raw = String(b.operatorDoorAccessMode ?? '').trim().toLowerCase();
    const allowed = ['full_access', 'temporary_password_only', 'working_date_only', 'fixed_password'];
    if (raw && !allowed.includes(raw)) {
      const e = new Error('INVALID_OPERATOR_DOOR_ACCESS_MODE');
      e.code = 'INVALID_OPERATOR_DOOR_ACCESS_MODE';
      throw e;
    }
    normalized.operatorDoorAccessMode = raw || 'temporary_password_only';
  }

  if (hasPortalOwnedPatch && !portalOwnedFullEdit) {
    const allowedImported = new Set([
      'afterCleanPhotoUrl',
      'keyPhotoUrl',
      'bedCount',
      'roomCount',
      'bathroomCount',
      'operatorDoorAccessMode',
      'smartdoorPassword',
      'smartdoorTokenEnabled',
      'mailboxPassword',
    ]);
    for (const k of Object.keys(normalized)) {
      if (!allowedImported.has(k)) delete normalized[k];
    }
  }

  if (normalized.operatorDoorAccessMode != null) {
    const m = String(normalized.operatorDoorAccessMode || '').trim().toLowerCase();
    if (
      m === 'full_access' ||
      m === 'working_date_only' ||
      m === 'temporary_password_only'
    ) {
      const okGw = await clnPropertyHasRemoteGatewayReady(pid);
      if (!okGw) {
        const e = new Error('OPERATOR_DOOR_GATEWAY_REQUIRED');
        e.code = 'OPERATOR_DOOR_GATEWAY_REQUIRED';
        throw e;
      }
    }
  }

  const clnSets = [];
  const clnVals = [];
  const mapCln = [
    ['propertyName', 'property_name', 'str'],
    ['address', 'address', 'str'],
    ['unitName', 'unit_name', 'str'],
    ['premisesType', 'premises_type', 'str'],
    ['securitySystem', 'security_system', 'str'],
    ['securityUsername', 'security_username', 'str'],
    ['afterCleanPhotoUrl', 'after_clean_photo_url', 'url'],
    ['keyPhotoUrl', 'key_photo_url', 'url'],
    ['smartdoorPassword', 'smartdoor_password', 'str'],
    ['smartdoorTokenEnabled', 'smartdoor_token_enabled', 'bool'],
    ['operatorDoorAccessMode', 'operator_door_access_mode', 'door_mode'],
    ['mailboxPassword', 'mailbox_password', 'str'],
    ['bedCount', 'bed_count', 'int'],
    ['roomCount', 'room_count', 'int'],
    ['bathroomCount', 'bathroom_count', 'int'],
    ['kitchen', 'kitchen', 'int'],
    ['livingRoom', 'living_room', 'int'],
    ['balcony', 'balcony', 'int'],
    ['staircase', 'staircase', 'int'],
    ['specialAreaCount', 'special_area_count', 'int'],
    ['liftLevel', 'lift_level', 'lift'],
  ];
  for (const [pKey, col, kind] of mapCln) {
    if (normalized[pKey] === undefined) continue;
    if (!(await databaseHasColumn('cln_property', col))) continue;
    let v = normalized[pKey];
    if (kind === 'str') v = v == null ? null : String(v);
    if (kind === 'url') v = clnSanitizePersistableUrl(v);
    if (kind === 'bool') v = v === true || v === 1 || v === '1' ? 1 : 0;
    if (kind === 'door_mode') {
      v = v == null || v === '' ? 'temporary_password_only' : String(v);
      if (
        !['full_access', 'temporary_password_only', 'working_date_only', 'fixed_password'].includes(v)
      )
        continue;
    }
    if (kind === 'lift' && v != null && !['slow', 'medium', 'fast'].includes(String(v))) continue;
    clnSets.push(`\`${col}\` = ?`);
    clnVals.push(v);
  }

  if (
    portalOwnedFullEdit &&
    (hasWNavCol || hasGNavCol) &&
    (normalized.address !== undefined ||
      b.wazeUrl !== undefined ||
      b.waze_url !== undefined ||
      b.googleMapsUrl !== undefined ||
      b.google_maps_url !== undefined)
  ) {
    const nav = resolveClnPropertyNavigationUrls({
      nextAddressRaw:
        normalized.address !== undefined ? String(normalized.address ?? '') : String(existing.address ?? ''),
      prevAddress: String(existing.address ?? ''),
      prevWaze: hasWNavCol ? String(existing.waze_url ?? '') : '',
      prevGoogle: hasGNavCol ? String(existing.google_maps_url ?? '') : '',
      explicitWaze: b.wazeUrl !== undefined || b.waze_url !== undefined,
      explicitGoogle: b.googleMapsUrl !== undefined || b.google_maps_url !== undefined,
      inputWazeVal: b.wazeUrl ?? b.waze_url,
      inputGoogleVal: b.googleMapsUrl ?? b.google_maps_url,
    });
    if (hasWNavCol) {
      clnSets.push('`waze_url` = ?');
      clnVals.push(nav.wazeUrl);
    }
    if (hasGNavCol) {
      clnSets.push('`google_maps_url` = ?');
      clnVals.push(nav.googleMapsUrl);
    }
  }

  if (
    portalOwnedFullEdit &&
    (hasLatColPatch || hasLngColPatch) &&
    (b.latitude !== undefined || b.longitude !== undefined || b.lat !== undefined || b.lng !== undefined)
  ) {
    const la =
      b.latitude !== undefined
        ? b.latitude
        : b.lat !== undefined
          ? b.lat
          : existing.latitude;
    const lo =
      b.longitude !== undefined
        ? b.longitude
        : b.lng !== undefined
          ? b.lng
          : existing.longitude;
    const geo = parseClnOptionalLatLng(la, lo);
    if (hasLatColPatch) {
      clnSets.push('`latitude` = ?');
      clnVals.push(geo.lat);
    }
    if (hasLngColPatch) {
      clnSets.push('`longitude` = ?');
      clnVals.push(geo.lng);
    }
  }

  if (clnSets.length) {
    clnVals.push(pid);
    await pool.query(`UPDATE cln_property SET ${clnSets.join(', ')}, updated_at = NOW(3) WHERE id = ?`, clnVals);
  }

  try {
    const bMode = String(b.operatorDoorAccessMode || '').trim().toLowerCase();
    if (bMode === 'full_access') {
      const clnSmartPin = require('./cleanlemon-smartdoor-operator-pin.service');
      await clnSmartPin.syncOperatorPermanentPasscodeForProperty(pid);
    }
  } catch (e) {
    console.warn('[cleanlemon] syncOperatorPermanentPasscodeForProperty', e?.message || e);
  }

  if (colivingPdId && b.securitySystemCredentials !== undefined && portalOwnedFullEdit) {
    const credCol = await databaseHasColumn('propertydetail', 'security_system_credentials_json');
    if (credCol) {
      const rawCred = b.securitySystemCredentials;
      const val =
        rawCred == null || rawCred === ''
          ? null
          : typeof rawCred === 'string'
            ? rawCred
            : JSON.stringify(rawCred);
      await pool.query('UPDATE propertydetail SET security_system_credentials_json = ? WHERE id = ?', [
        val,
        colivingPdId,
      ]);
    }
  }

  if (colivingPdId && Object.keys(normalized).length) {
    await mirrorClientPortalPatchToPropertydetail(colivingPdId, normalized);
  }

  return getClientPortalPropertyDetail({ clientdetailId: cid, propertyId: pid });
}

/**
 * B2B client portal — create pending `client_requests_operator` link rows for many properties at once
 * (same semantics as patch `setCleanlemonsOperator` with requestApproval + authorizePropertyAndTtlock).
 */
async function bulkRequestClientPortalOperatorBinding({
  clientdetailId,
  propertyIds,
  targetOperatorId,
  replaceExistingBindings = false,
} = {}) {
  const cid = String(clientdetailId || '').trim();
  const opId = String(targetOperatorId || '').trim();
  const ids = Array.isArray(propertyIds)
    ? [...new Set(propertyIds.map((x) => String(x || '').trim()).filter(Boolean))]
    : [];
  if (!cid || !opId) {
    const e = new Error('MISSING_IDS');
    e.code = 'MISSING_IDS';
    throw e;
  }
  if (!ids.length) {
    const e = new Error('MISSING_PROPERTY_IDS');
    e.code = 'MISSING_PROPERTY_IDS';
    throw e;
  }
  const hasClientdetailCol = await databaseHasColumn('cln_property', 'clientdetail_id');
  if (!hasClientdetailCol) {
    const e = new Error('CLIENT_PORTAL_PROPERTIES_UNSUPPORTED');
    e.code = 'CLIENT_PORTAL_PROPERTIES_UNSUPPORTED';
    throw e;
  }
  const hasOpCol = await databaseHasColumn('cln_property', 'operator_id');
  if (!hasOpCol) {
    const e = new Error('OPERATOR_COLUMN_MISSING');
    e.code = 'OPERATOR_COLUMN_MISSING';
    throw e;
  }
  const ct = await getClnCompanyTable();
  const [[opOk]] = await pool.query(`SELECT id FROM \`${ct}\` WHERE id = ? LIMIT 1`, [opId]);
  if (!opOk) {
    const e = new Error('OPERATOR_NOT_FOUND');
    e.code = 'OPERATOR_NOT_FOUND';
    throw e;
  }

  const plr = require('./cleanlemon-property-link-request.service');
  const succeeded = [];
  const failed = [];

  for (const pid of ids) {
    try {
      const [[row]] = await pool.query(
        'SELECT id, operator_id AS op FROM cln_property WHERE id = ? AND clientdetail_id = ? LIMIT 1',
        [pid, cid]
      );
      if (!row) {
        failed.push({ propertyId: pid, reason: 'PROPERTY_NOT_FOUND' });
        continue;
      }
      const curOp = row.op != null ? String(row.op).trim() : '';
      if (curOp) {
        if (curOp === opId) {
          succeeded.push(pid);
          continue;
        }
        if (!replaceExistingBindings) {
          failed.push({ propertyId: pid, reason: 'ALREADY_BOUND' });
          continue;
        }
      }
      await pool.query('UPDATE cln_property SET operator_id = ?, updated_at = NOW(3) WHERE id = ? AND clientdetail_id = ?', [
        opId,
        pid,
        cid,
      ]);
      try {
        await syncClnPropertyLegacyClientIdColumn(pid);
      } catch (e) {
        console.warn('[cleanlemon] bulkBindClientPortalOperator sync client_id', pid, e?.message || e);
      }
      try {
        await plr.assignClnOperatorToPropertySmartDoorRows(pid, cid, opId);
      } catch (e) {
        console.warn('[cleanlemon] bulk bind assignClnOperatorToPropertySmartDoorRows', pid, e?.message || e);
      }
      succeeded.push(pid);
    } catch (err) {
      failed.push({
        propertyId: pid,
        reason: err?.code || err?.message || 'UNKNOWN',
      });
    }
  }

  return { succeeded, failed };
}

/** B2B client portal — clear `operator_id` on many properties (same as patch `clearCleanlemonsOperator`). */
async function bulkClearClientPortalOperator({ clientdetailId, propertyIds } = {}) {
  const cid = String(clientdetailId || '').trim();
  const ids = Array.isArray(propertyIds)
    ? [...new Set(propertyIds.map((x) => String(x || '').trim()).filter(Boolean))]
    : [];
  if (!cid) {
    const e = new Error('MISSING_IDS');
    e.code = 'MISSING_IDS';
    throw e;
  }
  if (!ids.length) {
    const e = new Error('MISSING_PROPERTY_IDS');
    e.code = 'MISSING_PROPERTY_IDS';
    throw e;
  }
  const hasClientdetailCol = await databaseHasColumn('cln_property', 'clientdetail_id');
  if (!hasClientdetailCol) {
    const e = new Error('CLIENT_PORTAL_PROPERTIES_UNSUPPORTED');
    e.code = 'CLIENT_PORTAL_PROPERTIES_UNSUPPORTED';
    throw e;
  }
  const hasOpCol = await databaseHasColumn('cln_property', 'operator_id');
  if (!hasOpCol) {
    const e = new Error('OPERATOR_COLUMN_MISSING');
    e.code = 'OPERATOR_COLUMN_MISSING';
    throw e;
  }

  const succeeded = [];
  const failed = [];
  const plrSd = require('./cleanlemon-property-link-request.service');

  for (const pid of ids) {
    try {
      const [[row]] = await pool.query(
        'SELECT id, operator_id AS op FROM cln_property WHERE id = ? AND clientdetail_id = ? LIMIT 1',
        [pid, cid]
      );
      if (!row) {
        failed.push({ propertyId: pid, reason: 'PROPERTY_NOT_FOUND' });
        continue;
      }
      const curOp = row.op != null ? String(row.op).trim() : '';
      if (!curOp) {
        failed.push({ propertyId: pid, reason: 'NOT_BOUND' });
        continue;
      }
      if (typeof plrSd.clearClnOperatorFromPropertySmartDoorRows === 'function') {
        try {
          await plrSd.clearClnOperatorFromPropertySmartDoorRows(pid, curOp, cid);
        } catch (sdErr) {
          console.warn('[cleanlemon] bulkClearClientPortalOperator smart door clear', pid, sdErr?.message || sdErr);
        }
      }
      await pool.query('UPDATE cln_property SET operator_id = NULL, updated_at = NOW(3) WHERE id = ?', [pid]);
      succeeded.push(pid);
    } catch (err) {
      failed.push({
        propertyId: pid,
        reason: err?.code || err?.message || 'UNKNOWN',
      });
    }
  }

  return { succeeded, failed };
}

async function createOperatorProperty(input) {
  const id = input.id || makeId('cln-prop');
  const opId = String(input.operatorId || input.operator_id || '').trim() || null;
  const targetClientCd = String(input.clientdetailId || input.clientdetail_id || input.clientId || '').trim() || null;
  const deferClientBinding =
    input.deferClientBinding === true || input.deferClientBinding === 'true' || input.deferClientBinding === 1;
  const clientdetailId = deferClientBinding && targetClientCd && opId ? null : targetClientCd;
  const hasOpCol = await databaseHasColumn('cln_property', 'operator_id');
  const hasClientdetailCol = await databaseHasColumn('cln_property', 'clientdetail_id');
  const toNullableInt = (v) => {
    const s = String(v ?? '').trim();
    if (!s) return null;
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.floor(n));
  };
  const bedCount = toNullableInt(input.bedCount ?? input.bed_count);
  const roomCount = toNullableInt(input.roomCount ?? input.room_count);
  const bathroomCount = toNullableInt(input.bathroomCount ?? input.bathroom_count);
  const kitchen = toNullableInt(input.kitchen);
  const livingRoom = toNullableInt(input.livingRoom ?? input.living_room);
  const balcony = toNullableInt(input.balcony);
  const staircase = toNullableInt(input.staircase ?? input.stairCase);
  const specialAreaCount = toNullableInt(input.specialAreaCount ?? input.special_area_count);
  const liftLevelRaw = String(input.liftLevel ?? input.lift_level ?? '').trim().toLowerCase();
  const liftLevel = ['slow', 'medium', 'fast'].includes(liftLevelRaw) ? liftLevelRaw : null;
  const mailboxPassword = String(input.mailboxPassword ?? input.mailbox_password ?? '').trim() || null;

  const colChecks = await Promise.all([
    databaseHasColumn('cln_property', 'mailbox_password'),
    databaseHasColumn('cln_property', 'bed_count'),
    databaseHasColumn('cln_property', 'room_count'),
    databaseHasColumn('cln_property', 'bathroom_count'),
    databaseHasColumn('cln_property', 'kitchen'),
    databaseHasColumn('cln_property', 'living_room'),
    databaseHasColumn('cln_property', 'balcony'),
    databaseHasColumn('cln_property', 'staircase'),
    databaseHasColumn('cln_property', 'lift_level'),
    databaseHasColumn('cln_property', 'special_area_count'),
  ]);
  const [
    hasMailboxPassword,
    hasBedCount,
    hasRoomCount,
    hasBathroomCount,
    hasKitchen,
    hasLivingRoom,
    hasBalcony,
    hasStaircase,
    hasLiftLevel,
    hasSpecialAreaCount,
  ] = colChecks;

  let teamInsertVal = String(input.team || '').trim();
  if (input.teamId !== undefined) {
    const tid = String(input.teamId ?? '').trim();
    teamInsertVal = tid ? String((await getOperatorTeamNameById(tid)) || '').trim() : '';
  }
  const columns = ['id', 'property_name', 'address', 'unit_name', 'client_label', 'team'];
  const values = [
    id,
    String(input.name || ''),
    String(input.address || ''),
    String(input.unitNumber || ''),
    String(input.client || ''),
    teamInsertVal,
  ];

  if (hasOpCol) {
    columns.push('operator_id');
    values.push(opId);
    if (await databaseHasColumn('cln_property', 'client_id')) {
      columns.push('client_id');
      /** Mirror B2B binding: same UUID as `clientdetail_id` when set; else operator (legacy scope). */
      values.push(clientdetailId || opId);
    }
  }
  if (hasClientdetailCol) {
    columns.push('clientdetail_id');
    values.push(clientdetailId);
  }
  if (hasMailboxPassword) {
    columns.push('mailbox_password');
    values.push(mailboxPassword);
  }
  if (hasBedCount) {
    columns.push('bed_count');
    values.push(bedCount);
  }
  if (hasRoomCount) {
    columns.push('room_count');
    values.push(roomCount);
  }
  if (hasBathroomCount) {
    columns.push('bathroom_count');
    values.push(bathroomCount);
  }
  if (hasKitchen) {
    columns.push('kitchen');
    values.push(kitchen);
  }
  if (hasLivingRoom) {
    columns.push('living_room');
    values.push(livingRoom);
  }
  if (hasBalcony) {
    columns.push('balcony');
    values.push(balcony);
  }
  if (hasStaircase) {
    columns.push('staircase');
    values.push(staircase);
  }
  if (hasLiftLevel) {
    columns.push('lift_level');
    values.push(liftLevel);
  }
  if (hasSpecialAreaCount) {
    columns.push('special_area_count');
    values.push(specialAreaCount);
  }

  const hasMinValueCreate = await databaseHasColumn('cln_property', 'min_value');
  if (hasMinValueCreate) {
    let mv = null;
    if (input.minValue !== undefined || input.min_value !== undefined) {
      mv = toNullableInt(input.minValue !== undefined ? input.minValue : input.min_value);
    } else if (input.estimatedTime !== undefined) {
      mv = parseClnEstimateTimeInputToMinutes(input.estimatedTime);
    }
    columns.push('min_value');
    values.push(mv);
  }

  const [
    hasClientPortalOwned,
    hasPremisesTypeCol,
    hasSecuritySystemCol,
    hasSecurityUsernameCol,
    hasAfterPhotoCol,
    hasKeyPhotoCol,
    hasSmartdoorPwdCol,
    hasSmartdoorTokCol,
  ] = await Promise.all([
    databaseHasColumn('cln_property', 'client_portal_owned'),
    databaseHasColumn('cln_property', 'premises_type'),
    databaseHasColumn('cln_property', 'security_system'),
    databaseHasColumn('cln_property', 'security_username'),
    databaseHasColumn('cln_property', 'after_clean_photo_url'),
    databaseHasColumn('cln_property', 'key_photo_url'),
    databaseHasColumn('cln_property', 'smartdoor_password'),
    databaseHasColumn('cln_property', 'smartdoor_token_enabled'),
  ]);

  const clientPortalOwned =
    input.clientPortalOwned === true || input.clientPortalOwned === 1 || input.client_portal_owned === 1 ? 1 : 0;
  const premisesTypeVal = String(input.premisesType || input.siteKind || '').trim().toLowerCase() || null;
  const securitySystemVal = String(input.securitySystem || '').trim() || null;
  const securityUsernameVal = String(input.securityUsername ?? input.security_username ?? '').trim() || null;
  const smartdoorPwdVal = String(input.smartdoorPassword ?? input.smartdoor_password ?? '').trim() || null;
  const smartdoorTokVal =
    input.smartdoorToken === '1' ||
    input.smartdoorToken === 1 ||
    input.smartdoorTokenEnabled === true ||
    input.smartdoor_token_enabled === 1
      ? 1
      : 0;
  const afterUrl = clnSanitizePersistableUrl(
    input.afterCleanPhotoUrl ?? input.after_clean_photo_url ?? input.afterCleanPhoto
  );
  const keyUrl = clnSanitizePersistableUrl(input.keyPhotoUrl ?? input.key_photo_url ?? input.keyPhoto);

  if (opId && targetClientCd) await assertClientdetailLinkedToOperator(opId, targetClientCd);

  if (hasClientPortalOwned) {
    columns.push('client_portal_owned');
    values.push(clientPortalOwned);
  }
  if (hasPremisesTypeCol) {
    columns.push('premises_type');
    values.push(premisesTypeVal);
  }
  if (hasSecuritySystemCol) {
    columns.push('security_system');
    values.push(securitySystemVal);
  }
  if (hasSecurityUsernameCol) {
    columns.push('security_username');
    values.push(securityUsernameVal);
  }
  if (hasSmartdoorPwdCol) {
    columns.push('smartdoor_password');
    values.push(smartdoorPwdVal);
  }
  if (hasSmartdoorTokCol) {
    columns.push('smartdoor_token_enabled');
    values.push(smartdoorTokVal);
  }
  if (hasAfterPhotoCol) {
    columns.push('after_clean_photo_url');
    values.push(afterUrl);
  }
  if (hasKeyPhotoCol) {
    columns.push('key_photo_url');
    values.push(keyUrl);
  }

  const [hasWazeUrlCol, hasGoogleMapsUrlCol] = await Promise.all([
    databaseHasColumn('cln_property', 'waze_url'),
    databaseHasColumn('cln_property', 'google_maps_url'),
  ]);
  const navCreate = resolveClnPropertyNavigationUrls({
    nextAddressRaw: String(input.address || ''),
    prevAddress: '',
    prevWaze: '',
    prevGoogle: '',
    explicitWaze: input.wazeUrl !== undefined || input.waze_url !== undefined,
    explicitGoogle: input.googleMapsUrl !== undefined || input.google_maps_url !== undefined,
    inputWazeVal: input.wazeUrl ?? input.waze_url,
    inputGoogleVal: input.googleMapsUrl ?? input.google_maps_url,
  });
  if (hasWazeUrlCol) {
    columns.push('waze_url');
    values.push(navCreate.wazeUrl);
  }
  if (hasGoogleMapsUrlCol) {
    columns.push('google_maps_url');
    values.push(navCreate.googleMapsUrl);
  }

  const [hasLatColCreate, hasLngColCreate] = await Promise.all([
    databaseHasColumn('cln_property', 'latitude'),
    databaseHasColumn('cln_property', 'longitude'),
  ]);
  const geoCreate = parseClnOptionalLatLng(
    input.latitude ?? input.lat,
    input.longitude ?? input.lng ?? input.lon
  );
  if (hasLatColCreate) {
    columns.push('latitude');
    values.push(geoCreate.lat);
  }
  if (hasLngColCreate) {
    columns.push('longitude');
    values.push(geoCreate.lng);
  }

  const [hasOperatorDoorModeC, hasOperatorCleaningLineC, hasOperatorCleaningPriceC, hasOperatorCleaningServiceC, hasOperatorCleaningRowsJsonC] =
    await Promise.all([
      databaseHasColumn('cln_property', 'operator_door_access_mode'),
      databaseHasColumn('cln_property', 'operator_cleaning_pricing_line'),
      databaseHasColumn('cln_property', 'operator_cleaning_price_myr'),
      databaseHasColumn('cln_property', 'operator_cleaning_pricing_service'),
      databaseHasColumn('cln_property', 'operator_cleaning_pricing_rows_json'),
    ]);
  if (hasOperatorDoorModeC && input.operatorDoorAccessMode !== undefined) {
    const raw = String(input.operatorDoorAccessMode ?? '').trim().toLowerCase();
    const allowed = ['full_access', 'temporary_password_only', 'working_date_only', 'fixed_password'];
    const m = !raw || allowed.includes(raw) ? raw || 'temporary_password_only' : 'temporary_password_only';
    columns.push('operator_door_access_mode');
    values.push(m);
  }
  const wantsCleaningRowsC =
    hasOperatorCleaningRowsJsonC &&
    (input.operatorCleaningPricingRows !== undefined || input.operator_cleaning_pricing_rows !== undefined);
  const cleaningRowsInC = input.operatorCleaningPricingRows ?? input.operator_cleaning_pricing_rows;
  if (wantsCleaningRowsC) {
    const normalized = normalizeOperatorCleaningPricingRowsInput(Array.isArray(cleaningRowsInC) ? cleaningRowsInC : []);
    columns.push('operator_cleaning_pricing_rows_json');
    values.push(normalized.length ? JSON.stringify(normalized) : null);
    const first = normalized[0];
    if (hasOperatorCleaningLineC) {
      columns.push('operator_cleaning_pricing_line');
      values.push(first && first.line ? first.line.slice(0, 128) : null);
    }
    if (hasOperatorCleaningPriceC) {
      columns.push('operator_cleaning_price_myr');
      values.push(first && first.myr != null ? first.myr : null);
    }
    if (hasOperatorCleaningServiceC) {
      columns.push('operator_cleaning_pricing_service');
      values.push(first ? first.service.slice(0, 32) : null);
    }
  } else {
    if (hasOperatorCleaningLineC && input.operatorCleaningPricingLine !== undefined) {
      const s = input.operatorCleaningPricingLine == null ? '' : String(input.operatorCleaningPricingLine).trim();
      columns.push('operator_cleaning_pricing_line');
      values.push(s === '' ? null : s.slice(0, 128));
    }
    if (hasOperatorCleaningPriceC && input.operatorCleaningPriceMyr !== undefined) {
      const n = Number(input.operatorCleaningPriceMyr);
      columns.push('operator_cleaning_price_myr');
      values.push(Number.isFinite(n) && n >= 0 ? n : null);
    }
    if (hasOperatorCleaningServiceC && input.operatorCleaningPricingService !== undefined) {
      const s = input.operatorCleaningPricingService == null ? '' : String(input.operatorCleaningPricingService).trim();
      columns.push('operator_cleaning_pricing_service');
      values.push(s === '' ? null : s.slice(0, 32));
    }
  }

  const placeholders = columns.map(() => '?').join(', ');
  await pool.query(
    `INSERT INTO cln_property (${columns.join(', ')}, created_at, updated_at)
     VALUES (${placeholders}, NOW(3), NOW(3))`,
    values
  );
  if (deferClientBinding && targetClientCd && opId) {
    const plr = require('./cleanlemon-property-link-request.service');
    const req = await plr.createPropertyLinkRequest({
      kind: plr.KIND_OP_CLIENT,
      propertyId: id,
      clientdetailId: targetClientCd,
      operatorId: opId,
      payloadJson: {
        name: String(input.name || ''),
        address: String(input.address || ''),
        unitNumber: String(input.unitNumber || ''),
      },
    });
    return { id, deferClientBinding: true, linkRequestId: req.id };
  }
  return { id };
}

async function listOperatorLookup({ q = '', limit = 30 } = {}) {
  const ct = await getClnCompanyTable();
  const keyword = String(q || '').trim();
  const lim = Math.min(Math.max(Number(limit) || 30, 1), 500);
  const where = keyword
    ? `WHERE id LIKE ? OR name LIKE ? OR email LIKE ?`
    : '';
  const params = keyword
    ? [`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, lim]
    : [lim];
  const [rows] = await pool.query(
    `SELECT id, COALESCE(name, '') AS name, COALESCE(email, '') AS email
     FROM \`${ct}\`
     ${where}
     ORDER BY updated_at DESC
     LIMIT ?`,
    params
  );
  return rows.map((r) => ({
    id: String(r.id || '').trim(),
    name: String(r.name || '').trim(),
    email: String(r.email || '').trim(),
  }));
}

async function updateOperatorProperty(id, input) {
  const pid = String(id || '').trim();
  if (!pid) return;

  /** Remove this operator from the property (clear operator_id). Client-portal-owned rows stay for the client. Operator-owned rows with no B2B client are deleted after unlink. */
  const wantRemoveOperatorLink =
    input.removeOperatorLink === true ||
    input.removeOperatorLink === 'true' ||
    input.removeOperatorLink === 1 ||
    input.operatorUnlinkClientOwnedProperty === true ||
    input.operatorUnlinkClientOwnedProperty === 'true' ||
    input.operatorUnlinkClientOwnedProperty === 1;
  if (wantRemoveOperatorLink) {
    const hasOpColU = await databaseHasColumn('cln_property', 'operator_id');
    const hasPortalOwnedU = await databaseHasColumn('cln_property', 'client_portal_owned');
    const hasClientdetailColU = await databaseHasColumn('cln_property', 'clientdetail_id');
    const hasClientIdColU = await databaseHasColumn('cln_property', 'client_id');
    if (!hasOpColU) return;
    const selU = ['operator_id'];
    if (hasPortalOwnedU) selU.push('client_portal_owned');
    if (hasClientdetailColU) selU.push('clientdetail_id');
    const [[rowU]] = await pool.query(`SELECT ${selU.join(', ')} FROM cln_property WHERE id = ? LIMIT 1`, [pid]);
    if (!rowU) return;
    const portalOwnedU = hasPortalOwnedU && Number(rowU.client_portal_owned) === 1;
    const curOpU = rowU.operator_id != null ? String(rowU.operator_id).trim() : '';
    const reqOpU = String(input.operatorId || input.operator_id || '').trim();
    if (reqOpU && curOpU && reqOpU !== curOpU) {
      const e = new Error('OPERATOR_MISMATCH');
      e.code = 'OPERATOR_MISMATCH';
      throw e;
    }
    if (!curOpU) return;
    const hadClientdetailU =
      hasClientdetailColU &&
      rowU.clientdetail_id != null &&
      String(rowU.clientdetail_id).trim() !== '';

    const cdForSmartDoor = hadClientdetailU ? String(rowU.clientdetail_id).trim() : '';
    try {
      const plrSd = require('./cleanlemon-property-link-request.service');
      if (typeof plrSd.clearClnOperatorFromPropertySmartDoorRows === 'function') {
        await plrSd.clearClnOperatorFromPropertySmartDoorRows(pid, curOpU, cdForSmartDoor);
      }
    } catch (sdErr) {
      console.warn('[cleanlemon] updateOperatorProperty removeOperatorLink smart door clear', sdErr?.message || sdErr);
    }

    if (hasClientIdColU) {
      await pool.query(
        `UPDATE cln_property
         SET operator_id = NULL,
             client_id = IF(client_id <=> ?, NULL, client_id),
             updated_at = NOW(3)
         WHERE id = ? LIMIT 1`,
        [curOpU, pid]
      );
    } else {
      await pool.query('UPDATE cln_property SET operator_id = NULL, updated_at = NOW(3) WHERE id = ? LIMIT 1', [pid]);
    }

    if (!portalOwnedU && !hadClientdetailU) {
      try {
        await pool.query('DELETE FROM cln_property WHERE id = ? LIMIT 1', [pid]);
      } catch (delErr) {
        const e = new Error('PROPERTY_DELETE_BLOCKED');
        e.code = 'PROPERTY_DELETE_BLOCKED';
        e.cause = delErr;
        throw e;
      }
    }
    return;
  }

  const hasClientdetailCol = await databaseHasColumn('cln_property', 'clientdetail_id');
  const hasOpCol = await databaseHasColumn('cln_property', 'operator_id');
  const hasPortalOwned = await databaseHasColumn('cln_property', 'client_portal_owned');
  const [
    hasPremisesTypeCol,
    hasSecuritySystemCol,
    hasSecurityUsernameCol,
    hasAfterPhotoCol,
    hasKeyPhotoCol,
    hasSmartdoorPwdCol,
    hasSmartdoorTokCol,
    hasMailboxPwdCol,
    hasWazeUrlCol,
    hasGoogleMapsUrlCol,
    hasLatCol,
    hasLngCol,
    hasColivingPdCol,
    hasOpPortalArchivedCol,
  ] = await Promise.all([
    databaseHasColumn('cln_property', 'premises_type'),
    databaseHasColumn('cln_property', 'security_system'),
    databaseHasColumn('cln_property', 'security_username'),
    databaseHasColumn('cln_property', 'after_clean_photo_url'),
    databaseHasColumn('cln_property', 'key_photo_url'),
    databaseHasColumn('cln_property', 'smartdoor_password'),
    databaseHasColumn('cln_property', 'smartdoor_token_enabled'),
    databaseHasColumn('cln_property', 'mailbox_password'),
    databaseHasColumn('cln_property', 'waze_url'),
    databaseHasColumn('cln_property', 'google_maps_url'),
    databaseHasColumn('cln_property', 'latitude'),
    databaseHasColumn('cln_property', 'longitude'),
    databaseHasColumn('cln_property', 'coliving_propertydetail_id'),
    databaseHasColumn('cln_property', 'operator_portal_archived'),
  ]);

  const sel = ['id', 'address', 'property_name', 'unit_name', 'client_label', 'team'];
  if (hasWazeUrlCol) sel.push('waze_url');
  if (hasGoogleMapsUrlCol) sel.push('google_maps_url');
  if (hasLatCol) sel.push('latitude');
  if (hasLngCol) sel.push('longitude');
  if (hasClientdetailCol) sel.push('clientdetail_id');
  if (hasPortalOwned) sel.push('client_portal_owned');
  if (hasOpCol) sel.push('operator_id');
  if (hasColivingPdCol) sel.push('coliving_propertydetail_id');
  const [[cur]] = await pool.query(`SELECT ${sel.join(', ')} FROM cln_property WHERE id = ? LIMIT 1`, [pid]);
  if (!cur) return;

  const portalOwned = hasPortalOwned && Number(cur.client_portal_owned) === 1;

  const reqOpNorm = String(input.operatorId || input.operator_id || '').trim();
  if (hasOpCol && cur.operator_id != null && String(cur.operator_id).trim() !== '') {
    const curOp = String(cur.operator_id).trim();
    if (reqOpNorm && curOp && reqOpNorm !== curOp) {
      const e = new Error('OPERATOR_MISMATCH');
      e.code = 'OPERATOR_MISMATCH';
      throw e;
    }
  }

  /** Operator-created row with a bound B2B client: hand "ownership" to client portal (client manages core fields). */
  const wantTransferOwnership =
    input.transferOwnershipToClient === true ||
    input.transferOwnershipToClient === 'true' ||
    input.transferOwnershipToClient === 1;
  if (wantTransferOwnership) {
    if (portalOwned) {
      const e = new Error('ALREADY_CLIENT_OWNED');
      e.code = 'ALREADY_CLIENT_OWNED';
      throw e;
    }
    if (!hasPortalOwned) {
      const e = new Error('UNSUPPORTED');
      e.code = 'UNSUPPORTED';
      throw e;
    }
    const bound =
      hasClientdetailCol &&
      cur.clientdetail_id != null &&
      String(cur.clientdetail_id).trim() !== '';
    if (!bound) {
      const e = new Error('TRANSFER_REQUIRES_BOUND_CLIENT');
      e.code = 'TRANSFER_REQUIRES_BOUND_CLIENT';
      throw e;
    }
    const archFragment = hasOpPortalArchivedCol ? ', operator_portal_archived = 0' : '';
    await pool.query(
      `UPDATE cln_property SET client_portal_owned = 1${archFragment}, updated_at = NOW(3) WHERE id = ? LIMIT 1`,
      [pid]
    );
    return;
  }

  /** Client-created (`client_portal_owned=1`): operator may update service fields but not door / access credentials (client-only). */

  const definedInputKeys = Object.keys(input || {}).filter((k) => input[k] !== undefined);
  const nonOperatorKeys = definedInputKeys.filter((k) => k !== 'operatorId' && k !== 'operator_id');
  const onlyOperatorPortalArchive =
    nonOperatorKeys.length > 0 &&
    nonOperatorKeys.every((k) => k === 'operatorPortalArchived' || k === 'operator_portal_archived');
  if (onlyOperatorPortalArchive) {
    if (!hasOpPortalArchivedCol) {
      const e = new Error('UNSUPPORTED');
      e.code = 'UNSUPPORTED';
      throw e;
    }
    const raw =
      input.operatorPortalArchived !== undefined ? input.operatorPortalArchived : input.operator_portal_archived;
    const en = raw === true || raw === 1 || raw === '1' || raw === 'true';
    await pool.query(
      'UPDATE cln_property SET operator_portal_archived = ?, updated_at = NOW(3) WHERE id = ? LIMIT 1',
      [en ? 1 : 0, pid]
    );
    return;
  }

  let nextClientdetail = null;
  if (hasClientdetailCol) {
    nextClientdetail =
      cur.clientdetail_id != null && String(cur.clientdetail_id).trim() !== ''
        ? String(cur.clientdetail_id).trim()
        : null;
    if (!portalOwned) {
      if (input.clearClientdetail === true) {
        nextClientdetail = null;
      } else if (
        input.clientdetailId !== undefined ||
        input.clientdetail_id !== undefined ||
        input.clientId !== undefined
      ) {
        const raw =
          input.clientdetailId !== undefined
            ? input.clientdetailId
            : input.clientdetail_id !== undefined
              ? input.clientdetail_id
              : input.clientId;
        nextClientdetail = raw == null || raw === '' ? null : String(raw).trim() || null;
      }
    }
  }

  const opIdAssert = hasOpCol && cur.operator_id ? String(cur.operator_id).trim() : '';
  const prevClientdetail =
    hasClientdetailCol && cur.clientdetail_id != null && String(cur.clientdetail_id).trim() !== ''
      ? String(cur.clientdetail_id).trim()
      : null;
  const deferClientBinding = input.deferClientBinding === true || input.deferClientBinding === 'true';
  const pendingClientBind =
    deferClientBinding &&
    hasClientdetailCol &&
    !portalOwned &&
    nextClientdetail &&
    nextClientdetail !== prevClientdetail;
  if (hasClientdetailCol && nextClientdetail && opIdAssert && nextClientdetail !== prevClientdetail && !deferClientBinding) {
    await assertClientdetailLinkedToOperator(opIdAssert, nextClientdetail);
  }
  if (pendingClientBind) {
    await assertClientdetailLinkedToOperator(opIdAssert, nextClientdetail);
  }
  const clientdetailForUpdate = pendingClientBind ? prevClientdetail : nextClientdetail;

  /** Partial PATCH: only overwrite columns the client sent (omit key = leave DB value). Previously missing keys became '' and wiped e.g. unit_name on bulk pricing updates. */
  const sets = [];
  const vals = [];
  if (input.name !== undefined) {
    const nm = String(input.name ?? '').trim();
    /** Never persist the row's primary key as `property_name` (bulk/UI mix-ups wrote UUIDs into the name column). */
    if (nm !== pid) {
      sets.push('property_name = ?');
      vals.push(nm);
    }
  }
  if (input.address !== undefined) {
    sets.push('address = ?');
    vals.push(String(input.address ?? '').trim());
  }
  if (input.unitNumber !== undefined || input.unit_name !== undefined) {
    sets.push('unit_name = ?');
    const u = input.unitNumber !== undefined ? input.unitNumber : input.unit_name;
    vals.push(u == null ? '' : String(u).trim());
  }
  if (input.client !== undefined) {
    sets.push('client_label = ?');
    vals.push(String(input.client ?? '').trim());
  }
  if (input.teamId !== undefined) {
    const tid = String(input.teamId ?? '').trim();
    const name = tid ? await getOperatorTeamNameById(tid) : '';
    sets.push('team = ?');
    vals.push(name != null && String(name).trim() !== '' ? String(name).trim() : '');
  } else if (input.team !== undefined) {
    sets.push('team = ?');
    vals.push(String(input.team ?? '').trim());
  }

  if (hasClientdetailCol) {
    /* NULLIF: never write '' — FK to cln_clientdetail rejects empty string; some clients send "". */
    sets.push("clientdetail_id = NULLIF(TRIM(?), '')");
    const cdRaw =
      clientdetailForUpdate == null || String(clientdetailForUpdate).trim() === ''
        ? null
        : String(clientdetailForUpdate).trim();
    vals.push(cdRaw);
  }

  if (hasPremisesTypeCol && input.premisesType !== undefined) {
    const pt = String(input.premisesType ?? input.siteKind ?? '').trim().toLowerCase();
    sets.push('premises_type = ?');
    vals.push(pt === '' ? null : pt);
  } else if (hasPremisesTypeCol && input.siteKind !== undefined) {
    const pt = String(input.siteKind ?? '').trim().toLowerCase();
    sets.push('premises_type = ?');
    vals.push(pt === '' ? null : pt);
  }

  if (!portalOwned && hasSecuritySystemCol && input.securitySystem !== undefined) {
    sets.push('security_system = ?');
    vals.push(String(input.securitySystem ?? '').trim() || null);
  }

  if (!portalOwned && hasSecurityUsernameCol && input.securityUsername !== undefined) {
    sets.push('security_username = ?');
    vals.push(String(input.securityUsername ?? '').trim() || null);
  }

  if (!portalOwned && hasMailboxPwdCol && input.mailboxPassword !== undefined) {
    sets.push('mailbox_password = ?');
    vals.push(String(input.mailboxPassword ?? '').trim() || null);
  }

  if (!portalOwned && hasSmartdoorPwdCol && input.smartdoorPassword !== undefined) {
    sets.push('smartdoor_password = ?');
    vals.push(String(input.smartdoorPassword ?? '').trim() || null);
  }

  if (!portalOwned && hasSmartdoorTokCol && input.smartdoorTokenEnabled !== undefined) {
    const en = input.smartdoorTokenEnabled === true || input.smartdoorTokenEnabled === 1 || input.smartdoorTokenEnabled === '1';
    sets.push('smartdoor_token_enabled = ?');
    vals.push(en ? 1 : 0);
  } else if (!portalOwned && hasSmartdoorTokCol && input.smartdoorToken !== undefined) {
    const en = input.smartdoorToken === '1' || input.smartdoorToken === 1;
    sets.push('smartdoor_token_enabled = ?');
    vals.push(en ? 1 : 0);
  }

  if (hasAfterPhotoCol && (input.afterCleanPhotoUrl !== undefined || input.afterCleanPhoto !== undefined)) {
    sets.push('after_clean_photo_url = ?');
    vals.push(
      clnSanitizePersistableUrl(input.afterCleanPhotoUrl ?? input.after_clean_photo_url ?? input.afterCleanPhoto)
    );
  }

  if (hasKeyPhotoCol && (input.keyPhotoUrl !== undefined || input.keyPhoto !== undefined)) {
    sets.push('key_photo_url = ?');
    vals.push(clnSanitizePersistableUrl(input.keyPhotoUrl ?? input.key_photo_url ?? input.keyPhoto));
  }

  const hasOperatorDoorModeU = await databaseHasColumn('cln_property', 'operator_door_access_mode');
  if (!portalOwned && hasOperatorDoorModeU && input.operatorDoorAccessMode !== undefined) {
    const raw = String(input.operatorDoorAccessMode ?? '').trim().toLowerCase();
    const allowed = ['full_access', 'temporary_password_only', 'working_date_only', 'fixed_password'];
    if (raw && !allowed.includes(raw)) {
      const e = new Error('INVALID_OPERATOR_DOOR_ACCESS_MODE');
      e.code = 'INVALID_OPERATOR_DOOR_ACCESS_MODE';
      throw e;
    }
    const m = raw || 'temporary_password_only';
    if (m === 'full_access' || m === 'working_date_only' || m === 'temporary_password_only') {
      const okGw = await clnPropertyHasRemoteGatewayReady(pid);
      if (!okGw) {
        const e = new Error('OPERATOR_DOOR_GATEWAY_REQUIRED');
        e.code = 'OPERATOR_DOOR_GATEWAY_REQUIRED';
        throw e;
      }
    }
    sets.push('operator_door_access_mode = ?');
    vals.push(m);
  }

  const hasOperatorCleaningLineU = await databaseHasColumn('cln_property', 'operator_cleaning_pricing_line');
  const hasOperatorCleaningPriceU = await databaseHasColumn('cln_property', 'operator_cleaning_price_myr');
  const hasOperatorCleaningServiceU = await databaseHasColumn('cln_property', 'operator_cleaning_pricing_service');
  const hasOperatorCleaningRowsJsonU = await databaseHasColumn('cln_property', 'operator_cleaning_pricing_rows_json');
  const wantsCleaningRowsU =
    hasOperatorCleaningRowsJsonU &&
    (input.operatorCleaningPricingRows !== undefined || input.operator_cleaning_pricing_rows !== undefined);
  const cleaningRowsInU = input.operatorCleaningPricingRows ?? input.operator_cleaning_pricing_rows;
  if (wantsCleaningRowsU) {
    const normalized = normalizeOperatorCleaningPricingRowsInput(Array.isArray(cleaningRowsInU) ? cleaningRowsInU : []);
    sets.push('operator_cleaning_pricing_rows_json = ?');
    vals.push(normalized.length ? JSON.stringify(normalized) : null);
    const first = normalized[0];
    if (hasOperatorCleaningLineU) {
      sets.push('operator_cleaning_pricing_line = ?');
      vals.push(first && first.line ? first.line.slice(0, 128) : null);
    }
    if (hasOperatorCleaningPriceU) {
      sets.push('operator_cleaning_price_myr = ?');
      vals.push(first && first.myr != null ? first.myr : null);
    }
    if (hasOperatorCleaningServiceU) {
      sets.push('operator_cleaning_pricing_service = ?');
      vals.push(first ? first.service.slice(0, 32) : null);
    }
  } else {
    if (hasOperatorCleaningLineU && input.operatorCleaningPricingLine !== undefined) {
      const s = input.operatorCleaningPricingLine == null ? '' : String(input.operatorCleaningPricingLine).trim();
      sets.push('operator_cleaning_pricing_line = ?');
      vals.push(s === '' ? null : s.slice(0, 128));
    }
    if (hasOperatorCleaningPriceU && input.operatorCleaningPriceMyr !== undefined) {
      const n = Number(input.operatorCleaningPriceMyr);
      sets.push('operator_cleaning_price_myr = ?');
      vals.push(Number.isFinite(n) && n >= 0 ? n : null);
    }
    if (hasOperatorCleaningServiceU && input.operatorCleaningPricingService !== undefined) {
      const s = input.operatorCleaningPricingService == null ? '' : String(input.operatorCleaningPricingService).trim();
      sets.push('operator_cleaning_pricing_service = ?');
      vals.push(s === '' ? null : s.slice(0, 32));
    }
  }

  if (hasWazeUrlCol || hasGoogleMapsUrlCol) {
    const nextAddrForNav =
      input.address !== undefined ? String(input.address ?? '') : String(cur.address ?? '');
    const nav = resolveClnPropertyNavigationUrls({
      nextAddressRaw: nextAddrForNav,
      prevAddress: String(cur.address ?? ''),
      prevWaze: hasWazeUrlCol ? String(cur.waze_url ?? '') : '',
      prevGoogle: hasGoogleMapsUrlCol ? String(cur.google_maps_url ?? '') : '',
      explicitWaze: input.wazeUrl !== undefined || input.waze_url !== undefined,
      explicitGoogle: input.googleMapsUrl !== undefined || input.google_maps_url !== undefined,
      inputWazeVal: input.wazeUrl ?? input.waze_url,
      inputGoogleVal: input.googleMapsUrl ?? input.google_maps_url,
    });
    if (hasWazeUrlCol) {
      sets.push('waze_url = ?');
      vals.push(nav.wazeUrl);
    }
    if (hasGoogleMapsUrlCol) {
      sets.push('google_maps_url = ?');
      vals.push(nav.googleMapsUrl);
    }
  }

  if (hasLatCol || hasLngCol) {
    const latIn =
      input.latitude !== undefined ? input.latitude : input.lat !== undefined ? input.lat : undefined;
    const lngIn =
      input.longitude !== undefined
        ? input.longitude
        : input.lng !== undefined
          ? input.lng
          : input.lon !== undefined
            ? input.lon
            : undefined;
    if (latIn !== undefined || lngIn !== undefined) {
      const geoUp = parseClnOptionalLatLng(
        latIn !== undefined ? latIn : cur.latitude,
        lngIn !== undefined ? lngIn : cur.longitude
      );
      if (hasLatCol) {
        sets.push('latitude = ?');
        vals.push(geoUp.lat);
      }
      if (hasLngCol) {
        sets.push('longitude = ?');
        vals.push(geoUp.lng);
      }
    }
  }

  if (hasOpPortalArchivedCol && (input.operatorPortalArchived !== undefined || input.operator_portal_archived !== undefined)) {
    const raw =
      input.operatorPortalArchived !== undefined ? input.operatorPortalArchived : input.operator_portal_archived;
    const en = raw === true || raw === 1 || raw === '1' || raw === 'true';
    sets.push('operator_portal_archived = ?');
    vals.push(en ? 1 : 0);
  }

  const toNullableIntUp = (v) => {
    const s = String(v ?? '').trim();
    if (!s) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.floor(n));
  };
  const [
    hasBedCountU,
    hasRoomCountU,
    hasBathroomCountU,
    hasKitchenU,
    hasLivingRoomU,
    hasBalconyU,
    hasStaircaseU,
    hasLiftLevelU,
    hasSpecialAreaCountU,
  ] = await Promise.all([
    databaseHasColumn('cln_property', 'bed_count'),
    databaseHasColumn('cln_property', 'room_count'),
    databaseHasColumn('cln_property', 'bathroom_count'),
    databaseHasColumn('cln_property', 'kitchen'),
    databaseHasColumn('cln_property', 'living_room'),
    databaseHasColumn('cln_property', 'balcony'),
    databaseHasColumn('cln_property', 'staircase'),
    databaseHasColumn('cln_property', 'lift_level'),
    databaseHasColumn('cln_property', 'special_area_count'),
  ]);
  if (hasBedCountU && (input.bedCount !== undefined || input.bed_count !== undefined)) {
    sets.push('bed_count = ?');
    vals.push(toNullableIntUp(input.bedCount !== undefined ? input.bedCount : input.bed_count));
  }
  if (hasRoomCountU && (input.roomCount !== undefined || input.room_count !== undefined)) {
    sets.push('room_count = ?');
    vals.push(toNullableIntUp(input.roomCount !== undefined ? input.roomCount : input.room_count));
  }
  if (hasBathroomCountU && (input.bathroomCount !== undefined || input.bathroom_count !== undefined)) {
    sets.push('bathroom_count = ?');
    vals.push(toNullableIntUp(input.bathroomCount !== undefined ? input.bathroomCount : input.bathroom_count));
  }
  if (hasKitchenU && input.kitchen !== undefined) {
    sets.push('kitchen = ?');
    vals.push(toNullableIntUp(input.kitchen));
  }
  if (hasLivingRoomU && (input.livingRoom !== undefined || input.living_room !== undefined)) {
    sets.push('living_room = ?');
    vals.push(toNullableIntUp(input.livingRoom !== undefined ? input.livingRoom : input.living_room));
  }
  if (hasBalconyU && input.balcony !== undefined) {
    sets.push('balcony = ?');
    vals.push(toNullableIntUp(input.balcony));
  }
  if (hasStaircaseU && (input.staircase !== undefined || input.stairCase !== undefined)) {
    sets.push('staircase = ?');
    vals.push(toNullableIntUp(input.staircase !== undefined ? input.staircase : input.stairCase));
  }
  if (hasLiftLevelU && (input.liftLevel !== undefined || input.lift_level !== undefined)) {
    const ll = String(input.liftLevel ?? input.lift_level ?? '').trim().toLowerCase();
    const liftLevel = ['slow', 'medium', 'fast'].includes(ll) ? ll : null;
    sets.push('lift_level = ?');
    vals.push(liftLevel);
  }
  if (hasSpecialAreaCountU && (input.specialAreaCount !== undefined || input.special_area_count !== undefined)) {
    sets.push('special_area_count = ?');
    vals.push(
      toNullableIntUp(
        input.specialAreaCount !== undefined ? input.specialAreaCount : input.special_area_count
      )
    );
  }

  const hasMinValueU = await databaseHasColumn('cln_property', 'min_value');
  if (
    hasMinValueU &&
    (input.estimatedTime !== undefined || input.minValue !== undefined || input.min_value !== undefined)
  ) {
    let mv = null;
    if (input.minValue !== undefined || input.min_value !== undefined) {
      mv = toNullableIntUp(input.minValue !== undefined ? input.minValue : input.min_value);
    } else {
      mv = parseClnEstimateTimeInputToMinutes(input.estimatedTime);
    }
    sets.push('min_value = ?');
    vals.push(mv);
  }

  if (sets.length === 0) {
    await pool.query('UPDATE cln_property SET updated_at = NOW(3) WHERE id = ? LIMIT 1', [pid]);
  } else {
    vals.push(pid);
    await pool.query(`UPDATE cln_property SET ${sets.join(', ')}, updated_at = NOW(3) WHERE id = ?`, vals);
  }

  try {
    await syncClnPropertyLegacyClientIdColumn(pid);
  } catch (e) {
    console.warn('[cleanlemon] syncClnPropertyLegacyClientIdColumn', pid, e?.message || e);
  }

  const colivingPdIdForCred =
    hasColivingPdCol &&
    cur.coliving_propertydetail_id != null &&
    String(cur.coliving_propertydetail_id).trim() !== ''
      ? String(cur.coliving_propertydetail_id).trim()
      : '';
  if (!portalOwned && colivingPdIdForCred && input.securitySystemCredentials !== undefined) {
    const credCol = await databaseHasColumn('propertydetail', 'security_system_credentials_json');
    if (credCol) {
      const rawCred = input.securitySystemCredentials;
      const val =
        rawCred == null || rawCred === ''
          ? null
          : typeof rawCred === 'string'
            ? rawCred
            : JSON.stringify(rawCred);
      await pool.query('UPDATE propertydetail SET security_system_credentials_json = ? WHERE id = ?', [
        val,
        colivingPdIdForCred,
      ]);
    }
  }

  if (pendingClientBind && opIdAssert) {
    const plr = require('./cleanlemon-property-link-request.service');
    await plr.createPropertyLinkRequest({
      kind: plr.KIND_OP_CLIENT,
      propertyId: pid,
      clientdetailId: nextClientdetail,
      operatorId: opIdAssert,
      payloadJson: {
        name: input.name !== undefined ? String(input.name || '') : String(cur.property_name || ''),
        address: input.address !== undefined ? String(input.address || '') : String(cur.address || ''),
        unitNumber:
          input.unitNumber !== undefined || input.unit_name !== undefined
            ? String((input.unitNumber !== undefined ? input.unitNumber : input.unit_name) || '')
            : String(cur.unit_name || ''),
      },
    });
  }
}

async function deleteOperatorProperty(id, input = {}) {
  const pid = String(id || '').trim();
  if (!pid) return;

  const hasOpCol = await databaseHasColumn('cln_property', 'operator_id');
  const hasClientdetailCol = await databaseHasColumn('cln_property', 'clientdetail_id');
  const hasPortalOwnedDel = await databaseHasColumn('cln_property', 'client_portal_owned');
  const hasOpPortalArchivedDel = await databaseHasColumn('cln_property', 'operator_portal_archived');
  const sel = ['id'];
  if (hasOpCol) sel.push('operator_id');
  if (hasClientdetailCol) sel.push('clientdetail_id');
  if (hasPortalOwnedDel) sel.push('client_portal_owned');
  if (hasOpPortalArchivedDel) sel.push('COALESCE(operator_portal_archived, 0) AS operator_portal_archived');
  const [[row]] = await pool.query(`SELECT ${sel.join(', ')} FROM cln_property WHERE id = ? LIMIT 1`, [pid]);

  if (row && hasPortalOwnedDel && Number(row.client_portal_owned) === 1) {
    const e = new Error('CLIENT_PORTAL_OWNED');
    e.code = 'CLIENT_PORTAL_OWNED';
    throw e;
  }

  /** Operator-created rows: only allow hard delete after operator portal archive (inactive). */
  if (
    row &&
    hasOpPortalArchivedDel &&
    !(hasPortalOwnedDel && Number(row.client_portal_owned) === 1) &&
    Number(row.operator_portal_archived) !== 1
  ) {
    const e = new Error('PROPERTY_NOT_ARCHIVED');
    e.code = 'PROPERTY_NOT_ARCHIVED';
    throw e;
  }

  if (row && hasOpCol) {
    const curOp = row.operator_id != null ? String(row.operator_id).trim() : '';
    const reqOp = String(input.operatorId || input.operator_id || '').trim();
    if (reqOp && curOp && reqOp !== curOp) {
      const e = new Error('OPERATOR_MISMATCH');
      e.code = 'OPERATOR_MISMATCH';
      throw e;
    }
    if (curOp) {
      const hadClientdetail =
        hasClientdetailCol &&
        row.clientdetail_id != null &&
        String(row.clientdetail_id).trim() !== '';
      const cdForSmartDoor = hadClientdetail ? String(row.clientdetail_id).trim() : '';
      try {
        const plrSd = require('./cleanlemon-property-link-request.service');
        if (typeof plrSd.clearClnOperatorFromPropertySmartDoorRows === 'function') {
          await plrSd.clearClnOperatorFromPropertySmartDoorRows(pid, curOp, cdForSmartDoor);
        }
      } catch (sdErr) {
        console.warn('[cleanlemon] deleteOperatorProperty smart door clear', sdErr?.message || sdErr);
      }
    }
  }

  await pool.query('DELETE FROM cln_property WHERE id = ? LIMIT 1', [pid]);
}

/**
 * When `invoicePaymentDuePolicy` is absent from settings_json, default matches legacy 14-day SQL.
 * When present: mode `none` = no auto-overdue; mode `days` = N calendar days from issue (UTC date).
 */
function getInvoicePaymentDuePolicyFromSettings(settings) {
  const raw = settings && typeof settings === 'object' ? settings.invoicePaymentDuePolicy : undefined;
  if (raw == null || typeof raw !== 'object') {
    return { mode: 'days', days: 14 };
  }
  const mode = String(raw.mode || '').toLowerCase() === 'none' ? 'none' : 'days';
  let days = Math.floor(Number(raw.days));
  if (!Number.isFinite(days) || days < 1) days = 14;
  if (days > 365) days = 365;
  return mode === 'none' ? { mode: 'none', days: 14 } : { mode: 'days', days };
}

function utcYmdAddDays(issueYmd, days) {
  const s = String(issueYmd || '').slice(0, 10);
  const [y, mo, d] = s.split('-').map((x) => parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return s;
  const t = Date.UTC(y, mo - 1, d) + Number(days) * 864e5;
  return new Date(t).toISOString().slice(0, 10);
}

function utcTodayYmd() {
  return new Date().toISOString().slice(0, 10);
}

async function getOperatorSettingsJsonMapForOperatorIds(operatorIds) {
  const ids = [...new Set((operatorIds || []).map((x) => String(x).trim()).filter(Boolean))];
  const map = new Map();
  if (!ids.length) return map;
  await ensureOperatorSettingsTable();
  const ph = ids.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT operator_id, settings_json FROM cln_operator_settings WHERE operator_id IN (${ph})`,
    ids
  );
  for (const r of rows || []) {
    let base = {};
    try {
      base = JSON.parse(r.settings_json) || {};
    } catch {
      base = {};
    }
    map.set(String(r.operator_id), base);
  }
  return map;
}

function enrichInvoiceRowStatusAndDue(row, settingsMap) {
  const issueYmd = String(row.issueDate || '').slice(0, 10);
  const paid = Number(row.paymentReceived || 0) === 1;
  const oid = String(row.operatorId || '').trim();
  const settings = oid && settingsMap.has(oid) ? settingsMap.get(oid) : {};
  const policy = getInvoicePaymentDuePolicyFromSettings(settings);
  const storedDueRaw = row.dueDateFromDb != null ? String(row.dueDateFromDb).trim() : '';
  const storedDue = /^\d{4}-\d{2}-\d{2}$/.test(storedDueRaw) ? storedDueRaw.slice(0, 10) : '';
  let dueYmd = null;
  if (storedDue) {
    dueYmd = storedDue;
  } else if (policy.mode === 'days' && issueYmd) {
    dueYmd = utcYmdAddDays(issueYmd, policy.days);
  }
  if (paid) {
    return { ...row, status: 'paid', dueDate: dueYmd };
  }
  if (policy.mode === 'none') {
    return { ...row, status: 'pending', dueDate: null };
  }
  const today = utcTodayYmd();
  const overdue = dueYmd && dueYmd < today;
  return { ...row, status: overdue ? 'overdue' : 'pending', dueDate: dueYmd };
}

async function listOperatorInvoices({ limit = 300, operatorId } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 300, 1), 1000);
  const scopeOpId = String(operatorId || '').trim();
  const ct = await getClnCompanyTable();
  const hasPaymentReceivedCol = await databaseHasColumn('cln_client_invoice', 'payment_received');
  const hasTransactionIdCol = await databaseHasColumn('cln_client_invoice', 'transaction_id');
  const hasOpCol = await databaseHasColumn('cln_client_invoice', 'operator_id');
  const hasIssueDateCol = await databaseHasColumn('cln_client_invoice', 'issue_date');
  const hasDueDateCol = await databaseHasColumn('cln_client_invoice', 'due_date');
  const [[payTableRow]] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'cln_client_payment'`
  );
  const hasClientPaymentTable = Number(payTableRow?.n || 0) > 0;
  const paymentStatusExpr = hasPaymentReceivedCol ? 'COALESCE(i.payment_received, 0)' : '0';
  const accountingInvoiceExpr = hasTransactionIdCol
    ? "NULLIF(TRIM(COALESCE(i.transaction_id, '')), '')"
    : 'NULL';
  const paidDateExpr = hasClientPaymentTable
    ? "DATE_FORMAT(COALESCE(p.payment_date, NULL), '%Y-%m-%d')"
    : 'NULL';
  const paymentJoin = hasClientPaymentTable
    ? `LEFT JOIN (
      SELECT invoice_id, MAX(payment_date) AS payment_date
      FROM cln_client_payment
      GROUP BY invoice_id
    ) p ON p.invoice_id = i.id`
    : '';
  const hasPdfUrlCol = await databaseHasColumn('cln_client_invoice', 'pdf_url');
  const pdfUrlExpr = hasPdfUrlCol ? "NULLIF(TRIM(COALESCE(i.pdf_url, '')), '')" : 'NULL';
  const hasAccountingMetaCol = await databaseHasColumn('cln_client_invoice', 'accounting_meta_json');
  const accountingMetaJsonExpr = hasAccountingMetaCol
    ? 'i.accounting_meta_json AS accountingMetaJson'
    : 'NULL AS accountingMetaJson';
  const hasReceiptUrlCol =
    hasClientPaymentTable && (await databaseHasColumn('cln_client_payment', 'receipt_url'));
  const receiptUrlExpr = hasReceiptUrlCol
    ? `(SELECT NULLIF(TRIM(COALESCE(receipt_url, '')), '') FROM cln_client_payment WHERE invoice_id = i.id ORDER BY payment_date DESC LIMIT 1)`
    : 'NULL';
  const opSelect = hasOpCol
    ? `COALESCE(NULLIF(TRIM(i.operator_id), ''), '') AS operatorId`
    : `'' AS operatorId`;
  const issueDateSql = hasIssueDateCol
    ? `DATE_FORMAT(COALESCE(i.issue_date, DATE(i.created_at)), '%Y-%m-%d')`
    : `DATE_FORMAT(COALESCE(i.created_at, NOW()), '%Y-%m-%d')`;
  const dueDateFromDbSql = hasDueDateCol ? `DATE_FORMAT(i.due_date, '%Y-%m-%d')` : `NULL`;
  const opScopeSql = hasOpCol && scopeOpId ? ' AND i.operator_id = ? ' : '';
  const listParams = hasOpCol && scopeOpId ? [scopeOpId, lim] : [lim];
  const [rows] = await pool.query(
    `SELECT
      i.id,
      COALESCE(i.invoice_number, i.id) AS invoiceNo,
      i.client_id AS clientId,
      COALESCE(
        NULLIF(TRIM(cd.fullname), ''),
        NULLIF(TRIM(cd.email), ''),
        NULLIF(TRIM(c.name), ''),
        ''
      ) AS client,
      COALESCE(NULLIF(TRIM(cd.email), ''), NULLIF(TRIM(c.email), ''), '') AS clientEmail,
      COALESCE(i.description, '') AS description,
      COALESCE(i.amount, 0) AS amount,
      0 AS tax,
      COALESCE(i.amount, 0) AS total,
      CASE WHEN ${paymentStatusExpr} = 1 THEN 1 ELSE 0 END AS paymentReceived,
      ${issueDateSql} AS issueDate,
      ${dueDateFromDbSql} AS dueDateFromDb,
      ${paidDateExpr} AS paidDate,
      ${accountingInvoiceExpr} AS accountingInvoiceId,
      ${pdfUrlExpr} AS pdfUrl,
      ${receiptUrlExpr} AS receiptUrl,
      ${accountingMetaJsonExpr},
      ${opSelect}
     FROM cln_client_invoice i
     LEFT JOIN cln_clientdetail cd ON cd.id = i.client_id
     LEFT JOIN \`${ct}\` c ON c.id = i.client_id
     ${paymentJoin}
     WHERE 1=1
     ${opScopeSql}
     ORDER BY i.created_at DESC
     LIMIT ?`,
    listParams
  );
  const raw = rows || [];
  const opIds = raw.map((r) => String(r.operatorId || '').trim()).filter(Boolean);
  const settingsMap = await getOperatorSettingsJsonMapForOperatorIds(opIds);
  return raw.map((r) => {
    let accountingMeta = null;
    if (r.accountingMetaJson != null && String(r.accountingMetaJson).trim() !== '') {
      try {
        accountingMeta = JSON.parse(String(r.accountingMetaJson));
      } catch {
        accountingMeta = null;
      }
    }
    const enriched = enrichInvoiceRowStatusAndDue(
      {
        issueDate: r.issueDate,
        dueDateFromDb: r.dueDateFromDb,
        paymentReceived: r.paymentReceived,
        operatorId: r.operatorId
      },
      settingsMap
    );
    const { status, dueDate } = enriched;
    return {
      id: r.id,
      invoiceNo: r.invoiceNo,
      clientId: r.clientId,
      client: r.client,
      clientEmail: r.clientEmail,
      description: r.description,
      amount: r.amount,
      tax: r.tax,
      total: r.total,
      status,
      issueDate: r.issueDate,
      dueDate: dueDate || '',
      paidDate: r.paidDate,
      accountingInvoiceId: r.accountingInvoiceId,
      pdfUrl: r.pdfUrl,
      receiptUrl: r.receiptUrl,
      accountingMeta
    };
  });
}

/** Operators linked to this B2B client (for portal invoice filter). */
async function listLinkedOperatorsForClientPortal(clientdetailId) {
  const cid = String(clientdetailId || '').trim();
  if (!cid) return [];
  const odTable = await resolveClnOperatordetailTable();
  try {
    const [rows] = await pool.query(
      `SELECT j.operator_id AS id,
              TRIM(COALESCE(NULLIF(od.name, ''), NULLIF(od.email, ''), j.operator_id)) AS name
       FROM cln_client_operator j
       INNER JOIN \`${odTable}\` od ON od.id = j.operator_id
       WHERE j.clientdetail_id = ?
       ORDER BY name ASC`,
      [cid]
    );
    return (rows || []).map((r) => ({ id: String(r.id), name: String(r.name || r.id) }));
  } catch (e) {
    console.warn('[cleanlemon] listLinkedOperatorsForClientPortal', e?.message || e);
    return [];
  }
}

/**
 * Grantees may have no `cln_client_operator` rows while invoices still carry `operator_id` — merge those
 * operators into the portal list so filters / display names resolve.
 */
async function mergePortalInvoiceOperatorsIntoLinkedList(linkedOperators, items) {
  const byId = new Map(
    (linkedOperators || []).map((o) => {
      const id = String(o.id || '').trim();
      return [id, { id, name: String(o.name || id).trim() || id }];
    })
  );
  const need = new Set();
  for (const it of items || []) {
    const id = String(it.operatorId || '').trim();
    if (id && !byId.has(id)) need.add(id);
  }
  if (!need.size) return Array.from(byId.values());
  const odTable = await resolveClnOperatordetailTable();
  const ids = [...need];
  const ph = ids.map(() => '?').join(',');
  try {
    const [rows] = await pool.query(
      `SELECT id,
         TRIM(COALESCE(NULLIF(name, ''), NULLIF(email, ''), id)) AS displayName
       FROM \`${odTable}\` WHERE id IN (${ph})`,
      ids
    );
    for (const r of rows || []) {
      const id = String(r.id || '').trim();
      if (!id) continue;
      const name = String(r.displayName || id).trim() || id;
      byId.set(id, { id, name });
    }
  } catch (e) {
    console.warn('[cleanlemon] mergePortalInvoiceOperatorsIntoLinkedList', e?.message || e);
    for (const id of ids) {
      if (!byId.has(id)) byId.set(id, { id, name: id });
    }
  }
  return Array.from(byId.values()).sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/**
 * SQL fragment + params: invoices the portal viewer may see (own + property-group shared billing).
 * @param {string} alias Table alias (e.g. i)
 */
async function buildClientPortalInvoiceAccessWhere(alias, viewerClientdetailId) {
  const cid = String(viewerClientdetailId || '').trim();
  const a = String(alias || 'i').trim() || 'i';
  const hasGroupTables =
    (await databaseHasTable('cln_property_group_member')) && (await databaseHasTable('cln_property_group'));
  const hasOpCol = await databaseHasColumn('cln_client_invoice', 'operator_id');
  const params = [cid];
  let sql = `(${a}.client_id = ?`;
  if (hasGroupTables) {
    sql += ` OR (
      ${a}.client_id IN (
        SELECT g.owner_clientdetail_id
        FROM cln_property_group_member m
        INNER JOIN cln_property_group g ON g.id = m.group_id
        WHERE m.grantee_clientdetail_id = ?
          AND m.invite_status = 'active'
          AND g.owner_clientdetail_id IS NOT NULL
      )`;
    params.push(cid);
    if (hasOpCol) {
      sql += ` AND (
        COALESCE(NULLIF(TRIM(${a}.operator_id), ''), '') = '' OR EXISTS (
          SELECT 1 FROM cln_client_operator j
          WHERE j.clientdetail_id = ? AND j.operator_id = ${a}.operator_id
        )
      )`;
      params.push(cid);
    }
    sql += ')';
  }
  sql += ')';
  return { sql, params };
}

function parseClientPortalInvoiceReceiptsJson(raw) {
  if (raw == null || raw === '') return [];
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(v)) return [];
    return v
      .map((x) => ({
        receiptUrl: x && x.receiptUrl != null ? String(x.receiptUrl).trim() : '',
        paymentDate: x && x.paymentDate != null ? String(x.paymentDate).trim() : '',
        receiptNumber: x && x.receiptNumber != null ? String(x.receiptNumber).trim() : '',
        transactionId: x && x.transactionId != null ? String(x.transactionId).trim() : '',
        amount: x && x.amount != null && Number.isFinite(Number(x.amount)) ? Number(x.amount) : null,
        isPortalProof:
          x && (x.isPortalProof === true || x.isPortalProof === 1 || x.isPortalProof === '1' || x.isPortalProof === 'true'),
      }))
      .filter((x) => x.receiptUrl && /^https?:\/\//i.test(x.receiptUrl));
  } catch (_) {
    return [];
  }
}

/**
 * B2B client portal — invoices where `cln_client_invoice.client_id` is the portal `cln_clientdetail.id`
 * (same id used in operator invoice client picker after merge).
 */
async function listClientPortalInvoices({ clientdetailId, filterOperatorId, limit = 500 } = {}) {
  const cid = String(clientdetailId || '').trim();
  if (!cid) return { items: [], operators: [] };
  const operators = await listLinkedOperatorsForClientPortal(cid);
  const hasOpCol = await databaseHasColumn('cln_client_invoice', 'operator_id');
  const fop = String(filterOperatorId || '').trim();
  const lim = Math.min(Math.max(Number(limit) || 500, 1), 1000);
  const hasPaymentReceivedCol = await databaseHasColumn('cln_client_invoice', 'payment_received');
  const hasTransactionIdCol = await databaseHasColumn('cln_client_invoice', 'transaction_id');
  const hasIssueDateCol = await databaseHasColumn('cln_client_invoice', 'issue_date');
  const hasDueDateCol = await databaseHasColumn('cln_client_invoice', 'due_date');
  const [[payTableRow]] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'cln_client_payment'`
  );
  const hasClientPaymentTable = Number(payTableRow?.n || 0) > 0;
  const paymentStatusExpr = hasPaymentReceivedCol ? 'COALESCE(i.payment_received, 0)' : '0';
  const accountingInvoiceExpr = hasTransactionIdCol
    ? "NULLIF(TRIM(COALESCE(i.transaction_id, '')), '')"
    : 'NULL';
  const paidDateExpr = hasClientPaymentTable
    ? "DATE_FORMAT(COALESCE(p.payment_date, NULL), '%Y-%m-%d')"
    : 'NULL';
  const paymentJoin = hasClientPaymentTable
    ? `LEFT JOIN (
      SELECT invoice_id, MAX(payment_date) AS payment_date
      FROM cln_client_payment
      GROUP BY invoice_id
    ) p ON p.invoice_id = i.id`
    : '';
  const hasPdfUrlCol = await databaseHasColumn('cln_client_invoice', 'pdf_url');
  const pdfUrlExpr = hasPdfUrlCol ? "NULLIF(TRIM(COALESCE(i.pdf_url, '')), '')" : 'NULL';
  const hasPortalAccountingMetaCol = await databaseHasColumn('cln_client_invoice', 'accounting_meta_json');
  const portalAccountingMetaJsonExpr = hasPortalAccountingMetaCol
    ? 'i.accounting_meta_json AS accountingMetaJson'
    : 'NULL AS accountingMetaJson';
  const hasReceiptUrlCol =
    hasClientPaymentTable && (await databaseHasColumn('cln_client_payment', 'receipt_url'));
  const receiptUrlExpr = hasReceiptUrlCol
    ? `(SELECT NULLIF(TRIM(COALESCE(receipt_url, '')), '') FROM cln_client_payment WHERE invoice_id = i.id ORDER BY payment_date DESC LIMIT 1)`
    : 'NULL';
  const receiptsJsonSelect =
    hasClientPaymentTable && hasReceiptUrlCol
      ? `(SELECT IFNULL(JSON_ARRAYAGG(JSON_OBJECT(
          'receiptUrl', NULLIF(TRIM(pr.receipt_url), ''),
          'paymentDate', DATE_FORMAT(pr.payment_date, '%Y-%m-%d'),
          'receiptNumber', pr.receipt_number,
          'transactionId', NULLIF(TRIM(pr.transaction_id), ''),
          'amount', pr.amount,
          'isPortalProof', IF(
            LOWER(TRIM(COALESCE(pr.receipt_number, ''))) = 'portal_upload'
            OR TRIM(COALESCE(pr.transaction_id, '')) LIKE 'portal_bank_receipt:%',
            1,
            0
          )
        )), JSON_ARRAY())
        FROM cln_client_payment pr
        WHERE pr.invoice_id = i.id AND TRIM(COALESCE(pr.receipt_url, '')) <> '') AS receiptsJson`
      : 'CAST(JSON_ARRAY() AS JSON) AS receiptsJson';
  const odTable = await resolveClnOperatordetailTable();
  const hasGrp =
    (await databaseHasTable('cln_property_group_member')) && (await databaseHasTable('cln_property_group'));
  /** Many legacy rows have NULL `operator_id`; resolve display name from billing client's first linked operator. */
  const opFallbackJoin = hasOpCol
    ? `LEFT JOIN (
         SELECT clientdetail_id, MIN(operator_id) AS fo_op_id
         FROM cln_client_operator
         GROUP BY clientdetail_id
       ) fo ON fo.clientdetail_id = i.client_id`
    : '';
  /**
   * Grantee B may see invoices billed to B with NULL `operator_id` and no `cln_client_operator` on B — use any
   * operator linked to a property-group owner that invited B. Also intersect / viewer fallbacks for other shapes.
   */
  const intersectOpSub = hasOpCol
    ? `(SELECT MIN(j1.operator_id)
         FROM cln_client_operator j1
         INNER JOIN cln_client_operator j2
           ON j2.operator_id = j1.operator_id AND j2.clientdetail_id = ?
         WHERE j1.clientdetail_id = i.client_id)`
    : '';
  const ownerGroupOpSub =
    hasOpCol && hasGrp
      ? `(SELECT MIN(j.operator_id)
           FROM cln_client_operator j
           WHERE j.clientdetail_id IN (
             SELECT g.owner_clientdetail_id
             FROM cln_property_group_member m
             INNER JOIN cln_property_group g ON g.id = m.group_id
             WHERE m.grantee_clientdetail_id = ?
               AND m.invite_status = 'active'
               AND g.owner_clientdetail_id IS NOT NULL
           ))`
      : '';
  const viewerOnlyOpSub = hasOpCol
    ? `(SELECT MIN(j.operator_id) FROM cln_client_operator j WHERE j.clientdetail_id = ?)`
    : '';
  const resolvedOpIdExpr = hasOpCol
    ? `COALESCE(
         NULLIF(TRIM(i.operator_id), ''),
         NULLIF(TRIM(fo.fo_op_id), ''),
         NULLIF(TRIM(${intersectOpSub}), ''),
         ${hasGrp ? `NULLIF(TRIM(${ownerGroupOpSub}), ''),` : ''}
         NULLIF(TRIM(${viewerOnlyOpSub}), '')
       )`
    : `''`;
  const opJoin = hasOpCol
    ? `${opFallbackJoin}
       LEFT JOIN \`${odTable}\` od ON od.id = ${resolvedOpIdExpr}`
    : '';
  const opSelect = hasOpCol
    ? `${resolvedOpIdExpr} AS operatorId,
       TRIM(COALESCE(NULLIF(od.name, ''), NULLIF(od.email, ''), '')) AS operatorName`
    : `'' AS operatorId, '' AS operatorName`;

  /** Do not treat client-portal “proof only” rows as money received (balance stays full until operator marks paid). */
  const paymentTotalsJoin =
    hasClientPaymentTable
      ? `LEFT JOIN (
           SELECT invoice_id, COALESCE(SUM(amount), 0) AS paid_total
           FROM cln_client_payment
           WHERE NOT (
             LOWER(TRIM(COALESCE(receipt_number, ''))) = 'portal_upload'
             OR TRIM(COALESCE(transaction_id, '')) LIKE 'portal_bank_receipt:%'
           )
           GROUP BY invoice_id
         ) ps ON ps.invoice_id = i.id`
      : '';
  const balanceAmountExpr = hasClientPaymentTable
    ? `CASE WHEN ${paymentStatusExpr} = 1 THEN 0
           ELSE GREATEST(COALESCE(i.amount, 0) - COALESCE(ps.paid_total, 0), 0) END`
    : `CASE WHEN ${paymentStatusExpr} = 1 THEN 0 ELSE COALESCE(i.amount, 0) END`;

  const issueDateSql = hasIssueDateCol
    ? `DATE_FORMAT(COALESCE(i.issue_date, DATE(i.created_at)), '%Y-%m-%d')`
    : `DATE_FORMAT(COALESCE(i.created_at, NOW()), '%Y-%m-%d')`;
  const dueDateFromDbSql = hasDueDateCol ? `DATE_FORMAT(i.due_date, '%Y-%m-%d')` : `NULL`;

  const access = await buildClientPortalInvoiceAccessWhere('i', cid);
  let opFilterSql = '';
  /**
   * `resolvedOpIdExpr` appears twice (SELECT operatorId + JOIN od); each copy binds intersect ?,
   * optional owner-group ?, viewer-only ?. Then CASE i.client_id <>, then access WHERE params.
   */
  const opResolveParams = hasOpCol ? (hasGrp ? [cid, cid, cid] : [cid, cid]) : [];
  const params = hasOpCol
    ? [...opResolveParams, cid, ...opResolveParams, ...access.params]
    : [cid, ...access.params];
  if (hasOpCol && fop) {
    opFilterSql = ' AND i.operator_id = ?';
    params.push(fop);
  }
  params.push(lim);

  const [rows] = await pool.query(
    `SELECT
      i.id,
      COALESCE(i.invoice_number, i.id) AS invoiceNo,
      COALESCE(i.description, '') AS description,
      COALESCE(i.amount, 0) AS amount,
      0 AS tax,
      COALESCE(i.amount, 0) AS total,
      CASE WHEN ${paymentStatusExpr} = 1 THEN 1 ELSE 0 END AS paymentReceived,
      ${issueDateSql} AS issueDate,
      ${dueDateFromDbSql} AS dueDateFromDb,
      ${paidDateExpr} AS paidDate,
      ${accountingInvoiceExpr} AS accountingInvoiceId,
      ${pdfUrlExpr} AS pdfUrl,
      ${receiptUrlExpr} AS receiptUrl,
      ${portalAccountingMetaJsonExpr},
      ${opSelect},
      ${balanceAmountExpr} AS balanceAmount,
      CASE
        WHEN i.client_id <> ? THEN TRIM(COALESCE(NULLIF(cd_bill.fullname, ''), NULLIF(cd_bill.email, ''), ''))
        ELSE NULL
      END AS sharedFromClientRemark,
      ${receiptsJsonSelect}
     FROM cln_client_invoice i
     LEFT JOIN cln_clientdetail cd_bill ON cd_bill.id = i.client_id
     ${opJoin}
     ${paymentJoin}
     ${paymentTotalsJoin}
     WHERE ${access.sql}
     ${opFilterSql}
     ORDER BY i.created_at DESC
     LIMIT ?`,
    params
  );
  const raw = rows || [];
  const rowOpId = (r) => String(r.operatorId ?? r.operatorid ?? r.operator_id ?? '').trim();
  const rowOpName = (r) => String(r.operatorName ?? r.operatorname ?? r.operator_name ?? '').trim();
  /** When `operator_id` column is missing or legacy rows are NULL, due-policy lookup would be empty → legacy 14-day overdue. If this client links exactly one operator, use that id for payment-due policy (matches operator "No limit" settings). */
  const singleLinkedOpIdForDuePolicy =
    Array.isArray(operators) && operators.length === 1
      ? String(operators[0].id || '').trim()
      : '';
  const opIdsForSettings = new Set(raw.map((r) => rowOpId(r)).filter(Boolean));
  if (singleLinkedOpIdForDuePolicy) opIdsForSettings.add(singleLinkedOpIdForDuePolicy);
  const settingsMap = await getOperatorSettingsJsonMapForOperatorIds([...opIdsForSettings]);
  const items = raw.map((r) => {
    const oidRow = rowOpId(r);
    const oidForDuePolicy = oidRow || singleLinkedOpIdForDuePolicy;
    const enriched = enrichInvoiceRowStatusAndDue(
      {
        issueDate: r.issueDate,
        dueDateFromDb: r.dueDateFromDb,
        paymentReceived: r.paymentReceived,
        operatorId: oidForDuePolicy
      },
      settingsMap
    );
    const remark =
      r.sharedFromClientRemark != null && String(r.sharedFromClientRemark).trim() !== ''
        ? String(r.sharedFromClientRemark).trim()
        : null;
    const bal = Number(r.balanceAmount != null ? r.balanceAmount : r.amount);
    const balanceAmount = Number.isFinite(bal) ? bal : Number(r.amount) || 0;
    let portalAccountingMeta = null;
    if (r.accountingMetaJson != null && String(r.accountingMetaJson).trim() !== '') {
      try {
        portalAccountingMeta = JSON.parse(String(r.accountingMetaJson));
      } catch {
        portalAccountingMeta = null;
      }
    }
    return {
      id: r.id,
      invoiceNo: r.invoiceNo,
      description: r.description,
      amount: r.amount,
      balanceAmount,
      tax: r.tax,
      total: r.total,
      status: enriched.status,
      issueDate: r.issueDate,
      dueDate: enriched.dueDate || null,
      paidDate: r.paidDate,
      accountingInvoiceId: r.accountingInvoiceId,
      pdfUrl: r.pdfUrl != null && String(r.pdfUrl).trim() !== '' ? String(r.pdfUrl).trim() : null,
      receiptUrl: r.receiptUrl != null && String(r.receiptUrl).trim() !== '' ? String(r.receiptUrl).trim() : null,
      receipts: parseClientPortalInvoiceReceiptsJson(r.receiptsJson),
      operatorId: oidRow,
      operatorName: rowOpName(r),
      sharedFromClientRemark: remark,
      accountingMeta: portalAccountingMeta
    };
  });
  const opNameFromList = new Map(
    (operators || []).map((o) => [String(o.id || '').trim(), String(o.name || '').trim()])
  );
  const singleLinkedOp = Array.isArray(operators) && operators.length === 1 ? operators[0] : null;
  for (const it of items) {
    let oid = String(it.operatorId || '').trim();
    let oname = String(it.operatorName || '').trim();
    if (!oname && oid) {
      const fromList = opNameFromList.get(oid);
      if (fromList) it.operatorName = fromList;
    }
    if (!oid && singleLinkedOp) {
      it.operatorId = String(singleLinkedOp.id || '').trim();
      it.operatorName = String(singleLinkedOp.name || '').trim() || it.operatorId;
    }
  }
  const operatorsMerged = await mergePortalInvoiceOperatorsIntoLinkedList(operators, items);
  const opNameMerged = new Map(
    operatorsMerged.map((o) => [String(o.id || '').trim(), String(o.name || '').trim()])
  );
  for (const it of items) {
    const oid = String(it.operatorId || '').trim();
    const oname = String(it.operatorName || '').trim();
    if (oid && !oname) {
      const n = opNameMerged.get(oid);
      if (n) it.operatorName = n;
    }
  }
  const operatorsEnriched = await Promise.all(
    operatorsMerged.map(async (o) => {
      const oid = String(o.id || '').trim();
      const settingsRaw = await readOperatorSettingsJsonRaw(oid);
      return {
        ...o,
        stripeConnected: Boolean(
          await clnIntegration.getStripeConnectedAccountIdForOperator(oid)
        ),
        billplzClientInvoice: Boolean(parseClientInvoiceBillplzFromSettings(settingsRaw)),
        xenditClientInvoice: Boolean(parseClientInvoiceXenditFromSettings(settingsRaw))
      };
    })
  );
  return { items, operators: operatorsEnriched };
}

async function assertB2bInvoiceCheckoutRows(clientdetailId, operatorId, invoiceIds) {
  const cid = String(clientdetailId || '').trim();
  const oid = String(operatorId || '').trim();
  const ids = [...new Set((invoiceIds || []).map((x) => String(x).trim()).filter(Boolean))];
  if (!cid || !oid || !ids.length) {
    return { ok: false, code: 'INVALID_PARAMS' };
  }
  const hasPr = await databaseHasColumn('cln_client_invoice', 'payment_received');
  const hasOpCol = await databaseHasColumn('cln_client_invoice', 'operator_id');
  const prExpr = hasPr ? 'COALESCE(i.payment_received,0)' : '0';
  const placeholders = ids.map(() => '?').join(',');
  const access = await buildClientPortalInvoiceAccessWhere('i', cid);
  let sql = `SELECT i.id,
    COALESCE(i.amount, 0) AS amount,
    COALESCE(i.invoice_number, '') AS invoice_number,
    COALESCE(i.description, '') AS description,
    COALESCE(NULLIF(TRIM(i.client_id), ''), '') AS invoice_client_id`;
  sql += hasOpCol ? `, COALESCE(NULLIF(TRIM(i.operator_id), ''), '') AS operator_id` : `, '' AS operator_id`;
  sql += `, ${prExpr} AS pr FROM cln_client_invoice i WHERE ${access.sql} AND i.id IN (${placeholders})`;
  const [rows] = await pool.query(sql, [...access.params, ...ids]);
  if (rows.length !== ids.length) {
    return { ok: false, code: 'INVOICE_NOT_FOUND' };
  }
  const needClientLinkCheck = [];
  for (const r of rows) {
    if (Number(r.pr) === 1) {
      return { ok: false, code: 'INVOICE_ALREADY_PAID' };
    }
    if (hasOpCol) {
      const rowOp = String(r.operator_id || '').trim();
      if (rowOp && rowOp !== oid) {
        return { ok: false, code: 'OPERATOR_MISMATCH' };
      }
      if (!rowOp) {
        const billCid = String(r.invoice_client_id || '').trim();
        if (billCid) needClientLinkCheck.push(billCid);
      }
    }
  }
  if (hasOpCol && needClientLinkCheck.length) {
    const uniq = [...new Set(needClientLinkCheck.map((x) => String(x).trim()).filter(Boolean))];
    const ph = uniq.map(() => '?').join(',');
    const [lnkRows] = await pool.query(
      `SELECT clientdetail_id FROM cln_client_operator WHERE operator_id = ? AND clientdetail_id IN (${ph})`,
      [oid, ...uniq]
    );
    const okSet = new Set((lnkRows || []).map((x) => String(x.clientdetail_id || '').trim()));
    for (const id of uniq) {
      if (!okSet.has(id)) {
        return { ok: false, code: 'OPERATOR_MISMATCH' };
      }
    }
  }
  const totalMyr = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
  if (!(totalMyr > 0)) {
    return { ok: false, code: 'INVALID_AMOUNT' };
  }
  return { ok: true, rows, totalMyr, cid, oid, ids };
}

async function ensureB2bInvoiceCheckoutTable() {
  await pool.query(`CREATE TABLE IF NOT EXISTS cln_b2b_invoice_checkout (
    id CHAR(36) NOT NULL,
    operator_id CHAR(36) NOT NULL,
    clientdetail_id CHAR(36) NOT NULL,
    invoice_ids TEXT NOT NULL,
    amount DECIMAL(14,2) NOT NULL,
    provider VARCHAR(16) NOT NULL,
    billplz_bill_id VARCHAR(64) NULL,
    xendit_invoice_id VARCHAR(128) NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    KEY idx_cln_b2b_chk_op (operator_id),
    KEY idx_cln_b2b_chk_bp (billplz_bill_id),
    KEY idx_cln_b2b_chk_xi (xendit_invoice_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

/** Same rules as tenantdashboard.appendQueryParams — preserves Stripe `{CHECKOUT_SESSION_ID}` unencoded. */
function appendClnB2bInvoiceUrlQueryParams(url, params) {
  let next = String(url || '');
  for (const [key, value] of Object.entries(params || {})) {
    if (value == null || value === '') continue;
    const rawValue = String(value);
    const encodedValue = /^\{[A-Z0-9_]+\}$/.test(rawValue) ? rawValue : encodeURIComponent(rawValue);
    next += (next.includes('?') ? '&' : '?') + `${encodeURIComponent(key)}=${encodedValue}`;
  }
  return next;
}

function getClnClientPortalInvoicesPageBaseUrl() {
  const raw = (
    process.env.CLEANLEMON_PORTAL_APP_BASE_URL ||
    process.env.CLEANLEMON_PORTAL_AUTH_BASE_URL ||
    process.env.PORTAL_APP_URL ||
    'https://portal.cleanlemons.com'
  )
    .trim()
    .replace(/\/$/, '');
  return `${raw}/portal/client/invoices`;
}

async function readOperatorSettingsJsonRaw(operatorId) {
  await ensureOperatorSettingsTable();
  const oid = String(operatorId || '').trim();
  if (!oid) return {};
  const [rows] = await pool.query('SELECT settings_json FROM cln_operator_settings WHERE operator_id = ? LIMIT 1', [
    oid,
  ]);
  if (!rows.length) return {};
  try {
    return JSON.parse(rows[0].settings_json) || {};
  } catch {
    return {};
  }
}

/**
 * Shallow-merge `patch` into stored settings_json (no integration-flag rewrite).
 * Used for Xendit client-invoice credentials so saves do not depend on `upsertOperatorSettings` merge path.
 */
async function patchClnOperatorSettingsJson(operatorId, patch) {
  await ensureOperatorSettingsTable();
  const oid = String(operatorId || '').trim();
  if (!oid) {
    const e = new Error('MISSING_OPERATOR_ID');
    e.code = 'MISSING_OPERATOR_ID';
    throw e;
  }
  const p = patch && typeof patch === 'object' ? { ...patch } : {};
  const prev = (await readOperatorSettingsJsonRaw(oid)) || {};
  delete prev.publicSubdomain;
  const next = { ...prev, ...p };
  delete next.publicSubdomain;
  const id = `setting-${oid}`;
  await pool.query(
    `INSERT INTO cln_operator_settings (id, operator_id, settings_json)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE settings_json = VALUES(settings_json), updated_at = CURRENT_TIMESTAMP`,
    [id, oid, JSON.stringify(next)]
  );
}

function parseClientInvoiceBillplzFromSettings(settings) {
  const raw = settings && typeof settings === 'object' ? settings.clientInvoiceBillplz : undefined;
  if (!raw || typeof raw !== 'object') return null;
  const apiKey = String(raw.apiKey || '').trim();
  const collectionId = String(raw.collectionId || '').trim();
  const xSignatureKey = String(raw.xSignatureKey || '').trim();
  if (!apiKey || !collectionId || !xSignatureKey) return null;
  return {
    apiKey,
    collectionId,
    xSignatureKey,
    useSandbox: raw.useSandbox === true || String(raw.useSandbox || '').toLowerCase() === 'true',
  };
}

function parseClientInvoiceXenditFromSettings(settings) {
  const raw = settings && typeof settings === 'object' ? settings.clientInvoiceXendit : undefined;
  if (!raw || typeof raw !== 'object') return null;
  const secretKey = String(raw.secretKey || '').trim();
  const callbackToken = String(raw.callbackToken || raw.webhookToken || '').trim();
  if (!secretKey || !callbackToken) return null;
  return { secretKey, callbackToken };
}

function buildClnClientInvoiceXenditGatewayUi(base, stripeOn) {
  const raw = base?.clientInvoiceXendit;
  const cfg = parseClientInvoiceXenditFromSettings(base);
  const sk = raw && typeof raw === 'object' ? String(raw.secretKey || '').trim() : '';
  const tok = raw && typeof raw === 'object' ? String(raw.callbackToken || raw.webhookToken || '').trim() : '';
  const verified = !!(raw && typeof raw === 'object' && String(raw.callbackVerifiedAt || '').trim());
  let connectionStatus = 'no_connect';
  if (stripeOn) connectionStatus = 'no_connect';
  else if (cfg) connectionStatus = verified ? 'connected' : 'pending_verification';
  return {
    connectionStatus,
    hasSecretKey: !!sk,
    hasWebhookToken: !!tok,
    secretKeyLast4: sk.length >= 4 ? sk.slice(-4) : sk ? '****' : '',
    webhookTokenLast4: tok.length >= 4 ? tok.slice(-4) : tok ? '****' : '',
    lastWebhookAt: raw && typeof raw === 'object' ? String(raw.lastWebhookAt || '').trim() || null : null,
    lastWebhookType: raw && typeof raw === 'object' ? String(raw.lastWebhookType || '').trim() || null : null,
  };
}

async function markClnXenditWebhookVerified(operatorId, meta = {}) {
  const oid = String(operatorId || '').trim();
  const prev = (await readOperatorSettingsJsonRaw(oid)) || {};
  const raw = prev.clientInvoiceXendit;
  if (!raw || typeof raw !== 'object') return;
  if (!parseClientInvoiceXenditFromSettings({ ...prev, clientInvoiceXendit: raw })) return;
  const next = { ...raw };
  next.callbackVerifiedAt = new Date().toISOString();
  next.xendit_connection_status = 'connected';
  if (meta.lastWebhookType) next.lastWebhookType = String(meta.lastWebhookType).slice(0, 120);
  next.lastWebhookAt = new Date().toISOString();
  await patchClnOperatorSettingsJson(oid, { clientInvoiceXendit: next, xendit: true });
}

async function saveClnOperatorClientInvoiceXenditCredentials(operatorId, payload = {}) {
  const oid = String(operatorId || '').trim();
  if (!oid) {
    const e = new Error('MISSING_OPERATOR_ID');
    e.code = 'MISSING_OPERATOR_ID';
    throw e;
  }
  const p = payload && typeof payload === 'object' ? payload : {};
  const prev = (await readOperatorSettingsJsonRaw(oid)) || {};
  const prevX = prev.clientInvoiceXendit && typeof prev.clientInvoiceXendit === 'object' ? { ...prev.clientInvoiceXendit } : {};
  const prevSk = String(prevX.secretKey || '').trim();
  const prevTok = String(prevX.callbackToken || prevX.webhookToken || '').trim();
  const hasSk = Object.prototype.hasOwnProperty.call(p, 'secretKey');
  const hasTok = Object.prototype.hasOwnProperty.call(p, 'callbackToken');
  const sk = hasSk ? String(p.secretKey ?? '').trim() || prevSk : prevSk;
  const tok = hasTok ? String(p.callbackToken ?? '').trim() || prevTok : prevTok;
  if (!sk || !tok) {
    const e = new Error('MISSING_KEYS');
    e.code = 'MISSING_KEYS';
    throw e;
  }
  const merged = { ...prevX, secretKey: sk, callbackToken: tok };
  await patchClnOperatorSettingsJson(oid, {
    clientInvoiceXendit: merged,
    xendit: true,
  });
  return { ok: true };
}

async function clearClnOperatorClientInvoiceXenditCredentials(operatorId) {
  const oid = String(operatorId || '').trim();
  if (!oid) {
    const e = new Error('MISSING_OPERATOR_ID');
    e.code = 'MISSING_OPERATOR_ID';
    throw e;
  }
  const raw = (await readOperatorSettingsJsonRaw(oid)) || {};
  const prev = { ...raw };
  delete prev.publicSubdomain;
  delete prev.clientInvoiceXendit;
  prev.xendit = false;
  const id = `setting-${oid}`;
  await ensureOperatorSettingsTable();
  await pool.query(
    `INSERT INTO cln_operator_settings (id, operator_id, settings_json)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE settings_json = VALUES(settings_json), updated_at = CURRENT_TIMESTAMP`,
    [id, oid, JSON.stringify(prev)]
  );
  return { ok: true };
}

async function createB2bInvoiceBillplzCheckoutSession(params) {
  const { clientdetailId, operatorId, invoiceIds, email, successUrl, cancelUrl } = params;
  const chk = await assertB2bInvoiceCheckoutRows(clientdetailId, operatorId, invoiceIds);
  if (!chk.ok) return chk;
  const { rows, totalMyr, cid, oid, ids } = chk;
  const totalSen = Math.round(totalMyr * 100);
  if (totalSen < 100) {
    return { ok: false, code: 'AMOUNT_BELOW_MINIMUM' };
  }
  const settings = await readOperatorSettingsJsonRaw(oid);
  const bp = parseClientInvoiceBillplzFromSettings(settings);
  if (!bp) return { ok: false, code: 'BILLPLZ_NOT_CONFIGURED' };
  await ensureB2bInvoiceCheckoutTable();
  const { randomUUID } = require('crypto');
  const checkoutId = randomUUID();
  const apiBase = String(
    process.env.CLEANLEMON_API_PUBLIC_URL || process.env.PUBLIC_APP_URL || process.env.API_BASE_URL || ''
  )
    .trim()
    .replace(/\/$/, '');
  if (!apiBase) return { ok: false, code: 'API_BASE_URL_MISSING' };
  const callbackUrl = `${apiBase}/api/cleanlemon/client/invoices/billplz-callback?checkout_id=${encodeURIComponent(checkoutId)}`;
  const desc = rows
    .map((r) => String(r.invoice_number || r.id || '').trim())
    .filter(Boolean)
    .join(', ')
    .slice(0, 200);
  const { createBill } = require('../billplz/wrappers/bill.wrapper');
  await pool.query(
    `INSERT INTO cln_b2b_invoice_checkout (id, operator_id, clientdetail_id, invoice_ids, amount, provider, status)
     VALUES (?, ?, ?, ?, ?, 'billplz', 'pending')`,
    [checkoutId, oid, cid, ids.join(','), Number(totalMyr.toFixed(2))]
  );
  const billRes = await createBill({
    apiKey: bp.apiKey,
    collectionId: bp.collectionId,
    email: String(email || '').trim().toLowerCase(),
    mobile: '',
    name: String(email || 'Client').trim().slice(0, 255),
    amount: totalSen,
    callbackUrl,
    redirectUrl: String(successUrl || '').trim(),
    description: desc || 'Cleaning invoices',
    reference1Label: 'Checkout',
    reference1: checkoutId.slice(0, 120),
    reference2Label: 'Type',
    reference2: 'cleanlemon_b2b_invoice',
    useSandbox: bp.useSandbox === true,
  });
  if (!billRes?.ok) {
    await pool.query('DELETE FROM cln_b2b_invoice_checkout WHERE id = ? LIMIT 1', [checkoutId]).catch(() => {});
    return { ok: false, code: 'BILLPLZ_CREATE_FAILED' };
  }
  const bill = billRes.data || {};
  const billId = bill.id != null ? String(bill.id).trim() : '';
  const billUrl = bill.url != null ? String(bill.url).trim() : '';
  if (!billId || !billUrl) {
    await pool.query('DELETE FROM cln_b2b_invoice_checkout WHERE id = ? LIMIT 1', [checkoutId]).catch(() => {});
    return { ok: false, code: 'BILLPLZ_NO_URL' };
  }
  await pool.query('UPDATE cln_b2b_invoice_checkout SET billplz_bill_id = ? WHERE id = ? LIMIT 1', [billId, checkoutId]);
  return { ok: true, url: billUrl, sessionId: billId, provider: 'billplz' };
}

async function createB2bInvoiceXenditCheckoutSession(params) {
  const axios = require('axios');
  const { clientdetailId, operatorId, invoiceIds, email, successUrl, cancelUrl } = params;
  const chk = await assertB2bInvoiceCheckoutRows(clientdetailId, operatorId, invoiceIds);
  if (!chk.ok) return chk;
  const { rows, totalMyr, cid, oid, ids } = chk;
  const totalSen = Math.round(totalMyr * 100);
  if (totalSen < 100) {
    return { ok: false, code: 'AMOUNT_BELOW_MINIMUM' };
  }
  const settings = await readOperatorSettingsJsonRaw(oid);
  const xcfg = parseClientInvoiceXenditFromSettings(settings);
  if (!xcfg) return { ok: false, code: 'XENDIT_NOT_CONFIGURED' };
  await ensureB2bInvoiceCheckoutTable();
  const { randomUUID } = require('crypto');
  const checkoutId = randomUUID();
  const externalId = `cln-b2b-${checkoutId}`;
  const auth = Buffer.from(`${xcfg.secretKey}:`).toString('base64');
  const desc = rows
    .map((r) => String(r.invoice_number || r.id || '').trim())
    .filter(Boolean)
    .join(', ')
    .slice(0, 200);
  await pool.query(
    `INSERT INTO cln_b2b_invoice_checkout (id, operator_id, clientdetail_id, invoice_ids, amount, provider, xendit_invoice_id, status)
     VALUES (?, ?, ?, ?, ?, 'xendit', NULL, 'pending')`,
    [checkoutId, oid, cid, ids.join(','), Number(totalMyr.toFixed(2))]
  );
  const rawSuccess = String(successUrl || '').trim();
  const rawFail = String(cancelUrl || successUrl || '').trim();
  const success_redirect_url = appendClnB2bInvoiceUrlQueryParams(rawSuccess, {
    success: '1',
    provider: 'xendit',
    payment_type: 'cln_client_invoice',
    checkout_id: checkoutId,
  });
  const failure_redirect_url = appendClnB2bInvoiceUrlQueryParams(rawFail, { cancel: '1' });
  const body = {
    external_id: externalId,
    amount: Number(totalMyr.toFixed(2)),
    currency: 'MYR',
    payer_email: String(email || '').trim().toLowerCase().slice(0, 255),
    description: desc || 'Cleaning invoices',
    invoice_duration: 86400,
    success_redirect_url,
    failure_redirect_url,
    metadata: {
      type: 'cleanlemon_b2b_invoice',
      checkout_id: checkoutId,
      operator_id: oid,
      clientdetail_id: cid,
      invoice_ids: ids.join(',').slice(0, 500),
    },
  };
  let inv;
  try {
    const res = await axios.post('https://api.xendit.co/v2/invoices', body, {
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      timeout: 25000,
    });
    inv = res.data;
  } catch (e) {
    await pool.query('DELETE FROM cln_b2b_invoice_checkout WHERE id = ? LIMIT 1', [checkoutId]).catch(() => {});
    return { ok: false, code: 'XENDIT_CREATE_FAILED', message: String(e?.response?.data || e?.message || e) };
  }
  const invId = inv?.id != null ? String(inv.id).trim() : '';
  const invUrl = inv?.invoice_url != null ? String(inv.invoice_url).trim() : '';
  if (!invId || !invUrl) {
    await pool.query('DELETE FROM cln_b2b_invoice_checkout WHERE id = ? LIMIT 1', [checkoutId]).catch(() => {});
    return { ok: false, code: 'XENDIT_NO_URL' };
  }
  await pool.query('UPDATE cln_b2b_invoice_checkout SET xendit_invoice_id = ? WHERE id = ? LIMIT 1', [
    invId,
    checkoutId,
  ]);
  return { ok: true, url: invUrl, sessionId: invId, provider: 'xendit' };
}

async function handleB2bInvoiceBillplzCallback(checkoutId, payload) {
  const cid0 = String(checkoutId || '').trim();
  if (!cid0) return { ok: false, reason: 'MISSING_CHECKOUT_ID' };
  await ensureB2bInvoiceCheckoutTable();
  const [[row]] = await pool.query(
    'SELECT * FROM cln_b2b_invoice_checkout WHERE id = ? AND provider = ? LIMIT 1',
    [cid0, 'billplz']
  );
  if (!row) return { ok: false, reason: 'CHECKOUT_NOT_FOUND' };
  if (String(row.status || '') === 'paid') return { ok: true, idempotent: true };
  const oid = String(row.operator_id || '').trim();
  const settings = await readOperatorSettingsJsonRaw(oid);
  const bp = parseClientInvoiceBillplzFromSettings(settings);
  if (!bp) return { ok: false, reason: 'BILLPLZ_NOT_CONFIGURED' };
  const { verifyBillplzXSignature } = require('../billplz/lib/signature');
  const sig = payload?.x_signature || payload?.xSignature;
  if (!verifyBillplzXSignature(payload, bp.xSignatureKey, sig)) {
    return { ok: false, reason: 'BILLPLZ_SIGNATURE_INVALID' };
  }
  const paid =
    payload?.paid === true ||
    payload?.paid === 'true' ||
    payload?.paid === 1 ||
    String(payload?.state || '').toLowerCase() === 'paid';
  if (!paid) return { ok: false, reason: 'NOT_PAID' };
  const ref1 = String(payload?.reference_1 || payload?.reference1 || '').trim();
  if (ref1 && ref1 !== cid0) {
    return { ok: false, reason: 'REFERENCE_MISMATCH' };
  }
  const billId = String(payload?.id || '').trim();
  if (row.billplz_bill_id && billId && row.billplz_bill_id !== billId) {
    return { ok: false, reason: 'BILL_ID_MISMATCH' };
  }
  const amountCents = Math.round(Number(payload?.amount || 0));
  const expectedSen = Math.round(Number(row.amount) * 100);
  if (!Number.isFinite(amountCents) || Math.abs(amountCents - expectedSen) > 2) {
    return { ok: false, reason: 'AMOUNT_MISMATCH' };
  }
  const ids = String(row.invoice_ids || '')
    .split(',')
    .map((x) => String(x).trim())
    .filter(Boolean);
  const txn = `billplz:${billId || cid0}`;
  const mrk = await markB2bClientInvoicesPaidFromGateway({
    clientdetailId: row.clientdetail_id,
    operatorId: oid,
    invoiceIds: ids,
    transactionId: txn,
    amountMyr: Number(row.amount),
  });
  if (!mrk.ok) return mrk;
  await pool.query(`UPDATE cln_b2b_invoice_checkout SET status = 'paid' WHERE id = ? LIMIT 1`, [cid0]);
  return { ok: true };
}

async function handleB2bInvoiceXenditWebhook(opts = {}) {
  const headers = opts.headers || {};
  const body = opts.body || {};
  const query = opts.query || {};
  const oidFromQuery = String(query.operator_id || query.operatorId || '').trim();
  const token = String(headers?.['x-callback-token'] || headers?.['X-Callback-Token'] || '').trim();
  const ext = String(body?.external_id || body?.externalId || '').trim();
  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  /** Xendit Dashboard test / invoice callbacks: `?operator_id=` + valid token marks gateway verified. */
  if (oidFromQuery && uuidRe.test(oidFromQuery)) {
    const settingsQ = await readOperatorSettingsJsonRaw(oidFromQuery);
    const xcfgQ = parseClientInvoiceXenditFromSettings(settingsQ);
    if (!xcfgQ) return { ok: false, reason: 'XENDIT_NOT_CONFIGURED' };
    if (!token || token !== xcfgQ.callbackToken) {
      return { ok: false, reason: 'XENDIT_CALLBACK_TOKEN_INVALID' };
    }
    if (!ext.startsWith('cln-b2b-')) {
      const evt = String(body?.status || body?.event || body?.type || 'callback').slice(0, 120);
      await markClnXenditWebhookVerified(oidFromQuery, { lastWebhookType: evt });
      return { ok: true, verified: true };
    }
  }

  await ensureB2bInvoiceCheckoutTable();
  if (!ext.startsWith('cln-b2b-')) return { ok: false, reason: 'WRONG_EXTERNAL' };
  const checkoutId = ext.replace(/^cln-b2b-/, '').trim();
  if (!checkoutId) return { ok: false, reason: 'MISSING_CHECKOUT' };
  const [[row]] = await pool.query(
    'SELECT * FROM cln_b2b_invoice_checkout WHERE id = ? AND provider = ? LIMIT 1',
    [checkoutId, 'xendit']
  );
  if (!row) return { ok: false, reason: 'CHECKOUT_NOT_FOUND' };
  if (String(row.status || '') === 'paid') return { ok: true, idempotent: true };
  const oid = String(row.operator_id || '').trim();
  const settings = await readOperatorSettingsJsonRaw(oid);
  const xcfg = parseClientInvoiceXenditFromSettings(settings);
  if (!xcfg) return { ok: false, reason: 'XENDIT_NOT_CONFIGURED' };
  if (!token || token !== xcfg.callbackToken) {
    return { ok: false, reason: 'XENDIT_CALLBACK_TOKEN_INVALID' };
  }
  if (oidFromQuery && uuidRe.test(oidFromQuery) && oidFromQuery !== oid) {
    return { ok: false, reason: 'OPERATOR_MISMATCH' };
  }
  const st = String(body?.status || '').toUpperCase();
  if (st !== 'PAID' && st !== 'SETTLED') {
    return { ok: false, reason: 'NOT_PAID' };
  }
  const paidAmount = Number(body?.amount || body?.paid_amount || row.amount);
  if (!Number.isFinite(paidAmount) || Math.abs(paidAmount - Number(row.amount)) > 0.02) {
    return { ok: false, reason: 'AMOUNT_MISMATCH' };
  }
  const ids = String(row.invoice_ids || '')
    .split(',')
    .map((x) => String(x).trim())
    .filter(Boolean);
  const invId = String(body?.id || row.xendit_invoice_id || '').trim();
  const txn = `xendit:${invId}`;
  const mrk = await markB2bClientInvoicesPaidFromGateway({
    clientdetailId: row.clientdetail_id,
    operatorId: oid,
    invoiceIds: ids,
    transactionId: txn,
    amountMyr: Number(row.amount),
  });
  if (!mrk.ok) return mrk;
  await pool.query(`UPDATE cln_b2b_invoice_checkout SET status = 'paid' WHERE id = ? LIMIT 1`, [checkoutId]);
  await markClnXenditWebhookVerified(oid, { lastWebhookType: 'invoice_paid' });
  return { ok: true };
}

/**
 * B2B client portal — Stripe Checkout (payment) for one or more unpaid invoices for the same operator.
 * Funds go to the operator’s Stripe Connect account when configured.
 */
async function createClientPortalInvoiceCheckoutSession(params = {}) {
  const paymentProvider = String(params.paymentProvider || params.provider || 'stripe')
    .trim()
    .toLowerCase();
  if (paymentProvider === 'billplz') {
    return createB2bInvoiceBillplzCheckoutSession(params);
  }
  if (paymentProvider === 'xendit') {
    return createB2bInvoiceXenditCheckoutSession(params);
  }

  const { clientdetailId, operatorId, invoiceIds, email, successUrl, cancelUrl } = params;
  const chk = await assertB2bInvoiceCheckoutRows(clientdetailId, operatorId, invoiceIds);
  if (!chk.ok) return chk;
  const { rows, totalMyr, oid } = chk;

  const destination = await clnIntegration.getStripeConnectedAccountIdForOperator(oid);
  if (!destination) {
    return { ok: false, code: 'STRIPE_CONNECT_REQUIRED' };
  }

  const totalSen = Math.round(totalMyr * 100);
  if (totalSen < 200) {
    return { ok: false, code: 'AMOUNT_BELOW_STRIPE_MINIMUM' };
  }

  const Stripe = require('stripe');
  const key = String(process.env.CLEANLEMON_STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY || '').trim();
  if (!key) {
    return { ok: false, code: 'STRIPE_KEY_MISSING' };
  }
  const stripe = new Stripe(key, { apiVersion: '2024-11-20.acacia' });

  const cid = chk.cid;
  const ids = chk.ids;
  const invLabels = rows
    .map((r) => String(r.invoice_number || r.id || '').trim())
    .filter(Boolean)
    .join(', ')
    .slice(0, 450);
  const meta = {
    type: 'cleanlemon_client_invoices',
    operator_id: oid,
    clientdetail_id: cid,
    invoice_ids: ids.join(',').slice(0, 450),
    customer_email: String(email || '')
      .trim()
      .toLowerCase()
      .slice(0, 200)
  };

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: String(email || '')
      .trim()
      .toLowerCase() || undefined,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'myr',
          unit_amount: totalSen,
          product_data: {
            name: `Cleaning invoices (${rows.length})`,
            description: invLabels || `Operator ${oid.slice(0, 8)}`
          }
        }
      }
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: meta,
    payment_intent_data: {
      transfer_data: {
        destination
      }
    }
  });
  return { ok: true, url: session.url, sessionId: session.id, provider: 'stripe' };
}

/** Auto pick gateway (same priority as client invoices UI): Stripe ≥ RM2, else Billplz / Xendit ≥ RM1. */
async function resolveClnB2bInvoiceAutoPaymentProvider(operatorId, totalMyr) {
  const oid = String(operatorId || '').trim();
  const totalSen = Math.round(Number(totalMyr) * 100);
  if (!(totalSen > 0)) return null;
  const destination = await clnIntegration.getStripeConnectedAccountIdForOperator(oid);
  if (destination && totalSen >= 200) return 'stripe';
  const settings = await readOperatorSettingsJsonRaw(oid);
  if (parseClientInvoiceBillplzFromSettings(settings) && totalSen >= 100) return 'billplz';
  if (parseClientInvoiceXenditFromSettings(settings) && totalSen >= 100) return 'xendit';
  return null;
}

/**
 * Coliving-style `create-payment`: builds return URLs with `provider` / `session_id` / etc., then starts checkout.
 * Body should pass `returnUrl` / `cancelUrl` like tenant meter (e.g. `?success=1` / `?cancel=1`); defaults to portal client invoices page.
 */
async function createClientPortalInvoicePayment(params = {}) {
  const {
    clientdetailId,
    operatorId,
    invoiceIds,
    email,
    returnUrl,
    cancelUrl,
    paymentProvider: forcedRaw,
  } = params;
  const chk = await assertB2bInvoiceCheckoutRows(clientdetailId, operatorId, invoiceIds);
  if (!chk.ok) return chk;
  const { totalMyr, oid } = chk;
  const forced = String(forcedRaw || '').trim().toLowerCase();
  const provider =
    forced && ['stripe', 'billplz', 'xendit'].includes(forced)
      ? forced
      : await resolveClnB2bInvoiceAutoPaymentProvider(oid, totalMyr);
  if (!provider) {
    return { ok: false, code: 'NO_ONLINE_PAYMENT' };
  }
  const pageBase = getClnClientPortalInvoicesPageBaseUrl();
  const successBase = String(returnUrl || '').trim() || `${pageBase}?success=1`;
  const cancelBase = String(cancelUrl || '').trim() || `${pageBase}?cancel=1`;

  let successUrl = successBase;
  if (provider === 'stripe') {
    successUrl = appendClnB2bInvoiceUrlQueryParams(successBase, {
      provider: 'stripe',
      payment_type: 'cln_client_invoice',
      session_id: '{CHECKOUT_SESSION_ID}',
    });
  } else if (provider === 'billplz') {
    successUrl = appendClnB2bInvoiceUrlQueryParams(successBase, {
      provider: 'billplz',
      payment_type: 'cln_client_invoice',
      operator_id: oid,
    });
  } else if (provider === 'xendit') {
    successUrl = successBase;
  }

  const out = await createClientPortalInvoiceCheckoutSession({
    clientdetailId,
    operatorId,
    invoiceIds,
    email,
    successUrl,
    cancelUrl: cancelBase,
    paymentProvider: provider,
  });
  if (!out.ok) return out;
  return { ok: true, type: 'redirect', url: out.url, sessionId: out.sessionId, provider: out.provider || provider };
}

async function confirmClnB2bClientInvoiceBillplzFromBrowser({ clientdetailId, billId }) {
  const cid = String(clientdetailId || '').trim();
  const bid = String(billId || '').trim();
  if (!cid || !bid) return { ok: false, reason: 'MISSING_PARAMS' };
  await ensureB2bInvoiceCheckoutTable();
  const [[row]] = await pool.query(
    'SELECT * FROM cln_b2b_invoice_checkout WHERE billplz_bill_id = ? AND provider = ? AND clientdetail_id = ? LIMIT 1',
    [bid, 'billplz', cid]
  );
  if (!row) return { ok: false, reason: 'CHECKOUT_NOT_FOUND' };
  if (String(row.status || '') === 'paid') return { ok: true, idempotent: true };
  const oid = String(row.operator_id || '').trim();
  const settings = await readOperatorSettingsJsonRaw(oid);
  const bp = parseClientInvoiceBillplzFromSettings(settings);
  if (!bp) return { ok: false, reason: 'BILLPLZ_NOT_CONFIGURED' };
  const { getBill } = require('../billplz/wrappers/bill.wrapper');
  const billRes = await getBill({ apiKey: bp.apiKey, billId: bid, useSandbox: bp.useSandbox === true });
  if (!billRes?.ok) return { ok: false, reason: 'BILL_NOT_FOUND' };
  const bill = billRes.data || {};
  const paid =
    bill?.paid === true ||
    bill?.paid === 'true' ||
    bill?.paid === 1 ||
    String(bill?.state || '').toLowerCase() === 'paid';
  if (!paid) return { ok: false, reason: 'PAYMENT_NOT_PAID' };
  const amountCents = Math.round(Number(bill?.amount || 0));
  const expectedSen = Math.round(Number(row.amount) * 100);
  if (!Number.isFinite(amountCents) || Math.abs(amountCents - expectedSen) > 2) {
    return { ok: false, reason: 'AMOUNT_MISMATCH' };
  }
  const ids = String(row.invoice_ids || '')
    .split(',')
    .map((x) => String(x).trim())
    .filter(Boolean);
  const txn = `billplz:${bid}`;
  const mrk = await markB2bClientInvoicesPaidFromGateway({
    clientdetailId: row.clientdetail_id,
    operatorId: oid,
    invoiceIds: ids,
    transactionId: txn,
    amountMyr: Number(row.amount),
  });
  if (!mrk.ok) return mrk;
  await pool.query(`UPDATE cln_b2b_invoice_checkout SET status = 'paid' WHERE id = ? LIMIT 1`, [row.id]);
  return { ok: true };
}

async function confirmClnB2bClientInvoiceXenditFromBrowser({ clientdetailId, checkoutId }) {
  const cid = String(clientdetailId || '').trim();
  const chkId = String(checkoutId || '').trim();
  if (!cid || !chkId) return { ok: false, reason: 'MISSING_PARAMS' };
  await ensureB2bInvoiceCheckoutTable();
  const [[row]] = await pool.query(
    'SELECT * FROM cln_b2b_invoice_checkout WHERE id = ? AND provider = ? AND clientdetail_id = ? LIMIT 1',
    [chkId, 'xendit', cid]
  );
  if (!row) return { ok: false, reason: 'CHECKOUT_NOT_FOUND' };
  if (String(row.status || '') === 'paid') return { ok: true, idempotent: true };
  const oid = String(row.operator_id || '').trim();
  const settings = await readOperatorSettingsJsonRaw(oid);
  const xcfg = parseClientInvoiceXenditFromSettings(settings);
  if (!xcfg) return { ok: false, reason: 'XENDIT_NOT_CONFIGURED' };
  const invId = String(row.xendit_invoice_id || '').trim();
  if (!invId) return { ok: false, reason: 'MISSING_XENDIT_INVOICE' };
  const axios = require('axios');
  const auth = Buffer.from(`${xcfg.secretKey}:`).toString('base64');
  let inv;
  try {
    const res = await axios.get(`https://api.xendit.co/v2/invoices/${encodeURIComponent(invId)}`, {
      headers: { Authorization: `Basic ${auth}` },
      timeout: 20000,
    });
    inv = res.data;
  } catch (e) {
    return { ok: false, reason: 'XENDIT_FETCH_FAILED' };
  }
  const st = String(inv?.status || '').toUpperCase();
  if (st !== 'PAID' && st !== 'SETTLED') {
    return { ok: false, reason: 'PAYMENT_NOT_PAID' };
  }
  const paidAmount = Number(inv?.amount || row.amount);
  if (!Number.isFinite(paidAmount) || Math.abs(paidAmount - Number(row.amount)) > 0.02) {
    return { ok: false, reason: 'AMOUNT_MISMATCH' };
  }
  const ids = String(row.invoice_ids || '')
    .split(',')
    .map((x) => String(x).trim())
    .filter(Boolean);
  const txn = `xendit:${invId}`;
  const mrk = await markB2bClientInvoicesPaidFromGateway({
    clientdetailId: row.clientdetail_id,
    operatorId: oid,
    invoiceIds: ids,
    transactionId: txn,
    amountMyr: Number(row.amount),
  });
  if (!mrk.ok) return mrk;
  await pool.query(`UPDATE cln_b2b_invoice_checkout SET status = 'paid' WHERE id = ? LIMIT 1`, [chkId]);
  return { ok: true };
}

/**
 * Coliving-style `confirm-payment` after redirect (Stripe session_id, Billplz bill_id, or Xendit checkout_id).
 */
async function confirmClientPortalInvoicePayment(params = {}) {
  const {
    clientdetailId,
    provider: providerRaw,
    sessionId,
    billId,
    checkoutId,
  } = params;
  const cid = String(clientdetailId || '').trim();
  if (!cid) return { ok: false, reason: 'MISSING_CLIENTDETAIL' };
  const provider = String(providerRaw || (sessionId ? 'stripe' : billId ? 'billplz' : checkoutId ? 'xendit' : ''))
    .trim()
    .toLowerCase();
  if (!provider) return { ok: false, reason: 'MISSING_PROVIDER' };
  if (provider === 'stripe') {
    const sid = String(sessionId || '').trim();
    if (!sid) return { ok: false, reason: 'MISSING_SESSION_ID' };
    const Stripe = require('stripe');
    const key = String(process.env.CLEANLEMON_STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY || '').trim();
    if (!key) return { ok: false, reason: 'STRIPE_KEY_MISSING' };
    const stripe = new Stripe(key, { apiVersion: '2024-11-20.acacia' });
    const session = await stripe.checkout.sessions.retrieve(sid);
    const meta = session.metadata || {};
    if (String(meta.type || '').trim() !== 'cleanlemon_client_invoices') {
      return { ok: false, reason: 'WRONG_TYPE' };
    }
    const metaCid = String(meta.clientdetail_id || '').trim();
    if (metaCid && metaCid !== cid) return { ok: false, reason: 'CLIENT_MISMATCH' };
    return applyCleanlemonClientInvoicesFromCheckoutSession(session);
  }
  if (provider === 'billplz') {
    const bid = String(billId || '').trim();
    if (!bid) return { ok: false, reason: 'MISSING_BILL_ID' };
    return confirmClnB2bClientInvoiceBillplzFromBrowser({ clientdetailId: cid, billId: bid });
  }
  if (provider === 'xendit') {
    const xid = String(checkoutId || '').trim();
    if (!xid) return { ok: false, reason: 'MISSING_CHECKOUT_ID' };
    return confirmClnB2bClientInvoiceXenditFromBrowser({ clientdetailId: cid, checkoutId: xid });
  }
  return { ok: false, reason: 'UNSUPPORTED_PROVIDER' };
}

/**
 * Mark B2B client portal invoices paid after any gateway (Stripe / Billplz / Xendit). Idempotent by transactionId.
 */
async function markB2bClientInvoicesPaidFromGateway({
  clientdetailId,
  operatorId,
  invoiceIds,
  transactionId,
  amountMyr
}) {
  const cid = String(clientdetailId || '').trim();
  const oid = String(operatorId || '').trim();
  const ids = [...new Set((invoiceIds || []).map((x) => String(x).trim()).filter(Boolean))];
  const sessionTxnId = String(transactionId || '').trim();
  if (!cid || !oid || !ids.length || !sessionTxnId) return { ok: false, reason: 'MISSING_PARAMS' };

  const [[payTableRow]] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'cln_client_payment'`
  );
  const hasClientPaymentTable = Number(payTableRow?.n || 0) > 0;
  const hasPr = await databaseHasColumn('cln_client_invoice', 'payment_received');
  const hasOpCol = await databaseHasColumn('cln_client_invoice', 'operator_id');
  const hasPayOpCol = hasClientPaymentTable && (await databaseHasColumn('cln_client_payment', 'operator_id'));
  if (!hasClientPaymentTable || !hasPr) return { ok: false, reason: 'SCHEMA_MISSING' };

  const [[dup]] = await pool.query('SELECT id FROM cln_client_payment WHERE transaction_id = ? LIMIT 1', [
    sessionTxnId,
  ]);
  if (dup?.id) return { ok: true, idempotent: true };

  const access = await buildClientPortalInvoiceAccessWhere('i', cid);
  const ph = ids.map(() => '?').join(',');
  const prCol = hasPr ? 'COALESCE(i.payment_received, 0)' : '0';
  const opExpr = hasOpCol ? "COALESCE(NULLIF(TRIM(i.operator_id), ''), '')" : "''";
  const [rows] = await pool.query(
    `SELECT i.id, i.client_id, COALESCE(i.amount, 0) AS amount, ${prCol} AS pr, ${opExpr} AS row_op
     FROM cln_client_invoice i WHERE ${access.sql} AND i.id IN (${ph})`,
    [...access.params, ...ids]
  );
  if (rows.length !== ids.length) return { ok: false, reason: 'INVOICE_ACCESS' };

  const toMark = [];
  let sum = 0;
  for (const r of rows) {
    if (Number(r.pr) === 1) continue;
    if (hasOpCol) {
      const ro = String(r.row_op || '').trim();
      if (ro && ro !== oid) return { ok: false, reason: 'OPERATOR_MISMATCH' };
    }
    sum += Number(r.amount) || 0;
    toMark.push(r);
  }
  if (!toMark.length) return { ok: true, alreadyPaid: true };

  const receivedMyr = Number(amountMyr);
  if (!Number.isFinite(receivedMyr) || Math.abs(sum - receivedMyr) > 0.02) {
    return { ok: false, reason: 'AMOUNT_MISMATCH', expected: sum, received: receivedMyr };
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { randomUUID } = require('crypto');
    const today = new Date().toISOString().slice(0, 10);
    for (const r of toMark) {
      const pid = randomUUID();
      if (hasPayOpCol) {
        await conn.query(
          `INSERT INTO cln_client_payment (id, client_id, operator_id, receipt_number, amount, payment_date, receipt_url, transaction_id, invoice_id, created_at, updated_at)
           VALUES (?, ?, ?, '', ?, ?, NULL, ?, ?, NOW(3), NOW(3))`,
          [pid, r.client_id, oid, Number(r.amount), today, sessionTxnId, r.id]
        );
      } else {
        await conn.query(
          `INSERT INTO cln_client_payment (id, client_id, receipt_number, amount, payment_date, receipt_url, transaction_id, invoice_id, created_at, updated_at)
           VALUES (?, ?, '', ?, ?, NULL, ?, ?, NOW(3), NOW(3))`,
          [pid, r.client_id, Number(r.amount), today, sessionTxnId, r.id]
        );
      }
      await conn.query('UPDATE cln_client_invoice SET payment_received = 1, updated_at = NOW(3) WHERE id = ?', [r.id]);
    }
    await conn.commit();

    const cryptoMod = require('crypto');
    async function insertGatewayPaymentRowForInvoice(r) {
      const pid = cryptoMod.randomUUID();
      if (hasPayOpCol) {
        await pool.query(
          `INSERT INTO cln_client_payment (id, client_id, operator_id, receipt_number, amount, payment_date, receipt_url, transaction_id, invoice_id, created_at, updated_at)
           VALUES (?, ?, ?, '', ?, ?, NULL, ?, ?, NOW(3), NOW(3))`,
          [pid, r.client_id, oid, Number(r.amount), today, sessionTxnId, r.id]
        );
      } else {
        await pool.query(
          `INSERT INTO cln_client_payment (id, client_id, receipt_number, amount, payment_date, receipt_url, transaction_id, invoice_id, created_at, updated_at)
           VALUES (?, ?, '', ?, ?, NULL, ?, ?, NOW(3), NOW(3))`,
          [pid, r.client_id, Number(r.amount), today, sessionTxnId, r.id]
        );
      }
    }

    /** Post receipt to Bukku/Xero (same as operator “Mark as paid”); gateway row is replaced by provider payment row on success. */
    const accountingSyncFailed = [];
    for (const r of toMark) {
      const pr = await clnOpInvAccounting.markPaidAccountingForOperator(oid, r.id, {
        paymentMethod: 'bank',
        paymentDate: today,
      });
      if (!pr.ok && !pr.skipped) {
        accountingSyncFailed.push({ invoiceId: r.id, reason: String(pr.reason || 'FAILED') });
        try {
          const [[cnt]] = await pool.query(
            'SELECT COUNT(*) AS n FROM cln_client_payment WHERE invoice_id = ? LIMIT 1',
            [r.id]
          );
          if (Number(cnt?.n || 0) === 0) {
            await insertGatewayPaymentRowForInvoice(r);
          }
        } catch (re) {
          console.error('[cleanlemon] markB2b: accounting failed and could not restore gateway payment row', r.id, re?.message || re);
        }
      }
    }

    return {
      ok: true,
      marked: toMark.length,
      ...(accountingSyncFailed.length ? { accountingSyncFailed } : {}),
    };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/**
 * Stripe Checkout webhook — mark B2B client invoices paid and insert `cln_client_payment` rows (idempotent by session id).
 * @param {import('stripe').Stripe.Checkout.Session} session
 */
async function applyCleanlemonClientInvoicesFromCheckoutSession(session) {
  const meta = session.metadata || {};
  if (String(meta.type || '').trim() !== 'cleanlemon_client_invoices') {
    return { ok: false, reason: 'WRONG_TYPE' };
  }
  if (String(session.payment_status || '').toLowerCase() !== 'paid') {
    return { ok: false, reason: 'NOT_PAID' };
  }
  const oid = String(meta.operator_id || '').trim();
  const cid = String(meta.clientdetail_id || '').trim();
  const idsStr = String(meta.invoice_ids || '').trim();
  const ids = [...new Set(idsStr.split(',').map((x) => String(x).trim()).filter(Boolean))];
  if (!oid || !cid || !ids.length) return { ok: false, reason: 'MISSING_META' };

  const sessionTxnId = `stripe:${String(session.id)}`;
  const receivedMyr = (typeof session.amount_total === 'number' ? session.amount_total : 0) / 100;
  return markB2bClientInvoicesPaidFromGateway({
    clientdetailId: cid,
    operatorId: oid,
    invoiceIds: ids,
    transactionId: sessionTxnId,
    amountMyr: receivedMyr,
  });
}

/**
 * Client portal — attach proof-of-payment URL to latest `cln_client_payment` per invoice (same access as invoice list).
 * When the client pays by bank transfer first, there may be no payment row yet — insert one with receipt only (invoice stays unpaid).
 */
async function attachClientPortalInvoiceReceipt({ clientdetailId, invoiceIds, receiptUrl }) {
  const cid = String(clientdetailId || '').trim();
  const url = String(receiptUrl || '').trim();
  const ids = [...new Set((invoiceIds || []).map((x) => String(x).trim()).filter(Boolean))];
  if (!cid || !url || !ids.length) return { ok: false, code: 'INVALID_PARAMS' };
  if (!/^https?:\/\//i.test(url)) return { ok: false, code: 'INVALID_RECEIPT_URL' };
  const [[payTableRow]] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'cln_client_payment'`
  );
  if (!Number(payTableRow?.n)) return { ok: false, code: 'NO_PAYMENT_TABLE' };

  const access = await buildClientPortalInvoiceAccessWhere('i', cid);
  const hasPayOpCol = await databaseHasColumn('cln_client_payment', 'operator_id');
  const hasReceiptBatchCol = await databaseHasColumn('cln_client_payment', 'receipt_batch_id');
  const hasPr = await databaseHasColumn('cln_client_invoice', 'payment_received');
  const hasOpCol = await databaseHasColumn('cln_client_invoice', 'operator_id');
  const prExpr = hasPr ? 'COALESCE(i.payment_received, 0)' : '0';
  const { randomUUID } = require('crypto');
  const paymentDateYmd = new Date().toISOString().slice(0, 10);
  const receiptBatchId = randomUUID();

  const idPh = ids.map(() => '?').join(',');
  await pool.query(
    `DELETE p FROM cln_client_payment p
     INNER JOIN cln_client_invoice i ON i.id = p.invoice_id
     WHERE p.invoice_id IN (${idPh})
       AND (${access.sql})
       AND (
         LOWER(TRIM(COALESCE(p.receipt_number, ''))) = 'portal_upload'
         OR TRIM(COALESCE(p.transaction_id, '')) LIKE 'portal_bank_receipt:%'
       )`,
    [...ids, ...access.params]
  );

  let updated = 0;
  for (const invId of ids) {
    const [chk] = await pool.query(
      `SELECT i.id FROM cln_client_invoice i WHERE i.id = ? AND ${access.sql} LIMIT 1`,
      [invId, ...access.params]
    );
    if (!chk.length) return { ok: false, code: 'INVOICE_NOT_FOUND' };

    let invSql = `SELECT i.id, COALESCE(NULLIF(TRIM(i.client_id), ''), '') AS invoice_client_id, COALESCE(i.amount, 0) AS amount, ${prExpr} AS pr`;
    invSql += hasOpCol
      ? `, COALESCE(NULLIF(TRIM(i.operator_id), ''), '') AS operator_id`
      : `, '' AS operator_id`;
    invSql += ` FROM cln_client_invoice i WHERE i.id = ? AND ${access.sql} LIMIT 1`;
    const [[invRow]] = await pool.query(invSql, [invId, ...access.params]);
    if (!invRow?.id) return { ok: false, code: 'INVOICE_NOT_FOUND' };
    if (Number(invRow.pr) === 1) {
      return { ok: false, code: 'INVOICE_ALREADY_PAID' };
    }

    const pid = randomUUID();
    const txnId = `portal_bank_receipt:${randomUUID()}`;
    const payClientId = String(invRow.invoice_client_id || '').trim() || cid;
    const rowOp = String(invRow.operator_id || '').trim();
    const amt = Number(invRow.amount) || 0;

    if (hasPayOpCol && hasReceiptBatchCol) {
      await pool.query(
        `INSERT INTO cln_client_payment (id, client_id, operator_id, receipt_number, amount, payment_date, receipt_url, transaction_id, receipt_batch_id, invoice_id, created_at, updated_at)
         VALUES (?, ?, ?, 'portal_upload', ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
        [pid, payClientId || null, rowOp || null, amt, paymentDateYmd, url, txnId, receiptBatchId, invId]
      );
    } else if (hasPayOpCol) {
      await pool.query(
        `INSERT INTO cln_client_payment (id, client_id, operator_id, receipt_number, amount, payment_date, receipt_url, transaction_id, invoice_id, created_at, updated_at)
         VALUES (?, ?, ?, 'portal_upload', ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
        [pid, payClientId || null, rowOp || null, amt, paymentDateYmd, url, txnId, invId]
      );
    } else if (hasReceiptBatchCol) {
      await pool.query(
        `INSERT INTO cln_client_payment (id, client_id, receipt_number, amount, payment_date, receipt_url, transaction_id, receipt_batch_id, invoice_id, created_at, updated_at)
         VALUES (?, ?, 'portal_upload', ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
        [pid, payClientId || null, amt, paymentDateYmd, url, txnId, receiptBatchId, invId]
      );
    } else {
      await pool.query(
        `INSERT INTO cln_client_payment (id, client_id, receipt_number, amount, payment_date, receipt_url, transaction_id, invoice_id, created_at, updated_at)
         VALUES (?, ?, 'portal_upload', ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
        [pid, payClientId || null, amt, paymentDateYmd, url, txnId, invId]
      );
    }
    updated += 1;
  }
  if (updated < ids.length) return { ok: false, code: 'NO_PAYMENT_ROW', updated };
  return { ok: true, updated, receiptBatchId: hasReceiptBatchCol ? receiptBatchId : undefined };
}

function paymentQueueCreatedAtSecondKey(createdAt) {
  const t = createdAt ? Date.parse(String(createdAt)) : NaN;
  if (!Number.isFinite(t)) return '0';
  return String(Math.floor(t / 1000));
}

function normalizeOperatorPaymentQueueBatchItem(receiptBatchId, group) {
  const sorted = [...group].sort((a, b) => {
    const ca = Date.parse(String(a.createdAt || '')) || 0;
    const cb = Date.parse(String(b.createdAt || '')) || 0;
    return cb - ca;
  });
  const first = sorted[0];
  const paymentIds = sorted.map((x) => String(x.paymentId || '').trim()).filter(Boolean);
  const invoiceIds = sorted.map((x) => String(x.invoiceId || '').trim()).filter(Boolean);
  const invoiceNos = sorted.map((x) => String(x.invoiceNo || '').trim());
  const amounts = sorted.map((x) => Number(x.amount) || 0);
  const totalAmount = amounts.reduce((s, n) => s + n, 0);
  let maxCreated = first.createdAt;
  for (const x of sorted) {
    const t = Date.parse(String(x.createdAt || '')) || 0;
    const m = Date.parse(String(maxCreated || '')) || 0;
    if (t > m) maxCreated = x.createdAt;
  }
  const bid =
    receiptBatchId != null && String(receiptBatchId).trim() !== '' ? String(receiptBatchId).trim() : null;
  const paymentId = bid || `legacy:${paymentIds.slice().sort().join('-')}`;
  /** Several invoices in one upload — not “batch” when only one payment row. */
  const isBatch = paymentIds.length > 1;
  const joinedNo = invoiceNos.filter((n) => n).join(', ');
  return {
    paymentId,
    receiptBatchId: bid,
    isBatch,
    paymentIds,
    invoiceIds,
    invoiceNos,
    amounts,
    amount: totalAmount,
    totalAmount,
    invoiceId: invoiceIds[0] || '',
    invoiceNo: joinedNo || invoiceIds.join(', '),
    receiptUrl: first.receiptUrl,
    transactionId: first.transactionId,
    receiptNumber: first.receiptNumber,
    paymentDate: first.paymentDate,
    createdAt: maxCreated,
    operatorAckAt: first.operatorAckAt,
    invoicePaid: sorted.some((x) => Number(x.invoicePaid) === 1) ? 1 : 0,
    clientName: first.clientName,
    clientEmail: first.clientEmail,
  };
}

function normalizeOperatorPaymentQueueSingleItem(r) {
  const pid = String(r.paymentId || '').trim();
  const iid = String(r.invoiceId || '').trim();
  const amt = Number(r.amount) || 0;
  const bid =
    r.receiptBatchId != null && String(r.receiptBatchId).trim() !== '' ? String(r.receiptBatchId).trim() : null;
  return {
    ...r,
    isBatch: false,
    receiptBatchId: bid,
    paymentIds: [pid],
    invoiceIds: [iid],
    invoiceNos: [String(r.invoiceNo || '').trim()],
    amounts: [amt],
    totalAmount: amt,
  };
}

/** Operator portal — recent client payments on this operator’s invoices (Stripe + manual). */
async function listOperatorClientPaymentQueue({ operatorId, limit = 120 } = {}) {
  const oid = String(operatorId || '').trim();
  if (!oid) return { items: [] };
  const [[payTableRow]] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'cln_client_payment'`
  );
  if (!Number(payTableRow?.n)) return { items: [] };
  const hasAck = await databaseHasColumn('cln_client_payment', 'operator_ack_at');
  const ackSel = hasAck ? 'p.operator_ack_at AS operatorAckAt' : 'NULL AS operatorAckAt';
  const lim = Math.min(Math.max(Number(limit) || 120, 1), 500);
  const hasOpCol = await databaseHasColumn('cln_client_invoice', 'operator_id');
  if (!hasOpCol) return { items: [] };
  const hasReceiptBatchCol = await databaseHasColumn('cln_client_payment', 'receipt_batch_id');
  const batchSel = hasReceiptBatchCol ? 'p.receipt_batch_id AS receiptBatchId' : 'NULL AS receiptBatchId';
  const [rows] = await pool.query(
    `SELECT p.id AS paymentId, p.invoice_id AS invoiceId, p.amount, p.payment_date AS paymentDate,
            p.receipt_url AS receiptUrl, p.transaction_id AS transactionId, p.created_at AS createdAt,
            p.receipt_number AS receiptNumber,
            ${batchSel},
            ${ackSel},
            COALESCE(NULLIF(TRIM(i.invoice_number), ''), i.id) AS invoiceNo,
            COALESCE(i.payment_received, 0) AS invoicePaid,
            COALESCE(NULLIF(TRIM(cd.fullname), ''), NULLIF(TRIM(cd.email), ''), '') AS clientName,
            COALESCE(NULLIF(TRIM(cd.email), ''), '') AS clientEmail
     FROM cln_client_payment p
     INNER JOIN cln_client_invoice i ON i.id = p.invoice_id
     LEFT JOIN cln_clientdetail cd ON cd.id = i.client_id
     WHERE COALESCE(NULLIF(TRIM(i.operator_id), ''), '') = ?
       AND COALESCE(i.payment_received, 0) <> 1
       AND NULLIF(TRIM(COALESCE(p.receipt_url, '')), '') IS NOT NULL
       AND NULLIF(TRIM(COALESCE(p.receipt_url, '')), '') LIKE 'http%'
       AND (
         LOWER(TRIM(COALESCE(p.receipt_number, ''))) = 'portal_upload'
         OR TRIM(COALESCE(p.transaction_id, '')) LIKE 'portal_bank_receipt:%'
       )
     ORDER BY p.created_at DESC
     LIMIT ?`,
    [oid, lim]
  );
  const list = rows || [];
  const consumed = new Set();
  const items = [];

  const byBatch = new Map();
  for (const r of list) {
    const bid = r.receiptBatchId != null ? String(r.receiptBatchId).trim() : '';
    if (!bid) continue;
    if (!byBatch.has(bid)) byBatch.set(bid, []);
    byBatch.get(bid).push(r);
  }
  for (const [bid, group] of byBatch) {
    for (const r of group) consumed.add(String(r.paymentId));
    items.push(normalizeOperatorPaymentQueueBatchItem(bid, group));
  }

  const remaining = list.filter((r) => !consumed.has(String(r.paymentId)));
  const legacyUsed = new Set();
  for (const r of remaining) {
    const pid = String(r.paymentId);
    if (legacyUsed.has(pid)) continue;
    const url = String(r.receiptUrl || '').trim();
    const email = String(r.clientEmail || '').trim().toLowerCase();
    const sec = paymentQueueCreatedAtSecondKey(r.createdAt);
    const cluster = [r];
    legacyUsed.add(pid);
    for (const r2 of remaining) {
      const pid2 = String(r2.paymentId);
      if (legacyUsed.has(pid2)) continue;
      if (String(r2.receiptUrl || '').trim() !== url) continue;
      if (String(r2.clientEmail || '').trim().toLowerCase() !== email) continue;
      if (paymentQueueCreatedAtSecondKey(r2.createdAt) !== sec) continue;
      cluster.push(r2);
      legacyUsed.add(pid2);
    }
    if (cluster.length > 1) {
      items.push(normalizeOperatorPaymentQueueBatchItem(null, cluster));
    } else {
      items.push(normalizeOperatorPaymentQueueSingleItem(cluster[0]));
    }
  }

  items.sort((a, b) => {
    const ta = Date.parse(String(a.createdAt || '')) || 0;
    const tb = Date.parse(String(b.createdAt || '')) || 0;
    return tb - ta;
  });

  return { items };
}

async function acknowledgeOperatorClientPayment({ operatorId, paymentId }) {
  const oid = String(operatorId || '').trim();
  const pid = String(paymentId || '').trim();
  if (!oid || !pid) return { ok: false, reason: 'INVALID_PARAMS' };
  const hasAck = await databaseHasColumn('cln_client_payment', 'operator_ack_at');
  if (!hasAck) return { ok: true, skipped: true };
  const [r] = await pool.query(
    `UPDATE cln_client_payment p
     INNER JOIN cln_client_invoice i ON i.id = p.invoice_id
     SET p.operator_ack_at = NOW(3), p.updated_at = NOW(3)
     WHERE p.id = ? AND COALESCE(NULLIF(TRIM(i.operator_id), ''), '') = ?`,
    [pid, oid]
  );
  if (!Number(r.affectedRows)) return { ok: false, reason: 'NOT_FOUND' };
  return { ok: true };
}

/**
 * Operator rejects a client-portal uploaded receipt row (invoice stays unpaid; client can upload again).
 */
async function rejectOperatorClientPortalReceipt({ operatorId, paymentId }) {
  const oid = String(operatorId || '').trim();
  const pid = String(paymentId || '').trim();
  if (!oid || !pid) return { ok: false, reason: 'INVALID_PARAMS' };
  const hasOpCol = await databaseHasColumn('cln_client_invoice', 'operator_id');
  if (!hasOpCol) return { ok: false, reason: 'SCHEMA_MISSING' };
  const hasPr = await databaseHasColumn('cln_client_invoice', 'payment_received');
  const prExpr = hasPr ? 'COALESCE(i.payment_received, 0)' : '0';
  const [[row]] = await pool.query(
    `SELECT p.id, p.receipt_number AS receiptNumber, p.transaction_id AS transactionId,
            ${prExpr} AS pr
     FROM cln_client_payment p
     INNER JOIN cln_client_invoice i ON i.id = p.invoice_id
     WHERE p.id = ? AND COALESCE(NULLIF(TRIM(i.operator_id), ''), '') = ?
     LIMIT 1`,
    [pid, oid]
  );
  if (!row?.id) return { ok: false, reason: 'NOT_FOUND' };
  if (Number(row.pr) === 1) return { ok: false, reason: 'INVOICE_ALREADY_PAID' };
  const rn = String(row.receiptNumber || '').trim().toLowerCase();
  const tid = String(row.transactionId || '').trim();
  const isPortal = rn === 'portal_upload' || tid.startsWith('portal_bank_receipt:');
  if (!isPortal) return { ok: false, reason: 'NOT_CLIENT_PORTAL_RECEIPT' };
  const [del] = await pool.query('DELETE FROM cln_client_payment WHERE id = ? LIMIT 1', [pid]);
  if (!Number(del.affectedRows)) return { ok: false, reason: 'DELETE_FAILED' };
  return { ok: true };
}

/**
 * Operator rejects all client-portal receipt rows in one upload batch (`receipt_batch_id`),
 * or a caller-supplied list of `paymentIds` (legacy same-second / same-url clusters).
 */
async function rejectOperatorClientPortalReceiptBatch({ operatorId, receiptBatchId, paymentIds } = {}) {
  const oid = String(operatorId || '').trim();
  const bid = String(receiptBatchId || '').trim();
  const ids = Array.isArray(paymentIds)
    ? [...new Set(paymentIds.map((x) => String(x || '').trim()).filter(Boolean))].slice(0, 80)
    : [];
  if (!oid) return { ok: false, reason: 'INVALID_PARAMS' };
  if (!bid && !ids.length) return { ok: false, reason: 'INVALID_PARAMS' };
  if (bid && ids.length) return { ok: false, reason: 'INVALID_PARAMS' };
  const hasOpCol = await databaseHasColumn('cln_client_invoice', 'operator_id');
  if (!hasOpCol) return { ok: false, reason: 'SCHEMA_MISSING' };
  const hasPr = await databaseHasColumn('cln_client_invoice', 'payment_received');
  const prExpr = hasPr ? 'COALESCE(i.payment_received, 0)' : '0';
  const hasReceiptBatchCol = await databaseHasColumn('cln_client_payment', 'receipt_batch_id');
  const portalSql = `(
      LOWER(TRIM(COALESCE(p.receipt_number, ''))) = 'portal_upload'
      OR TRIM(COALESCE(p.transaction_id, '')) LIKE 'portal_bank_receipt:%'
    )`;

  if (bid) {
    if (!hasReceiptBatchCol) return { ok: false, reason: 'BATCH_NOT_SUPPORTED' };
    const [del] = await pool.query(
      `DELETE p FROM cln_client_payment p
       INNER JOIN cln_client_invoice i ON i.id = p.invoice_id
       WHERE COALESCE(NULLIF(TRIM(i.operator_id), ''), '') = ?
         AND p.receipt_batch_id = ?
         AND ${prExpr} <> 1
         AND ${portalSql}`,
      [oid, bid]
    );
    if (!Number(del.affectedRows)) return { ok: false, reason: 'NOT_FOUND' };
    return { ok: true, deleted: Number(del.affectedRows) };
  }

  if (!ids.length) return { ok: false, reason: 'INVALID_PARAMS' };
  const ph = ids.map(() => '?').join(',');
  const [del] = await pool.query(
    `DELETE p FROM cln_client_payment p
     INNER JOIN cln_client_invoice i ON i.id = p.invoice_id
     WHERE COALESCE(NULLIF(TRIM(i.operator_id), ''), '') = ?
       AND p.id IN (${ph})
       AND ${prExpr} <> 1
       AND ${portalSql}`,
    [oid, ...ids]
  );
  if (!Number(del.affectedRows)) return { ok: false, reason: 'NOT_FOUND' };
  return { ok: true, deleted: Number(del.affectedRows) };
}

/**
 * B2B client portal: bank transfer details from operator Company profile (same fields as /operator/company).
 * Used when online card payment (Stripe Connect) is not available.
 */
async function getClientPortalOperatorBankTransferInfo(operatorId) {
  const oid = String(operatorId || '').trim();
  if (!oid) {
    return { ok: false, code: 'INVALID_PARAMS' };
  }
  const settings = await getOperatorSettings(oid);
  const cp =
    settings && settings.companyProfile && typeof settings.companyProfile === 'object'
      ? settings.companyProfile
      : {};
  const bankdetailId = String(cp.bankdetailId || '').trim();
  const accountNumber = String(cp.accountNumber || '').trim();
  const accountHolder = String(cp.accountHolder || '').trim();
  let bankName = String(cp.bank || '').trim();
  if (bankdetailId) {
    try {
      const [br] = await pool.query('SELECT bankname FROM bankdetail WHERE id = ? LIMIT 1', [bankdetailId]);
      if (br.length && br[0].bankname) bankName = String(br[0].bankname || '').trim();
    } catch (_) {
      /* keep legacy bank label */
    }
  }
  return {
    ok: true,
    bankName,
    accountNumber,
    accountHolder,
    companyName: String(cp.companyName || '').trim()
  };
}

async function updateInvoiceStatus(id, status, opts = {}) {
  let operatorId = String(opts.operatorId || '').trim();
  if (!operatorId) {
    const hasOpCol = await databaseHasColumn('cln_client_invoice', 'operator_id');
    if (hasOpCol) {
      const [[row]] = await pool.query(
        'SELECT operator_id FROM cln_client_invoice WHERE id = ? LIMIT 1',
        [String(id)]
      );
      if (row?.operator_id != null && String(row.operator_id).trim() !== '') {
        operatorId = String(row.operator_id).trim();
      }
    }
  }
  const st = String(status || '').trim().toLowerCase();

  if (operatorId && st === 'overdue') {
    const vr = await clnOpInvAccounting.voidPaymentAccountingForOperator(operatorId, id);
    if (!vr.ok && !vr.skipped) {
      const err = new Error(vr.reason || 'VOID_ACCOUNTING_FAILED');
      throw err;
    }
  }

  if (operatorId && st === 'paid') {
    const pr = await clnOpInvAccounting.markPaidAccountingForOperator(operatorId, id, {
      paymentMethod: opts.paymentMethod,
      paymentDate: opts.paymentDate
    });
    if (!pr.ok && !pr.skipped) {
      const err = new Error(pr.reason || 'PAYMENT_ACCOUNTING_FAILED');
      throw err;
    }
  }

  const isPaid = st === 'paid' ? 1 : 0;
  await pool.query(
    'UPDATE cln_client_invoice SET payment_received = ?, updated_at = NOW(3) WHERE id = ? LIMIT 1',
    [isPaid, String(id)]
  );
}

async function deleteInvoice(id, operatorId) {
  let oid = String(operatorId || '').trim();
  if (!oid) {
    const hasOpCol = await databaseHasColumn('cln_client_invoice', 'operator_id');
    if (hasOpCol) {
      const [[row]] = await pool.query(
        'SELECT operator_id FROM cln_client_invoice WHERE id = ? LIMIT 1',
        [String(id)]
      );
      if (row?.operator_id != null && String(row.operator_id).trim() !== '') {
        oid = String(row.operator_id).trim();
      }
    }
  }
  if (oid) {
    const dr = await clnOpInvAccounting.deleteInvoiceAccountingForOperator(oid, id);
    if (!dr.ok && !dr.skipped) {
      const err = new Error(dr.reason || 'DELETE_ACCOUNTING_FAILED');
      throw err;
    }
  }
  await pool.query('DELETE FROM cln_client_payment WHERE invoice_id = ?', [String(id)]);
  await pool.query('DELETE FROM cln_client_invoice WHERE id = ? LIMIT 1', [String(id)]);
}

function escapeHtmlForInvoiceEmail(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Email to client bill-to address using the same SMTP as portal password reset (CLEANLEMON_SMTP_* on Cleanlemons).
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
async function sendOperatorInvoicePaymentReminder(_req, { invoiceId, operatorId } = {}) {
  const iid = String(invoiceId || '').trim();
  const oid = String(operatorId || '').trim();
  if (!iid) return { ok: false, reason: 'MISSING_INVOICE_ID' };
  if (!oid) return { ok: false, reason: 'MISSING_OPERATOR_ID' };

  const ct = await getClnCompanyTable();
  const hasOpCol = await databaseHasColumn('cln_client_invoice', 'operator_id');
  const hasPaymentReceivedCol = await databaseHasColumn('cln_client_invoice', 'payment_received');
  const hasPdfUrlCol = await databaseHasColumn('cln_client_invoice', 'pdf_url');
  const hasIssueDateCol = await databaseHasColumn('cln_client_invoice', 'issue_date');
  const hasDueDateCol = await databaseHasColumn('cln_client_invoice', 'due_date');
  const paymentReceivedExpr = hasPaymentReceivedCol ? 'COALESCE(i.payment_received, 0)' : '0';
  const pdfUrlExpr = hasPdfUrlCol ? "NULLIF(TRIM(COALESCE(i.pdf_url, '')), '')" : 'NULL';
  const issueDateSql = hasIssueDateCol
    ? `DATE_FORMAT(COALESCE(i.issue_date, DATE(i.created_at)), '%Y-%m-%d')`
    : `DATE_FORMAT(COALESCE(i.created_at, NOW()), '%Y-%m-%d')`;
  const dueDateFromDbSql = hasDueDateCol ? `DATE_FORMAT(i.due_date, '%Y-%m-%d')` : `NULL`;
  const opWhere = hasOpCol ? ' AND i.operator_id = ? ' : '';
  const params = hasOpCol ? [iid, oid] : [iid];

  const [rows] = await pool.query(
    `SELECT i.id,
      COALESCE(i.invoice_number, i.id) AS invoiceNo,
      COALESCE(
        NULLIF(TRIM(cd.fullname), ''),
        NULLIF(TRIM(c.name), ''),
        ''
      ) AS clientName,
      COALESCE(NULLIF(TRIM(cd.email), ''), NULLIF(TRIM(c.email), ''), '') AS clientEmail,
      COALESCE(i.amount, 0) AS amount,
      ${paymentReceivedExpr} AS paymentReceived,
      ${issueDateSql} AS issueDate,
      ${dueDateFromDbSql} AS dueDateFromDb,
      ${pdfUrlExpr} AS pdfUrl,
      ${hasOpCol ? `COALESCE(NULLIF(TRIM(i.operator_id), ''), '') AS operatorId` : `'' AS operatorId`}
     FROM cln_client_invoice i
     LEFT JOIN cln_clientdetail cd ON cd.id = i.client_id
     LEFT JOIN \`${ct}\` c ON c.id = i.client_id
     WHERE i.id = ?
     ${opWhere}
     LIMIT 1`,
    params
  );
  const r = rows && rows[0];
  if (!r) return { ok: false, reason: 'INVOICE_NOT_FOUND' };
  if (hasOpCol && String(r.operatorId || '').trim() !== oid) {
    return { ok: false, reason: 'FORBIDDEN_OPERATOR' };
  }

  const paid = Number(r.paymentReceived || 0) === 1;
  if (paid) return { ok: false, reason: 'INVOICE_ALREADY_PAID' };

  const to = String(r.clientEmail || '').trim();
  if (!to) return { ok: false, reason: 'MISSING_CLIENT_EMAIL' };

  const settingsMap = await getOperatorSettingsJsonMapForOperatorIds([oid]);
  const enriched = enrichInvoiceRowStatusAndDue(
    {
      issueDate: r.issueDate,
      dueDateFromDb: r.dueDateFromDb,
      paymentReceived: r.paymentReceived,
      operatorId: oid,
    },
    settingsMap
  );
  const st = enriched.status;
  if (st === 'paid') return { ok: false, reason: 'INVOICE_ALREADY_PAID' };
  if (st !== 'pending' && st !== 'overdue') {
    return { ok: false, reason: 'REMINDER_NOT_APPLICABLE' };
  }

  /** Cleanlemons-only route — always use CLEANLEMON_SMTP_* / CLEANLEMON_PORTAL_RESET_FROM_*. */
  const portalProduct = 'cleanlemons';
  const invoiceNo = String(r.invoiceNo || iid);
  const clientName = String(r.clientName || 'customer').trim() || 'customer';
  const amountStr = Number(r.amount || 0).toFixed(2);
  const dueLine = enriched.dueDate ? `Due date: ${enriched.dueDate}\n` : '';
  const pdfRaw = r.pdfUrl != null && String(r.pdfUrl).trim() !== '' ? String(r.pdfUrl).trim() : '';
  const pdfLine = pdfRaw ? `Invoice link: ${pdfRaw}\n` : '';

  const subject = `Payment reminder: ${invoiceNo}`;
  const textBody = `Dear ${clientName},\n\nPlease arrange payment for invoice ${invoiceNo} (RM ${amountStr}).\n${dueLine}${pdfLine}\nThank you.`;
  const htmlBody = `<p>Dear ${escapeHtmlForInvoiceEmail(clientName)},</p>
<p>Please arrange payment for invoice <strong>${escapeHtmlForInvoiceEmail(invoiceNo)}</strong> (RM ${escapeHtmlForInvoiceEmail(amountStr)}).</p>
${enriched.dueDate ? `<p>Due date: <strong>${escapeHtmlForInvoiceEmail(enriched.dueDate)}</strong></p>` : ''}
${pdfRaw ? `<p><a href="${escapeHtmlForInvoiceEmail(pdfRaw)}">View invoice</a></p>` : ''}
<p>Thank you.</p>`;

  return sendTransactionalEmail(portalProduct, to, subject, textBody, htmlBody);
}

async function ensureClnAgreementExtraColumns() {
  if (_clnAgreementExtraColsEnsured) return;
  const stmts = [
    'ALTER TABLE cln_operator_agreement ADD COLUMN operator_id CHAR(36) NULL',
    'ALTER TABLE cln_operator_agreement ADD COLUMN automation_rule_id VARCHAR(128) NULL',
    'ALTER TABLE cln_operator_agreement ADD COLUMN template_id VARCHAR(64) NULL',
    'ALTER TABLE cln_operator_agreement ADD COLUMN final_agreement_url TEXT NULL',
    'ALTER TABLE cln_operator_agreement ADD COLUMN hash_draft VARCHAR(128) NULL',
    'ALTER TABLE cln_operator_agreement ADD COLUMN hash_final VARCHAR(128) NULL'
  ];
  for (const sql of stmts) {
    try {
      await pool.query(sql);
    } catch (e) {
      const msg = String(e?.sqlMessage || e?.message || '');
      if (!/Duplicate column/i.test(msg)) console.warn('[cleanlemon] cln_operator_agreement ALTER:', msg);
    }
  }
  _clnAgreementExtraColsEnsured = true;
}

/**
 * Old builds used `pending_client_sign` for “operator signs next”. Correct semantics:
 * client = operator’s customer; operator company signs under `pending_operator_sign`.
 * One-time fix for rows with no template_id (legacy).
 */
async function migrateClnAgreementPendingClientMislabel() {
  await ensureClnAgreementExtraColumns();
  const hasTid = await databaseHasColumn('cln_operator_agreement', 'template_id');
  if (!hasTid) return;
  try {
    await pool.query(
      `UPDATE cln_operator_agreement
       SET status = 'pending_operator_sign'
       WHERE status = 'pending_client_sign' AND (template_id IS NULL OR template_id = '')`
    );
  } catch (e) {
    console.warn('[cleanlemon] migrateClnAgreementPendingClientMislabel', e?.message || e);
  }
}

async function ensureAgreementTables() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS cln_operator_agreement (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      recipient_name VARCHAR(255) NOT NULL,
      recipient_email VARCHAR(255) NOT NULL,
      recipient_type VARCHAR(64) NOT NULL,
      template_name VARCHAR(255) NOT NULL,
      salary DECIMAL(14,2) NULL,
      start_date DATE NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'draft',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      signed_at TIMESTAMP NULL DEFAULT NULL,
      signed_meta_json JSON NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
  // MySQL < 8.0.12 does not support ADD COLUMN IF NOT EXISTS; use try/catch for existing DBs.
  try {
    await pool.query(
      `ALTER TABLE cln_operator_agreement ADD COLUMN signed_meta_json JSON NULL AFTER signed_at`
    );
  } catch (e) {
    const msg = String(e?.sqlMessage || e?.message || '');
    if (!/Duplicate column/i.test(msg)) console.warn('[cleanlemon] signed_meta_json column:', msg);
  }
  await ensureClnAgreementExtraColumns();
  await migrateClnAgreementPendingClientMislabel();
  try {
    await pool.query(
      `UPDATE cln_operator_agreement
       SET status = 'signing'
       WHERE status IN ('pending_staff_sign','pending_client_sign','pending_operator_sign')`
    );
  } catch (e) {
    console.warn('[cleanlemon] migrate signing status', e?.message || e);
  }
  await pool.query(
    `CREATE TABLE IF NOT EXISTS cln_operator_agreement_template (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      operator_id CHAR(36) NULL,
      name VARCHAR(255) NOT NULL,
      mode VARCHAR(64) NOT NULL,
      template_url TEXT NOT NULL,
      folder_url TEXT NOT NULL,
      description TEXT NULL,
      last_updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

function clnPortalProfileCompleteForAutomation(profile) {
  if (!profile || typeof profile !== 'object') return false;
  const name = String(profile.fullname || '')
    .trim()
    || [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim();
  const phone = String(profile.phone || '').trim();
  const address = String(profile.address || '').trim();
  const nric = String(profile.nric || '').trim();
  return !!(name && phone && address && nric);
}

function clnCompanyProfileCompleteForAutomation(cp) {
  if (!cp || typeof cp !== 'object') return false;
  const companyName = String(cp.companyName || '').trim();
  const ssm = String(cp.ssmNumber || cp.ssm || '').trim();
  const address = String(cp.address || '').trim();
  const contact = String(cp.contact || cp.contactPhone || '').trim();
  return !!(companyName && ssm && address && contact);
}

/** Agreement automation removed — agreements are created only via operator portal (manual). */
async function tryAgreementAutomationForOperatorStaffEmail() {
  return { ok: true, skipped: 'automation_disabled' };
}
async function runAgreementAutomationForStaffEmailAcrossOperators() {}
async function tryAgreementAutomationForWholeOperator() {}

async function listAgreements(operatorId) {
  await ensureAgreementTables();
  await ensureClnAgreementExtraColumns();
  const hasTid = await databaseHasColumn('cln_operator_agreement', 'template_id');
  const hasFinalUrl = await databaseHasColumn('cln_operator_agreement', 'final_agreement_url');
  const hasOpAgr = await databaseHasColumn('cln_operator_agreement', 'operator_id');
  const hasHashCols = await databaseHasColumn('cln_operator_agreement', 'hash_final');
  const ct = await getClnCompanyTable();
  const oid = String(operatorId || '').trim();
  /** Avoid utf8mb4_unicode_ci vs utf8mb4_0900_ai_ci mix on CHAR UUID joins (MySQL 8). */
  const opIdCmp = (leftCol, rightCol) =>
    `CAST(${leftCol} AS CHAR(36)) COLLATE utf8mb4_unicode_ci <=> CAST(${rightCol} AS CHAR(36)) COLLATE utf8mb4_unicode_ci`;
  const opWhere =
    hasOpAgr && oid
      ? hasTid
        ? ` WHERE ${opIdCmp('a.operator_id', '?')}`
        : ` WHERE ${opIdCmp('operator_id', '?')}`
      : '';
  const opParams = hasOpAgr && oid ? [oid] : [];
  const hashSel = hasHashCols ? ', a.hash_draft AS hashDraft, a.hash_final AS hashFinal' : '';
  const finalSel = hasFinalUrl ? ', a.final_agreement_url AS finalAgreementUrl' : '';
  const opCompanySel = hasOpAgr
    ? `, COALESCE(od.name, '') AS operatorCompanyName`
    : `, '' AS operatorCompanyName`;
  const opCompanyJoin = hasOpAgr
    ? `LEFT JOIN \`${ct}\` od ON ${opIdCmp('od.id', 'a.operator_id')} `
    : '';
  const sql = hasTid
    ? `SELECT a.id, a.recipient_name AS recipientName, a.recipient_email AS recipientEmail, a.recipient_type AS recipientType,
              a.template_name AS templateName, a.template_id AS templateId, t.mode AS templateMode, a.salary,
              DATE_FORMAT(a.start_date, '%Y-%m-%d') AS startDate,
              a.status, DATE_FORMAT(a.created_at, '%Y-%m-%d') AS createdAt,
              DATE_FORMAT(a.signed_at, '%Y-%m-%d') AS signedAt,
              a.signed_meta_json AS signedMetaJson${finalSel}${hashSel}${opCompanySel}
       FROM cln_operator_agreement a
       LEFT JOIN cln_operator_agreement_template t ON t.id = a.template_id
       ${opCompanyJoin}${opWhere}
       ORDER BY a.created_at DESC`
    : `SELECT id, recipient_name AS recipientName, recipient_email AS recipientEmail, recipient_type AS recipientType,
              template_name AS templateName, salary,
              DATE_FORMAT(start_date, '%Y-%m-%d') AS startDate,
              status, DATE_FORMAT(created_at, '%Y-%m-%d') AS createdAt,
              DATE_FORMAT(signed_at, '%Y-%m-%d') AS signedAt,
              signed_meta_json AS signedMetaJson${
                hasFinalUrl ? ', final_agreement_url AS finalAgreementUrl' : ''
              }${
                hasHashCols ? ', hash_draft AS hashDraft, hash_final AS hashFinal' : ''
              }${
                hasOpAgr
                  ? `, (SELECT COALESCE(name,'') FROM \`${ct}\` od2 WHERE ${opIdCmp(
                      'od2.id',
                      'cln_operator_agreement.operator_id'
                    )} LIMIT 1) AS operatorCompanyName`
                  : `, '' AS operatorCompanyName`
              }
       FROM cln_operator_agreement${opWhere}
       ORDER BY created_at DESC`;
  const [rows] = await pool.query(sql, opParams);
  return rows.map((r) => ({
    ...r,
    signedMeta: safeJson(r.signedMetaJson, null),
  }));
}

/**
 * B2B client portal: agreements where this login email is the named recipient and template is operator–client.
 */
async function listAgreementsForClientPortal(clientEmail) {
  const em = String(clientEmail || '').trim().toLowerCase();
  if (!em) return [];
  await ensureAgreementTables();
  await ensureClnAgreementExtraColumns();
  const hasTid = await databaseHasColumn('cln_operator_agreement', 'template_id');
  const hasFinalUrl = await databaseHasColumn('cln_operator_agreement', 'final_agreement_url');
  const hasOpAgr = await databaseHasColumn('cln_operator_agreement', 'operator_id');
  const hasHashCols = await databaseHasColumn('cln_operator_agreement', 'hash_final');
  const ct = await getClnCompanyTable();
  const opIdJoin = (a, b) =>
    `CAST(${a} AS CHAR(36)) COLLATE utf8mb4_unicode_ci <=> CAST(${b} AS CHAR(36)) COLLATE utf8mb4_unicode_ci`;
  const hashSel = hasHashCols ? ', a.hash_draft AS hashDraft, a.hash_final AS hashFinal' : '';
  const finalSel = hasFinalUrl ? ', a.final_agreement_url AS finalAgreementUrl' : '';
  const opCompanySel = hasOpAgr ? `, COALESCE(od.name, '') AS operatorCompanyName` : `, '' AS operatorCompanyName`;
  const opCompanyJoin = hasOpAgr ? `LEFT JOIN \`${ct}\` od ON ${opIdJoin('od.id', 'a.operator_id')} ` : '';
  if (!hasTid) {
    const hashSelLegacy = hasHashCols ? ', hash_draft AS hashDraft, hash_final AS hashFinal' : '';
    const [rows] = await pool.query(
      `SELECT id, recipient_name AS recipientName, recipient_email AS recipientEmail, recipient_type AS recipientType,
              template_name AS templateName, salary,
              DATE_FORMAT(start_date, '%Y-%m-%d') AS startDate,
              status, DATE_FORMAT(created_at, '%Y-%m-%d') AS createdAt,
              DATE_FORMAT(signed_at, '%Y-%m-%d') AS signedAt,
              signed_meta_json AS signedMetaJson${hasFinalUrl ? ', final_agreement_url AS finalAgreementUrl' : ''}${hashSelLegacy}
       FROM cln_operator_agreement
       WHERE LOWER(TRIM(recipient_email)) = ?
       ORDER BY created_at DESC`,
      [em]
    );
    return rows.map((r) => ({
      ...r,
      signedMeta: safeJson(r.signedMetaJson, null),
    }));
  }
  const [rows] = await pool.query(
    `SELECT a.id, a.recipient_name AS recipientName, a.recipient_email AS recipientEmail, a.recipient_type AS recipientType,
            a.template_name AS templateName, a.template_id AS templateId, t.mode AS templateMode, a.salary,
            DATE_FORMAT(a.start_date, '%Y-%m-%d') AS startDate,
            a.status, DATE_FORMAT(a.created_at, '%Y-%m-%d') AS createdAt,
            DATE_FORMAT(a.signed_at, '%Y-%m-%d') AS signedAt,
            a.signed_meta_json AS signedMetaJson${finalSel}${hashSel}${opCompanySel}
     FROM cln_operator_agreement a
     INNER JOIN cln_operator_agreement_template t ON t.id = a.template_id
     ${opCompanyJoin}
     WHERE LOWER(TRIM(a.recipient_email)) = ? AND t.mode = 'operator_client'
     ORDER BY a.created_at DESC`,
    [em]
  );
  return rows.map((r) => ({
    ...r,
    signedMeta: safeJson(r.signedMetaJson, null),
  }));
}

async function clnPersistHashDraftIfEmpty(agreementId, pdfBuffer) {
  const id = String(agreementId || '').trim();
  if (!id || !pdfBuffer?.length) return;
  const hasCol = await databaseHasColumn('cln_operator_agreement', 'hash_draft');
  if (!hasCol) return;
  const hex = crypto.createHash('sha256').update(pdfBuffer).digest('hex');
  try {
    await pool.query(
      `UPDATE cln_operator_agreement SET hash_draft = ?, created_at = created_at WHERE id = ? AND (hash_draft IS NULL OR TRIM(COALESCE(hash_draft,'')) = '') LIMIT 1`,
      [hex, id]
    );
  } catch (e) {
    console.warn('[cleanlemon] clnPersistHashDraftIfEmpty', e?.message || e);
  }
}

/**
 * Filled-instance PDF body (Google template + variables). Used for preview, operator preview, and final merge.
 * @param {object} row — agreement row with template_url, folder_url, template_mode, signed_meta_json, etc.
 */
async function clnBuildAgreementInstancePdfBuffer(row) {
  if (!row?.template_id || !row.template_url || !row.folder_url) {
    throw new Error('MISSING_TEMPLATE');
  }
  const { generatePdfFromTemplate } = require('../agreement/google-docs-pdf');
  const { resolveAgreementPdfAuth, extractIdFromUrlOrId } = require('../agreement/agreement.service');
  const oid = row.operator_id != null ? String(row.operator_id).trim() : '';
  const authForPdf = await resolveAgreementPdfAuth(oid || null);
  if (!authForPdf) throw new Error('GOOGLE_DRIVE_NOT_CONNECTED');
  const templateId = extractIdFromUrlOrId(row.template_url);
  const folderId = extractIdFromUrlOrId(row.folder_url);
  if (!templateId || !folderId) throw new Error('INVALID_TEMPLATE_URL');
  const meta = safeJson(row.signed_meta_json, {});
  const variables = await buildClnAgreementVariablesForFinal(row, row.template_mode, meta);
  const baseName = `Preview-${String(row.template_name || 'agreement')
    .replace(/[^\w\-]+/g, '-')
    .slice(0, 40)}-${String(row.id || '').slice(0, 8)}`;
  const result = await generatePdfFromTemplate({
    templateId,
    folderId,
    filename: baseName,
    variables,
    styleReplacedTextRed: false,
    returnBufferOnly: true,
    authClient: authForPdf
  });
  if (!result?.pdfBuffer?.length) throw new Error('EMPTY_PDF');
  return result.pdfBuffer;
}

/** Operator portal: same filled PDF as signing preview; persists hash_draft when first generated. */
async function previewClnAgreementInstancePdfForOperator(operatorId, agreementId) {
  const oid = String(operatorId || '').trim();
  const id = String(agreementId || '').trim();
  if (!oid || !id) throw new Error('INVALID_INPUT');
  await ensureAgreementTables();
  await ensureClnAgreementExtraColumns();
  const [rows] = await pool.query(
    `SELECT a.id, a.operator_id, a.recipient_name, a.recipient_email, a.salary, a.start_date, a.signed_meta_json, a.template_id,
            t.template_url AS template_url, t.folder_url AS folder_url, t.mode AS template_mode, t.name AS template_name
     FROM cln_operator_agreement a
     LEFT JOIN cln_operator_agreement_template t ON t.id = a.template_id
     WHERE a.id = ?
     LIMIT 1`,
    [id]
  );
  const row = rows[0];
  if (!row) throw new Error('NOT_FOUND');
  const rowOp = row.operator_id != null ? String(row.operator_id).trim() : '';
  if (!rowOp || rowOp !== oid) throw new Error('FORBIDDEN');
  const buf = await clnBuildAgreementInstancePdfBuffer(row);
  await clnPersistHashDraftIfEmpty(id, buf);
  return buf;
}

/**
 * Delete agreement for operator UI when not finalized (no hash_final / no final PDF / not complete).
 */
async function deleteClnOperatorAgreement(operatorId, agreementId) {
  await ensureAgreementTables();
  await ensureClnAgreementExtraColumns();
  const oid = String(operatorId || '').trim();
  const id = String(agreementId || '').trim();
  if (!oid || !id) return { ok: false, reason: 'MISSING_PARAMS' };
  const hasOpAgr = await databaseHasColumn('cln_operator_agreement', 'operator_id');
  if (!hasOpAgr) return { ok: false, reason: 'OPERATOR_SCOPE_UNAVAILABLE' };
  const hasHashFinal = await databaseHasColumn('cln_operator_agreement', 'hash_final');
  const selCols = hasHashFinal
    ? 'id, status, final_agreement_url, hash_final, operator_id'
    : 'id, status, final_agreement_url, operator_id';
  const opCmp =
    'CAST(operator_id AS CHAR(36)) COLLATE utf8mb4_unicode_ci <=> CAST(? AS CHAR(36)) COLLATE utf8mb4_unicode_ci';
  const [rows] = await pool.query(
    `SELECT ${selCols} FROM cln_operator_agreement WHERE id = ? AND ${opCmp} LIMIT 1`,
    [id, oid]
  );
  const row = rows[0];
  if (!row) return { ok: false, reason: 'NOT_FOUND' };
  const st = String(row.status || '')
    .trim()
    .toLowerCase();
  const finalUrl = String(row.final_agreement_url || '').trim();
  if (hasHashFinal) {
    const hf = String(row.hash_final || '').trim();
    if (hf) return { ok: false, reason: 'FINAL_HASH_EXISTS' };
  }
  if (finalUrl) return { ok: false, reason: 'FINAL_PDF_EXISTS' };
  if (st === 'complete' || st === 'signed') return { ok: false, reason: 'AGREEMENT_COMPLETE' };
  const [del] = await pool.query(`DELETE FROM cln_operator_agreement WHERE id = ? AND ${opCmp} LIMIT 1`, [id, oid]);
  if (!Number(del?.affectedRows || 0)) return { ok: false, reason: 'NOT_FOUND' };
  return { ok: true };
}

/** Same merge + export as final PDF, but return buffer for an authenticated client recipient only. */
async function previewClnAgreementInstancePdfForRecipient(agreementId, clientEmail) {
  const id = String(agreementId || '').trim();
  const em = String(clientEmail || '').trim().toLowerCase();
  if (!id || !em) throw new Error('INVALID_INPUT');
  await ensureAgreementTables();
  await ensureClnAgreementExtraColumns();
  const [rows] = await pool.query(
    `SELECT a.id, a.operator_id, a.recipient_name, a.recipient_email, a.salary, a.start_date, a.signed_meta_json, a.template_id,
            t.template_url AS template_url, t.folder_url AS folder_url, t.mode AS template_mode, t.name AS template_name
     FROM cln_operator_agreement a
     INNER JOIN cln_operator_agreement_template t ON t.id = a.template_id
     WHERE a.id = ? AND t.mode = 'operator_client'
     LIMIT 1`,
    [id]
  );
  const row = rows[0];
  if (!row) throw new Error('NOT_FOUND');
  const recEm = String(row.recipient_email || '').trim().toLowerCase();
  if (recEm !== em) throw new Error('FORBIDDEN');
  const buf = await clnBuildAgreementInstancePdfBuffer(row);
  await clnPersistHashDraftIfEmpty(id, buf);
  return buf;
}

async function createAgreement(input) {
  await ensureAgreementTables();
  await ensureClnAgreementExtraColumns();
  const hasTplOpCol = await databaseHasColumn('cln_operator_agreement_template', 'operator_id');
  const id = makeId('cln-agr');
  const templateId = String(input.templateId || input.template_id || '').trim() || null;
  let status = String(input.status || '').trim();
  const oidRaw = input.operatorId != null ? input.operatorId : input.operator_id;
  const oid = oidRaw != null && String(oidRaw).trim() ? String(oidRaw).trim() : null;
  let templateMode = null;
  if (templateId) {
    const tmSel = hasTplOpCol
      ? 'SELECT mode, operator_id FROM cln_operator_agreement_template WHERE id = ? LIMIT 1'
      : 'SELECT mode FROM cln_operator_agreement_template WHERE id = ? LIMIT 1';
    const [tmRows] = await pool.query(tmSel, [templateId]);
    const tr = tmRows[0];
    if (!tr) throw new Error('TEMPLATE_NOT_FOUND');
    if (hasTplOpCol && oid) {
      const top = tr.operator_id != null ? String(tr.operator_id).trim() : '';
      if (!top || top !== oid) throw new Error('TEMPLATE_FORBIDDEN');
    }
    const m = String(tr.mode || '').trim();
    templateMode = m;
    if (m === 'operator_client') {
      status = 'signing';
    } else {
      status = status || 'signing';
    }
  }
  if (templateMode === 'operator_staff' && oid) {
    const settings = await getOperatorSettings(oid);
    if (!settings?.googleDrive) {
      throw new Error('GOOGLE_DRIVE_REQUIRED');
    }
  }
  if (!status) status = 'signing';
  const hasOpCol = await databaseHasColumn('cln_operator_agreement', 'operator_id');
  const hasTid = await databaseHasColumn('cln_operator_agreement', 'template_id');
  if (hasOpCol && oid && hasTid) {
    await pool.query(
      `INSERT INTO cln_operator_agreement
        (id, operator_id, recipient_name, recipient_email, recipient_type, template_name, salary, start_date, status, template_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        oid,
        String(input.recipientName || ''),
        String(input.recipientEmail || ''),
        String(input.recipientType || 'employee'),
        String(input.templateName || ''),
        Number(input.salary) || 0,
        input.startDate || null,
        status,
        templateId
      ]
    );
  } else if (hasOpCol && oid) {
    await pool.query(
      `INSERT INTO cln_operator_agreement
        (id, operator_id, recipient_name, recipient_email, recipient_type, template_name, salary, start_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        oid,
        String(input.recipientName || ''),
        String(input.recipientEmail || ''),
        String(input.recipientType || 'employee'),
        String(input.templateName || ''),
        Number(input.salary) || 0,
        input.startDate || null,
        status
      ]
    );
  } else {
    await pool.query(
      `INSERT INTO cln_operator_agreement
        (id, recipient_name, recipient_email, recipient_type, template_name, salary, start_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        String(input.recipientName || ''),
        String(input.recipientEmail || ''),
        String(input.recipientType || 'employee'),
        String(input.templateName || ''),
        Number(input.salary) || 0,
        input.startDate || null,
        status
      ]
    );
  }
  return id;
}

const CLN_SIGNING_STATUSES = new Set([
  'signing',
  'pending_staff_sign',
  'pending_client_sign',
  'pending_operator_sign',
  'draft',
  'sent'
]);

function clnSigningStatusActive(status) {
  const s = String(status || '')
    .trim()
    .toLowerCase();
  return CLN_SIGNING_STATUSES.has(s);
}

function clnMetaHasStaffSignature(meta) {
  const m = meta && typeof meta === 'object' ? meta : {};
  if (m.parties?.staff?.signatureDataUrl) return true;
  if (m.staffSignAt) return true;
  return false;
}

function clnMetaHasClientSignature(meta) {
  const m = meta && typeof meta === 'object' ? meta : {};
  if (m.parties?.client?.signatureDataUrl) return true;
  if (m.clientSignAt) return true;
  return false;
}

function clnMetaHasOperatorSignature(meta) {
  const m = meta && typeof meta === 'object' ? meta : {};
  if (m.parties?.operator?.signatureDataUrl) return true;
  if (m.operatorSignAt) return true;
  return false;
}

function clnSignaturesComplete(templateMode, meta) {
  const m = String(templateMode || '').trim();
  if (m === 'operator_client') {
    return clnMetaHasClientSignature(meta) && clnMetaHasOperatorSignature(meta);
  }
  return clnMetaHasStaffSignature(meta) && clnMetaHasOperatorSignature(meta);
}

function clnMergeAgreementSignMeta(prev, patch) {
  const base = prev && typeof prev === 'object' ? { ...prev } : {};
  const p = patch && typeof patch === 'object' ? patch : {};
  const parties = { ...(base.parties && typeof base.parties === 'object' ? base.parties : {}) };
  const from = String(p.signedFrom || '').trim();
  const partyKey =
    from === 'employee_portal' ? 'staff' : from === 'client_portal' ? 'client' : from === 'operator_portal' ? 'operator' : null;
  if (partyKey && p.signatureDataUrl) {
    const signedAt = p.signedAt || new Date().toISOString();
    parties[partyKey] = {
      ...(parties[partyKey] && typeof parties[partyKey] === 'object' ? parties[partyKey] : {}),
      signatureDataUrl: String(p.signatureDataUrl),
      signedAt,
      signerName: p.signerName != null ? String(p.signerName) : '',
      signerEmail: p.signerEmail != null ? String(p.signerEmail) : '',
      signedFrom: from
    };
    if (partyKey === 'staff') base.staffSignAt = signedAt;
    if (partyKey === 'client') base.clientSignAt = signedAt;
    if (partyKey === 'operator') base.operatorSignAt = signedAt;
  }
  const keys = ['signerName', 'signerEmail', 'signatureDataUrl', 'remark', 'location', 'signedFrom', 'signedAt'];
  const out = { ...base, parties };
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(p, k) && p[k] != null) out[k] = p[k];
  }
  return out;
}

/**
 * Signing: any order. Status stays `signing` until all required parties for the template mode have signed, then `complete`.
 * operator_staff: staff (employee portal) + operator (portal). operator_client: client + operator; staff does not sign.
 * `signed_at` is set when status becomes complete. Final PDF is generated asynchronously (Drive) when possible.
 */
async function signAgreement(id, patch) {
  await ensureAgreementTables();
  await ensureClnAgreementExtraColumns();
  const agrId = String(id);
  const [rows] = await pool.query(
    `SELECT a.id, a.status, a.signed_meta_json, a.template_id, a.recipient_email, t.mode AS template_mode
     FROM cln_operator_agreement a
     LEFT JOIN cln_operator_agreement_template t ON t.id = a.template_id
     WHERE a.id = ? LIMIT 1`,
    [agrId]
  );
  if (!rows.length) return { ok: false, reason: 'AGREEMENT_NOT_FOUND' };
  const row = rows[0];
  let normalized = String(row.status || '')
    .trim()
    .toLowerCase();
  const signedFrom = String(patch?.signedFrom || '').trim();
  const prevMeta = safeJson(row.signed_meta_json, {});
  const templateMode = String(row.template_mode || '').trim();
  const isClientMode = templateMode === 'operator_client';

  if (normalized === 'draft' || normalized === 'sent') {
    normalized = 'signing';
  }
  if (normalized === 'pending') {
    return { ok: false, reason: 'PROFILES_OR_DRAFT_NOT_READY' };
  }
  if (normalized === 'complete' || normalized === 'signed') {
    return { ok: false, reason: 'ALREADY_COMPLETE' };
  }
  if (!clnSigningStatusActive(normalized)) {
    return { ok: false, reason: 'NOT_IN_SIGNING_PHASE' };
  }

  const nextMeta = clnMergeAgreementSignMeta(prevMeta, patch);

  if (signedFrom === 'employee_portal') {
    if (isClientMode) {
      return { ok: false, reason: 'STAFF_NOT_SIGNATORY_FOR_OPERATOR_CLIENT' };
    }
    if (!patch?.signatureDataUrl) {
      return { ok: false, reason: 'SIGNATURE_REQUIRED' };
    }
    if (clnMetaHasStaffSignature(prevMeta)) {
      return { ok: false, reason: 'STAFF_ALREADY_SIGNED' };
    }
    const complete = clnSignaturesComplete(templateMode, nextMeta);
    if (complete) {
      const [res] = await pool.query(
        `UPDATE cln_operator_agreement
         SET status = 'complete',
             signed_at = NOW(3),
             signed_meta_json = ?,
             created_at = created_at
         WHERE id = ?
         LIMIT 1`,
        [JSON.stringify(nextMeta), agrId]
      );
      const ok = Number(res?.affectedRows || 0) > 0;
      if (ok) {
        await tryFinalizeClnAgreementPdfWithTimeout(agrId, 45000);
      }
      return { ok };
    }
    const [res] = await pool.query(
      `UPDATE cln_operator_agreement
       SET status = 'signing',
           signed_meta_json = ?,
           created_at = created_at
       WHERE id = ?
       LIMIT 1`,
      [JSON.stringify(nextMeta), agrId]
    );
    return { ok: Number(res?.affectedRows || 0) > 0 };
  }

  if (signedFrom === 'client_portal') {
    if (!isClientMode) {
      return { ok: false, reason: 'CLIENT_SIGN_ONLY_FOR_OPERATOR_CLIENT_MODE' };
    }
    const portalEm = String(patch?.portalClientEmail || '').trim().toLowerCase();
    const recipEm = String(row.recipient_email || '').trim().toLowerCase();
    if (!portalEm || !recipEm || portalEm !== recipEm) {
      return { ok: false, reason: 'CLIENT_PORTAL_EMAIL_REQUIRED' };
    }
    if (!patch?.signatureDataUrl) {
      return { ok: false, reason: 'SIGNATURE_REQUIRED' };
    }
    if (clnMetaHasClientSignature(prevMeta)) {
      return { ok: false, reason: 'CLIENT_ALREADY_SIGNED' };
    }
    const complete = clnSignaturesComplete(templateMode, nextMeta);
    if (complete) {
      const [res] = await pool.query(
        `UPDATE cln_operator_agreement
         SET status = 'complete',
             signed_at = NOW(3),
             signed_meta_json = ?,
             created_at = created_at
         WHERE id = ?
         LIMIT 1`,
        [JSON.stringify(nextMeta), agrId]
      );
      const ok = Number(res?.affectedRows || 0) > 0;
      if (ok) {
        await tryFinalizeClnAgreementPdfWithTimeout(agrId, 45000);
      }
      return { ok };
    }
    const [res] = await pool.query(
      `UPDATE cln_operator_agreement
       SET status = 'signing',
           signed_meta_json = ?,
           created_at = created_at
       WHERE id = ?
       LIMIT 1`,
      [JSON.stringify(nextMeta), agrId]
    );
    return { ok: Number(res?.affectedRows || 0) > 0 };
  }

  if (signedFrom === 'operator_portal') {
    if (!patch?.signatureDataUrl) {
      return { ok: false, reason: 'SIGNATURE_REQUIRED' };
    }
    if (clnMetaHasOperatorSignature(prevMeta)) {
      return { ok: false, reason: 'OPERATOR_ALREADY_SIGNED' };
    }
    const complete = clnSignaturesComplete(templateMode, nextMeta);
    if (complete) {
      const [res] = await pool.query(
        `UPDATE cln_operator_agreement
         SET status = 'complete',
             signed_at = NOW(3),
             signed_meta_json = ?,
             created_at = created_at
         WHERE id = ?
         LIMIT 1`,
        [JSON.stringify(nextMeta), agrId]
      );
      const ok = Number(res?.affectedRows || 0) > 0;
      if (ok) {
        await tryFinalizeClnAgreementPdfWithTimeout(agrId, 45000);
      }
      return { ok };
    }
    const [res] = await pool.query(
      `UPDATE cln_operator_agreement
       SET status = 'signing',
           signed_meta_json = ?,
           created_at = created_at
       WHERE id = ?
       LIMIT 1`,
      [JSON.stringify(nextMeta), agrId]
    );
    return { ok: Number(res?.affectedRows || 0) > 0 };
  }

  return { ok: false, reason: 'SIGNED_FROM_REQUIRED' };
}

function clnFormatClnDate(d) {
  if (d == null || d === '') return '';
  try {
    const dt = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(dt.getTime())) return String(d);
    return dt.toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return String(d);
  }
}

/**
 * Operator staff row (Team / Contact): name, phone, salary_basic, joined_at from domain tables.
 * NRIC / address still use `portal_account` in `buildClnAgreementVariablesForFinal`.
 */
async function fetchClnOperatorContactForStaffAgreement(operatorId, emailNorm) {
  await clnDc.ensureClnDomainContactExtras(pool);
  const oid = String(operatorId || '').trim();
  const e = String(emailNorm || '').trim().toLowerCase();
  if (!e || !oid) return null;
  if (!(await clnDc.clnDomainContactSchemaReady(pool))) return null;
  try {
    return await clnDc.fetchStaffAgreementSnapshot(pool, oid, e);
  } catch (err) {
    console.warn('[cleanlemon] fetchClnOperatorContactForStaffAgreement', err?.message || err);
    return null;
  }
}

function clnSigVar(val) {
  const s = val != null ? String(val).trim() : '';
  if (s && /^https?:\/\//i.test(s)) return s;
  return '(signed electronically)';
}

/** Google Docs image placeholders need public https URLs — upload data-URL signatures to OSS when needed. */
async function clnSignaturePartyImageForDoc(agreementId, partyKey, signatureDataUrl) {
  const raw = signatureDataUrl != null ? String(signatureDataUrl).trim() : '';
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  const { signatureValueToPublicUrl } = require('../upload/signature-image-to-oss-url');
  try {
    const aid = String(agreementId || '').trim().slice(0, 80);
    const pk = String(partyKey || 'party').replace(/[^a-z0-9_-]/gi, '-').slice(0, 24);
    const res = await signatureValueToPublicUrl(raw, {
      clientId: null,
      signatureKey: `cln-agr-${aid}-${pk}`,
    });
    if (res?.ok && res.value) return String(res.value).trim();
  } catch (e) {
    console.warn('[cleanlemon] clnSignaturePartyImageForDoc', partyKey, e?.message || e);
  }
  return clnSigVar(raw);
}

async function buildClnAgreementVariablesForFinal(agrRow, templateMode, meta) {
  const {
    getSampleVariablesForMode,
    applySampleCurrency,
    getClientCurrencyCode
  } = require('../agreement/agreement.service');
  const mode = String(templateMode || 'operator_staff').trim();
  const safeMode = mode === 'operator_client' ? 'operator_client' : 'operator_staff';
  const oid = agrRow.operator_id != null ? String(agrRow.operator_id).trim() : '';
  const cur = await getClientCurrencyCode(oid || null);
  let vars = applySampleCurrency(getSampleVariablesForMode(safeMode), cur);
  const settings = oid ? await getOperatorSettings(oid) : {};
  const cp = settings.companyProfile && typeof settings.companyProfile === 'object' ? settings.companyProfile : {};
  vars.operator_company_name = String(cp.companyName || vars.operator_company_name || '');
  vars.operator_ssm = String(cp.ssmNumber || cp.ssm || vars.operator_ssm || '');
  vars.operator_chop = String(
    cp.companyChop || cp.chopUrl || cp.chop || cp.operatorChop || vars.operator_chop || ''
  );
  vars.operator_phone = String(cp.contact || cp.supervisorPhone || vars.operator_phone || '');
  vars.operator_email = String(cp.email || cp.supervisorEmail || vars.operator_email || '');
  vars.operator_pic_name = String(cp.supervisorName || cp.picName || vars.operator_pic_name || '');
  vars.operator_pic_nric = String(cp.supervisorNric || cp.picNric || cp.operatorPicNric || vars.operator_pic_nric || '');

  const email = String(agrRow.recipient_email || '')
    .trim()
    .toLowerCase();
  const portalRes = email ? await getPortalProfile(email) : null;
  const prof = portalRes?.ok && portalRes.profile && typeof portalRes.profile === 'object' ? portalRes.profile : {};
  const fullName =
    String(prof.fullname || '').trim() ||
    [prof.first_name, prof.last_name].filter(Boolean).join(' ').trim() ||
    String(agrRow.recipient_name || '').trim();

  const staffContact =
    safeMode === 'operator_staff' && email ? await fetchClnOperatorContactForStaffAgreement(oid, email) : null;

  if (safeMode === 'operator_staff') {
    const nameFromContact = staffContact && staffContact.name != null ? String(staffContact.name).trim() : '';
    vars.staff_name = nameFromContact || fullName || vars.staff_name || '';
    vars.staff_nric = String(prof.nric || vars.staff_nric || '');
    vars.staff_nricfront = String(prof.nricfront || vars.staff_nricfront || '').trim();
    vars.staff_nricback = String(prof.nricback || vars.staff_nricback || '').trim();
    vars.staff_email = email || String(vars.staff_email || '');
    const phoneFromContact =
      staffContact && staffContact.phone != null ? String(staffContact.phone).trim() : '';
    vars.staff_phone = phoneFromContact || String(prof.phone || vars.staff_phone || '');
    vars.staff_address = String(prof.address || vars.staff_address || '');

    const salContact = staffContact != null ? Number(staffContact.salary_basic) : NaN;
    const salAgr = Number(agrRow.salary);
    const salNum =
      !Number.isNaN(salContact) && salContact > 0 ? salContact : !Number.isNaN(salAgr) && salAgr > 0 ? salAgr : NaN;
    if (!Number.isNaN(salNum) && salNum > 0) {
      vars.salary = `${cur} ${salNum.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    } else {
      vars.salary = '';
    }

    const startFromContact =
      staffContact && staffContact.joined_at ? clnFormatClnDate(staffContact.joined_at) : '';
    const startFromAgr = clnFormatClnDate(agrRow.start_date) || '';
    vars.staff_start_date = startFromContact || startFromAgr || vars.staff_start_date || '';
  } else {
    vars.client_name = String(agrRow.recipient_name || vars.client_name || '');
    vars.client_nric = String(prof.nric || prof.tax_id_no || vars.client_nric || '');
    vars.client_contact = email || String(vars.client_contact || '');
    vars.client_phone = String(prof.phone || vars.client_phone || '');
    vars.client_email = email || String(vars.client_email || '');
    vars.client_address = String(prof.address || vars.client_address || '');
  }

  const parties = meta?.parties && typeof meta.parties === 'object' ? meta.parties : {};
  const agrIdForSig = String(agrRow.id || '').trim();
  if (parties.staff?.signatureDataUrl) {
    vars.staff_sign = await clnSignaturePartyImageForDoc(agrIdForSig, 'staff', parties.staff.signatureDataUrl);
  }
  if (parties.operator?.signatureDataUrl) {
    vars.operator_sign = await clnSignaturePartyImageForDoc(agrIdForSig, 'operator', parties.operator.signatureDataUrl);
  }
  if (parties.client?.signatureDataUrl) {
    vars.client_sign = await clnSignaturePartyImageForDoc(agrIdForSig, 'client', parties.client.signatureDataUrl);
  }

  const today = new Date();
  vars.agreement_date = clnFormatClnDate(today);
  return vars;
}

async function tryFinalizeClnAgreementPdf(agrId) {
  const id = String(agrId || '').trim();
  if (!id) return;
  await ensureClnAgreementExtraColumns();
  const hasFinal = await databaseHasColumn('cln_operator_agreement', 'final_agreement_url');
  if (!hasFinal) return;

  const [rows] = await pool.query(
    `SELECT a.id, a.operator_id, a.recipient_name, a.recipient_email, a.salary, a.start_date, a.signed_meta_json, a.template_id,
            t.template_url AS template_url, t.folder_url AS folder_url, t.mode AS template_mode, t.name AS template_name
     FROM cln_operator_agreement a
     LEFT JOIN cln_operator_agreement_template t ON t.id = a.template_id
     WHERE a.id = ?
     LIMIT 1`,
    [id]
  );
  const row = rows[0];
  if (!row?.template_id || !row.template_url || !row.folder_url) return;

  const { uploadPdfBufferToDriveFolder } = require('../agreement/google-docs-pdf');
  const { resolveAgreementPdfAuth, extractIdFromUrlOrId } = require('../agreement/agreement.service');
  const { mergePdfBuffers, buildCleanlemonsSigningAuditPdfBuffer } = require('../agreement/agreement-pdf-appendix');
  const oid = row.operator_id != null ? String(row.operator_id).trim() : '';
  const authForPdf = await resolveAgreementPdfAuth(oid || null);
  if (!authForPdf) {
    console.warn('[cleanlemon] tryFinalizeClnAgreementPdf: no Google auth for operator', oid);
    return;
  }

  const folderId = extractIdFromUrlOrId(row.folder_url);
  if (!folderId) return;

  let mainBodyBuf;
  try {
    mainBodyBuf = await clnBuildAgreementInstancePdfBuffer(row);
  } catch (e) {
    console.warn('[cleanlemon] tryFinalizeClnAgreementPdf: build body', e?.message || e);
    return;
  }
  await clnPersistHashDraftIfEmpty(id, mainBodyBuf);
  const mainBodySha256 = crypto.createHash('sha256').update(mainBodyBuf).digest('hex');

  const [metaRows] = await pool.query(
    `SELECT signed_meta_json, hash_draft FROM cln_operator_agreement WHERE id = ? LIMIT 1`,
    [id]
  );
  const metaRow = metaRows[0] || {};
  const signedMeta = safeJson(metaRow.signed_meta_json, {});
  const hashDraftStored = String(metaRow.hash_draft || '').trim();
  const hashDraftForAppendix = hashDraftStored || mainBodySha256;
  const modeRaw = String(row.template_mode || '').trim().toLowerCase();
  const modeForAppendix = modeRaw === 'operator_client' ? 'operator_client' : 'operator_staff';

  const generatedAt = new Date();
  let appendixBuf;
  try {
    appendixBuf = await buildCleanlemonsSigningAuditPdfBuffer({
      agreementId: id,
      mode: modeForAppendix,
      hashDraft: hashDraftForAppendix,
      mainBodySha256,
      parties: signedMeta.parties,
      generatedAt
    });
  } catch (e) {
    console.warn('[cleanlemon] tryFinalizeClnAgreementPdf: appendix', e?.message || e);
    return;
  }

  let mergedBuf;
  try {
    mergedBuf = await mergePdfBuffers(mainBodyBuf, appendixBuf);
  } catch (e) {
    console.warn('[cleanlemon] tryFinalizeClnAgreementPdf: merge', e?.message || e);
    return;
  }

  const hashFinal = crypto.createHash('sha256').update(mergedBuf).digest('hex');
  const baseName = `Agreement-${String(row.template_name || 'final')
    .replace(/[^\w\-]+/g, '-')
    .slice(0, 40)}-${id.slice(0, 8)}`;

  let pdfUrl;
  try {
    pdfUrl = await uploadPdfBufferToDriveFolder({
      pdfBuffer: mergedBuf,
      fileName: `${baseName}-final`,
      folderId,
      authClient: authForPdf
    });
  } catch (e) {
    console.warn('[cleanlemon] tryFinalizeClnAgreementPdf: upload', e?.message || e);
    return;
  }
  if (!pdfUrl) return;

  const hasHashFinal = await databaseHasColumn('cln_operator_agreement', 'hash_final');
  if (hasHashFinal) {
    await pool.query(
      `UPDATE cln_operator_agreement SET final_agreement_url = ?, hash_final = ?, created_at = created_at WHERE id = ? LIMIT 1`,
      [String(pdfUrl), hashFinal, id]
    );
  } else {
    await pool.query(
      `UPDATE cln_operator_agreement SET final_agreement_url = ?, created_at = created_at WHERE id = ? LIMIT 1`,
      [String(pdfUrl), id]
    );
  }
}

/** Await final PDF generation after sign; bounded wait so the HTTP response is not unbounded. */
async function tryFinalizeClnAgreementPdfWithTimeout(agrId, timeoutMs = 45000) {
  const id = String(agrId || '').trim();
  if (!id) return;
  let to = null;
  try {
    await Promise.race([
      tryFinalizeClnAgreementPdf(id),
      new Promise((_, rej) => {
        to = setTimeout(
          () => rej(Object.assign(new Error('finalize timeout'), { code: 'FINALIZE_TIMEOUT' })),
          timeoutMs
        );
      }),
    ]);
  } catch (e) {
    if (e && e.code === 'FINALIZE_TIMEOUT') {
      console.warn('[cleanlemon] tryFinalizeClnAgreementPdf timed out', id);
    } else {
      console.error('[cleanlemon] tryFinalizeClnAgreementPdf', e?.message || e);
    }
  } finally {
    if (to) clearTimeout(to);
  }
}

/**
 * Re-run final PDF merge + Drive upload (e.g. first async pass failed silently).
 * Operator must own the agreement; row must be complete with all required signatures.
 */
async function retryFinalizeClnOperatorAgreementPdf(operatorId, agreementId) {
  const oid = String(operatorId || '').trim();
  const aid = String(agreementId || '').trim();
  if (!oid || !aid) return { ok: false, reason: 'MISSING_ID' };
  await ensureAgreementTables();
  await ensureClnAgreementExtraColumns();
  const hasFinal = await databaseHasColumn('cln_operator_agreement', 'final_agreement_url');
  if (!hasFinal) return { ok: false, reason: 'FINAL_URL_COLUMN_MISSING' };

  const [rows] = await pool.query(
    `SELECT a.id, a.operator_id, a.status, a.signed_meta_json, t.mode AS template_mode
       FROM cln_operator_agreement a
       LEFT JOIN cln_operator_agreement_template t ON t.id = a.template_id
      WHERE a.id = ?
      LIMIT 1`,
    [aid]
  );
  if (!rows.length) return { ok: false, reason: 'NOT_FOUND' };
  const row = rows[0];
  if (String(row.operator_id || '').trim() !== oid) return { ok: false, reason: 'FORBIDDEN' };
  const st = String(row.status || '')
    .trim()
    .toLowerCase();
  if (st !== 'complete' && st !== 'signed') return { ok: false, reason: 'NOT_COMPLETE' };
  const meta = safeJson(row.signed_meta_json, {});
  const mode = String(row.template_mode || '').trim();
  if (!clnSignaturesComplete(mode, meta)) return { ok: false, reason: 'SIGNATURES_INCOMPLETE' };

  await tryFinalizeClnAgreementPdf(aid);
  const [check] = await pool.query(
    `SELECT TRIM(COALESCE(final_agreement_url,'')) AS u FROM cln_operator_agreement WHERE id = ? LIMIT 1`,
    [aid]
  );
  const u = String(check[0]?.u || '').trim();
  if (!u) return { ok: false, reason: 'FINAL_PDF_FAILED' };
  return { ok: true, finalAgreementUrl: u };
}

async function buildClnAgreementVariablesReferenceDocxBuffer() {
  const { getClnAgreementVariablesReferenceDocxRows } = require('../agreement/agreement.service');
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    Table,
    TableRow,
    TableCell,
    WidthType
  } = require('docx');
  const structured = getClnAgreementVariablesReferenceDocxRows();

  const cell = (textRuns, widthDxa) =>
    new TableCell({
      ...(widthDxa ? { width: { size: widthDxa, type: WidthType.DXA } } : {}),
      children: [new Paragraph({ children: textRuns })]
    });

  const headerRow = new TableRow({
    children: [
      cell([new TextRun({ text: 'Variable', bold: true, size: 22 })], 3200),
      cell([new TextRun({ text: 'Example', bold: true, size: 22 })], 8800)
    ]
  });

  const tableRows = [headerRow];

  for (const r of structured) {
    if (r.kind === 'section') {
      const paras = [
        new Paragraph({
          children: [new TextRun({ text: r.title, bold: true, size: 24 })],
          spacing: { before: 160, after: 80 }
        })
      ];
      if (r.description) {
        paras.push(
          new Paragraph({
            children: [new TextRun({ text: r.description, italics: true, size: 20 })],
            spacing: { after: 100 }
          })
        );
      }
      tableRows.push(
        new TableRow({
          children: [
            new TableCell({
              columnSpan: 2,
              children: paras
            })
          ]
        })
      );
    } else if (r.kind === 'subsection') {
      tableRows.push(
        new TableRow({
          children: [
            new TableCell({
              columnSpan: 2,
              children: [
                new Paragraph({
                  children: [new TextRun({ text: r.title, bold: true, size: 22 })],
                  spacing: { before: 120, after: 80 }
                })
              ]
            })
          ]
        })
      );
    } else {
      const k = String(r.key || '');
      const ex = String(r.example || '');
      tableRows.push(
        new TableRow({
          children: [
            cell([new TextRun({ text: `{{${k}}}`, font: 'Consolas', size: 20 })], 3200),
            cell([new TextRun({ text: ex, size: 20 })], 8800)
          ]
        })
      );
    }
  }

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: tableRows
  });

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            children: [new TextRun({ text: 'Cleanlemons — agreement template variables', bold: true, size: 28 })],
            spacing: { after: 180 }
          }),
          new Paragraph({
            children: [
              new TextRun(
                'Use {{varname}} or [[varname]] in Google Docs. Sections match Operator → Agreements → Template variables. Column A = placeholder; column B = sample only.'
              )
            ],
            spacing: { after: 200 }
          }),
          table
        ]
      }
    ]
  });
  return Packer.toBuffer(doc);
}

async function listAgreementTemplates(operatorId) {
  await ensureAgreementTables();
  const hasOpTpl = await databaseHasColumn('cln_operator_agreement_template', 'operator_id');
  const oid = String(operatorId || '').trim();
  if (hasOpTpl) {
    if (!oid) return [];
    const [rows] = await pool.query(
      `SELECT id, name, mode, template_url AS templateUrl, folder_url AS folderUrl, description,
              DATE_FORMAT(last_updated, '%Y-%m-%d') AS lastUpdated
       FROM cln_operator_agreement_template
       WHERE operator_id <=> ?
       ORDER BY last_updated DESC`,
      [oid]
    );
    return rows;
  }
  const [rows] = await pool.query(
    `SELECT id, name, mode, template_url AS templateUrl, folder_url AS folderUrl, description,
            DATE_FORMAT(last_updated, '%Y-%m-%d') AS lastUpdated
     FROM cln_operator_agreement_template
     ORDER BY last_updated DESC`
  );
  return rows;
}

async function createAgreementTemplate(input) {
  await ensureAgreementTables();
  const hasOpTpl = await databaseHasColumn('cln_operator_agreement_template', 'operator_id');
  const oidRaw = input.operatorId != null ? input.operatorId : input.operator_id;
  const oid = oidRaw != null && String(oidRaw).trim() ? String(oidRaw).trim() : null;
  if (hasOpTpl && !oid) throw new Error('MISSING_OPERATOR_ID');
  const id = makeId('cln-tpl');
  if (hasOpTpl) {
    await pool.query(
      `INSERT INTO cln_operator_agreement_template
        (id, operator_id, name, mode, template_url, folder_url, description)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        oid,
        String(input.name || ''),
        String(input.mode || 'operator_staff'),
        String(input.templateUrl || ''),
        String(input.folderUrl || ''),
        String(input.description || ''),
      ]
    );
  } else {
    await pool.query(
      `INSERT INTO cln_operator_agreement_template
        (id, name, mode, template_url, folder_url, description)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        String(input.name || ''),
        String(input.mode || 'operator_staff'),
        String(input.templateUrl || ''),
        String(input.folderUrl || ''),
        String(input.description || ''),
      ]
    );
  }
  return id;
}

/**
 * Template preview PDF (same pipeline as Coliving agreementsetting): Node + Google Docs/Drive.
 * Modes: `operator_staff` (offer letter); `operator_client` (cleaning agreement — `client_*` = operator’s customer).
 * Uses operatorId as client_id for OAuth/SA.
 * @param {string} operatorId - Same as account client id for Google credentials (Cleanlemons operator).
 * @param {string} templateId - cln_operator_agreement_template.id
 * @returns {Promise<Buffer>}
 */
async function previewOperatorAgreementTemplatePdf(operatorId, templateId) {
  const { generateTemplatePreviewPdfBuffer } = require('../agreement/agreement.service');
  await ensureAgreementTables();
  const tid = String(templateId || '').trim();
  if (!tid) throw new Error('NO_TEMPLATE_ID');
  const hasOpTpl = await databaseHasColumn('cln_operator_agreement_template', 'operator_id');
  const oid = String(operatorId || '').trim();
  if (hasOpTpl && !oid) throw new Error('MISSING_OPERATOR_ID');
  const opSel = hasOpTpl ? ', operator_id AS templateOperatorId' : '';
  const [rows] = await pool.query(
    `SELECT id, name, mode, template_url AS templateUrl, folder_url AS folderUrl${opSel}
     FROM cln_operator_agreement_template WHERE id = ? LIMIT 1`,
    [tid]
  );
  const row = rows[0];
  if (!row) throw new Error('NOT_FOUND');
  if (hasOpTpl) {
    const top = row.templateOperatorId != null ? String(row.templateOperatorId).trim() : '';
    if (!top || top !== oid) throw new Error('TEMPLATE_FORBIDDEN');
  }
  const tu = String(row.templateUrl || '').trim();
  const fu = String(row.folderUrl || '').trim();
  if (!tu || !fu) throw new Error('MISSING_TEMPLATE_OR_FOLDER');
  const mode = String(row.mode || 'operator_staff').trim();
  const safeMode = mode === 'operator_client' ? 'operator_client' : 'operator_staff';
  const { pdfBuffer } = await generateTemplatePreviewPdfBuffer(
    {
      templateurl: tu,
      folderurl: fu,
      title: String(row.name || 'Agreement').trim() || 'Agreement',
      mode: safeMode
    },
    { clientId: oid || null }
  );
  if (!pdfBuffer?.length) throw new Error('EMPTY_PDF');
  return pdfBuffer;
}

async function listKpi(operatorId) {
  const hasOd = await databaseHasColumn('cln_kpi_deduction', 'operatordetail_id');
  const oid = String(operatorId || '').trim();
  const where = hasOd && oid ? 'WHERE operatordetail_id <=> ?' : '';
  const params = hasOd && oid ? [oid] : [];
  const [rows] = await pool.query(
    `SELECT
      COALESCE(staff_email, 'unknown@cleanlemons.local') AS email,
      SUBSTRING_INDEX(COALESCE(staff_email, 'Unknown Staff'), '@', 1) AS name,
      COUNT(*) AS tasksCompleted,
      50 AS tasksTarget,
      GREATEST(50, LEAST(100, 100 - SUM(CASE WHEN point > 0 THEN point ELSE 0 END))) AS onTimeRate,
      ROUND(GREATEST(3.5, LEAST(5.0, 5 - (SUM(CASE WHEN point > 0 THEN point ELSE 0 END) / 100))), 1) AS customerRating,
      GREATEST(70, LEAST(100, 100 - SUM(CASE WHEN point > 0 THEN point ELSE 0 END))) AS attendance,
      CASE
        WHEN SUM(CASE WHEN point > 0 THEN point ELSE 0 END) <= 5 THEN 'up'
        WHEN SUM(CASE WHEN point > 0 THEN point ELSE 0 END) >= 20 THEN 'down'
        ELSE 'stable'
      END AS trend
     FROM cln_kpi_deduction
     ${where}
     GROUP BY staff_email
     ORDER BY tasksCompleted DESC`,
    params
  );
  return rows.map((r, idx) => ({
    id: `kpi-${idx + 1}`,
    name: r.name,
    role: 'Cleaner',
    tasksCompleted: Number(r.tasksCompleted || 0),
    tasksTarget: Number(r.tasksTarget || 50),
    onTimeRate: Number(r.onTimeRate || 0),
    customerRating: Number(r.customerRating || 0),
    attendance: Number(r.attendance || 0),
    trend: r.trend,
  }));
}

function _nextMalaysiaMonthFirstYmd(monthStartYmd) {
  const m = String(monthStartYmd || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(m)) return null;
  const d = new Date(`${m}T12:00:00+08:00`);
  d.setMonth(d.getMonth() + 1);
  const yy = d.getFullYear();
  const mo = d.getMonth() + 1;
  return `${yy}-${String(mo).padStart(2, '0')}-01`;
}

function _malaysiaYmdToEnglishMonthYear(ymd) {
  const m = String(ymd || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(m)) return '';
  const d = new Date(`${m}T12:00:00+08:00`);
  try {
    return new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'Asia/Singapore' }).format(d);
  } catch (_) {
    return m;
  }
}

async function operatorDashboard({ operatorId } = {}) {
  const oid = String(operatorId || '').trim();
  const monthStartYmd = getMalaysiaMonthStartYmd();
  const nextMonthFirst = _nextMalaysiaMonthFirstYmd(monthStartYmd);
  const fromUtc = malaysiaDateToUtcDatetimeForDb(monthStartYmd);
  const toUtcExclusive = nextMonthFirst ? malaysiaDateToUtcDatetimeForDb(nextMonthFirst) : null;
  let monthlyProgress = {
    monthLabel: _malaysiaYmdToEnglishMonthYear(monthStartYmd),
    monthStartYmd,
    tasksCompleted: 0,
    tasksTotal: 0,
    tasksPercent: 0,
    onTimePercent: 0,
  };
  if (!oid) {
    return {
      stats: {
        totalStaff: 0,
        properties: 0,
        completedToday: 0,
        inProgress: 0,
        totalSchedules: 0,
      },
      todayTasks: [],
      monthlyProgress,
    };
  }

  const hasOpCol = await databaseHasColumn('cln_property', 'operator_id');
  const hasEoTable = await clnDc.databaseHasTable(pool, 'cln_employee_operator');
  if (!hasOpCol) {
    return {
      stats: {
        totalStaff: 0,
        properties: 0,
        completedToday: 0,
        inProgress: 0,
        totalSchedules: 0,
      },
      todayTasks: [],
      monthlyProgress,
    };
  }

  const schedJoin = `FROM cln_schedule s
     INNER JOIN cln_property p ON p.id = s.property_id AND p.operator_id = ?`;

  const [[{ totalProperties }]] = await pool.query(
    'SELECT COUNT(*) AS totalProperties FROM cln_property WHERE operator_id = ?',
    [oid]
  );
  const [[{ totalSchedules }]] = await pool.query(`SELECT COUNT(*) AS totalSchedules ${schedJoin}`, [oid]);
  const [[{ completedToday }]] = await pool.query(
    `SELECT COUNT(*) AS completedToday ${schedJoin}
     WHERE s.status IN ('completed','done') AND DATE(s.working_day)=CURDATE()`,
    [oid]
  );
  const [[{ inProgress }]] = await pool.query(
    `SELECT COUNT(*) AS inProgress ${schedJoin}
     WHERE s.status IN ('in-progress','pending-checkout','ready-to-clean')`,
    [oid]
  );
  const [todayTasks] = await pool.query(
    `SELECT s.id, COALESCE(p.property_name, p.unit_name, 'Property') AS property,
            COALESCE(s.status, 'pending') AS status,
            COALESCE(s.team, '-') AS team,
            DATE_FORMAT(s.start_time, '%H:%i') AS startTime,
            DATE_FORMAT(s.end_time, '%H:%i') AS endTime
     ${schedJoin}
     WHERE DATE(COALESCE(s.working_day, s.created_at)) = CURDATE()
     ORDER BY s.start_time ASC
     LIMIT 20`,
    [oid]
  );
  const normalizedTodayTasks = (todayTasks || []).map((task) => ({
    ...task,
    status: normalizeScheduleStatus(task.status),
  }));

  if (fromUtc && toUtcExclusive) {
    const [[row]] = await pool.query(
      `SELECT
        SUM(CASE WHEN LOWER(IFNULL(s.status, '')) LIKE '%cancel%' THEN 0 ELSE 1 END) AS jobsInMonth,
        SUM(
          CASE
            WHEN LOWER(IFNULL(s.status, '')) LIKE '%cancel%' THEN 0
            WHEN (
              LOWER(REPLACE(REPLACE(TRIM(IFNULL(s.status, '')), ' ', '-'), '_', '-')) LIKE '%complete%'
              OR LOWER(TRIM(IFNULL(s.status, ''))) = 'done'
            ) THEN 1
            ELSE 0
          END
        ) AS completedInMonth,
        SUM(
          CASE
            WHEN LOWER(IFNULL(s.status, '')) LIKE '%cancel%' THEN 0
            WHEN (
              LOWER(REPLACE(REPLACE(TRIM(IFNULL(s.status, '')), ' ', '-'), '_', '-')) LIKE '%complete%'
              OR LOWER(TRIM(IFNULL(s.status, ''))) = 'done'
            ) AND COALESCE(s.point, 0) = 0 THEN 1
            ELSE 0
          END
        ) AS onTimeCompleted
       ${schedJoin}
       WHERE COALESCE(s.working_day, s.created_at) >= ?
         AND COALESCE(s.working_day, s.created_at) < ?`,
      [oid, fromUtc, toUtcExclusive]
    );
    const tasksTotal = Number(row?.jobsInMonth || 0);
    const tasksCompleted = Number(row?.completedInMonth || 0);
    const onTimeCompleted = Number(row?.onTimeCompleted || 0);
    const tasksPercent =
      tasksTotal > 0 ? Math.min(100, Math.round((100 * tasksCompleted) / tasksTotal)) : 0;
    const onTimePercent =
      tasksCompleted > 0 ? Math.min(100, Math.round((100 * onTimeCompleted) / tasksCompleted)) : 0;
    monthlyProgress = {
      monthLabel: _malaysiaYmdToEnglishMonthYear(monthStartYmd),
      monthStartYmd,
      tasksCompleted,
      tasksTotal,
      tasksPercent,
      onTimePercent,
    };
  }

  let totalStaff = 0;
  if (hasEoTable) {
    try {
      const [[{ n }]] = await pool.query(
        'SELECT COUNT(DISTINCT eo.employee_id) AS n FROM cln_employee_operator eo WHERE eo.operator_id = ?',
        [oid]
      );
      totalStaff = Number(n || 0);
    } catch (_) {
      totalStaff = 0;
    }
  }

  return {
    stats: {
      totalStaff,
      properties: Number(totalProperties || 0),
      completedToday: Number(completedToday || 0),
      inProgress: Number(inProgress || 0),
      totalSchedules: Number(totalSchedules || 0),
    },
    todayTasks: normalizedTodayTasks,
    monthlyProgress,
  };
}

async function ensureNotificationsTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS cln_operator_notification (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      operatordetail_id CHAR(36) NULL COMMENT 'FK cln_operatordetail.id',
      title VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      type VARCHAR(32) NOT NULL DEFAULT 'info',
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_cln_operator_notification_operatordetail_id (operatordetail_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
  if (!(await databaseHasColumn('cln_operator_notification', 'operatordetail_id'))) {
    await pool.query(
      'ALTER TABLE cln_operator_notification ADD COLUMN operatordetail_id CHAR(36) NULL COMMENT \'FK cln_operatordetail.id\' AFTER id'
    ).catch(() => {});
  }
}

async function listNotifications(operatorId) {
  await ensureNotificationsTable();
  const oid = String(operatorId || '').trim();
  const hasOd = await databaseHasColumn('cln_operator_notification', 'operatordetail_id');
  if (!oid || !hasOd) {
    return [];
  }
  const [rows] = await pool.query(
    `SELECT id, title, message, type, is_read AS isRead, created_at AS createdAt
     FROM cln_operator_notification
     WHERE operatordetail_id <=> ?
     ORDER BY created_at DESC
     LIMIT 50`,
    [oid]
  );
  return rows;
}

async function markNotificationRead(id, operatorId) {
  await ensureNotificationsTable();
  const oid = String(operatorId || '').trim();
  const hasOd = await databaseHasColumn('cln_operator_notification', 'operatordetail_id');
  if (!oid || !hasOd) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const [r] = await pool.query(
    'UPDATE cln_operator_notification SET is_read = 1 WHERE id = ? AND operatordetail_id <=> ? LIMIT 1',
    [String(id), oid]
  );
  if (!r || Number(r.affectedRows || 0) < 1) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    throw err;
  }
}

async function dismissNotification(id, operatorId) {
  await ensureNotificationsTable();
  const oid = String(operatorId || '').trim();
  const hasOd = await databaseHasColumn('cln_operator_notification', 'operatordetail_id');
  if (!oid || !hasOd) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const [r] = await pool.query(
    'DELETE FROM cln_operator_notification WHERE id = ? AND operatordetail_id <=> ? LIMIT 1',
    [String(id), oid]
  );
  if (!r || Number(r.affectedRows || 0) < 1) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    throw err;
  }
}

async function ensureOperatorSettingsTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS cln_operator_settings (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      operator_id VARCHAR(64) NOT NULL,
      settings_json LONGTEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_operator_settings_operator (operator_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

async function getOperatorSettings(operatorId) {
  await ensureOperatorSettingsTable();
  const [rows] = await pool.query(
    'SELECT settings_json FROM cln_operator_settings WHERE operator_id = ? LIMIT 1',
    [String(operatorId)]
  );
  let base = {};
  if (rows.length) {
    try {
      base = JSON.parse(rows[0].settings_json) || {};
    } catch {
      base = {};
    }
  }
  const flags = await clnIntegration.getIntegrationFlagsForOperator(operatorId);
  const stripeOn = !!flags.stripeMerchant;
  let publicSubdomain = '';
  try {
    publicSubdomain = await fetchClnOperatordetailPublicSubdomain(operatorId);
  } catch (_) {
    publicSubdomain = '';
  }
  /**
   * Legacy / UX gap: UI may show subdomain from `companyProfile.subdomain` (JSON) while
   * `public_subdomain` on cln_operatordetail stayed NULL — public marketing URL only reads the column.
   * One-shot backfill when operator opens settings (GET) so /{slug} works without a redundant Save.
   */
  if (!publicSubdomain) {
    const cp = base.companyProfile;
    const legacyRaw = cp && typeof cp === 'object' ? cp.subdomain : undefined;
    const norm = normalizePublicSubdomainInput(legacyRaw);
    if (norm) {
      const v = validatePublicSubdomainValue(norm);
      if (v.ok && !v.clear) {
        try {
          const psr = await upsertOperatorPublicSubdomain(operatorId, norm);
          if (psr.ok) publicSubdomain = v.normalized;
        } catch (e) {
          console.warn('[cleanlemon] public_subdomain backfill from companyProfile.subdomain skipped', {
            operatorId,
            err: e?.message || e,
          });
        }
      }
    }
  }
  return {
    ...base,
    publicSubdomain,
    bukku: flags.bukku,
    xero: flags.xero,
    googleDrive: flags.googleDrive,
    ...(flags.googleDriveEmail ? { googleDriveEmail: flags.googleDriveEmail } : {}),
    ai: !!flags.ai,
    ...(flags.aiProvider ? { aiProvider: flags.aiProvider } : {}),
    aiKeyConfigured: !!flags.aiKeyConfigured,
    stripe: stripeOn,
    xendit: stripeOn ? false : !!parseClientInvoiceXenditFromSettings(base),
    xenditGateway: buildClnClientInvoiceXenditGatewayUi(base, stripeOn),
    ttlock: !!flags.ttlockConnected,
    ttlockCreateEverUsed: !!flags.ttlockCreateEverUsed
  };
}

/**
 * Operator portal setup gate: company profile + pricing config (≥1 selected service).
 * Personal portal_account profile is not a blocking step for operators.
 */
async function getOperatorPortalSetupStatus(operatorId, email) {
  const oid = String(operatorId || '').trim();
  const em = String(email || '').trim().toLowerCase();
  if (!oid) {
    return { ok: false, reason: 'MISSING_OPERATOR_ID' };
  }
  if (!em) {
    return { ok: false, reason: 'MISSING_EMAIL' };
  }
  const settings = await getOperatorSettings(oid);
  const companyComplete =
    clnCompanyProfileCompleteForAutomation(settings?.companyProfile || {}) &&
    clnOperatorPublicSubdomainComplete(settings);
  const portalRes = await getPortalProfile(em);
  const profileComplete =
    portalRes?.ok && clnPortalProfileCompleteForAutomation(portalRes.profile || {});
  const cfg = await getPricingConfig(oid);
  const pricingComplete = !!(
    cfg &&
    typeof cfg === 'object' &&
    Array.isArray(cfg.selectedServices) &&
    cfg.selectedServices.length > 0
  );
  let firstIncomplete = null;
  if (!companyComplete) firstIncomplete = 'company';
  else if (!pricingComplete) firstIncomplete = 'pricing';
  return {
    ok: true,
    operatorId: oid,
    email: em,
    companyComplete,
    profileComplete,
    pricingComplete,
    firstIncomplete,
  };
}

async function upsertOperatorSettings(operatorId, settings) {
  await ensureOperatorSettingsTable();
  const incomingRaw = settings && typeof settings === 'object' ? { ...settings } : {};
  let publicSubdomainIncoming;
  if (Object.prototype.hasOwnProperty.call(incomingRaw, 'publicSubdomain')) {
    publicSubdomainIncoming = incomingRaw.publicSubdomain;
    delete incomingRaw.publicSubdomain;
  }
  if (publicSubdomainIncoming === undefined && incomingRaw.companyProfile && typeof incomingRaw.companyProfile === 'object') {
    const cpSub = incomingRaw.companyProfile.subdomain;
    if (cpSub != null && String(cpSub).trim()) {
      publicSubdomainIncoming = cpSub;
    }
  }
  if (publicSubdomainIncoming !== undefined) {
    const psr = await upsertOperatorPublicSubdomain(operatorId, publicSubdomainIncoming);
    if (!psr.ok) {
      const err = new Error(psr.reason || 'PUBLIC_SUBDOMAIN_UPDATE_FAILED');
      err.code = psr.reason || 'PUBLIC_SUBDOMAIN_UPDATE_FAILED';
      throw err;
    }
  }
  const [prevRows] = await pool.query(
    'SELECT settings_json FROM cln_operator_settings WHERE operator_id = ? LIMIT 1',
    [String(operatorId)]
  );
  let prev = {};
  if (prevRows.length) {
    try {
      prev = JSON.parse(prevRows[0].settings_json) || {};
    } catch {
      prev = {};
    }
  }
  delete prev.publicSubdomain;
  const incoming = incomingRaw;
  const flags = await clnIntegration.getIntegrationFlagsForOperator(operatorId);
  const merged = { ...prev, ...incoming };
  delete merged.publicSubdomain;
  merged.bukku = flags.bukku;
  merged.xero = flags.xero;
  merged.googleDrive = flags.googleDrive;
  merged.ai = !!flags.ai;
  if (flags.aiProvider) merged.aiProvider = flags.aiProvider;
  else delete merged.aiProvider;
  merged.aiKeyConfigured = !!flags.aiKeyConfigured;
  if (flags.googleDriveEmail) merged.googleDriveEmail = flags.googleDriveEmail;
  else delete merged.googleDriveEmail;
  merged.stripe = !!flags.stripeMerchant;
  if (merged.stripe) merged.xendit = false;
  merged.ttlock = !!flags.ttlockConnected;
  merged.ttlockCreateEverUsed = !!flags.ttlockCreateEverUsed;
  if (merged.companyProfile && typeof merged.companyProfile === 'object') {
    const cp = merged.companyProfile;
    const hasClock =
      String(cp.workingHourFrom || '').trim() ||
      String(cp.workingHourTo || '').trim() ||
      String(cp.outOfWorkingHourFrom || '').trim() ||
      String(cp.outOfWorkingHourTo || '').trim();
    if (hasClock && !String(cp.businessTimeZone || '').trim() && !String(cp.timeZone || '').trim()) {
      cp.businessTimeZone = 'Asia/Kuala_Lumpur';
    }
  }
  const id = `setting-${String(operatorId)}`;
  await pool.query(
    `INSERT INTO cln_operator_settings (id, operator_id, settings_json)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE settings_json = VALUES(settings_json), updated_at = CURRENT_TIMESTAMP`,
    [id, String(operatorId), JSON.stringify(merged)]
  );
}

async function listOperatorSalaries(operatorId, periodOpt) {
  return clnOperatorSalary.listOperatorSalaries(operatorId, periodOpt);
}

async function getClnActiveAccountingSystem(operatorId) {
  await clnIntegration.ensureClnOperatorIntegrationTable();
  try {
    const [rows] = await pool.query(
      `SELECT provider FROM cln_operator_integration
       WHERE operator_id = ? AND \`key\` = 'addonAccount' AND enabled = 1
       ORDER BY CASE provider WHEN 'bukku' THEN 0 WHEN 'xero' THEN 1 ELSE 2 END
       LIMIT 1`,
      [String(operatorId)]
    );
    const p = rows[0]?.provider;
    return p ? String(p).trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

async function clnAccountingTablesExist() {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name IN ('cln_account','cln_account_client')`
  );
  return Number(row?.c || 0) === 2;
}

function mapClnAccountingApiRow(row) {
  const ext = row.externalAccount != null ? String(row.externalAccount).trim() : '';
  const prod = row.externalProduct != null && String(row.externalProduct).trim() !== '' ? String(row.externalProduct).trim() : undefined;
  const isProduct = Number(row.isProduct) === 1;
  // Service products use Sales Income for GL; only product/item ID is stored — mapping = product set.
  const hasMap = isProduct ? prod != null : ext !== '';
  return {
    id: row.id,
    cleanlemonsAccount: row.cleanlemonsAccount,
    externalAccount: ext,
    externalProduct: prod,
    type: row.type || 'income',
    isProduct,
    mapped: hasMap && Number(row.mapped) === 1,
  };
}

async function listOperatorAccountingMappings(operatorId = 'op_demo_001') {
  const ok = await clnAccountingTablesExist();
  if (!ok) {
    const err = new Error(
      'CLN_ACCOUNT_TABLES_MISSING: apply migration 0185_cln_account_cln_account_client.sql (cln_account + cln_account_client)'
    );
    err.code = 'CLN_ACCOUNT_TABLES_MISSING';
    throw err;
  }
  const op = String(operatorId);
  const system = (await getClnActiveAccountingSystem(operatorId)) || 'bukku';
  let [rows] = await pool.query(
    `SELECT a.id, a.title AS cleanlemonsAccount, a.type, a.is_product AS isProduct,
            ac.id AS junction_id,
            COALESCE(ac.external_account, '') AS externalAccount,
            ac.external_product AS externalProduct,
            CASE WHEN ac.id IS NULL THEN 0 ELSE COALESCE(ac.mapped, 1) END AS mapped
     FROM cln_account a
     LEFT JOIN cln_account_client ac
       ON ac.account_id = a.id AND ac.operator_id = ? AND ac.\`system\` = ?
     ORDER BY a.sort_order ASC, a.title ASC`,
    [op, system]
  );
  return rows.map((r) => mapClnAccountingApiRow(r));
}

async function upsertOperatorAccountingMapping(operatorId = 'op_demo_001', input) {
  const ok = await clnAccountingTablesExist();
  if (!ok) {
    const err = new Error(
      'CLN_ACCOUNT_TABLES_MISSING: apply migration 0185_cln_account_cln_account_client.sql (cln_account + cln_account_client)'
    );
    err.code = 'CLN_ACCOUNT_TABLES_MISSING';
    throw err;
  }
  const op = String(operatorId);
  let accountId = null;
  const rawId = input?.id != null ? String(input.id).trim() : '';
  if (rawId) {
    const [[j]] = await pool.query(
      'SELECT account_id FROM cln_account_client WHERE id = ? AND operator_id = ? LIMIT 1',
      [rawId, op]
    );
    if (j?.account_id) accountId = j.account_id;
    if (!accountId) {
      const [[a]] = await pool.query('SELECT id FROM cln_account WHERE id = ? LIMIT 1', [rawId]);
      if (a?.id) accountId = a.id;
    }
  }
  if (!accountId && input?.cleanlemonsAccount) {
    const [[a]] = await pool.query('SELECT id FROM cln_account WHERE title = ? LIMIT 1', [String(input.cleanlemonsAccount).trim()]);
    if (a?.id) accountId = a.id;
  }
  if (!accountId) {
    const err = new Error('UNKNOWN_ACCOUNT_MAPPING');
    err.code = 'UNKNOWN_ACCOUNT_MAPPING';
    throw err;
  }
  const system = (await getClnActiveAccountingSystem(op)) || 'bukku';
  const [[acctMeta]] = await pool.query('SELECT is_product FROM cln_account WHERE id = ? LIMIT 1', [accountId]);
  const isProductRow = Number(acctMeta?.is_product) === 1;
  let externalAccount = String(input.externalAccount ?? '').trim();
  if (isProductRow) {
    externalAccount = '';
  }
  await pool.query(
    `INSERT INTO cln_account_client (id, operator_id, account_id, external_account, external_product, \`system\`, mapped)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      external_account = VALUES(external_account),
      external_product = VALUES(external_product),
      mapped = VALUES(mapped),
      updated_at = CURRENT_TIMESTAMP(3)`,
    [
      crypto.randomUUID(),
      op,
      accountId,
      externalAccount,
      input.externalProduct != null && String(input.externalProduct).trim() !== '' ? String(input.externalProduct).trim() : null,
      system,
      input.mapped === false ? 0 : 1,
    ]
  );
}

async function syncOperatorAccountingMappings(operatorId = 'op_demo_001') {
  return syncClnOperatorAccountingMappings(String(operatorId));
}

async function ensureOperatorCalendarAdjustmentTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS cln_operator_calendar_adjustment (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      operator_id VARCHAR(64) NOT NULL,
      name VARCHAR(255) NOT NULL,
      remark TEXT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      adjustment_type VARCHAR(32) NOT NULL,
      value_type VARCHAR(32) NOT NULL,
      value DECIMAL(12,2) NOT NULL DEFAULT 0,
      products_json LONGTEXT NOT NULL,
      properties_json LONGTEXT NOT NULL,
      clients_json LONGTEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

async function ensureOperatorSubscriptionTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS cln_operator_subscription (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      operator_id CHAR(36) NOT NULL,
      operator_name VARCHAR(255) NOT NULL DEFAULT '',
      operator_email VARCHAR(255) NOT NULL DEFAULT '',
      plan_code VARCHAR(32) NOT NULL DEFAULT 'basic',
      monthly_price DECIMAL(12,2) NOT NULL DEFAULT 0,
      status VARCHAR(32) NOT NULL DEFAULT 'active',
      approval_status VARCHAR(32) NOT NULL DEFAULT 'pending',
      approved_at DATETIME NULL,
      approved_by VARCHAR(128) NULL,
      approval_note TEXT NULL,
      updated_by VARCHAR(128) NULL,
      updated_note TEXT NULL,
      active_from DATE NULL,
      billing_cycle VARCHAR(16) NOT NULL DEFAULT 'monthly',
      terminated_at DATETIME NULL,
      terminated_by VARCHAR(128) NULL,
      terminated_reason TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_cln_operator_subscription_operator (operator_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
  const [activeFromRows] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'cln_operator_subscription' AND column_name = 'active_from'`
  );
  if (!Number(activeFromRows?.[0]?.c || 0)) {
    await pool.query('ALTER TABLE cln_operator_subscription ADD COLUMN active_from DATE NULL');
  }
  const [billingCycleRows] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'cln_operator_subscription' AND column_name = 'billing_cycle'`
  );
  if (!Number(billingCycleRows?.[0]?.c || 0)) {
    await pool.query("ALTER TABLE cln_operator_subscription ADD COLUMN billing_cycle VARCHAR(16) NOT NULL DEFAULT 'monthly'");
  }
  const [terminatedAtRows] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'cln_operator_subscription' AND column_name = 'terminated_at'`
  );
  if (!Number(terminatedAtRows?.[0]?.c || 0)) {
    await pool.query('ALTER TABLE cln_operator_subscription ADD COLUMN terminated_at DATETIME NULL');
  }
  const [terminatedByRows] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'cln_operator_subscription' AND column_name = 'terminated_by'`
  );
  if (!Number(terminatedByRows?.[0]?.c || 0)) {
    await pool.query('ALTER TABLE cln_operator_subscription ADD COLUMN terminated_by VARCHAR(128) NULL');
  }
  const [terminatedReasonRows] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'cln_operator_subscription' AND column_name = 'terminated_reason'`
  );
  if (!Number(terminatedReasonRows?.[0]?.c || 0)) {
    await pool.query('ALTER TABLE cln_operator_subscription ADD COLUMN terminated_reason TEXT NULL');
  }
}

/** Stripe price IDs if `cln_pricingplan` is empty or row missing (checkout must still work). */
const FALLBACK_CLN_SUBSCRIPTION_PRICE_IDS = {
  starter: {
    month: 'price_1TFbDQJw29Db2I1LMdYG5m1R',
    quarter: 'price_1TFbDQJw29Db2I1L9mvB8o2e',
    year: 'price_1TFbDQJw29Db2I1LFPYlFt8B',
  },
  growth: {
    month: 'price_1TFbEQJw29Db2I1LxpMDPmXP',
    quarter: 'price_1TFbEQJw29Db2I1LxHk2FJwI',
    year: 'price_1TFbEQJw29Db2I1LptV8JYlc',
  },
  enterprise: {
    month: 'price_1TFbGJJw29Db2I1LZrJPYcCu',
    quarter: 'price_1TFbGJJw29Db2I1LNxiGieLJ',
    year: 'price_1TFbGJJw29Db2I1LTWFAFngZ',
  },
};

const CLN_PRICINGPLAN_SEED_ROWS = [
  ['cln-pp-starter-month', 'starter', 'Starter Package', 'prod_UE3KNXl7DCwB8g', 'price_1TFbDQJw29Db2I1LMdYG5m1R', 600, 'myr', 'month', 10],
  ['cln-pp-starter-quarter', 'starter', 'Starter Package', 'prod_UE3KNXl7DCwB8g', 'price_1TFbDQJw29Db2I1L9mvB8o2e', 1710, 'myr', 'quarter', 11],
  ['cln-pp-starter-year', 'starter', 'Starter Package', 'prod_UE3KNXl7DCwB8g', 'price_1TFbDQJw29Db2I1LFPYlFt8B', 5760, 'myr', 'year', 12],
  ['cln-pp-growth-month', 'growth', 'Growth Package', 'prod_UE3LajqM7qPuPo', 'price_1TFbEQJw29Db2I1LxpMDPmXP', 1200, 'myr', 'month', 20],
  ['cln-pp-growth-quarter', 'growth', 'Growth Package', 'prod_UE3LajqM7qPuPo', 'price_1TFbEQJw29Db2I1LxHk2FJwI', 3420, 'myr', 'quarter', 21],
  ['cln-pp-growth-year', 'growth', 'Growth Package', 'prod_UE3LajqM7qPuPo', 'price_1TFbEQJw29Db2I1LptV8JYlc', 11520, 'myr', 'year', 22],
  ['cln-pp-enterprise-month', 'enterprise', 'Enterprise Package', 'prod_UE3NaGai1m5BFK', 'price_1TFbGJJw29Db2I1LZrJPYcCu', 1800, 'myr', 'month', 30],
  ['cln-pp-enterprise-quarter', 'enterprise', 'Enterprise Package', 'prod_UE3NaGai1m5BFK', 'price_1TFbGJJw29Db2I1LNxiGieLJ', 5130, 'myr', 'quarter', 31],
  ['cln-pp-enterprise-year', 'enterprise', 'Enterprise Package', 'prod_UE3NaGai1m5BFK', 'price_1TFbGJJw29Db2I1LTWFAFngZ', 17280, 'myr', 'year', 32],
];

async function ensureClnPricingplanTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS cln_pricingplan (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      plan_code VARCHAR(32) NOT NULL,
      package_title VARCHAR(255) NOT NULL DEFAULT '',
      stripe_product_id VARCHAR(64) NOT NULL DEFAULT '',
      stripe_price_id VARCHAR(64) NOT NULL,
      amount_myr DECIMAL(12,2) NOT NULL DEFAULT 0,
      currency VARCHAR(8) NOT NULL DEFAULT 'myr',
      interval_code VARCHAR(16) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_cln_pricingplan_price (stripe_price_id),
      KEY idx_cln_pricingplan_plan_interval (plan_code, interval_code, is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

async function seedClnPricingplanIfEmpty() {
  await ensureClnPricingplanTable();
  const [[{ c }]] = await pool.query('SELECT COUNT(*) AS c FROM cln_pricingplan');
  if (Number(c) > 0) return;
  for (const r of CLN_PRICINGPLAN_SEED_ROWS) {
    await pool.query(
      `INSERT INTO cln_pricingplan (id, plan_code, package_title, stripe_product_id, stripe_price_id, amount_myr, currency, interval_code, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      r
    );
  }
}

async function listClnPricingplanCatalog() {
  await seedClnPricingplanIfEmpty();
  const [rows] = await pool.query(
    `SELECT id, plan_code AS planCode, package_title AS packageTitle, stripe_product_id AS stripeProductId,
            stripe_price_id AS stripePriceId, amount_myr AS amountMyr, currency, interval_code AS intervalCode, sort_order AS sortOrder
     FROM cln_pricingplan
     WHERE is_active = 1
     ORDER BY sort_order ASC, plan_code ASC, interval_code ASC`
  );
  return rows.map((row) => ({
    ...row,
    amountMyr: Number(row.amountMyr || 0),
  }));
}

const CLN_ADDON_SEED_ROWS = [
  [
    'cln-addon-bulk-transfer',
    'bulk-transfer',
    'Bulk transfer',
    'Bank bulk salary transfer and related workflows.',
    2400,
    'myr',
    'year',
    '',
    10,
  ],
  [
    'cln-addon-api-integration',
    'api-integration',
    'API Integration',
    'Programmatic access for integrations and automation.',
    2400,
    'myr',
    'year',
    '',
    20,
  ],
];

async function ensureClnAddonTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS cln_addon (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      addon_code VARCHAR(64) NOT NULL,
      title VARCHAR(255) NOT NULL DEFAULT '',
      description VARCHAR(512) NULL,
      amount_myr DECIMAL(12,2) NOT NULL DEFAULT 0,
      currency VARCHAR(8) NOT NULL DEFAULT 'myr',
      interval_code VARCHAR(16) NOT NULL DEFAULT 'year',
      stripe_price_id VARCHAR(64) NOT NULL DEFAULT '',
      sort_order INT NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_cln_addon_code (addon_code),
      KEY idx_cln_addon_active (is_active, sort_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

async function seedClnAddonIfEmpty() {
  await ensureClnAddonTable();
  const [[{ c }]] = await pool.query('SELECT COUNT(*) AS c FROM cln_addon');
  if (Number(c) > 0) return;
  for (const r of CLN_ADDON_SEED_ROWS) {
    await pool.query(
      `INSERT INTO cln_addon (id, addon_code, title, description, amount_myr, currency, interval_code, stripe_price_id, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      r
    );
  }
}

async function listClnAddonCatalog() {
  await seedClnAddonIfEmpty();
  const [rows] = await pool.query(
    `SELECT id, addon_code AS addonCode, title, description, amount_myr AS amountMyr, currency,
            interval_code AS intervalCode, stripe_price_id AS stripePriceId, sort_order AS sortOrder
     FROM cln_addon
     WHERE is_active = 1
     ORDER BY sort_order ASC, addon_code ASC`
  );
  return rows.map((row) => ({
    ...row,
    amountMyr: Number(row.amountMyr || 0),
  }));
}

async function resolveClnSubscriptionPriceId(planCode, intervalCode) {
  const plan = String(planCode || '').trim().toLowerCase();
  const interval = String(intervalCode || 'month').trim().toLowerCase();
  if (!['starter', 'growth', 'enterprise'].includes(plan)) return null;
  if (!['month', 'quarter', 'year'].includes(interval)) return null;
  await seedClnPricingplanIfEmpty();
  const [[row]] = await pool.query(
    `SELECT stripe_price_id AS stripePriceId
     FROM cln_pricingplan
     WHERE plan_code = ? AND interval_code = ? AND is_active = 1
     LIMIT 1`,
    [plan, interval]
  );
  if (row?.stripePriceId) return String(row.stripePriceId);
  return FALLBACK_CLN_SUBSCRIPTION_PRICE_IDS[plan]?.[interval] || null;
}

async function ensureOperatorSubscriptionAddonTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS cln_operator_subscription_addon (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      operator_id CHAR(36) NOT NULL,
      addon_code VARCHAR(64) NOT NULL,
      addon_name VARCHAR(255) NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'active',
      note TEXT NULL,
      created_by VARCHAR(128) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_cln_operator_subscription_addon_operator (operator_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

async function seedOperatorSubscriptionsFromClients() {
  await ensureOperatorSubscriptionTable();
  await ensureOperatorSubscriptionAddonTable();
  const ct = await getClnCompanyTable();
  await pool.query(
    `INSERT INTO cln_operator_subscription (
      id, operator_id, operator_name, operator_email
    )
    SELECT
      CONCAT('cln-sub-', c.id) AS id,
      c.id AS operator_id,
      COALESCE(c.name, '') AS operator_name,
      COALESCE(c.email, '') AS operator_email
    FROM \`${ct}\` c
    WHERE c.id IS NOT NULL AND c.id <> ''
    ON DUPLICATE KEY UPDATE
      operator_name = VALUES(operator_name),
      operator_email = VALUES(operator_email)`
  );
}

async function ensureOperatorSubscriptionRow(operatorId) {
  const normalizedOperatorId = String(operatorId || '').trim();
  if (!normalizedOperatorId) {
    const err = new Error('MISSING_OPERATOR_ID');
    err.code = 'MISSING_OPERATOR_ID';
    throw err;
  }
  await assertClnOperatorMasterRowExists(normalizedOperatorId);
  await ensureOperatorSubscriptionTable();
  await pool.query(
    `INSERT INTO cln_operator_subscription (id, operator_id)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE operator_id = VALUES(operator_id)`,
    [`cln-sub-${normalizedOperatorId}`, normalizedOperatorId]
  );
}

async function listAdminSubscriptions({ search, plan, status, approvalStatus } = {}) {
  // Do not call seedOperatorSubscriptionsFromClients() here: that INSERTs a stub row per
  // cln_operatordetail and would recreate rows admins delete in DMS on every list refresh.
  await ensureOperatorSubscriptionTable();
  await ensureOperatorSubscriptionAddonTable();
  await ensureClnPricingplanlogTable();
  const where = ['1 = 1'];
  const params = [];

  if (search) {
    where.push('(s.operator_name LIKE ? OR s.operator_email LIKE ? OR s.operator_id LIKE ?)');
    const keyword = `%${String(search).trim()}%`;
    params.push(keyword, keyword, keyword);
  }
  if (plan) {
    where.push('s.plan_code = ?');
    params.push(String(plan).trim());
  }
  if (status) {
    where.push('s.status = ?');
    params.push(String(status).trim());
  }
  if (approvalStatus) {
    where.push('s.approval_status = ?');
    params.push(String(approvalStatus).trim());
  }

  const [rows] = await pool.query(
    `SELECT
      s.operator_id AS operatorId,
      s.operator_name AS operatorName,
      s.operator_email AS operatorEmail,
      s.plan_code AS planCode,
      s.monthly_price AS monthlyPrice,
      s.status,
      s.approval_status AS approvalStatus,
      DATE_FORMAT(s.active_from, '%Y-%m-%d') AS activeFrom,
      DATE_FORMAT(
        ${subscriptionPeriodEndExpr('s.active_from', 's.billing_cycle')},
        '%Y-%m-%d'
      ) AS expiryDate,
      s.billing_cycle AS billingCycle,
      DATE_FORMAT(s.approved_at, '%Y-%m-%d %H:%i:%s') AS approvedAt,
      COALESCE(s.approved_by, '') AS approvedBy,
      COALESCE(s.approval_note, '') AS approvalNote,
      DATE_FORMAT(s.terminated_at, '%Y-%m-%d %H:%i:%s') AS terminatedAt,
      COALESCE(s.terminated_by, '') AS terminatedBy,
      COALESCE(s.terminated_reason, '') AS terminatedReason,
      DATE_FORMAT(s.updated_at, '%Y-%m-%d %H:%i:%s') AS updatedAt
     FROM cln_operator_subscription s
     WHERE ${where.join(' AND ')}
     ORDER BY s.updated_at DESC`,
    params
  );
  const operatorIds = rows.map((row) => String(row.operatorId));
  let addonMap = new Map();
  if (operatorIds.length) {
    const placeholders = operatorIds.map(() => '?').join(',');
    const [addonRows] = await pool.query(
      `SELECT operator_id AS operatorId, id, addon_code AS addonCode, addon_name AS addonName, status, note
       FROM cln_operator_subscription_addon
       WHERE operator_id IN (${placeholders})
       ORDER BY created_at DESC`,
      operatorIds
    );
    addonMap = addonRows.reduce((map, row) => {
      const key = String(row.operatorId);
      const list = map.get(key) || [];
      list.push(row);
      map.set(key, list);
      return map;
    }, new Map());
  }
  const subInvMap = await mapLatestClnSubscriptionInvoiceByOperatorIds(rows.map((r) => r.operatorId));
  const allAddonIds = [];
  addonMap.forEach((list) => {
    for (const a of list) allAddonIds.push(a.id);
  });
  const addonInvMap = await mapLatestClnAddonInvoiceByAddonRowIds(allAddonIds);
  return rows.map((row) => {
    const invSub = subInvMap.get(String(row.operatorId)) || {};
    const rawAddons = addonMap.get(String(row.operatorId)) || [];
    const addons = rawAddons.map((a) => ({
      ...a,
      ...(addonInvMap.get(String(a.id)) || {}),
    }));
    return {
      ...row,
      ...invSub,
      monthlyPrice: Number(row.monthlyPrice || 0),
      addons,
    };
  });
}

/** Admin: paginated remote-unlock audit (lockdetail_log). */
async function listAdminLockUnlockLogs({
  q,
  lockdetailId,
  from,
  to,
  page = 1,
  pageSize = 50,
} = {}) {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 50));
  const offset = (p - 1) * ps;
  const where = ['1=1'];
  const params = [];
  if (from) {
    where.push('l.created_at >= ?');
    params.push(`${String(from).slice(0, 10)} 00:00:00.000`);
  }
  if (to) {
    where.push('l.created_at <= ?');
    params.push(`${String(to).slice(0, 10)} 23:59:59.999`);
  }
  if (lockdetailId && String(lockdetailId).trim()) {
    where.push('l.lockdetail_id = ?');
    params.push(String(lockdetailId).trim());
  }
  if (q && String(q).trim()) {
    where.push('l.actor_email LIKE ?');
    params.push(`%${String(q).trim()}%`);
  }
  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS c FROM lockdetail_log l WHERE ${where.join(' AND ')}`,
    params
  );
  const total = Number(countRows?.[0]?.c || 0);
  const [rows] = await pool.query(
    `SELECT l.id, l.lockdetail_id AS lockdetailId, l.created_at AS createdAt, l.actor_email AS actorEmail,
            l.open_method AS openMethod, l.portal_source AS portalSource, l.job_id AS jobId,
            ld.lockalias AS lockAlias, ld.lockname AS lockName, ld.lockid AS ttlockLockId
     FROM lockdetail_log l
     LEFT JOIN lockdetail ld ON ld.id = l.lockdetail_id
     WHERE ${where.join(' AND ')}
     ORDER BY l.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, ps, offset]
  );
  return { ok: true, items: rows || [], total, page: p, pageSize: ps };
}

/** Admin: lock dropdown — all lockdetail rows (not only locks that already have log rows). */
async function listAdminLockUnlockLogLockOptions() {
  const [rows] = await pool.query(
    `SELECT id AS lockdetailId,
            COALESCE(
              NULLIF(TRIM(lockalias), ''),
              NULLIF(TRIM(lockname), ''),
              IF(lockid IS NOT NULL, CAST(lockid AS CHAR), NULL),
              id
            ) AS label
     FROM lockdetail
     ORDER BY label ASC
     LIMIT 5000`
  );
  return { ok: true, items: rows || [] };
}

function prettyPlanCodeLabel(planCode) {
  const x = String(planCode || '').trim().toLowerCase();
  if (x === 'starter' || x === 'basic') return 'Basic';
  if (x === 'growth' || x === 'grow') return 'Grow';
  if (x === 'enterprise' || x === 'scale') return 'Enterprise';
  return planCode ? String(planCode) : '—';
}

/** Human-readable line for admin manual-create dialog (uses same expiry rule as portal). */
function adminManualCreateSubscriptionSummary(sub) {
  if (!sub) {
    return { text: 'No subscription record yet.', code: 'none' };
  }
  const st = String(sub.status || '').toLowerCase();
  if (st === 'terminated') {
    return {
      text: `Subscription terminated${sub.planCode ? ` (${prettyPlanCodeLabel(sub.planCode)})` : ''}.`,
      code: 'terminated',
    };
  }
  const activeFrom = sub.activeFrom ? String(sub.activeFrom).slice(0, 10) : '';
  if (!activeFrom) {
    return { text: 'No active plan yet (no start date — e.g. pending payment or not activated).', code: 'no_active_plan' };
  }
  const today = todayYmdInKualaLumpur();
  const exp = sub.expiryDate ? String(sub.expiryDate).slice(0, 10) : '';
  const planLbl = prettyPlanCodeLabel(sub.planCode);
  if (exp && exp < today) {
    return {
      text: `Has plan (${planLbl}) — expired on ${exp}.`,
      code: 'expired',
    };
  }
  if (exp) {
    return {
      text: `Active plan (${planLbl}) until ${exp}.`,
      code: 'active',
    };
  }
  return { text: 'No active plan yet.', code: 'no_active_plan' };
}

async function getAdminOperatordetailByEmail(rawEmail = '') {
  const email = String(rawEmail || '').trim().toLowerCase();
  if (!email) {
    return {
      ok: true,
      found: false,
      operatorId: null,
      companyName: '',
      phone: '',
      subscriptionSummary: '',
      subscriptionSummaryCode: '',
    };
  }
  const ct = await getClnCompanyTable();
  const [[row]] = await pool.query(
    `SELECT id, COALESCE(name, '') AS name, COALESCE(phone, '') AS phone, COALESCE(email, '') AS email
     FROM \`${ct}\`
     WHERE LOWER(TRIM(email)) = ?
     LIMIT 1`,
    [email]
  );
  if (!row?.id) {
    return {
      ok: true,
      found: false,
      operatorId: null,
      companyName: '',
      phone: '',
      subscriptionSummary: '',
      subscriptionSummaryCode: '',
    };
  }
  await seedOperatorSubscriptionsFromClients();
  const sub = await getOperatorSubscriptionBestForAdmin(String(row.id), email);
  const { text: subscriptionSummary, code: subscriptionSummaryCode } = adminManualCreateSubscriptionSummary(sub);
  return {
    ok: true,
    found: true,
    operatorId: String(row.id),
    companyName: String(row.name || ''),
    phone: String(row.phone || ''),
    subscriptionSummary,
    subscriptionSummaryCode,
  };
}
async function manualCreateAdminSubscription(payload = {}) {
  const email = String(payload.email || '').trim().toLowerCase();
  if (!email) {
    const err = new Error('MISSING_EMAIL');
    err.code = 'MISSING_EMAIL';
    throw err;
  }
  const createIfMissing = Boolean(payload.createCompanyIfMissing);
  const incomingCompany = String(payload.companyName || '').trim();
  await seedOperatorSubscriptionsFromClients();
  const ct = await getClnCompanyTable();
  const [[existing]] = await pool.query(
    `SELECT id, COALESCE(name, '') AS name, COALESCE(email, '') AS email FROM \`${ct}\` WHERE LOWER(TRIM(email)) = ? LIMIT 1`,
    [email]
  );
  let clientRow = existing;
  if (!clientRow?.id) {
    if (!createIfMissing) {
      const err = new Error(
        'OPERATORDETAIL_REQUIRED: no cln_operatordetail row for this email — register / onboarding must create the company first.'
      );
      err.code = 'OPERATORDETAIL_REQUIRED';
      throw err;
    }
    if (!incomingCompany) {
      const err = new Error('MISSING_COMPANY_FOR_NEW_OPERATOR');
      err.code = 'MISSING_COMPANY_FOR_NEW_OPERATOR';
      throw err;
    }
    await pool.query(
      `INSERT INTO \`${ct}\` (id, email, name, phone, created_at, updated_at)
       VALUES (UUID(), ?, ?, NULL, NOW(3), NOW(3))`,
      [email, incomingCompany]
    );
    const [[created]] = await pool.query(
      `SELECT id, COALESCE(name, '') AS name, COALESCE(email, '') AS email FROM \`${ct}\` WHERE LOWER(TRIM(email)) = ? LIMIT 1`,
      [email]
    );
    clientRow = created;
  } else if (incomingCompany) {
    await pool.query(
      `UPDATE \`${ct}\` SET name = ?, updated_at = NOW(3) WHERE id = ? LIMIT 1`,
      [incomingCompany, String(clientRow.id)]
    );
    clientRow = { ...clientRow, name: incomingCompany };
  }
  const operatorId = String(clientRow.id);
  const operatorName =
    String(clientRow.name || '').trim() || incomingCompany || String(payload.companyName || email.split('@')[0]).trim();
  const planCode = canonicalSubscriptionPlanCode(payload.planCode || 'starter');
  const accountingIncluded = Boolean(payload.accountingIncluded);
  if (accountingIncluded && planCode === 'starter') {
    const err = new Error('Accounting integration requires Grow or Enterprise plan.');
    err.code = 'ACCOUNTING_REQUIRES_GROWTH_OR_ENTERPRISE';
    throw err;
  }
  let accountingPaymentMethod = '';
  if (accountingIncluded) {
    accountingPaymentMethod = String(payload.accountingPaymentMethod || '').trim().toLowerCase();
    if (!accountingPaymentMethod || !['bank', 'cash'].includes(accountingPaymentMethod)) {
      const err = new Error('Accounting integration requires payment method: bank or cash.');
      err.code = 'ACCOUNTING_REQUIRES_PAYMENT_METHOD';
      throw err;
    }
  }
  const monthlyPrice = Number(payload.monthlyPrice || 0);
  const billingCycle = normalizeBillingCycleForRow(payload.billingCycle || 'monthly');
  const activeFrom = payload.activeFrom ? String(payload.activeFrom).slice(0, 10) : null;
  const noteObj = {
    accountingIncluded,
    source: 'saas_admin_manual_create',
    ...(accountingIncluded ? { accountingPaymentMethod } : {}),
  };
  const metaNote = JSON.stringify(noteObj);
  let saasBukkuInvoiceId = null;
  let saasBukkuInvoiceUrl = null;
  await pool.query(
    `INSERT INTO cln_operator_subscription (
      id, operator_id, operator_name, operator_email, plan_code, monthly_price, billing_cycle, active_from, status, approval_status, updated_by, updated_note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 'pending', ?, ?)
    ON DUPLICATE KEY UPDATE
      operator_name = VALUES(operator_name),
      operator_email = VALUES(operator_email),
      plan_code = VALUES(plan_code),
      monthly_price = VALUES(monthly_price),
      billing_cycle = VALUES(billing_cycle),
      active_from = VALUES(active_from),
      status = 'active',
      terminated_at = NULL,
      terminated_by = NULL,
      terminated_reason = NULL,
      updated_by = VALUES(updated_by),
      updated_note = VALUES(updated_note),
      updated_at = CURRENT_TIMESTAMP`,
    [
      `cln-sub-${operatorId}`,
      operatorId,
      operatorName,
      email,
      planCode,
      monthlyPrice,
      billingCycle,
      activeFrom,
      'saas-admin-manual-create',
      metaNote,
    ]
  );

  if (accountingIncluded) {
    let amountMyr = Number(payload.invoiceAmountMyr);
    if (!(amountMyr > 0)) {
      amountMyr = await catalogInvoicePeriodAmountMyr(planCode, billingCycle);
    }
    if (!(amountMyr > 0)) {
      const err = new Error('Could not resolve invoice amount; pass invoiceAmountMyr or fix cln_pricingplan.');
      err.code = 'INVOICE_AMOUNT_INVALID';
      throw err;
    }
    const invoiceDay = activeFrom || new Date().toISOString().slice(0, 10);
    const planLbl =
      planCode === 'starter' ? 'Basic' : planCode === 'growth' ? 'Grow' : planCode === 'enterprise' ? 'Enterprise' : planCode;
    const inv = await issueCleanlemonsPlatformBukkuCashInvoice({
      operatorId,
      paymentKind: accountingPaymentMethod,
      paymentLabel: 'manual',
      amountMyr,
      invoiceDateYmd: invoiceDay,
      invoiceTitle: `Cleanlemons subscription — ${planLbl}`,
      itemSummary: `${planLbl} (${billingCycle})`,
    });
    const merged = {
      ...noteObj,
      invoiceAmountMyr: amountMyr,
    };
    if (inv?.invoiceId) {
      merged.bukkuCleanlemonsPlatformInvoiceId = inv.invoiceId;
      merged.bukkuCleanlemonsPlatformInvoiceUrl = inv.invoiceUrl;
    }
    if (inv && inv.ok === false && inv.error) {
      merged.bukkuCleanlemonsPlatformInvoiceError = String(inv.error).slice(0, 400);
    }
    await pool.query(
      `UPDATE cln_operator_subscription SET updated_note = ?, updated_at = CURRENT_TIMESTAMP WHERE operator_id = ? LIMIT 1`,
      [JSON.stringify(merged), operatorId]
    );
    await insertClnSubscriptionPricingplanlogFromInvoice({
      operatorId,
      inv,
      source: 'saas_admin_manual',
      scenario: 'manual_accounting',
      planCode,
      billingCycle,
      amountMyr,
      formItemDescription: inv?.lineItemDescription,
    });
    if (inv?.invoiceId != null) saasBukkuInvoiceId = String(inv.invoiceId);
    if (inv?.invoiceUrl) saasBukkuInvoiceUrl = String(inv.invoiceUrl);
  }

  try {
    await linkOperatorSupervisorEmployeeAfterPayment({
      operatorId,
      email,
      displayName: operatorName,
    });
  } catch (linkErr) {
    console.warn('[cleanlemon] manualCreateAdminSubscription: supervisor employeedetail link', linkErr?.message || linkErr);
  }

  return { operatorId, saasBukkuInvoiceId, saasBukkuInvoiceUrl };
}

async function updateAdminSubscription(operatorId, payload = {}) {
  await ensureOperatorSubscriptionRow(operatorId);
  const planCode = canonicalSubscriptionPlanCode(payload.planCode || 'starter');
  const billingCycle = normalizeBillingCycleForRow(payload.billingCycle || 'monthly');
  const activeFrom = payload.activeFrom ? String(payload.activeFrom).slice(0, 10) : null;
  const planChangeMode = String(payload.planChangeMode || '').trim().toLowerCase();
  const billingKind = String(payload.billingKind || '').trim().toLowerCase();

  const [[currentRow]] = await pool.query(
    `SELECT plan_code AS planCode, monthly_price AS monthlyPrice, active_from AS activeFrom, billing_cycle AS billingCycle
     FROM cln_operator_subscription
     WHERE operator_id = ?
     LIMIT 1`,
    [String(operatorId)]
  );
  const prevPlan = String(currentRow?.planCode || '').trim();

  if (planChangeMode === 'upgrade') {
    const nextRank = subscriptionPlanRank(planCode);
    const prevRank = subscriptionPlanRank(prevPlan);
    if (nextRank <= prevRank) {
      const err = new Error('UPGRADE_MUST_BE_HIGHER_TIER');
      err.code = 'UPGRADE_MUST_BE_HIGHER_TIER';
      throw err;
    }
  }
  if (planChangeMode === 'renew') {
    if (canonicalSubscriptionPlanCode(planCode) !== canonicalSubscriptionPlanCode(prevPlan)) {
      const err = new Error('RENEW_PLAN_MISMATCH');
      err.code = 'RENEW_PLAN_MISMATCH';
      throw err;
    }
  }

  let monthlyPrice = Number(payload.monthlyPrice || 0);
  if (planChangeMode === 'upgrade' || planChangeMode === 'renew') {
    monthlyPrice = await monthlyPriceStoredFromCatalog(planCode, billingCycle);
  }
  if (billingKind === 'manual') {
    const pm = String(payload.paymentMethod || '').trim().toLowerCase();
    const pd = payload.paymentDate ? String(payload.paymentDate).slice(0, 10) : '';
    if (!pm || !['bank', 'cash'].includes(pm) || !pd) {
      const err = new Error('MANUAL_BILLING_REQUIRES_PAYMENT');
      err.code = 'MANUAL_BILLING_REQUIRES_PAYMENT';
      throw err;
    }
  }

  const baseNote = payload.note ? String(payload.note) : 'manual_edit';
  let updatedNote = baseNote;
  if (planChangeMode || billingKind) {
    const noteMeta = {
      planChangeMode: planChangeMode || null,
      billingKind: billingKind || null,
      paymentMethod: billingKind === 'manual' ? String(payload.paymentMethod || '').trim().toLowerCase() : null,
      paymentDate: billingKind === 'manual' && payload.paymentDate ? String(payload.paymentDate).slice(0, 10) : null,
    };
    updatedNote = `${baseNote}|${JSON.stringify(noteMeta)}`;
  }

  await pool.query(
    `UPDATE cln_operator_subscription
     SET plan_code = ?,
         monthly_price = ?,
         billing_cycle = ?,
         active_from = ?,
         operator_name = COALESCE(?, operator_name),
         operator_email = COALESCE(?, operator_email),
         updated_by = ?,
         updated_note = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE operator_id = ?
     LIMIT 1`,
    [
      planCode,
      monthlyPrice,
      billingCycle,
      activeFrom,
      payload.companyName ? String(payload.companyName) : null,
      payload.email ? String(payload.email).trim().toLowerCase() : null,
      payload.updatedBy ? String(payload.updatedBy) : null,
      updatedNote,
      String(operatorId),
    ]
  );
}

async function terminateAdminSubscription(operatorId, payload = {}) {
  await ensureOperatorSubscriptionRow(operatorId);
  await pool.query(
    `UPDATE cln_operator_subscription
     SET status = 'terminated',
         terminated_at = NOW(3),
         terminated_by = ?,
         terminated_reason = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE operator_id = ?
     LIMIT 1`,
    [payload.terminatedBy ? String(payload.terminatedBy) : null, payload.reason ? String(payload.reason) : null, String(operatorId)]
  );
}

async function addAdminSubscriptionAddon(operatorId, payload = {}) {
  await ensureOperatorSubscriptionRow(operatorId);
  await ensureOperatorSubscriptionAddonTable();
  const addonCode = String(payload.addonCode || '').trim().toLowerCase();
  if (!addonCode) {
    const err = new Error('MISSING_ADDON_CODE');
    err.code = 'MISSING_ADDON_CODE';
    throw err;
  }
  const accountingIncluded = Boolean(payload.accountingIncluded);
  let accountingPaymentMethod = '';
  if (accountingIncluded) {
    accountingPaymentMethod = String(payload.accountingPaymentMethod || '').trim().toLowerCase();
    if (!accountingPaymentMethod || !['bank', 'cash'].includes(accountingPaymentMethod)) {
      const err = new Error('Accounting integration requires payment method: bank or cash.');
      err.code = 'ACCOUNTING_REQUIRES_PAYMENT_METHOD';
      throw err;
    }
  }
  const addonCatalog = await getClnAddonRowByCode(addonCode);
  const [[dup]] = await pool.query(
    `SELECT id FROM cln_operator_subscription_addon
     WHERE operator_id = ? AND addon_code = ? AND status = 'active'
     LIMIT 1`,
    [String(operatorId), addonCode]
  );
  if (dup?.id) {
    const err = new Error('ADDON_ALREADY_ACTIVE');
    err.code = 'ADDON_ALREADY_ACTIVE';
    throw err;
  }
  const id = makeId('cln-addon');
  const notePayload = {
    accountingIncluded,
    source: 'saas_admin_addon',
    extra: payload.note ? String(payload.note) : '',
    ...(accountingIncluded ? { accountingPaymentMethod } : {}),
  };
  const noteJson = JSON.stringify(notePayload);
  await pool.query(
    `INSERT INTO cln_operator_subscription_addon
      (id, operator_id, addon_code, addon_name, status, note, created_by)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`,
    [
      id,
      String(operatorId),
      addonCode,
      String(payload.addonName || addonCode),
      noteJson,
      payload.createdBy ? String(payload.createdBy) : null,
    ]
  );

  if (accountingIncluded) {
    let amountMyr = Number(payload.invoiceAmountMyr);
    if (!(amountMyr > 0)) {
      amountMyr = Number(addonCatalog?.amountMyr || 0);
    }
    if (!(amountMyr > 0)) {
      const err = new Error('Add-on invoice amount missing; pass invoiceAmountMyr or fix cln_addon catalog.');
      err.code = 'ADDON_INVOICE_AMOUNT_INVALID';
      throw err;
    }
    const [[subRow]] = await pool.query(
      `SELECT operator_name AS operatorName, operator_email AS operatorEmail, active_from AS activeFrom
       FROM cln_operator_subscription WHERE operator_id = ? LIMIT 1`,
      [String(operatorId)]
    );
    const invoiceDay =
      String(payload.invoiceDateYmd || '').slice(0, 10) ||
      (subRow?.activeFrom ? String(subRow.activeFrom).slice(0, 10) : '') ||
      todayYmdInKualaLumpur();
    const addonTitle = String(payload.addonName || addonCode);
    const inv = await issueCleanlemonsPlatformBukkuCashInvoice({
      operatorId: String(operatorId),
      paymentKind: accountingPaymentMethod,
      paymentLabel: 'manual',
      amountMyr,
      invoiceDateYmd: invoiceDay,
      invoiceTitle: `Cleanlemons add-on — ${addonTitle}`,
      itemSummary: `${addonTitle} (add-on)`,
    });
    const merged = { ...notePayload, invoiceAmountMyr: amountMyr };
    if (inv?.invoiceId) {
      merged.bukkuCleanlemonsPlatformInvoiceId = inv.invoiceId;
      merged.bukkuCleanlemonsPlatformInvoiceUrl = inv.invoiceUrl;
    }
    if (inv && inv.ok === false && inv.error) {
      merged.bukkuCleanlemonsPlatformInvoiceError = String(inv.error).slice(0, 400);
    }
    await pool.query(`UPDATE cln_operator_subscription_addon SET note = ? WHERE id = ? LIMIT 1`, [
      JSON.stringify(merged),
      id,
    ]);
    await insertClnAddonlog({
      operatorId: String(operatorId),
      subscriptionAddonId: id,
      eventKind: 'purchase_admin',
      addonCode,
      addonName: String(payload.addonName || addonCode),
      amountMyr,
      invoiceId: inv?.invoiceId,
      invoiceUrl: inv?.invoiceUrl,
      formItemDescription: inv?.lineItemDescription,
      metaJson: { accountingIncluded: true, source: 'saas_admin_addon' },
    });
  } else {
    await insertClnAddonlog({
      operatorId: String(operatorId),
      subscriptionAddonId: id,
      eventKind: 'purchase_admin',
      addonCode,
      addonName: String(payload.addonName || addonCode),
      metaJson: { accountingIncluded: false, ...notePayload },
    });
  }
}

async function updateAdminSubscriptionPlan(operatorId, payload = {}) {
  const normalizedPlanCode = String(payload.planCode || '').trim().toLowerCase();
  if (!normalizedPlanCode) {
    const err = new Error('MISSING_PLAN_CODE');
    err.code = 'MISSING_PLAN_CODE';
    throw err;
  }
  await ensureOperatorSubscriptionRow(operatorId);
  await pool.query(
    `UPDATE cln_operator_subscription
     SET plan_code = ?,
         monthly_price = ?,
         updated_by = ?,
         updated_note = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE operator_id = ?
     LIMIT 1`,
    [
      normalizedPlanCode,
      Number(payload.monthlyPrice || 0),
      payload.updatedBy ? String(payload.updatedBy) : null,
      payload.note ? String(payload.note) : null,
      String(operatorId),
    ]
  );
}

async function updateAdminSubscriptionApproval(operatorId, payload = {}) {
  const decision = String(payload.decision || '').trim().toLowerCase();
  if (!decision || !['approved', 'rejected', 'pending'].includes(decision)) {
    const err = new Error('INVALID_DECISION');
    err.code = 'INVALID_DECISION';
    throw err;
  }
  await ensureOperatorSubscriptionRow(operatorId);
  const approvedAt = decision === 'approved' ? new Date() : null;
  await pool.query(
    `UPDATE cln_operator_subscription
     SET approval_status = ?,
         approved_at = ?,
         approved_by = ?,
         approval_note = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE operator_id = ?
     LIMIT 1`,
    [
      decision,
      approvedAt,
      payload.approvedBy ? String(payload.approvedBy) : null,
      payload.note ? String(payload.note) : null,
      String(operatorId),
    ]
  );
}

async function upsertSubscriptionFromStripeCheckout(payload = {}) {
  const email = String(payload.email || '').trim().toLowerCase();
  if (!email) {
    const err = new Error('MISSING_EMAIL');
    err.code = 'MISSING_EMAIL';
    throw err;
  }
  const planCode = canonicalSubscriptionPlanCode(payload.planCode || 'starter');
  if (!['starter', 'growth', 'enterprise'].includes(planCode)) {
    const err = new Error('INVALID_PLAN');
    err.code = 'INVALID_PLAN';
    throw err;
  }
  const intervalCode = String(payload.intervalCode || 'month').trim().toLowerCase();
  const billingCycle = billingCycleFromIntervalCode(intervalCode);
  const monthlyFromCatalog = await monthlyPriceStoredFromCatalog(planCode, billingCycle);
  const monthlyPrice =
    Number(monthlyFromCatalog) > 0 ? Number(monthlyFromCatalog) : Number(payload.monthlyPrice || 0);
  const companyName = String(payload.companyName || email.split('@')[0]).trim();
  const operatorIdMeta = String(payload.operatorId || '').trim();
  const today = new Date().toISOString().slice(0, 10);

  await seedOperatorSubscriptionsFromClients();
  if (operatorIdMeta) {
    const v = await getOperatorSubscription(operatorIdMeta, email);
    if (!v || String(v.operatorEmail || '').trim().toLowerCase() !== email) {
      const err = new Error('OPERATOR_CHECKOUT_MISMATCH');
      err.code = 'OPERATOR_CHECKOUT_MISMATCH';
      throw err;
    }
  }

  const existingRow = await getOperatorSubscription(null, email);
  let checkoutAction = String(payload.checkoutAction || '').trim().toLowerCase();

  if (!checkoutAction && existingRow?.activeFrom) {
    const cur = canonicalSubscriptionPlanCode(existingRow.planCode);
    if (cur === planCode) checkoutAction = 'renew';
    else if (subscriptionPlanRank(planCode) > subscriptionPlanRank(existingRow.planCode)) checkoutAction = 'upgrade';
    else {
      const err = new Error('DOWNGRADE_NOT_ALLOWED');
      err.code = 'DOWNGRADE_NOT_ALLOWED';
      throw err;
    }
  }
  if (!checkoutAction) checkoutAction = 'subscribe';

  let activeFrom = today;
  if (checkoutAction === 'renew') {
    if (!existingRow?.activeFrom) {
      const err = new Error('RENEW_REQUIRES_ACTIVE_SUBSCRIPTION');
      err.code = 'RENEW_REQUIRES_ACTIVE_SUBSCRIPTION';
      throw err;
    }
    if (canonicalSubscriptionPlanCode(existingRow.planCode) !== planCode) {
      const err = new Error('RENEW_PLAN_MISMATCH');
      err.code = 'RENEW_PLAN_MISMATCH';
      throw err;
    }
    const expiry = existingRow.expiryDate ? String(existingRow.expiryDate).slice(0, 10) : null;
    activeFrom = expiry ? (expiry < today ? today : expiry) : today;
  } else if (checkoutAction === 'upgrade') {
    if (existingRow?.activeFrom) {
      if (subscriptionPlanRank(planCode) <= subscriptionPlanRank(existingRow.planCode)) {
        const err = new Error('UPGRADE_REQUIRES_HIGHER_PLAN');
        err.code = 'UPGRADE_REQUIRES_HIGHER_PLAN';
        throw err;
      }
    }
    activeFrom = today;
  } else {
    if (existingRow?.activeFrom) {
      const err = new Error('ALREADY_SUBSCRIBED_USE_RENEW_OR_UPGRADE');
      err.code = 'ALREADY_SUBSCRIBED_USE_RENEW_OR_UPGRADE';
      throw err;
    }
    activeFrom = today;
  }

  const { operatorId } = await manualCreateAdminSubscription({
    email,
    companyName,
    planCode,
    monthlyPrice,
    billingCycle,
    activeFrom,
  });

  const stripeMeta = {
    stripeSessionId: payload.stripeSessionId || '',
    stripeCustomerId: payload.stripeCustomerId || '',
    stripeSubscriptionId: payload.stripeSubscriptionId || '',
    stripePriceId: payload.stripePriceId || '',
    stripeStatus: payload.stripeStatus || '',
    amountTotalCents: Number(payload.amountTotalCents || 0),
    intervalCode,
    checkoutAction,
  };

  const paidYmd =
    String(payload.paidDateYmd || '').slice(0, 10) ||
    ymdKualaLumpurFromUnixSeconds(payload.stripeSessionCreated);
  const amountMyr = Number(payload.amountTotalCents || 0) / 100;

  const stripeSid = String(payload.stripeSessionId || '').trim();
  const [[prevSub]] = await pool.query(
    `SELECT updated_note AS updatedNote FROM cln_operator_subscription WHERE operator_id = ? LIMIT 1`,
    [String(operatorId)]
  );
  let skipBukku = false;
  if (stripeSid) {
    await ensureClnPricingplanlogTable();
    const [[lg]] = await pool.query(
      `SELECT id FROM cln_pricingplanlog WHERE log_kind = 'subscription' AND stripe_session_id = ? LIMIT 1`,
      [stripeSid]
    );
    if (lg?.id) skipBukku = true;
  }
  if (!skipBukku) {
    try {
      const prev = JSON.parse(prevSub?.updatedNote || '{}');
      if (
        prev.bukkuCleanlemonsPlatformInvoiceId &&
        String(prev.stripeSessionId || '') === String(payload.stripeSessionId || '')
      ) {
        skipBukku = true;
      }
    } catch (_) {
      /* ignore */
    }
  }

  let stripeCheckoutInvoice = null;
  if (!skipBukku && amountMyr > 0) {
    const planLbl =
      planCode === 'starter' ? 'Basic' : planCode === 'growth' ? 'Grow' : planCode === 'enterprise' ? 'Enterprise' : planCode;
    const inv = await issueCleanlemonsPlatformBukkuCashInvoice({
      operatorId,
      paymentKind: 'stripe',
      paymentLabel: 'Stripe',
      amountMyr,
      invoiceDateYmd: paidYmd,
      invoiceTitle: `Cleanlemons subscription — ${planLbl}`,
      itemSummary: `${planLbl} (${billingCycle})`,
    });
    stripeCheckoutInvoice = inv;
    if (inv?.invoiceId) {
      stripeMeta.bukkuCleanlemonsPlatformInvoiceId = inv.invoiceId;
      stripeMeta.bukkuCleanlemonsPlatformInvoiceUrl = inv.invoiceUrl;
    }
    if (inv && inv.ok === false && inv.error) {
      stripeMeta.bukkuCleanlemonsPlatformInvoiceError = String(inv.error).slice(0, 400);
    }
  }

  await pool.query(
    `UPDATE cln_operator_subscription
     SET status = 'active',
         approval_status = COALESCE(NULLIF(approval_status, ''), 'pending'),
         updated_by = 'stripe_webhook',
         updated_note = ?,
         terminated_at = NULL,
         terminated_by = NULL,
         terminated_reason = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE operator_id = ?
     LIMIT 1`,
    [JSON.stringify(stripeMeta), String(operatorId)]
  );

  await insertClnSubscriptionPricingplanlogFromInvoice({
    operatorId,
    inv: stripeCheckoutInvoice,
    source: 'stripe_checkout',
    scenario: checkoutAction,
    planCode,
    billingCycle,
    amountMyr,
    amountTotalCents: payload.amountTotalCents,
    stripeSessionId: stripeSid || null,
    formItemDescription: stripeCheckoutInvoice?.lineItemDescription,
  });

  const payState = String(payload.stripeStatus || '').toLowerCase();
  if (payState === 'paid' || payState === 'no_payment_required') {
    try {
      await linkOperatorSupervisorEmployeeAfterPayment({
        operatorId: String(operatorId),
        email,
        displayName: companyName,
      });
    } catch (supErr) {
      console.warn('[cleanlemon] supervisor employeedetail link after Stripe checkout', supErr?.message || supErr);
    }
  }

  return {
    operatorId,
    email,
    planCode,
    intervalCode,
    checkoutAction,
    saasBukkuInvoiceId:
      stripeCheckoutInvoice?.invoiceId != null ? String(stripeCheckoutInvoice.invoiceId) : null,
    saasBukkuInvoiceUrl: stripeCheckoutInvoice?.invoiceUrl ? String(stripeCheckoutInvoice.invoiceUrl) : null,
  };
}

async function updateSubscriptionFromStripeEvent(payload = {}) {
  const stripeSubscriptionId = String(payload.stripeSubscriptionId || '').trim();
  if (!stripeSubscriptionId) return { updated: false, reason: 'MISSING_STRIPE_SUBSCRIPTION_ID' };
  const email = String(payload.email || '').trim().toLowerCase();
  if (email) {
    await seedOperatorSubscriptionsFromClients();
    const [[row]] = await pool.query(
      `SELECT operator_id AS operatorId
       FROM cln_operator_subscription
       WHERE LOWER(operator_email) = ?
       LIMIT 1`,
      [email]
    );
    if (row?.operatorId) {
      await ensureOperatorSubscriptionRow(row.operatorId);
      await pool.query(
        `UPDATE cln_operator_subscription
         SET status = ?,
             plan_code = ?,
             billing_cycle = ?,
             monthly_price = ?,
             updated_by = 'stripe_webhook',
             updated_note = ?,
             terminated_at = ?,
             terminated_by = ?,
             terminated_reason = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE operator_id = ?
         LIMIT 1`,
        [
          String(payload.status || 'active'),
          String(payload.planCode || 'starter'),
          String(payload.billingCycle || 'monthly'),
          Number(payload.monthlyPrice || 0),
          JSON.stringify({
            stripeSubscriptionId,
            stripeCustomerId: String(payload.stripeCustomerId || ''),
            stripePriceId: String(payload.stripePriceId || ''),
            source: 'customer.subscription',
          }),
          payload.status === 'terminated' ? new Date() : null,
          payload.status === 'terminated' ? 'stripe_webhook' : null,
          payload.status === 'terminated' ? 'subscription_deleted' : null,
          String(row.operatorId),
        ]
      );
      return { updated: true, operatorId: String(row.operatorId) };
    }
  }
  return { updated: false, reason: 'SUBSCRIPTION_ROW_NOT_FOUND' };
}

async function upsertOperatorOnboardingProfile(payload = {}) {
  const email = String(payload.email || '').trim().toLowerCase();
  if (!email) {
    const err = new Error('MISSING_EMAIL');
    err.code = 'MISSING_EMAIL';
    throw err;
  }
  const companyName = String(payload.title || payload.companyName || '').trim() || email.split('@')[0];
  const contact = String(payload.contact || '').trim();
  const ct = await getClnCompanyTable();

  const [[existing]] = await pool.query(
    `SELECT id
     FROM \`${ct}\`
     WHERE LOWER(TRIM(email)) = ?
     LIMIT 1`,
    [email]
  );

  let clientId = '';
  if (existing?.id) {
    clientId = String(existing.id);
    await pool.query(
      `UPDATE \`${ct}\`
       SET name = ?,
           phone = ?,
           updated_at = NOW(3)
       WHERE id = ?
       LIMIT 1`,
      [companyName, contact || null, clientId]
    );
  } else {
    const [ins] = await pool.query(
      `INSERT INTO \`${ct}\`
        (id, email, name, phone, created_at, updated_at)
       VALUES (UUID(), ?, ?, ?, NOW(3), NOW(3))`,
      [email, companyName, contact || null]
    );
    if (!ins?.insertId) {
      const [[created]] = await pool.query(
        `SELECT id FROM \`${ct}\` WHERE LOWER(TRIM(email)) = ? LIMIT 1`,
        [email]
      );
      clientId = String(created?.id || '');
    } else {
      const [[created]] = await pool.query(
        `SELECT id FROM \`${ct}\` WHERE LOWER(TRIM(email)) = ? LIMIT 1`,
        [email]
      );
      clientId = String(created?.id || '');
    }
  }

  if (!clientId) {
    const err = new Error('CLIENT_UPSERT_FAILED');
    err.code = 'CLIENT_UPSERT_FAILED';
    throw err;
  }

  await ensureOperatorSubscriptionTable();
  await pool.query(
    `INSERT INTO cln_operator_subscription
      (id, operator_id, operator_name, operator_email, status, approval_status, active_from, billing_cycle, monthly_price)
     VALUES (?, ?, ?, ?, 'pending', 'pending', NULL, 'monthly', 0)
     ON DUPLICATE KEY UPDATE
       operator_name = VALUES(operator_name),
       operator_email = VALUES(operator_email),
       updated_at = CURRENT_TIMESTAMP`,
    [`cln-sub-${clientId}`, clientId, companyName, email]
  );

  return { clientId, operatorId: clientId, email, companyName };
}

async function getOperatorSubscription(operatorId, email) {
  await seedOperatorSubscriptionsFromClients();
  await ensureClnPricingplanlogTable();
  const normalizedOperatorId = String(operatorId || '').trim();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedOperatorId && !normalizedEmail) {
    const err = new Error('MISSING_OPERATOR_ID_OR_EMAIL');
    err.code = 'MISSING_OPERATOR_ID_OR_EMAIL';
    throw err;
  }
  const querySql = `SELECT
    s.operator_id AS operatorId,
    s.operator_name AS operatorName,
    s.operator_email AS operatorEmail,
    s.plan_code AS planCode,
    s.monthly_price AS monthlyPrice,
    s.status AS status,
    s.approval_status AS approvalStatus,
    DATE_FORMAT(s.active_from, '%Y-%m-%d') AS activeFrom,
    DATE_FORMAT(
      ${subscriptionPeriodEndExpr('s.active_from', 's.billing_cycle')},
      '%Y-%m-%d'
    ) AS expiryDate,
    s.billing_cycle AS billingCycle,
    DATE_FORMAT(s.updated_at, '%Y-%m-%d %H:%i:%s') AS updatedAt,
    COALESCE(s.updated_note, '') AS updatedNote,
    (SELECT p.invoice_id FROM cln_pricingplanlog p
      WHERE p.operator_id COLLATE utf8mb4_unicode_ci = s.operator_id COLLATE utf8mb4_unicode_ci AND p.log_kind = 'subscription'
      ORDER BY p.created_at DESC, p.id DESC LIMIT 1) AS saasBukkuInvoiceId,
    (SELECT p.invoice_url FROM cln_pricingplanlog p
      WHERE p.operator_id COLLATE utf8mb4_unicode_ci = s.operator_id COLLATE utf8mb4_unicode_ci AND p.log_kind = 'subscription'
      ORDER BY p.created_at DESC, p.id DESC LIMIT 1) AS saasBukkuInvoiceUrl
   FROM cln_operator_subscription s
   WHERE %WHERE%
   LIMIT 1`;

  let row = null;
  if (normalizedOperatorId) {
    const [rowsByOperator] = await pool.query(
      querySql.replace(
        '%WHERE%',
        's.operator_id COLLATE utf8mb4_unicode_ci = ? COLLATE utf8mb4_unicode_ci'
      ),
      [normalizedOperatorId]
    );
    row = rowsByOperator?.[0] || null;
  }
  // Fallback to email lookup so portal can show operator card right after subscription.
  if (!row && normalizedEmail) {
    const [rowsByEmail] = await pool.query(
      querySql.replace('%WHERE%', 'LOWER(s.operator_email) = ?'),
      [normalizedEmail]
    );
    row = rowsByEmail?.[0] || null;
  }
  if (!row) return null;
  const addons = await listActiveAddonsForOperator(row.operatorId);
  const addonInvMap = await mapLatestClnAddonInvoiceByAddonRowIds(addons.map((a) => a.id));
  return {
    ...row,
    monthlyPrice: Number(row.monthlyPrice || 0),
    addons: addons.map((a) => ({
      ...a,
      ...(addonInvMap.get(String(a.id)) || {}),
    })),
  };
}

/**
 * Admin manual-create / "Check email": choose the subscription row that best reflects reality.
 * `getOperatorSubscription` prefers operator_id and never falls back when that row exists — if that
 * row is a stub (NULL active_from) while another row for the same email is activated, the dialog
 * wrongly showed "no active plan". Prefer rows with active_from, then newest updated_at.
 */
async function getOperatorSubscriptionBestForAdmin(operatorId, email) {
  await seedOperatorSubscriptionsFromClients();
  await ensureClnPricingplanlogTable();
  const oid = String(operatorId || '').trim();
  const em = String(email || '').trim().toLowerCase();
  if (!oid && !em) {
    const err = new Error('MISSING_OPERATOR_ID_OR_EMAIL');
    err.code = 'MISSING_OPERATOR_ID_OR_EMAIL';
    throw err;
  }
  const baseSelect = `SELECT
    s.operator_id AS operatorId,
    s.operator_name AS operatorName,
    s.operator_email AS operatorEmail,
    s.plan_code AS planCode,
    s.monthly_price AS monthlyPrice,
    s.status AS status,
    s.approval_status AS approvalStatus,
    DATE_FORMAT(s.active_from, '%Y-%m-%d') AS activeFrom,
    DATE_FORMAT(
      ${subscriptionPeriodEndExpr('s.active_from', 's.billing_cycle')},
      '%Y-%m-%d'
    ) AS expiryDate,
    s.billing_cycle AS billingCycle,
    DATE_FORMAT(s.updated_at, '%Y-%m-%d %H:%i:%s') AS updatedAt,
    COALESCE(s.updated_note, '') AS updatedNote,
    (SELECT p.invoice_id FROM cln_pricingplanlog p
      WHERE p.operator_id COLLATE utf8mb4_unicode_ci = s.operator_id COLLATE utf8mb4_unicode_ci AND p.log_kind = 'subscription'
      ORDER BY p.created_at DESC, p.id DESC LIMIT 1) AS saasBukkuInvoiceId,
    (SELECT p.invoice_url FROM cln_pricingplanlog p
      WHERE p.operator_id COLLATE utf8mb4_unicode_ci = s.operator_id COLLATE utf8mb4_unicode_ci AND p.log_kind = 'subscription'
      ORDER BY p.created_at DESC, p.id DESC LIMIT 1) AS saasBukkuInvoiceUrl
   FROM cln_operator_subscription s`;
  let row = null;
  if (oid && em) {
    const [r1] = await pool.query(
      `${baseSelect}
       WHERE s.operator_id COLLATE utf8mb4_unicode_ci = ? COLLATE utf8mb4_unicode_ci OR LOWER(TRIM(s.operator_email)) = ?
       ORDER BY (s.active_from IS NOT NULL AND s.active_from > '1970-01-01') DESC, s.updated_at DESC
       LIMIT 1`,
      [oid, em]
    );
    row = r1?.[0] || null;
  } else if (oid) {
    const [r2] = await pool.query(
      `${baseSelect}
       WHERE s.operator_id COLLATE utf8mb4_unicode_ci = ? COLLATE utf8mb4_unicode_ci
       LIMIT 1`,
      [oid]
    );
    row = r2?.[0] || null;
  } else {
    const [r3] = await pool.query(
      `${baseSelect}
       WHERE LOWER(TRIM(s.operator_email)) = ?
       ORDER BY (s.active_from IS NOT NULL AND s.active_from > '1970-01-01') DESC, s.updated_at DESC
       LIMIT 1`,
      [em]
    );
    row = r3?.[0] || null;
  }
  if (!row) return null;
  const addons = await listActiveAddonsForOperator(row.operatorId);
  const addonInvMapBest = await mapLatestClnAddonInvoiceByAddonRowIds(addons.map((a) => a.id));
  return {
    ...row,
    monthlyPrice: Number(row.monthlyPrice || 0),
    addons: addons.map((a) => ({
      ...a,
      ...(addonInvMapBest.get(String(a.id)) || {}),
    })),
  };
}

const KL_TZ = 'Asia/Kuala_Lumpur';

function todayYmdInKualaLumpur() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: KL_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Whole days from today YMD to expiry YMD (expiry minus today). */
function wholeDaysFromTodayToExpiry(todayYmd, expiryYmd) {
  const t = String(todayYmd || '').slice(0, 10);
  const e = String(expiryYmd || '').slice(0, 10);
  const [ty, tm, td] = t.split('-').map((x) => parseInt(x, 10));
  const [ey, em, ed] = e.split('-').map((x) => parseInt(x, 10));
  if (!ty || !ey || Number.isNaN(ty) || Number.isNaN(ey)) return -1;
  const tMs = Date.UTC(ty, tm - 1, td);
  const eMs = Date.UTC(ey, em - 1, ed);
  return Math.floor((eMs - tMs) / 86400000);
}

async function ensureClnAddonStripeSessionTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS cln_addon_stripe_session (
      stripe_session_id VARCHAR(128) NOT NULL PRIMARY KEY,
      operator_id VARCHAR(64) NOT NULL,
      addon_code VARCHAR(64) NOT NULL,
      amount_myr DECIMAL(12,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_cln_addon_stripe_operator (operator_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

async function getClnAddonRowByCode(addonCode) {
  await seedClnAddonIfEmpty();
  const code = String(addonCode || '').trim().toLowerCase();
  if (!code) return null;
  const [[row]] = await pool.query(
    `SELECT addon_code AS addonCode, title, description, amount_myr AS amountMyr, currency, interval_code AS intervalCode,
            stripe_price_id AS stripePriceId
     FROM cln_addon
     WHERE addon_code = ? AND is_active = 1
     LIMIT 1`,
    [code]
  );
  return row || null;
}

/**
 * Yearly subscription renew/upgrade: Stripe checkout includes each active add-on as recurring `price_data`
 * from `cln_addon.amount_myr` (yearly catalog).
 */
async function resolveRenewalAddonStripeLineItems(operatorId, intervalCode) {
  const oid = String(operatorId || '').trim();
  const iv = String(intervalCode || 'month').trim().toLowerCase();
  if (!oid) {
    return { ok: true, lineItems: [], addonCodes: [] };
  }
  const active = await listActiveAddonsForOperator(oid);
  if (active.length && iv !== 'year') {
    const err = new Error('RENEW_WITH_ADDONS_REQUIRES_YEARLY_BILLING');
    err.code = 'RENEW_WITH_ADDONS_REQUIRES_YEARLY_BILLING';
    throw err;
  }
  if (iv !== 'year') {
    return { ok: true, lineItems: [], addonCodes: [] };
  }
  if (!active.length) {
    return { ok: true, lineItems: [], addonCodes: [] };
  }
  const lineItems = [];
  const addonCodes = [];
  for (const a of active) {
    const cat = await getClnAddonRowByCode(a.addonCode);
    if (String(cat?.intervalCode || 'year').toLowerCase() !== 'year') {
      const err = new Error(`ADDON_NOT_YEARLY_CATALOG:${a.addonCode}`);
      err.code = 'ADDON_CATALOG_MISMATCH';
      err.addonCode = String(a.addonCode || '').trim().toLowerCase();
      throw err;
    }
    const amtMyr = Number(cat?.amountMyr || 0);
    const unitAmount = Math.round(amtMyr * 100);
    if (!(unitAmount > 0)) {
      const err = new Error(`ADDON_PRICE_INVALID:${a.addonCode}`);
      err.code = 'ADDON_PRICE_INVALID';
      err.addonCode = String(a.addonCode || '').trim().toLowerCase();
      throw err;
    }
    const code = String(a.addonCode || '').trim().toLowerCase();
    const title = String(cat?.title || code).trim() || code;
    const cur = String(cat?.currency || 'myr').toLowerCase();
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: cur,
        unit_amount: unitAmount,
        product_data: {
          name: `Cleanlemons add-on — ${title} (yearly)`,
        },
        recurring: { interval: 'year', interval_count: 1 },
      },
    });
    addonCodes.push(code);
  }
  return { ok: true, lineItems, addonCodes };
}

async function listActiveAddonsForOperator(operatorId) {
  await ensureOperatorSubscriptionAddonTable();
  const oid = String(operatorId || '').trim();
  if (!oid) return [];
  const [rows] = await pool.query(
    `SELECT id, addon_code AS addonCode, addon_name AS addonName, status
     FROM cln_operator_subscription_addon
     WHERE operator_id = ? AND status = 'active'
     ORDER BY addon_code ASC`,
    [oid]
  );
  return rows;
}

/**
 * Yearly add-on list price from MySQL, prorated by (days until subscription expiry) / 365.
 */
async function computeAddonProrationQuote({ operatorId, email, addonCode }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const oid = String(operatorId || '').trim();
  const code = String(addonCode || '').trim().toLowerCase();
  if (!oid || !normalizedEmail) {
    return { ok: false, reason: 'MISSING_OPERATOR_ID_OR_EMAIL' };
  }
  if (!code) {
    return { ok: false, reason: 'MISSING_ADDON_CODE' };
  }
  const sub = await getOperatorSubscription(oid, normalizedEmail);
  if (!sub || String(sub.operatorEmail || '').trim().toLowerCase() !== normalizedEmail) {
    return { ok: false, reason: 'OPERATOR_EMAIL_MISMATCH' };
  }
  /** Canonical id on `cln_operator_subscription` / `cln_operatordetail` (portal may still send a demo/alias id). */
  const resolvedOperatorId = String(sub.operatorId || oid).trim() || oid;
  if (String(sub.status || '').toLowerCase() === 'terminated') {
    return { ok: false, reason: 'SUBSCRIPTION_TERMINATED' };
  }
  if (!sub.activeFrom) {
    return { ok: false, reason: 'NO_ACTIVE_SUBSCRIPTION' };
  }
  const planBillingCycle = normalizeBillingCycleForRow(sub.billingCycle || 'monthly');
  if (planBillingCycle !== 'yearly') {
    return { ok: false, reason: 'ADDON_REQUIRES_YEARLY_SUBSCRIPTION', billingCycle: planBillingCycle };
  }
  const expiry = sub.expiryDate ? String(sub.expiryDate).slice(0, 10) : '';
  if (!expiry) {
    return { ok: false, reason: 'NO_EXPIRY_DATE' };
  }
  const today = todayYmdInKualaLumpur();
  const daysRemaining = wholeDaysFromTodayToExpiry(today, expiry);
  if (daysRemaining <= 0) {
    return { ok: false, reason: 'SUBSCRIPTION_PERIOD_ENDED', subscriptionExpiryDate: expiry, today };
  }
  const addon = await getClnAddonRowByCode(code);
  if (!addon) {
    return { ok: false, reason: 'ADDON_NOT_FOUND' };
  }
  if (String(addon.intervalCode || '').toLowerCase() !== 'year') {
    return { ok: false, reason: 'ADDON_NOT_YEARLY_CATALOG' };
  }
  const yearlyAmount = Number(addon.amountMyr || 0);
  if (yearlyAmount <= 0) {
    return { ok: false, reason: 'ADDON_PRICE_INVALID' };
  }
  const fraction = Math.min(1, daysRemaining / 365);
  const amountDueMyr = Number((yearlyAmount * fraction).toFixed(2));
  const MIN_MYR = 2;
  if (amountDueMyr < MIN_MYR) {
    return {
      ok: false,
      reason: 'PRORATION_BELOW_STRIPE_MINIMUM',
      minMyr: MIN_MYR,
      amountDueMyr,
      daysRemaining,
      yearlyAmountMyr: yearlyAmount,
      subscriptionExpiryDate: expiry,
      today,
    };
  }
  const dupIds =
    resolvedOperatorId !== oid ? [resolvedOperatorId, oid] : [resolvedOperatorId];
  const ph = dupIds.map(() => '?').join(',');
  const [dupRows] = await pool.query(
    `SELECT id FROM cln_operator_subscription_addon
     WHERE operator_id IN (${ph}) AND addon_code = ? AND status = 'active'
     LIMIT 1`,
    [...dupIds, code]
  );
  if (dupRows?.length) {
    return { ok: false, reason: 'ADDON_ALREADY_ACTIVE' };
  }
  return {
    ok: true,
    addonCode: code,
    addonTitle: addon.title || code,
    yearlyAmountMyr: yearlyAmount,
    amountDueMyr,
    daysRemaining,
    subscriptionExpiryDate: expiry,
    today,
    prorationBasis: 'yearly_list_times_days_remaining_over_365',
    resolvedOperatorId,
  };
}

async function createAddonCheckoutSession({ operatorId, email, name, addonCode, successUrl, cancelUrl }) {
  const quote = await computeAddonProrationQuote({ operatorId, email, addonCode });
  if (!quote.ok) {
    const err = new Error(quote.reason || 'ADDON_CHECKOUT_NOT_ALLOWED');
    err.code = quote.reason || 'ADDON_CHECKOUT_NOT_ALLOWED';
    err.details = quote;
    throw err;
  }
  const amountSen = Math.round(quote.amountDueMyr * 100);
  if (amountSen < 200) {
    const err = new Error('PRORATION_BELOW_STRIPE_MINIMUM');
    err.code = 'PRORATION_BELOW_STRIPE_MINIMUM';
    throw err;
  }
  const Stripe = require('stripe');
  const key = String(process.env.CLEANLEMON_STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY || '').trim();
  if (!key) {
    const err = new Error('STRIPE_KEY_MISSING');
    err.code = 'STRIPE_KEY_MISSING';
    throw err;
  }
  const stripe = new Stripe(key, { apiVersion: '2024-11-20.acacia' });
  const customerEmail = String(email || '').trim().toLowerCase();
  const billingOperatorId = String(quote.resolvedOperatorId || operatorId || '').trim();
  const meta = {
    type: 'cleanlemon_addon',
    operator_id: billingOperatorId,
    addon_code: quote.addonCode,
    addon_title: String(quote.addonTitle || '').slice(0, 200),
    customer_email: customerEmail,
    customer_name: String(name || '').trim().slice(0, 200),
    yearly_amount_myr: String(quote.yearlyAmountMyr),
    amount_due_myr: String(quote.amountDueMyr),
    amount_due_sen: String(amountSen),
    days_remaining: String(quote.daysRemaining),
    subscription_expiry: quote.subscriptionExpiryDate,
    proration_basis: quote.prorationBasis || 'days_over_365',
  };
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: customerEmail || undefined,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'myr',
          unit_amount: amountSen,
          product_data: {
            name: `${quote.addonTitle} (add-on, prorated)`,
            description: `Yearly list RM ${quote.yearlyAmountMyr.toFixed(
              2
            )}; ${quote.daysRemaining} days until subscription renewal (${quote.subscriptionExpiryDate}).`,
          },
        },
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: meta,
    client_reference_id: billingOperatorId.slice(0, 200),
  });
  return { url: session.url, sessionId: session.id, quote };
}

async function activateAddonFromStripeCheckoutSession(session) {
  const meta = session.metadata || {};
  if (String(meta.type || '') !== 'cleanlemon_addon') {
    return { ok: false, reason: 'WRONG_TYPE' };
  }
  const operatorId = String(meta.operator_id || '').trim();
  const addonCode = String(meta.addon_code || '').trim().toLowerCase();
  const email = String(meta.customer_email || session.customer_details?.email || '').trim().toLowerCase();
  if (!operatorId || !addonCode || !email) {
    return { ok: false, reason: 'MISSING_METADATA' };
  }
  const paymentOk = String(session.payment_status || '').toLowerCase() === 'paid';
  if (!paymentOk) {
    return { ok: true, skipped: true, reason: 'payment_not_paid' };
  }
  const quote = await computeAddonProrationQuote({ operatorId, email, addonCode });
  if (!quote.ok) {
    if (quote.reason === 'ADDON_ALREADY_ACTIVE') {
      return { ok: true, type: 'cleanlemon_addon', alreadyActive: true };
    }
    return { ok: false, reason: quote.reason, quoteFailed: true };
  }
  const billingOperatorId = String(quote.resolvedOperatorId || operatorId).trim();
  const stripeCustomerName = String(meta.customer_name || '').trim().slice(0, 200);
  const expectedSen = Math.round(quote.amountDueMyr * 100);
  const paidSen = Number(session.amount_total || 0);
  if (Math.abs(expectedSen - paidSen) > 5) {
    console.error('[cleanlemon] addon checkout amount mismatch', {
      sessionId: session.id,
      expectedSen,
      paidSen,
      metaOperatorId: operatorId,
      billingOperatorId,
      addonCode,
    });
    return { ok: false, reason: 'AMOUNT_MISMATCH' };
  }

  await ensureClnAddonStripeSessionTable();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [ins] = await conn.query(
      `INSERT IGNORE INTO cln_addon_stripe_session (stripe_session_id, operator_id, addon_code, amount_myr)
       VALUES (?, ?, ?, ?)`,
      [String(session.id), billingOperatorId, addonCode, quote.amountDueMyr]
    );
    if (ins.affectedRows === 0) {
      await conn.commit();
      return { ok: true, type: 'cleanlemon_addon', duplicate: true };
    }
    const [[dupAddon]] = await conn.query(
      `SELECT id FROM cln_operator_subscription_addon
       WHERE operator_id = ? AND addon_code = ? AND status = 'active'
       LIMIT 1`,
      [billingOperatorId, addonCode]
    );
    if (dupAddon?.id) {
      await conn.query(`DELETE FROM cln_addon_stripe_session WHERE stripe_session_id = ?`, [String(session.id)]);
      await conn.commit();
      return { ok: true, type: 'cleanlemon_addon', alreadyActive: true };
    }
    const id = makeId('cln-addon');
    const addonName = String(meta.addon_title || addonCode).slice(0, 255);
    await conn.query(
      `INSERT INTO cln_operator_subscription_addon
        (id, operator_id, addon_code, addon_name, status, note, created_by)
       VALUES (?, ?, ?, ?, 'active', ?, ?)`,
      [id, billingOperatorId, addonCode, addonName, `stripe:${session.id}`, 'stripe_webhook']
    );
    await conn.commit();
    const newAddonId = id;
    const paidYmd = ymdKualaLumpurFromUnixSeconds(session.created);
    const amountMyr = Number(quote.amountDueMyr);
    try {
      const inv = await issueCleanlemonsPlatformBukkuCashInvoice({
        operatorId: billingOperatorId,
        paymentKind: 'stripe',
        paymentLabel: 'Stripe',
        amountMyr,
        invoiceDateYmd: paidYmd,
        invoiceTitle: `Cleanlemons add-on — ${addonName}`,
        itemSummary: `${addonName} (add-on)`,
        fallbackCustomerEmail: email,
        fallbackCustomerName: stripeCustomerName,
      });
      const noteObj = {
        source: 'stripe_addon',
        stripeSessionId: String(session.id),
        accountingIncluded: true,
        ...(inv?.invoiceId
          ? { bukkuCleanlemonsPlatformInvoiceId: inv.invoiceId, bukkuCleanlemonsPlatformInvoiceUrl: inv.invoiceUrl }
          : {}),
        ...(inv && inv.ok === false && inv.error
          ? { bukkuCleanlemonsPlatformInvoiceError: String(inv.error).slice(0, 400) }
          : {}),
      };
      await pool.query(`UPDATE cln_operator_subscription_addon SET note = ? WHERE id = ? LIMIT 1`, [
        JSON.stringify(noteObj),
        newAddonId,
      ]);
      await insertClnAddonlog({
        operatorId: billingOperatorId,
        subscriptionAddonId: newAddonId,
        eventKind: 'purchase_stripe',
        addonCode,
        addonName,
        amountMyr,
        stripeSessionId: String(session.id),
        invoiceId: inv?.invoiceId,
        invoiceUrl: inv?.invoiceUrl,
        formItemDescription: inv?.lineItemDescription,
        metaJson: { stripeSessionId: String(session.id), source: 'stripe_addon' },
        fallbackCustomerEmail: email,
        fallbackCustomerName: stripeCustomerName,
      });
    } catch (bErr) {
      const msg = String(bErr?.message || bErr || 'unknown');
      console.warn('[cleanlemon] addon post-payment step failed (Bukku and/or cln_addonlog)', msg);
      try {
        await insertClnAddonlog({
          operatorId: billingOperatorId,
          subscriptionAddonId: newAddonId,
          eventKind: 'purchase_stripe',
          addonCode,
          addonName,
          amountMyr,
          stripeSessionId: String(session.id),
          fallbackCustomerEmail: email,
          fallbackCustomerName: stripeCustomerName,
          metaJson: {
            source: 'stripe_addon',
            bukkuError: String(bErr?.message || bErr || 'unknown').slice(0, 400),
          },
        });
      } catch (_) {
        /* ignore */
      }
    }
    return {
      ok: true,
      type: 'cleanlemon_addon',
      operatorId: billingOperatorId,
      addonCode,
    };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function getSubscriptionCheckoutEligibility({ email, operatorId, planCode, checkoutAction }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const rawPlan = canonicalSubscriptionPlanCode(planCode || 'starter');
  if (!['starter', 'growth', 'enterprise'].includes(rawPlan)) {
    return { ok: false, code: 'INVALID_PLAN' };
  }
  const action = String(checkoutAction || '').trim().toLowerCase();

  let current = null;
  if (operatorId) {
    current = await getOperatorSubscription(String(operatorId), normalizedEmail);
    if (!current || String(current.operatorEmail || '').trim().toLowerCase() !== normalizedEmail) {
      return { ok: false, code: 'OPERATOR_EMAIL_MISMATCH' };
    }
  } else {
    await seedOperatorSubscriptionsFromClients();
    current = await getOperatorSubscription(null, normalizedEmail);
  }

  const hasActivePeriod = !!current?.activeFrom;

  if (!action || action === 'subscribe' || action === 'new') {
    if (hasActivePeriod) return { ok: false, code: 'USE_RENEW_OR_UPGRADE', current };
    return { ok: true, current, planCode: rawPlan };
  }
  if (action === 'renew') {
    if (!hasActivePeriod) return { ok: false, code: 'RENEW_REQUIRES_ACTIVE_SUBSCRIPTION', current };
    if (canonicalSubscriptionPlanCode(current.planCode) !== rawPlan) {
      return { ok: false, code: 'RENEW_PLAN_MISMATCH', current };
    }
    return { ok: true, current, planCode: rawPlan };
  }
  if (action === 'upgrade') {
    if (!hasActivePeriod) return { ok: true, current, planCode: rawPlan };
    if (subscriptionPlanRank(rawPlan) <= subscriptionPlanRank(current.planCode)) {
      return { ok: false, code: 'DOWNGRADE_OR_SAME_NOT_ALLOWED', current };
    }
    return { ok: true, current, planCode: rawPlan };
  }
  return { ok: false, code: 'INVALID_CHECKOUT_ACTION', current };
}

/**
 * Enquiry step 2: company row exists by email + whether initial subscribe checkout is blocked
 * because subscription already has an active period (same rule as getSubscriptionCheckoutEligibility).
 */
async function getOnboardingEnquiryStatusByEmail(rawEmail = '') {
  const email = String(rawEmail || '').trim().toLowerCase();
  if (!email) {
    return { ok: true, email: '', companyExists: false, redirectToCompany: false, profile: null };
  }
  const ct = await getClnCompanyTable();
  await seedOperatorSubscriptionsFromClients();
  const [[row]] = await pool.query(
    `SELECT id, COALESCE(name, '') AS name, COALESCE(phone, '') AS phone, COALESCE(email, '') AS email
     FROM \`${ct}\`
     WHERE LOWER(TRIM(email)) = ?
     LIMIT 1`,
    [email]
  );
  if (!row?.id) {
    return { ok: true, email, companyExists: false, redirectToCompany: false, profile: null };
  }
  const operatorId = String(row.id);
  const elig = await getSubscriptionCheckoutEligibility({
    email,
    operatorId,
    planCode: 'starter',
    checkoutAction: 'subscribe',
  });
  const redirectToCompany = elig.ok === false && String(elig.code || '') === 'USE_RENEW_OR_UPGRADE';
  const title = String(row.name || '').trim() || email.split('@')[0];
  const phone = String(row.phone || '').trim();
  return {
    ok: true,
    email,
    companyExists: true,
    redirectToCompany,
    profile: { title, contact: phone, email, operatorId },
  };
}

async function listOperatorCalendarAdjustments(operatorId = 'op_demo_001') {
  await ensureOperatorCalendarAdjustmentTable();
  const [rows] = await pool.query(
    `SELECT id, name, COALESCE(remark, '') AS remark,
            DATE_FORMAT(start_date, '%Y-%m-%d') AS startDate,
            DATE_FORMAT(end_date, '%Y-%m-%d') AS endDate,
            adjustment_type AS adjustmentType,
            value_type AS valueType,
            value,
            products_json AS productsJson,
            properties_json AS propertiesJson,
            clients_json AS clientsJson
     FROM cln_operator_calendar_adjustment
     WHERE operator_id = ?
     ORDER BY start_date DESC, created_at DESC`,
    [String(operatorId)]
  );
  return rows.map((row) => ({
    ...row,
    value: Number(row.value || 0),
    products: safeJson(row.productsJson, []),
    properties: safeJson(row.propertiesJson, []),
    clients: safeJson(row.clientsJson, []),
  }));
}

async function createOperatorCalendarAdjustment(operatorId = 'op_demo_001', input = {}) {
  await ensureOperatorCalendarAdjustmentTable();
  const id = input.id || makeId('cln-cal');
  await pool.query(
    `INSERT INTO cln_operator_calendar_adjustment
      (id, operator_id, name, remark, start_date, end_date, adjustment_type, value_type, value, products_json, properties_json, clients_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      String(operatorId),
      String(input.name || ''),
      input.remark || null,
      String(input.startDate || ''),
      String(input.endDate || ''),
      String(input.adjustmentType || 'markup'),
      String(input.valueType || 'percentage'),
      Number(input.value || 0),
      JSON.stringify(Array.isArray(input.products) ? input.products : []),
      JSON.stringify(Array.isArray(input.properties) ? input.properties : []),
      JSON.stringify(Array.isArray(input.clients) ? input.clients : []),
    ]
  );
  return id;
}

async function updateOperatorCalendarAdjustment(id, operatorId, input = {}) {
  await ensureOperatorCalendarAdjustmentTable();
  const op = String(operatorId || '').trim();
  if (!op) {
    const err = new Error('MISSING_OPERATOR_ID');
    err.code = 'MISSING_OPERATOR_ID';
    throw err;
  }
  const [r] = await pool.query(
    `UPDATE cln_operator_calendar_adjustment
     SET name = ?, remark = ?, start_date = ?, end_date = ?, adjustment_type = ?, value_type = ?, value = ?,
         products_json = ?, properties_json = ?, clients_json = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND operator_id = ?
     LIMIT 1`,
    [
      String(input.name || ''),
      input.remark || null,
      String(input.startDate || ''),
      String(input.endDate || ''),
      String(input.adjustmentType || 'markup'),
      String(input.valueType || 'percentage'),
      Number(input.value || 0),
      JSON.stringify(Array.isArray(input.products) ? input.products : []),
      JSON.stringify(Array.isArray(input.properties) ? input.properties : []),
      JSON.stringify(Array.isArray(input.clients) ? input.clients : []),
      String(id),
      op,
    ]
  );
  if (!r || Number(r.affectedRows || 0) < 1) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    throw err;
  }
}

async function deleteOperatorCalendarAdjustment(id, operatorId) {
  await ensureOperatorCalendarAdjustmentTable();
  const op = String(operatorId || '').trim();
  if (!op) {
    const err = new Error('MISSING_OPERATOR_ID');
    err.code = 'MISSING_OPERATOR_ID';
    throw err;
  }
  const [r] = await pool.query(
    'DELETE FROM cln_operator_calendar_adjustment WHERE id = ? AND operator_id = ? LIMIT 1',
    [String(id), op]
  );
  if (!r || Number(r.affectedRows || 0) < 1) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    throw err;
  }
}

/** Merge `cln_clientdetail` (via `cln_client_operator`) into invoice client picker for the operator. */
async function mergeOperatorServiceClientsFromClientDetail(operatorId, existingClients) {
  const oid = String(operatorId || '').trim();
  if (!oid) return Array.isArray(existingClients) ? existingClients : [];
  const base = Array.isArray(existingClients) ? existingClients : [];
  let detailRows = [];
  try {
    const [rows] = await pool.query(
      `SELECT d.id AS id,
              TRIM(COALESCE(NULLIF(TRIM(d.fullname), ''), NULLIF(TRIM(d.email), ''), d.id)) AS name,
              COALESCE(TRIM(d.email), '') AS email
       FROM cln_clientdetail d
       INNER JOIN cln_client_operator j ON j.clientdetail_id = d.id AND j.operator_id = ?
       ORDER BY name ASC`,
      [oid]
    );
    detailRows = rows || [];
  } catch (_) {
    /* missing tables */
  }
  const merged = new Map();
  for (const c of detailRows) {
    merged.set(String(c.id), {
      id: c.id,
      name: String(c.name || c.email || c.id),
      email: String(c.email || ''),
    });
  }
  for (const c of base) {
    const k = String(c.id);
    if (!merged.has(k)) {
      merged.set(k, {
        id: c.id,
        name: String(c.name || c.email || c.id),
        email: String(c.email || ''),
      });
    }
  }
  return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function parsePropertyClientReferenceFromCcJson(raw) {
  if (raw == null) return '';
  const s = String(raw).trim();
  if (!s) return '';
  try {
    const obj = JSON.parse(s);
    const ref = obj && typeof obj === 'object' ? String(obj.wixClientReference || '').trim() : '';
    return ref;
  } catch {
    return '';
  }
}

function normalizeInvoicePropertyClientIds(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return list.map((row) => {
    const explicitClientdetailId = String(row?.clientdetailId || '').trim();
    const ref = parsePropertyClientReferenceFromCcJson(row?.ccJson);
    const fallback = String(row?.clientIdRaw || '').trim();
    return {
      ...row,
      // Prefer B2B clientdetail, then DB client_id (company / legacy), then Wix JSON ref — ref last so it
      // does not mask real FKs and break invoice property filtering vs. the client picker.
      clientId: explicitClientdetailId || fallback || ref,
    };
  });
}

function normalizeInvoiceClientLabelLookupKey(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Map `operator_id|normalized fullname or email` → cln_clientdetail.id for invoice property matching.
 * Used when `cln_property.client_label` is set but `clientdetail_id` is still null (legacy / import).
 */
async function buildOperatorClientLabelToClientdetailLookup(operatorIds) {
  const ids = [...new Set((Array.isArray(operatorIds) ? operatorIds : []).map((x) => String(x || '').trim()).filter(Boolean))];
  if (!ids.length) return new Map();
  try {
    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await pool.query(
      `SELECT j.operator_id AS operatorId,
              d.id AS clientdetailId,
              NULLIF(TRIM(d.fullname), '') AS fullname,
              NULLIF(TRIM(d.email), '') AS email
       FROM cln_client_operator j
       INNER JOIN cln_clientdetail d ON d.id = j.clientdetail_id
       WHERE j.operator_id IN (${placeholders})`,
      ids
    );
    const map = new Map();
    for (const r of rows || []) {
      const op = String(r.operatorId || '').trim();
      const cid = String(r.clientdetailId || '').trim();
      if (!op || !cid) continue;
      for (const raw of [r.fullname, r.email]) {
        const k = normalizeInvoiceClientLabelLookupKey(raw);
        if (!k) continue;
        const comp = `${op}|${k}`;
        if (!map.has(comp)) map.set(comp, cid);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

function applyInvoicePropertyClientdetailFromLabels(properties, lookup) {
  const list = Array.isArray(properties) ? properties : [];
  if (!lookup || lookup.size === 0) return list;
  return list.map((row) => {
    let cd = String(row.clientdetailId || '').trim();
    if (cd) return row;
    const label = String(row.clientLabel ?? row.client_label ?? '').trim();
    const op = String(row.operatorId ?? row.operator_id ?? '').trim();
    if (!label || !op) return row;
    const resolved = lookup.get(`${op}|${normalizeInvoiceClientLabelLookupKey(label)}`);
    if (!resolved) return row;
    return { ...row, clientdetailId: resolved };
  });
}

async function listOperatorInvoiceFormOptions(operatorId) {
  const ct = await getClnCompanyTable();
  const oid = String(operatorId || '').trim();
  const hasOpCol = await databaseHasColumn('cln_property', 'operator_id');
  const hasClientdetailCol = await databaseHasColumn('cln_property', 'clientdetail_id');
  const hasPropClientId = await databaseHasColumn('cln_property', 'client_id');
  const clientIdRawSelect = hasPropClientId
    ? `COALESCE(NULLIF(TRIM(p.client_id), ''), '') AS clientIdRaw`
    : `'' AS clientIdRaw`;
  const hasClientLabelCol = await databaseHasColumn('cln_property', 'client_label');
  const clientLabelSelect = hasClientLabelCol
    ? `COALESCE(NULLIF(TRIM(p.client_label), ''), '') AS clientLabel`
    : `'' AS clientLabel`;
  const operatorIdSelect = hasOpCol
    ? `COALESCE(NULLIF(TRIM(p.operator_id), ''), '') AS operatorId`
    : `'' AS operatorId`;

  const propertyLabelSql = `TRIM(CONCAT(
      COALESCE(NULLIF(TRIM(p.property_name), ''), ''),
      CASE
        WHEN NULLIF(TRIM(p.unit_name), '') IS NOT NULL AND NULLIF(TRIM(p.property_name), '') IS NOT NULL
          THEN CONCAT(' (', TRIM(p.unit_name), ')')
        WHEN NULLIF(TRIM(p.unit_name), '') IS NOT NULL AND NULLIF(TRIM(p.property_name), '') IS NULL
          THEN TRIM(p.unit_name)
        ELSE ''
      END
    ))`;

  if (oid && hasOpCol) {
    const [properties] = await pool.query(
      `SELECT p.id,
        ${operatorIdSelect},
        ${clientLabelSelect},
        ${clientIdRawSelect},
        ${hasClientdetailCol ? "COALESCE(NULLIF(TRIM(p.clientdetail_id), ''), '')" : "''"} AS clientdetailId,
        p.cc_json AS ccJson,
        COALESCE(NULLIF(TRIM(p.property_name), ''), '') AS propertyName,
        COALESCE(NULLIF(TRIM(p.unit_name), ''), '') AS unitName,
        ${propertyLabelSql} AS name
       FROM cln_property p
       WHERE p.operator_id = ?
       ORDER BY p.updated_at DESC, p.created_at DESC
       LIMIT 500`,
      [oid]
    );
    let fromLinked = [];
    if (hasPropClientId) {
      const [fl] = await pool.query(
        `SELECT DISTINCT o.id, COALESCE(o.name, '') AS name, COALESCE(o.email, '') AS email
         FROM \`${ct}\` o
         INNER JOIN cln_property p ON p.client_id = o.id
         WHERE p.operator_id = ?
         ORDER BY name ASC
         LIMIT 500`,
        [oid]
      );
      fromLinked = fl || [];
    } else if (hasClientdetailCol) {
      const [fl] = await pool.query(
        `SELECT DISTINCT d.id,
                TRIM(COALESCE(NULLIF(TRIM(d.fullname), ''), NULLIF(TRIM(d.email), ''), d.id)) AS name,
                COALESCE(TRIM(d.email), '') AS email
         FROM cln_property p
         INNER JOIN cln_clientdetail d ON d.id = p.clientdetail_id
         WHERE p.operator_id = ?
         ORDER BY name ASC
         LIMIT 500`,
        [oid]
      );
      fromLinked = fl || [];
    }
    let clients = fromLinked;
    const [[self]] = await pool.query(
      `SELECT id, COALESCE(name, '') AS name, COALESCE(email, '') AS email
       FROM \`${ct}\` WHERE id = ? LIMIT 1`,
      [oid]
    );
    if (self && self.id && !clients.some((c) => String(c.id) === String(self.id))) {
      clients = [self, ...clients];
    }
    if (!clients.length && self && self.id) {
      clients = [self];
    }
    clients = await mergeOperatorServiceClientsFromClientDetail(oid, clients);
    const labelLookup = await buildOperatorClientLabelToClientdetailLookup([oid]);
    const propsWithLabels = applyInvoicePropertyClientdetailFromLabels(properties, labelLookup);
    return { clients, properties: normalizeInvoicePropertyClientIds(propsWithLabels) };
  }

  let [clients] = await pool.query(
    `SELECT id, COALESCE(name, '') AS name, COALESCE(email, '') AS email
     FROM \`${ct}\`
     ORDER BY name ASC
     LIMIT 500`
  );
  if (oid) {
    const [[self]] = await pool.query(
      `SELECT id, COALESCE(name, '') AS name, COALESCE(email, '') AS email
       FROM \`${ct}\` WHERE id = ? LIMIT 1`,
      [oid]
    );
    if (self && self.id && !clients.some((c) => String(c.id) === String(self.id))) {
      clients = [self, ...clients];
    }
    clients = await mergeOperatorServiceClientsFromClientDetail(oid, clients);
  }
  const [properties] = await pool.query(
    `SELECT p.id,
      ${operatorIdSelect},
      ${clientLabelSelect},
      ${clientIdRawSelect},
      ${hasClientdetailCol ? "COALESCE(NULLIF(TRIM(p.clientdetail_id), ''), '')" : "''"} AS clientdetailId,
      p.cc_json AS ccJson,
      COALESCE(NULLIF(TRIM(p.property_name), ''), '') AS propertyName,
      COALESCE(NULLIF(TRIM(p.unit_name), ''), '') AS unitName,
      ${propertyLabelSql} AS name
     FROM cln_property p
     ORDER BY p.updated_at DESC
     LIMIT 500`
  );
  const opIdsForLabels = [
    ...new Set(
      (Array.isArray(properties) ? properties : [])
        .map((r) => String(r.operatorId || r.operator_id || '').trim())
        .filter(Boolean)
    ),
  ];
  const labelLookup =
    opIdsForLabels.length > 0 ? await buildOperatorClientLabelToClientdetailLookup(opIdsForLabels) : new Map();
  const propsWithLabels = applyInvoicePropertyClientdetailFromLabels(properties, labelLookup);
  return { clients, properties: normalizeInvoicePropertyClientIds(propsWithLabels) };
}

async function createOperatorInvoice(input = {}) {
  const id = input.id || makeId('cln-inv');
  const amount = Number(input.amount || 0);
  const opId = String(input.operatorId || '').trim();
  const hasInvOp = await databaseHasColumn('cln_client_invoice', 'operator_id');
  if (hasInvOp && !opId) {
    const err = new Error('OPERATOR_ID_REQUIRED');
    err.code = 'OPERATOR_ID_REQUIRED';
    err.statusCode = 400;
    throw err;
  }
  if (hasInvOp && opId) {
    await pool.query(
      `INSERT INTO cln_client_invoice
        (id, invoice_number, client_id, operator_id, description, amount, payment_received, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
      [
        id,
        String(input.invoiceNo || id),
        String(input.clientId || ''),
        opId,
        String(input.description || ''),
        amount,
        0,
      ]
    );
  } else {
    await pool.query(
      `INSERT INTO cln_client_invoice
        (id, invoice_number, client_id, description, amount, payment_received, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
      [
        id,
        String(input.invoiceNo || id),
        String(input.clientId || ''),
        String(input.description || ''),
        amount,
        0,
      ]
    );
  }
  const clipYmd = (v) => {
    const s = String(v || '').trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  };
  const issueYmd = clipYmd(input.issueDate);
  const dueYmd = clipYmd(input.dueDate);
  const hasIssueCol = await databaseHasColumn('cln_client_invoice', 'issue_date');
  const hasDueCol = await databaseHasColumn('cln_client_invoice', 'due_date');
  if ((hasIssueCol && issueYmd) || (hasDueCol && dueYmd)) {
    const sets = [];
    const vals = [];
    if (hasIssueCol && issueYmd) {
      sets.push('issue_date = ?');
      vals.push(issueYmd);
    }
    if (hasDueCol && dueYmd) {
      sets.push('due_date = ?');
      vals.push(dueYmd);
    }
    if (sets.length) {
      vals.push(id);
      await pool.query(`UPDATE cln_client_invoice SET ${sets.join(', ')}, updated_at = NOW(3) WHERE id = ? LIMIT 1`, vals);
    }
  }
  let pdfUrlFromAccounting;
  let accountingMetaFromAccounting;
  const operatorId = String(input.operatorId || '').trim();
  if (operatorId) {
    try {
      const ar = await clnOpInvAccounting.createAccountingInvoiceForOperator(operatorId, id, input);
      if (!ar.ok && !ar.skipped) {
        await pool.query('DELETE FROM cln_client_invoice WHERE id = ? LIMIT 1', [id]);
        const err = new Error(ar.reason || 'ACCOUNTING_INVOICE_FAILED');
        err.detail = ar.detail;
        err.code = ar.code || ar.reason || 'ACCOUNTING_INVOICE_FAILED';
        err.statusCode = 400;
        throw err;
      }
      if (ar.pdfUrl != null && String(ar.pdfUrl).trim() !== '') {
        pdfUrlFromAccounting = String(ar.pdfUrl).trim();
      }
      if (ar.accountingMeta != null && typeof ar.accountingMeta === 'object') {
        accountingMetaFromAccounting = ar.accountingMeta;
      }
    } catch (e) {
      await pool.query('DELETE FROM cln_client_invoice WHERE id = ? LIMIT 1', [id]).catch(() => {});
      throw e;
    }
  }
  const hasInvMetaCol = await databaseHasColumn('cln_client_invoice', 'accounting_meta_json');
  const invSelectCols = hasInvMetaCol ? 'invoice_number, pdf_url, accounting_meta_json' : 'invoice_number, pdf_url';
  const [[row]] = await pool.query(`SELECT ${invSelectCols} FROM cln_client_invoice WHERE id = ? LIMIT 1`, [id]);
  const invoiceNoFinal = row?.invoice_number != null && String(row.invoice_number).trim() !== ''
    ? String(row.invoice_number).trim()
    : String(input.invoiceNo || id);
  const pdfUrlFinal =
    pdfUrlFromAccounting != null && String(pdfUrlFromAccounting).trim() !== ''
      ? String(pdfUrlFromAccounting).trim()
      : row?.pdf_url != null && String(row.pdf_url).trim() !== ''
        ? String(row.pdf_url).trim()
        : undefined;
  let accountingMetaOut = accountingMetaFromAccounting;
  if (!accountingMetaOut && hasInvMetaCol && row?.accounting_meta_json) {
    try {
      accountingMetaOut = JSON.parse(String(row.accounting_meta_json));
    } catch {
      accountingMetaOut = undefined;
    }
  }
  return {
    id,
    invoiceNo: invoiceNoFinal,
    ...(pdfUrlFinal ? { pdfUrl: pdfUrlFinal } : {}),
    ...(accountingMetaOut ? { accountingMeta: accountingMetaOut } : {})
  };
}

async function updateOperatorInvoice(id, patch = {}) {
  const status = String(patch.status || '').trim();
  const clipYmd = (v) => {
    const s = String(v || '').trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  };
  const issueYmd = clipYmd(patch.issueDate);
  const dueYmd = clipYmd(patch.dueDate);
  const hasIssueCol = await databaseHasColumn('cln_client_invoice', 'issue_date');
  const hasDueCol = await databaseHasColumn('cln_client_invoice', 'due_date');
  let sql = `UPDATE cln_client_invoice
     SET invoice_number = ?, client_id = ?, description = ?, amount = ?, payment_received = ?`;
  const vals = [
    String(patch.invoiceNo || id),
    String(patch.clientId || ''),
    String(patch.description || ''),
    Number(patch.amount || 0),
    status === 'paid' ? 1 : 0,
  ];
  if (hasIssueCol && issueYmd) {
    sql += ', issue_date = ?';
    vals.push(issueYmd);
  }
  if (hasDueCol && dueYmd) {
    sql += ', due_date = ?';
    vals.push(dueYmd);
  }
  sql += ', updated_at = NOW(3) WHERE id = ? LIMIT 1';
  vals.push(String(id));
  await pool.query(sql, vals);
}

async function ensureEmployeeAttendanceTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS cln_employee_attendance (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      operatordetail_id CHAR(36) NULL COMMENT 'FK cln_operatordetail.id',
      email VARCHAR(255) NOT NULL,
      date_key DATE NOT NULL,
      working_in_iso DATETIME(3) NULL,
      working_out_iso DATETIME(3) NULL,
      checkin_location_json LONGTEXT NULL,
      checkout_location_json LONGTEXT NULL,
      checkin_photo_url TEXT NULL,
      checkout_photo_url TEXT NULL,
      checkin_proof_hash VARCHAR(128) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_cln_emp_attendance_od_email_date (operatordetail_id, email, date_key),
      KEY idx_cln_employee_attendance_operatordetail_id (operatordetail_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

async function listEmployeeAttendanceByEmail(email, operatorId) {
  await ensureEmployeeAttendanceTable();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return [];
  const hasOd = await databaseHasColumn('cln_employee_attendance', 'operatordetail_id');
  const oid = String(operatorId || '').trim();
  const opClause = hasOd && oid ? ' AND operatordetail_id <=> ?' : '';
  const params = hasOd && oid ? [normalizedEmail, oid] : [normalizedEmail];
  const [rows] = await pool.query(
    `SELECT id,
            DATE_FORMAT(date_key, '%Y-%m-%d') AS dateKey,
            IFNULL(DATE_FORMAT(working_in_iso, '%Y-%m-%dT%H:%i:%s.000Z'), NULL) AS workingInIso,
            IFNULL(DATE_FORMAT(working_out_iso, '%Y-%m-%dT%H:%i:%s.000Z'), NULL) AS workingOutIso,
            checkin_location_json AS checkinLocationJson,
            checkout_location_json AS checkoutLocationJson,
            checkin_photo_url AS checkinPhotoUrl,
            checkout_photo_url AS checkoutPhotoUrl,
            checkin_proof_hash AS checkinProofHash
     FROM cln_employee_attendance
     WHERE email = ?${opClause}
     ORDER BY date_key DESC
     LIMIT 60`,
    params
  );
  return rows.map((r) => ({
    id: r.id,
    dateKey: r.dateKey,
    workingInIso: r.workingInIso,
    workingOutIso: r.workingOutIso,
    checkinLocation: safeJson(r.checkinLocationJson, null),
    checkoutLocation: safeJson(r.checkoutLocationJson, null),
    checkinPhotoUrl: r.checkinPhotoUrl || null,
    checkoutPhotoUrl: r.checkoutPhotoUrl || null,
    checkinProofHash: r.checkinProofHash || null,
  }));
}

async function employeeCheckIn(payload = {}) {
  await ensureEmployeeAttendanceTable();
  const email = String(payload.email || '').trim().toLowerCase();
  const dateKey = String(payload.dateKey || '').slice(0, 10);
  if (!email || !dateKey) {
    const err = new Error('MISSING_EMAIL_OR_DATE');
    err.code = 'MISSING_EMAIL_OR_DATE';
    throw err;
  }
  const hasOd = await databaseHasColumn('cln_employee_attendance', 'operatordetail_id');
  const operatordetailId = String(payload.operatorId || payload.operatordetailId || '').trim();
  if (hasOd && !operatordetailId) {
    const err = new Error('MISSING_OPERATOR_ID');
    err.code = 'MISSING_OPERATOR_ID';
    throw err;
  }
  const id = payload.id || makeId('cln-att');
  if (hasOd) {
    await pool.query(
      `INSERT INTO cln_employee_attendance
        (id, operatordetail_id, email, date_key, working_in_iso, checkin_location_json, checkin_photo_url, checkin_proof_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        working_in_iso = VALUES(working_in_iso),
        checkin_location_json = VALUES(checkin_location_json),
        checkin_photo_url = VALUES(checkin_photo_url),
        checkin_proof_hash = VALUES(checkin_proof_hash),
        updated_at = CURRENT_TIMESTAMP`,
      [
        id,
        operatordetailId,
        email,
        dateKey,
        payload.workingInIso ? new Date(payload.workingInIso) : null,
        payload.checkinLocation ? JSON.stringify(payload.checkinLocation) : null,
        payload.checkinPhotoUrl || null,
        payload.checkinProofHash || null,
      ]
    );
  } else {
    await pool.query(
      `INSERT INTO cln_employee_attendance
        (id, email, date_key, working_in_iso, checkin_location_json, checkin_photo_url, checkin_proof_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        working_in_iso = VALUES(working_in_iso),
        checkin_location_json = VALUES(checkin_location_json),
        checkin_photo_url = VALUES(checkin_photo_url),
        checkin_proof_hash = VALUES(checkin_proof_hash),
        updated_at = CURRENT_TIMESTAMP`,
      [
        id,
        email,
        dateKey,
        payload.workingInIso ? new Date(payload.workingInIso) : null,
        payload.checkinLocation ? JSON.stringify(payload.checkinLocation) : null,
        payload.checkinPhotoUrl || null,
        payload.checkinProofHash || null,
      ]
    );
  }
}

async function employeeCheckOut(payload = {}) {
  await ensureEmployeeAttendanceTable();
  const email = String(payload.email || '').trim().toLowerCase();
  const dateKey = String(payload.dateKey || '').slice(0, 10);
  if (!email || !dateKey) {
    const err = new Error('MISSING_EMAIL_OR_DATE');
    err.code = 'MISSING_EMAIL_OR_DATE';
    throw err;
  }
  const hasOd = await databaseHasColumn('cln_employee_attendance', 'operatordetail_id');
  const operatordetailId = String(payload.operatorId || payload.operatordetailId || '').trim();
  if (hasOd && !operatordetailId) {
    const err = new Error('MISSING_OPERATOR_ID');
    err.code = 'MISSING_OPERATOR_ID';
    throw err;
  }
  const opClause = hasOd ? ' AND operatordetail_id <=> ?' : '';
  const params = hasOd
    ? [
        payload.workingOutIso ? new Date(payload.workingOutIso) : new Date(),
        payload.checkoutLocation ? JSON.stringify(payload.checkoutLocation) : null,
        payload.checkoutPhotoUrl || null,
        email,
        dateKey,
        operatordetailId,
      ]
    : [
        payload.workingOutIso ? new Date(payload.workingOutIso) : new Date(),
        payload.checkoutLocation ? JSON.stringify(payload.checkoutLocation) : null,
        payload.checkoutPhotoUrl || null,
        email,
        dateKey,
      ];
  await pool.query(
    `UPDATE cln_employee_attendance
     SET working_out_iso = ?, checkout_location_json = ?, checkout_photo_url = ?, updated_at = CURRENT_TIMESTAMP
     WHERE email = ? AND date_key = ?${opClause}
     LIMIT 1`,
    params
  );
}

async function listEmployeeInvitesByIdentity({ email = '', name = '' } = {}) {
  await ensureOperatorSettingsTable();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedName = String(name || '').trim().toLowerCase();
  const [rows] = await pool.query(
    `SELECT operator_id AS operatorId, settings_json AS settingsJson
     FROM cln_operator_settings
     ORDER BY updated_at DESC`
  );
  const result = [];
  for (const row of rows) {
    const settings = safeJson(row.settingsJson, {});
    const invites = Array.isArray(settings?.employeeInvites) ? settings.employeeInvites : [];
    for (const inv of invites) {
      const invEmail = String(inv?.email || '').trim().toLowerCase();
      const invName = String(inv?.name || '').trim().toLowerCase();
      const mineByEmail = normalizedEmail && invEmail === normalizedEmail;
      const mineByName = normalizedName && invName && (invName.includes(normalizedName) || normalizedName.includes(invName));
      if (!mineByEmail && !mineByName) continue;
      result.push({
        ...inv,
        operatorId: inv?.operatorId || row.operatorId,
      });
    }
  }
  return result;
}

/** Map `cln_pricingplanlog.source` → operator-facing payment label. */
function saasBillingPaymentMethodLabel(source) {
  const s = String(source || '').toLowerCase();
  if (s.includes('stripe')) return 'Stripe';
  if (s.includes('saas_admin')) return 'Manual';
  return 'Other';
}

function saasBillingItemLabel(row) {
  const kind = String(row.logKind || '').toLowerCase();
  if (kind === 'addon') {
    const code = String(row.addonCode || '').trim() || 'add-on';
    return `Add-on · ${code}`;
  }
  const pc = String(row.planCode || '').toLowerCase();
  const tier =
    pc === 'starter' ? 'Basic' : pc === 'growth' ? 'Grow' : pc === 'enterprise' ? 'Enterprise' : pc || 'Plan';
  const bc = row.billingCycle ? String(row.billingCycle) : '';
  return bc ? `Subscription · ${tier} (${bc})` : `Subscription · ${tier}`;
}

/**
 * SaaS platform billing for operator portal: subscriptions from `cln_pricingplanlog`; add-ons from `cln_addonlog` only.
 */
async function listOperatorSaasBillingHistory(operatorId) {
  const oid = String(operatorId || '').trim();
  if (!oid) return [];
  await ensureClnPricingplanlogTable();
  await ensureClnAddonlogTable();
  const [subRows] = await pool.query(
    `SELECT id,
            log_kind AS logKind,
            source,
            scenario,
            plan_code AS planCode,
            billing_cycle AS billingCycle,
            addon_code AS addonCode,
            amount_myr AS amountMyr,
            invoice_id AS invoiceId,
            invoice_url AS invoiceUrl,
            form_item_description AS formItemDescription,
            stripe_session_id AS stripeSessionId,
            created_at AS createdAt
     FROM cln_pricingplanlog
     WHERE operator_id COLLATE utf8mb4_unicode_ci = ? COLLATE utf8mb4_unicode_ci
       AND log_kind = 'subscription'
     ORDER BY created_at DESC, id DESC
     LIMIT 100`,
    [oid]
  );
  const [addonRows] = await pool.query(
    `SELECT id,
            'addon' AS logKind,
            CASE event_kind
              WHEN 'purchase_stripe' THEN 'stripe_addon'
              WHEN 'purchase_admin' THEN 'saas_admin_addon'
              ELSE COALESCE(event_kind, 'addon')
            END AS source,
            NULL AS scenario,
            NULL AS planCode,
            NULL AS billingCycle,
            addon_code AS addonCode,
            amount_myr AS amountMyr,
            invoice_id AS invoiceId,
            invoice_url AS invoiceUrl,
            form_item_description AS formItemDescription,
            stripe_session_id AS stripeSessionId,
            created_at AS createdAt
     FROM cln_addonlog
     WHERE operator_id COLLATE utf8mb4_unicode_ci = ? COLLATE utf8mb4_unicode_ci
       AND (
         (invoice_id IS NOT NULL AND TRIM(invoice_id) <> '')
         OR (invoice_url IS NOT NULL AND TRIM(invoice_url) <> '')
       )
     ORDER BY created_at DESC, id DESC
     LIMIT 100`,
    [oid]
  );
  const rows = [...(subRows || []), ...(addonRows || [])].sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  }).slice(0, 100);
  return rows.map((r) => {
    const formDesc =
      r.formItemDescription != null && String(r.formItemDescription).trim()
        ? String(r.formItemDescription).trim()
        : null;
    return {
      id: String(r.id),
      logKind: String(r.logKind || ''),
      source: r.source != null ? String(r.source) : null,
      scenario: r.scenario != null ? String(r.scenario) : null,
      planCode: r.planCode != null ? String(r.planCode) : null,
      billingCycle: r.billingCycle != null ? String(r.billingCycle) : null,
      addonCode: r.addonCode != null ? String(r.addonCode) : null,
      amountMyr: r.amountMyr != null ? Number(r.amountMyr) : null,
      invoiceId: r.invoiceId != null && String(r.invoiceId).trim() ? String(r.invoiceId).trim() : null,
      invoiceUrl: r.invoiceUrl != null && String(r.invoiceUrl).trim() ? String(r.invoiceUrl).trim() : null,
      stripeSessionId: r.stripeSessionId != null ? String(r.stripeSessionId) : null,
      createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
      /** Bukku `form_items[].description` (platform line text). */
      lineItemDescription: formDesc,
      /** @deprecated Prefer lineItemDescription; kept for older clients. */
      paymentMethod: formDesc || saasBillingPaymentMethodLabel(r.source),
      itemLabel: saasBillingItemLabel({
        logKind: r.logKind,
        planCode: r.planCode,
        billingCycle: r.billingCycle,
        addonCode: r.addonCode,
      }),
    };
  });
}

async function clnDamageReportTableExists() {
  try {
    const [[r]] = await pool.query(
      `SELECT COUNT(*) AS n FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cln_damage_report'`
    );
    return Number(r?.n) > 0;
  } catch {
    return false;
  }
}

async function clnLegacyDamageTableExists() {
  try {
    const [[r]] = await pool.query(
      `SELECT COUNT(*) AS n FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cln_damage'`
    );
    return Number(r?.n) > 0;
  } catch {
    return false;
  }
}

/**
 * Employee portal: submit damage report for a schedule job (photos + remark).
 */
async function createEmployeeScheduleDamageReport({ email, operatorId, scheduleId, remark, photos, location }) {
  await assertClnOperatorStaffEmail(operatorId, email);
  const sid = String(scheduleId || '').trim();
  const oid = String(operatorId || '').trim();
  if (!sid) {
    const e = new Error('MISSING_SCHEDULE_ID');
    e.code = 'MISSING_SCHEDULE_ID';
    throw e;
  }
  const rem = remark != null ? String(remark).trim().slice(0, 8000) : '';
  if (!rem) {
    const e = new Error('MISSING_REMARK');
    e.code = 'MISSING_REMARK';
    throw e;
  }
  if (!(await clnDamageReportTableExists())) {
    const e = new Error('DAMAGE_REPORT_TABLE_MISSING');
    e.code = 'DAMAGE_REPORT_TABLE_MISSING';
    throw e;
  }
  const photoList = Array.isArray(photos) ? photos.filter((u) => typeof u === 'string' && String(u).trim()) : [];
  const locObj =
    location && typeof location === 'object'
      ? location
      : location != null
        ? { raw: location }
        : null;
  const [[row]] = await pool.query(
    `SELECT s.id AS scheduleId, p.id AS propertyId, p.operator_id AS propOperatorId
     FROM cln_schedule s
     INNER JOIN cln_property p ON p.id = s.property_id
     WHERE s.id = ? LIMIT 1`,
    [sid]
  );
  if (!row) {
    const e = new Error('JOB_NOT_FOUND');
    e.code = 'JOB_NOT_FOUND';
    throw e;
  }
  const po = String(row.propOperatorId || '').trim();
  if (!po || po !== oid) {
    const e = new Error('OPERATOR_MISMATCH');
    e.code = 'OPERATOR_MISMATCH';
    throw e;
  }
  const { randomUUID } = require('crypto');
  const id = randomUUID();
  const reportedAt = new Date();
  const staffEmail = String(email || '').trim().toLowerCase();
  await pool.query(
    `INSERT INTO cln_damage_report (
       id, schedule_id, property_id, operator_id, staff_email, remark, photos_json, location_json, reported_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
    [
      id,
      sid,
      String(row.propertyId),
      oid,
      staffEmail,
      rem,
      JSON.stringify(photoList),
      locObj ? JSON.stringify(locObj) : null,
      reportedAt,
    ]
  );
  return { ok: true, id };
}

/** Wix `wix:video://v1/{fileId}/{filename}.mp4` → CDN MP4 (720p lane; pattern from Wix-hosted assets). */
function wixVideoPlayUrlFromRaw(raw) {
  const s = String(raw || '').trim();
  if (!s.startsWith('wix:video://')) return '';
  const m = s.match(/wix:video:\/\/v1\/([^/]+)\/([^#?]+)/i);
  if (!m) return '';
  const fileId = m[1];
  const fileName = m[2];
  return `https://video.wixstatic.com/video/${fileId}/720p/mp4/${fileName}`;
}

function wixVideoPosterUrlFromRaw(raw) {
  const s = String(raw || '');
  const poster = s.match(/[#&]posterUri=([^&]+)/);
  if (!poster || !poster[1]) return '';
  const id = decodeURIComponent(String(poster[1]).trim());
  return id ? `https://static.wixstatic.com/media/${id}` : '';
}

/** Wix CMS / import — images → static; videos → playable MP4; OSS http → https. */
function normalizeClnDamageMediaUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s.startsWith('wix:image://')) {
    const m = s.match(/wix:image:\/\/v1\/([^/#?]+)/);
    return m ? `https://static.wixstatic.com/media/${m[1]}` : s;
  }
  if (s.startsWith('wix:video://')) {
    return wixVideoPlayUrlFromRaw(s) || '';
  }
  if (s.startsWith('http://')) {
    try {
      const h = new URL(s).hostname.toLowerCase();
      if (h.endsWith('.aliyuncs.com')) return s.replace(/^http:\/\//i, 'https://');
    } catch (_) {
      /* ignore */
    }
  }
  return s;
}

function inferDamageMediaKindFromUrl(url) {
  const u = String(url || '').trim().toLowerCase();
  if (!u) return 'image';
  if (/\.(mp4|webm|mov|mkv|m4v|ogv|3gp)(\?|#|$)/i.test(u)) return 'video';
  if (u.includes('video.wixstatic.com/video')) return 'video';
  return 'image';
}

function parseDamagePhotosJsonToAttachments(photosJson) {
  if (photosJson == null || String(photosJson).trim() === '') return [];
  let p;
  try {
    p = JSON.parse(String(photosJson));
  } catch {
    return [];
  }
  if (!Array.isArray(p)) return [];
  const out = [];
  for (const item of p) {
    let raw = '';
    let wixType = '';
    if (typeof item === 'string') raw = item;
    else if (item && typeof item === 'object') {
      raw = String(item.src || item.url || item.fileUrl || '').trim();
      wixType = String(item.type || '').toLowerCase();
    }
    if (!raw) continue;

    if (raw.startsWith('wix:video://')) {
      const play = wixVideoPlayUrlFromRaw(raw);
      if (!play) continue;
      out.push({
        url: play,
        kind: 'video',
        posterUrl: wixVideoPosterUrlFromRaw(raw) || null,
      });
      continue;
    }
    if (raw.startsWith('wix:image://')) {
      const n = normalizeClnDamageMediaUrl(raw);
      if (n) out.push({ url: n, kind: 'image', posterUrl: null });
      continue;
    }

    const n = normalizeClnDamageMediaUrl(raw);
    if (!n) continue;
    let kind = 'image';
    if (wixType === 'video') kind = 'video';
    else if (wixType === 'image') kind = 'image';
    else kind = inferDamageMediaKindFromUrl(n);
    out.push({ url: n, kind, posterUrl: null });
  }
  return out;
}

function mapDamageReportRow(r) {
  const photoAttachments =
    r.photosJson != null && String(r.photosJson).trim() !== ''
      ? parseDamagePhotosJsonToAttachments(r.photosJson)
      : [];
  const photoUrls = photoAttachments.map((a) => a.url);
  return {
    id: String(r.id),
    scheduleId: r.scheduleId != null ? String(r.scheduleId) : '',
    propertyId: r.propertyId != null ? String(r.propertyId) : '',
    propertyName: String(r.propertyName || 'Property'),
    unitNumber: String(r.unitNumber || ''),
    clientName: String(r.clientName || '—'),
    operatorId: r.operatorId != null ? String(r.operatorId) : '',
    operatorName: String(r.operatorName || '—'),
    staffEmail: String(r.staffEmail || ''),
    remark: r.remark != null ? String(r.remark) : '',
    photoUrls,
    photoAttachments,
    reportedAt: r.reportedAt ? new Date(r.reportedAt).toISOString() : null,
    jobDate: r.jobDate != null ? String(r.jobDate).slice(0, 10) : null,
    jobStartTime: r.jobStartTime != null ? String(r.jobStartTime) : null,
    acknowledgedAt: r.acknowledgedAt ? new Date(r.acknowledgedAt).toISOString() : null,
    acknowledgedByEmail: r.acknowledgedByEmail != null ? String(r.acknowledgedByEmail) : null,
  };
}

async function listOperatorDamageReports({ operatorId, limit = 200 } = {}) {
  const oid = String(operatorId || '').trim();
  if (!oid) return [];
  const lim = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  const ct = await getClnCompanyTable();
  const clientDisp = await buildClnPropertyClientDisplaySql(ct);

  let fromReports = [];
  if (await clnDamageReportTableExists()) {
    const [rows] = await pool.query(
      `SELECT dr.id,
              dr.schedule_id AS scheduleId,
              dr.property_id AS propertyId,
              dr.operator_id AS operatorId,
              dr.staff_email AS staffEmail,
              dr.remark,
              dr.photos_json AS photosJson,
              dr.reported_at AS reportedAt,
              dr.acknowledged_at AS acknowledgedAt,
              dr.acknowledged_by_email AS acknowledgedByEmail,
              ${SQL_CLN_SCHEDULE_JOB_DATE_KL_YMD} AS jobDate,
              TIME_FORMAT(s.start_time, '%H:%i') AS jobStartTime,
              COALESCE(p.property_name, p.unit_name, 'Property') AS propertyName,
              COALESCE(p.unit_name, '') AS unitNumber,
              ${clientDisp.nameExpr} AS clientName,
              COALESCE(od.name, '') AS operatorName
       FROM cln_damage_report dr
       INNER JOIN cln_schedule s ON s.id = dr.schedule_id
       INNER JOIN cln_property p ON p.id = dr.property_id
       ${clientDisp.joinSql}
       LEFT JOIN cln_operatordetail od ON od.id = dr.operator_id
       WHERE dr.operator_id = ?
       ORDER BY dr.reported_at DESC
       LIMIT ?`,
      [oid, lim]
    );
    fromReports = (rows || []).map((r) => mapDamageReportRow(r));
  }

  let fromLegacy = [];
  if (await clnLegacyDamageTableExists()) {
    const hasPropOp = await databaseHasColumn('cln_property', 'operator_id');
    if (hasPropOp) {
      const [lrows] = await pool.query(
        `SELECT d.id,
                CAST('' AS CHAR(36)) AS scheduleId,
                d.property_id AS propertyId,
                p.operator_id AS operatorId,
                COALESCE(NULLIF(TRIM(e.email), ''), '') AS staffEmail,
                d.remark,
                d.damage_photo_json AS photosJson,
                d.created_at AS reportedAt,
                NULL AS acknowledgedAt,
                NULL AS acknowledgedByEmail,
                DATE_FORMAT(d.created_at, '%Y-%m-%d') AS jobDate,
                NULL AS jobStartTime,
                COALESCE(p.property_name, p.unit_name, 'Property') AS propertyName,
                COALESCE(p.unit_name, '') AS unitNumber,
                ${clientDisp.nameExpr} AS clientName,
                COALESCE(od.name, '') AS operatorName
         FROM cln_damage d
         INNER JOIN cln_property p ON p.id = d.property_id AND LOWER(TRIM(p.operator_id)) = LOWER(?)
         ${clientDisp.joinSql}
         LEFT JOIN cln_employeedetail e ON e.id = d.staff_id
         LEFT JOIN cln_operatordetail od ON od.id = p.operator_id
         WHERE d.property_id IS NOT NULL
         ORDER BY d.created_at DESC
         LIMIT ?`,
        [oid, lim]
      );
      fromLegacy = (lrows || []).map((r) => mapDamageReportRow(r));
    }
  }

  const merged = [...fromReports, ...fromLegacy];
  merged.sort((a, b) => {
    const ta = a.reportedAt ? new Date(a.reportedAt).getTime() : 0;
    const tb = b.reportedAt ? new Date(b.reportedAt).getTime() : 0;
    return tb - ta;
  });
  return merged.slice(0, lim);
}

/**
 * Property IDs the client may see in portal — same rules as `listClientPortalProperties`
 * (operator-bound properties + property-group share / grantee).
 */
async function getClientPortalAccessiblePropertyIds({ clientdetailId, loginEmail, limit = 1000 } = {}) {
  const cid = String(clientdetailId || '').trim();
  if (!cid) return [];
  const rows = await listClientPortalProperties({ clientdetailId: cid, limit, loginEmail });
  return (rows || []).map((r) => String(r.id || '').trim()).filter(Boolean);
}

/** operatorId from the portal session is ignored — damage is scoped by the same property list as the client Properties page. */
async function listClientPortalDamageReports({ clientdetailId, operatorId: _operatorId, limit = 200, loginEmail } = {}) {
  const cid = String(clientdetailId || '').trim();
  if (!cid) return [];
  const hasReportTable = await clnDamageReportTableExists();
  const hasLegacyTable = await clnLegacyDamageTableExists();
  if (!hasReportTable && !hasLegacyTable) return [];
  const lim = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  const hasPropClientdetailId = await databaseHasColumn('cln_property', 'clientdetail_id');
  if (!hasPropClientdetailId) return [];

  const propertyIds = await getClientPortalAccessiblePropertyIds({
    clientdetailId: cid,
    loginEmail,
    limit: 1000,
  });
  if (!propertyIds.length) return [];

  const ct = await getClnCompanyTable();
  const clientDisp = await buildClnPropertyClientDisplaySql(ct);
  const ph = propertyIds.map(() => '?').join(',');

  let fromReports = [];
  if (hasReportTable) {
    const [rows] = await pool.query(
      `SELECT dr.id,
              dr.schedule_id AS scheduleId,
              dr.property_id AS propertyId,
              dr.operator_id AS operatorId,
              dr.staff_email AS staffEmail,
              dr.remark,
              dr.photos_json AS photosJson,
              dr.reported_at AS reportedAt,
              dr.acknowledged_at AS acknowledgedAt,
              dr.acknowledged_by_email AS acknowledgedByEmail,
              ${SQL_CLN_SCHEDULE_JOB_DATE_KL_YMD} AS jobDate,
              TIME_FORMAT(s.start_time, '%H:%i') AS jobStartTime,
              COALESCE(p.property_name, p.unit_name, 'Property') AS propertyName,
              COALESCE(p.unit_name, '') AS unitNumber,
              ${clientDisp.nameExpr} AS clientName,
              COALESCE(od.name, '') AS operatorName
       FROM cln_damage_report dr
       INNER JOIN cln_schedule s ON s.id = dr.schedule_id
       INNER JOIN cln_property p ON p.id = dr.property_id
       ${clientDisp.joinSql}
       LEFT JOIN cln_operatordetail od ON od.id = dr.operator_id
       WHERE dr.property_id IN (${ph})
       ORDER BY dr.reported_at DESC
       LIMIT ?`,
      [...propertyIds, lim]
    );
    fromReports = (rows || []).map((r) => mapDamageReportRow(r));
  }

  let fromLegacy = [];
  if (hasLegacyTable) {
    const hasPropOp = await databaseHasColumn('cln_property', 'operator_id');
    if (hasPropOp) {
      const [lrows] = await pool.query(
        `SELECT d.id,
                CAST('' AS CHAR(36)) AS scheduleId,
                d.property_id AS propertyId,
                p.operator_id AS operatorId,
                COALESCE(NULLIF(TRIM(e.email), ''), '') AS staffEmail,
                d.remark,
                d.damage_photo_json AS photosJson,
                d.created_at AS reportedAt,
                NULL AS acknowledgedAt,
                NULL AS acknowledgedByEmail,
                DATE_FORMAT(d.created_at, '%Y-%m-%d') AS jobDate,
                NULL AS jobStartTime,
                COALESCE(p.property_name, p.unit_name, 'Property') AS propertyName,
                COALESCE(p.unit_name, '') AS unitNumber,
                ${clientDisp.nameExpr} AS clientName,
                COALESCE(od.name, '') AS operatorName
         FROM cln_damage d
         INNER JOIN cln_property p ON p.id = d.property_id
         ${clientDisp.joinSql}
         LEFT JOIN cln_employeedetail e ON e.id = d.staff_id
         LEFT JOIN cln_operatordetail od ON od.id = p.operator_id
         WHERE d.property_id IS NOT NULL AND d.property_id IN (${ph})
         ORDER BY d.created_at DESC
         LIMIT ?`,
        [...propertyIds, lim]
      );
      fromLegacy = (lrows || []).map((r) => mapDamageReportRow(r));
    }
  }

  const merged = [...fromReports, ...fromLegacy];
  merged.sort((a, b) => {
    const ta = a.reportedAt ? new Date(a.reportedAt).getTime() : 0;
    const tb = b.reportedAt ? new Date(b.reportedAt).getTime() : 0;
    return tb - ta;
  });
  return merged.slice(0, lim);
}

async function acknowledgeClientPortalDamageReport({
  clientdetailId,
  operatorId: _operatorId,
  reportId,
  acknowledgedByEmail,
  loginEmail,
}) {
  const cid = String(clientdetailId || '').trim();
  const rid = String(reportId || '').trim();
  if (!cid || !rid) {
    const e = new Error('MISSING_IDS');
    e.code = 'MISSING_IDS';
    throw e;
  }
  if (!(await clnDamageReportTableExists())) {
    const e = new Error('DAMAGE_REPORT_TABLE_MISSING');
    e.code = 'DAMAGE_REPORT_TABLE_MISSING';
    throw e;
  }
  const ackEmail = acknowledgedByEmail != null ? String(acknowledgedByEmail).trim().toLowerCase() : '';
  const inviteEmail = String(loginEmail || ackEmail || '')
    .trim()
    .toLowerCase();
  const [[row]] = await pool.query(
    `SELECT dr.id, dr.acknowledged_at AS acknowledgedAt, p.id AS propertyId
     FROM cln_damage_report dr
     INNER JOIN cln_property p ON p.id = dr.property_id
     WHERE dr.id = ? LIMIT 1`,
    [rid]
  );
  if (!row) {
    const e = new Error('REPORT_NOT_FOUND');
    e.code = 'REPORT_NOT_FOUND';
    throw e;
  }
  const allowedIds = new Set(
    await getClientPortalAccessiblePropertyIds({
      clientdetailId: cid,
      loginEmail: inviteEmail || undefined,
      limit: 1000,
    })
  );
  if (!allowedIds.has(String(row.propertyId || '').trim())) {
    const e = new Error('REPORT_ACCESS_DENIED');
    e.code = 'REPORT_ACCESS_DENIED';
    throw e;
  }
  if (row.acknowledgedAt) {
    return { ok: true, alreadyAcknowledged: true };
  }
  await pool.query(
    `UPDATE cln_damage_report
     SET acknowledged_at = NOW(3), acknowledged_by_email = ?, updated_at = NOW(3)
     WHERE id = ? LIMIT 1`,
    [ackEmail || null, rid]
  );
  return { ok: true };
}

/** SaaS admin: distinct building names (global). */
async function adminListGlobalDistinctPropertyNamesAdmin(opts = {}) {
  return listGlobalDistinctPropertyNames(opts);
}

/** SaaS admin: searchable property rows for transfer UI. */
async function adminListAllClnPropertiesBrief({ q = '', limit = 100 } = {}) {
  const term = String(q || '').trim();
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 300);
  const ct = await getClnCompanyTable();
  const hasOpCol = await databaseHasColumn('cln_property', 'operator_id');
  const hasClientdetailCol = await databaseHasColumn('cln_property', 'clientdetail_id');
  const params = [];
  let where = 'WHERE 1=1';
  if (term) {
    where += ` AND (
      COALESCE(p.property_name,'') LIKE ? OR
      COALESCE(p.unit_name,'') LIKE ? OR
      COALESCE(p.id,'') LIKE ?
    )`;
    const kw = `%${term}%`;
    params.push(kw, kw, kw);
  }
  params.push(lim);
  const joinOd = hasOpCol ? `LEFT JOIN \`${ct}\` od ON od.id = p.operator_id` : '';
  const joinCd = hasClientdetailCol ? 'LEFT JOIN cln_clientdetail cd ON cd.id = p.clientdetail_id' : '';
  const [rows] = await pool.query(
    `SELECT p.id,
      TRIM(COALESCE(p.property_name, '')) AS property_name_raw,
      TRIM(COALESCE(p.unit_name, '')) AS unit_name_raw,
      ${hasOpCol ? "COALESCE(NULLIF(TRIM(p.operator_id),''), '')" : "''"} AS operator_id,
      ${hasOpCol ? "COALESCE(od.name, '')" : "''"} AS operator_name,
      ${
        hasClientdetailCol
          ? "COALESCE(NULLIF(TRIM(p.clientdetail_id),''), '')"
          : "''"
      } AS clientdetail_id,
      ${hasClientdetailCol ? "COALESCE(cd.fullname, '')" : "''"} AS clientdetail_name
     FROM cln_property p
     ${joinOd}
     ${joinCd}
     ${where}
     ORDER BY p.updated_at DESC
     LIMIT ?`,
    params
  );
  return (rows || []).map((r) => {
    const propertyName = String(r.property_name_raw ?? '').trim();
    const unitName = String(r.unit_name_raw ?? '').trim();
    const parts = [];
    if (propertyName) parts.push(propertyName);
    if (unitName) parts.push(unitName);
    const label = parts.length ? parts.join(' · ') : String(r.id || '').trim();
    return {
      id: String(r.id || '').trim(),
      label,
      propertyName,
      unitName,
      operatorId: String(r.operator_id || '').trim(),
      operatorName: String(r.operator_name || '').trim(),
      clientdetailId: String(r.clientdetail_id || '').trim(),
      clientdetailName: String(r.clientdetail_name || '').trim(),
    };
  });
}

/** SaaS admin: search operators (company master). */
async function adminSearchOperatorsBrief({ q = '', limit = 80 } = {}) {
  const term = String(q || '').trim();
  const lim = Math.min(Math.max(Number(limit) || 80, 1), 200);
  const ct = await getClnCompanyTable();
  const params = [];
  let where = 'WHERE 1=1';
  if (term) {
    where += ' AND (COALESCE(name,\'\') LIKE ? OR COALESCE(email,\'\') LIKE ? OR id LIKE ?)';
    const kw = `%${term}%`;
    params.push(kw, kw, kw);
  }
  params.push(lim);
  const [rows] = await pool.query(
    `SELECT id, COALESCE(name,'') AS name, COALESCE(email,'') AS email FROM \`${ct}\` ${where} ORDER BY name ASC LIMIT ?`,
    params
  );
  return (rows || []).map((r) => ({
    id: String(r.id || '').trim(),
    label: `${String(r.name || '').trim() || r.id}${r.email ? ` (${r.email})` : ''}`,
  }));
}

/** SaaS admin: search B2B clients (cln_clientdetail). */
async function adminSearchClientdetailsBrief({ q = '', limit = 80 } = {}) {
  const term = String(q || '').trim();
  const lim = Math.min(Math.max(Number(limit) || 80, 1), 200);
  const params = [];
  let where = 'WHERE 1=1';
  if (term) {
    where += ' AND (COALESCE(fullname,\'\') LIKE ? OR COALESCE(email,\'\') LIKE ? OR id LIKE ?)';
    const kw = `%${term}%`;
    params.push(kw, kw, kw);
  }
  params.push(lim);
  const [rows] = await pool.query(
    `SELECT id, COALESCE(fullname,'') AS fullname, COALESCE(email,'') AS email FROM cln_clientdetail ${where} ORDER BY fullname ASC LIMIT ?`,
    params
  );
  return (rows || []).map((r) => ({
    id: String(r.id || '').trim(),
    label: `${String(r.fullname || '').trim() || r.id}${r.email ? ` (${r.email})` : ''}`,
  }));
}

/**
 * SaaS admin: rename every `cln_property.property_name` equal to `fromName` to `toName`.
 * When Coliving link exists, updates `propertydetail.shortname` for linked rows.
 */
async function adminMergeClnPropertyNames({ fromName, toName } = {}) {
  const from = String(fromName || '').trim();
  const to = String(toName || '').trim();
  if (!from || !to) {
    const e = new Error('MISSING_NAMES');
    e.code = 'MISSING_NAMES';
    throw e;
  }
  if (from === to) {
    const e = new Error('SAME_NAME');
    e.code = 'SAME_NAME';
    throw e;
  }
  const hasCp = await databaseHasColumn('cln_property', 'coliving_propertydetail_id');
  const pdIds = new Set();
  if (hasCp) {
    const [r1] = await pool.query(
      `SELECT coliving_propertydetail_id AS pid FROM cln_property
       WHERE TRIM(COALESCE(property_name,'')) = ?
         AND coliving_propertydetail_id IS NOT NULL
         AND TRIM(coliving_propertydetail_id) <> ''`,
      [from]
    );
    for (const row of r1 || []) {
      if (row?.pid) pdIds.add(String(row.pid).trim());
    }
  }
  const [ur] = await pool.query(
    `UPDATE cln_property SET property_name = ?, updated_at = NOW(3)
     WHERE TRIM(COALESCE(property_name,'')) = ?`,
    [to, from]
  );
  const updated = Number(ur?.affectedRows || 0);
  let colivingUpdated = 0;
  if (pdIds.size > 0) {
    for (const pdid of pdIds) {
      const [r2] = await pool.query('UPDATE propertydetail SET shortname = ? WHERE id = ? LIMIT 1', [to, pdid]);
      colivingUpdated += Number(r2?.affectedRows || 0);
    }
  }
  return { updated, colivingUpdated };
}

/**
 * SaaS admin: move one property to another operator and/or binding client (cln_clientdetail).
 * Ensures `cln_client_operator` when both IDs are set after update.
 */
async function adminTransferClnProperty({ propertyId, operatorId, clientdetailId } = {}) {
  const pid = String(propertyId || '').trim();
  if (!pid) {
    const e = new Error('MISSING_PROPERTY_ID');
    e.code = 'MISSING_PROPERTY_ID';
    throw e;
  }
  const opIn = operatorId != null ? String(operatorId).trim() : '';
  const cdIn = clientdetailId != null ? String(clientdetailId).trim() : '';
  const opId = opIn || null;
  const cdId = cdIn || null;
  if (!opId && !cdId) {
    const e = new Error('MISSING_TARGET');
    e.code = 'MISSING_TARGET';
    throw e;
  }
  const hasOpCol = await databaseHasColumn('cln_property', 'operator_id');
  const hasCdCol = await databaseHasColumn('cln_property', 'clientdetail_id');
  if (opId && !hasOpCol) {
    const e = new Error('OPERATOR_COLUMN_MISSING');
    e.code = 'OPERATOR_COLUMN_MISSING';
    throw e;
  }
  if (cdId && !hasCdCol) {
    const e = new Error('CLIENTDETAIL_COLUMN_MISSING');
    e.code = 'CLIENTDETAIL_COLUMN_MISSING';
    throw e;
  }
  if (opId) await assertClnOperatorMasterRowExists(opId);
  if (cdId) {
    const [[cdRow]] = await pool.query('SELECT id FROM cln_clientdetail WHERE id = ? LIMIT 1', [cdId]);
    if (!cdRow) {
      const e = new Error('CLIENTDETAIL_NOT_FOUND');
      e.code = 'CLIENTDETAIL_NOT_FOUND';
      throw e;
    }
  }
  const sel = ['id'];
  if (hasOpCol) sel.push('operator_id');
  if (hasCdCol) sel.push('clientdetail_id');
  const [[cur]] = await pool.query(`SELECT ${sel.join(', ')} FROM cln_property WHERE id = ? LIMIT 1`, [pid]);
  if (!cur) {
    const e = new Error('PROPERTY_NOT_FOUND');
    e.code = 'PROPERTY_NOT_FOUND';
    throw e;
  }
  const sets = [];
  const vals = [];
  if (opId && hasOpCol) {
    sets.push('operator_id = ?');
    vals.push(opId);
  }
  if (cdId && hasCdCol) {
    sets.push('clientdetail_id = ?');
    vals.push(cdId);
  }
  if (!sets.length) {
    const e = new Error('NOTHING_TO_UPDATE');
    e.code = 'NOTHING_TO_UPDATE';
    throw e;
  }
  vals.push(pid);
  await pool.query(`UPDATE cln_property SET ${sets.join(', ')}, updated_at = NOW(3) WHERE id = ?`, vals);

  try {
    await syncClnPropertyLegacyClientIdColumn(pid);
  } catch (e) {
    console.warn('[cleanlemon] syncClnPropertyLegacyClientIdColumn adminTransfer', pid, e?.message || e);
  }

  const finalOp = (opId || (hasOpCol && cur.operator_id != null ? String(cur.operator_id).trim() : '')) || '';
  const finalCd = (cdId || (hasCdCol && cur.clientdetail_id != null ? String(cur.clientdetail_id).trim() : '')) || '';
  if (finalOp && finalCd) {
    const [[ex]] = await pool.query(
      'SELECT id FROM cln_client_operator WHERE clientdetail_id = ? AND operator_id = ? LIMIT 1',
      [finalCd, finalOp]
    );
    if (!ex) {
      const linkId = crypto.randomUUID();
      const hasCrm = await databaseHasColumn('cln_client_operator', 'crm_json');
      if (hasCrm) {
        await pool.query(
          `INSERT INTO cln_client_operator (id, clientdetail_id, operator_id, crm_json, created_at)
           VALUES (?, ?, ?, ?, NOW(3))`,
          [linkId, finalCd, finalOp, JSON.stringify({ status: 'active' })]
        );
      } else {
        await pool.query(
          `INSERT INTO cln_client_operator (id, clientdetail_id, operator_id, created_at) VALUES (?, ?, ?, NOW(3))`,
          [linkId, finalCd, finalOp]
        );
      }
    }
  }
  return { ok: true };
}

async function clnPropertyLinkRequestTableExists() {
  try {
    const [[r]] = await pool.query(
      `SELECT COUNT(*) AS n FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cln_property_link_request'`
    );
    return Number(r?.n) > 0;
  } catch {
    return false;
  }
}

/**
 * SaaS admin: preview `cln_property` row + binding client / operator + dependent row counts before delete.
 */
async function adminGetClnPropertyDeletePreview(propertyId) {
  const pid = String(propertyId || '').trim();
  if (!pid) {
    const e = new Error('MISSING_PROPERTY_ID');
    e.code = 'MISSING_PROPERTY_ID';
    throw e;
  }
  const ct = await getClnCompanyTable();
  const hasOp = await databaseHasColumn('cln_property', 'operator_id');
  const hasCd = await databaseHasColumn('cln_property', 'clientdetail_id');
  const hasCp = await databaseHasColumn('cln_property', 'coliving_propertydetail_id');
  const hasCr = await databaseHasColumn('cln_property', 'coliving_roomdetail_id');

  const joinOd = hasOp ? `LEFT JOIN \`${ct}\` od ON od.id = p.operator_id` : '';
  const joinCd = hasCd ? 'LEFT JOIN cln_clientdetail cd ON cd.id = p.clientdetail_id' : '';

  const [[row]] = await pool.query(
    `SELECT
      p.id,
      COALESCE(p.property_name, '') AS propertyName,
      COALESCE(p.unit_name, '') AS unitName,
      COALESCE(p.address, '') AS address,
      ${hasOp ? 'NULLIF(TRIM(p.operator_id), \'\')' : 'NULL'} AS operatorId,
      ${hasCd ? 'NULLIF(TRIM(p.clientdetail_id), \'\')' : 'NULL'} AS clientdetailId,
      ${hasCp ? 'NULLIF(TRIM(p.coliving_propertydetail_id), \'\')' : 'NULL'} AS colivingPropertydetailId,
      ${hasCr ? 'NULLIF(TRIM(p.coliving_roomdetail_id), \'\')' : 'NULL'} AS colivingRoomdetailId,
      ${hasOp ? "COALESCE(od.name, '')" : "''"} AS operatorName,
      ${hasOp ? "COALESCE(od.email, '')" : "''"} AS operatorEmail,
      ${hasCd ? "COALESCE(cd.fullname, '')" : "''"} AS clientdetailName,
      ${hasCd ? "COALESCE(cd.email, '')" : "''"} AS clientdetailEmail
     FROM cln_property p
     ${joinOd}
     ${joinCd}
     WHERE p.id = ? LIMIT 1`,
    [pid]
  );
  if (!row) {
    const e = new Error('PROPERTY_NOT_FOUND');
    e.code = 'PROPERTY_NOT_FOUND';
    throw e;
  }

  const [[schedCount]] = await pool.query(
    'SELECT COUNT(*) AS n FROM cln_schedule WHERE property_id <=> ?',
    [pid]
  );
  let legacyDamageCount = { n: 0 };
  try {
    const [[d]] = await pool.query('SELECT COUNT(*) AS n FROM cln_damage WHERE property_id <=> ?', [pid]);
    legacyDamageCount = d || { n: 0 };
  } catch (_) {
    /* optional table */
  }

  let damageReportCount = 0;
  if (await clnDamageReportTableExists()) {
    const [[d]] = await pool.query(
      'SELECT COUNT(*) AS n FROM cln_damage_report WHERE property_id <=> ?',
      [pid]
    );
    damageReportCount = Number(d?.n || 0);
  }

  let linkRequestCount = 0;
  if (await clnPropertyLinkRequestTableExists()) {
    const [[d]] = await pool.query(
      'SELECT COUNT(*) AS n FROM cln_property_link_request WHERE property_id <=> ?',
      [pid]
    );
    linkRequestCount = Number(d?.n || 0);
  }

  let operatorTeamsReferencing = 0;
  try {
    await ensureOperatorTeamTable();
    const [teamRows] = await pool.query(
      'SELECT selected_property_ids_json FROM cln_operator_team WHERE selected_property_ids_json LIKE ?',
      [`%${pid}%`]
    );
    for (const tr of teamRows || []) {
      const arr = safeJson(tr.selected_property_ids_json, []);
      if (Array.isArray(arr) && arr.some((x) => String(x).trim() === pid)) operatorTeamsReferencing += 1;
    }
  } catch (_) {
    /* ignore */
  }

  return {
    property: {
      id: String(row.id || '').trim(),
      propertyName: String(row.propertyName || '').trim(),
      unitName: String(row.unitName || '').trim(),
      address: String(row.address || '').trim(),
      operatorId: row.operatorId != null ? String(row.operatorId).trim() : '',
      operatorName: String(row.operatorName || '').trim(),
      operatorEmail: String(row.operatorEmail || '').trim(),
      clientdetailId: row.clientdetailId != null ? String(row.clientdetailId).trim() : '',
      clientdetailName: String(row.clientdetailName || '').trim(),
      clientdetailEmail: String(row.clientdetailEmail || '').trim(),
      colivingPropertydetailId: row.colivingPropertydetailId != null ? String(row.colivingPropertydetailId).trim() : '',
      colivingRoomdetailId: row.colivingRoomdetailId != null ? String(row.colivingRoomdetailId).trim() : '',
    },
    counts: {
      schedules: Number(schedCount?.n || 0),
      legacyDamages: Number(legacyDamageCount.n || 0),
      damageReports: damageReportCount,
      linkRequests: linkRequestCount,
      operatorTeamsReferencing,
    },
  };
}

async function removePropertyIdFromAllOperatorTeamsConn(conn, propertyId) {
  const pid = String(propertyId || '').trim();
  if (!pid) return 0;
  let updated = 0;
  const [rows] = await conn.query(
    'SELECT id, selected_property_ids_json FROM cln_operator_team WHERE selected_property_ids_json LIKE ?',
    [`%${pid}%`]
  );
  for (const row of rows || []) {
    const arr = safeJson(row.selected_property_ids_json, []);
    if (!Array.isArray(arr)) continue;
    const next = arr.filter((x) => String(x).trim() !== pid);
    if (next.length === arr.length) continue;
    await conn.query('UPDATE cln_operator_team SET selected_property_ids_json = ? WHERE id = ?', [
      JSON.stringify(next),
      row.id,
    ]);
    updated += 1;
  }
  return updated;
}

/**
 * SaaS admin: delete one `cln_property` and dependent rows (damage reports, link requests, team JSON refs).
 * Schedules / legacy cln_damage: FK ON DELETE SET NULL on property — cleared automatically.
 */
async function adminDeleteClnPropertyCascade(propertyId) {
  const pid = String(propertyId || '').trim();
  if (!pid) {
    const e = new Error('MISSING_PROPERTY_ID');
    e.code = 'MISSING_PROPERTY_ID';
    throw e;
  }

  const hasOp = await databaseHasColumn('cln_property', 'operator_id');
  const hasCd = await databaseHasColumn('cln_property', 'clientdetail_id');
  const sel = ['id'];
  if (hasOp) sel.push('operator_id');
  if (hasCd) sel.push('clientdetail_id');
  const [[propRow]] = await pool.query(`SELECT ${sel.join(', ')} FROM cln_property WHERE id = ? LIMIT 1`, [pid]);
  if (!propRow) {
    const e = new Error('PROPERTY_NOT_FOUND');
    e.code = 'PROPERTY_NOT_FOUND';
    throw e;
  }

  try {
    const plrSd = require('./cleanlemon-property-link-request.service');
    if (typeof plrSd.clearClnOperatorFromPropertySmartDoorRows === 'function') {
      const curOp = hasOp && propRow.operator_id != null ? String(propRow.operator_id).trim() : '';
      const hadCd =
        hasCd && propRow.clientdetail_id != null && String(propRow.clientdetail_id).trim() !== '';
      const cdForSmartDoor = hadCd ? String(propRow.clientdetail_id).trim() : '';
      if (curOp) {
        await plrSd.clearClnOperatorFromPropertySmartDoorRows(pid, curOp, cdForSmartDoor);
      }
    }
  } catch (sdErr) {
    console.warn('[cleanlemon] adminDeleteClnPropertyCascade smart door clear', sdErr?.message || sdErr);
  }

  await ensureOperatorTeamTable();

  const conn = await pool.getConnection();
  const deleted = {
    damageReports: 0,
    linkRequests: 0,
    operatorTeamsUpdated: 0,
  };
  try {
    await conn.beginTransaction();

    if (await clnDamageReportTableExists()) {
      const [dr] = await conn.query('DELETE FROM cln_damage_report WHERE property_id = ?', [pid]);
      deleted.damageReports = Number(dr?.affectedRows || 0);
    }
    if (await clnPropertyLinkRequestTableExists()) {
      const [plr] = await conn.query('DELETE FROM cln_property_link_request WHERE property_id = ?', [pid]);
      deleted.linkRequests = Number(plr?.affectedRows || 0);
    }
    deleted.operatorTeamsUpdated = await removePropertyIdFromAllOperatorTeamsConn(conn, pid);

    const [del] = await conn.query('DELETE FROM cln_property WHERE id = ? LIMIT 1', [pid]);
    if (!Number(del?.affectedRows || 0)) {
      await conn.rollback();
      const e = new Error('PROPERTY_NOT_FOUND');
      e.code = 'PROPERTY_NOT_FOUND';
      throw e;
    }

    await conn.commit();
    return { ok: true, deletedPropertyId: pid, deleted };
  } catch (e) {
    try {
      await conn.rollback();
    } catch (_) {
      /* ignore */
    }
    throw e;
  } finally {
    conn.release();
  }
}

// --- Driver route trips (`cln_driver_trip`) — employee order, driver accept, operator Grab ---

function rowToDriverTripPayload(r) {
  if (!r) return null;
  const o = {
    id: String(r.id || '').trim(),
    operatorId: String(r.operator_id || '').trim(),
    requesterEmployeeId: String(r.requester_employee_id || '').trim(),
    requesterEmail: String(r.requester_email || '').trim(),
    pickupText: String(r.pickup_text || ''),
    dropoffText: String(r.dropoff_text || ''),
    scheduleOffset: String(r.schedule_offset || 'now'),
    orderTimeUtc: r.order_time_utc ? new Date(r.order_time_utc).toISOString() : null,
    businessTimeZone: String(r.business_time_zone || 'Asia/Kuala_Lumpur'),
    status: String(r.status || ''),
    fulfillmentType: String(r.fulfillment_type || 'none'),
    acceptedDriverEmployeeId: r.accepted_driver_employee_id ? String(r.accepted_driver_employee_id).trim() : null,
    acceptedAtUtc: r.accepted_at_utc ? new Date(r.accepted_at_utc).toISOString() : null,
    driverStartedAtUtc: r.driver_started_at_utc ? new Date(r.driver_started_at_utc).toISOString() : null,
    completedAtUtc: r.completed_at_utc ? new Date(r.completed_at_utc).toISOString() : null,
    createdAtUtc: r.created_at_utc ? new Date(r.created_at_utc).toISOString() : null,
    updatedAtUtc: r.updated_at_utc ? new Date(r.updated_at_utc).toISOString() : null,
  };
  if (r.requester_full_name != null) o.requesterFullName = String(r.requester_full_name);
  if (r.accepted_driver_full_name != null) o.acceptedDriverFullName = String(r.accepted_driver_full_name);
  if (r.accepted_driver_phone != null) o.acceptedDriverPhone = String(r.accepted_driver_phone);
  if (r.accepted_driver_avatar_url != null) o.acceptedDriverAvatarUrl = String(r.accepted_driver_avatar_url);
  if (r.accepted_driver_car_plate != null && String(r.accepted_driver_car_plate).trim() !== '') {
    o.acceptedDriverCarPlate = String(r.accepted_driver_car_plate).trim();
  }
  if (r.accepted_driver_car_front_url != null && String(r.accepted_driver_car_front_url).trim() !== '') {
    o.acceptedDriverCarFrontUrl = String(r.accepted_driver_car_front_url).trim();
  }
  if (r.accepted_driver_car_back_url != null && String(r.accepted_driver_car_back_url).trim() !== '') {
    o.acceptedDriverCarBackUrl = String(r.accepted_driver_car_back_url).trim();
  }
  if (r.grab_car_plate != null) o.grabCarPlate = String(r.grab_car_plate);
  if (r.grab_phone != null) o.grabPhone = String(r.grab_phone);
  if (r.grab_proof_image_url != null) o.grabProofImageUrl = String(r.grab_proof_image_url);
  if (r.grab_booked_by_email != null) o.grabBookedByEmail = String(r.grab_booked_by_email);
  if (r.grab_booked_at_utc) o.grabBookedAtUtc = new Date(r.grab_booked_at_utc).toISOString();
  if (r.requester_team_name != null && String(r.requester_team_name).trim() !== '') {
    o.requesterTeamName = String(r.requester_team_name).trim();
  }
  o.pickup = o.pickupText;
  o.dropoff = o.dropoffText;
  return o;
}

async function assertEmployeeOperatorJunctionForDriverTrip(email, operatorId) {
  const em = String(email || '')
    .trim()
    .toLowerCase();
  const oid = String(operatorId || '').trim();
  if (!em || !oid) {
    const err = new Error('MISSING_OPERATOR_OR_EMAIL');
    err.code = 'MISSING_OPERATOR_OR_EMAIL';
    throw err;
  }
  await assertClnOperatorMasterRowExists(oid);
  if (!(await clnDc.databaseHasTable(pool, 'cln_employeedetail')) || !(await clnDc.databaseHasTable(pool, 'cln_employee_operator'))) {
    const err = new Error('OPERATOR_ACCESS_DENIED');
    err.code = 'OPERATOR_ACCESS_DENIED';
    throw err;
  }
  const [rows] = await pool.query(
    `SELECT eo.staff_role AS staff_role, d.id AS employee_id, LOWER(TRIM(d.email)) AS email
     FROM cln_employee_operator eo
     INNER JOIN cln_employeedetail d ON d.id = eo.employee_id
     WHERE eo.operator_id = ? AND LOWER(TRIM(d.email)) = ?
     LIMIT 1`,
    [oid, em]
  );
  if (!rows?.length) {
    const err = new Error('OPERATOR_ACCESS_DENIED');
    err.code = 'OPERATOR_ACCESS_DENIED';
    throw err;
  }
  return rows[0];
}

async function assertDriverOperatorJunctionForTrip(email, operatorId) {
  const row = await assertEmployeeOperatorJunctionForDriverTrip(email, operatorId);
  if (String(row.staff_role || '').toLowerCase() !== 'driver') {
    const err = new Error('DRIVER_ROLE_REQUIRED');
    err.code = 'DRIVER_ROLE_REQUIRED';
    throw err;
  }
  return row;
}

async function assertDobiOperatorJunctionForLinenQr(email, operatorId) {
  const row = await assertEmployeeOperatorJunctionForDriverTrip(email, operatorId);
  if (String(row.staff_role || '').toLowerCase() !== 'dobi') {
    const err = new Error('DOBI_ROLE_REQUIRED');
    err.code = 'DOBI_ROLE_REQUIRED';
    throw err;
  }
  return row;
}

function normalizeLinenTotalsForQr(t) {
  const o = t && typeof t === 'object' ? t : {};
  return {
    bedsheet: Math.max(0, Number(o.bedsheet) || 0),
    pillowCase: Math.max(0, Number(o.pillowCase ?? o.pillow_case) || 0),
    bedLinens: Math.max(0, Number(o.bedLinens ?? o.bed_linens) || 0),
    bathmat: Math.max(0, Number(o.bathmat) || 0),
    towel: Math.max(0, Number(o.towel) || 0),
  };
}

async function normalizeLinenLinesForQr(operatorId, linesRaw) {
  const arr = Array.isArray(linesRaw) ? linesRaw : [];
  const clnDobi = require('./cleanlemon-dobi.service');
  const types = await clnDobi.listItemTypes(operatorId);
  const byId = new Map(types.map((t) => [String(t.id), t]));
  const out = [];
  for (const raw of arr) {
    const itemTypeId = String(raw?.itemTypeId != null ? raw.itemTypeId : raw?.item_type_id || '').trim();
    if (!itemTypeId) continue;
    const qty = Math.max(0, Math.floor(Number(raw?.qty) || 0));
    if (qty <= 0) continue;
    const typ = byId.get(itemTypeId);
    if (!typ) {
      const err = new Error('INVALID_ITEM_TYPE');
      err.code = 'INVALID_ITEM_TYPE';
      throw err;
    }
    out.push({
      itemTypeId,
      qty,
      label: String(typ.label || '').trim() || itemTypeId,
    });
  }
  return out;
}

async function createLinenQrApprovalRequest({
  email,
  operatorId,
  date,
  action,
  team,
  totals,
  lines: linesRaw,
  missingQty,
  remark,
  ttlMs,
}) {
  const em = String(email || '')
    .trim()
    .toLowerCase();
  const oid = String(operatorId || '').trim();
  await assertClnOperatorStaffEmail(oid, em);
  const d = String(date || '').trim().slice(0, 10);
  const act = String(action || '')
    .trim()
    .toLowerCase();
  if (!d || (act !== 'collected' && act !== 'return')) {
    const err = new Error('INVALID_PAYLOAD');
    err.code = 'INVALID_PAYLOAD';
    throw err;
  }
  const mq = Math.max(0, Number(missingQty) || 0);
  const rem = String(remark || '').trim();
  if (act === 'return' && mq > 0 && !rem) {
    const err = new Error('REMARK_REQUIRED');
    err.code = 'REMARK_REQUIRED';
    throw err;
  }
  const normalizedLines = await normalizeLinenLinesForQr(oid, linesRaw);
  const tot = normalizeLinenTotalsForQr(totals);
  const sumLegacy = tot.bedsheet + tot.pillowCase + tot.bedLinens + tot.bathmat + tot.towel;
  const sumLines = normalizedLines.reduce((a, x) => a + x.qty, 0);
  if (sumLegacy <= 0 && sumLines <= 0) {
    const err = new Error('INVALID_PAYLOAD');
    err.code = 'INVALID_PAYLOAD';
    throw err;
  }
  const token = crypto.randomUUID();
  const now = Date.now();
  const ttl = Math.max(5000, Math.min(48 * 60 * 60 * 1000, Number(ttlMs) || 60 * 1000));
  const expiresAtIso = new Date(now + ttl).toISOString();
  const requestedAtIso = new Date(now).toISOString();

  const settings = await getOperatorSettings(oid);
  const existing = Array.isArray(settings.linenQrApprovals) ? [...settings.linenQrApprovals] : [];
  const pruned = existing.filter((x) => {
    if (!x || typeof x !== 'object') return false;
    if (String(x.status || 'pending') !== 'pending') return true;
    const exp = x.expiresAt ? new Date(x.expiresAt).getTime() : 0;
    return exp > now;
  });
  const payload = {
    date: d,
    action: act,
    team: String(team || '').trim() || 'Unassigned',
    totals: tot,
    ...(normalizedLines.length ? { lines: normalizedLines } : {}),
    missingQty: mq,
    remark: rem,
  };
  pruned.unshift({
    token,
    status: 'pending',
    requestedByEmail: em,
    requestedAt: requestedAtIso,
    expiresAt: expiresAtIso,
    payload,
  });
  const nextApprovals = pruned.slice(0, 300);
  await upsertOperatorSettings(oid, { linenQrApprovals: nextApprovals });
  return { ok: true, token, expiresAt: expiresAtIso };
}

async function getLinenQrApprovalForDobi({ email, operatorId, token }) {
  const oid = String(operatorId || '').trim();
  const t = String(token || '').trim();
  await assertDobiOperatorJunctionForLinenQr(email, oid);
  const settings = await getOperatorSettings(oid);
  const arr = Array.isArray(settings.linenQrApprovals) ? settings.linenQrApprovals : [];
  const now = Date.now();
  const row = arr.find((x) => x && x.token === t);
  if (!row) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (String(row.status || 'pending') !== 'pending') {
    const err = new Error('ALREADY_DONE');
    err.code = 'ALREADY_DONE';
    throw err;
  }
  const exp = row.expiresAt ? new Date(row.expiresAt).getTime() : 0;
  if (exp <= now) {
    const err = new Error('EXPIRED');
    err.code = 'EXPIRED';
    throw err;
  }
  return {
    ok: true,
    requestedByEmail: row.requestedByEmail,
    requestedAt: row.requestedAt,
    expiresAt: row.expiresAt,
    payload: row.payload,
  };
}

async function approveLinenQrApproval({ email, operatorId, token }) {
  const oid = String(operatorId || '').trim();
  const t = String(token || '').trim();
  const em = String(email || '')
    .trim()
    .toLowerCase();
  await assertDobiOperatorJunctionForLinenQr(em, oid);
  const settings = await getOperatorSettings(oid);
  const arr = Array.isArray(settings.linenQrApprovals) ? [...settings.linenQrApprovals] : [];
  const now = Date.now();
  const idx = arr.findIndex((x) => x && x.token === t);
  if (idx < 0) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const row = arr[idx];
  if (String(row.status || 'pending') !== 'pending') {
    const err = new Error('ALREADY_DONE');
    err.code = 'ALREADY_DONE';
    throw err;
  }
  const exp = row.expiresAt ? new Date(row.expiresAt).getTime() : 0;
  if (exp <= now) {
    const err = new Error('EXPIRED');
    err.code = 'EXPIRED';
    throw err;
  }
  const p = row.payload && typeof row.payload === 'object' ? row.payload : {};
  const location = { lat: null, lng: null };
  const approvedAt = new Date().toISOString();
  const entry = {
    id: `linen-${Date.now()}`,
    date: String(p.date || '').slice(0, 10),
    action: String(p.action || 'collected'),
    team: String(p.team || 'Unassigned'),
    totals: normalizeLinenTotalsForQr(p.totals),
    ...(Array.isArray(p.lines) && p.lines.length ? { lines: p.lines } : {}),
    missingQty: Math.max(0, Number(p.missingQty) || 0),
    remark: String(p.remark || '').trim(),
    qrApproved: true,
    approvedAt,
    approvedByEmail: em,
    requestedByEmail: String(row.requestedByEmail || '').trim(),
    requestedAt: row.requestedAt,
    submittedAt: row.requestedAt,
    signature: null,
    location,
  };
  const prevLogs = Array.isArray(settings.linenLogs) ? settings.linenLogs : [];
  const nextLogs = [entry, ...prevLogs].slice(0, 500);
  const nextApprovals = arr.filter((_, i) => i !== idx);

  const clnDobi = require('./cleanlemon-dobi.service');
  await clnDobi.appendIntakeFromLinenQrPayload(oid, em, p);

  await upsertOperatorSettings(oid, { linenLogs: nextLogs, linenQrApprovals: nextApprovals });
  return { ok: true, entry };
}

function computeDriverTripOrderTimeUtc(createdAtMs, scheduleOffset) {
  const so = String(scheduleOffset || 'now').trim();
  const base = new Date(Number(createdAtMs) || Date.now());
  if (Number.isNaN(base.getTime())) return new Date();
  if (so === 'now') return base;
  const mins = so === '15' ? 15 : so === '30' ? 30 : 0;
  const d = new Date(base.getTime());
  d.setMinutes(d.getMinutes() + mins);
  return d;
}

async function createEmployeeDriverTrip({ email, operatorId, pickupText, dropoffText, scheduleOffset }) {
  await assertEmployeeOperatorJunctionForDriverTrip(email, operatorId);
  if (!(await clnDc.databaseHasTable(pool, 'cln_driver_trip'))) {
    return { ok: false, reason: 'MIGRATION_REQUIRED' };
  }
  const pickup = String(pickupText || '').trim();
  const dropoff = String(dropoffText || '').trim();
  if (!pickup || !dropoff || pickup === dropoff) {
    const err = new Error('BAD_TRIP_ADDRESSES');
    err.code = 'BAD_TRIP_ADDRESSES';
    throw err;
  }
  const soRaw = String(scheduleOffset || 'now').trim();
  const so = soRaw === '15' || soRaw === '30' ? soRaw : 'now';
  const [[emp]] = await pool.query(
    'SELECT id, email FROM cln_employeedetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
    [String(email || '').trim().toLowerCase()]
  );
  if (!emp?.id) {
    const err = new Error('EMPLOYEE_ROW_MISSING');
    err.code = 'EMPLOYEE_ROW_MISSING';
    throw err;
  }
  const requesterEmployeeId = String(emp.id).trim();
  const requesterEmail = String(emp.email || email || '').trim();
  const oid = String(operatorId).trim();
  const [[dup]] = await pool.query(
    `SELECT id FROM cln_driver_trip
     WHERE requester_employee_id = ? AND operator_id = ?
       AND status IN ('pending','driver_accepted','grab_booked')
     LIMIT 1`,
    [requesterEmployeeId, oid]
  );
  if (dup?.id) {
    const err = new Error('ACTIVE_TRIP_EXISTS');
    err.code = 'ACTIVE_TRIP_EXISTS';
    throw err;
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  const orderTime = computeDriverTripOrderTimeUtc(now, so);
  await pool.query(
    `INSERT INTO cln_driver_trip (
      id, operator_id, requester_employee_id, requester_email,
      pickup_text, dropoff_text, schedule_offset, order_time_utc,
      business_time_zone, status, fulfillment_type,
      created_at_utc, updated_at_utc
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Asia/Kuala_Lumpur', 'pending', 'none', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
    [id, oid, requesterEmployeeId, requesterEmail, pickup.slice(0, 2000), dropoff.slice(0, 2000), so, orderTime]
  );
  const [[created]] = await pool.query('SELECT * FROM cln_driver_trip WHERE id = ? LIMIT 1', [id]);
  return { ok: true, trip: rowToDriverTripPayload(created) };
}

async function listRequesterPendingDriverTrips({ email, operatorId, limit = 20 }) {
  await assertEmployeeOperatorJunctionForDriverTrip(email, operatorId);
  if (!(await clnDc.databaseHasTable(pool, 'cln_driver_trip'))) {
    return { ok: false, reason: 'MIGRATION_REQUIRED', items: [] };
  }
  const [[emp]] = await pool.query(
    'SELECT id FROM cln_employeedetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
    [String(email || '').trim().toLowerCase()]
  );
  const eid = emp?.id ? String(emp.id).trim() : '';
  if (!eid) return { ok: true, items: [] };
  const lim = Math.min(100, Math.max(1, Number(limit) || 20));
  const [rows] = await pool.query(
    `SELECT * FROM cln_driver_trip
     WHERE operator_id = ? AND requester_employee_id = ? AND status = 'pending' AND fulfillment_type = 'none'
     ORDER BY created_at_utc DESC
     LIMIT ${lim}`,
    [String(operatorId).trim(), eid]
  );
  return { ok: true, items: (rows || []).map(rowToDriverTripPayload) };
}

async function listPendingDriverTripsForOperator({ email, operatorId, limit = 50 }) {
  await assertDriverOperatorJunctionForTrip(email, operatorId);
  if (!(await clnDc.databaseHasTable(pool, 'cln_driver_trip'))) {
    return { ok: false, reason: 'MIGRATION_REQUIRED', items: [] };
  }
  const lim = Math.min(200, Math.max(1, Number(limit) || 50));
  const oid = String(operatorId || '').trim();
  const [rows] = await pool.query(
    `SELECT * FROM cln_driver_trip
     WHERE operator_id = ? AND status = 'pending' AND fulfillment_type = 'none'
     ORDER BY order_time_utc ASC, created_at_utc ASC
     LIMIT ${lim}`,
    [oid]
  );
  return { ok: true, items: (rows || []).map(rowToDriverTripPayload) };
}

async function getActiveDriverTripForEmail({ email, operatorId }) {
  const rowDriver = await assertDriverOperatorJunctionForTrip(email, operatorId);
  if (!(await clnDc.databaseHasTable(pool, 'cln_driver_trip'))) {
    return { ok: false, reason: 'MIGRATION_REQUIRED', trip: null };
  }
  const driverEmployeeId = String(rowDriver.employee_id || '').trim();
  const oid = String(operatorId || '').trim();
  const [[row]] = await pool.query(
    `SELECT t.*,
            req.full_name AS requester_full_name,
            drv.full_name AS accepted_driver_full_name,
            drv.phone AS accepted_driver_phone,
            drv.avatar_url AS accepted_driver_avatar_url
     FROM cln_driver_trip t
     LEFT JOIN cln_employeedetail req ON req.id = t.requester_employee_id
     LEFT JOIN cln_employeedetail drv ON drv.id = t.accepted_driver_employee_id
     WHERE t.operator_id = ? AND t.accepted_driver_employee_id = ? AND t.status = 'driver_accepted'
     ORDER BY t.accepted_at_utc DESC
     LIMIT 1`,
    [oid, driverEmployeeId]
  );
  return { ok: true, trip: rowToDriverTripPayload(row) };
}

async function getActiveRequesterDriverTripForEmail({ email, operatorId }) {
  await assertEmployeeOperatorJunctionForDriverTrip(email, operatorId);
  if (!(await clnDc.databaseHasTable(pool, 'cln_driver_trip'))) {
    return { ok: false, reason: 'MIGRATION_REQUIRED', trip: null };
  }
  const [[emp]] = await pool.query(
    'SELECT id FROM cln_employeedetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
    [String(email || '').trim().toLowerCase()]
  );
  const eid = emp?.id ? String(emp.id).trim() : '';
  if (!eid) return { ok: true, trip: null };
  const oid = String(operatorId || '').trim();
  const hasDrvVeh = await databaseHasColumn('cln_employeedetail', 'driver_car_plate');
  const drvVehicleSel = hasDrvVeh
    ? `, drv.driver_car_plate AS accepted_driver_car_plate,
            drv.driver_car_front_url AS accepted_driver_car_front_url,
            drv.driver_car_back_url AS accepted_driver_car_back_url`
    : '';
  const [[row]] = await pool.query(
    `SELECT t.*,
            req.full_name AS requester_full_name,
            drv.full_name AS accepted_driver_full_name,
            drv.phone AS accepted_driver_phone,
            drv.avatar_url AS accepted_driver_avatar_url
            ${drvVehicleSel}
     FROM cln_driver_trip t
     LEFT JOIN cln_employeedetail req ON req.id = t.requester_employee_id
     LEFT JOIN cln_employeedetail drv ON drv.id = t.accepted_driver_employee_id
     WHERE t.operator_id = ? AND t.requester_employee_id = ?
       AND t.status IN ('pending','driver_accepted','grab_booked')
     ORDER BY t.created_at_utc DESC
     LIMIT 1`,
    [oid, eid]
  );
  return { ok: true, trip: rowToDriverTripPayload(row) };
}

async function listRequesterDriverTripHistoryForEmail({ email, operatorId, limit = 60 }) {
  await assertEmployeeOperatorJunctionForDriverTrip(email, operatorId);
  if (!(await clnDc.databaseHasTable(pool, 'cln_driver_trip'))) {
    return { ok: false, reason: 'MIGRATION_REQUIRED', items: [] };
  }
  const [[emp]] = await pool.query(
    'SELECT id FROM cln_employeedetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
    [String(email || '').trim().toLowerCase()]
  );
  const eid = emp?.id ? String(emp.id).trim() : '';
  if (!eid) return { ok: true, items: [] };
  const oid = String(operatorId || '').trim();
  const hasDrvVeh = await databaseHasColumn('cln_employeedetail', 'driver_car_plate');
  const drvVehicleSel = hasDrvVeh
    ? `, drv.driver_car_plate AS accepted_driver_car_plate,
            drv.driver_car_front_url AS accepted_driver_car_front_url,
            drv.driver_car_back_url AS accepted_driver_car_back_url`
    : '';
  const lim = Math.min(200, Math.max(1, Number(limit) || 60));
  const [rows] = await pool.query(
    `SELECT t.*,
            req.full_name AS requester_full_name,
            drv.full_name AS accepted_driver_full_name,
            drv.phone AS accepted_driver_phone,
            drv.avatar_url AS accepted_driver_avatar_url
            ${drvVehicleSel}
     FROM cln_driver_trip t
     LEFT JOIN cln_employeedetail req ON req.id = t.requester_employee_id
     LEFT JOIN cln_employeedetail drv ON drv.id = t.accepted_driver_employee_id
     WHERE t.operator_id = ? AND t.requester_employee_id = ?
       AND t.status IN ('completed', 'cancelled')
     ORDER BY COALESCE(t.completed_at_utc, t.updated_at_utc, t.created_at_utc) DESC
     LIMIT ${lim}`,
    [oid, eid]
  );
  return { ok: true, items: (rows || []).map(rowToDriverTripPayload) };
}

async function cancelRequesterDriverTrip({ email, operatorId, tripId }) {
  await assertEmployeeOperatorJunctionForDriverTrip(email, operatorId);
  if (!(await clnDc.databaseHasTable(pool, 'cln_driver_trip'))) {
    return { ok: false, reason: 'MIGRATION_REQUIRED' };
  }
  const tid = String(tripId || '').trim();
  const oid = String(operatorId || '').trim();
  if (!tid || !oid) {
    const err = new Error('BAD_REQUEST');
    err.code = 'BAD_REQUEST';
    throw err;
  }
  const [[emp]] = await pool.query(
    'SELECT id FROM cln_employeedetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
    [String(email || '').trim().toLowerCase()]
  );
  const eid = emp?.id ? String(emp.id).trim() : '';
  if (!eid) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const [[cur]] = await pool.query(
    'SELECT id, status, requester_employee_id FROM cln_driver_trip WHERE id = ? AND operator_id = ? LIMIT 1',
    [tid, oid]
  );
  if (!cur) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (String(cur.requester_employee_id) !== eid) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const st = String(cur.status || '');
  if (!['pending', 'driver_accepted', 'grab_booked'].includes(st)) {
    const err = new Error('TRIP_NOT_CANCELLABLE');
    err.code = 'TRIP_NOT_CANCELLABLE';
    throw err;
  }
  await pool.query(
    `UPDATE cln_driver_trip SET status = 'cancelled', updated_at_utc = CURRENT_TIMESTAMP(3) WHERE id = ? LIMIT 1`,
    [tid]
  );
  return { ok: true };
}

async function listDriverTripHistoryForEmail({ email, operatorId, limit = 40 }) {
  await assertDriverOperatorJunctionForTrip(email, operatorId);
  if (!(await clnDc.databaseHasTable(pool, 'cln_driver_trip'))) {
    return { ok: false, reason: 'MIGRATION_REQUIRED', items: [] };
  }
  const [[junction]] = await pool.query(
    `SELECT d.id AS employee_id
     FROM cln_employeedetail d
     INNER JOIN cln_employee_operator eo ON eo.employee_id = d.id
     WHERE eo.operator_id = ? AND LOWER(TRIM(d.email)) = ?
     LIMIT 1`,
    [String(operatorId || '').trim(), String(email || '').trim().toLowerCase()]
  );
  const eid = junction?.employee_id ? String(junction.employee_id).trim() : '';
  if (!eid) return { ok: true, items: [] };
  const lim = Math.min(200, Math.max(1, Number(limit) || 40));
  const [rows] = await pool.query(
    `SELECT * FROM cln_driver_trip
     WHERE operator_id = ? AND accepted_driver_employee_id = ? AND status = 'completed'
     ORDER BY COALESCE(completed_at_utc, updated_at_utc, created_at_utc) DESC
     LIMIT ${lim}`,
    [String(operatorId || '').trim(), eid]
  );
  return { ok: true, items: (rows || []).map(rowToDriverTripPayload) };
}

async function acceptDriverTrip({ email, operatorId, tripId }) {
  const rowDriver = await assertDriverOperatorJunctionForTrip(email, operatorId);
  const driverEmployeeId = String(rowDriver.employee_id || '').trim();
  if (!(await clnDc.databaseHasTable(pool, 'cln_driver_trip'))) {
    const err = new Error('MIGRATION_REQUIRED');
    err.code = 'MIGRATION_REQUIRED';
    throw err;
  }
  const [[active]] = await pool.query(
    `SELECT id FROM cln_driver_trip
     WHERE operator_id = ? AND accepted_driver_employee_id = ? AND status = 'driver_accepted'
     LIMIT 1`,
    [String(operatorId || '').trim(), driverEmployeeId]
  );
  if (active?.id) {
    const err = new Error('ACTIVE_TRIP_EXISTS');
    err.code = 'ACTIVE_TRIP_EXISTS';
    throw err;
  }
  const tid = String(tripId || '').trim();
  const [upd] = await pool.query(
    `UPDATE cln_driver_trip
     SET status = 'driver_accepted',
         fulfillment_type = 'driver',
         accepted_driver_employee_id = ?,
         accepted_at_utc = CURRENT_TIMESTAMP(3),
         updated_at_utc = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND operator_id = ? AND status = 'pending' AND fulfillment_type = 'none'`,
    [driverEmployeeId, tid, String(operatorId || '').trim()]
  );
  const affected = Number(upd?.affectedRows ?? 0);
  if (!affected) {
    const err = new Error('TRIP_NOT_AVAILABLE');
    err.code = 'TRIP_NOT_AVAILABLE';
    throw err;
  }
  const [[row]] = await pool.query(
    `SELECT t.*,
            req.full_name AS requester_full_name,
            drv.full_name AS accepted_driver_full_name,
            drv.phone AS accepted_driver_phone,
            drv.avatar_url AS accepted_driver_avatar_url
     FROM cln_driver_trip t
     LEFT JOIN cln_employeedetail req ON req.id = t.requester_employee_id
     LEFT JOIN cln_employeedetail drv ON drv.id = t.accepted_driver_employee_id
     WHERE t.id = ? LIMIT 1`,
    [tid]
  );
  return { ok: true, trip: rowToDriverTripPayload(row) };
}

async function finishDriverTrip({ email, operatorId, tripId }) {
  const rowDriver = await assertDriverOperatorJunctionForTrip(email, operatorId);
  const driverEmployeeId = String(rowDriver.employee_id || '').trim();
  if (!(await clnDc.databaseHasTable(pool, 'cln_driver_trip'))) {
    const err = new Error('MIGRATION_REQUIRED');
    err.code = 'MIGRATION_REQUIRED';
    throw err;
  }
  const tid = String(tripId || '').trim();
  const hasCompletedCol = await databaseHasColumn('cln_driver_trip', 'completed_at_utc');
  const setCompleted = hasCompletedCol ? ', completed_at_utc = CURRENT_TIMESTAMP(3)' : '';
  const [upd] = await pool.query(
    `UPDATE cln_driver_trip
     SET status = 'completed', updated_at_utc = CURRENT_TIMESTAMP(3) ${setCompleted}
     WHERE id = ? AND operator_id = ? AND accepted_driver_employee_id = ?
       AND status = 'driver_accepted'`,
    [tid, String(operatorId || '').trim(), driverEmployeeId]
  );
  const affected = Number(upd?.affectedRows ?? 0);
  if (!affected) {
    const err = new Error('TRIP_FINISH_DENIED');
    err.code = 'TRIP_FINISH_DENIED';
    throw err;
  }
  const [[row]] = await pool.query('SELECT * FROM cln_driver_trip WHERE id = ? LIMIT 1', [tid]);
  return { ok: true, trip: rowToDriverTripPayload(row) };
}

async function listOperatorDriverTrips({
  email,
  operatorId,
  statusFilter,
  limit = 100,
  businessDate,
  team,
  fulfillment,
  acceptedDriverEmployeeId,
}) {
  await assertClnOperatorStaffEmail(operatorId, email);
  if (!(await clnDc.databaseHasTable(pool, 'cln_driver_trip'))) {
    return { ok: false, reason: 'MIGRATION_REQUIRED', items: [] };
  }
  const lim = Math.min(500, Math.max(1, Number(limit) || 100));
  const oid = String(operatorId || '').trim();
  const sf = String(statusFilter || '').trim().toLowerCase();
  const hasCrm = await databaseHasColumn('cln_employee_operator', 'crm_json');
  const hasDrvVeh = await databaseHasColumn('cln_employeedetail', 'driver_car_plate');
  const teamSel = hasCrm
    ? `, IF(eo_req.crm_json IS NOT NULL AND JSON_VALID(eo_req.crm_json), NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(eo_req.crm_json, '$.team'))), ''), NULL) AS requester_team_name`
    : `, NULL AS requester_team_name`;
  const eoJoin = hasCrm
    ? `LEFT JOIN cln_employee_operator eo_req ON eo_req.employee_id = t.requester_employee_id AND eo_req.operator_id = t.operator_id`
    : '';
  const vehicleSel = hasDrvVeh
    ? `, drv.driver_car_plate AS accepted_driver_car_plate,
    drv.driver_car_front_url AS accepted_driver_car_front_url,
    drv.driver_car_back_url AS accepted_driver_car_back_url`
    : '';

  let where = 't.operator_id = ?';
  const params = [oid];
  if (sf && sf !== 'all') {
    where += ' AND t.status = ?';
    params.push(sf);
  }
  const bd = String(businessDate || '').trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(bd)) {
    where +=
      ' AND DATE(CONVERT_TZ(COALESCE(t.order_time_utc, t.created_at_utc), "+00:00", "+08:00")) = ?';
    params.push(bd);
  }
  const teamQ = String(team || '').trim();
  if (teamQ && teamQ !== 'all') {
    if (hasCrm) {
      where +=
        " AND IF(eo_req.crm_json IS NOT NULL AND JSON_VALID(eo_req.crm_json), NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(eo_req.crm_json, '$.team'))), ''), NULL) = ?";
      params.push(teamQ);
    }
  }
  const ful = String(fulfillment || '').trim().toLowerCase();
  const accId = String(acceptedDriverEmployeeId || '').trim();
  if (ful === 'grab') {
    where += " AND (t.status = 'grab_booked' OR t.fulfillment_type = 'grab')";
  } else if (ful === 'driver') {
    where += " AND t.status = 'driver_accepted'";
    if (accId) {
      where += ' AND t.accepted_driver_employee_id = ?';
      params.push(accId);
    }
  }

  const [rows] = await pool.query(
    `SELECT t.*,
            req.full_name AS requester_full_name,
            drv.full_name AS accepted_driver_full_name,
            drv.phone AS accepted_driver_phone,
            drv.avatar_url AS accepted_driver_avatar_url
            ${vehicleSel}
            ${teamSel}
     FROM cln_driver_trip t
     LEFT JOIN cln_employeedetail req ON req.id = t.requester_employee_id
     LEFT JOIN cln_employeedetail drv ON drv.id = t.accepted_driver_employee_id
     ${eoJoin}
     WHERE ${where}
     ORDER BY t.created_at_utc DESC
     LIMIT ${lim}`,
    params
  );
  return { ok: true, items: (rows || []).map(rowToDriverTripPayload) };
}

/** Operator portal — staff with `staff_role` driver for slot filters & status board. */
async function listOperatorDriverEmployees({ email, operatorId }) {
  await assertClnOperatorStaffEmail(operatorId, email);
  if (!(await clnDc.databaseHasTable(pool, 'cln_employee_operator'))) {
    return { ok: true, items: [] };
  }
  const oid = String(operatorId || '').trim();
  const hasPlate = await databaseHasColumn('cln_employeedetail', 'driver_car_plate');
  const plateSel = hasPlate ? ', d.driver_car_plate' : '';
  const [rows] = await pool.query(
    `SELECT d.id, d.full_name, d.email, d.phone${plateSel}
     FROM cln_employee_operator eo
     INNER JOIN cln_employeedetail d ON d.id = eo.employee_id
     WHERE eo.operator_id = ?
       AND LOWER(TRIM(COALESCE(eo.staff_role, ''))) = 'driver'
     ORDER BY COALESCE(d.full_name, ''), d.email`,
    [oid]
  );
  return {
    ok: true,
    items: (rows || []).map((r, idx) => ({
      slotLabel: idx < 3 ? `Driver ${String.fromCharCode(65 + idx)}` : `Driver ${idx + 1}`,
      slotLetter: idx < 3 ? String.fromCharCode(65 + idx) : '',
      employeeId: String(r.id),
      fullName: r.full_name != null ? String(r.full_name) : '',
      email: r.email != null ? String(r.email) : '',
      phone: r.phone != null ? String(r.phone) : '',
      carPlate: hasPlate && r.driver_car_plate != null ? String(r.driver_car_plate) : '',
    })),
  };
}

/** `cln_employee_operator.crm_json`: `offDuty: true` or `driverOnDuty: false` → fleet shows Off duty (when no active trip). */
function driverOffDutyFromEmployeeOperatorCrmJson(raw) {
  if (raw == null || raw === '') return false;
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!o || typeof o !== 'object') return false;
    if (o.offDuty === true) return true;
    if (o.driverOnDuty === false) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Live fleet status: off_duty (crm) / vacant / waiting (idle, pool has pending) / pickup / ongoing.
 */
async function listOperatorDriverFleetStatus({ email, operatorId }) {
  await assertClnOperatorStaffEmail(operatorId, email);
  if (!(await clnDc.databaseHasTable(pool, 'cln_driver_trip'))) {
    return { ok: false, reason: 'MIGRATION_REQUIRED', items: [], pendingPoolCount: 0 };
  }
  const oid = String(operatorId || '').trim();
  const hasStartedCol = await databaseHasColumn('cln_driver_trip', 'driver_started_at_utc');
  const startedExpr = hasStartedCol ? 't.driver_started_at_utc' : 'NULL';
  const hasEoCrm = await databaseHasColumn('cln_employee_operator', 'crm_json');
  const crmSel = hasEoCrm ? ', eo.crm_json AS eo_crm_json' : ', NULL AS eo_crm_json';
  const [[poolRow]] = await pool.query(
    `SELECT COUNT(*) AS c FROM cln_driver_trip WHERE operator_id = ? AND status = 'pending'`,
    [oid]
  );
  const pendingPoolCount = Number(poolRow?.c) || 0;
  if (!(await clnDc.databaseHasTable(pool, 'cln_employee_operator'))) {
    return { ok: true, items: [], pendingPoolCount };
  }
  const [rows] = await pool.query(
    `SELECT d.id AS employee_id, d.full_name, d.email, d.phone,
            t.id AS trip_id, t.status AS trip_status, t.pickup_text, t.dropoff_text,
            t.accepted_at_utc, ${startedExpr} AS driver_started_at_utc, t.order_time_utc, t.created_at_utc
            ${crmSel}
     FROM cln_employee_operator eo
     INNER JOIN cln_employeedetail d ON d.id = eo.employee_id
     LEFT JOIN cln_driver_trip t
       ON t.accepted_driver_employee_id = d.id AND t.operator_id = ? AND t.status = 'driver_accepted'
     WHERE eo.operator_id = ?
       AND LOWER(TRIM(COALESCE(eo.staff_role, ''))) = 'driver'
     ORDER BY COALESCE(d.full_name, ''), d.email`,
    [oid, oid]
  );
  const items = (rows || []).map((r) => {
    const tripId = r.trip_id ? String(r.trip_id) : '';
    const offDuty = hasEoCrm && driverOffDutyFromEmployeeOperatorCrmJson(r.eo_crm_json);
    let fleetStatus = 'vacant';
    if (tripId) {
      const started = r.driver_started_at_utc != null;
      fleetStatus = started ? 'ongoing' : 'pickup';
    } else if (offDuty) {
      fleetStatus = 'off_duty';
    } else if (pendingPoolCount > 0) {
      fleetStatus = 'waiting';
    }
    return {
      employeeId: String(r.employee_id),
      fullName: r.full_name != null ? String(r.full_name) : '',
      email: r.email != null ? String(r.email) : '',
      phone: r.phone != null ? String(r.phone) : '',
      fleetStatus,
      activeTrip: tripId
        ? {
            id: tripId,
            pickupText: r.pickup_text != null ? String(r.pickup_text) : '',
            dropoffText: r.dropoff_text != null ? String(r.dropoff_text) : '',
            acceptedAtUtc: r.accepted_at_utc ? new Date(r.accepted_at_utc).toISOString() : null,
            driverStartedAtUtc: r.driver_started_at_utc ? new Date(r.driver_started_at_utc).toISOString() : null,
            orderTimeUtc: r.order_time_utc ? new Date(r.order_time_utc).toISOString() : null,
            createdAtUtc: r.created_at_utc ? new Date(r.created_at_utc).toISOString() : null,
          }
        : null,
    };
  });
  return { ok: true, items, pendingPoolCount };
}

async function bookGrabOperatorDriverTrip({ email, operatorId, tripId, grabCarPlate, grabPhone, grabProofImageUrl }) {
  await assertClnOperatorStaffEmail(operatorId, email);
  if (!(await clnDc.databaseHasTable(pool, 'cln_driver_trip'))) {
    return { ok: false, reason: 'MIGRATION_REQUIRED' };
  }
  const tid = String(tripId || '').trim();
  const oid = String(operatorId || '').trim();
  const plate = grabCarPlate != null ? String(grabCarPlate).trim().slice(0, 64) : '';
  const phone = grabPhone != null ? String(grabPhone).trim().slice(0, 64) : '';
  const proof = grabProofImageUrl != null ? String(grabProofImageUrl).trim().slice(0, 2000) : '';
  if (!plate && !phone && !proof) {
    const err = new Error('GRAB_DETAILS_REQUIRED');
    err.code = 'GRAB_DETAILS_REQUIRED';
    throw err;
  }
  const em = String(email || '').trim().toLowerCase();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[row]] = await conn.query(
      'SELECT id, status FROM cln_driver_trip WHERE id = ? AND operator_id = ? FOR UPDATE',
      [tid, oid]
    );
    if (!row) {
      const err = new Error('NOT_FOUND');
      err.code = 'NOT_FOUND';
      throw err;
    }
    if (String(row.status) !== 'pending') {
      const err = new Error('TRIP_NOT_OPEN');
      err.code = 'TRIP_NOT_OPEN';
      throw err;
    }
    await conn.query(
      `UPDATE cln_driver_trip SET
        status = 'grab_booked',
        fulfillment_type = 'grab',
        grab_car_plate = ?,
        grab_phone = ?,
        grab_proof_image_url = ?,
        grab_booked_by_email = ?,
        grab_booked_at_utc = CURRENT_TIMESTAMP(3),
        updated_at_utc = CURRENT_TIMESTAMP(3)
       WHERE id = ? LIMIT 1`,
      [plate || null, phone || null, proof || null, em, tid]
    );
    await conn.commit();
  } catch (e) {
    try {
      await conn.rollback();
    } catch (_) {
      /* ignore */
    }
    throw e;
  } finally {
    conn.release();
  }
  const [[out]] = await pool.query(
    `SELECT t.*,
            req.full_name AS requester_full_name,
            drv.full_name AS accepted_driver_full_name,
            drv.phone AS accepted_driver_phone,
            drv.avatar_url AS accepted_driver_avatar_url
     FROM cln_driver_trip t
     LEFT JOIN cln_employeedetail req ON req.id = t.requester_employee_id
     LEFT JOIN cln_employeedetail drv ON drv.id = t.accepted_driver_employee_id
     WHERE t.id = ? LIMIT 1`,
    [tid]
  );
  return { ok: true, trip: rowToDriverTripPayload(out) };
}

module.exports = {
  health,
  stats,
  listProperties,
  listSchedules,
  getPricingConfig,
  upsertPricingConfig,
  listOperatorProperties,
  getOperatorPropertyDetail,
  listOperatorLinkedClientdetails,
  listClientPortalProperties,
  getClientPortalAccessiblePropertyIds,
  syncClientPortalPropertiesFromColiving,
  getClientPortalPropertyDetail,
  patchClientPortalProperty,
  bulkRequestClientPortalOperatorBinding,
  bulkClearClientPortalOperator,
  listOperatorDistinctPropertyNames,
  listGlobalDistinctPropertyNames,
  getGlobalPropertyNameDefaults,
  searchAddressPlaces,
  listOperatorLookup,
  createOperatorProperty,
  updateOperatorProperty,
  deleteOperatorProperty,
  listOperatorInvoices,
  updateInvoiceStatus,
  deleteInvoice,
  sendOperatorInvoicePaymentReminder,
  listAgreements,
  listAgreementsForClientPortal,
  previewClnAgreementInstancePdfForRecipient,
  previewClnAgreementInstancePdfForOperator,
  deleteClnOperatorAgreement,
  createAgreement,
  signAgreement,
  retryFinalizeClnOperatorAgreementPdf,
  listAgreementTemplates,
  createAgreementTemplate,
  previewOperatorAgreementTemplatePdf,
  buildClnAgreementVariablesReferenceDocxBuffer,
  listKpi,
  operatorDashboard,
  listNotifications,
  markNotificationRead,
  dismissNotification,
  getOperatorSettings,
  getOperatorPortalSetupStatus,
  upsertOperatorSettings,
  listOperatorSalaries,
  listOperatorContacts,
  createOperatorContact,
  updateOperatorContact,
  deleteOperatorContact,
  syncClnOperatorContactsWithAccounting,
  getClnAccountProviderForOperator,
  listOperatorTeams,
  createOperatorTeam,
  updateOperatorTeam,
  deleteOperatorTeam,
  listOperatorScheduleJobs,
  listOperatorPendingClientBookingRequests,
  decideOperatorClientBookingRequest,
  updateOperatorScheduleJob,
  deleteOperatorScheduleJob,
  createOperatorScheduleJob,
  createCleaningScheduleJobUnified,
  bulkCreateHomestayJobsByPropertyNameSubstring,
  listClientPortalScheduleJobs,
  createClientPortalScheduleJob,
  updateClientPortalScheduleJob,
  deleteClientPortalScheduleJob,
  listClientPortalInvoices,
  createClientPortalInvoiceCheckoutSession,
  createClientPortalInvoicePayment,
  confirmClientPortalInvoicePayment,
  handleB2bInvoiceBillplzCallback,
  handleB2bInvoiceXenditWebhook,
  saveClnOperatorClientInvoiceXenditCredentials,
  clearClnOperatorClientInvoiceXenditCredentials,
  applyCleanlemonClientInvoicesFromCheckoutSession,
  attachClientPortalInvoiceReceipt,
  listOperatorClientPaymentQueue,
  acknowledgeOperatorClientPayment,
  rejectOperatorClientPortalReceipt,
  rejectOperatorClientPortalReceiptBatch,
  getClientPortalOperatorBankTransferInfo,
  listOperatorAccountingMappings,
  upsertOperatorAccountingMapping,
  syncOperatorAccountingMappings,
  listOperatorCalendarAdjustments,
  createOperatorCalendarAdjustment,
  updateOperatorCalendarAdjustment,
  deleteOperatorCalendarAdjustment,
  listAdminSubscriptions,
  listAdminLockUnlockLogs,
  listAdminLockUnlockLogLockOptions,
  adminListGlobalDistinctPropertyNamesAdmin,
  adminListAllClnPropertiesBrief,
  adminSearchOperatorsBrief,
  adminSearchClientdetailsBrief,
  adminMergeClnPropertyNames,
  adminTransferClnProperty,
  adminGetClnPropertyDeletePreview,
  adminDeleteClnPropertyCascade,
  updateAdminSubscriptionPlan,
  updateAdminSubscriptionApproval,
  upsertSubscriptionFromStripeCheckout,
  updateSubscriptionFromStripeEvent,
  getOperatorSubscription,
  listOperatorSaasBillingHistory,
  getSubscriptionCheckoutEligibility,
  getOnboardingEnquiryStatusByEmail,
  listClnPricingplanCatalog,
  listClnAddonCatalog,
  resolveClnSubscriptionPriceId,
  buildClnSubscriptionCheckoutLineItem,
  upsertOperatorOnboardingProfile,
  getAdminOperatordetailByEmail,
  manualCreateAdminSubscription,
  updateAdminSubscription,
  terminateAdminSubscription,
  addAdminSubscriptionAddon,
  computeAddonProrationQuote,
  createAddonCheckoutSession,
  activateAddonFromStripeCheckoutSession,
  resolveRenewalAddonStripeLineItems,
  listOperatorInvoiceFormOptions,
  createOperatorInvoice,
  updateOperatorInvoice,
  listEmployeeAttendanceByEmail,
  employeeCheckIn,
  employeeCheckOut,
  listEmployeeInvitesByIdentity,
  getEmployeeProfileByEmail,
  upsertEmployeeProfileByEmail,
  assertClnClientPortalOperatorAccess,
  resolveClnClientdetailIdForClientPortal,
  listClientPortalLinkedCleanlemonsOperators,
  assertClnOperatorStaffEmail,
  createLinenQrApprovalRequest,
  getLinenQrApprovalForDobi,
  approveLinenQrApproval,
  groupStartEmployeeScheduleJobs,
  groupEndEmployeeScheduleJobs,
  createEmployeeDriverTrip,
  listRequesterPendingDriverTrips,
  listPendingDriverTripsForOperator,
  getActiveDriverTripForEmail,
  getActiveRequesterDriverTripForEmail,
  listRequesterDriverTripHistoryForEmail,
  cancelRequesterDriverTrip,
  listDriverTripHistoryForEmail,
  acceptDriverTrip,
  finishDriverTrip,
  listOperatorDriverTrips,
  listOperatorDriverEmployees,
  listOperatorDriverFleetStatus,
  bookGrabOperatorDriverTrip,
  getDriverVehicleByEmail,
  updateDriverVehicleByEmail,
  getEmployeeJobCompletionAddons,
  listEmployeeTaskUnlockTargets,
  employeeTaskRemoteUnlock,
  getPublicMarketingPricingBySubdomain,
  createEmployeeScheduleDamageReport,
  listOperatorDamageReports,
  listClientPortalDamageReports,
  acknowledgeClientPortalDamageReport,
};
