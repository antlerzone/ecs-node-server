/**
 * Referral commission_release rows for Operator Approval + Commission page.
 * Table: commission_release (migrations 0106, 0107, 0173).
 * Mark paid: Referral account line (account table "Referral Fees" / referral) + Bukku banking expense (money out) or Xero SPEND.
 */

const { randomUUID } = require('crypto');
const pool = require('../../config/db');
const {
  resolveClientAccounting,
  getAccountMapping,
  getPaymentDestinationAccountId,
  getAccountIdByPaymentType,
  getClientCurrencyCode,
  findXeroBankAccountRef
} = require('../rentalcollection-invoice/rentalcollection-invoice.service');
const {
  ensureContactInAccounting,
  writeStaffAccount,
  resolvePortalPhoneForEmail
} = require('../contact/contact-sync.service');
const { resolveXeroAccountCode } = require('../xero/lib/accountCodeResolver');
const bukkuBankingExpense = require('../bukku/wrappers/bankingExpense.wrapper');
const xeroBankTransaction = require('../xero/wrappers/banktransaction.wrapper');
const { recordAccountingError } = require('../help/help.service');

function parseJson(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

function toMysqlDateOnly(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function findCommissionLine(billing) {
  if (!Array.isArray(billing)) return null;
  return billing.find((x) => x && String(x.type || '').toLowerCase() === 'commission') || null;
}

function toErrorText(err) {
  if (err == null) return '';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message || String(err);
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function isIgnorableXeroBankTxnDeleteError(err) {
  const msg = toErrorText(err).toLowerCase();
  return msg.includes('not found') || msg.includes('does not exist') || msg.includes('already deleted');
}

/**
 * Ensure staff exists in accounting as payee; writes staffdetail.account mapping.
 */
async function ensureStaffContactForCommission(clientId, provider, staffId) {
  const [staffRows] = await pool.query(
    'SELECT id, name, email, account FROM staffdetail WHERE id = ? AND client_id = ? LIMIT 1',
    [staffId, clientId]
  );
  if (!staffRows.length) return { ok: false, reason: 'STAFF_NOT_FOUND' };
  const s = staffRows[0];
  const account = parseJson(s.account) || [];
  const existingMapping = account.find((a) => a.clientId === clientId && a.provider === provider);
  const existingId = existingMapping?.id ?? existingMapping?.contactId;
  const portalPhone = await resolvePortalPhoneForEmail(s.email);
  const record = {
    name: (s.name || '').trim(),
    fullname: (s.name || '').trim(),
    email: (s.email || '').trim().toLowerCase(),
    phone: portalPhone || ''
  };
  const syncRes = await ensureContactInAccounting(clientId, provider, 'staff', record, existingId);
  if (!syncRes.ok) return { ok: false, reason: syncRes.reason || 'STAFF_CONTACT_FAILED' };
  await writeStaffAccount(staffId, clientId, provider, syncRes.contactId);
  return { ok: true, contactId: syncRes.contactId };
}

/**
 * Post referral payout: DR Referral (expense line), CR Bank/Cash. Bukku = banking/expenses; Xero = SPEND.
 */
async function postCommissionReferralAccounting(clientId, commissionRow, payload) {
  const skipAccounting = payload?.skipAccounting === true;
  if (skipAccounting) {
    return { ok: true, skipped: true };
  }

  const resolved = await resolveClientAccounting(clientId);
  if (!resolved.ok || !resolved.req) {
    return { ok: true, skipped: true, skipReason: resolved.reason || 'NO_ACCOUNTING' };
  }

  const provider = String(resolved.provider || '').toLowerCase();
  if (provider !== 'bukku' && provider !== 'xero') {
    return { ok: true, skipped: true, skipReason: `PROVIDER_NOT_BUKKU_XERO:${provider}` };
  }

  const staffId = payload.staff_id != null ? String(payload.staff_id).trim() : commissionRow.staff_id;
  if (!staffId) return { ok: false, reason: 'STAFF_REQUIRED', required: true };

  const amount =
    payload.release_amount != null && payload.release_amount !== ''
      ? Number(payload.release_amount)
      : commissionRow.release_amount != null
        ? Number(commissionRow.release_amount)
        : Number(commissionRow.commission_amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: 'INVALID_RELEASE_AMOUNT', required: true };
  }

  const paymentMethodKey = String(payload.payment_method || 'bank').toLowerCase() === 'cash' ? 'cash' : 'bank';
  const dateStr =
    payload.release_date != null && String(payload.release_date).trim() !== ''
      ? String(payload.release_date).trim().slice(0, 10)
      : commissionRow.release_date
        ? String(commissionRow.release_date).slice(0, 10)
        : new Date().toISOString().slice(0, 10);

  const typeId = await getAccountIdByPaymentType('referral');
  if (!typeId) return { ok: false, reason: 'REFERRAL_ACCOUNT_TEMPLATE_MISSING', required: true };
  const referralMapping = await getAccountMapping(clientId, typeId, provider);
  if (!referralMapping?.accountId) {
    return { ok: false, reason: 'REFERRAL_ACCOUNT_MAPPING_MISSING', required: true };
  }

  let payFromDest = await getPaymentDestinationAccountId(clientId, provider, paymentMethodKey);
  if ((!payFromDest || !payFromDest.accountId) && paymentMethodKey === 'cash') {
    payFromDest = await getPaymentDestinationAccountId(clientId, provider, 'bank');
  }
  if (!payFromDest?.accountId) {
    return {
      ok: false,
      reason:
        paymentMethodKey === 'cash'
          ? 'NO_CASH_OR_BANK_ACCOUNT_MAPPING'
          : 'NO_BANK_ACCOUNT_MAPPING',
      required: true
    };
  }

  const contactRes = await ensureStaffContactForCommission(clientId, provider, staffId);
  if (!contactRes.ok) return { ok: false, reason: contactRes.reason || 'STAFF_CONTACT_FAILED', required: true };

  const { req } = resolved;
  const descBase = [
    'Referral commission',
    commissionRow.property_shortname,
    commissionRow.room_title,
    commissionRow.tenant_name
  ]
    .filter(Boolean)
    .join(' | ')
    .slice(0, 250);
  const currencyCode = await getClientCurrencyCode(clientId);

  try {
    if (provider === 'bukku') {
      const payloadB = {
        contact_id: Number(contactRes.contactId),
        date: dateStr,
        currency_code: currencyCode,
        exchange_rate: 1,
        tax_mode: 'exclusive',
        description: descBase || 'Referral commission',
        remarks: `Payment method: ${paymentMethodKey}`.slice(0, 255),
        bank_items: [
          {
            line: 1,
            account_id: Number(referralMapping.accountId),
            description: descBase || 'Referral commission',
            amount,
            tax_code_id: null
          }
        ],
        deposit_items: [{ account_id: Number(payFromDest.accountId), amount }],
        status: 'ready'
      };
      const res = await bukkuBankingExpense.create(req, payloadB);
      const id =
        res?.data?.transaction?.id ?? res?.data?.id ?? res?.id ?? res?.data?.transaction_id ?? null;
      if (res?.ok !== true || id == null || String(id).trim() === '') {
        const reason = toErrorText(res?.error) || 'BUKKU_BANKING_EXPENSE_FAILED';
        recordAccountingError(clientId, {
          context: 'commission_referral_bukku',
          reason,
          ids: [commissionRow.id],
          provider: 'bukku'
        }).catch(() => {});
        return { ok: false, reason: `BUKKU_MONEY_OUT_FAILED: ${reason}`, required: true };
      }
      return { ok: true, bukkuExpenseId: String(id), provider: 'bukku' };
    }

    if (provider === 'xero') {
      const referralCode = await resolveXeroAccountCode(req, referralMapping.accountId);
      if (!referralCode) {
        return { ok: false, reason: 'XERO_REFERRAL_ACCOUNT_CODE_REQUIRED', required: true };
      }
      const mappedPayFromRaw = payFromDest && payFromDest.accountId ? String(payFromDest.accountId).trim() : '';
      const mappedPayFromCode = mappedPayFromRaw ? await resolveXeroAccountCode(req, mappedPayFromRaw) : '';
      const envDefault = String(process.env.XERO_DEFAULT_BANK_ACCOUNT_CODE || '').trim();
      const bankRef = await findXeroBankAccountRef(req, [mappedPayFromRaw, mappedPayFromCode, envDefault]);
      if (!bankRef) {
        return {
          ok: false,
          reason:
            'NO_XERO_BANK_ACCOUNT: map Bank/Cash in accounting settings or set XERO_DEFAULT_BANK_ACCOUNT_CODE',
          required: true
        };
      }
      const contactId = String(contactRes.contactId || '').trim();
      const isGuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(contactId);
      const [sn] = await pool.query('SELECT name FROM staffdetail WHERE id = ? AND client_id = ? LIMIT 1', [
        staffId,
        clientId
      ]);
      const staffName = (sn[0]?.name || '').trim();
      const payloadX = {
        Type: 'SPEND',
        Contact: isGuid ? { ContactID: contactId } : { Name: staffName || 'Staff' },
        BankAccount: bankRef,
        Date: dateStr,
        Reference: (descBase || 'Referral commission').slice(0, 255),
        LineItems: [
          {
            Description: (descBase || 'Referral commission').slice(0, 500),
            Quantity: 1,
            UnitAmount: amount,
            AccountCode: referralCode
          }
        ]
      };
      const res = await xeroBankTransaction.createBankTransaction(req, payloadX);
      if (!res || !res.ok) {
        const reason = toErrorText(res?.error) || 'XERO_SPEND_FAILED';
        recordAccountingError(clientId, {
          context: 'commission_referral_xero',
          reason,
          ids: [commissionRow.id],
          provider: 'xero'
        }).catch(() => {});
        return { ok: false, reason: `XERO_SPENDING_FAILED: ${reason}`, required: true };
      }
      const bt = res.data?.BankTransactions?.[0];
      const xeroId = bt?.BankTransactionID ?? bt?.BankTransactionId;
      if (!xeroId) {
        return { ok: false, reason: 'XERO_BANK_TXN_ID_MISSING', required: true };
      }
      return { ok: true, xeroBankTransactionId: String(xeroId), provider: 'xero' };
    }
  } catch (e) {
    recordAccountingError(clientId, {
      context: 'commission_referral_exception',
      reason: e?.message || String(e),
      ids: [commissionRow.id],
      provider
    }).catch(() => {});
    return { ok: false, reason: e?.message || 'COMMISSION_ACCOUNTING_EXCEPTION', required: true };
  }

  return { ok: false, reason: 'UNSUPPORTED_PROVIDER', required: true };
}

/**
 * Void Bukku money out / Xero SPEND when reverting paid → pending.
 */
async function voidCommissionAccounting(clientId, row, voidReasonLabel = 'Void referral commission payout') {
  const resolved = await resolveClientAccounting(clientId);
  if (!resolved.ok || !resolved.req) {
    return { ok: true, skippedVoid: true };
  }
  const provider = String(resolved.provider || '').toLowerCase();
  const { req } = resolved;
  const bukkuId = row.bukku_expense_id ? String(row.bukku_expense_id).trim() : '';
  const xeroId = row.xero_bank_transaction_id ? String(row.xero_bank_transaction_id).trim() : '';

  try {
    if (provider === 'bukku' && bukkuId) {
      const moneyOutVoidRes = await bukkuBankingExpense.updateStatus(req, bukkuId, {
        status: 'void',
        void_reason: voidReasonLabel
      });
      if (moneyOutVoidRes?.ok !== true) {
        return { ok: false, reason: 'BUKKU_VOID_FAILED', detail: toErrorText(moneyOutVoidRes?.error) };
      }
    }
    if (provider === 'xero' && xeroId) {
      const delRes = await xeroBankTransaction.deleteBankTransaction(req, xeroId);
      if (!delRes?.ok) {
        const updDeleted = await xeroBankTransaction.updateBankTransactionStatus(req, xeroId, 'DELETED');
        if (!updDeleted?.ok) {
          const updVoided = await xeroBankTransaction.updateBankTransactionStatus(req, xeroId, 'VOIDED');
          if (!updVoided?.ok && !isIgnorableXeroBankTxnDeleteError(delRes?.error)) {
            return { ok: false, reason: `VOID_XERO_SPEND_FAILED: ${toErrorText(delRes?.error)}` };
          }
        }
      }
    }
  } catch (e) {
    if (provider === 'xero' && !isIgnorableXeroBankTxnDeleteError(e)) {
      return { ok: false, reason: `VOID_XERO_EXCEPTION: ${e?.message || e}` };
    }
    if (provider === 'bukku') {
      return { ok: false, reason: `VOID_BUKKU_EXCEPTION: ${e?.message || e}` };
    }
  }

  return { ok: true };
}

/**
 * Undo a paid commission payout (UI Void action): void Bukku money out / Xero SPEND, then status=pending and clear refs.
 */
async function voidCommissionRelease(clientId, id, voidReason) {
  if (!clientId || !id) return { ok: false, reason: 'MISSING_PARAMS' };
  let rows;
  try {
    [rows] = await pool.query(
      `SELECT id, status, remark, bukku_expense_id, xero_bank_transaction_id FROM commission_release WHERE id = ? AND client_id = ? LIMIT 1`,
      [id, clientId]
    );
  } catch (e) {
    if (isMissingXeroColumn(e)) {
      [rows] = await pool.query(
        `SELECT id, status, remark, bukku_expense_id FROM commission_release WHERE id = ? AND client_id = ? LIMIT 1`,
        [id, clientId]
      );
      if (rows[0]) rows[0].xero_bank_transaction_id = null;
    } else {
      throw e;
    }
  }
  const row = rows[0];
  if (!row) return { ok: false, reason: 'NOT_FOUND' };
  if (String(row.status || '').toLowerCase() !== 'paid') return { ok: false, reason: 'NOT_PAID' };

  const voidRes = await voidCommissionAccounting(
    clientId,
    row,
    String(voidReason || 'Revert referral payout to pending').slice(0, 255)
  );
  if (!voidRes.ok) return voidRes;

  const extra =
    voidReason != null && String(voidReason).trim()
      ? `\n[Reverted to pending] ${String(voidReason).trim()}`
      : '\n[Reverted to pending]';
  const remark = row.remark ? `${row.remark}${extra}`.trim() : extra.trim();

  try {
    await pool.query(
      `UPDATE commission_release SET status = 'pending', bukku_expense_id = NULL, xero_bank_transaction_id = NULL, remark = ?, updated_at = NOW() WHERE id = ? AND client_id = ?`,
      [remark, id, clientId]
    );
  } catch (e) {
    if (isMissingXeroColumn(e)) {
      await pool.query(
        `UPDATE commission_release SET status = 'pending', bukku_expense_id = NULL, remark = ?, updated_at = NOW() WHERE id = ? AND client_id = ?`,
        [remark, id, clientId]
      );
    } else {
      throw e;
    }
  }
  return { ok: true };
}

/**
 * Open link for Bukku banking expense (money out) when bukku_expense_id is set.
 */
async function getCommissionReleaseReceiptUrl(clientId, id) {
  if (!clientId || !id) return { ok: false, reason: 'MISSING_PARAMS' };
  const [rows] = await pool.query(
    'SELECT bukku_expense_id FROM commission_release WHERE id = ? AND client_id = ? LIMIT 1',
    [id, clientId]
  );
  if (!rows.length) return { ok: false, reason: 'NOT_FOUND' };
  const expId = rows[0].bukku_expense_id ? String(rows[0].bukku_expense_id).trim() : '';
  if (!expId) return { ok: false, reason: 'NO_BUKKU_EXPENSE' };

  const resolved = await resolveClientAccounting(clientId);
  if (!resolved.ok || resolved.provider !== 'bukku' || !resolved.req) {
    return { ok: false, reason: 'NO_BUKKU_CREDENTIALS' };
  }
  const readRes = await bukkuBankingExpense.read(resolved.req, expId);
  const tx = readRes?.data?.transaction || readRes?.data;
  const shortLink =
    tx?.short_link != null && String(tx.short_link).trim() !== ''
      ? String(tx.short_link).trim()
      : null;
  const sub = resolved.req?.client?.bukku_subdomain
    ? String(resolved.req.client.bukku_subdomain).trim()
    : '';
  const url =
    shortLink || (sub ? `https://${sub}.bukku.my/banking/expenses/${encodeURIComponent(expId)}` : null);
  if (!url) return { ok: false, reason: 'NO_RECEIPT_URL' };
  return { ok: true, url };
}

function isMissingXeroColumn(err) {
  const msg = String(err?.sqlMessage || err?.message || '');
  return msg.includes('xero_bank_transaction_id') || msg.includes('Unknown column');
}

/**
 * Create or skip commission_release for a tenancy when there is commission + submitby staff.
 * Idempotent: one row per tenancy_id.
 */
async function upsertCommissionReleaseForTenancy(clientId, tenancyId) {
  if (!clientId || !tenancyId) return { ok: false, reason: 'MISSING_PARAMS' };
  try {
    const [existing] = await pool.query(
      'SELECT id FROM commission_release WHERE tenancy_id = ? AND client_id = ? LIMIT 1',
      [tenancyId, clientId]
    );
    if (existing.length) return { ok: true, skipped: true, reason: 'ALREADY_EXISTS' };

    const [tRows] = await pool.query(
      `SELECT t.id, t.tenant_id, t.room_id, t.client_id, t.submitby_id, t.begin, t.\`end\`,
              t.billing_json, t.commission_snapshot_json,
              r.title_fld AS room_title_fld,
              p.id AS property_id, p.shortname AS property_shortname,
              tn.fullname AS tenant_fullname
       FROM tenancy t
       LEFT JOIN roomdetail r ON r.id = t.room_id
       LEFT JOIN propertydetail p ON p.id = r.property_id
       LEFT JOIN tenantdetail tn ON tn.id = t.tenant_id
       WHERE t.id = ? AND t.client_id = ? LIMIT 1`,
      [tenancyId, clientId]
    );
    if (!tRows.length) return { ok: false, reason: 'TENANCY_NOT_FOUND' };
    const t = tRows[0];
    if (!t.submitby_id) return { ok: true, skipped: true, reason: 'NO_SUBMITBY_STAFF' };

    const billing = parseJson(t.billing_json);
    const line = findCommissionLine(billing);
    const snap = parseJson(t.commission_snapshot_json);
    let amount = 0;
    let chargeon = 'owner';
    let dueBy = null;

    if (line && Number(line.amount) > 0) {
      amount = Number(line.amount);
      chargeon = line.chargeon === 'tenant' ? 'tenant' : 'owner';
      dueBy = toMysqlDateOnly(line.dueDate) || toMysqlDateOnly(t.begin);
    } else if (Array.isArray(snap) && snap.length && Number(snap[0].amount) > 0) {
      amount = Number(snap[0].amount);
      chargeon = snap[0].chargeon === 'tenant' ? 'tenant' : 'owner';
      dueBy = toMysqlDateOnly(t.begin);
    } else {
      return { ok: true, skipped: true, reason: 'NO_COMMISSION_AMOUNT' };
    }

    const checkin = toMysqlDateOnly(t.begin);
    const checkout = toMysqlDateOnly(t.end);
    const id = randomUUID();
    const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

    await pool.query(
      `INSERT INTO commission_release (
        id, tenancy_id, client_id, property_id, room_id, tenant_id,
        property_shortname, room_title, tenant_name,
        checkin_date, checkout_date, commission_amount, chargeon, due_by_date,
        staff_id, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [
        id,
        tenancyId,
        clientId,
        t.property_id || null,
        t.room_id || null,
        t.tenant_id || null,
        t.property_shortname || null,
        t.room_title_fld || null,
        t.tenant_fullname || null,
        checkin,
        checkout,
        amount,
        chargeon,
        dueBy,
        t.submitby_id,
        now,
        now
      ]
    );
    return { ok: true, inserted: true, id };
  } catch (err) {
    const msg = String(err?.sqlMessage || err?.message || err || '');
    if (/doesn't exist|Unknown table|ER_NO_SUCH_TABLE/i.test(msg)) {
      console.warn('[commission-release] table missing — run migrations 0106/0107:', msg);
      return { ok: false, reason: 'MIGRATION_REQUIRED' };
    }
    console.error('[commission-release] upsertCommissionReleaseForTenancy', err);
    throw err;
  }
}

/**
 * List commission_release for client (Admin list / Approval / Commission page).
 */
async function listCommissionRelease(clientId) {
  if (!clientId) return [];
  let rows;
  try {
    [rows] = await pool.query(
      `SELECT cr.id, cr.tenancy_id, cr.client_id, cr.property_id, cr.room_id, cr.tenant_id,
              cr.property_shortname, cr.room_title, cr.tenant_name,
              cr.checkin_date, cr.checkout_date, cr.commission_amount, cr.chargeon, cr.due_by_date,
              cr.release_amount, cr.release_date, cr.status, cr.remark, cr.staff_id, cr.bukku_expense_id,
              cr.xero_bank_transaction_id,
              cr.created_at, cr.updated_at
       FROM commission_release cr
       WHERE cr.client_id = ?
       ORDER BY cr.created_at DESC
       LIMIT 1000`,
      [clientId]
    );
  } catch (err) {
    if (isMissingXeroColumn(err)) {
      [rows] = await pool.query(
        `SELECT cr.id, cr.tenancy_id, cr.client_id, cr.property_id, cr.room_id, cr.tenant_id,
                cr.property_shortname, cr.room_title, cr.tenant_name,
                cr.checkin_date, cr.checkout_date, cr.commission_amount, cr.chargeon, cr.due_by_date,
                cr.release_amount, cr.release_date, cr.status, cr.remark, cr.staff_id, cr.bukku_expense_id,
                cr.created_at, cr.updated_at
         FROM commission_release cr
         WHERE cr.client_id = ?
         ORDER BY cr.created_at DESC
         LIMIT 1000`,
        [clientId]
      );
    } else {
      const msg = String(err?.sqlMessage || err?.message || '');
      if (/doesn't exist|Unknown table|ER_NO_SUCH_TABLE/i.test(msg)) {
        console.warn('[commission-release] listCommissionRelease: table missing');
        return [];
      }
      throw err;
    }
  }

  return (rows || []).map((r) => ({
    _id: r.id,
    id: r.id,
    _type: 'COMMISSION_RELEASE',
    tenancy_id: r.tenancy_id,
    property_shortname: r.property_shortname,
    room_title: r.room_title,
    tenant_name: r.tenant_name,
    checkin_date: r.checkin_date,
    checkout_date: r.checkout_date,
    commission_amount: r.commission_amount != null ? Number(r.commission_amount) : 0,
    chargeon: r.chargeon,
    due_by_date: r.due_by_date,
    release_amount: r.release_amount != null ? Number(r.release_amount) : null,
    release_date: r.release_date,
    status: r.status,
    remark: r.remark,
    staff_id: r.staff_id,
    bukku_expense_id: r.bukku_expense_id,
    xero_bank_transaction_id: r.xero_bank_transaction_id ?? null,
    _createdDate: r.created_at
  }));
}

/**
 * Update commission_release (draft or mark paid). Validates staff belongs to client.
 */
async function updateCommissionRelease(clientId, id, payload = {}) {
  if (!clientId || !id) return { ok: false, reason: 'MISSING_PARAMS' };

  let existingRows;
  try {
    [existingRows] = await pool.query(
      `SELECT cr.id, cr.tenancy_id, cr.commission_amount, cr.release_amount, cr.release_date, cr.staff_id,
              cr.status, cr.remark, cr.property_shortname, cr.room_title, cr.tenant_name,
              cr.bukku_expense_id, cr.xero_bank_transaction_id
       FROM commission_release cr
       WHERE cr.id = ? AND cr.client_id = ?
       LIMIT 1`,
      [id, clientId]
    );
  } catch (e) {
    if (isMissingXeroColumn(e)) {
      [existingRows] = await pool.query(
        `SELECT cr.id, cr.tenancy_id, cr.commission_amount, cr.release_amount, cr.release_date, cr.staff_id,
                cr.status, cr.remark, cr.property_shortname, cr.room_title, cr.tenant_name,
                cr.bukku_expense_id
         FROM commission_release cr
         WHERE cr.id = ? AND cr.client_id = ?
         LIMIT 1`,
        [id, clientId]
      );
      if (existingRows[0]) existingRows[0].xero_bank_transaction_id = null;
    } else {
      throw e;
    }
  }

  const row = existingRows[0];
  if (!row) return { ok: false, reason: 'NOT_FOUND' };

  const prevStatus = String(row.status || 'pending').toLowerCase();
  const nextStatus =
    payload.status != null ? String(payload.status).toLowerCase() : null;
  const skipAccounting = payload.skipAccounting === true;
  const explicitSkipVoid =
    payload.skipAccountingVoid === true || payload.skipAccounting === true;

  /** Reject / close case: no payout, only from pending. */
  if (nextStatus === 'rejected') {
    if (prevStatus !== 'pending') {
      return { ok: false, reason: 'REJECT_NOT_ALLOWED' };
    }
    const note = payload.reject_reason != null ? String(payload.reject_reason).trim().slice(0, 2000) : '';
    const base = row.remark != null ? String(row.remark).trim() : '';
    payload.remark = note
      ? `${base}${base ? '\n' : ''}[rejected] ${note}`.trim()
      : `${base}${base ? '\n' : ''}[rejected]`.trim();
    payload.release_amount = null;
    payload.release_date = null;
  }

  /** Undo reject: back to pending (no accounting). */
  if (nextStatus === 'pending' && prevStatus === 'rejected') {
    const base = row.remark != null ? String(row.remark).trim() : '';
    payload.remark = base ? `${base}\n[Undo reject]`.trim() : '[Undo reject]';
  }

  if (nextStatus === 'pending' && prevStatus === 'paid' && !explicitSkipVoid) {
    const voidRes = await voidCommissionAccounting(clientId, row, 'Revert referral commission to pending');
    if (!voidRes.ok) return voidRes;
  }

  const staffIdFromPayload = payload.staff_id != null ? String(payload.staff_id).trim() : null;
  if (staffIdFromPayload) {
    const [sd] = await pool.query('SELECT id FROM staffdetail WHERE id = ? AND client_id = ? LIMIT 1', [
      staffIdFromPayload,
      clientId
    ]);
    if (!sd.length) return { ok: false, reason: 'STAFF_NOT_FOUND' };
  }

  let accountingResult = null;
  if (nextStatus === 'paid' && prevStatus !== 'paid') {
    const mergedPayload = {
      ...payload,
      staff_id: staffIdFromPayload || row.staff_id,
      release_amount:
        payload.release_amount !== undefined ? payload.release_amount : row.release_amount,
      release_date: payload.release_date !== undefined ? payload.release_date : row.release_date,
      payment_method: payload.payment_method
    };
    accountingResult = await postCommissionReferralAccounting(clientId, row, mergedPayload);
    if (!accountingResult.ok && accountingResult.required) {
      return { ok: false, reason: accountingResult.reason || 'COMMISSION_ACCOUNTING_FAILED' };
    }
  }

  const setParts = [];
  const vals = [];
  if (payload.release_amount !== undefined && payload.release_amount !== null && payload.release_amount !== '') {
    setParts.push('release_amount = ?');
    vals.push(Number(payload.release_amount));
  } else if (payload.release_amount === null) {
    setParts.push('release_amount = NULL');
  }
  if (payload.release_date !== undefined) {
    if (payload.release_date === null || payload.release_date === '') {
      setParts.push('release_date = NULL');
    } else {
      setParts.push('release_date = ?');
      vals.push(String(payload.release_date).slice(0, 10));
    }
  }
  if (payload.remark !== undefined) {
    setParts.push('remark = ?');
    vals.push(payload.remark != null ? String(payload.remark) : null);
  }
  if (staffIdFromPayload) {
    setParts.push('staff_id = ?');
    vals.push(staffIdFromPayload);
  }
  if (nextStatus === 'paid' || nextStatus === 'pending' || nextStatus === 'rejected') {
    setParts.push('status = ?');
    vals.push(nextStatus);
  }

  if (nextStatus === 'paid' && prevStatus !== 'paid' && accountingResult?.ok) {
    if (accountingResult.bukkuExpenseId) {
      setParts.push('bukku_expense_id = ?');
      vals.push(String(accountingResult.bukkuExpenseId));
    }
    if (accountingResult.xeroBankTransactionId) {
      setParts.push('xero_bank_transaction_id = ?');
      vals.push(String(accountingResult.xeroBankTransactionId));
    }
  }

  if (nextStatus === 'pending' && prevStatus === 'paid') {
    setParts.push('bukku_expense_id = NULL');
    setParts.push('xero_bank_transaction_id = NULL');
  }

  if (!setParts.length) return { ok: true, accounting: accountingResult };

  vals.push(id, clientId);
  await pool.query(
    `UPDATE commission_release SET ${setParts.join(', ')}, updated_at = NOW() WHERE id = ? AND client_id = ?`,
    vals
  );

  return { ok: true, accounting: accountingResult };
}

/**
 * One-off: create commission_release rows for all client tenancies that qualify but missed insert (e.g. before this feature).
 */
async function backfillCommissionReleasesForClient(clientId) {
  if (!clientId) return { ok: false, reason: 'MISSING_CLIENT' };
  let rows;
  try {
    [rows] = await pool.query('SELECT id FROM tenancy WHERE client_id = ?', [clientId]);
  } catch (err) {
    return { ok: false, reason: err?.message || 'DB_ERROR' };
  }
  let created = 0;
  let skipped = 0;
  for (const row of rows || []) {
    const r = await upsertCommissionReleaseForTenancy(clientId, row.id);
    if (r.inserted) created += 1;
    else skipped += 1;
  }
  return { ok: true, created, skipped, scanned: (rows || []).length };
}

module.exports = {
  listCommissionRelease,
  upsertCommissionReleaseForTenancy,
  updateCommissionRelease,
  backfillCommissionReleasesForClient,
  voidCommissionRelease,
  getCommissionReleaseReceiptUrl
};
