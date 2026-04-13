/**
 * Tenant Invoice (Client Invoice) – list/create/update/delete rental records, filters, meter groups.
 * Uses MySQL: rentalcollection, propertydetail, roomdetail, tenantdetail, account (type), ownerdetail,
 * tenancy, meterdetail (metersharing_json). All FK by _id.
 */

const pool = require('../../config/db');
const { randomUUID } = require('crypto');
const { getAccessContextByEmail } = require('../access/access.service');
const meterWrapper = require('../cnyiot/wrappers/meter.wrapper');
const {
  createInvoicesForRentalRecords,
  createReceiptForPaidRentalCollection,
  voidOrDeleteInvoicesForRentalCollectionIds,
  resolveClientAccounting,
  getBukkuSubdomainForClientInvoiceLink,
  buildRentalInvoiceDisplayUrl,
  buildRentalReceiptDisplayUrl,
  parseAccountingReceiptSnapshotJson,
  formatAccountingInvoiceReceiptLabel
} = require('../rentalcollection-invoice/rentalcollection-invoice.service');
const xeroPayment = require('../xero/wrappers/payment.wrapper');
const bukkuPayment = require('../bukku/wrappers/payment.wrapper');
const {
  malaysiaDateToUtcDatetimeForDb,
  malaysiaDateRangeToUtcForQuery,
  getTodayMalaysiaDate,
  utcDatetimeFromDbToMalaysiaDateOnly
} = require('../../utils/dateMalaysia');

/** Canonical template ids (see account seeds, rentalcollection-invoice). */
const ACCOUNT_FORFEIT_DEPOSIT_ID = '2020b22b-028e-4216-906c-c816dcb33a85';
/** Security deposit tenant invoice line — same id as booking `billing_json` / `booking.service` DEPOSIT. */
const ACCOUNT_DEPOSIT_ID = '18ba3daf-7208-46fc-8e97-43f34e898401';
const ACCOUNT_OWNER_COMMISSION_ID = '86da59c0-992c-4e40-8efd-9d6d793eaf6a';
const ACCOUNT_MANAGEMENT_FEES_ID = 'a1b2c3d4-0002-4000-8000-000000000002';

/** Types that bill the property owner — UI label gets ` (owner)` (id unchanged). */
const ACCOUNT_IDS_CHARGE_OWNER_DISPLAY = new Set([ACCOUNT_OWNER_COMMISSION_ID, ACCOUNT_MANAGEMENT_FEES_ID]);

/**
 * insertRentalRecords must accept the same template ids as getTypes(). Dropdown includes global templates
 * (client_id NULL) and this client's rows; getTypes also injects OC by id without client_id filter, so a bad
 * client_id on the canonical OC row must not block insert.
 */
function isAccountTypeAllowedForManualInsert(typeId, clientId, accountRow) {
  if (!accountRow || accountRow.id == null) return false;
  const cid = accountRow.client_id;
  if (cid == null || String(cid).trim() === '') return true;
  if (String(cid).trim() === String(clientId || '').trim()) return true;
  const tid = String(typeId || '').trim();
  if (tid === ACCOUNT_OWNER_COMMISSION_ID || tid === ACCOUNT_MANAGEMENT_FEES_ID || tid === ACCOUNT_DEPOSIT_ID)
    return true;
  return false;
}

/** Strip UI suffixes we add so re-formatting does not duplicate `(owner)` / `(income)`. */
function baseTitleForInvoiceLabel(rawTitle) {
  let s = String(rawTitle || '').trim();
  s = s.replace(/\s*\([Oo]wner\)\s*$/i, '').trim();
  s = s.replace(/\s*\([Ii]ncome\)\s*$/i, '').trim();
  return s;
}

function isIncomeAccountType(accountType) {
  if (accountType == null || accountType === '') return false;
  return String(accountType).trim().toLowerCase() === 'income';
}

/**
 * Operator invoice dropdown + list: e.g. `Owner Commission (owner) (income)` while `id` stays the UUID.
 * Appends `(income)` when `account.type` is income (after owner rename when applicable).
 */
function formatInvoiceTypeDisplayTitle(accountId, rawTitle, accountType) {
  const id = String(accountId || '').trim();
  const trimmed = rawTitle != null ? String(rawTitle).trim() : '';
  const base = baseTitleForInvoiceLabel(trimmed) || trimmed;
  let out;
  if (id && ACCOUNT_IDS_CHARGE_OWNER_DISPLAY.has(id)) {
    out = `${base || 'Unknown'} (owner)`;
  } else {
    out = trimmed || base || '';
  }
  if (isIncomeAccountType(accountType) && !/\([Ii]ncome\)\s*$/i.test(out)) {
    out = `${out} (income)`;
  }
  return out;
}

function formatBukkuApiError(err) {
  if (err == null) return 'unknown error';
  if (typeof err === 'string') return err;
  if (err.message && typeof err.message === 'string') return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** Normalize status from GET /sales/payments/:id (response shape may use transaction.status). */
function bukkuSalesPaymentStatusFromRead(data) {
  if (!data || typeof data !== 'object') return null;
  const st = data.transaction?.status ?? data.status;
  return typeof st === 'string' ? st : null;
}

/**
 * Reverse/remove Bukku sales payment per OpenAPI: DELETE only for draft|void; posted → PATCH void.
 */
async function reverseBukkuTenantInvoicePayment(req, paymentId) {
  const readRes = await bukkuPayment.getPayment(req, paymentId);
  const status = readRes?.ok ? bukkuSalesPaymentStatusFromRead(readRes.data) : null;

  if (readRes?.ok && status === 'void') {
    return { ok: true };
  }

  if (readRes?.ok && status === 'draft') {
    const delRes = await bukkuPayment.deletePayment(req, paymentId);
    if (!delRes?.ok) {
      throw new Error(`Delete Bukku draft payment ${paymentId} failed: ${formatBukkuApiError(delRes?.error)}`);
    }
    return { ok: true };
  }

  const patchRes = await bukkuPayment.updatePaymentStatus(req, paymentId, {
    status: 'void',
    void_reason: 'Void payment from tenant invoice'
  });
  if (patchRes?.ok) {
    return { ok: true };
  }

  if (readRes?.ok && status != null && status !== 'draft') {
    throw new Error(
      `Bukku void payment ${paymentId} failed (status=${status}; posted payments cannot DELETE): ${formatBukkuApiError(patchRes?.error)}`
    );
  }

  const delRes = await bukkuPayment.deletePayment(req, paymentId);
  if (!delRes?.ok) {
    throw new Error(
      `Bukku void payment ${paymentId} failed: PATCH void: ${formatBukkuApiError(patchRes?.error)}; DELETE: ${formatBukkuApiError(delRes?.error)}`
    );
  }
  return { ok: true };
}

/**
 * Get property list for filter dropdown. Returns { id, shortname }.
 */
async function getProperties(clientId) {
  if (!clientId) return [];
  const [rows] = await pool.query(
    'SELECT id, shortname FROM propertydetail WHERE client_id = ? ORDER BY shortname ASC LIMIT 1000',
    [clientId]
  );
  return rows.map((r) => ({ id: r.id, _id: r.id, shortname: r.shortname }));
}

/** Unified `account.type` (Bukku-style classification) excluded from tenant invoice line dropdown — balance sheet / clearing, not rent lines. */
const INVOICE_TYPE_EXCLUDED_ACCOUNT_TYPES = new Set([
  'asset',
  'assets',
  'bank',
  'cash',
  'current_asset',
  'current_assets',
  'non_current_asset',
  'non_current_assets',
  'other_asset',
  'other_assets',
  'liability',
  'liabilities',
  'current_liability',
  'current_liabilities',
  'non_current_liability',
  'non_current_liabilities',
  'currliab',
  'equity',
  'expense',
  'expenses',
  'cost_of_sales',
  'directcosts',
  'taxation',
  'other_income'
])

function normalizeAccountTypeToken(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_')
}

function isExcludedFromInvoiceTypeDropdown(row) {
  const t = normalizeAccountTypeToken(row.type)
  return !!(t && INVOICE_TYPE_EXCLUDED_ACCOUNT_TYPES.has(t))
}

/**
 * Manual invoice type picker + All types filter: omit Forfeit Deposit (system/terminate flow).
 * Whitelist canonical Deposit (liability in DB) so Operator invoice matches booking-generated deposit lines.
 */
function isExcludedFromManualInvoiceTypePick(row) {
  if (!row || row.id == null) return true
  if (String(row.id).trim() === ACCOUNT_FORFEIT_DEPOSIT_ID) return true
  if (String(row.id).trim().toLowerCase() === ACCOUNT_DEPOSIT_ID) return false
  return isExcludedFromInvoiceTypeDropdown(row)
}

/**
 * Get account (bukkuid) list for type dropdown. Returns { id, title }.
 * Omits balance-sheet types except canonical Deposit (security deposit; same as booking).
 * Same list powers Create Invoice and the page Type filter.
 * Scoped to template rows (`client_id` NULL) plus this operator’s chart (`client_id` = clientId) so
 * per-operator income lines (e.g. Cleaning Services) appear and filter/create use the correct `account.id`.
 */
async function getTypes(clientId) {
  const cid = clientId != null && String(clientId).trim() !== '' ? String(clientId).trim() : null;
  const [rows] = cid
    ? await pool.query(
        `SELECT id, title, type FROM account
         WHERE client_id IS NULL OR client_id = ?
         ORDER BY title ASC
         LIMIT 2000`,
        [cid]
      )
    : await pool.query('SELECT id, title, type FROM account ORDER BY title ASC LIMIT 1000');
  const list = rows
    .filter((r) => !isExcludedFromManualInvoiceTypePick(r))
    .map((r) => ({
      id: r.id,
      _id: r.id,
      title: formatInvoiceTypeDisplayTitle(r.id, r.title, r.type)
    }))

  // Keep historical/legacy types visible in filter dropdown
  // when they were already used by this client's rental records (e.g. Deposit).
  if (clientId) {
    const [usedRows] = await pool.query(
      `SELECT DISTINCT a.id, a.title, a.type
       FROM rentalcollection r
       INNER JOIN account a ON a.id = r.type_id
       WHERE r.client_id = ?
       ORDER BY a.title ASC
       LIMIT 1000`,
      [clientId]
    )
    const existingIds = new Set(list.map((x) => String(x.id)))
    for (const r of usedRows) {
      const id = r?.id != null ? String(r.id) : ''
      if (!id || existingIds.has(id)) continue
      if (isExcludedFromManualInvoiceTypePick(r)) continue
      list.push({
        id: r.id,
        _id: r.id,
        title: formatInvoiceTypeDisplayTitle(r.id, r.title, r.type)
      })
      existingIds.add(id)
    }
  }

  // Ensure Owner Commission template is selectable when present in DB (canonical id).
  if (cid) {
    const hasOc = list.some((x) => String(x.id) === ACCOUNT_OWNER_COMMISSION_ID)
    if (!hasOc) {
      const [ocRows] = await pool.query(
        'SELECT id, title, type FROM account WHERE id = ? LIMIT 1',
        [ACCOUNT_OWNER_COMMISSION_ID]
      )
      const oc = ocRows[0]
      if (oc && !isExcludedFromManualInvoiceTypePick(oc)) {
        list.push({
          id: oc.id,
          _id: oc.id,
          title: formatInvoiceTypeDisplayTitle(oc.id, oc.title, oc.type)
        })
      }
    }
  }

  list.sort((a, b) =>
    String(a.title || '').localeCompare(String(b.title || ''), 'en', { sensitivity: 'base', numeric: true })
  )
  return list
}

/**
 * Suggested tenant cleaning charge (MYR) from room/property `cleanlemons_cleaning_tenant_price_myr` for Create Invoice.
 * Tenancy must belong to the operator client.
 */
async function getTenancyCleaningPriceHint(clientId, tenancyId) {
  const cid = clientId != null && String(clientId).trim() !== '' ? String(clientId).trim() : '';
  const tid = tenancyId != null && String(tenancyId).trim() !== '' ? String(tenancyId).trim() : '';
  if (!cid || !tid) return { ok: false, reason: 'MISSING', price: null };
  const [[row]] = await pool.query(
    `SELECT t.client_id,
            r.cleanlemons_cleaning_tenant_price_myr AS room_price,
            p.cleanlemons_cleaning_tenant_price_myr AS property_price
       FROM tenancy t
       LEFT JOIN roomdetail r ON r.id = t.room_id
       LEFT JOIN propertydetail p ON p.id = r.property_id
      WHERE t.id = ?
      LIMIT 1`,
    [tid]
  );
  if (!row || String(row.client_id || '').trim() !== cid) {
    return { ok: false, reason: 'TENANCY_NOT_FOUND', price: null };
  }
  const rp = row.room_price != null ? Number(row.room_price) : null;
  const pp = row.property_price != null ? Number(row.property_price) : null;
  const raw = rp != null && !Number.isNaN(rp) ? rp : pp != null && !Number.isNaN(pp) ? pp : null;
  const price = raw != null && raw > 0 ? raw : null;
  return { ok: true, price };
}

/** Resolve account id for "Topup Aircond" type (for metertransaction display). */
async function getTopupAircondAccountId() {
  const [rows] = await pool.query(
    `SELECT id FROM account WHERE TRIM(title) IN ('Topup Aircond', 'Top-up Aircond', 'Meter Topup', 'topup aircond') LIMIT 1`
  );
  return rows[0] ? rows[0].id : null;
}

/** Prefer invoiceid; some rows only have bukku_invoice_id (same Bukku sales id after create). */
function coalesceAccountingInvoiceId(row) {
  if (!row) return null;
  const a = row.invoiceid != null && String(row.invoiceid).trim() !== '' ? String(row.invoiceid).trim() : '';
  if (a) return a;
  const b =
    row.bukku_invoice_id != null && String(row.bukku_invoice_id).trim() !== ''
      ? String(row.bukku_invoice_id).trim()
      : '';
  return b || null;
}

function looksLikeUuid(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(str || '').trim()
  );
}

function buildXeroInvoiceOpenUrl(invoiceId) {
  const id = invoiceId != null ? String(invoiceId).trim() : '';
  if (!id || !looksLikeUuid(id)) return null;
  return `https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${encodeURIComponent(id)}`;
}

async function getClientCurrencyCode(clientId) {
  if (!clientId) return null;
  try {
    const [rows] = await pool.query('SELECT currency FROM operatordetail WHERE id = ? LIMIT 1', [clientId]);
    const code = rows[0]?.currency != null ? String(rows[0].currency).trim().toUpperCase() : '';
    return code || null;
  } catch {
    return null;
  }
}

/** Display: `IV-xxx | OR-yyy` → provider invoice id → internal row id */
function buildInvoiceRef(row) {
  const parsed = parseAccountingReceiptSnapshotJson(row.accounting_receipt_snapshot);
  const receiptNo =
    (row.accounting_receipt_document_number && String(row.accounting_receipt_document_number).trim()) ||
    (parsed?.number ? String(parsed.number).trim() : '');
  const pair = formatAccountingInvoiceReceiptLabel(row.accounting_document_number, receiptNo);
  const iid = coalesceAccountingInvoiceId(row) || '';
  return pair || iid || String(row.id);
}

/** Best-effort public URL for “View invoice” (Bukku: direct link or sales list when only IV- doc no). */
function resolveViewInvoiceUrl(row, bukkuSub) {
  const invId = coalesceAccountingInvoiceId(row);
  const built = buildRentalInvoiceDisplayUrl(row.invoiceurl, invId, bukkuSub);
  if (built && /^https?:\/\//i.test(String(built))) return built;
  const xeroUrl = buildXeroInvoiceOpenUrl(invId);
  if (xeroUrl) return xeroUrl;
  const sub = bukkuSub != null && String(bukkuSub).trim() !== '' ? String(bukkuSub).trim() : '';
  if (!sub) return null;
  const doc =
    row.accounting_document_number != null && String(row.accounting_document_number).trim()
      ? String(row.accounting_document_number).trim()
      : '';
  if (doc && /^IV-/i.test(doc)) {
    return `https://${sub}.bukku.my/sales/invoices`;
  }
  return null;
}

/**
 * Get rental list with filters. Includes rentalcollection + 充值成功的 metertransaction (as type Topup Aircond).
 * rentalcollection: property, type, from, to. metertransaction: ispaid=1, status='success', same property/from/to (on updated_at).
 * Returns array of items in shape expected by frontend; items from metertransaction have _source: 'metertransaction' (no Delete).
 */
async function getRentalList(clientId, opts = {}) {
  if (!clientId) return { items: [], bukkuSubdomain: null, currency: null };
  const { property, type, from, to } = opts;
  const fRaw = from != null && from !== '' ? String(from).trim() : '';
  const tRaw = to != null && to !== '' ? String(to).trim() : '';
  let fromBound = null;
  let toBound = null;
  if (fRaw && tRaw && /^\d{4}-\d{2}-\d{2}$/.test(fRaw) && /^\d{4}-\d{2}-\d{2}$/.test(tRaw)) {
    const r = malaysiaDateRangeToUtcForQuery(fRaw, tRaw);
    fromBound = r.fromUtc;
    toBound = r.toUtc;
  } else {
    if (from) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(fRaw)) fromBound = malaysiaDateToUtcDatetimeForDb(fRaw);
      else fromBound = from instanceof Date ? from : new Date(from);
    }
    if (to) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(tRaw)) toBound = malaysiaDateRangeToUtcForQuery(null, tRaw).toUtc;
      else {
        const toDate = to instanceof Date ? to : new Date(to);
        toDate.setHours(23, 59, 59, 999);
        toBound = toDate;
      }
    }
  }
  const bukkuSub = await getBukkuSubdomainForClientInvoiceLink(clientId);
  const currency = await getClientCurrencyCode(clientId);
  const topupAccountId = await getTopupAircondAccountId();
  let topupAccountType = null;
  if (topupAccountId) {
    const [tuRows] = await pool.query('SELECT type FROM account WHERE id = ? LIMIT 1', [topupAccountId]);
    topupAccountType = tuRows[0]?.type ?? null;
  }
  const includeMeterTransactions = !type || type === 'ALL' || type === topupAccountId;

  // 1) rentalcollection – type_id FK to account.id, display account.title as type
  let sql = `
    SELECT r.id, r.paidat, r.referenceid, r.description, r.amount, r.ispaid, r.date, r.receipturl, r.invoiceurl, r.invoiceid, r.bukku_invoice_id,
           r.accounting_document_number, r.accounting_receipt_document_number, r.accounting_receipt_snapshot, r.bukku_payment_id, r.title,
           r.property_id, r.room_id, r.tenant_id, r.type_id,
           p.shortname AS property_shortname,
           o.ownername AS owner_ownername,
           rm.title_fld AS room_title_fld,
           t.fullname AS tenant_fullname,
           TRIM(COALESCE(a.title, '')) AS type_title,
           TRIM(COALESCE(a.type, '')) AS type_account_type
    FROM rentalcollection r
    LEFT JOIN propertydetail p ON p.id = r.property_id
    LEFT JOIN ownerdetail o ON o.id = p.owner_id
    LEFT JOIN roomdetail rm ON rm.id = r.room_id
    LEFT JOIN tenantdetail t ON t.id = r.tenant_id
    LEFT JOIN account a ON a.id = r.type_id
    WHERE r.client_id = ?
  `;
  const params = [clientId];
  if (opts.staffId) {
    sql += ` AND EXISTS (
      SELECT 1 FROM tenancy ts
      WHERE ts.id = r.tenancy_id
        AND ts.client_id = r.client_id
        AND (ts.submitby_id = ? OR ts.last_extended_by_id = ?)
    )`;
    params.push(opts.staffId, opts.staffId);
  }
  if (property && property !== 'ALL') {
    sql += ' AND r.property_id = ?';
    params.push(property);
  }
  if (type && type !== 'ALL') {
    sql += ' AND r.type_id = ?';
    params.push(type);
  }
  if (fromBound) {
    sql += ' AND r.date >= ?';
    params.push(fromBound);
  }
  if (toBound) {
    sql += ' AND r.date <= ?';
    params.push(toBound);
  }
  sql += ' ORDER BY r.date DESC LIMIT 1000';
  const [rows] = await pool.query(sql, params);
  const rentalItems = rows.map((row) => {
    const parsed = parseAccountingReceiptSnapshotJson(row.accounting_receipt_snapshot);
    const payId =
      (row.bukku_payment_id && String(row.bukku_payment_id).trim()) ||
      (parsed?.id ? String(parsed.id).trim() : '');
    const invId = coalesceAccountingInvoiceId(row);
    const displayInvoiceUrl =
      buildRentalInvoiceDisplayUrl(row.invoiceurl, invId, bukkuSub) || buildXeroInvoiceOpenUrl(invId);
    return {
    _id: row.id,
    id: row.id,
    invoiceid: invId,
    paidat: row.paidat,
    referenceid: row.referenceid,
    description: row.description != null ? row.description : '',
    amount: row.amount,
    isPaid: !!row.ispaid,
    date: row.date,
    receipturl: buildRentalReceiptDisplayUrl(row.receipturl, payId, bukkuSub),
    invoiceurl: displayInvoiceUrl,
    viewInvoiceUrl: resolveViewInvoiceUrl(row, bukkuSub),
    bukkuSubdomain: bukkuSub,
    title: row.title,
    property: row.property_id
      ? { id: row.property_id, shortname: row.property_shortname, ownername: { ownerName: row.owner_ownername || '' } }
      : null,
    room: row.room_id ? { id: row.room_id, title_fld: row.room_title_fld } : null,
    tenant: row.tenant_id ? { id: row.tenant_id, fullname: row.tenant_fullname } : null,
    type: row.type_id
      ? {
          id: row.type_id,
          title: formatInvoiceTypeDisplayTitle(
            row.type_id,
            (row.type_title && String(row.type_title).trim()) ? String(row.type_title).trim() : 'Unknown',
            row.type_account_type
          )
        }
      : null,
    invoiceRef: buildInvoiceRef(row),
    _source: 'rentalcollection'
  };
  });

  // 2) 充值成功的 metertransaction，统一视为 type Topup Aircond
  let meterItems = [];
  if (includeMeterTransactions && topupAccountId) {
    let mtSql = `
      SELECT mt.id, mt.property_id, mt.amount, mt.updated_at, mt.receipturl, mt.invoiceurl, mt.invoiceid, mt.bukku_invoice_id, mt.referenceid,
             mt.accounting_document_number, mt.accounting_receipt_document_number, mt.accounting_receipt_snapshot, mt.bukku_payment_id,
             p.shortname AS property_shortname,
             rm.id AS room_id, rm.title_fld AS room_title_fld,
             t.id AS tenant_id, t.fullname AS tenant_fullname
      FROM metertransaction mt
      INNER JOIN propertydetail p ON p.id = mt.property_id AND p.client_id = ?
      LEFT JOIN tenancy tn ON tn.id = mt.tenancy_id
      LEFT JOIN roomdetail rm ON rm.id = tn.room_id
      LEFT JOIN tenantdetail t ON t.id = mt.tenant_id
      WHERE mt.ispaid = 1 AND (mt.status = 'success' OR mt.status IS NULL)
    `;
    const mtParams = [clientId];
    if (opts.staffId) {
      mtSql += ' AND (tn.submitby_id = ? OR tn.last_extended_by_id = ?)';
      mtParams.push(opts.staffId, opts.staffId);
    }
    if (property && property !== 'ALL') {
      mtSql += ' AND mt.property_id = ?';
      mtParams.push(property);
    }
    if (fromBound) {
      mtSql += ' AND mt.updated_at >= ?';
      mtParams.push(fromBound);
    }
    if (toBound) {
      mtSql += ' AND mt.updated_at <= ?';
      mtParams.push(toBound);
    }
    mtSql += ' ORDER BY mt.updated_at DESC LIMIT 1000';
    const [mtRows] = await pool.query(mtSql, mtParams);
    const topupTitle = formatInvoiceTypeDisplayTitle(topupAccountId, 'Topup Aircond', topupAccountType);
    meterItems = mtRows.map((row) => {
      const parsedRec = parseAccountingReceiptSnapshotJson(row.accounting_receipt_snapshot);
      const payId =
        (row.bukku_payment_id && String(row.bukku_payment_id).trim()) ||
        (parsedRec?.id ? String(parsedRec.id).trim() : '');
      const invId = coalesceAccountingInvoiceId(row);
      const displayInvoiceUrl =
        buildRentalInvoiceDisplayUrl(row.invoiceurl, invId, bukkuSub) || buildXeroInvoiceOpenUrl(invId);
      return {
      _id: row.id,
      id: row.id,
      invoiceid: invId,
      paidat: row.updated_at,
      referenceid: row.referenceid,
      description: '',
      amount: row.amount,
      isPaid: true,
      date: row.updated_at,
      receipturl: buildRentalReceiptDisplayUrl(row.receipturl, payId, bukkuSub),
      invoiceurl: displayInvoiceUrl,
      viewInvoiceUrl: resolveViewInvoiceUrl(row, bukkuSub),
      bukkuSubdomain: bukkuSub,
      title: topupTitle,
      property: row.property_id
        ? { id: row.property_id, shortname: row.property_shortname, ownername: { ownerName: '' } }
        : { id: null, shortname: row.property_shortname || '', ownername: { ownerName: '' } },
      room: row.room_id ? { id: row.room_id, title_fld: row.room_title_fld } : null,
      tenant: row.tenant_id ? { id: row.tenant_id, fullname: row.tenant_fullname } : null,
      type: { id: topupAccountId, title: topupTitle },
      invoiceRef: buildInvoiceRef(row),
      _source: 'metertransaction'
    };
    });
  }

  const merged = [...rentalItems, ...meterItems].sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0;
    const db = b.date ? new Date(b.date).getTime() : 0;
    return db - da;
  });
  return {
    items: merged.slice(0, 1000),
    bukkuSubdomain: bukkuSub || null,
    currency
  };
}

/**
 * Get tenancy list with room and tenant for create-invoice dropdown.
 * Optional propertyId filters by room's property. Returns all tenancies (active + inactive) with end_date for (Active/Inactive) label.
 */
async function getTenancyList(clientId, opts = {}) {
  if (!clientId) return [];
  const { propertyId, staffId } = opts;
  /* tenancy table uses `end` not end_date */
  let sql = `SELECT t.id, t.room_id, t.tenant_id, t.\`end\` AS end_date, t.status,
            r.title_fld AS room_title_fld, r.property_id AS room_property_id,
            tn.fullname AS tenant_fullname
     FROM tenancy t
     LEFT JOIN roomdetail r ON r.id = t.room_id
     LEFT JOIN tenantdetail tn ON tn.id = t.tenant_id
     WHERE t.client_id = ?`;
  const params = [clientId];
  if (staffId) {
    sql += ' AND (t.submitby_id = ? OR t.last_extended_by_id = ?)';
    params.push(staffId, staffId);
  }
  if (propertyId) {
    sql += ' AND r.property_id = ?';
    params.push(propertyId);
  }
  sql += ' ORDER BY t.`end` DESC, t.id LIMIT 1000';
  const [rows] = await pool.query(sql, params);
  const today = getTodayMalaysiaDate();
  return rows.map((r) => {
    const endDate =
      r.end_date != null ? utcDatetimeFromDbToMalaysiaDateOnly(r.end_date) || null : null;
    const active = r.status === 1 && (!endDate || endDate >= today);
    return {
      id: r.id,
      _id: r.id,
      room: r.room_id ? { id: r.room_id, title_fld: r.room_title_fld, property_id: r.room_property_id } : null,
      tenant: r.tenant_id ? { id: r.tenant_id, fullname: r.tenant_fullname } : null,
      end_date: endDate,
      status: r.status,
      active,
    };
  });
}

/**
 * Get meter groups from meterdetail where metersharing_json is not empty.
 * Returns array of { _id, groupId, name, meters: [{ _id, meterId, title, mode, rate, role, active, sharingmode, sharingType }] }.
 */
async function getMeterGroups(clientId) {
  if (!clientId) return [];
  const [rows] = await pool.query(
    'SELECT id, meterid, title, mode, rate, metersharing_json FROM meterdetail WHERE client_id = ? AND metersharing_json IS NOT NULL AND JSON_LENGTH(COALESCE(metersharing_json, JSON_ARRAY())) > 0 LIMIT 500',
    [clientId]
  );
  const groupMap = new Map();
  for (const m of rows) {
    let arr = [];
    try {
      arr = typeof m.metersharing_json === 'string' ? JSON.parse(m.metersharing_json) : m.metersharing_json;
    } catch (_) {}
    if (!Array.isArray(arr)) continue;
    for (const ms of arr) {
      const gid = ms.sharinggroupId || ms.sharingGroupId;
      if (!gid) continue;
      if (!groupMap.has(gid)) {
        groupMap.set(gid, {
          _id: gid,
          groupId: gid,
          name: ms.groupName || `Group ${gid}`,
          meters: []
        });
      }
      groupMap.get(gid).meters.push({
        _id: m.id,
        meterId: m.meterid,
        title: m.title,
        mode: m.mode,
        rate: m.rate,
        role: ms.role || 'peer',
        active: ms.active !== false,
        sharingmode: ms.sharingmode,
        sharingType: ms.sharingType
      });
    }
  }
  return [...groupMap.values()];
}

/**
 * Insert rental records. Each record: { date, tenancy, type, amount, referenceid?, description? }.
 * tenancy = tenancy.id; type = account.id. Resolves room_id, tenant_id, property_id from tenancy.
 * referenceid and description are separate columns.
 *
 * UI sends Malaysia invoice date as YYYY-MM-DD (Create Invoice date picker). Pool is +00:00:
 * store start-of-MY-day UTC (same as booking / dateMalaysia), not `new Date(ymd)` UTC midnight.
 */
function manualRentalDateInputToMysqlUtcString(recDate) {
  if (recDate == null || recDate === '') {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
  }
  if (typeof recDate === 'string') {
    const t = recDate.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
      const utc = malaysiaDateToUtcDatetimeForDb(t);
      return utc || new Date().toISOString().replace('T', ' ').substring(0, 19);
    }
  }
  const d = recDate instanceof Date ? recDate : new Date(recDate);
  if (Number.isNaN(d.getTime())) {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
  }
  return d.toISOString().replace('T', ' ').substring(0, 19);
}

const INV_LOG = '[invoice-flow/rental-insert]';

function invLogRental(phase, data) {
  try {
    console.log(`${INV_LOG} ${phase} ${JSON.stringify(data)}`);
  } catch {
    console.log(`${INV_LOG} ${phase} (unserializable)`);
  }
}

/** After insert + accounting invoice, return ids with display URL for operator UI (View invoice). */
async function fetchInsertedInvoiceRows(clientId, ids) {
  if (!clientId || !Array.isArray(ids) || !ids.length) return [];
  const bukkuSub = await getBukkuSubdomainForClientInvoiceLink(clientId);
  const ph = ids.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT id, invoiceid, invoiceurl, bukku_invoice_id FROM rentalcollection WHERE client_id = ? AND id IN (${ph})`,
    [clientId, ...ids]
  );
  return rows.map((row) => {
    const invId = coalesceAccountingInvoiceId(row);
    return {
      id: row.id,
      invoiceid: invId,
      invoiceurl: buildRentalInvoiceDisplayUrl(row.invoiceurl, invId, bukkuSub)
    };
  });
}

async function insertRentalRecords(clientId, records, staffId = null) {
  invLogRental('START', { clientId, recordCount: Array.isArray(records) ? records.length : 0 });
  if (!clientId || !Array.isArray(records) || records.length === 0) {
    invLogRental('SKIP', { reason: 'empty input' });
    return { ok: true, inserted: 0 };
  }
  const inserted = [];
  for (const rec of records.slice(0, 100)) {
    const tenancyId = rec.tenancy || rec.tenancy_id;
    const typeId = rec.type || rec.type_id;
    const amount = Number(rec.amount);
    if (!typeId || String(typeId).trim() === '') {
      invLogRental('SKIP record', { reason: 'missing type/type_id', tenancyId });
      continue;
    }
    if (!Number.isFinite(amount)) {
      invLogRental('SKIP record', { reason: 'invalid amount', tenancyId, amount: rec.amount });
      continue;
    }
    const dateStr = manualRentalDateInputToMysqlUtcString(rec.date);
    const title = rec.title || 'Manual entry';
    const referenceid = rec.referenceid != null ? String(rec.referenceid) : '';
    const description = rec.description != null ? String(rec.description) : '';

    const tenancyParams = [tenancyId, clientId];
    let tenancySql = 'SELECT id, tenant_id, room_id, client_id FROM tenancy WHERE id = ? AND client_id = ?';
    if (staffId) {
      tenancySql += ' AND (submitby_id = ? OR last_extended_by_id = ?)';
      tenancyParams.push(staffId, staffId);
    }
    tenancySql += ' LIMIT 1';
    const [tenancyRows] = await pool.query(tenancySql, tenancyParams);
    if (!tenancyRows.length) {
      invLogRental('SKIP record', { reason: 'tenancy not found', tenancyId, clientId });
      continue;
    }
    const tenancy = tenancyRows[0];
    const [acctRows] = await pool.query('SELECT id, client_id FROM account WHERE id = ? LIMIT 1', [typeId]);
    if (!isAccountTypeAllowedForManualInsert(typeId, clientId, acctRows[0])) {
      invLogRental('SKIP record', { reason: 'type_id not allowed for this client', typeId, clientId });
      continue;
    }
    const [roomRows] = await pool.query('SELECT property_id FROM roomdetail WHERE id = ? LIMIT 1', [tenancy.room_id]);
    const propertyId = roomRows[0] ? roomRows[0].property_id : null;

    const id = randomUUID();
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    await pool.query(
      // tenant/payment gate + listing depends on rentalcollection.tenancy_id,
      // so we must persist it at insert time.
      `INSERT INTO rentalcollection (id, tenancy_id, client_id, property_id, room_id, tenant_id, type_id, amount, date, title, referenceid, description, ispaid, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [id, tenancyId, clientId, propertyId, tenancy.room_id, tenancy.tenant_id, typeId, amount, dateStr, title, referenceid, description, now, now]
    );
    invLogRental('INSERT rentalcollection OK', {
      rentalcollectionId: id,
      tenancyId,
      tenantId: tenancy.tenant_id,
      typeId,
      amount,
      date: dateStr,
      propertyId,
      roomId: tenancy.room_id
    });
    inserted.push({
      id,
      client_id: clientId,
      property_id: propertyId,
      tenant_id: tenancy.tenant_id,
      type_id: typeId,
      amount,
      date: dateStr,
      title,
      tenancy_id: tenancyId,
      room_id: tenancy.room_id
    });
  }
  let invoicesCreated = 0;
  let invoiceErrors;
  if (inserted.length) {
    invLogRental('CALL createInvoicesForRentalRecords', {
      clientId,
      rows: inserted.length,
      ids: inserted.map((r) => r.id)
    });
    try {
      const inv = await createInvoicesForRentalRecords(clientId, inserted);
      invoicesCreated = inv.created ?? 0;
      invoiceErrors = inv.errors;
      invLogRental('createInvoicesForRentalRecords RESULT', {
        created: invoicesCreated,
        errors: invoiceErrors || null
      });
    } catch (e) {
      invLogRental('createInvoicesForRentalRecords THREW', { message: e?.message, stack: e?.stack });
      invoiceErrors = [e?.message || String(e)];
    }
  } else {
    invLogRental('SKIP createInvoicesForRentalRecords', { reason: 'no rows inserted' });
  }
  const out = {
    ok: true,
    inserted: inserted.length,
    ids: inserted.map((r) => r.id),
    invoicesCreated,
    ...(invoiceErrors && invoiceErrors.length ? { invoiceErrors } : {})
  };
  if (inserted.length) {
    out.insertedRows = await fetchInsertedInvoiceRows(clientId, inserted.map((r) => r.id));
  }
  invLogRental('DONE', out);
  return out;
}

/**
 * Delete rental records by ids. Only rows with client_id = clientId.
 * Voids unpaid accounting invoices (Bukku/Xero/AutoCount/SQL) first, then deletes table rows.
 */
async function deleteRentalRecords(clientId, ids, staffId = null) {
  if (!clientId || !Array.isArray(ids) || ids.length === 0) {
    return { ok: true, deleted: 0 };
  }
  const placeholders = ids.map(() => '?').join(',');
  let scopedIds = ids;
  if (staffId) {
    const [allowedRows] = await pool.query(
      `SELECT r.id
       FROM rentalcollection r
       INNER JOIN tenancy t ON t.id = r.tenancy_id AND t.client_id = r.client_id
       WHERE r.client_id = ? AND r.id IN (${placeholders})
         AND (t.submitby_id = ? OR t.last_extended_by_id = ?)`,
      [clientId, ...ids, staffId, staffId]
    );
    scopedIds = allowedRows.map((x) => x.id);
    if (!scopedIds.length) return { ok: true, deleted: 0 };
  }
  const scopedPlaceholders = scopedIds.map(() => '?').join(',');
  let voidResult;
  try {
    // Pending (unpaid) rows only in UI: void sales invoice in accounting, then delete row.
    voidResult = await voidOrDeleteInvoicesForRentalCollectionIds(clientId, scopedIds, {
      includePaid: false,
      einvoiceCancelReason: 'remove rental line'
    });
  } catch (e) {
    console.warn('[tenantinvoice] voidOrDeleteInvoicesForRentalCollectionIds before delete failed:', e?.message || e);
    return { ok: false, reason: 'VOID_EXCEPTION', deleted: 0, voidErrors: [e?.message || String(e)] };
  }
  if (voidResult?.fatalErrors?.length) {
    return {
      ok: false,
      reason: 'VOID_FAILED',
      deleted: 0,
      voidErrors: voidResult.fatalErrors
    };
  }
  const [result] = await pool.query(
    `DELETE FROM rentalcollection WHERE client_id = ? AND id IN (${scopedPlaceholders})`,
    [clientId, ...scopedIds]
  );
  return { ok: true, deleted: result.affectedRows || 0 };
}

/**
 * Void payment/receipt for paid rental records and mark them unpaid again (pending).
 * With accounting: reverses payment in Xero/Bukku; other integrated providers error as unsupported.
 * Without accounting: clears paid flags locally only.
 */
async function voidRentalPayments(clientId, ids, staffId = null) {
  if (!clientId || !Array.isArray(ids) || ids.length === 0) {
    return { ok: true, voided: 0 };
  }
  const placeholders = ids.map(() => '?').join(',');
  let scopedIds = ids;
  if (staffId) {
    const [allowedRows] = await pool.query(
      `SELECT r.id
       FROM rentalcollection r
       INNER JOIN tenancy t ON t.id = r.tenancy_id AND t.client_id = r.client_id
       WHERE r.client_id = ? AND r.id IN (${placeholders})
         AND (t.submitby_id = ? OR t.last_extended_by_id = ?)`,
      [clientId, ...ids, staffId, staffId]
    );
    scopedIds = allowedRows.map((x) => x.id);
    if (!scopedIds.length) return { ok: true, voided: 0 };
  }
  const scopedPlaceholders = scopedIds.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT id,
            COALESCE(
              NULLIF(TRIM(COALESCE(invoiceid, '')), ''),
              NULLIF(TRIM(COALESCE(bukku_invoice_id, '')), '')
            ) AS accounting_invoice_id,
            NULLIF(TRIM(COALESCE(bukku_payment_id, '')), '') AS accounting_payment_id
     FROM rentalcollection
     WHERE client_id = ? AND id IN (${scopedPlaceholders}) AND ispaid = 1`,
    [clientId, ...scopedIds]
  );
  if (!rows.length) return { ok: true, voided: 0 };

  const resolved = await resolveClientAccounting(clientId);
  const hasAccounting = !!(resolved.ok && resolved.req);
  const provider = hasAccounting ? resolved.provider : null;
  const req = hasAccounting ? resolved.req : null;

  const fatalErrors = [];
  let voided = 0;
  for (const row of rows) {
    const rentalId = String(row.id || '').trim();
    const invoiceId = String(row.accounting_invoice_id || '').trim();
    const paymentId = String(row.accounting_payment_id || '').trim();
    try {
      if (provider === 'xero' && req) {
        if (paymentId) {
          const delRes = await xeroPayment.deletePayment(req, paymentId);
          if (!delRes?.ok) {
            throw new Error(`Reverse payment ${paymentId} failed: ${delRes?.error?.message || delRes?.error || 'unknown error'}`);
          }
        } else if (invoiceId) {
          const where = `Invoice.InvoiceID=guid("${invoiceId}")`;
          const listRes = await xeroPayment.listPayments(req, { where });
          if (!listRes?.ok) {
            throw new Error(`List payment for ${invoiceId} failed: ${listRes?.error?.message || listRes?.error || 'unknown error'}`);
          }
          const payments = Array.isArray(listRes?.data?.Payments) ? listRes.data.Payments : [];
          for (const p of payments) {
            const pid = p?.PaymentID ?? p?.PaymentId;
            if (!pid) continue;
            const delRes = await xeroPayment.deletePayment(req, String(pid));
            if (!delRes?.ok) {
              throw new Error(`Reverse payment ${pid} failed: ${delRes?.error?.message || delRes?.error || 'unknown error'}`);
            }
          }
        } else {
          throw new Error('NO_ACCOUNTING_INVOICE_OR_PAYMENT_ID');
        }
      } else if (provider === 'bukku' && req) {
        if (!paymentId) throw new Error('NO_BUKKU_PAYMENT_ID');
        await reverseBukkuTenantInvoicePayment(req, paymentId);
      } else if (hasAccounting && !['xero', 'bukku'].includes(String(provider || ''))) {
        throw new Error(`UNSUPPORTED_PROVIDER_${String(provider || '').toUpperCase()}`);
      } else {
        console.log('[tenantinvoice] voidRentalPayments local-only', { rentalId, clientId });
      }
      await pool.query(
        `UPDATE rentalcollection
         SET ispaid = 0,
             paidat = NULL,
             receipturl = NULL,
             bukku_payment_id = NULL,
             accounting_receipt_document_number = NULL,
             accounting_receipt_snapshot = NULL,
             updated_at = NOW()
         WHERE id = ? AND client_id = ?`,
        [rentalId, clientId]
      );
      voided += 1;
    } catch (err) {
      fatalErrors.push(`Rental ${rentalId}: ${err?.message || err}`);
      console.warn('[tenantinvoice] voidRentalPayments failed', { rentalId, provider, error: err?.message || err });
    }
  }

  if (fatalErrors.length) {
    return { ok: false, reason: 'VOID_PAYMENT_FAILED', voided, voidErrors: fatalErrors };
  }
  return { ok: true, voided };
}

/**
 * Update one rental record (e.g. mark paid). Only rows with client_id = clientId.
 */
async function updateRentalRecord(clientId, id, payload, staffId = null) {
  if (!clientId || !id) return { ok: false, reason: 'MISSING_ID' };
  const parseBooleanish = (val) => {
    if (typeof val === 'boolean') return val;
    if (typeof val === 'number') return val === 1;
    if (typeof val === 'string') {
      const s = val.trim().toLowerCase();
      if (['1', 'true', 'yes', 'y', 'on'].includes(s)) return true;
      if (['0', 'false', 'no', 'n', 'off', ''].includes(s)) return false;
    }
    return null;
  };
  const updates = [];
  const params = [];
  const isPaidParsed = parseBooleanish(payload.isPaid);
  const willMarkPaid = isPaidParsed === true;
  if (payload.isPaid !== undefined) {
    updates.push('ispaid = ?');
    params.push(isPaidParsed === true ? 1 : 0);
  }
  if (payload.paidAt !== undefined) {
    updates.push('paidat = ?');
    params.push(payload.paidAt instanceof Date ? payload.paidAt : new Date(payload.paidAt));
  }
  if (payload.referenceid !== undefined) {
    updates.push('referenceid = ?');
    params.push(payload.referenceid);
  }
  if (payload.description !== undefined) {
    updates.push('description = ?');
    params.push(payload.description);
  }
  if (updates.length === 0) return { ok: true };
  if (staffId) {
    params.push(id, clientId, staffId, staffId);
  } else {
    params.push(id, clientId);
  }
  const updateSql = staffId
    ? `UPDATE rentalcollection r
       INNER JOIN tenancy t ON t.id = r.tenancy_id AND t.client_id = r.client_id
       SET ${updates.join(', ')}, r.updated_at = NOW()
       WHERE r.id = ? AND r.client_id = ?
         AND (t.submitby_id = ? OR t.last_extended_by_id = ?)`
    : `UPDATE rentalcollection SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ? AND client_id = ?`;
  const [result] = await pool.query(updateSql, params);
  const updated = result.affectedRows || 0;
  console.log('[tenantinvoice] rental-update', {
    id,
    clientId,
    willMarkPaid,
    updated,
    isPaidParsed
  });
  if (updated > 0 && willMarkPaid) {
    try {
      const receiptResult = await createReceiptForPaidRentalCollection([id], {
        source: 'manual',
        method: payload.paymentMethod || null
      });
      console.log('[tenantinvoice] rental-update receipt-result', {
        id,
        ok: !!receiptResult?.ok,
        created: receiptResult?.created ?? 0,
        errors: Array.isArray(receiptResult?.errors) ? receiptResult.errors : []
      });
      if (receiptResult?.errors?.length) {
        console.warn('[tenantinvoice] createReceiptForPaidRentalCollection errors', id, receiptResult.errors);
        return {
          ok: false,
          reason: 'RECEIPT_FAILED',
          updated,
          receiptErrors: receiptResult.errors,
          receipts: receiptResult.receipts
        };
      }
      return { ok: true, updated, receipts: receiptResult.receipts };
    } catch (err) {
      console.warn('[tenantinvoice] createReceiptForPaidRentalCollection failed', err?.message || err);
      return {
        ok: false,
        reason: 'RECEIPT_EXCEPTION',
        updated,
        receiptErrors: [err?.message || String(err)]
      };
    }
  }
  return { ok: true, updated };
}

/**
 * Meter invoice calculation – usage phase and calculation phase (port from Wix backend/query/metercalculation).
 */
function fmtDate(d) {
  if (d == null || (typeof d !== 'string' && typeof d !== 'number' && !(d instanceof Date))) {
    return 'Invalid date';
  }
  const date = d instanceof Date ? d : new Date(d);
  const ts = typeof date.getTime === 'function' ? date.getTime() : NaN;
  if (typeof ts !== 'number' || Number.isNaN(ts)) return 'Invalid date';
  const adjusted = new Date(ts + 8 * 60 * 60 * 1000);
  const day = adjusted.getUTCDate();
  const month = adjusted.getUTCMonth();
  const year = adjusted.getUTCFullYear();
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${day} ${monthNames[month]} ${year}`;
}

async function handleUsagePhase(clientId, { groupMeters, period }) {
  if (!period || (period.start == null && period.end == null)) {
    throw new Error('Missing period.start and period.end for meter calculation');
  }
  const parent = groupMeters.find((m) => m.role === 'parent');
  const peers = groupMeters.filter((m) => m.role === 'peer');
  const children = groupMeters.filter((m) => m.role === 'child');
  const isBrotherGroup =
    !parent && peers.length > 0 && groupMeters[0]?.sharingmode === 'brother';

  const usageSummary = await meterWrapper.getUsageSummary(clientId, {
    meterIds: groupMeters.map((m) => m.meterId),
    start: period.start,
    end: period.end
  });
  const usageMap = {};
  groupMeters.forEach((m) => {
    usageMap[m.meterId] = Number(usageSummary?.children?.[m.meterId] || 0);
  });

  if (isBrotherGroup) {
    let totalUsage = 0;
    let textdetail = `Period: ${fmtDate(period.start)} → ${fmtDate(period.end)}\n--------------------------------\nGroup type: Brother (peer)\nMeters: ${groupMeters.length}\n\nUsage breakdown:\n`;
    groupMeters.forEach((m) => {
      const u = usageMap[m.meterId] || 0;
      totalUsage += u;
      textdetail += `\n${m.title || m.meterId}\nUsage: ${u.toFixed(2)} kWh\nRate: ${m.rate ?? '-'}\nActive: ${m.active !== false}\n`;
    });
    return {
      ok: true,
      phase: 'usage',
      usageSnapshot: {
        start: period.start,
        end: period.end,
        sharingmode: 'brother',
        totalUsage,
        usageMap
      },
      textdetail: textdetail.trim(),
      totalText: `Total usage: ${totalUsage.toFixed(2)} kWh`
    };
  }

  if (!parent) {
    throw new Error('Invalid meter group: parent not found');
  }
  const parentUsage = usageMap[parent.meterId] || 0;
  const activeChildren = children.filter((c) => c.active !== false);
  let childrenUsageSum = 0;
  activeChildren.forEach((c) => {
    childrenUsageSum += usageMap[c.meterId] || 0;
  });
  const sharedUsage =
    parent.sharingmode === 'parent_manual'
      ? parentUsage
      : Math.max(parentUsage - childrenUsageSum, 0);
  let textdetail = `Period: ${fmtDate(period.start)} → ${fmtDate(period.end)}\n--------------------------------\nParent usage: ${parentUsage.toFixed(2)} kWh\nChildren usage sum: ${childrenUsageSum.toFixed(2)} kWh\n\nChild breakdown:\n`;
  activeChildren.forEach((c) => {
    textdetail += `\n${c.title || c.meterId}\nUsage: ${(usageMap[c.meterId] || 0).toFixed(2)} kWh\n`;
  });
  return {
    ok: true,
    phase: 'usage',
    usageSnapshot: {
      start: period.start,
      end: period.end,
      sharingmode: parent.sharingmode,
      parentUsage,
      sharedUsage,
      totalUsage: sharedUsage,
      usageMap
    },
    textdetail: textdetail.trim(),
    totalText: `Shared usage: ${sharedUsage.toFixed(2)} kWh`
  };
}

/**
 * Supported sharingType: percentage | divide_equally | room only (tenancy removed per docs/meter-billing-spec.md).
 */
function handleCalculationPhase({ groupMeters, usageSnapshot, inputAmount, sharingType }) {
  const children = groupMeters.filter((m) => m.role !== 'parent');
  const activeChildren = children.filter((c) => c.active !== false);
  const usageMap = usageSnapshot.usageMap || {};
  let textcalculation = '';
  let formulaText = '';
  const totalText = `Total bill amount: ${Math.round(inputAmount)}`;

  if (sharingType === 'divide_equally') {
    const count = activeChildren.length;
    const eachAmount = count > 0 ? Math.round(inputAmount / count) : 0;
    formulaText = `${Math.round(inputAmount)} ÷ ${count} meter(s)`;
    activeChildren.forEach((c) => {
      textcalculation += `\n${c.title || c.meterId}\nAmount: ${eachAmount}\n`;
    });
  } else if (sharingType === 'percentage') {
    let totalUsage = 0;
    activeChildren.forEach((c) => {
      totalUsage += Number(usageMap[c.meterId] || 0);
    });
    activeChildren.forEach((c) => {
      const usage = Number(usageMap[c.meterId] || 0);
      const ratio = totalUsage > 0 ? usage / totalUsage : 0;
      const amount = Math.round(ratio * inputAmount);
      textcalculation += `\n${c.title || c.meterId}\nUsage ratio: ${(ratio * 100).toFixed(2)}%\nAmount: ${amount}\n`;
      formulaText += `${usage.toFixed(2)} ÷ ${totalUsage.toFixed(2)}\n`;
    });
  } else if (sharingType === 'room') {
    const count = activeChildren.length;
    const eachAmount = count > 0 ? Math.round(inputAmount / count) : 0;
    formulaText = `${Math.round(inputAmount)} ÷ ${count} meter(s)`;
    activeChildren.forEach((c) => {
      textcalculation += `\n${c.title || c.meterId}\nAmount: ${eachAmount}\n`;
    });
  }

  return {
    ok: true,
    phase: 'calculation',
    textcalculation: textcalculation.trim(),
    formulaText: formulaText.trim(),
    totalText
  };
}

async function calculateMeterInvoice(email, params) {
  const ctx = await getAccessContextByEmail(email);
  if (!ctx.ok) throw new Error(ctx.reason || 'ACCESS_DENIED');
  const clientId = ctx.client?.id;
  if (!clientId) throw new Error('NO_CLIENT');

  if (params.mode === 'usage') {
    return handleUsagePhase(clientId, params);
  }
  if (params.mode === 'calculation') {
    return handleCalculationPhase(params);
  }
  throw new Error('Unknown calculation mode');
}

module.exports = {
  getProperties,
  getTypes,
  getTenancyCleaningPriceHint,
  getRentalList,
  getTenancyList,
  getMeterGroups,
  insertRentalRecords,
  deleteRentalRecords,
  voidRentalPayments,
  updateRentalRecord,
  calculateMeterInvoice,
  getTopupAircondAccountId
};
