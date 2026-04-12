/**
 * Admin Dashboard – feedback + refunddeposit list/update/delete.
 * Scoped by client_id from access context. Uses MySQL: feedback, refunddeposit, roomdetail, tenantdetail, propertydetail, operatordetail, bankdetail.
 */

const { randomUUID, createHash } = require('crypto');
const pool = require('../../config/db');
const { afterSignUpdate, isAgreementFullySigned } = require('../agreement/agreement.service');
const {
  getAccountIdByWixId,
  resolveClientAccounting,
  createInvoicesForRentalRecords,
  createReceiptForForfeitDepositRentalCollection,
  voidOrDeleteInvoicesForRentalCollectionIds
} = require('../rentalcollection-invoice/rentalcollection-invoice.service');
const bukkuBankingExpense = require('../bukku/wrappers/bankingExpense.wrapper');
const bukkuPayment = require('../bukku/wrappers/payment.wrapper');
const xeroBankTransaction = require('../xero/wrappers/banktransaction.wrapper');
const {
  loadFeedbackThread,
  appendMessage,
  remarkPreview,
  isMissingMessagesJsonColumn
} = require('../../utils/feedbackMessages');
const {
  listCommissionRelease,
  updateCommissionRelease,
  backfillCommissionReleasesForClient
} = require('../commission-release/commission-release.service');

const FORFEIT_DEPOSIT_WIX_ID = '2020b22b-028e-4216-906c-c816dcb33a85';
const REFUND_STATUS_VALUES = new Set(['pending', 'approved', 'completed', 'rejected']);

function normalizeRefundStatus(v) {
  const s = String(v || '').trim().toLowerCase();
  return REFUND_STATUS_VALUES.has(s) ? s : null;
}

function isMissingRefundStatusColumn(err) {
  if (!err) return false;
  const msg = String(err.message || '').toLowerCase();
  return msg.includes('unknown column') && msg.includes('status');
}

function isMissingRefundAccountingRefColumns(err) {
  if (!err) return false;
  const msg = String(err.message || '').toLowerCase();
  return msg.includes('unknown column') && (
    msg.includes('accounting_provider') ||
    msg.includes('accounting_ref_id') ||
    msg.includes('accounting_ref_url')
  );
}

function isMissingRefundForfeitAccountingRefColumns(err) {
  if (!err) return false;
  const msg = String(err.message || '').toLowerCase();
  return msg.includes('unknown column') && (
    msg.includes('forfeit_accounting_provider') ||
    msg.includes('forfeit_accounting_ref_id') ||
    msg.includes('forfeit_accounting_ref_url')
  );
}

/**
 * Parse photo JSON from DB (text) to array for frontend.
 */
function parsePhoto(photo) {
  if (photo == null || photo === '') return [];
  try {
    const arr = JSON.parse(photo);
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

/**
 * List feedback rows for client with room, tenant, property, client (for admin list).
 * Returns array of { _id, _type: 'FEEDBACK', description, photo, video, done, remark, _createdDate, room, tenant, property, client }.
 */
async function listFeedback(clientId) {
  if (!clientId) return [];
  const sqlWithMsg = `SELECT f.id, f.description, f.photo, f.video, f.done, f.remark, f.messages_json, f.created_at, f.updated_at,
            f.room_id, f.tenant_id, f.property_id, f.client_id,
            rm.title_fld AS room_title_fld,
            tn.fullname AS tenant_fullname, tn.bankaccount AS tenant_bankaccount, tn.accountholder AS tenant_accountholder,
            b.bankname AS tenant_bankname,
            p.shortname AS property_shortname,
            c.currency AS client_currency
     FROM feedback f
     LEFT JOIN roomdetail rm ON rm.id = f.room_id
     LEFT JOIN tenantdetail tn ON tn.id = f.tenant_id
     LEFT JOIN bankdetail b ON b.id = tn.bankname_id
     LEFT JOIN propertydetail p ON p.id = f.property_id
     LEFT JOIN operatordetail c ON c.id = f.client_id
     WHERE f.client_id = ? AND (f.done = 0 OR f.done IS NULL)
     ORDER BY f.created_at DESC
     LIMIT 1000`;
  const sqlLegacy = `SELECT f.id, f.description, f.photo, f.video, f.done, f.remark, f.created_at, f.updated_at,
            f.room_id, f.tenant_id, f.property_id, f.client_id,
            rm.title_fld AS room_title_fld,
            tn.fullname AS tenant_fullname, tn.bankaccount AS tenant_bankaccount, tn.accountholder AS tenant_accountholder,
            b.bankname AS tenant_bankname,
            p.shortname AS property_shortname,
            c.currency AS client_currency
     FROM feedback f
     LEFT JOIN roomdetail rm ON rm.id = f.room_id
     LEFT JOIN tenantdetail tn ON tn.id = f.tenant_id
     LEFT JOIN bankdetail b ON b.id = tn.bankname_id
     LEFT JOIN propertydetail p ON p.id = f.property_id
     LEFT JOIN operatordetail c ON c.id = f.client_id
     WHERE f.client_id = ? AND (f.done = 0 OR f.done IS NULL)
     ORDER BY f.created_at DESC
     LIMIT 1000`;
  let rows;
  try {
    [rows] = await pool.query(sqlWithMsg, [clientId]);
  } catch (e) {
    if (isMissingMessagesJsonColumn(e)) {
      [rows] = await pool.query(sqlLegacy, [clientId]);
    } else {
      throw e;
    }
  }
  return rows.map((r) => {
    const thread = loadFeedbackThread({
      messages_json: r.messages_json,
      remark: r.remark,
      updated_at: r.updated_at,
      created_at: r.created_at
    });
    return {
      _id: r.id,
      id: r.id,
      _type: 'FEEDBACK',
      description: r.description ?? '',
      photo: parsePhoto(r.photo),
      video: r.video ?? null,
      done: !!r.done,
      remark: remarkPreview(thread) || (r.remark ?? ''),
      messages: thread,
      _createdDate: r.created_at,
      room: r.room_id ? { id: r.room_id, title_fld: r.room_title_fld } : null,
      tenant: r.tenant_id
        ? {
            id: r.tenant_id,
            fullname: r.tenant_fullname,
            bankName: r.tenant_bankname ? { bankname: r.tenant_bankname } : null,
            bankAccount: r.tenant_bankaccount,
            accountholder: r.tenant_accountholder
          }
        : null,
      property: r.property_id ? { id: r.property_id, shortname: r.property_shortname } : null,
      client: r.client_id ? { id: r.client_id, currency: r.client_currency } : null
    };
  });
}

/**
 * List refunddeposit rows for client with room, tenant, client.
 * Returns array of { _id, _type: 'REFUND', amount, done, _createdDate, room, tenant, client }.
 */
async function listRefundDeposit(clientId) {
  if (!clientId) return [];
  let rows;
  const sqlWithStatus = `SELECT rd.id, rd.amount, rd.done, rd.status, rd.roomtitle, rd.tenantname, rd.created_at,
            rd.room_id, rd.tenant_id, rd.client_id,
            rd.tenancy_id,
            rd.accounting_provider, rd.accounting_ref_id, rd.accounting_ref_url,
            rd.forfeit_accounting_provider, rd.forfeit_accounting_ref_id, rd.forfeit_accounting_ref_url,
            t.deposit AS tenancy_deposit,
            t.\`end\` AS tenancy_end,
            rm.title_fld AS room_title_fld,
            p.shortname AS property_shortname,
            tn.fullname AS tenant_fullname, tn.bankaccount AS tenant_bankaccount, tn.accountholder AS tenant_accountholder,
            b.bankname AS tenant_bankname,
            c.currency AS client_currency
     FROM refunddeposit rd
     LEFT JOIN tenancy t ON t.id = rd.tenancy_id
     LEFT JOIN roomdetail rm ON rm.id = rd.room_id
     LEFT JOIN propertydetail p ON p.id = rm.property_id
     LEFT JOIN tenantdetail tn ON tn.id = rd.tenant_id
     LEFT JOIN bankdetail b ON b.id = tn.bankname_id
     LEFT JOIN operatordetail c ON c.id = rd.client_id
     WHERE rd.client_id = ?
     ORDER BY rd.created_at DESC
     LIMIT 1000`;
  const sqlWithoutForfeitRef = `SELECT rd.id, rd.amount, rd.done, rd.status, rd.roomtitle, rd.tenantname, rd.created_at,
            rd.room_id, rd.tenant_id, rd.client_id,
            rd.tenancy_id,
            rd.accounting_provider, rd.accounting_ref_id, rd.accounting_ref_url,
            NULL AS forfeit_accounting_provider, NULL AS forfeit_accounting_ref_id, NULL AS forfeit_accounting_ref_url,
            t.deposit AS tenancy_deposit,
            t.\`end\` AS tenancy_end,
            rm.title_fld AS room_title_fld,
            p.shortname AS property_shortname,
            tn.fullname AS tenant_fullname, tn.bankaccount AS tenant_bankaccount, tn.accountholder AS tenant_accountholder,
            b.bankname AS tenant_bankname,
            c.currency AS client_currency
     FROM refunddeposit rd
     LEFT JOIN tenancy t ON t.id = rd.tenancy_id
     LEFT JOIN roomdetail rm ON rm.id = rd.room_id
     LEFT JOIN propertydetail p ON p.id = rm.property_id
     LEFT JOIN tenantdetail tn ON tn.id = rd.tenant_id
     LEFT JOIN bankdetail b ON b.id = tn.bankname_id
     LEFT JOIN operatordetail c ON c.id = rd.client_id
     WHERE rd.client_id = ?
     ORDER BY rd.created_at DESC
     LIMIT 1000`;
  const sqlLegacy = `SELECT rd.id, rd.amount, rd.done, rd.roomtitle, rd.tenantname, rd.created_at,
            rd.room_id, rd.tenant_id, rd.client_id,
            rd.tenancy_id,
            t.deposit AS tenancy_deposit,
            t.\`end\` AS tenancy_end,
            rm.title_fld AS room_title_fld,
            p.shortname AS property_shortname,
            tn.fullname AS tenant_fullname, tn.bankaccount AS tenant_bankaccount, tn.accountholder AS tenant_accountholder,
            b.bankname AS tenant_bankname,
            c.currency AS client_currency
     FROM refunddeposit rd
     LEFT JOIN tenancy t ON t.id = rd.tenancy_id
     LEFT JOIN roomdetail rm ON rm.id = rd.room_id
     LEFT JOIN propertydetail p ON p.id = rm.property_id
     LEFT JOIN tenantdetail tn ON tn.id = rd.tenant_id
     LEFT JOIN bankdetail b ON b.id = tn.bankname_id
     LEFT JOIN operatordetail c ON c.id = rd.client_id
     WHERE rd.client_id = ?
     ORDER BY rd.created_at DESC
     LIMIT 1000`;
  try {
    [rows] = await pool.query(sqlWithStatus, [clientId]);
  } catch (e) {
    if (isMissingRefundForfeitAccountingRefColumns(e)) {
      try {
        [rows] = await pool.query(sqlWithoutForfeitRef, [clientId]);
      } catch (e2) {
        if (!isMissingRefundStatusColumn(e2) && !isMissingRefundAccountingRefColumns(e2)) throw e2;
        [rows] = await pool.query(sqlLegacy, [clientId]);
      }
    } else if (isMissingRefundStatusColumn(e) || isMissingRefundAccountingRefColumns(e)) {
      [rows] = await pool.query(sqlLegacy, [clientId]);
    } else {
      throw e;
    }
  }
  return rows.map((r) => ({
    _id: r.id,
    id: r.id,
    _type: 'REFUND',
    amount: r.amount,
    status: normalizeRefundStatus(r.status) || (r.done ? 'completed' : 'pending'),
    accountingProvider: r.accounting_provider || null,
    accountingRefId: r.accounting_ref_id || null,
    accountingRefUrl: r.accounting_ref_url || null,
    forfeitAccountingProvider: r.forfeit_accounting_provider || null,
    forfeitAccountingRefId: r.forfeit_accounting_ref_id || null,
    forfeitAccountingRefUrl: r.forfeit_accounting_ref_url || null,
    depositAmount: r.tenancy_deposit != null ? Number(r.tenancy_deposit) : Number(r.amount || 0),
    done: !!r.done,
    _createdDate: r.created_at,
    tenancyEnd: r.tenancy_end || null,
    tenancy_id: r.tenancy_id || null,
    room: r.room_id
      ? { id: r.room_id, title_fld: r.room_title_fld }
      : (r.roomtitle ? { title_fld: r.roomtitle } : null),
    property: r.property_shortname ? { shortname: r.property_shortname } : null,
    tenant: r.tenant_id
      ? {
          id: r.tenant_id,
          fullname: r.tenant_fullname,
          bankName: r.tenant_bankname ? { bankname: r.tenant_bankname } : null,
          bankAccount: r.tenant_bankaccount,
          accountholder: r.tenant_accountholder
        }
      : (r.tenantname ? { fullname: r.tenantname } : null),
    client: r.client_id ? { id: r.client_id, currency: r.client_currency } : null
  }));
}

const ADMIN_CACHE_LIMIT = 2000;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;

/**
 * All owner–operator (property) agreements for this client — not staff-scoped, not limited to "pending operator sign".
 * Used by Operator → Agreements to show owner agreements alongside tenancy (tenant) agreements.
 */
async function listOwnerOperatorAgreementsForClient(clientId) {
  if (!clientId) return [];
  const [rows] = await pool.query(
    `SELECT a.id, a.client_id, a.owner_id, a.property_id, a.agreementtemplate_id, a.mode, a.status, a.url, a.pdfurl,
            a.operatorsign, a.ownersign, a.hash_final, a.created_at,
            p.shortname AS property_shortname,
            od.ownername AS owner_name
     FROM agreement a
     LEFT JOIN propertydetail p ON p.id = a.property_id
     LEFT JOIN ownerdetail od ON od.id = a.owner_id
     WHERE a.client_id = ? AND a.mode = 'owner_operator'
     ORDER BY a.created_at DESC
     LIMIT 500`,
    [clientId]
  );
  const hasSign = (v) => v != null && String(v).trim() !== '';
  return (rows || []).map((r) => ({
    _id: r.id,
    id: r.id,
    _type: 'OWNER_OPERATOR_AGREEMENT',
    _createdDate: r.created_at,
    room: null,
    tenant: null,
    property: r.property_id ? { id: r.property_id, shortname: r.property_shortname } : null,
    agreement: {
      _id: r.id,
      mode: r.mode,
      owner: r.owner_id,
      property: r.property_id,
      agreementtemplate: r.agreementtemplate_id,
      status: r.status,
      url: r.url || r.pdfurl,
      pdfurl: r.pdfurl || r.url,
      ownersign: r.ownersign,
      operatorsign: r.operatorsign,
      hash_final: r.hash_final,
      ownername: r.owner_name,
      owner_name: r.owner_name,
      owner_has_sign: hasSign(r.ownersign),
      operator_has_sign: hasSign(r.operatorsign)
    }
  }));
}

/**
 * Delete agreement row for operator UI only when final hash not generated yet.
 * Credit is not refunded; only agreement record is removed.
 */
async function deleteAgreementBeforeFinalHash(clientId, agreementId) {
  if (!clientId || !agreementId) return { ok: false, reason: 'MISSING_PARAMS' };
  const [rows] = await pool.query(
    `SELECT id, hash_final
       FROM agreement
      WHERE id = ? AND client_id = ?
      LIMIT 1`,
    [agreementId, clientId]
  );
  const row = rows[0];
  if (!row) return { ok: false, reason: 'NOT_FOUND' };
  if (row.hash_final != null && String(row.hash_final).trim() !== '') {
    return { ok: false, reason: 'FINAL_HASH_EXISTS' };
  }
  const [del] = await pool.query(
    'DELETE FROM agreement WHERE id = ? AND client_id = ? LIMIT 1',
    [agreementId, clientId]
  );
  if (!del?.affectedRows) return { ok: false, reason: 'NOT_FOUND' };
  return { ok: true };
}

/**
 * List agreements pending operator (staff) signature for this client.
 * mode IN (tenant_operator, owner_operator), operatorsign IS NULL, status ready_for_signature/locked, has url.
 * Returns items with _type: 'PENDING_OPERATOR_AGREEMENT', room, tenant, property, agreement for repeateradmin.
 */
async function listPendingOperatorAgreements(clientId) {
  if (!clientId) return [];
  const [rows] = await pool.query(
    `SELECT a.id, a.client_id, a.owner_id, a.mode, a.property_id, a.tenancy_id, a.agreementtemplate_id, a.status, a.url, a.pdfurl, a.created_at,
            p.shortname AS property_shortname,
            r.id AS room_id, r.title_fld AS room_title_fld, r.roomname AS room_roomname,
            t.id AS tenant_id, t.fullname AS tenant_fullname
     FROM agreement a
     LEFT JOIN propertydetail p ON p.id = a.property_id
     LEFT JOIN tenancy tn ON tn.id = a.tenancy_id
     LEFT JOIN roomdetail r ON r.id = tn.room_id
     LEFT JOIN tenantdetail t ON t.id = tn.tenant_id
     WHERE a.client_id = ?
       AND a.mode IN ('tenant_operator', 'owner_operator')
       AND (a.operatorsign IS NULL OR TRIM(COALESCE(a.operatorsign,'')) = '')
       AND a.status IN ('ready_for_signature', 'locked')
       AND (a.url IS NOT NULL OR a.pdfurl IS NOT NULL)
     ORDER BY a.created_at DESC
     LIMIT 500`,
    [clientId]
  );
  return (rows || []).map((r) => ({
    _id: r.id,
    id: r.id,
    _type: 'PENDING_OPERATOR_AGREEMENT',
    _createdDate: r.created_at,
    done: false,
    room: r.room_id
      ? { id: r.room_id, title_fld: r.room_title_fld || r.room_roomname }
      : null,
    tenant: r.tenant_id ? { id: r.tenant_id, fullname: r.tenant_fullname } : null,
    property: r.property_id ? { id: r.property_id, shortname: r.property_shortname } : null,
    agreement: {
      _id: r.id,
      mode: r.mode,
      owner: r.owner_id,
      property: r.property_id,
      tenancy: r.tenancy_id,
      agreementtemplate: r.agreementtemplate_id,
      status: r.status,
      url: r.url || r.pdfurl
    }
  }));
}

/**
 * Combined admin list with server-side filter + optional cache (limit) or pagination (page/pageSize).
 * Includes feedback, refund, and pending operator agreements when filterType is ALL or Agreement.
 * @param {string} clientId
 * @param {object} opts - { filterType: 'ALL'|'Feedback'|'Refund'|'Agreement'|'Commission', search?, sort: 'new'|'old', page?, pageSize?, limit? }
 * @returns {Promise<{ items: array, total: number, totalPages?: number, currentPage?: number }>}
 */
async function getAdminList(clientId, opts = {}) {
  const ft = opts.filterType;
  const filterType =
    ft === 'Feedback' || ft === 'Refund' || ft === 'Agreement' || ft === 'Commission' ? ft : 'ALL';
  const search = typeof opts.search === 'string' ? opts.search.trim().toLowerCase() : '';
  const sort = opts.sort === 'old' ? 'old' : 'new';
  const limit = opts.limit != null ? Math.min(ADMIN_CACHE_LIMIT, Math.max(1, parseInt(opts.limit, 10) || 0)) : null;
  const useLimit = limit != null && limit > 0;
  const page = useLimit ? 1 : Math.max(1, parseInt(opts.page, 10) || 1);
  const pageSize = useLimit ? limit : Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(opts.pageSize, 10) || DEFAULT_PAGE_SIZE));

  const loadFeedback = filterType === 'ALL' || filterType === 'Feedback';
  const loadRefund = filterType === 'ALL' || filterType === 'Refund';
  const loadAgreement = filterType === 'ALL' || filterType === 'Agreement';
  const loadCommission = filterType === 'ALL' || filterType === 'Commission';

  const [feedbackList, refundList, pendingAgreements, commissionList] = await Promise.all([
    loadFeedback ? listFeedback(clientId) : [],
    loadRefund ? listRefundDeposit(clientId) : [],
    loadAgreement ? listPendingOperatorAgreements(clientId) : [],
    loadCommission ? listCommissionRelease(clientId) : []
  ]);
  let combined = [...feedbackList, ...refundList, ...pendingAgreements, ...commissionList];
  combined.sort((a, b) => {
    const ta = new Date(a._createdDate || 0).getTime();
    const tb = new Date(b._createdDate || 0).getTime();
    return sort === 'old' ? ta - tb : tb - ta;
  });
  if (search) {
    combined = combined.filter((i) => {
      if (i._type === 'COMMISSION_RELEASE') {
        const room = String(i.room_title || '').toLowerCase();
        const tenant = String(i.tenant_name || '').toLowerCase();
        const prop = String(i.property_shortname || '').toLowerCase();
        return room.includes(search) || tenant.includes(search) || prop.includes(search);
      }
      const room = (i.room?.title_fld || '').toLowerCase();
      const tenant = (i.tenant?.fullname || '').toLowerCase();
      return room.includes(search) || tenant.includes(search);
    });
  }
  const total = combined.length;
  if (useLimit) {
    return { items: combined.slice(0, limit), total };
  }
  const offset = (page - 1) * pageSize;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return {
    items: combined.slice(offset, offset + pageSize),
    total,
    totalPages,
    currentPage: page
  };
}

/**
 * Update feedback: set done, remark. Ensures row belongs to clientId.
 */
async function updateFeedback(clientId, id, payload) {
  if (!clientId || !id) return { ok: false, reason: 'MISSING_PARAMS' };
  let row;
  try {
    const [[r]] = await pool.query(
      'SELECT id, done, messages_json, remark, created_at, updated_at FROM feedback WHERE id = ? AND client_id = ? LIMIT 1',
      [id, clientId]
    );
    row = r;
  } catch (e) {
    if (isMissingMessagesJsonColumn(e)) {
      if (payload.message_append) return { ok: false, reason: 'NEEDS_MIGRATION_0134' };
      const doneLegacy = payload.done === true || payload.done === 1 ? 1 : 0;
      const remarkLegacy = payload.remark != null ? String(payload.remark) : null;
      const [resultLegacy] = await pool.query(
        'UPDATE feedback SET done = ?, remark = ?, updated_at = NOW() WHERE id = ? AND client_id = ?',
        [doneLegacy, remarkLegacy, id, clientId]
      );
      if (resultLegacy.affectedRows === 0) return { ok: false, reason: 'NOT_FOUND' };
      return { ok: true };
    }
    throw e;
  }
  if (!row) return { ok: false, reason: 'NOT_FOUND' };

  const updates = [];
  const params = [];
  const hasDone = payload.done !== undefined;
  const hasRemark = payload.remark !== undefined;
  const hasMessageAppend =
    payload.message_append &&
    (
      String(payload.message_append.text || '').trim() ||
      (Array.isArray(payload.message_append.attachments) && payload.message_append.attachments.length > 0)
    );

  let nextMessages = null;
  if (hasMessageAppend) {
    nextMessages = appendMessage(
      loadFeedbackThread(row),
      'operator',
      payload.message_append.text,
      {
        visibleToTenant: payload.message_append.visibleToTenant,
        attachments: payload.message_append.attachments
      }
    );
    updates.push('messages_json = ?');
    params.push(nextMessages.length ? JSON.stringify(nextMessages) : null);
    updates.push('remark = ?');
    params.push(remarkPreview(nextMessages) || null);
  } else if (hasRemark) {
    updates.push('remark = ?');
    params.push(payload.remark != null ? String(payload.remark) : null);
  }

  if (hasDone) {
    updates.push('done = ?');
    params.push(payload.done === true || payload.done === 1 ? 1 : 0);
  }

  if (updates.length === 0) return { ok: true };

  const [result] = await pool.query(
    `UPDATE feedback SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ? AND client_id = ?`,
    [...params, id, clientId]
  );
  if (result.affectedRows === 0) return { ok: false, reason: 'NOT_FOUND' };
  return { ok: true };
}

function safeParseJson(text) {
  if (!text || typeof text !== 'string') return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function isIgnorableXeroBankTxnDeleteError(err) {
  const status = Number(err?.status || err?.response?.status || 0);
  if (status === 404) return true;
  const text = String(
    err?.Message ||
    err?.message ||
    err?.Detail ||
    err?.error?.Message ||
    err?.error?.message ||
    err?.error?.Detail ||
    err?.response?.data?.Message ||
    err?.response?.data?.Detail ||
    ''
  ).toLowerCase();
  return text.includes('404') || text.includes('not found') || text.includes('cannot be found') || text.includes('does not exist');
}

async function writeForfeitAccountingRef(clientId, refundId, provider, snapshot) {
  const rentalCollectionId = snapshot?.rentalCollectionId ? String(snapshot.rentalCollectionId) : null;
  const payload = snapshot ? JSON.stringify(snapshot) : null;
  try {
    await pool.query(
      `UPDATE refunddeposit
       SET forfeit_accounting_provider = ?, forfeit_accounting_ref_id = ?, forfeit_accounting_ref_url = ?, updated_at = NOW()
       WHERE id = ? AND client_id = ?`,
      [provider || null, rentalCollectionId, payload, refundId, clientId]
    );
  } catch (e) {
    if (!isMissingRefundForfeitAccountingRefColumns(e)) throw e;
  }
}

async function voidForfeitAccountingByRentalCollectionId(clientId, provider, rentalCollectionId, req) {
  if (!rentalCollectionId) return { ok: true };
  if (provider === 'bukku' && req) {
    const [rows] = await pool.query(
      'SELECT bukku_payment_id FROM rentalcollection WHERE id = ? AND client_id = ? LIMIT 1',
      [rentalCollectionId, clientId]
    );
    const paymentId = rows[0]?.bukku_payment_id ? String(rows[0].bukku_payment_id).trim() : '';
    if (paymentId) {
      try {
        const del = await bukkuPayment.deletePayment(req, paymentId);
        if (!del?.ok) return { ok: false, reason: 'VOID_FORFEIT_MONEY_OUT_FAILED' };
      } catch (e) {
        return { ok: false, reason: `VOID_FORFEIT_MONEY_OUT_EXCEPTION: ${e?.message || e}` };
      }
    }
  }
  try {
    const invoiceVoid = await voidOrDeleteInvoicesForRentalCollectionIds(
      clientId,
      [rentalCollectionId],
      { includePaid: true, einvoiceCancelReason: 'forfeit refund void' }
    );
    if (invoiceVoid?.fatalErrors?.length) {
      return { ok: false, reason: `VOID_FORFEIT_INVOICE_FAILED: ${invoiceVoid.fatalErrors.join(' | ')}` };
    }
  } catch (e) {
    return { ok: false, reason: `VOID_FORFEIT_INVOICE_EXCEPTION: ${e?.message || e}` };
  }
  return { ok: true };
}

/**
 * Update refunddeposit: set done. Ensures row belongs to clientId.
 * When marking done=1: if payload.refundAmount < rd.amount, create forfeit for (amount - refundAmount) then refund refundAmount; else refund full amount.
 * Journal (refund + optional forfeit) only created when #buttonmarkasrefund is clicked.
 * When resolveClientAccounting fails (no plan, no integration, or bad credentials), accounting is skipped as if skipAccounting were true.
 */
async function updateRefundDeposit(clientId, id, payload) {
  if (!clientId || !id) return { ok: false, reason: 'MISSING_PARAMS' };
  console.log('[refund-complete] updateRefundDeposit:start', {
    clientId,
    refundDepositId: id,
    payload: {
      done: payload?.done,
      status: payload?.status,
      refundAmount: payload?.refundAmount,
      paymentDate: payload?.paymentDate,
      paymentMethod: payload?.paymentMethod,
      skipAccounting: payload?.skipAccounting === true
    }
  });
  const explicitDone = payload.done === true || payload.done === 1 ? 1 : (payload.done === false || payload.done === 0 ? 0 : null);
  const requestedStatus = normalizeRefundStatus(payload.status);
  const done = explicitDone != null ? explicitDone : (requestedStatus === 'completed' ? 1 : 0);

  let rdRows;
  try {
    [rdRows] = await pool.query(
      `SELECT rd.id, rd.amount, rd.tenancy_id, rd.room_id, rd.tenant_id, rd.client_id, rd.done, rd.status,
              rd.accounting_provider, rd.accounting_ref_id, rd.accounting_ref_url,
              rd.forfeit_accounting_provider, rd.forfeit_accounting_ref_id, rd.forfeit_accounting_ref_url,
              r.property_id, t.deposit AS tenancy_deposit
       FROM refunddeposit rd
       LEFT JOIN roomdetail r ON r.id = rd.room_id
       LEFT JOIN tenancy t ON t.id = rd.tenancy_id
       WHERE rd.id = ? AND rd.client_id = ? LIMIT 1`,
      [id, clientId]
    );
  } catch (e) {
    if (!isMissingRefundForfeitAccountingRefColumns(e) && !isMissingRefundAccountingRefColumns(e) && !isMissingRefundStatusColumn(e)) {
      throw e;
    }
    [rdRows] = await pool.query(
      `SELECT rd.id, rd.amount, rd.tenancy_id, rd.room_id, rd.tenant_id, rd.client_id, rd.done,
              rd.accounting_provider, rd.accounting_ref_id, rd.accounting_ref_url,
              r.property_id, t.deposit AS tenancy_deposit
       FROM refunddeposit rd
       LEFT JOIN roomdetail r ON r.id = rd.room_id
       LEFT JOIN tenancy t ON t.id = rd.tenancy_id
       WHERE rd.id = ? AND rd.client_id = ? LIMIT 1`,
      [id, clientId]
    );
  }
  if (!rdRows.length) return { ok: false, reason: 'NOT_FOUND' };
  const rd = rdRows[0];
  const fullAmount = Number(rd.amount) || 0;
  const tenancyDeposit = Number(rd.tenancy_deposit || 0);
  console.log('[refund-complete] updateRefundDeposit:row', {
    refundDepositId: id,
    requestedStatus,
    done,
    fullAmount,
    tenancyDeposit,
    tenancyId: rd.tenancy_id,
    tenantId: rd.tenant_id,
    roomId: rd.room_id,
    propertyId: rd.property_id
  });

  const currentStatus = normalizeRefundStatus(rd.status) || (Number(rd.done || 0) === 1 ? 'completed' : 'pending');
  const isVoidBackToApproved = requestedStatus === 'approved' && currentStatus === 'completed';

  const forfeitBaseAmount = tenancyDeposit > 0 ? tenancyDeposit : fullAmount;
  let actualRefund = fullAmount;
  if (payload.refundAmount != null && payload.refundAmount !== '') {
    actualRefund = Number(payload.refundAmount);
  }
  if (actualRefund < 0 || actualRefund > forfeitBaseAmount) {
    console.warn('[refund-complete] updateRefundDeposit:invalid-refund-amount', {
      refundDepositId: id,
      fullAmount,
      forfeitBaseAmount,
      actualRefund
    });
    return { ok: false, reason: 'INVALID_REFUND_AMOUNT' };
  }

  if (done === 1) {
    const explicitSkipAccounting = payload?.skipAccounting === true;
    const accountingResolved = await resolveClientAccounting(clientId);
    const effectiveSkipAccounting = explicitSkipAccounting || !accountingResolved.ok;
    const forfeitAmount = Math.max(forfeitBaseAmount - actualRefund, 0);
    console.log('[refund-complete] updateRefundDeposit:complete-flow', {
      refundDepositId: id,
      fullAmount,
      forfeitBaseAmount,
      actualRefund,
      forfeitAmount,
      explicitSkipAccounting,
      accountingResolvedOk: accountingResolved.ok,
      accountingResolvedReason: accountingResolved.reason || null,
      effectiveSkipAccounting
    });
    if (forfeitAmount > 0 && !effectiveSkipAccounting) {
      const provider = String(accountingResolved?.provider || '').toLowerCase();
      const typeId = await getAccountIdByWixId(FORFEIT_DEPOSIT_WIX_ID);
      if (!typeId) return { ok: false, reason: 'FORFEIT_TYPE_MISSING' };
      const forfeitId = randomUUID();
      const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
      await pool.query(
        `INSERT INTO rentalcollection (id, tenancy_id, tenant_id, room_id, property_id, client_id, type_id, amount, date, title, ispaid, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [forfeitId, rd.tenancy_id, rd.tenant_id, rd.room_id, rd.property_id || null, clientId, typeId, forfeitAmount, now, 'Forfeit Deposit (partial refund)', now, now]
      );
      const forfeitRecord = {
        id: forfeitId,
        client_id: clientId,
        property_id: rd.property_id || null,
        room_id: rd.room_id,
        tenancy_id: rd.tenancy_id,
        tenant_id: rd.tenant_id,
        type_id: typeId,
        amount: forfeitAmount,
        date: now,
        title: 'Forfeit Deposit (partial refund)'
      };
      try {
        await createInvoicesForRentalRecords(clientId, [forfeitRecord]);
        await createReceiptForForfeitDepositRentalCollection([forfeitId]);
        const [forfeitRows] = await pool.query(
          `SELECT id, invoiceid, invoiceurl, receipturl, bukku_payment_id,
                  accounting_document_number, accounting_receipt_document_number
           FROM rentalcollection
           WHERE id = ? AND client_id = ?
           LIMIT 1`,
          [forfeitId, clientId]
        );
        const rf = forfeitRows[0] || {};
        await writeForfeitAccountingRef(clientId, id, provider || null, {
          rentalCollectionId: forfeitId,
          invoiceId: rf.invoiceid ? String(rf.invoiceid) : null,
          invoiceUrl: rf.invoiceurl ? String(rf.invoiceurl) : null,
          moneyOutId: rf.bukku_payment_id ? String(rf.bukku_payment_id) : null,
          moneyOutUrl: rf.receipturl ? String(rf.receipturl) : null,
          invoiceLabel: rf.accounting_document_number ? String(rf.accounting_document_number) : (rf.invoiceid ? String(rf.invoiceid) : null),
          moneyOutLabel: rf.accounting_receipt_document_number ? String(rf.accounting_receipt_document_number) : (rf.bukku_payment_id ? String(rf.bukku_payment_id) : null)
        });
      } catch (e) {
        console.warn('[refund-complete] updateRefundDeposit:forfeit-failed', {
          refundDepositId: id,
          forfeitId,
          error: e?.message || e
        });
        return { ok: false, reason: `FORFEIT_ACCOUNTING_FAILED: ${e?.message || e}` };
      }
    }
    if (!effectiveSkipAccounting && actualRefund > 0) {
      try {
        const { createRefundForRefundDeposit } = require('../rentalcollection-invoice/rentalcollection-invoice.service');
        console.log('[refund-complete] updateRefundDeposit:refund-begin', {
          refundDepositId: id,
          actualRefund
        });
        const refundResult = await createRefundForRefundDeposit(clientId, id, {
          amount: actualRefund,
          paymentDate: payload?.paymentDate,
          paymentMethod: payload?.paymentMethod
        });
        console.log('[refund-complete] updateRefundDeposit:refund-result', {
          refundDepositId: id,
          refundResult
        });
        if (!refundResult.ok) {
          return { ok: false, reason: `REFUND_ACCOUNTING_FAILED: ${refundResult.reason || 'UNKNOWN'}` };
        }
        if (refundResult.refundId || refundResult.refundUrl || refundResult.provider) {
          try {
            const refundMeta = JSON.stringify({
              refundId: refundResult.refundId || null,
              refundUrl: refundResult.refundUrl || null,
              refundLabel: refundResult.refundLabel || null
            });
            await pool.query(
              `UPDATE refunddeposit
               SET accounting_provider = ?, accounting_ref_id = ?, accounting_ref_url = ?, updated_at = NOW()
               WHERE id = ? AND client_id = ?`,
              [
                refundResult.provider || null,
                refundResult.refundId || null,
                refundMeta,
                id,
                clientId
              ]
            );
            console.log('[refund-complete] updateRefundDeposit:accounting-ref-saved', {
              refundDepositId: id,
              provider: refundResult.provider || null,
              refId: refundResult.refundId || null,
              refUrl: refundResult.refundUrl || null
            });
          } catch (e) {
            if (!isMissingRefundAccountingRefColumns(e)) throw e;
            console.warn('[refund-complete] updateRefundDeposit:accounting-ref-column-missing', {
              refundDepositId: id,
              error: e?.message || e
            });
          }
        }
      } catch (e) {
        console.warn('[refund-complete] updateRefundDeposit:refund-exception', {
          refundDepositId: id,
          error: e?.message || e
        });
        return { ok: false, reason: `REFUND_ACCOUNTING_EXCEPTION: ${e?.message || e}` };
      }
    }
  }

  if (isVoidBackToApproved) {
    const explicitSkipVoidAccounting = payload?.skipAccounting === true;
    const accountingResolvedVoid = await resolveClientAccounting(clientId);
    const effectiveSkipVoidAccounting = explicitSkipVoidAccounting || !accountingResolvedVoid.ok;
    console.log('[refund-complete] updateRefundDeposit:void-flow-begin', {
      refundDepositId: id,
      currentStatus,
      explicitSkipVoidAccounting,
      accountingResolvedOk: accountingResolvedVoid.ok,
      accountingResolvedReason: accountingResolvedVoid.reason || null,
      effectiveSkipVoidAccounting,
      accountingProvider: rd.accounting_provider || null,
      accountingRefId: rd.accounting_ref_id || null,
      forfeitAccountingProvider: rd.forfeit_accounting_provider || null,
      forfeitAccountingRefId: rd.forfeit_accounting_ref_id || null
    });
    if (!effectiveSkipVoidAccounting) {
      const resolved = accountingResolvedVoid;
      const provider = String(resolved?.provider || '').toLowerCase();
      const moneyOutId = rd.accounting_ref_id ? String(rd.accounting_ref_id).trim() : '';
      const moneyOutMeta = safeParseJson(rd.accounting_ref_url);
      const fallbackMoneyOutId = moneyOutMeta?.refundId ? String(moneyOutMeta.refundId).trim() : '';
      const xeroMoneyOutId = moneyOutId || fallbackMoneyOutId;
      const forfeitRentalCollectionId = rd.forfeit_accounting_ref_id ? String(rd.forfeit_accounting_ref_id).trim() : '';
      if (provider === 'bukku' && moneyOutId) {
        try {
          const moneyOutVoidRes = await bukkuBankingExpense.updateStatus(resolved.req, moneyOutId, {
            status: 'void',
            void_reason: 'Void completed refund back to approved'
          });
          if (moneyOutVoidRes?.ok !== true) {
            return { ok: false, reason: 'VOID_MONEY_OUT_FAILED' };
          }
        } catch (e) {
          return { ok: false, reason: `VOID_MONEY_OUT_EXCEPTION: ${e?.message || e}` };
        }
      }
      if (provider === 'xero' && xeroMoneyOutId) {
        try {
          console.log('[refund-complete] updateRefundDeposit:xero-void-spend-delete-request', {
            refundDepositId: id,
            moneyOutId: xeroMoneyOutId
          });
          const delRes = await xeroBankTransaction.deleteBankTransaction(resolved.req, xeroMoneyOutId);
          console.log('[refund-complete] updateRefundDeposit:xero-void-spend-delete-response', {
            refundDepositId: id,
            moneyOutId: xeroMoneyOutId,
            ok: delRes?.ok === true,
            status: delRes?.status,
            error: delRes?.ok ? null : delRes?.error
          });
          if (delRes?.ok !== true) {
            const updDeleted = await xeroBankTransaction.updateBankTransactionStatus(resolved.req, xeroMoneyOutId, 'DELETED');
            console.log('[refund-complete] updateRefundDeposit:xero-void-spend-update-deleted-response', {
              refundDepositId: id,
              moneyOutId: xeroMoneyOutId,
              ok: updDeleted?.ok === true,
              status: updDeleted?.status,
              error: updDeleted?.ok ? null : updDeleted?.error
            });
            if (updDeleted?.ok !== true) {
              const updVoided = await xeroBankTransaction.updateBankTransactionStatus(resolved.req, xeroMoneyOutId, 'VOIDED');
              console.log('[refund-complete] updateRefundDeposit:xero-void-spend-update-voided-response', {
                refundDepositId: id,
                moneyOutId: xeroMoneyOutId,
                ok: updVoided?.ok === true,
                status: updVoided?.status,
                error: updVoided?.ok ? null : updVoided?.error
              });
              if (updVoided?.ok !== true && !isIgnorableXeroBankTxnDeleteError(delRes)) {
                return { ok: false, reason: `VOID_MONEY_OUT_FAILED: ${JSON.stringify(delRes?.error || 'UNKNOWN')}` };
              }
            }
          }
        } catch (e) {
          if (!isIgnorableXeroBankTxnDeleteError(e)) {
            return { ok: false, reason: `VOID_MONEY_OUT_EXCEPTION: ${e?.message || e}` };
          }
        }
      }
      if (forfeitRentalCollectionId) {
        const voidForfeit = await voidForfeitAccountingByRentalCollectionId(
          clientId,
          provider,
          forfeitRentalCollectionId,
          resolved?.req
        );
        if (!voidForfeit.ok) return voidForfeit;
      } else {
        const forfeitMeta = safeParseJson(rd.forfeit_accounting_ref_url);
        const fallbackRcId = forfeitMeta?.rentalCollectionId ? String(forfeitMeta.rentalCollectionId).trim() : '';
        if (fallbackRcId) {
          const voidForfeit = await voidForfeitAccountingByRentalCollectionId(
            clientId,
            provider,
            fallbackRcId,
            resolved?.req
          );
          if (!voidForfeit.ok) return voidForfeit;
        }
      }
    }
    try {
      await pool.query(
        `UPDATE refunddeposit
         SET accounting_provider = NULL,
             accounting_ref_id = NULL,
             accounting_ref_url = NULL,
             forfeit_accounting_provider = NULL,
             forfeit_accounting_ref_id = NULL,
             forfeit_accounting_ref_url = NULL,
             updated_at = NOW()
         WHERE id = ? AND client_id = ?`,
        [id, clientId]
      );
    } catch (e) {
      if (!isMissingRefundForfeitAccountingRefColumns(e) && !isMissingRefundAccountingRefColumns(e)) throw e;
      try {
        await pool.query(
          `UPDATE refunddeposit
           SET accounting_provider = NULL,
               accounting_ref_id = NULL,
               accounting_ref_url = NULL,
               updated_at = NOW()
           WHERE id = ? AND client_id = ?`,
          [id, clientId]
        );
      } catch (e2) {
        if (!isMissingRefundAccountingRefColumns(e2)) throw e2;
      }
    }
  }

  let result;
  const shouldPersistRefundAmount = done === 1 && Number.isFinite(actualRefund);
  const nextAmount = shouldPersistRefundAmount ? Number(actualRefund) : null;
  if (requestedStatus) {
    try {
      if (shouldPersistRefundAmount) {
        [result] = await pool.query(
          'UPDATE refunddeposit SET done = ?, status = ?, amount = ?, updated_at = NOW() WHERE id = ? AND client_id = ?',
          [done, requestedStatus, nextAmount, id, clientId]
        );
      } else {
        [result] = await pool.query(
          'UPDATE refunddeposit SET done = ?, status = ?, updated_at = NOW() WHERE id = ? AND client_id = ?',
          [done, requestedStatus, id, clientId]
        );
      }
    } catch (e) {
      if (!isMissingRefundStatusColumn(e)) throw e;
      if (shouldPersistRefundAmount) {
        [result] = await pool.query(
          'UPDATE refunddeposit SET done = ?, amount = ?, updated_at = NOW() WHERE id = ? AND client_id = ?',
          [done, nextAmount, id, clientId]
        );
      } else {
        [result] = await pool.query(
          'UPDATE refunddeposit SET done = ?, updated_at = NOW() WHERE id = ? AND client_id = ?',
          [done, id, clientId]
        );
      }
    }
  } else {
    if (shouldPersistRefundAmount) {
      [result] = await pool.query(
        'UPDATE refunddeposit SET done = ?, amount = ?, updated_at = NOW() WHERE id = ? AND client_id = ?',
        [done, nextAmount, id, clientId]
      );
    } else {
      [result] = await pool.query(
        'UPDATE refunddeposit SET done = ?, updated_at = NOW() WHERE id = ? AND client_id = ?',
        [done, id, clientId]
      );
    }
  }
  if (result.affectedRows === 0) return { ok: false, reason: 'NOT_FOUND' };
  console.log('[refund-complete] updateRefundDeposit:done', {
    refundDepositId: id,
    done,
    requestedStatus,
    affectedRows: result.affectedRows
  });
  return { ok: true };
}

/**
 * Delete feedback. Ensures row belongs to clientId.
 */
async function removeFeedback(clientId, id) {
  if (!clientId || !id) return { ok: false, reason: 'MISSING_PARAMS' };
  const [result] = await pool.query('DELETE FROM feedback WHERE id = ? AND client_id = ?', [id, clientId]);
  if (result.affectedRows === 0) return { ok: false, reason: 'NOT_FOUND' };
  return { ok: true };
}

/**
 * Delete refunddeposit. Ensures row belongs to clientId.
 */
async function removeRefundDeposit(clientId, id) {
  if (!clientId || !id) return { ok: false, reason: 'MISSING_PARAMS' };
  const [result] = await pool.query('DELETE FROM refunddeposit WHERE id = ? AND client_id = ?', [id, clientId]);
  if (result.affectedRows === 0) return { ok: false, reason: 'NOT_FOUND' };
  return { ok: true };
}

/**
 * Get one agreement by id for operator view/sign. Same shape as listPendingOperatorAgreements item.
 * Used when opening agreement from #repeatertenancy (sectionproperty). Any agreement with url is allowed.
 */
async function getAgreementForOperator(clientId, agreementId) {
  if (!clientId || !agreementId) return null;
  const [rows] = await pool.query(
    `SELECT a.id, a.client_id, a.owner_id, a.mode, a.property_id, a.tenancy_id, a.agreementtemplate_id, a.status, a.url, a.pdfurl, a.created_at,
            p.shortname AS property_shortname,
            r.id AS room_id, r.title_fld AS room_title_fld, r.roomname AS room_roomname,
            t.id AS tenant_id, t.fullname AS tenant_fullname
     FROM agreement a
     LEFT JOIN propertydetail p ON p.id = a.property_id
     LEFT JOIN tenancy tn ON tn.id = a.tenancy_id
     LEFT JOIN roomdetail r ON r.id = tn.room_id
     LEFT JOIN tenantdetail t ON t.id = tn.tenant_id
     WHERE a.client_id = ? AND a.id = ?
       AND (a.url IS NOT NULL OR a.pdfurl IS NOT NULL)
     LIMIT 1`,
    [clientId, agreementId]
  );
  const r = rows && rows[0];
  if (!r) return null;
  return {
    _id: r.id,
    id: r.id,
    _type: 'PENDING_OPERATOR_AGREEMENT',
    _createdDate: r.created_at,
    room: r.room_id
      ? { id: r.room_id, title_fld: r.room_title_fld || r.room_roomname }
      : null,
    tenant: r.tenant_id ? { id: r.tenant_id, fullname: r.tenant_fullname } : null,
    property: r.property_id ? { id: r.property_id, shortname: r.property_shortname } : null,
    agreement: {
      _id: r.id,
      mode: r.mode,
      owner: r.owner_id,
      property: r.property_id,
      tenancy: r.tenancy_id,
      agreementtemplate: r.agreementtemplate_id,
      status: r.status,
      url: r.url || r.pdfurl
    }
  };
}

/**
 * Update agreement operator sign. Ensures agreement belongs to clientId; sets operatorsign, operator_signed_ip,
 * operator_signed_at, operator_signed_hash (same audit contract as tenant sign — see tenantdashboard.updateAgreementTenantSign).
 * Rejects when columns_locked=1 (agreement already completed).
 */
async function updateAgreementOperatorSign(clientId, agreementId, { operatorsign, operatorSignedIp }) {
  if (!clientId || !agreementId) return { ok: false, reason: 'MISSING_PARAMS' };
  if (operatorsign == null || String(operatorsign).trim() === '') return { ok: false, reason: 'SIGNATURE_REQUIRED' };
  const [check] = await pool.query(
    'SELECT id, columns_locked FROM agreement WHERE id = ? AND client_id = ? LIMIT 1',
    [agreementId, clientId]
  );
  if (!check[0]) return { ok: false, reason: 'NOT_FOUND' };
  if (check[0].columns_locked) return { ok: false, reason: 'AGREEMENT_COMPLETED' };
  const ip = operatorSignedIp != null ? String(operatorSignedIp).trim().slice(0, 45) : null;
  const signStrRaw = String(operatorsign).trim();
  const [auditRows] = await pool.query('SELECT hash_draft FROM agreement WHERE id = ? LIMIT 1', [agreementId]);
  const hashDraft = auditRows?.[0]?.hash_draft != null ? String(auditRows[0].hash_draft) : '';
  const signedAt = new Date();
  const signedAtIso = signedAt.toISOString();
  const signedAtStr = signedAtIso.replace('T', ' ').replace(/\.\d{3}Z$/, '');
  const operatorSignedHash = createHash('sha256')
    .update([agreementId, signStrRaw, signedAtIso, hashDraft].join('|'), 'utf8')
    .digest('hex');

  try {
    const [result] = await pool.query(
      `UPDATE agreement SET operatorsign = ?, operator_signed_ip = ?, operator_signed_at = ?, operator_signed_hash = ?, updated_at = NOW() WHERE id = ? AND client_id = ?`,
      [signStrRaw, ip || null, signedAtStr, operatorSignedHash, agreementId, clientId]
    );
    if (result.affectedRows === 0) return { ok: false, reason: 'NOT_FOUND' };
  } catch (e) {
    const msg = String(e?.sqlMessage || e?.message || '');
    if (e?.code === 'ER_BAD_FIELD_ERROR' || e?.errno === 1054) {
      if (msg.includes('operator_signed_hash')) {
        const [result] = await pool.query(
          `UPDATE agreement SET operatorsign = ?, operator_signed_ip = ?, operator_signed_at = ?, updated_at = NOW() WHERE id = ? AND client_id = ?`,
          [signStrRaw, ip || null, signedAtStr, agreementId, clientId]
        );
        if (result.affectedRows === 0) return { ok: false, reason: 'NOT_FOUND' };
      } else if (msg.includes('operator_signed_at')) {
        const [result] = await pool.query(
          `UPDATE agreement SET operatorsign = ?, operator_signed_ip = ?, updated_at = NOW() WHERE id = ? AND client_id = ?`,
          [signStrRaw, ip || null, agreementId, clientId]
        );
        if (result.affectedRows === 0) return { ok: false, reason: 'NOT_FOUND' };
      } else {
        throw e;
      }
    } else {
      throw e;
    }
  }
  return { ok: true };
}

/**
 * Retry final PDF generation for an agreement that is already fully signed but not completed yet.
 * Used by Operator → Agreements "Finalize"/retry action.
 */
async function retryAgreementFinalPdf(clientId, agreementId, options = {}) {
  if (!clientId || !agreementId) return { ok: false, reason: 'MISSING_PARAMS' };
  const [rows] = await pool.query(
    `SELECT id, mode, status, columns_locked, ownersign, tenantsign, operatorsign
       FROM agreement
      WHERE id = ? AND client_id = ?
      LIMIT 1`,
    [agreementId, clientId]
  );
  const row = rows[0];
  if (!row) return { ok: false, reason: 'NOT_FOUND' };
  if (row.columns_locked || String(row.status || '').toLowerCase() === 'completed') {
    return { ok: false, reason: 'ALREADY_COMPLETED' };
  }
  if (!isAgreementFullySigned(row)) {
    return { ok: false, reason: 'NOT_FULLY_SIGNED' };
  }

  await afterSignUpdate(agreementId, options || {});

  const [rows2] = await pool.query(
    'SELECT status, url, pdfurl, columns_locked FROM agreement WHERE id = ? LIMIT 1',
    [agreementId]
  );
  const row2 = rows2[0];
  if (!row2) return { ok: false, reason: 'NOT_FOUND' };
  const done = !!row2.columns_locked || String(row2.status || '').toLowerCase() === 'completed';
  if (!done) {
    return { ok: false, reason: 'FINALIZE_NOT_COMPLETED' };
  }
  return { ok: true, status: row2.status, url: row2.url || null, pdfurl: row2.pdfurl || null };
}

module.exports = {
  getAdminList,
  listFeedback,
  listRefundDeposit,
  listPendingOperatorAgreements,
  listOwnerOperatorAgreementsForClient,
  getAgreementForOperator,
  updateFeedback,
  updateRefundDeposit,
  updateCommissionRelease,
  backfillCommissionReleasesForClient,
  removeFeedback,
  removeRefundDeposit,
  updateAgreementOperatorSign,
  retryAgreementFinalPdf,
  deleteAgreementBeforeFinalHash
};
