/**
 * Admin Dashboard – feedback + refunddeposit list/update/delete.
 * Scoped by client_id from access context. Uses MySQL: feedback, refunddeposit, roomdetail, tenantdetail, propertydetail, clientdetail, bankdetail.
 */

const { randomUUID } = require('crypto');
const pool = require('../../config/db');
const {
  getAccountIdByWixId,
  createInvoicesForRentalRecords,
  createReceiptForForfeitDepositRentalCollection
} = require('../rentalcollection-invoice/rentalcollection-invoice.service');

const FORFEIT_DEPOSIT_WIX_ID = '1c7e41b6-9d57-4c03-8122-a76baad3b592';

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
  const [rows] = await pool.query(
    `SELECT f.id, f.description, f.photo, f.video, f.done, f.remark, f.created_at,
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
     LEFT JOIN clientdetail c ON c.id = f.client_id
     WHERE f.client_id = ? AND (f.done = 0 OR f.done IS NULL)
     ORDER BY f.created_at DESC
     LIMIT 1000`,
    [clientId]
  );
  return rows.map((r) => ({
    _id: r.id,
    id: r.id,
    _type: 'FEEDBACK',
    description: r.description ?? '',
    photo: parsePhoto(r.photo),
    video: r.video ?? null,
    done: !!r.done,
    remark: r.remark ?? '',
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
  }));
}

/**
 * List refunddeposit rows for client with room, tenant, client.
 * Returns array of { _id, _type: 'REFUND', amount, done, _createdDate, room, tenant, client }.
 */
async function listRefundDeposit(clientId) {
  if (!clientId) return [];
  const [rows] = await pool.query(
    `SELECT rd.id, rd.amount, rd.done, rd.roomtitle, rd.tenantname, rd.created_at,
            rd.room_id, rd.tenant_id, rd.client_id,
            rm.title_fld AS room_title_fld,
            tn.fullname AS tenant_fullname, tn.bankaccount AS tenant_bankaccount, tn.accountholder AS tenant_accountholder,
            b.bankname AS tenant_bankname,
            c.currency AS client_currency
     FROM refunddeposit rd
     LEFT JOIN roomdetail rm ON rm.id = rd.room_id
     LEFT JOIN tenantdetail tn ON tn.id = rd.tenant_id
     LEFT JOIN bankdetail b ON b.id = tn.bankname_id
     LEFT JOIN clientdetail c ON c.id = rd.client_id
     WHERE rd.client_id = ?
     ORDER BY rd.created_at DESC
     LIMIT 1000`,
    [clientId]
  );
  return rows.map((r) => ({
    _id: r.id,
    id: r.id,
    _type: 'REFUND',
    amount: r.amount,
    done: !!r.done,
    _createdDate: r.created_at,
    room: r.room_id
      ? { id: r.room_id, title_fld: r.room_title_fld }
      : (r.roomtitle ? { title_fld: r.roomtitle } : null),
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
 * @param {object} opts - { filterType: 'ALL'|'Feedback'|'Refund'|'Agreement', search?, sort: 'new'|'old', page?, pageSize?, limit? }
 * @returns {Promise<{ items: array, total: number, totalPages?: number, currentPage?: number }>}
 */
async function getAdminList(clientId, opts = {}) {
  const filterType = opts.filterType === 'Feedback' || opts.filterType === 'Refund' || opts.filterType === 'Agreement' ? opts.filterType : 'ALL';
  const search = typeof opts.search === 'string' ? opts.search.trim().toLowerCase() : '';
  const sort = opts.sort === 'old' ? 'old' : 'new';
  const limit = opts.limit != null ? Math.min(ADMIN_CACHE_LIMIT, Math.max(1, parseInt(opts.limit, 10) || 0)) : null;
  const useLimit = limit != null && limit > 0;
  const page = useLimit ? 1 : Math.max(1, parseInt(opts.page, 10) || 1);
  const pageSize = useLimit ? limit : Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(opts.pageSize, 10) || DEFAULT_PAGE_SIZE));

  const [feedbackList, refundList, pendingAgreements] = await Promise.all([
    filterType === 'Refund' || filterType === 'Agreement' ? [] : listFeedback(clientId),
    filterType === 'Feedback' || filterType === 'Agreement' ? [] : listRefundDeposit(clientId),
    filterType === 'Feedback' || filterType === 'Refund' ? [] : listPendingOperatorAgreements(clientId)
  ]);
  let combined = [...feedbackList, ...refundList, ...pendingAgreements];
  combined.sort((a, b) => {
    const ta = new Date(a._createdDate || 0).getTime();
    const tb = new Date(b._createdDate || 0).getTime();
    return sort === 'old' ? ta - tb : tb - ta;
  });
  if (search) {
    combined = combined.filter((i) => {
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
  const done = payload.done === true || payload.done === 1 ? 1 : 0;
  const remark = payload.remark != null ? String(payload.remark) : null;
  const [result] = await pool.query(
    'UPDATE feedback SET done = ?, remark = ?, updated_at = NOW() WHERE id = ? AND client_id = ?',
    [done, remark, id, clientId]
  );
  if (result.affectedRows === 0) return { ok: false, reason: 'NOT_FOUND' };
  return { ok: true };
}

/**
 * Update refunddeposit: set done. Ensures row belongs to clientId.
 * When marking done=1: if payload.refundAmount < rd.amount, create forfeit for (amount - refundAmount) then refund refundAmount; else refund full amount.
 * Journal (refund + optional forfeit) only created when #buttonmarkasrefund is clicked.
 */
async function updateRefundDeposit(clientId, id, payload) {
  if (!clientId || !id) return { ok: false, reason: 'MISSING_PARAMS' };
  const done = payload.done === true || payload.done === 1 ? 1 : 0;

  const [rdRows] = await pool.query(
    `SELECT rd.id, rd.amount, rd.tenancy_id, rd.room_id, rd.tenant_id, rd.client_id, r.property_id
     FROM refunddeposit rd
     LEFT JOIN roomdetail r ON r.id = rd.room_id
     WHERE rd.id = ? AND rd.client_id = ? LIMIT 1`,
    [id, clientId]
  );
  if (!rdRows.length) return { ok: false, reason: 'NOT_FOUND' };
  const rd = rdRows[0];
  const fullAmount = Number(rd.amount) || 0;

  let actualRefund = fullAmount;
  if (payload.refundAmount != null && payload.refundAmount !== '') {
    actualRefund = Number(payload.refundAmount);
    if (actualRefund <= 0 || actualRefund > fullAmount) {
      return { ok: false, reason: 'INVALID_REFUND_AMOUNT' };
    }
  }

  if (done === 1) {
    const forfeitAmount = fullAmount - actualRefund;
    if (forfeitAmount > 0) {
      const typeId = await getAccountIdByWixId(FORFEIT_DEPOSIT_WIX_ID);
      if (typeId) {
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
        } catch (e) {
          console.warn('[admindashboard] forfeit (partial refund) failed', e?.message || e);
        }
      }
    }
    try {
      const { createRefundForRefundDeposit } = require('../rentalcollection-invoice/rentalcollection-invoice.service');
      const refundResult = await createRefundForRefundDeposit(clientId, id, { amount: actualRefund });
      if (!refundResult.ok) {
        console.warn('[admindashboard] createRefundForRefundDeposit', refundResult.reason);
      }
    } catch (e) {
      console.warn('[admindashboard] createRefundForRefundDeposit failed', e?.message || e);
    }
  }

  const [result] = await pool.query(
    'UPDATE refunddeposit SET done = ?, updated_at = NOW() WHERE id = ? AND client_id = ?',
    [done, id, clientId]
  );
  if (result.affectedRows === 0) return { ok: false, reason: 'NOT_FOUND' };
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
 * Update agreement operator sign. Ensures agreement belongs to clientId; sets operatorsign and operator_signed_ip.
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
  const [result] = await pool.query(
    'UPDATE agreement SET operatorsign = ?, operator_signed_ip = ?, updated_at = NOW() WHERE id = ? AND client_id = ?',
    [String(operatorsign).trim(), ip || null, agreementId, clientId]
  );
  if (result.affectedRows === 0) return { ok: false, reason: 'NOT_FOUND' };
  return { ok: true };
}

module.exports = {
  getAdminList,
  listFeedback,
  listRefundDeposit,
  listPendingOperatorAgreements,
  getAgreementForOperator,
  updateFeedback,
  updateRefundDeposit,
  removeFeedback,
  removeRefundDeposit,
  updateAgreementOperatorSign
};
