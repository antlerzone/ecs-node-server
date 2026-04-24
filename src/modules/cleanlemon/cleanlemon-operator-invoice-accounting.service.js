/**
 * Operator invoice actions → Bukku / Xero (aligned with Coliving tenantinvoice + rentalcollection-invoice).
 * Bukku customer for each invoice: cln_clientdetail.account (per operator + provider) or cln_client_operator.crm_json;
 * cln_account_client mappings for lines + Bank/Cash.
 */

const pool = require('../../config/db');
const { resolveClnOperatordetailTable } = require('../../config/clnOperatordetailTable');
const clnInt = require('./cleanlemon-integration.service');
const { buildBukkuSalesInvoicePublicUrl } = require('../bukku/lib/bukkuSalesInvoicePublicUrl');
const bukkuInvoice = require('../bukku/wrappers/invoice.wrapper');
const bukkuPayment = require('../bukku/wrappers/payment.wrapper');
const xeroInvoice = require('../xero/wrappers/invoice.wrapper');
const xeroPayment = require('../xero/wrappers/payment.wrapper');
const { resolveXeroAccountCode } = require('../xero/lib/accountCodeResolver');
const { getXeroInvoiceCurrencyForClnOperatorId } = require('../xero/lib/invoiceCurrency');
const { utcDatetimeFromDbToMalaysiaDateOnly } = require('../../utils/dateMalaysia');
const { resolveBukkuCreateInvoiceMyInvoisActionForClnOperator } = require('../einvoice/einvoice.service');

const BANK_ACCOUNT_TITLE = 'Bank';
const CASH_ACCOUNT_TITLE = 'Cash';
const SALES_INCOME_TITLE = 'Sales Income';

async function databaseHasColumn(tableName, columnName) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [tableName, columnName]
  );
  return Number(row?.n) > 0;
}

async function companyTableName() {
  return resolveClnOperatordetailTable();
}

async function getActiveProvider(operatorId) {
  await clnInt.ensureClnOperatorIntegrationTable();
  const [rows] = await pool.query(
    `SELECT provider FROM cln_operator_integration
     WHERE operator_id = ? AND \`key\` = 'addonAccount' AND enabled = 1
     ORDER BY CASE provider WHEN 'bukku' THEN 0 WHEN 'xero' THEN 1 ELSE 2 END
     LIMIT 1`,
    [String(operatorId)]
  );
  const p = rows[0]?.provider;
  return p ? String(p).trim().toLowerCase() : null;
}

function bukkuReq(operatorId, creds) {
  return {
    client: {
      id: String(operatorId),
      bukku_secretKey: String(creds.token || '').trim(),
      bukku_subdomain: String(creds.subdomain || '').trim()
    }
  };
}

function xeroReq(operatorId) {
  return { cleanlemonOperatorId: String(operatorId) };
}

function safeJsonArray(raw) {
  if (raw == null || raw === '') return [];
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function safeJsonObject(raw) {
  if (raw == null || raw === '') return {};
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** Bukku POST /sales/payments — receipt doc no in `transaction.number` (same family as sales invoices). */
function bukkuPaymentReceiptNumberFromTx(tx) {
  const t = tx && typeof tx === 'object' ? tx : {};
  const n = t.number != null && String(t.number).trim() !== '' ? String(t.number).trim() : '';
  const d = t.document_number != null && String(t.document_number).trim() !== '' ? String(t.document_number).trim() : '';
  return n || d || null;
}

/**
 * @param {string} operatorId - cln_operatordetail.id (matches account[].clientId on clientdetail)
 * @param {string} clientdetailId - cln_clientdetail.id (cln_client_invoice.client_id)
 */
async function getBukkuContactId(operatorId, clientdetailId) {
  const oid = String(operatorId || '').trim();
  const cid = String(clientdetailId || '').trim();
  if (!oid || !cid) return null;

  const [dRows] = await pool.query('SELECT account FROM cln_clientdetail WHERE id = ? LIMIT 1', [cid]);
  const account = safeJsonArray(dRows[0]?.account);
  const hit = account.find(
    (a) => String(a?.clientId || '').trim() === oid && String(a?.provider || '').toLowerCase() === 'bukku'
  );
  const fromAccount = hit?.id || hit?.contactId;
  if (fromAccount != null && String(fromAccount).trim() !== '') return String(fromAccount).trim();

  try {
    const [coRows] = await pool.query(
      'SELECT crm_json FROM cln_client_operator WHERE operator_id = ? AND clientdetail_id = ? LIMIT 1',
      [oid, cid]
    );
    const crm = safeJsonObject(coRows[0]?.crm_json);
    const prov = String(crm.accountingProvider || '').toLowerCase();
    const accId = crm.accountingContactId;
    if (accId != null && String(accId).trim() !== '' && (!prov || prov === 'bukku')) {
      return String(accId).trim();
    }
  } catch {
    // very old DBs without cln_client_operator
  }

  return null;
}

async function resolveMappedLine(operatorId, productTitle, system) {
  const title = String(productTitle || '').trim();
  if (!title) return null;
  const oid = String(operatorId);
  const [rows] = await pool.query(
    `SELECT ac.external_account, ac.external_product, a.is_product AS isProduct
     FROM cln_account a
     INNER JOIN cln_account_client ac ON ac.account_id = a.id AND ac.operator_id = ? AND ac.\`system\` = ?
     WHERE TRIM(a.title) = ?
     LIMIT 1`,
    [oid, system, title]
  );
  if (!rows.length) return null;
  const r = rows[0];
  let accountId =
    r.external_account != null && String(r.external_account).trim() !== '' ? String(r.external_account).trim() : null;
  const productId =
    r.external_product != null && String(r.external_product).trim() !== '' ? String(r.external_product).trim() : null;
  const isProduct = Number(r.isProduct) === 1;
  /**
   * Product lines (Other, General Cleaning, …) often only store Bukku `product_id`; GL is Sales Income in Bukku.
   * `cln_account_client.external_account` is then empty — still need income account id for form_items.account_id.
   */
  if (isProduct && productId && !accountId && title !== SALES_INCOME_TITLE) {
    const [[inc]] = await pool.query(
      `SELECT ac.external_account
       FROM cln_account a
       INNER JOIN cln_account_client ac ON ac.account_id = a.id AND ac.operator_id = ? AND ac.\`system\` = ?
       WHERE TRIM(a.title) = ?
       LIMIT 1`,
      [oid, system, SALES_INCOME_TITLE]
    );
    const ext = inc?.external_account != null ? String(inc.external_account).trim() : '';
    if (ext) accountId = ext;
  }
  return {
    accountId,
    productId,
    isProduct
  };
}

/** When a service line (e.g. "Other") has no Bukku/Xero row yet, book to mapped Sales Income GL. */
async function resolveMappedLineOrSalesIncomeFallback(operatorId, productTitle, system) {
  const map = await resolveMappedLine(operatorId, productTitle, system);
  if (map?.accountId) return map;
  const p = String(productTitle || '').trim();
  if (!p || p === BANK_ACCOUNT_TITLE || p === CASH_ACCOUNT_TITLE) return null;
  if (p === SALES_INCOME_TITLE) return null;
  return resolveMappedLine(operatorId, SALES_INCOME_TITLE, system);
}

async function resolveDepositAccountId(operatorId, method, system) {
  const want = String(method || 'bank').toLowerCase() === 'cash' ? CASH_ACCOUNT_TITLE : BANK_ACCOUNT_TITLE;
  const [rows] = await pool.query(
    `SELECT ac.external_account
     FROM cln_account a
     INNER JOIN cln_account_client ac ON ac.account_id = a.id AND ac.operator_id = ? AND ac.\`system\` = ?
     WHERE TRIM(a.title) = ?
     LIMIT 1`,
    [String(operatorId), system, want]
  );
  const ext = rows[0]?.external_account != null ? String(rows[0].external_account).trim() : '';
  if (ext && /^\d+$/.test(ext)) return ext;
  const envKey = want === CASH_ACCOUNT_TITLE ? 'CLEANLEMON_BUKKU_CASH_ACCOUNT_ID' : 'CLEANLEMON_BUKKU_BANK_ACCOUNT_ID';
  const fallback = (process.env[envKey] || '').trim();
  return fallback || null;
}

function ymd(d) {
  if (!d) return new Date().toISOString().slice(0, 10);
  const s = String(d).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  try {
    return utcDatetimeFromDbToMalaysiaDateOnly(new Date(d));
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function formatProviderError(err) {
  if (err == null) return '';
  if (typeof err === 'string') return err;
  return err.message || JSON.stringify(err);
}

/** Flatten Laravel-style `errors` from Bukku 422 bodies for portal toasts. */
function summarizeBukkuValidationErrors(res) {
  const body = res?.error;
  if (!body || typeof body !== 'object') return '';
  const errs = body.errors;
  if (!errs || typeof errs !== 'object') {
    let m = body.message != null ? String(body.message).trim() : '';
    const ex = body.exception != null ? String(body.exception).trim() : '';
    if (ex && isUnhelpfulProviderMessage(m)) {
      const shortEx = ex.includes('\\') ? ex.split('\\').pop() : ex;
      if (shortEx) m = shortEx;
    }
    return m;
  }
  const parts = [];
  for (const v of Object.values(errs)) {
    if (Array.isArray(v)) for (const x of v) parts.push(String(x || '').trim());
    else parts.push(String(v || '').trim());
  }
  return parts.filter(Boolean).join(' ');
}

/** Bukku/Laravel sometimes returns `{ message: "Server Error" }` with no field errors — treat as non-actionable copy. */
function isUnhelpfulProviderMessage(s) {
  const t = String(s || '').trim().toLowerCase();
  if (!t) return true;
  const bad = new Set([
    'server error',
    'internal server error',
    'error',
    'something went wrong',
    'whoops, something went wrong.',
    'whoops, something went wrong'
  ]);
  return bad.has(t);
}

function truncateJsonForPortal(v, max = 900) {
  try {
    const raw = typeof v === 'string' ? v : JSON.stringify(v);
    const s = String(raw || '');
    return s.length > max ? `${s.slice(0, max)}…` : s;
  } catch {
    return String(v || '').slice(0, max);
  }
}

/** Strip our portal `Hint:` suffix before matching Bukku validation phrases (hint text contained "I'm selling" and falsely triggered product_id strip + second POST). */
function detailForBukkuProductSellingMatch(detail) {
  const s = String(detail || '');
  const m = s.match(/\sHint:\s/i);
  if (m && m.index >= 0) return s.slice(0, m.index).trim();
  return s.trim();
}

/**
 * Stable `{ code, reason, detail }` when POST /sales/invoices fails (incl. generic HTML/500 bodies).
 * `code` is always `BUKKU_CREATE_FAILED` except HTTP-specific `reason` for logs/UI.
 */
function bukkuCreateInvoiceFailureFromRes(res) {
  const httpStatus = Number(res?.status) || 0;
  const validation = summarizeBukkuValidationErrors(res);
  if (validation && !isUnhelpfulProviderMessage(validation)) {
    const full = validation.slice(0, 1200);
    return {
      ok: false,
      code: 'BUKKU_CREATE_FAILED',
      reason: full.slice(0, 400),
      ...(full.length > 400 ? { detail: full } : {})
    };
  }
  const pe = formatProviderError(res?.error);
  if (pe && !isUnhelpfulProviderMessage(pe)) {
    return {
      ok: false,
      code: 'BUKKU_CREATE_FAILED',
      reason: pe.slice(0, 400),
      ...(validation && validation !== pe ? { detail: `${validation.slice(0, 200)} | ${pe}`.slice(0, 1200) } : {})
    };
  }
  const raw = truncateJsonForPortal(res?.error, 900);
  const reason = httpStatus ? `BUKKU_API_HTTP_${httpStatus}` : 'BUKKU_CREATE_FAILED';
  const detailParts = [];
  if (validation) detailParts.push(validation);
  if (raw) detailParts.push(`Response: ${raw}`);
  let detail =
    detailParts.filter(Boolean).join(' | ').slice(0, 1200) ||
    'Bukku did not return a clear error. Check Bukku / MyInvois status or try again later.';
  if (httpStatus === 500) {
    const hint =
      ' Hint: In Bukku, try the same contact, line amounts, and GL rows manually; confirm Accounting mappings, catalog sell settings for mapped products, and MyInvois-ready contact when e-invoice is on.';
    detail = `${detail}${hint}`.slice(0, 1200);
  }
  return { ok: false, code: 'BUKKU_CREATE_FAILED', reason, detail };
}

/** Coliving `createCreditInvoice` uses the same Y-m-d for `date` and `term_items[0].date` (single 100% term). */
function bukkuCreditTermItemsColivingStyle(issueYmd) {
  return [{ date: issueYmd, payment_due: '100%', description: 'Due' }];
}

/**
 * POST /sales/invoices once for create: `myinvois_action` only when operator e-invoice is on and contact is ready + complete.
 * Plain invoices (no `myinvois_action`): Bukku often returns HTTP 500 on POST with `status: ready` alone; runtime log showed
 * same body succeeds with `status: draft` — so create as draft, then PATCH to `ready` (one invoice, not a second POST create).
 */
async function bukkuCreateOperatorInvoiceWithFallbacks(req, payloadIn, omitOpts) {
  const payload = { ...payloadIn };
  try {
    const myInvois = await resolveBukkuCreateInvoiceMyInvoisActionForClnOperator(req, Number(payload.contact_id));
    if (myInvois.myinvois_action) payload.myinvois_action = myInvois.myinvois_action;
    else delete payload.myinvois_action;
  } catch {
    delete payload.myinvois_action;
  }

  const plainNoMyInvois = !payload.myinvois_action;
  const createStatus = plainNoMyInvois ? 'draft' : 'ready';
  const payloadCreate = { ...payload, status: createStatus };

  let res = await bukkuInvoice.createinvoice(req, payloadCreate, omitOpts);
  let parsed = bukkuInvoice.parseBukkuSalesInvoiceCreateResponse(res);

  let patchRes = null;
  if (parsed.invoiceId && plainNoMyInvois && createStatus === 'draft') {
    patchRes = await bukkuInvoice.updateinvoicestatus(req, parsed.invoiceId, { status: 'ready' });
    if (!patchRes || patchRes.ok === false) {
      const fail = bukkuCreateInvoiceFailureFromRes(patchRes);
      fail.detail = `${String(fail.detail || fail.reason || '')} (Bukku draft id ${parsed.invoiceId}: finalize in Bukku or fix validation.)`.slice(
        0,
        1200
      );
      return fail;
    }
    const afterReady = bukkuInvoice.parseBukkuSalesInvoiceCreateResponse(patchRes);
    if (afterReady.documentNumber) parsed = { ...parsed, documentNumber: afterReady.documentNumber };
    if (afterReady.shortLink) parsed = { ...parsed, shortLink: afterReady.shortLink };
  }

  if (!parsed.invoiceId) return bukkuCreateInvoiceFailureFromRes(res);
  return { ok: true, parsed };
}

async function reverseBukkuPayment(req, paymentId) {
  const readRes = await bukkuPayment.getPayment(req, paymentId);
  const st = readRes?.data?.transaction?.status ?? readRes?.data?.status;
  if (readRes?.ok && st === 'void') return { ok: true };
  if (readRes?.ok && st === 'draft') {
    const delRes = await bukkuPayment.deletePayment(req, paymentId);
    if (!delRes?.ok) throw new Error(formatProviderError(delRes?.error) || 'BUKKU_DELETE_PAYMENT_FAILED');
    return { ok: true };
  }
  const patchRes = await bukkuPayment.updatePaymentStatus(req, paymentId, {
    status: 'void',
    void_reason: 'Void payment from Cleanlemons operator invoice'
  });
  if (patchRes?.ok) return { ok: true };
  throw new Error(formatProviderError(patchRes?.error) || 'BUKKU_VOID_PAYMENT_FAILED');
}

/**
 * After DB row exists: create sales invoice in accounting; update cln_client_invoice.invoice_number, transaction_id, pdf_url.
 */
async function createAccountingInvoiceForOperator(operatorId, invoiceDbId, input) {
  const provider = await getActiveProvider(operatorId);
  if (!provider || !['bukku', 'xero'].includes(provider)) {
    return { ok: true, skipped: true, reason: 'no_accounting' };
  }

  const clientId = String(input.clientId || '').trim();
  if (!clientId) return { ok: false, reason: 'MISSING_CLIENT_ID' };

  const lines = Array.isArray(input.lines) ? input.lines : [];
  const issue = ymd(input.issueDate);
  const due = ymd(input.dueDate || input.issueDate);

  if (provider === 'bukku') {
    const creds = await clnInt.getBukkuCredentials(operatorId);
    if (!creds?.token || !creds?.subdomain) return { ok: false, reason: 'BUKKU_NOT_CONNECTED' };
    /** Same as Coliving `createCreditInvoice` → `getClientCurrencyCode(operatordetail.id)`; Cleanlemons uses `cln_operatordetail.currency`. */
    const currencyCode = await getXeroInvoiceCurrencyForClnOperatorId(operatorId);
    const req = bukkuReq(operatorId, creds);
    const bukkuCid = await getBukkuContactId(operatorId, clientId);
    if (!bukkuCid) {
      return {
        ok: false,
        reason: 'BUKKU_CONTACT_MISSING',
        detail: 'In Contacts, set Account ID for this B2B client (or Sync Contact), then Save.',
      };
    }
    const formItems = [];
    if (lines.length) {
      for (const ln of lines) {
        const amt = Number(ln.qty || 0) * Number(ln.rate || 0);
        if (amt <= 0) continue;
        const map = await resolveMappedLineOrSalesIncomeFallback(operatorId, ln.product, 'bukku');
        if (!map?.accountId) {
          return {
            ok: false,
            reason: 'ACCOUNT_MAPPING_MISSING',
            detail: `Product: ${ln.product} (map the line or Sales Income in Accounting)`,
          };
        }
        const desc = String(ln.description || ln.product || 'Line').slice(0, 2000);
        const item = {
          account_id: Number(map.accountId),
          description: desc,
          unit_price: Number(amt.toFixed(2)),
          quantity: 1
        };
        const pid = map.productId != null ? String(map.productId).trim() : '';
        if (pid && /^\d+$/.test(pid)) {
          const n = Number(pid);
          if (Number.isFinite(n) && n > 0) item.product_id = n;
        }
        formItems.push(item);
      }
    } else {
      const amt = Number(input.amount || 0);
      if (amt <= 0) return { ok: false, reason: 'INVALID_AMOUNT' };
      const map = await resolveMappedLine(operatorId, SALES_INCOME_TITLE, 'bukku');
      if (!map?.accountId) {
        return { ok: false, reason: 'ACCOUNT_MAPPING_MISSING', detail: 'Map Sales Income in Accounting' };
      }
      const oneLine = {
        account_id: Number(map.accountId),
        description: String(input.description || 'Invoice').slice(0, 2000),
        unit_price: Number(Number(amt).toFixed(2)),
        quantity: 1
      };
      const pid0 = map.productId != null ? String(map.productId).trim() : '';
      if (pid0 && /^\d+$/.test(pid0)) {
        const n0 = Number(pid0);
        if (Number.isFinite(n0) && n0 > 0) oneLine.product_id = n0;
      }
      formItems.push(oneLine);
    }
    if (!formItems.length) return { ok: false, reason: 'NO_LINE_ITEMS' };

    const payload = {
      payment_mode: 'credit',
      contact_id: Number(bukkuCid),
      date: issue,
      currency_code: currencyCode,
      exchange_rate: 1,
      tax_mode: 'exclusive',
      form_items: formItems,
      term_items: bukkuCreditTermItemsColivingStyle(issue),
      status: 'ready'
    };
    let created = await bukkuCreateOperatorInvoiceWithFallbacks(req, payload, {});
    if (!created.ok) {
      const errText = `${String(created.reason || '')} ${detailForBukkuProductSellingMatch(created.detail)}`;
      const productSellingBlocked =
        /not available for sale|I['\u2019]m Selling|product is not available|selected product|sale information/i.test(
          errText
        );
      const hadProductIds =
        Array.isArray(payload.form_items) &&
        payload.form_items.some((f) => f && (f.product_id != null || f.product_unit_id != null));
      /** Do not retry on generic HTTP 500 — Bukku may still create the invoice; retry caused duplicate IVs. */
      if (hadProductIds && productSellingBlocked) {
        const payloadNoPid = {
          ...payload,
          form_items: payload.form_items.map((f) => {
            if (!f || typeof f !== 'object') return f;
            const row = { ...f };
            delete row.product_id;
            delete row.product_unit_id;
            return row;
          }),
        };
        try {
          console.warn(
            '[cleanlemon] operator invoice: Bukku rejected product line; retry once without product_id'
          );
        } catch {
          /* ignore */
        }
        created = await bukkuCreateOperatorInvoiceWithFallbacks(req, payloadNoPid, {});
      }
    }
    if (!created.ok) return created;
    const { parsed } = created;
    const sub = String(creds.subdomain || '').trim();
    const pdfUrl = parsed.shortLink || buildBukkuSalesInvoicePublicUrl(sub, parsed.invoiceId);
    const accountingMeta = {
      businessTimeZone: 'Asia/Kuala_Lumpur',
      recordedAt: new Date().toISOString(),
      provider: 'bukku',
      cleanlemonInvoiceId: String(invoiceDbId),
      portalDraftInvoiceNo:
        input?.invoiceNo != null && String(input.invoiceNo).trim() !== '' ? String(input.invoiceNo).trim() : null,
      bukku: {
        transactionId: String(parsed.invoiceId),
        documentNumber: parsed.documentNumber != null ? String(parsed.documentNumber) : null,
        shortLink: pdfUrl != null ? String(pdfUrl).trim() : null,
        subdomain: sub || null,
        currencyCode: currencyCode || null
      }
    };
    const metaJson = JSON.stringify(accountingMeta);
    const hasMetaCol = await databaseHasColumn('cln_client_invoice', 'accounting_meta_json');
    if (hasMetaCol) {
      await pool.query(
        `UPDATE cln_client_invoice
         SET invoice_number = COALESCE(?, invoice_number),
             transaction_id = ?,
             pdf_url = COALESCE(?, pdf_url),
             accounting_meta_json = ?,
             updated_at = NOW(3)
         WHERE id = ?`,
        [parsed.documentNumber || null, String(parsed.invoiceId), pdfUrl, metaJson, String(invoiceDbId)]
      );
    } else {
      await pool.query(
        `UPDATE cln_client_invoice
         SET invoice_number = COALESCE(?, invoice_number),
             transaction_id = ?,
             pdf_url = COALESCE(?, pdf_url),
             updated_at = NOW(3)
         WHERE id = ?`,
        [parsed.documentNumber || null, String(parsed.invoiceId), pdfUrl, String(invoiceDbId)]
      );
    }
    return {
      ok: true,
      accountingDocumentNumber: parsed.documentNumber,
      provider: 'bukku',
      accountingMeta,
      ...(pdfUrl ? { pdfUrl: String(pdfUrl).trim() } : {})
    };
  }

  if (provider === 'xero') {
    const req = xeroReq(operatorId);
    const ct = await companyTableName();
    const [[co]] = await pool.query(`SELECT name FROM \`${ct}\` WHERE id = ? LIMIT 1`, [clientId]);
    const Contact = { Name: String(input.clientName || co?.name || 'Customer').slice(0, 255) };

    const lineItems = [];
    if (lines.length) {
      for (const ln of lines) {
        const amt = Number(ln.qty || 0) * Number(ln.rate || 0);
        if (amt <= 0) continue;
        const map = await resolveMappedLineOrSalesIncomeFallback(operatorId, ln.product, 'xero');
        if (!map?.accountId) {
          return {
            ok: false,
            reason: 'ACCOUNT_MAPPING_MISSING',
            detail: `Product: ${ln.product} (map the line or Sales Income in Accounting)`,
          };
        }
        const code = await resolveXeroAccountCode(req, map.accountId);
        if (!code) return { ok: false, reason: 'XERO_ACCOUNT_CODE_REQUIRED', detail: map.accountId };
        lineItems.push({
          Description: String(ln.description || ln.product || '').slice(0, 4000),
          Quantity: 1,
          UnitAmount: Number(amt.toFixed(2)),
          AccountCode: code
        });
      }
    } else {
      const amt = Number(input.amount || 0);
      const map = await resolveMappedLine(operatorId, SALES_INCOME_TITLE, 'xero');
      if (!map?.accountId) return { ok: false, reason: 'ACCOUNT_MAPPING_MISSING' };
      const code = await resolveXeroAccountCode(req, map.accountId);
      if (!code) return { ok: false, reason: 'XERO_ACCOUNT_CODE_REQUIRED' };
      lineItems.push({
        Description: String(input.description || 'Invoice').slice(0, 4000),
        Quantity: 1,
        UnitAmount: amt,
        AccountCode: code
      });
    }
    const invoiceCurrency = await getXeroInvoiceCurrencyForClnOperatorId(operatorId);
    const payload = {
      Type: 'ACCREC',
      Contact,
      CurrencyCode: invoiceCurrency,
      Date: issue,
      DueDate: due,
      LineItems: lineItems,
      Status: 'AUTHORISED'
    };
    const res = await xeroInvoice.create(req, payload);
    const inv = res?.data?.Invoices?.[0] ?? res?.Invoices?.[0];
    const invId = inv?.InvoiceID ?? inv?.InvoiceId;
    if (!invId) return { ok: false, reason: formatProviderError(res?.error) || 'XERO_CREATE_FAILED' };
    let docNo =
      inv?.InvoiceNumber != null && String(inv.InvoiceNumber).trim() !== '' ? String(inv.InvoiceNumber).trim() : null;
    if (!docNo) {
      const readRes = await xeroInvoice.read(req, invId);
      const inv2 = readRes?.data?.Invoices?.[0] ?? readRes?.Invoices?.[0];
      docNo =
        inv2?.InvoiceNumber != null && String(inv2.InvoiceNumber).trim() !== ''
          ? String(inv2.InvoiceNumber).trim()
          : null;
    }
    let pdfUrl = null;
    const onlineRes = await xeroInvoice.getOnlineInvoiceUrl(req, String(invId));
    if (onlineRes?.ok && onlineRes.url != null && String(onlineRes.url).trim() !== '') {
      pdfUrl = String(onlineRes.url).trim();
    }
    const accountingMeta = {
      businessTimeZone: 'Asia/Kuala_Lumpur',
      recordedAt: new Date().toISOString(),
      provider: 'xero',
      cleanlemonInvoiceId: String(invoiceDbId),
      portalDraftInvoiceNo:
        input?.invoiceNo != null && String(input.invoiceNo).trim() !== '' ? String(input.invoiceNo).trim() : null,
      xero: {
        invoiceId: String(invId),
        invoiceNumber: docNo || null,
        ...(pdfUrl ? { onlineInvoiceUrl: pdfUrl } : {}),
      },
    };
    const metaJson = JSON.stringify(accountingMeta);
    const hasMetaCol = await databaseHasColumn('cln_client_invoice', 'accounting_meta_json');
    const hasPdfCol = await databaseHasColumn('cln_client_invoice', 'pdf_url');
    const pdfArg = pdfUrl || null;
    if (hasMetaCol) {
      if (hasPdfCol) {
        await pool.query(
          `UPDATE cln_client_invoice
           SET invoice_number = COALESCE(?, invoice_number),
               transaction_id = ?,
               pdf_url = COALESCE(?, pdf_url),
               accounting_meta_json = ?,
               updated_at = NOW(3)
           WHERE id = ?`,
          [docNo, String(invId), pdfArg, metaJson, String(invoiceDbId)]
        );
      } else {
        await pool.query(
          `UPDATE cln_client_invoice
           SET invoice_number = COALESCE(?, invoice_number),
               transaction_id = ?,
               accounting_meta_json = ?,
               updated_at = NOW(3)
           WHERE id = ?`,
          [docNo, String(invId), metaJson, String(invoiceDbId)]
        );
      }
    } else if (hasPdfCol) {
      await pool.query(
        `UPDATE cln_client_invoice
         SET invoice_number = COALESCE(?, invoice_number),
             transaction_id = ?,
             pdf_url = COALESCE(?, pdf_url),
             updated_at = NOW(3)
         WHERE id = ?`,
        [docNo, String(invId), pdfArg, String(invoiceDbId)]
      );
    } else {
      await pool.query(
        `UPDATE cln_client_invoice
         SET invoice_number = COALESCE(?, invoice_number),
             transaction_id = ?,
             updated_at = NOW(3)
         WHERE id = ?`,
        [docNo, String(invId), String(invoiceDbId)]
      );
    }
    return {
      ok: true,
      accountingDocumentNumber: docNo,
      provider: 'xero',
      accountingMeta,
      ...(pdfUrl ? { pdfUrl } : {}),
    };
  }

  return { ok: true, skipped: true };
}

/**
 * Record payment in accounting + cln_client_payment row.
 */
async function markPaidAccountingForOperator(operatorId, invoiceDbId, payload) {
  const hasInvOp = await databaseHasColumn('cln_client_invoice', 'operator_id');
  const hasPayOp = await databaseHasColumn('cln_client_payment', 'operator_id');
  const invCols = hasInvOp
    ? 'id, client_id, amount, transaction_id, payment_received, operator_id'
    : 'id, client_id, amount, transaction_id, payment_received';
  const [[inv]] = await pool.query(`SELECT ${invCols} FROM cln_client_invoice WHERE id = ? LIMIT 1`, [
    String(invoiceDbId),
  ]);
  if (!inv) return { ok: false, reason: 'INVOICE_NOT_FOUND' };
  const paymentOperatorId = String(
    (hasInvOp && inv.operator_id != null ? inv.operator_id : '') || operatorId || ''
  ).trim();
  /** Prefer invoice row — JWT / demo may send placeholder; integration is keyed by real operator id. */
  const effectiveOperatorId = paymentOperatorId || String(operatorId || '').trim();
  const provider = await getActiveProvider(effectiveOperatorId);
  if (!provider || !['bukku', 'xero'].includes(provider)) {
    return { ok: true, skipped: true };
  }
  const acctInvoiceId = inv.transaction_id != null ? String(inv.transaction_id).trim() : '';
  if (!acctInvoiceId) return { ok: false, reason: 'NO_ACCOUNTING_INVOICE_ID' };

  const amount = Number(inv.amount || 0);
  const payDate = ymd(payload.paymentDate);
  const method = String(payload.paymentMethod || 'bank').toLowerCase() === 'cash' ? 'cash' : 'bank';

  if (provider === 'bukku') {
    const creds = await clnInt.getBukkuCredentials(effectiveOperatorId);
    if (!creds?.token || !creds?.subdomain) return { ok: false, reason: 'BUKKU_NOT_CONNECTED' };
    const currencyCode = await getXeroInvoiceCurrencyForClnOperatorId(effectiveOperatorId);
    const req = bukkuReq(effectiveOperatorId, creds);
    const bukkuCid = await getBukkuContactId(paymentOperatorId, inv.client_id);
    if (!bukkuCid) return { ok: false, reason: 'BUKKU_CONTACT_MISSING' };
    const bankAid = await resolveDepositAccountId(effectiveOperatorId, method, 'bukku');
    if (!bankAid) {
      return { ok: false, reason: 'BUKKU_BANK_ACCOUNT_MAPPING_MISSING', detail: 'Map Bank/Cash in Accounting or set env' };
    }
    const payBody = {
      contact_id: Number(bukkuCid),
      date: payDate,
      currency_code: currencyCode,
      exchange_rate: 1,
      amount,
      link_items: [{ target_transaction_id: Number(acctInvoiceId), apply_amount: amount }],
      deposit_items: [{ account_id: Number(bankAid), amount }],
      status: 'ready'
    };
    const payRes = await bukkuPayment.createPayment(req, payBody);
    if (!payRes?.ok) return { ok: false, reason: formatProviderError(payRes?.error) || 'BUKKU_PAYMENT_FAILED' };
    const tx = payRes?.data?.transaction || payRes?.data;
    const paymentId = tx?.id != null ? String(tx.id) : null;
    const receiptUrl = tx?.short_link != null ? String(tx.short_link).trim() : null;
    const receiptNumber = bukkuPaymentReceiptNumberFromTx(tx);
    await pool.query('DELETE FROM cln_client_payment WHERE invoice_id = ?', [String(invoiceDbId)]);
    const { randomUUID } = require('crypto');
    if (hasPayOp) {
      await pool.query(
        `INSERT INTO cln_client_payment (id, client_id, operator_id, receipt_number, amount, payment_date, receipt_url, transaction_id, invoice_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
        [randomUUID(), inv.client_id, paymentOperatorId || null, receiptNumber, amount, payDate, receiptUrl, paymentId, invoiceDbId]
      );
    } else {
      await pool.query(
        `INSERT INTO cln_client_payment (id, client_id, receipt_number, amount, payment_date, receipt_url, transaction_id, invoice_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
        [randomUUID(), inv.client_id, receiptNumber, amount, payDate, receiptUrl, paymentId, invoiceDbId]
      );
    }
    return { ok: true, paymentId };
  }

  if (provider === 'xero') {
    const req = xeroReq(effectiveOperatorId);
    const dest = await resolveDepositAccountId(effectiveOperatorId, method, 'xero');
    let paymentAccountCode = dest ? await resolveXeroAccountCode(req, dest) : '';
    if (!paymentAccountCode) {
      paymentAccountCode = (process.env.XERO_DEFAULT_BANK_ACCOUNT_CODE || '').trim();
    }
    if (!paymentAccountCode) return { ok: false, reason: 'XERO_PAYMENT_ACCOUNT_MISSING' };
    const payRes = await xeroPayment.createPayment(req, {
      Invoice: { InvoiceID: String(acctInvoiceId) },
      Account: { Code: paymentAccountCode },
      Date: payDate,
      Amount: amount,
      Reference: 'Operator invoice'
    });
    if (!payRes?.ok) return { ok: false, reason: formatProviderError(payRes?.error) || 'XERO_PAYMENT_FAILED' };
    const payment = payRes?.data?.Payments?.[0] ?? payRes?.Payments?.[0];
    const paymentId = payment?.PaymentID ?? payment?.PaymentId;
    await pool.query('DELETE FROM cln_client_payment WHERE invoice_id = ?', [String(invoiceDbId)]);
    const { randomUUID: ru } = require('crypto');
    if (hasPayOp) {
      await pool.query(
        `INSERT INTO cln_client_payment (id, client_id, operator_id, amount, payment_date, transaction_id, invoice_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
        [ru(), inv.client_id, paymentOperatorId || null, amount, payDate, paymentId ? String(paymentId) : null, invoiceDbId]
      );
    } else {
      await pool.query(
        `INSERT INTO cln_client_payment (id, client_id, amount, payment_date, transaction_id, invoice_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
        [ru(), inv.client_id, amount, payDate, paymentId ? String(paymentId) : null, invoiceDbId]
      );
    }
    return { ok: true, paymentId };
  }

  return { ok: true, skipped: true };
}

async function voidPaymentAccountingForOperator(operatorId, invoiceDbId) {
  const hasInvOp = await databaseHasColumn('cln_client_invoice', 'operator_id');
  let effectiveOperatorId = String(operatorId || '').trim();
  if (hasInvOp) {
    const [[invRow]] = await pool.query(
      'SELECT operator_id FROM cln_client_invoice WHERE id = ? LIMIT 1',
      [String(invoiceDbId)]
    );
    const oid = invRow?.operator_id != null ? String(invRow.operator_id).trim() : '';
    if (oid) effectiveOperatorId = oid;
  }
  const provider = await getActiveProvider(effectiveOperatorId);
  if (!provider || !['bukku', 'xero'].includes(provider)) return { ok: true, skipped: true };

  const [[pay]] = await pool.query(
    'SELECT transaction_id FROM cln_client_payment WHERE invoice_id = ? ORDER BY updated_at DESC LIMIT 1',
    [String(invoiceDbId)]
  );
  const paymentProvId = pay?.transaction_id != null ? String(pay.transaction_id).trim() : '';
  if (!paymentProvId) return { ok: true, skipped: true };

  if (provider === 'bukku') {
    const creds = await clnInt.getBukkuCredentials(effectiveOperatorId);
    if (!creds?.token) return { ok: false, reason: 'BUKKU_NOT_CONNECTED' };
    const req = bukkuReq(effectiveOperatorId, creds);
    await reverseBukkuPayment(req, paymentProvId);
    await pool.query('DELETE FROM cln_client_payment WHERE invoice_id = ?', [String(invoiceDbId)]);
    return { ok: true };
  }

  if (provider === 'xero') {
    const req = xeroReq(effectiveOperatorId);
    const delRes = await xeroPayment.deletePayment(req, paymentProvId);
    if (!delRes?.ok) return { ok: false, reason: formatProviderError(delRes?.error) || 'XERO_VOID_PAYMENT_FAILED' };
    await pool.query('DELETE FROM cln_client_payment WHERE invoice_id = ?', [String(invoiceDbId)]);
    return { ok: true };
  }

  return { ok: true, skipped: true };
}

async function deleteInvoiceAccountingForOperator(operatorId, invoiceDbId) {
  const hasInvOp = await databaseHasColumn('cln_client_invoice', 'operator_id');
  const invCols = hasInvOp ? 'transaction_id, payment_received, operator_id' : 'transaction_id, payment_received';
  const [[inv]] = await pool.query(`SELECT ${invCols} FROM cln_client_invoice WHERE id = ? LIMIT 1`, [
    String(invoiceDbId),
  ]);
  if (!inv) return { ok: false, reason: 'INVOICE_NOT_FOUND' };
  if (Number(inv.payment_received) === 1) return { ok: false, reason: 'PAID_INVOICE_USE_VOID_PAYMENT_FIRST' };

  const oidRow = hasInvOp && inv.operator_id != null ? String(inv.operator_id).trim() : '';
  const effectiveOperatorId = oidRow || String(operatorId || '').trim();
  const provider = await getActiveProvider(effectiveOperatorId);
  if (!provider || !['bukku', 'xero'].includes(provider)) return { ok: true, skipped: true };

  const acctId = inv.transaction_id != null ? String(inv.transaction_id).trim() : '';
  if (!acctId) return { ok: true, skipped: true };

  if (provider === 'bukku') {
    const creds = await clnInt.getBukkuCredentials(effectiveOperatorId);
    if (!creds?.token) return { ok: false, reason: 'BUKKU_NOT_CONNECTED' };
    const req = bukkuReq(effectiveOperatorId, creds);
    await bukkuInvoice.updateinvoicestatus(req, acctId, { status: 'void', void_reason: 'Deleted from Cleanlemons' });
    return { ok: true };
  }

  if (provider === 'xero') {
    const req = xeroReq(effectiveOperatorId);
    let voidRes = await xeroInvoice.update(req, acctId, { Status: 'VOIDED' });
    if (!voidRes?.ok) {
      const where = `Invoice.InvoiceID=guid("${acctId}")`;
      const listRes = await xeroPayment.listPayments(req, { where });
      const payments = Array.isArray(listRes?.data?.Payments) ? listRes.data.Payments : [];
      for (const p of payments) {
        const pid = p?.PaymentID ?? p?.PaymentId;
        if (pid) await xeroPayment.deletePayment(req, String(pid));
      }
      voidRes = await xeroInvoice.update(req, acctId, { Status: 'VOIDED' });
    }
    if (!voidRes?.ok) return { ok: false, reason: formatProviderError(voidRes?.error) || 'XERO_VOID_FAILED' };
    return { ok: true };
  }

  return { ok: true, skipped: true };
}

module.exports = {
  getActiveProvider,
  createAccountingInvoiceForOperator,
  markPaidAccountingForOperator,
  voidPaymentAccountingForOperator,
  deleteInvoiceAccountingForOperator
};
