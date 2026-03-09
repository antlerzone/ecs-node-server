/**
 * SaaS indoor admin：手動 topup、手動 renew。
 * 先寫入 DB，成功後再於平台 Bukku 開 cash invoice（僅 manual 時開單，收款用 Bank=3）。
 */

const pool = require('../../config/db');
const { randomUUID } = require('crypto');
const { addClientCredit } = require('../stripe/stripe.service');
const { handlePricingPlanPaymentSuccess } = require('./checkout.service');
const {
  createSaasBukkuCashInvoice,
  buildTopupDescription,
  buildPlanDescription,
  ensureClientBukkuContact,
  PRODUCT_PRICINGPLAN,
  PRODUCT_TOPUPCREDIT,
  ACCOUNT_REVENUE,
  PAYMENT_BANK
} = require('./saas-bukku.service');

const SAAS_CONTACT_ID = process.env.BUKKU_SAAS_DEFAULT_CONTACT_ID
  ? Number(process.env.BUKKU_SAAS_DEFAULT_CONTACT_ID)
  : null;

/** 示範公司 client_id；enquiry 時訪客 staff 掛在此下，開戶時移轉到自家 client。 */
const DEMO_CLIENT_ID = process.env.DEMO_CLIENT_ID || 'a0000001-0001-4000-8000-000000000001';

/**
 * 開戶時：從 clientdetail 取 company email，若該 email 在 staffdetail 裡是掛在 demoaccount 下，則移轉到本 client 並設為 master admin；
 * 否則若本 client 下已有同 email 的 staff 則設 is_master=1；否則新增一筆 master admin。
 * master admin = is_master=1，不可刪。
 */
async function ensureMasterAdminStaffForClient(clientId) {
  const [clientRows] = await pool.query(
    'SELECT id, title, email FROM clientdetail WHERE id = ? LIMIT 1',
    [clientId]
  );
  if (!clientRows.length) return;
  const client = clientRows[0];
  const companyEmail = client.email && String(client.email).trim();
  if (!companyEmail) return;

  const normalizedEmail = companyEmail.toLowerCase();
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const permissionJson = JSON.stringify(['admin']);

  // 1) 該 email 是否在 demoaccount 下？是則移轉到本 client（從 demo 轉到自家公司）
  const [underDemo] = await pool.query(
    'SELECT id FROM staffdetail WHERE client_id = ? AND LOWER(TRIM(email)) = ? LIMIT 1',
    [DEMO_CLIENT_ID, normalizedEmail]
  );
  if (underDemo.length) {
    await pool.query(
      'UPDATE staffdetail SET client_id = ?, is_master = 1, status = 1, updated_at = ? WHERE id = ?',
      [clientId, now, underDemo[0].id]
    );
    return;
  }

  // 2) 本 client 下是否已有同 email 的 staff？
  const [existing] = await pool.query(
    'SELECT id, is_master, status FROM staffdetail WHERE client_id = ? AND LOWER(TRIM(email)) = ? LIMIT 1',
    [clientId, normalizedEmail]
  );
  if (existing.length) {
    const s = existing[0];
    const needUpdate = (s.is_master !== 1 && s.is_master !== true) || (s.status !== 1 && s.status !== true);
    if (needUpdate) {
      await pool.query(
        'UPDATE staffdetail SET is_master = 1, status = 1, updated_at = ? WHERE id = ?',
        [now, s.id]
      );
    }
    return;
  }

  // 3) 新增一筆 master admin
  const staffId = randomUUID();
  await pool.query(
    `INSERT INTO staffdetail (id, client_id, email, name, permission_json, status, is_master, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)`,
    [staffId, clientId, companyEmail, (client.title || companyEmail.split('@')[0] || 'Admin').trim(), permissionJson, now, now]
  );
}

function parseJson(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

/** Normalise paidDate (ISO string, Date.toString(), or YYYY-MM-DD) to YYYY-MM-DD for MySQL. */
function toDateOnlyStr(val) {
  if (val == null || val === '') return '';
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 手動充值：寫 creditlogs + 加 client_credit，成功後開平台 Bukku cash invoice（product 16, account 70, payment 3）。
 * @param {{ clientId: string, amount: number, paidDate: string (YYYY-MM-DD), staffId?: string }}
 */
async function manualTopup({ clientId, amount, paidDate, staffId = null }) {
  if (!clientId || amount == null || amount <= 0 || !paidDate) {
    return { ok: false, reason: 'MISSING_PARAMS' };
  }
  const paidDateStr = toDateOnlyStr(paidDate);
  if (!paidDateStr) return { ok: false, reason: 'INVALID_PAID_DATE' };
  const [clientRows] = await pool.query(
    'SELECT id, title, currency FROM clientdetail WHERE id = ? LIMIT 1',
    [clientId]
  );
  if (!clientRows.length) return { ok: false, reason: 'CLIENT_NOT_FOUND' };
  const client = clientRows[0];
  const currency = String(client.currency || '').toUpperCase() === 'SGD' ? 'SGD' : 'MYR';

  const [[creditRow]] = await pool.query('SELECT amount FROM client_credit WHERE client_id = ? LIMIT 1', [clientId]);
  const creditBefore = creditRow ? Number(creditRow.amount) || 0 : 0;
  const creditAfter = creditBefore + amount;

  const logId = randomUUID();
  const ref = `TP-MANUAL-${logId}`;
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO creditlogs (id, title, type, client_id, staff_id, currency, payment, amount, is_paid, reference_number, paiddate, created_at, updated_at)
       VALUES (?, ?, 'Topup', ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      [logId, `Manual topup ${amount}`, clientId, staffId, currency, amount, amount, ref, paidDateStr, now, now]
    );
    await addClientCredit(clientId, amount, conn);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  const contactId = (await ensureClientBukkuContact(clientId)) ?? SAAS_CONTACT_ID;
  if (!contactId) {
    return { ok: true, creditlogId: logId, bukkuInvoice: null, reason: 'no Bukku contact (client or default)' };
  }
  const inv = await createSaasBukkuCashInvoice({
    contactId,
    productId: PRODUCT_TOPUPCREDIT,
    accountId: ACCOUNT_REVENUE,
    amount,
    paidDate: paidDateStr,
    paymentAccountId: PAYMENT_BANK,
    description: buildTopupDescription({
      clientName: client.title,
      when: paidDateStr,
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
    return { ok: true, creditlogId: logId, bukkuInvoice: null, bukkuError: inv.error };
  }
  if (inv.invoiceId != null || inv.invoiceUrl) {
    await pool.query('UPDATE creditlogs SET invoiceid = ?, invoiceurl = ? WHERE id = ?', [inv.invoiceId != null ? String(inv.invoiceId) : null, inv.invoiceUrl || null, logId]);
  }
  return { ok: true, creditlogId: logId, bukkuInvoiceId: inv.invoiceId, invoiceUrl: inv.invoiceUrl };
}

/**
 * 手動續費：插 pricingplanlogs (MANUAL, paid)，呼叫 handlePricingPlanPaymentSuccess 會因已 paid 直接 return，
 * 故改為先插 pending、再標 paid 並套用 plan，最後開平台 Bukku cash invoice（product 15, account 70, payment 3）。
 */
async function manualRenew({ clientId, planId, paidDate, staffId = null }) {
  if (!clientId || !planId || !paidDate) {
    return { ok: false, reason: 'MISSING_PARAMS' };
  }
  const paidDateStr = toDateOnlyStr(paidDate);
  if (!paidDateStr) return { ok: false, reason: 'INVALID_PAID_DATE' };
  const [clientRows] = await pool.query(
    'SELECT id, title, currency, pricingplandetail, expired FROM clientdetail WHERE id = ? LIMIT 1',
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
    `INSERT INTO pricingplanlogs (id, client_id, staff_id, plan_id, scenario, amount, addondeductamount, addons_json, newexpireddate, status, title, referencenumber, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'MANUAL', ?, 0, '{}', ?, 'pending', ?, ?, ?, ?)`,
    [logId, clientId, staffId, planId, amount, newexpireddate, plan.title, ref, now, now]
  );
  const handleRes = await handlePricingPlanPaymentSuccess({ pricingplanlogId: logId, clientId });
  if (!handleRes.ok) return handleRes;
  if (handleRes.already) return { ok: false, reason: 'log already paid (duplicate?)' };
  await pool.query(
    'UPDATE pricingplanlogs SET paidat = ? WHERE id = ?',
    [paidDateStr, logId]
  );

  // 開戶：啟用 client（enquiry 註冊時 status=0，開 package 後改為 1 才能進 Company Setting）
  await pool.query('UPDATE clientdetail SET status = 1, updated_at = NOW() WHERE id = ?', [clientId]);

  // 開戶：將 company email 設為 default master admin（不可刪）；若 staff 在 demo 下則移轉到本 client
  await ensureMasterAdminStaffForClient(clientId).catch((err) => {
    console.warn('[indoor-admin] ensureMasterAdminStaffForClient failed (run migration 0081?)', err?.message);
  });

  const contactId = (await ensureClientBukkuContact(clientId)) ?? SAAS_CONTACT_ID;
  if (!contactId) {
    return { ok: true, pricingplanlogId: logId, bukkuInvoice: null, reason: 'no Bukku contact (client or default)' };
  }
  const currency = String(client.currency || '').toUpperCase() === 'SGD' ? 'SGD' : 'MYR';
  const inv = await createSaasBukkuCashInvoice({
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
  if (!inv.ok) {
    console.warn('[indoor-admin] manualRenew Bukku invoice failed', inv.error);
    return { ok: true, pricingplanlogId: logId, bukkuInvoice: null, bukkuError: inv.error };
  }
  if (inv.invoiceId != null || inv.invoiceUrl) {
    await pool.query('UPDATE pricingplanlogs SET invoiceid = ?, invoiceurl = ? WHERE id = ?', [inv.invoiceId != null ? String(inv.invoiceId) : null, inv.invoiceUrl || null, logId]);
  }
  return { ok: true, pricingplanlogId: logId, bukkuInvoiceId: inv.invoiceId, invoiceUrl: inv.invoiceUrl };
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

module.exports = {
  manualTopup,
  manualRenew,
  saveCnyiotSalesUser
};
