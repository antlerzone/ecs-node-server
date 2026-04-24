/**
 * Read-only against Bukku: GET list /sales/invoices (paginated), then per invoice
 * GET /sales/invoices/:id — issue date from `transaction.date` (then `issued_at`); due from `term_items`;
 * receipts from `transaction.files[].file[].url` or `short_link`.
 * Resolves payments via GET /sales/payments/:id for candidate ids (root `payments`, nested `transaction.payments`,
 * `linked_items` when type is payment-related, deposit line fields, and deposit `id` per Bukku samples).
 * Only responses with `transaction.type === 'sale_payment'` are stored as cln_client_payment.
 * Does NOT create or modify anything in Bukku — writes are INSERT/UPDATE to MySQL only.
 *
 * Sync Bukku sales invoices + receipts into cln_client_invoice / cln_client_payment
 * for one Cleanlemons operator (Bukku via cln_operator_integration.addonAccount).
 *
 * Matches B2B clients by cln_clientdetail.account[] entry:
 *   { clientId: <operatorId>, provider: "bukku", id: "<bukku contact id>" }
 * or crm_json.accountingContactId on cln_client_operator when account has no bukku id.
 *
 * Usage:
 *   node scripts/sync-cln-operator-bukku-invoices.js <operatorId> [--dry-run] [--max-pages=40] [--read-delay-ms=0]
 *
 * Env: root .env with DB_* (same as API).
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { randomUUID } = require('crypto');
const pool = require('../src/config/db');
const clnInt = require('../src/modules/cleanlemon/cleanlemon-integration.service');
const bukkuInvoice = require('../src/modules/bukku/wrappers/invoice.wrapper');
const bukkuPayment = require('../src/modules/bukku/wrappers/payment.wrapper');

/** Bukku GET invoice body may nest under `data` (same idea as sandbox.service). */
function unwrapInvoiceReadBody(data) {
  if (!data || typeof data !== 'object') return null;
  return data.data != null && typeof data.data === 'object' && !Array.isArray(data.data)
    ? { ...data, ...data.data }
    : data;
}

/** Primary `transaction` object on GET /sales/invoices/:id or GET /sales/payments/:id. */
function getBukkuTransactionFromReadBody(data) {
  const root = unwrapInvoiceReadBody(data);
  if (!root || typeof root !== 'object') return null;
  if (root.transaction != null && typeof root.transaction === 'object') return root.transaction;
  if (root.invoice != null && typeof root.invoice === 'object') return root.invoice;
  return root;
}

/** Bukku attaches receipts under `files[].file[]` with `url` (see API samples). */
function extractFirstFileAttachmentUrlFromTransaction(tx) {
  if (!tx || typeof tx !== 'object') return null;
  const files = tx.files;
  if (!Array.isArray(files)) return null;
  for (const wrap of files) {
    if (!wrap || typeof wrap !== 'object') continue;
    const inner = wrap.file;
    if (Array.isArray(inner)) {
      for (const f of inner) {
        const u = f && typeof f === 'object' ? f.url : null;
        if (u && /^https?:\/\//i.test(String(u).trim())) return String(u).trim();
      }
    } else if (inner && typeof inner === 'object' && inner.url && /^https?:\/\//i.test(String(inner.url).trim())) {
      return String(inner.url).trim();
    }
  }
  return null;
}

/** Payment transaction ids nested in GET invoice (linked sales payments). */
function extractSalesPaymentIdsFromInvoiceRead(data) {
  const root = unwrapInvoiceReadBody(data);
  if (!root || typeof root !== 'object') return [];
  const ids = [];
  const add = (v) => {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) ids.push(n);
  };
  const payments = root.payments ?? root.payment;
  if (Array.isArray(payments)) {
    for (const p of payments) {
      if (!p || typeof p !== 'object') continue;
      add(p.id ?? p.transaction_id);
      if (p.transaction && typeof p.transaction === 'object') add(p.transaction.id);
    }
  } else if (payments && typeof payments === 'object') {
    add(payments.id ?? payments.transaction_id);
    if (payments.transaction && typeof payments.transaction === 'object') add(payments.transaction.id);
  }
  const tx = getBukkuTransactionFromReadBody(data);
  if (tx) {
    const nested = tx.payments ?? tx.payment;
    if (Array.isArray(nested)) {
      for (const p of nested) {
        if (!p || typeof p !== 'object') continue;
        add(p.id ?? p.transaction_id);
        if (p.transaction && typeof p.transaction === 'object') add(p.transaction.id);
      }
    } else if (nested && typeof nested === 'object') {
      add(nested.id ?? nested.transaction_id);
      if (nested.transaction && typeof nested.transaction === 'object') add(nested.transaction.id);
    }
  }
  return [...new Set(ids)];
}

/**
 * Collect numeric ids to try with GET /sales/payments/:id until one returns type sale_payment.
 * Excludes the sale_invoice's own transaction id (Bukku linked_items may reference other invoices).
 */
function collectSalePaymentTransactionCandidates(invData, deposits, invoiceTxnId) {
  const invNum = Number(String(invoiceTxnId || '').trim());
  const out = [];
  const add = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return;
    if (Number.isFinite(invNum) && n === invNum) return;
    if (!out.includes(n)) out.push(n);
  };
  for (const x of extractSalesPaymentIdsFromInvoiceRead(invData)) add(x);

  const tx = getBukkuTransactionFromReadBody(invData);
  const walkLinked = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const li of arr) {
      if (!li || typeof li !== 'object') continue;
      const typ = String(li.type || '').toLowerCase();
      if (typ === 'sale_payment' || typ === 'payment' || typ.includes('payment')) {
        add(li.origin_transaction_id);
        add(li.target_transaction_id);
      }
    }
  };
  if (tx) {
    walkLinked(tx.linked_items);
    walkLinked(tx.link_items);
  }
  const root = unwrapInvoiceReadBody(invData);
  if (root && typeof root === 'object') {
    walkLinked(root.linked_items);
    walkLinked(root.link_items);
  }

  for (const d of deposits) {
    if (!d || typeof d !== 'object') continue;
    add(d.transaction_id);
    add(d.payment_transaction_id);
    add(d.payment_id);
    add(d.sale_payment_id);
    add(d.target_transaction_id);
    add(d.origin_transaction_id);
    add(d.id);
  }
  return out;
}

/** deposit_items on GET invoice (Bukku: money-in / receipt lines on the invoice). */
function extractDepositItemsFromInvoiceRead(data) {
  const root = unwrapInvoiceReadBody(data);
  if (!root || typeof root !== 'object') return [];
  const tx = getBukkuTransactionFromReadBody(data);
  const t = tx || root;
  const items = t.deposit_items ?? root.deposit_items;
  return Array.isArray(items) ? items : [];
}

function extractShortLinkFromInvoiceReadData(data) {
  const root = unwrapInvoiceReadBody(data);
  if (!root || typeof root !== 'object') return null;
  const trySl = (o) => {
    if (!o || typeof o !== 'object') return null;
    const s = o.short_link ?? o.short_link_url;
    return s != null && String(s).trim() !== '' ? String(s).trim() : null;
  };
  const tx =
    root.transaction != null && typeof root.transaction === 'object'
      ? root.transaction
      : root.invoice != null && typeof root.invoice === 'object'
        ? root.invoice
        : root;
  const fromTx = trySl(tx);
  if (fromTx) return fromTx;
  const fromRoot = trySl(root);
  if (fromRoot) return fromRoot;
  const payments = root.payments ?? root.payment;
  if (Array.isArray(payments)) {
    for (const p of payments) {
      const sl = trySl(p);
      if (sl) return sl;
    }
  } else if (payments && typeof payments === 'object') {
    const sl = trySl(payments);
    if (sl) return sl;
  }
  return null;
}

function extractPaymentDateYmdFromInvoiceRead(data) {
  const tx = getBukkuTransactionFromReadBody(data);
  const root = unwrapInvoiceReadBody(data);
  const raw = tx?.date ?? tx?.invoice_date ?? tx?.issued_at ?? root?.date;
  if (raw == null || raw === '') return null;
  if (raw instanceof Date) {
    const t = raw.getTime();
    if (!Number.isFinite(t)) return null;
    return raw.toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function unwrapPaymentReadBody(data) {
  return unwrapInvoiceReadBody(data);
}

function extractShortLinkFromPaymentReadData(data) {
  const root = unwrapPaymentReadBody(data);
  if (!root || typeof root !== 'object') return null;
  const trySl = (o) => {
    if (!o || typeof o !== 'object') return null;
    const s = o.short_link ?? o.short_link_url;
    return s != null && String(s).trim() !== '' ? String(s).trim() : null;
  };
  const tx =
    root.transaction != null && typeof root.transaction === 'object' ? root.transaction : root;
  return trySl(tx) || trySl(root);
}

/** Prefer uploaded receipt file URL, then short_link (Bukku GET payment / invoice samples). */
function extractBestReceiptUrlFromInvoiceReadData(data) {
  const tx = getBukkuTransactionFromReadBody(data);
  return extractFirstFileAttachmentUrlFromTransaction(tx) || extractShortLinkFromInvoiceReadData(data);
}

function extractBestReceiptUrlFromPaymentReadData(payData) {
  const tx = getBukkuTransactionFromReadBody(payData);
  return extractFirstFileAttachmentUrlFromTransaction(tx) || extractShortLinkFromPaymentReadData(payData);
}

function extractPaymentDateYmdFromPaymentRead(data) {
  const tx = getBukkuTransactionFromReadBody(data);
  const root = unwrapPaymentReadBody(data);
  const raw = tx?.date ?? tx?.issued_at ?? root?.date;
  if (raw == null || raw === '') return null;
  if (raw instanceof Date) {
    const t = raw.getTime();
    if (!Number.isFinite(t)) return null;
    return raw.toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 40;

function safeJson(val, fallback) {
  if (val == null || val === '') return fallback;
  try {
    const v = typeof val === 'string' ? JSON.parse(val) : val;
    return v;
  } catch {
    return fallback;
  }
}

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeTransactionArray(data) {
  if (!data) return [];
  if (Array.isArray(data.transactions)) return data.transactions;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.items)) return data.items;
  return [];
}

function bukkuReqFromCreds(operatorId, creds) {
  return {
    client: {
      id: String(operatorId),
      bukku_secretKey: String(creds.token || '').trim(),
      bukku_subdomain: String(creds.subdomain || '').trim(),
    },
  };
}

function extractListTxTotal(tx) {
  if (!tx || typeof tx !== 'object') return null;
  const inner = tx.transaction && typeof tx.transaction === 'object' ? tx.transaction : null;
  const candidates = [
    num(tx.total),
    num(tx.grand_total),
    num(tx.net_total),
    num(tx.amount),
    num(tx.balance),
    inner && num(inner.total),
    inner && num(inner.grand_total),
    inner && num(inner.amount),
  ].filter((n) => n != null);
  if (candidates.length) return candidates[0];
  if (Array.isArray(tx.form_items) && tx.form_items.length) {
    let sum = 0;
    for (const fi of tx.form_items) {
      const up = num(fi.unit_price);
      const q = num(fi.quantity);
      if (up != null && q != null) sum += up * q;
      else if (up != null) sum += up;
    }
    if (sum > 0) return sum;
  }
  return null;
}

function txBukkuId(tx) {
  if (!tx || typeof tx !== 'object') return '';
  const id = tx.id != null ? tx.id : tx.transaction?.id;
  return id != null && String(id).trim() !== '' ? String(id).trim() : '';
}

function txContactId(tx) {
  if (!tx || typeof tx !== 'object') return null;
  const c = tx.contact_id ?? tx.contact?.id ?? tx.transaction?.contact_id;
  const n = num(c);
  return n != null ? n : null;
}

function invoiceDescription(tx) {
  const parts = [tx.title, tx.description, tx.memo, tx.transaction?.title, tx.transaction?.description].filter(Boolean);
  const s = parts.map((x) => String(x).trim()).find(Boolean);
  return s ? String(s).slice(0, 4000) : 'Bukku invoice';
}

function invoicePdfUrl(subdomain, tx) {
  const sl = tx.short_link != null ? String(tx.short_link).trim() : '';
  if (sl) return sl;
  const id = txBukkuId(tx);
  const sub = String(subdomain || '').trim();
  if (sub && id) return `https://${sub}.bukku.my/invoices/${encodeURIComponent(id)}`;
  return null;
}

function paymentIsPaidLike(tx) {
  const ps = String(tx.payment_status || tx.transaction?.payment_status || '').toUpperCase();
  if (ps === 'PAID') return true;
  const bal = num(tx.balance) ?? num(tx.transaction?.balance);
  if (bal != null && bal <= 0.0001) return true;
  return false;
}

async function databaseHasColumn(table, column) {
  const [[r]] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(r?.c || 0) > 0;
}

async function databaseHasTable(table) {
  const [[r]] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.tables
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return Number(r?.c || 0) > 0;
}

async function fetchAllInvoicePages(req, baseParams, maxPages) {
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const params = { ...baseParams, page, page_size: baseParams.page_size || DEFAULT_PAGE_SIZE };
    const res = await bukkuInvoice.listinvoices(req, params);
    if (!res?.ok) {
      return { ok: false, error: res?.error || 'BUKKU_INVOICE_LIST_FAILED', transactions: out };
    }
    const chunk = normalizeTransactionArray(res.data);
    if (!chunk.length) break;
    out.push(...chunk);
    if (chunk.length < (params.page_size || DEFAULT_PAGE_SIZE)) break;
  }
  return { ok: true, transactions: out };
}

function ymdFromBukkuDateValue(raw) {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date) {
    const t = raw.getTime();
    if (!Number.isFinite(t)) return null;
    return raw.toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/** Issue date from GET /sales/invoices list row. */
function issueYmdFromListTx(tx) {
  if (!tx || typeof tx !== 'object') return null;
  const inner = tx.transaction && typeof tx.transaction === 'object' ? tx.transaction : null;
  return (
    ymdFromBukkuDateValue(tx.date ?? tx.invoice_date ?? inner?.date ?? inner?.invoice_date) ||
    ymdFromBukkuDateValue(inner?.issued_at ?? tx.issued_at)
  );
}

/** Issue + first term due from GET /sales/invoices/:id read body (Bukku: transaction.date, then issued_at). */
function extractIssueDueFromInvoiceRead(invData) {
  const root = unwrapInvoiceReadBody(invData);
  if (!root || typeof root !== 'object') return { issueYmd: null, dueYmd: null };
  const tx = getBukkuTransactionFromReadBody(invData);
  const t = tx || root;
  const issueYmd =
    ymdFromBukkuDateValue(t?.date) ||
    ymdFromBukkuDateValue(t?.invoice_date) ||
    ymdFromBukkuDateValue(t?.issued_at) ||
    ymdFromBukkuDateValue(root.date);
  let dueYmd = null;
  const terms = Array.isArray(t.term_items) ? t.term_items : Array.isArray(root.term_items) ? root.term_items : [];
  for (const term of terms) {
    const d = ymdFromBukkuDateValue(term?.date);
    if (d) {
      dueYmd = d;
      break;
    }
  }
  return { issueYmd, dueYmd };
}

function parseBukkuContactFromAccount(accountRaw, operatorId) {
  const arr = Array.isArray(accountRaw) ? accountRaw : safeJson(accountRaw, []);
  if (!Array.isArray(arr)) return null;
  const e = arr.find(
    (a) =>
      String(a?.clientId || '').trim() === String(operatorId).trim() &&
      String(a?.provider || '').toLowerCase() === 'bukku'
  );
  const rawId = e?.id ?? e?.contactId;
  if (rawId == null || String(rawId).trim() === '') return null;
  const n = Number(String(rawId).trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * @returns {Promise<{ operatorId: string, dryRun: boolean, maxPages: number, summary: object }>}
 */
async function syncClnOperatorBukkuInvoices(operatorId, opts = {}) {
  const oid = String(operatorId || '').trim();
  const dryRun = Boolean(opts.dryRun);
  const maxPages = Math.min(200, Math.max(1, Number(opts.maxPages) || DEFAULT_MAX_PAGES));

  if (!oid) throw new Error('MISSING_OPERATOR_ID');

  await clnInt.ensureClnOperatorIntegrationTable();
  const creds = await clnInt.getBukkuCredentials(oid);
  if (!creds?.token || !creds?.subdomain) {
    throw new Error('BUKKU_NOT_CONNECTED: enable Bukku addonAccount for this operator');
  }

  const req = bukkuReqFromCreds(oid, creds);
  const sub = String(creds.subdomain || '').trim();

  const [clientRows] = await pool.query(
    `SELECT d.id AS clientdetailId,
            d.account AS account,
            j.crm_json AS crmJson
     FROM cln_clientdetail d
     INNER JOIN cln_client_operator j ON j.clientdetail_id = d.id AND j.operator_id = ?
     ORDER BY d.id`,
    [oid]
  );

  /** @type {Map<number, string>} */
  const contactToClientdetail = new Map();
  let skippedNoContact = 0;
  for (const row of clientRows || []) {
    const cid = String(row.clientdetailId || '').trim();
    let n = parseBukkuContactFromAccount(row.account, oid);
    if (n == null && row.crmJson) {
      const crm = safeJson(row.crmJson, {});
      const raw = crm.accountingContactId ?? crm.accounting_contact_id;
      const x = Number(String(raw || '').trim());
      if (Number.isFinite(x) && x > 0) n = x;
    }
    if (n == null) {
      skippedNoContact += 1;
      continue;
    }
    if (!contactToClientdetail.has(n)) contactToClientdetail.set(n, cid);
  }

  const readDelayMsEarly = Math.max(0, Math.min(10_000, Number(opts.readDelayMs) || 0));

  if (contactToClientdetail.size === 0) {
    return {
      operatorId: oid,
      dryRun,
      maxPages,
      readDelayMs: readDelayMsEarly,
      summary: {
        clientsLinked: (clientRows || []).length,
        skippedNoBukkuContactId: skippedNoContact,
        bukkuContacts: 0,
        invoicesSeen: 0,
        invoicesInserted: 0,
        invoicesUpdated: 0,
        readInvoiceOk: 0,
        readInvoiceFail: 0,
        paymentsFromDepositItems: 0,
        paymentsFromLinkedPayments: 0,
        paymentsLinked: 0,
        paymentsSkippedNoTable: false,
        errors: [],
      },
    };
  }

  const hasOpCol = await databaseHasColumn('cln_client_invoice', 'operator_id');
  const hasPdf = await databaseHasColumn('cln_client_invoice', 'pdf_url');
  const hasTxn = await databaseHasColumn('cln_client_invoice', 'transaction_id');
  const hasBal = await databaseHasColumn('cln_client_invoice', 'balance_amount');
  const hasIssueDate = await databaseHasColumn('cln_client_invoice', 'issue_date');
  const hasDueDate = await databaseHasColumn('cln_client_invoice', 'due_date');
  const hasPayRcpt = await databaseHasColumn('cln_client_payment', 'receipt_url');
  const hasPayOpCol = await databaseHasColumn('cln_client_payment', 'operator_id');

  const readDelayMs = readDelayMsEarly;

  const summary = {
    clientsLinked: (clientRows || []).length,
    skippedNoBukkuContactId: skippedNoContact,
    bukkuContacts: contactToClientdetail.size,
    invoicesSeen: 0,
    invoicesInserted: 0,
    invoicesUpdated: 0,
    readInvoiceOk: 0,
    readInvoiceFail: 0,
    paymentsFromDepositItems: 0,
    paymentsFromLinkedPayments: 0,
    paymentsLinked: 0,
    paymentsSkippedNoTable: false,
    errors: [],
  };

  /** invoice bukku id -> { localInvoiceId, clientdetailId } */
  const invoiceKeyMeta = new Map();

  for (const [contactId, clientdetailId] of contactToClientdetail.entries()) {
    const listParams = { contact_id: contactId, page_size: DEFAULT_PAGE_SIZE };
    const invList = await fetchAllInvoicePages(req, listParams, maxPages);
    if (!invList.ok) {
      summary.errors.push({ contactId, step: 'list_invoices', detail: invList.error });
      continue;
    }

    for (const tx of invList.transactions) {
      summary.invoicesSeen += 1;
      const bukkuId = txBukkuId(tx);
      if (!bukkuId) continue;
      const st = String(tx.status || tx.transaction?.status || '').toLowerCase();
      if (st === 'void') continue;

      const amount = extractListTxTotal(tx);
      const amt = amount != null ? Number(Number(amount).toFixed(2)) : null;
      const invNo =
        tx.number != null && String(tx.number).trim() !== ''
          ? String(tx.number).trim()
          : tx.document_number != null && String(tx.document_number).trim() !== ''
            ? String(tx.document_number).trim()
            : bukkuId;
      const desc = invoiceDescription(tx);
      const pdf = invoicePdfUrl(sub, tx);
      const paid = paymentIsPaidLike(tx) ? 1 : 0;
      const issueYmdList = issueYmdFromListTx(tx);
      const cFromTx = txContactId(tx);
      const effectiveContact = cFromTx != null ? cFromTx : contactId;
      const cdid = contactToClientdetail.get(effectiveContact) || clientdetailId;

      const [[existing]] = await pool.query(
        `SELECT id FROM cln_client_invoice WHERE transaction_id = ? ${hasOpCol ? 'AND operator_id = ?' : ''} LIMIT 1`,
        hasOpCol ? [bukkuId, oid] : [bukkuId]
      );

      if (dryRun) {
        if (existing?.id) summary.invoicesUpdated += 1;
        else summary.invoicesInserted += 1;
        invoiceKeyMeta.set(bukkuId, { localInvoiceId: existing?.id || '(new)', clientdetailId: cdid });
        continue;
      }

      if (existing?.id) {
        const sets = [
          'invoice_number = ?',
          'description = ?',
          'amount = ?',
          'payment_received = ?',
          'updated_at = NOW(3)',
        ];
        const vals = [invNo, desc, amt, paid];
        if (hasPdf) {
          sets.push('pdf_url = COALESCE(?, pdf_url)');
          vals.push(pdf);
        }
        if (hasTxn) {
          /* already matched */
        }
        if (hasBal) {
          const bal = num(tx.balance) ?? num(tx.transaction?.balance);
          sets.push('balance_amount = ?');
          vals.push(bal != null ? Number(bal.toFixed(2)) : null);
        }
        if (hasIssueDate && issueYmdList) {
          sets.push('issue_date = ?');
          vals.push(issueYmdList);
        }
        vals.push(String(existing.id));
        await pool.query(`UPDATE cln_client_invoice SET ${sets.join(', ')} WHERE id = ? LIMIT 1`, vals);
        summary.invoicesUpdated += 1;
        invoiceKeyMeta.set(bukkuId, { localInvoiceId: String(existing.id), clientdetailId: cdid });
      } else {
        const id = randomUUID();
        const cols = ['id', 'invoice_number', 'client_id', 'description', 'amount', 'payment_received', 'created_at', 'updated_at'];
        const placeholders = ['?', '?', '?', '?', '?', '?', 'NOW(3)', 'NOW(3)'];
        const vals = [id, invNo, cdid, desc, amt, paid];
        if (hasOpCol) {
          cols.splice(3, 0, 'operator_id');
          placeholders.splice(3, 0, '?');
          vals.splice(3, 0, oid);
        }
        if (hasPdf) {
          cols.push('pdf_url');
          placeholders.push('?');
          vals.push(pdf);
        }
        if (hasTxn) {
          cols.push('transaction_id');
          placeholders.push('?');
          vals.push(bukkuId);
        }
        if (hasBal) {
          const bal = num(tx.balance) ?? num(tx.transaction?.balance);
          cols.push('balance_amount');
          placeholders.push('?');
          vals.push(bal != null ? Number(bal.toFixed(2)) : null);
        }
        if (hasIssueDate && issueYmdList) {
          cols.push('issue_date');
          placeholders.push('?');
          vals.push(issueYmdList);
        }
        try {
          await pool.query(`INSERT INTO cln_client_invoice (${cols.join(',')}) VALUES (${placeholders.join(',')})`, vals);
          summary.invoicesInserted += 1;
          invoiceKeyMeta.set(bukkuId, { localInvoiceId: id, clientdetailId: cdid });
        } catch (e) {
          summary.errors.push({ bukkuId, step: 'insert_invoice', detail: String(e?.sqlMessage || e?.message || e) });
        }
      }
    }
  }

  const hasPayTable = await databaseHasTable('cln_client_payment');
  if (!hasPayTable) {
    summary.paymentsSkippedNoTable = true;
  }
  if (!dryRun) {
    async function tryInsertPaymentRow(meta, localInvId, { transactionId, amount, paymentDateYmd, receiptUrl, receiptNumber }) {
      if (!hasPayTable) return false;
      const tid = String(transactionId || '').trim();
      if (!tid) return false;
      const amtN = num(amount);
      if (amtN == null || !(amtN > 0)) return false;
      const [[dup]] = await pool.query(
        'SELECT id FROM cln_client_payment WHERE transaction_id = ? AND invoice_id = ? LIMIT 1',
        [tid, String(localInvId)]
      );
      if (dup?.id) return false;
      try {
        const amtFixed = Number(amtN.toFixed(2));
        if (hasPayRcpt && hasPayOpCol) {
          await pool.query(
            `INSERT INTO cln_client_payment (id, client_id, operator_id, receipt_number, amount, payment_date, receipt_url, invoice_id, transaction_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
            [
              randomUUID(),
              meta.clientdetailId,
              oid,
              receiptNumber || tid,
              amtFixed,
              paymentDateYmd || null,
              receiptUrl || null,
              String(localInvId),
              tid,
            ]
          );
        } else if (hasPayRcpt) {
          await pool.query(
            `INSERT INTO cln_client_payment (id, client_id, receipt_number, amount, payment_date, receipt_url, invoice_id, transaction_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
            [
              randomUUID(),
              meta.clientdetailId,
              receiptNumber || tid,
              amtFixed,
              paymentDateYmd || null,
              receiptUrl || null,
              String(localInvId),
              tid,
            ]
          );
        } else if (hasPayOpCol) {
          await pool.query(
            `INSERT INTO cln_client_payment (id, client_id, operator_id, receipt_number, amount, payment_date, invoice_id, transaction_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
            [randomUUID(), meta.clientdetailId, oid, receiptNumber || tid, amtFixed, paymentDateYmd || null, String(localInvId), tid]
          );
        } else {
          await pool.query(
            `INSERT INTO cln_client_payment (id, client_id, receipt_number, amount, payment_date, invoice_id, transaction_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
            [randomUUID(), meta.clientdetailId, receiptNumber || tid, amtFixed, paymentDateYmd || null, String(localInvId), tid]
          );
        }
        return true;
      } catch (e) {
        summary.errors.push({
          step: 'insert_payment',
          transactionId: tid,
          detail: String(e?.sqlMessage || e?.message || e),
        });
        return false;
      }
    }

    /** GET /sales/payments/:id cache — only entries with type sale_payment are used as receipts. */
    const bukkuPaymentReadCache = new Map();

    async function loadSalePaymentEntry(tidStr) {
      const key = String(tidStr || '').trim();
      if (!key || !/^\d+$/.test(key)) return null;
      if (bukkuPaymentReadCache.has(key)) return bukkuPaymentReadCache.get(key);
      if (readDelayMs) await sleep(readDelayMs);
      const payRes = await bukkuPayment.getPayment(req, key);
      let entry = { ok: false, data: null, tx: null, err: null };
      if (payRes?.ok) {
        const ptx = getBukkuTransactionFromReadBody(payRes.data);
        const typ = String(ptx?.type || '').toLowerCase();
        if (ptx && typ === 'sale_payment') {
          entry = { ok: true, data: payRes.data, tx: ptx, err: null };
        } else {
          entry = {
            ok: false,
            data: payRes.data,
            tx: ptx,
            err: typ ? `NOT_SALE_PAYMENT:${typ}` : 'NO_TRANSACTION',
          };
        }
      } else {
        entry = {
          ok: false,
          data: null,
          tx: null,
          err:
            payRes?.error && typeof payRes.error === 'object'
              ? JSON.stringify(payRes.error).slice(0, 240)
              : String(payRes?.error || 'FAIL'),
        };
      }
      bukkuPaymentReadCache.set(key, entry);
      return entry;
    }

    for (const [bukkuId, meta] of invoiceKeyMeta.entries()) {
      const localInvId = meta.localInvoiceId;
      if (!localInvId || localInvId === '(new)') continue;

      if (readDelayMs) await sleep(readDelayMs);

      const readRes = await bukkuInvoice.readinvoice(req, bukkuId);
      if (!readRes?.ok) {
        summary.readInvoiceFail += 1;
        const detail =
          readRes?.error && typeof readRes.error === 'object'
            ? JSON.stringify(readRes.error).slice(0, 400)
            : String(readRes?.error || 'READ_FAIL');
        summary.errors.push({ bukkuId, step: 'read_invoice', detail });
        continue;
      }
      summary.readInvoiceOk += 1;

      const invData = readRes.data;
      const invReceiptUrl = extractBestReceiptUrlFromInvoiceReadData(invData);
      const invDateYmd = extractPaymentDateYmdFromInvoiceRead(invData);
      const { issueYmd: issueRead, dueYmd: dueRead } = extractIssueDueFromInvoiceRead(invData);
      const dateSets = [];
      const dateVals = [];
      if (hasIssueDate && issueRead) {
        dateSets.push('issue_date = ?');
        dateVals.push(issueRead);
      }
      if (hasDueDate && dueRead) {
        dateSets.push('due_date = ?');
        dateVals.push(dueRead);
      }
      if (dateSets.length) {
        dateVals.push(String(localInvId));
        try {
          await pool.query(
            `UPDATE cln_client_invoice SET ${dateSets.join(', ')}, updated_at = NOW(3) WHERE id = ? LIMIT 1`,
            dateVals
          );
        } catch (e) {
          summary.errors.push({ bukkuId, step: 'update_invoice_dates', detail: String(e?.sqlMessage || e?.message || e) });
        }
      }

      const deposits = extractDepositItemsFromInvoiceRead(invData);
      const candidates = collectSalePaymentTransactionCandidates(invData, deposits, bukkuId);
      for (const pid of candidates) {
        await loadSalePaymentEntry(String(pid));
      }

      const validatedByTid = new Map();
      for (const pid of candidates) {
        const key = String(pid);
        const ent = bukkuPaymentReadCache.get(key);
        if (ent?.ok && ent.tx) validatedByTid.set(key, { data: ent.data, tx: ent.tx });
      }

      if (hasPayTable && deposits.length > 0) {
        for (let i = 0; i < deposits.length; i++) {
          const d = deposits[i];
          const amt = num(d.amount);
          let chosen = null;
          for (const ent of validatedByTid.values()) {
            const pAmt = num(ent.tx.amount);
            if (amt != null && pAmt != null && Math.abs(pAmt - amt) < 0.02) {
              chosen = ent;
              break;
            }
          }
          if (!chosen && validatedByTid.size === 1) {
            chosen = [...validatedByTid.values()][0];
          }
          if (!chosen) {
            const did = Number(d.id);
            if (Number.isFinite(did) && did > 0) {
              const ent = await loadSalePaymentEntry(String(did));
              if (ent?.ok && ent.tx) chosen = { data: ent.data, tx: ent.tx };
            }
          }
          const receiptUrl = chosen
            ? extractBestReceiptUrlFromPaymentReadData(chosen.data) || invReceiptUrl
            : invReceiptUrl;
          const payTid = chosen ? String(chosen.tx.id) : `${bukkuId}-deposit-${i}`;
          const amountForRow = amt != null ? amt : num(chosen?.tx?.amount);
          if (amountForRow == null || !(amountForRow > 0)) continue;
          const ymd =
            (chosen && extractPaymentDateYmdFromPaymentRead(chosen.data)) ||
            ymdFromBukkuDateValue(d.date || d.payment_date || d.created_at) ||
            invDateYmd;
          const ok = await tryInsertPaymentRow(meta, localInvId, {
            transactionId: payTid,
            amount: amountForRow,
            paymentDateYmd: ymd,
            receiptUrl,
            receiptNumber:
              d.number != null && String(d.number).trim() !== ''
                ? String(d.number).trim()
                : chosen?.tx?.number != null && String(chosen.tx.number).trim() !== ''
                  ? String(chosen.tx.number).trim()
                  : payTid,
          });
          if (ok) summary.paymentsFromDepositItems += 1;
        }
      } else if (hasPayTable && validatedByTid.size > 0) {
        for (const [tid, ent] of validatedByTid) {
          const pAmt =
            num(ent.tx.amount) ?? num(ent.tx.grand_total) ?? num(ent.tx.total);
          if (pAmt == null || !(pAmt > 0)) continue;
          const receiptUrl = extractBestReceiptUrlFromPaymentReadData(ent.data) || invReceiptUrl;
          const ymd = extractPaymentDateYmdFromPaymentRead(ent.data) || invDateYmd;
          const ok = await tryInsertPaymentRow(meta, localInvId, {
            transactionId: tid,
            amount: pAmt,
            paymentDateYmd: ymd,
            receiptUrl,
            receiptNumber:
              ent.tx.number != null && String(ent.tx.number).trim() !== ''
                ? String(ent.tx.number).trim()
                : tid,
          });
          if (ok) summary.paymentsFromLinkedPayments += 1;
        }
      } else if (hasPayTable && candidates.length > 0) {
        const firstFail = candidates.map((pid) => bukkuPaymentReadCache.get(String(pid))).find((e) => e && !e.ok);
        summary.errors.push({
          bukkuId,
          step: 'read_payment',
          detail: `No sale_payment from tried ids (${candidates.slice(0, 12).join(',')}). ${firstFail?.err ? String(firstFail.err).slice(0, 200) : ''}`.trim(),
        });
      }
    }
  }

  summary.paymentsLinked = summary.paymentsFromDepositItems + summary.paymentsFromLinkedPayments;

  return { operatorId: oid, dryRun, maxPages, readDelayMs, summary };
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const mpArg = argv.find((a) => a.startsWith('--max-pages='));
  const maxPages = mpArg ? Number(mpArg.split('=')[1]) : DEFAULT_MAX_PAGES;
  const rdArg = argv.find((a) => a.startsWith('--read-delay-ms='));
  const readDelayMs = rdArg ? Number(rdArg.split('=')[1]) : 0;
  const pos = argv.filter((a) => !a.startsWith('--'));
  const operatorId = pos[0] || 'e48b2c25-399a-11f1-a4e2-00163e006722';

  const r = await syncClnOperatorBukkuInvoices(operatorId, { dryRun, maxPages, readDelayMs });
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.summary?.errors?.length ? 1 : 0);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { syncClnOperatorBukkuInvoices };
