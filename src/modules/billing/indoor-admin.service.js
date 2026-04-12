/**
 * SaaS indoor admin：手動 topup、手動 renew。
 * 流程（與 booking 頁類似）：用 operatordetail 的 email + title(name) 在 env 設定的 SaaS platform Bukku 先 search；
 * 有則取 contact id 寫回 operatordetail.bukku_saas_contact_id；沒有則 create operator as customer，取 id 寫回 mydb；
 * 然後開 cash invoice。需 env 已有 BUKKU_SAAS_API_KEY、BUKKU_SAAS_SUBDOMAIN（改 .env 後需重啟進程）。
 */

const pool = require('../../config/db');
const { randomUUID } = require('crypto');
const { syncSubtablesFromOperatordetail } = require('../../services/client-subtables');
const { handlePricingPlanPaymentSuccess } = require('./checkout.service');
const {
  createSaasBukkuCashInvoice,
  buildTopupInvoiceTitle,
  buildTopupLineItemDescription,
  buildPlanDescription,
  ensureClientBukkuContact,
  PRODUCT_PRICINGPLAN,
  PRODUCT_TOPUPCREDIT,
  ACCOUNT_REVENUE,
  PAYMENT_BANK
} = require('./saas-bukku.service');
const { utcDatetimeFromDbToMalaysiaDateOnly } = require('../../utils/dateMalaysia');

const SAAS_CONTACT_ID = process.env.BUKKU_SAAS_DEFAULT_CONTACT_ID
  ? Number(process.env.BUKKU_SAAS_DEFAULT_CONTACT_ID)
  : null;

/** 示範公司 client_id；enquiry 時訪客 staff 掛在此下，開戶時移轉到自家 client。 */
const DEMO_CLIENT_ID = process.env.DEMO_CLIENT_ID || 'a0000001-0001-4000-8000-000000000001';

/**
 * Contact Setting 員工列：為 company email 建立或標記 staffdetail（is_master），並嘗試同步會計 contact。
 */
async function ensureStaffdetailForCompanyEmail(clientId) {
  const [clientRows] = await pool.query(
    'SELECT id, title, email FROM operatordetail WHERE id = ? LIMIT 1',
    [clientId]
  );
  if (!clientRows.length) return;
  const client = clientRows[0];
  const companyEmail = client.email && String(client.email).trim();
  if (!companyEmail) return;
  const normalizedEmail = companyEmail.toLowerCase();
  const displayName = (client.title || companyEmail.split('@')[0] || 'Admin').trim();
  const permissionJson = JSON.stringify(['admin']);
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  const [existing] = await pool.query(
    'SELECT id FROM staffdetail WHERE client_id = ? AND LOWER(TRIM(email)) = ? LIMIT 1',
    [clientId, normalizedEmail]
  );

  let staffId;
  if (existing.length) {
    staffId = existing[0].id;
    try {
      await pool.query(
        'UPDATE staffdetail SET permission_json = ?, status = 1, is_master = 1, updated_at = ? WHERE id = ?',
        [permissionJson, now, staffId]
      );
    } catch (err) {
      if (err?.code === 'ER_BAD_FIELD_ERROR' && /is_master/i.test(String(err.sqlMessage || ''))) {
        await pool.query(
          'UPDATE staffdetail SET permission_json = ?, status = 1, updated_at = ? WHERE id = ?',
          [permissionJson, now, staffId]
        );
      } else throw err;
    }
  } else {
    staffId = randomUUID();
    try {
      await pool.query(
        `INSERT INTO staffdetail (id, name, email, permission_json, status, client_id, is_master, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, 1, ?, ?)`,
        [staffId, displayName, companyEmail, permissionJson, clientId, now, now]
      );
    } catch (err) {
      if (err?.code === 'ER_BAD_FIELD_ERROR' && /is_master/i.test(String(err.sqlMessage || ''))) {
        await pool.query(
          `INSERT INTO staffdetail (id, name, email, permission_json, status, client_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
          [staffId, displayName, companyEmail, permissionJson, clientId, now, now]
        );
      } else throw err;
    }
  }

  try {
    const contactSync = require('../contact/contact-sync.service');
    await contactSync.syncStaffForClient(staffId, clientId);
  } catch (e) {
    console.warn('[indoor-admin] ensureStaffdetailForCompanyEmail syncStaffForClient', e?.message || e);
  }
}

/**
 * 開戶時：從 operatordetail 取 company email，在 client_user 表建立或更新為 master admin（is_admin=1），
 * 並在 staffdetail 建立對應員工（Contact Setting + 會計同步）。
 */
async function ensureMasterAdminUserForClient(clientId) {
  console.log('[indoor-admin] ensureMasterAdminUserForClient START clientId=%s', clientId);
  const [clientRows] = await pool.query(
    'SELECT id, title, email FROM operatordetail WHERE id = ? LIMIT 1',
    [clientId]
  );
  if (!clientRows.length) {
    console.log('[indoor-admin] ensureMasterAdminUserForClient SKIP client not found');
    return;
  }
  const client = clientRows[0];
  const companyEmail = client.email && String(client.email).trim();
  if (!companyEmail) {
    console.log('[indoor-admin] ensureMasterAdminUserForClient SKIP no company email clientId=%s (operatordetail.email empty)', clientId);
    return;
  }
  const normalizedEmail = companyEmail.toLowerCase();
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const permissionJson = JSON.stringify(['admin']);

  const [existing] = await pool.query(
    'SELECT id, is_admin, status FROM client_user WHERE client_id = ? AND LOWER(TRIM(email)) = ? LIMIT 1',
    [clientId, normalizedEmail]
  );
  if (existing.length) {
    const u = existing[0];
    const needUpdate = (u.is_admin !== 1 && u.is_admin !== true) || (u.status !== 1 && u.status !== true);
    if (needUpdate) {
      await pool.query(
        'UPDATE client_user SET is_admin = 1, status = 1, updated_at = ? WHERE id = ?',
        [now, u.id]
      );
      console.log('[indoor-admin] ensureMasterAdminUserForClient DONE existing client_user updated userId=%s clientId=%s email=%s', u.id, clientId, normalizedEmail);
    } else {
      console.log('[indoor-admin] ensureMasterAdminUserForClient DONE existing client_user already ok userId=%s clientId=%s', u.id, clientId);
    }
  } else {
    const userId = randomUUID();
    await pool.query(
      `INSERT INTO client_user (id, client_id, email, name, is_admin, permission_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, 1, ?, ?)`,
      [userId, clientId, companyEmail, (client.title || companyEmail.split('@')[0] || 'Admin').trim(), permissionJson, now, now]
    );
    console.log('[indoor-admin] ensureMasterAdminUserForClient DONE INSERT new master admin userId=%s clientId=%s email=%s', userId, clientId, normalizedEmail);
  }

  await ensureStaffdetailForCompanyEmail(clientId).catch((err) => {
    console.warn('[indoor-admin] ensureStaffdetailForCompanyEmail failed', err?.message);
  });
}

function parseJson(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

/** Normalise paidDate (ISO string, Date, or YYYY-MM-DD) to Malaysia calendar YYYY-MM-DD for MySQL / Bukku. */
function toDateOnlyStr(val) {
  if (val == null || val === '') return '';
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = val instanceof Date ? val : new Date(val);
  if (Number.isNaN(d.getTime())) return '';
  return utcDatetimeFromDbToMalaysiaDateOnly(d) || '';
}

/**
 * After successful manual top-up, link ticket row (SaaS admin flow) so list shows Complete.
 */
async function markTicketTopupCompleted(ticketRowId, clientId) {
  if (!ticketRowId || !clientId) return;
  const tid = String(ticketRowId).trim();
  const cid = String(clientId).trim();
  if (!tid || !cid) return;
  try {
    await pool.query(
      `UPDATE ticket SET completed_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
       WHERE id = ? AND client_id = ? AND mode = 'topup_manual' AND (completed_at IS NULL)`,
      [tid, cid]
    );
  } catch (e) {
    if (e?.message && /Unknown column ['`]completed_at/i.test(e.message)) {
      console.warn('[indoor-admin] markTicketTopupCompleted: run migration 0259_ticket_completed_at.sql');
      return;
    }
    throw e;
  }
}

/**
 * 手動充值：寫 creditlogs + operatordetail.credit（flex）+ sync client_credit。topupMode: manual_credit 時再開平台 Bukku cash invoice；free_credit 不開單。
 * @param {{ clientId: string, amount: number, paidDate: string (YYYY-MM-DD), staffId?: string, topupMode?: 'free_credit'|'manual_credit', ticketRowId?: string|null }}
 */
async function manualTopup({ clientId, amount, paidDate, staffId = null, topupMode = 'manual_credit', ticketRowId = null }) {
  if (!clientId || amount == null || amount <= 0 || !paidDate) {
    return { ok: false, reason: 'MISSING_PARAMS' };
  }
  const paidDateStr = toDateOnlyStr(paidDate);
  if (!paidDateStr) return { ok: false, reason: 'INVALID_PAID_DATE' };
  const [clientRows] = await pool.query(
    'SELECT id, title, currency FROM operatordetail WHERE id = ? LIMIT 1',
    [clientId]
  );
  if (!clientRows.length) return { ok: false, reason: 'CLIENT_NOT_FOUND' };
  const client = clientRows[0];
  const currency = String(client.currency || '').trim().toUpperCase();
  if (!currency) throw new Error('CLIENT_CURRENCY_MISSING');
  if (!['MYR', 'SGD'].includes(currency)) throw new Error('UNSUPPORTED_CLIENT_CURRENCY');

  const [[totalRow]] = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM client_credit WHERE client_id = ?`,
    [clientId]
  );
  const creditBefore = totalRow ? Number(totalRow.total) || 0 : 0;
  const creditAfter = creditBefore + amount;

  const logId = randomUUID();
  const ref = `TP-MANUAL-${logId}`;
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  /** Shown on operator /credit statement; must match free_credit (no Bukku invoice) SaaS admin top-up. */
  const logTitle = topupMode === 'free_credit' ? 'Free Credit' : `Manual topup ${amount}`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO creditlogs (id, title, type, client_id, staff_id, currency, payment, amount, is_paid, reference_number, paiddate, created_at, updated_at)
       VALUES (?, ?, 'Topup', ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      [logId, logTitle, clientId, staffId, currency, amount, amount, ref, paidDateStr, now, now]
    );
    const [odRows] = await conn.query('SELECT credit FROM operatordetail WHERE id = ? FOR UPDATE', [clientId]);
    if (!odRows.length) throw new Error('CLIENT_NOT_FOUND');
    let creditList = [];
    try {
      const raw = odRows[0].credit;
      creditList = typeof raw === 'string' ? JSON.parse(raw || '[]') : (Array.isArray(raw) ? raw : []);
    } catch (_) {}
    let flex = creditList.find((c) => c.type === 'flex');
    if (!flex) {
      flex = { type: 'flex', amount: 0 };
      creditList.push(flex);
    }
    flex.amount = Number(flex.amount) || 0;
    flex.amount += Number(amount);
    await conn.query('UPDATE operatordetail SET credit = ?, updated_at = ? WHERE id = ?', [
      JSON.stringify(creditList),
      now,
      clientId
    ]);
    await syncSubtablesFromOperatordetail(conn, clientId);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  try {
    const { clearBillingCacheByClientId } = require('./billing.service');
    clearBillingCacheByClientId(clientId);
  } catch (_) {}

  if (topupMode === 'free_credit') {
    await markTicketTopupCompleted(ticketRowId, clientId);
    return { ok: true, creditlogId: logId, bukku_saas_contact_id: null, bukkuInvoice: null, invoiceUrl: null, reason: 'free_credit (no Bukku invoice)' };
  }

  const contactId = (await ensureClientBukkuContact(clientId)) ?? SAAS_CONTACT_ID;
  if (!contactId) {
    await markTicketTopupCompleted(ticketRowId, clientId);
    return { ok: true, creditlogId: logId, bukku_saas_contact_id: null, bukkuInvoice: null, invoiceUrl: null, reason: 'no Bukku contact (client or default)' };
  }
  const inv = await createSaasBukkuCashInvoice({
    contactId,
    productId: PRODUCT_TOPUPCREDIT,
    accountId: ACCOUNT_REVENUE,
    amount,
    paidDate: paidDateStr,
    paymentAccountId: PAYMENT_BANK,
    invoiceTitle: buildTopupInvoiceTitle({ creditAmount: amount }),
    lineItemDescription: buildTopupLineItemDescription({
      creditAmount: amount,
      when: now,
      paymentMethod: 'Bank',
      amount,
      currency,
      creditBefore,
      creditAfter
    }),
    currencyCode: currency
  });
  if (!inv.ok) {
    console.warn('[indoor-admin] manualTopup Bukku invoice failed', inv.error);
    await markTicketTopupCompleted(ticketRowId, clientId);
    return { ok: true, creditlogId: logId, bukku_saas_contact_id: contactId, bukkuInvoice: null, invoiceUrl: null, bukkuError: inv.error };
  }
  let invoiceUrl = inv.invoiceUrl || null;
  const pathId =
    inv.invoiceNumericId != null && Number.isFinite(Number(inv.invoiceNumericId))
      ? Number(inv.invoiceNumericId)
      : inv.invoiceId != null && /^\d+$/.test(String(inv.invoiceId).trim())
        ? Number(inv.invoiceId)
        : null;
  if (!invoiceUrl && pathId != null) {
    const sub = process.env.BUKKU_SAAS_SUBDOMAIN || process.env.BUKKU_SAAS_BUKKUSUBDOMAIN;
    if (sub) invoiceUrl = `https://${String(sub).trim()}.bukku.my/invoices/${pathId}`.replace(/\/+/g, '/');
  }
  if (inv.invoiceId != null || invoiceUrl) {
    await pool.query('UPDATE creditlogs SET invoiceid = ?, invoiceurl = ? WHERE id = ?', [inv.invoiceId != null ? String(inv.invoiceId) : null, invoiceUrl, logId]);
    console.log('[indoor-admin] manualTopup creditlog updated with invoice logId=%s invoiceId=%s', logId, inv.invoiceId);
  }
  await markTicketTopupCompleted(ticketRowId, clientId);
  return { ok: true, creditlogId: logId, bukku_saas_contact_id: contactId, bukkuInvoiceId: inv.invoiceId, invoiceUrl: invoiceUrl || inv.invoiceUrl };
}

/**
 * 手動續費：插 pricingplanlogs (MANUAL, paid)，呼叫 handlePricingPlanPaymentSuccess 會因已 paid 直接 return，
 * 故改為先插 pending、再標 paid 並套用 plan，最後開平台 Bukku cash invoice（product 15, account 70, payment 3）。
 */
async function manualRenew({ clientId, planId, paidDate, staffId = null, remark = null }) {
  console.log('[indoor-admin] manualRenew START clientId=%s planId=%s', clientId, planId);
  if (!clientId || !planId || !paidDate) {
    return { ok: false, reason: 'MISSING_PARAMS' };
  }
  const paidDateStr = toDateOnlyStr(paidDate);
  if (!paidDateStr) return { ok: false, reason: 'INVALID_PAID_DATE' };
  const remarkVal = remark && /^(new_customer|renew|upgrade)$/i.test(String(remark).trim()) ? String(remark).trim().toLowerCase() : null;
  const [clientRows] = await pool.query(
    'SELECT id, title, currency, pricingplandetail, expired, email FROM operatordetail WHERE id = ? LIMIT 1',
    [clientId]
  );
  if (!clientRows.length) return { ok: false, reason: 'CLIENT_NOT_FOUND' };
  const client = clientRows[0];
  console.log('[indoor-admin] manualRenew client found title=%s companyEmail=%s', client.title || '-', client.email ? String(client.email).trim() || '(empty)' : '(null)');
  const [planRows] = await pool.query(
    'SELECT id, title, sellingprice, corecredit FROM pricingplan WHERE id = ? LIMIT 1',
    [planId]
  );
  if (!planRows.length) return { ok: false, reason: 'PLAN_NOT_FOUND' };
  const plan = planRows[0];
  const amount = Number(plan.sellingprice) || 0;
  if (amount <= 0) return { ok: false, reason: 'INVALID_PLAN_AMOUNT' };

  const ppd = parseJson(client.pricingplandetail) || [];
  const currentPlanItem = ppd.find((i) => i.type === 'plan');
  const currentExpired = client.expired ? new Date(client.expired) : null;
  const paid = new Date(paidDateStr);
  const nextYear = new Date(paid.getFullYear() + 1, paid.getMonth(), paid.getDate());
  const newexpireddate = nextYear.toISOString().slice(0, 10);

  const logId = randomUUID();
  const ref = `PLAN-MANUAL-${logId}`;
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await pool.query(
    `INSERT INTO pricingplanlogs (id, client_id, staff_id, plan_id, scenario, amount, addondeductamount, addons_json, newexpireddate, status, title, referencenumber, remark, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'MANUAL', ?, 0, '{}', ?, 'pending', ?, ?, ?, ?, ?)`,
    [logId, clientId, staffId, planId, amount, newexpireddate, plan.title, ref, remarkVal, now, now]
  );
  console.log('[indoor-admin] manualRenew pricingplanlogs INSERTED logId=%s', logId);
  let handleRes;
  try {
    console.log('[indoor-admin] manualRenew calling handlePricingPlanPaymentSuccess logId=%s clientId=%s', logId, clientId);
    handleRes = await handlePricingPlanPaymentSuccess({ pricingplanlogId: logId, clientId });
    console.log('[indoor-admin] manualRenew handlePricingPlanPaymentSuccess DONE ok=%s already=%s', !!handleRes.ok, !!handleRes.already);
  } catch (err) {
    console.error('[indoor-admin] manualRenew handlePricingPlanPaymentSuccess FAILED', err?.message || err);
    throw err;
  }
  if (!handleRes.ok) return handleRes;
  if (handleRes.already) return { ok: false, reason: 'log already paid (duplicate?)' };
  await pool.query(
    'UPDATE pricingplanlogs SET paidat = ? WHERE id = ?',
    [paidDateStr, logId]
  );

  // 開戶：啟用 client（enquiry 註冊時 status=0，開 package 後改為 1 才能進 Company Setting）
  await pool.query('UPDATE operatordetail SET status = 1, updated_at = NOW() WHERE id = ?', [clientId]);
  console.log('[indoor-admin] manualRenew client status=1 DONE clientId=%s', clientId);

  // 開戶：將 company email 寫入 client_user 為 master admin（is_admin=1）
  console.log('[indoor-admin] manualRenew calling ensureMasterAdminUserForClient clientId=%s', clientId);
  await ensureMasterAdminUserForClient(clientId).catch((err) => {
    console.warn('[indoor-admin] manualRenew ensureMasterAdminUserForClient failed (run migration 0116?)', err?.message);
  });
  console.log('[indoor-admin] manualRenew ensureMasterAdminUserForClient call finished clientId=%s', clientId);

  let contactId = null;
  try {
    contactId = (await ensureClientBukkuContact(clientId)) ?? SAAS_CONTACT_ID;
  } catch (e) {
    console.warn('[indoor-admin] manualRenew ensureClientBukkuContact failed', e?.message);
  }
  console.log('[indoor-admin] manualRenew: clientId=', clientId, 'contactId=', contactId, 'logId=', logId);
  if (!contactId) {
    console.warn('[indoor-admin] manualRenew: SaaS platform did not open invoice — no Bukku contact. Ensure BUKKU_SAAS_API_KEY & BUKKU_SAAS_SUBDOMAIN are set; operator-as-customer will search/create contact by operatordetail email+name.');
    return { ok: true, pricingplanlogId: logId, bukku_saas_contact_id: null, bukkuInvoice: null, invoiceUrl: null, reason: 'no Bukku contact (client or default)' };
  }
  const currency = String(client.currency || '').trim().toUpperCase();
  if (!currency) throw new Error('CLIENT_CURRENCY_MISSING');
  if (!['MYR', 'SGD'].includes(currency)) throw new Error('UNSUPPORTED_CLIENT_CURRENCY');
  let inv;
  try {
    inv = await createSaasBukkuCashInvoice({
      contactId,
      productId: PRODUCT_PRICINGPLAN,
      accountId: ACCOUNT_REVENUE,
      amount,
      paidDate: paidDateStr,
      paymentAccountId: PAYMENT_BANK,
      description: buildPlanDescription({
        clientName: client.title,
        when: paidDateStr,
        paymentMethod: 'Bank',
        amount,
        currency,
        planTitle: plan.title
      }),
      currencyCode: currency
    });
  } catch (e) {
    console.warn('[indoor-admin] manualRenew Bukku invoice error (SaaS platform did not open invoice)', e?.message);
    return { ok: true, pricingplanlogId: logId, bukku_saas_contact_id: contactId, bukkuInvoice: null, invoiceUrl: null, bukkuError: e?.message || 'Bukku API error' };
  }
  if (!inv.ok) {
    console.warn('[indoor-admin] manualRenew Bukku invoice failed', inv.error);
    return { ok: true, pricingplanlogId: logId, bukku_saas_contact_id: contactId, bukkuInvoice: null, invoiceUrl: null, bukkuError: inv.error };
  }
  if (inv.invoiceId != null || inv.invoiceUrl) {
    await pool.query('UPDATE pricingplanlogs SET invoiceid = ?, invoiceurl = ? WHERE id = ?', [inv.invoiceId != null ? String(inv.invoiceId) : null, inv.invoiceUrl || null, logId]);
  }
  console.log('[indoor-admin] manualRenew: invoice created', { logId, invoiceId: inv.invoiceId, invoiceUrl: inv.invoiceUrl ? 'present' : 'null' });
  return { ok: true, pricingplanlogId: logId, bukku_saas_contact_id: contactId, bukkuInvoiceId: inv.invoiceId, invoiceUrl: inv.invoiceUrl };
}

/**
 * Portal /enquiry：只插 pricingplanlogs pending，等 Billplz webhook 再 finalize（與 manualRenew 同額、同 newexpireddate 計算）。
 */
async function insertPendingPlanLogForSaasBillplz({ clientId, planId, remark = null }) {
  if (!clientId || !planId) {
    return { ok: false, reason: 'MISSING_PARAMS' };
  }
  const remarkVal = remark && /^(new_customer|renew|upgrade)$/i.test(String(remark).trim()) ? String(remark).trim().toLowerCase() : null;
  const [clientRows] = await pool.query(
    'SELECT id, title, currency, pricingplandetail, expired, email, status FROM operatordetail WHERE id = ? LIMIT 1',
    [clientId]
  );
  if (!clientRows.length) return { ok: false, reason: 'CLIENT_NOT_FOUND' };
  const client = clientRows[0];
  const [planRows] = await pool.query(
    'SELECT id, title, sellingprice, corecredit FROM pricingplan WHERE id = ? LIMIT 1',
    [planId]
  );
  if (!planRows.length) return { ok: false, reason: 'PLAN_NOT_FOUND' };
  const plan = planRows[0];
  const amount = Number(plan.sellingprice) || 0;
  if (amount <= 0) return { ok: false, reason: 'INVALID_PLAN_AMOUNT' };

  const paidDateStr = toDateOnlyStr(new Date());
  if (!paidDateStr) return { ok: false, reason: 'INVALID_PAID_DATE' };
  const paid = new Date(paidDateStr);
  const nextYear = new Date(paid.getFullYear() + 1, paid.getMonth(), paid.getDate());
  const newexpireddate = nextYear.toISOString().slice(0, 10);

  const logId = randomUUID();
  const ref = `PLAN-SAAS-${logId}`;
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await pool.query(
    `INSERT INTO pricingplanlogs (id, client_id, staff_id, plan_id, scenario, amount, addondeductamount, addons_json, newexpireddate, status, title, referencenumber, remark, payload_json, created_at, updated_at)
     VALUES (?, ?, NULL, ?, 'SAAS_BILLPLZ', ?, 0, '{}', ?, 'pending', ?, ?, ?, ?, ?, ?)`,
    [
      logId,
      clientId,
      planId,
      amount,
      newexpireddate,
      plan.title,
      ref,
      remarkVal,
      JSON.stringify({ source: 'saas_billplz_checkout', createdAt: now }),
      now,
      now
    ]
  );
  const currency = String(client.currency || '').trim().toUpperCase();
  return {
    ok: true,
    logId,
    amount,
    amountCents: Math.round(amount * 100),
    planTitle: plan.title,
    currency,
    clientTitle: client.title,
    paidDateStr
  };
}

/**
 * Portal /enquiry 收款成功後（Billplz 或 Xendit）：套用方案 + 開平台 Bukku cash invoice（與 manualRenew 後半一致）。
 * @param {{ pricingplanlogId: string, paidDateStr: string, paymentMethodLabel?: string }} p
 */
async function finalizeSaasPlanAfterBillplzPayment({ pricingplanlogId, paidDateStr, paymentMethodLabel }) {
  const payLabel = String(paymentMethodLabel || 'Billplz').trim() || 'Billplz';
  const [rows] = await pool.query(
    'SELECT id, client_id, plan_id, status, amount, title FROM pricingplanlogs WHERE id = ? LIMIT 1',
    [pricingplanlogId]
  );
  if (!rows.length) return { ok: false, reason: 'LOG_NOT_FOUND' };
  const log = rows[0];
  if (log.status === 'paid') {
    return { ok: true, already: true };
  }
  if (log.status !== 'pending') {
    return { ok: false, reason: 'INVALID_LOG_STATUS' };
  }
  const clientId = log.client_id;
  const planId = log.plan_id;
  const paidStr = toDateOnlyStr(paidDateStr || new Date());
  if (!paidStr) return { ok: false, reason: 'INVALID_PAID_DATE' };

  let handleRes;
  try {
    handleRes = await handlePricingPlanPaymentSuccess({ pricingplanlogId, clientId });
  } catch (err) {
    console.error('[indoor-admin] finalizeSaasPlanAfterBillplzPayment handlePricingPlanPaymentSuccess', err?.message || err);
    throw err;
  }
  if (!handleRes.ok) return handleRes;
  if (handleRes.already) return { ok: true, already: true };

  await pool.query('UPDATE pricingplanlogs SET paidat = ? WHERE id = ?', [paidStr, pricingplanlogId]);
  await pool.query('UPDATE operatordetail SET status = 1, updated_at = NOW() WHERE id = ?', [clientId]);

  await ensureMasterAdminUserForClient(clientId).catch((err) => {
    console.warn('[indoor-admin] finalizeSaasPlanAfterBillplzPayment ensureMasterAdminUserForClient', err?.message);
  });

  const [clientRows] = await pool.query(
    'SELECT id, title, currency, email FROM operatordetail WHERE id = ? LIMIT 1',
    [clientId]
  );
  const client = clientRows[0];
  const [planRows] = await pool.query('SELECT id, title, sellingprice FROM pricingplan WHERE id = ? LIMIT 1', [planId]);
  const plan = planRows[0];
  const amount = Number(log.amount) || Number(plan?.sellingprice) || 0;

  let contactId = null;
  try {
    contactId = (await ensureClientBukkuContact(clientId)) ?? SAAS_CONTACT_ID;
  } catch (e) {
    console.warn('[indoor-admin] finalizeSaasPlanAfterBillplzPayment ensureClientBukkuContact', e?.message);
  }
  if (!contactId) {
    console.warn('[indoor-admin] finalizeSaasPlanAfterBillplzPayment no Bukku contact');
    return { ok: true, pricingplanlogId, bukkuInvoice: null, reason: 'no Bukku contact (client or default)' };
  }
  const currency = String(client.currency || '').trim().toUpperCase();
  if (!currency) return { ok: false, reason: 'CLIENT_CURRENCY_MISSING' };
  if (!['MYR', 'SGD'].includes(currency)) return { ok: false, reason: 'UNSUPPORTED_CLIENT_CURRENCY' };

  let inv;
  try {
    inv = await createSaasBukkuCashInvoice({
      contactId,
      productId: PRODUCT_PRICINGPLAN,
      accountId: ACCOUNT_REVENUE,
      amount,
      paidDate: paidStr,
      paymentAccountId: PAYMENT_BANK,
      description: buildPlanDescription({
        clientName: client.title,
        when: paidStr,
        paymentMethod: payLabel,
        amount,
        currency,
        planTitle: plan?.title || log.title
      }),
      currencyCode: currency
    });
  } catch (e) {
    console.warn('[indoor-admin] finalizeSaasPlanAfterBillplzPayment Bukku error', e?.message);
    return { ok: true, pricingplanlogId, bukkuError: e?.message || 'Bukku API error' };
  }
  if (!inv.ok) {
    return { ok: true, pricingplanlogId, bukkuError: inv.error };
  }
  if (inv.invoiceId != null || inv.invoiceUrl) {
    await pool.query('UPDATE pricingplanlogs SET invoiceid = ?, invoiceurl = ? WHERE id = ?', [
      inv.invoiceId != null ? String(inv.invoiceId) : null,
      inv.invoiceUrl || null,
      pricingplanlogId
    ]);
  }
  return { ok: true, pricingplanlogId, bukkuInvoiceId: inv.invoiceId, invoiceUrl: inv.invoiceUrl };
}

const CNYIOT_SALES_USER_PASSWORD = '0123456789';

/**
 * Manual billing：把售电员户口 id 存入 client_integration（人工在 CNYIOT 后台开售电员后，在此输入 user id，密码固定 0123456789）。
 * 创建或更新 client_integration (key=meter, provider=cnyiot)，写入 cnyiot_username/cnyiot_password 与 cnyiot_sales_user_id，enabled=1。
 */
async function saveCnyiotSalesUser(clientId, cnyiotUserId) {
  if (!clientId || !cnyiotUserId || String(cnyiotUserId).trim() === '') {
    throw new Error('CLIENT_ID_AND_CNYIOT_USER_ID_REQUIRED');
  }
  const uid = String(cnyiotUserId).trim();
  const [rows] = await pool.query(
    `SELECT id, values_json FROM client_integration WHERE client_id = ? AND \`key\` = 'meter' AND provider = 'cnyiot' LIMIT 1`,
    [clientId]
  );
  const existing = rows[0];
  const valuesMerge = {
    cnyiot_username: uid,
    cnyiot_password: CNYIOT_SALES_USER_PASSWORD,
    cnyiot_sales_user_id: uid,
    cnyiot_sales_user_password: CNYIOT_SALES_USER_PASSWORD,
    cnyiot_mode: 'sales_manual'
  };
  const values = existing?.values_json
    ? { ...(typeof existing.values_json === 'string' ? JSON.parse(existing.values_json) : existing.values_json), ...valuesMerge }
    : valuesMerge;
  const valuesStr = JSON.stringify(values);
  if (existing) {
    await pool.query(
      'UPDATE client_integration SET values_json = ?, enabled = 1, updated_at = NOW() WHERE id = ?',
      [valuesStr, existing.id]
    );
    return { ok: true };
  }
  const id = randomUUID();
  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  await pool.query(
    `INSERT INTO client_integration (id, client_id, \`key\`, version, slot, enabled, provider, values_json, einvoice, created_at, updated_at)
     VALUES (?, ?, 'meter', 1, 0, 1, 'cnyiot', ?, NULL, ?, ?)`,
    [id, clientId, valuesStr, now, now]
  );
  return { ok: true };
}

/**
 * 僅確保 client 在平台 Bukku 有 contact（先按 email/legal name 查，有則回傳 id 並寫回 operatordetail；無則新建並寫回）。
 * SaaS Admin 在「建立新 plan」或「topup」前可呼叫，取得 bukku_saas_contact_id 後即可開單。
 * @param {{ clientId: string }}
 * @returns {{ ok: boolean, bukku_saas_contact_id?: number|null, reason?: string }}
 */
async function ensureBukkuContactForClient({ clientId }) {
  if (!clientId) return { ok: false, reason: 'MISSING_CLIENT_ID' };
  const [rows] = await pool.query(
    'SELECT id, title, email FROM operatordetail WHERE id = ? LIMIT 1',
    [clientId]
  );
  if (!rows.length) return { ok: false, reason: 'CLIENT_NOT_FOUND' };
  let contactId = null;
  try {
    contactId = (await ensureClientBukkuContact(clientId)) ?? SAAS_CONTACT_ID;
  } catch (e) {
    console.warn('[indoor-admin] ensureBukkuContactForClient failed', e?.message);
    return { ok: false, reason: e?.message || 'Bukku contact ensure failed' };
  }
  return { ok: true, bukku_saas_contact_id: contactId ?? null };
}

module.exports = {
  manualTopup,
  manualRenew,
  insertPendingPlanLogForSaasBillplz,
  finalizeSaasPlanAfterBillplzPayment,
  saveCnyiotSalesUser,
  ensureBukkuContactForClient,
  ensureMasterAdminUserForClient
};
