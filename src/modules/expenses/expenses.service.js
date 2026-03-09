/**
 * Expenses (UtilityBills) – list/insert/update/delete from MySQL bills table.
 * Data: bills, propertydetail (shortname), supplierdetail (billtype_wixid → supplier title). FK: supplierdetail_id → supplierdetail(id).
 */

const { randomUUID } = require('crypto');
const pool = require('../../config/db');
const { createPurchaseForBills } = require('./expenses-purchase.service');

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;
const CACHE_LIMIT_MAX = 2000;

/**
 * Build ORDER BY from sort key (frontend: new, old, az, za, amountdesc, amountasc, paid, unpaid).
 */
function orderClause(sort) {
  switch (String(sort || 'new').toLowerCase()) {
    case 'old':
      return 'ORDER BY b.period ASC, b.created_at ASC';
    case 'az':
      return 'ORDER BY b.description ASC';
    case 'za':
      return 'ORDER BY b.description DESC';
    case 'amountasc':
      return 'ORDER BY b.amount ASC';
    case 'amountdesc':
      return 'ORDER BY b.amount DESC';
    case 'paid':
      return 'ORDER BY b.paid DESC, b.period DESC';
    case 'unpaid':
      return 'ORDER BY b.paid ASC, b.period DESC';
    case 'new':
    default:
      return 'ORDER BY b.period DESC, b.created_at DESC';
  }
}

/**
 * List expenses (bills) for a client with filters and pagination.
 * @param {string} clientId
 * @param {Object} opts - { property, type, from, to, search, sort, page, pageSize, limit? }
 *   limit: if set, return up to min(limit, CACHE_LIMIT_MAX) items in one page (for frontend cache); total still reflects full count.
 * @returns {Promise<{ items: Array, totalPages: number, currentPage: number, total: number }>}
 */
async function getExpenses(clientId, opts = {}) {
  const limit = opts.limit != null ? Math.min(CACHE_LIMIT_MAX, Math.max(1, parseInt(opts.limit, 10) || 0)) : null;
  const useLimit = limit != null && limit > 0;

  const page = useLimit ? 1 : Math.max(1, parseInt(opts.page, 10) || 1);
  const pageSize = useLimit ? limit : Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(opts.pageSize, 10) || DEFAULT_PAGE_SIZE));
  const offset = (page - 1) * pageSize;

  const { whereSql, params } = listConditions(clientId, opts);
  const orderSql = orderClause(opts.sort || 'new');

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM bills b WHERE ${whereSql}`,
    params
  );
  const total = Number(countRows[0]?.total || 0);
  const totalPages = useLimit ? 1 : Math.max(1, Math.ceil(total / pageSize));

  const [rows] = await pool.query(
    `SELECT b.id, b.description, b.amount, b.period, b.billurl, b.paid,
            b.property_id, b.billtype_wixid,
            p.shortname AS property_shortname,
            s.title AS supplier_title
       FROM bills b
       LEFT JOIN propertydetail p ON p.id = b.property_id
       LEFT JOIN supplierdetail s ON s.wix_id = b.billtype_wixid
       WHERE ${whereSql}
       ${orderSql}
       LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  const items = rows.map(r => ({
    _id: r.id,
    id: r.id,
    description: r.description || '',
    amount: r.amount,
    period: r.period,
    bukkuurl: r.billurl || '',
    paid: !!r.paid,
    propertyId: r.property_id || null,
    typeWixId: r.billtype_wixid || null,
    billType: r.supplier_title != null ? { title: r.supplier_title, _id: r.billtype_wixid } : null,
    property: r.property_shortname != null ? { shortname: r.property_shortname, _id: r.property_id } : null
  }));

  return {
    items,
    totalPages,
    currentPage: page,
    total
  };
}

/**
 * Build WHERE + params for list/ids (same as getExpenses).
 */
function listConditions(clientId, opts = {}) {
  const search = (opts.search || '').trim();
  const propertyId = opts.property === 'ALL' || !opts.property ? null : opts.property;
  const typeId = opts.type === 'ALL' || !opts.type ? null : opts.type;
  const from = opts.from || null;
  const to = opts.to || null;
  const conditions = ['b.client_id = ?'];
  const params = [clientId];
  if (propertyId) {
    conditions.push('b.property_id = ?');
    params.push(propertyId);
  }
  if (typeId) {
    conditions.push('b.billtype_wixid = ?');
    params.push(typeId);
  }
  if (from) {
    conditions.push('b.period >= ?');
    params.push(from);
  }
  if (to) {
    conditions.push('b.period <= ?');
    params.push(to);
  }
  if (search) {
    conditions.push('(b.description LIKE ? OR b.listingtitle LIKE ?)');
    const term = `%${search}%`;
    params.push(term, term);
  }
  return { whereSql: conditions.join(' AND '), params };
}

/**
 * Get property/type/supplier options for filters and bulk upload (no wixData).
 * Types = supplierdetail from bills (billtype_wixid → supplierdetail.wix_id); fallback: supplierdetail WHERE client_id.
 */
async function getExpensesFilters(clientId) {
  const [propRows] = await pool.query(
    'SELECT id, shortname FROM propertydetail WHERE client_id = ? ORDER BY shortname ASC LIMIT 1000',
    [clientId]
  );
  const properties = (propRows || []).map(p => ({
    value: p.id,
    label: p.shortname || p.id
  }));

  let [typeRows] = await pool.query(
    `SELECT DISTINCT s.wix_id, s.title
       FROM bills b
       JOIN supplierdetail s ON s.wix_id = b.billtype_wixid
       WHERE b.client_id = ? AND b.billtype_wixid IS NOT NULL AND b.billtype_wixid != ''
       ORDER BY s.title ASC LIMIT 500`,
    [clientId]
  );
  if (!typeRows || typeRows.length === 0) {
    [typeRows] = await pool.query(
      'SELECT wix_id, title FROM supplierdetail WHERE client_id = ? AND wix_id IS NOT NULL ORDER BY title ASC LIMIT 500',
      [clientId]
    );
  }
  const types = (typeRows || []).map(t => ({
    value: t.wix_id || t.id,
    label: t.title || t.wix_id || ''
  }));

  const [supRows] = await pool.query(
    'SELECT id, title FROM supplierdetail WHERE client_id = ? ORDER BY title ASC LIMIT 1000',
    [clientId]
  );
  const suppliers = (supRows || []).map(s => ({
    id: s.id,
    title: s.title || ''
  }));

  return { properties, types, suppliers };
}

/** Same filter as list, returns only ids (max 5000). One ECS call for "select all". */
async function getExpensesIds(clientId, opts = {}) {
  const { whereSql, params } = listConditions(clientId, opts);
  const orderSql = orderClause(opts.sort || 'new');
  const [rows] = await pool.query(
    `SELECT b.id FROM bills b WHERE ${whereSql} ${orderSql} LIMIT 5000`,
    params
  );
  return { ids: (rows || []).map(r => r.id) };
}

/** Sum/count for selected ids only. One ECS call for total line. */
async function getExpensesSelectedTotal(clientId, ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return { count: 0, totalAmount: 0 };
  }
  const placeholders = ids.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt, COALESCE(SUM(amount), 0) AS total
       FROM bills WHERE client_id = ? AND id IN (${placeholders})`,
    [clientId, ...ids]
  );
  const r = rows && rows[0];
  return {
    count: Number(r?.cnt || 0),
    totalAmount: Number(r?.total || 0)
  };
}

/**
 * Resolve supplierdetail: accept either id or wix_id; return { id, wix_id } for bills.
 * Form dropdown sends wix_id; bulk upload sends supplierdetail.id.
 */
async function resolveSupplierdetail(idOrWixId) {
  if (!idOrWixId) return null;
  const [rows] = await pool.query(
    'SELECT id, wix_id FROM supplierdetail WHERE id = ? OR wix_id = ? LIMIT 1',
    [idOrWixId, idOrWixId]
  );
  return rows && rows[0] ? rows[0] : null;
}

/**
 * Insert expense records. Each: { property, billType, description, amount, period }.
 * billType = supplierdetail.wix_id (form) or supplierdetail.id (bulk); we set supplierdetail_id and billtype_wixid.
 */
async function insertExpenses(clientId, records) {
  if (!Array.isArray(records) || records.length === 0) {
    return { inserted: 0, ids: [] };
  }
  const MAX_INSERT = 500;
  const list = records.slice(0, MAX_INSERT);
  const ids = [];
  for (const r of list) {
    const id = randomUUID();
    ids.push(id);
    let period = null;
    if (r.period != null) {
      const d = r.period instanceof Date ? r.period : new Date(r.period);
      period = Number.isFinite(d.getTime()) ? d : null;
    }
    const billTypeValue = r.billType || null;
    const supplier = billTypeValue ? await resolveSupplierdetail(billTypeValue) : null;
    const supplierdetailId = supplier ? supplier.id : null;
    const billtypeWixid = supplier ? supplier.wix_id : null;
    await pool.query(
      `INSERT INTO bills (id, client_id, property_id, supplierdetail_id, billtype_wixid, description, amount, period, paid, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NOW(), NOW())`,
      [
        id,
        clientId,
        r.property || null,
        supplierdetailId,
        billtypeWixid,
        r.description || '',
        Number(r.amount) || 0,
        period
      ]
    );
  }
  return { inserted: ids.length, ids };
}

/**
 * Delete bills by ids; only rows with client_id = clientId are removed.
 * Returns { deleted: number }.
 */
async function deleteExpenses(clientId, ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return { deleted: 0 };
  }
  const placeholders = ids.map(() => '?').join(',');
  const [result] = await pool.query(
    `DELETE FROM bills WHERE client_id = ? AND id IN (${placeholders})`,
    [clientId, ...ids]
  );
  return { deleted: result.affectedRows || 0 };
}

/**
 * Update one bill (e.g. mark paid). Only rows with client_id = clientId. Fields: paid, paidat, paymentmethod.
 */
async function updateExpense(clientId, id, data) {
  const updates = [];
  const params = [];
  if (data.paid !== undefined) {
    updates.push('paid = ?');
    params.push(data.paid ? 1 : 0);
  }
  if (data.paidat !== undefined) {
    updates.push('paidat = ?');
    params.push(data.paidat instanceof Date ? data.paidat : new Date(data.paidat));
  }
  if (data.paymentmethod !== undefined) {
    updates.push('paymentmethod = ?');
    params.push(String(data.paymentmethod));
  }
  if (updates.length === 0) return { updated: 0 };
  params.push(id, clientId);
  const [result] = await pool.query(
    `UPDATE bills SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ? AND client_id = ?`,
    params
  );
  if (result.affectedRows > 0 && data.paid === true) {
    try {
      await createPurchaseForBills(clientId, [id], {
        paidAt: data.paidat != null ? data.paidat : new Date(),
        paymentMethod: data.paymentmethod != null ? data.paymentmethod : 'Cash'
      });
    } catch (e) {
      console.warn('[expenses] createPurchaseForBills (single pay) failed:', e?.message || e);
    }
  }
  return { updated: result.affectedRows || 0 };
}

/**
 * Bulk mark paid: set paid=1, paidat, paymentmethod for given ids (same client).
 */
async function bulkMarkPaid(clientId, ids, paidAt, paymentMethod) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return { updated: 0 };
  }
  const at = paidAt instanceof Date ? paidAt : new Date(paidAt);
  const method = paymentMethod != null ? String(paymentMethod) : 'Bulk';
  const placeholders = ids.map(() => '?').join(',');
  const [result] = await pool.query(
    `UPDATE bills SET paid = 1, paidat = ?, paymentmethod = ?, updated_at = NOW()
     WHERE client_id = ? AND id IN (${placeholders})`,
    [at, method, clientId, ...ids]
  );
  if (result.affectedRows > 0) {
    try {
      await createPurchaseForBills(clientId, ids, { paidAt: at, paymentMethod: method });
    } catch (e) {
      console.warn('[expenses] createPurchaseForBills (bulk) failed:', e?.message || e);
    }
  }
  return { updated: result.affectedRows || 0 };
}

/**
 * Bulk template data for frontend/iframe download. Returns columns + sample row shape.
 */
function getBulkTemplateData() {
  return {
    success: true,
    columns: [
      { id: 'property', dataPath: 'property', label: 'Property', type: 'string' },
      { id: 'supplier', dataPath: 'supplier', label: 'Supplier', type: 'string' },
      { id: 'description', dataPath: 'description', label: 'Description', type: 'string' },
      { id: 'amount', dataPath: 'amount', label: 'Amount', type: 'string' },
      { id: 'period', dataPath: 'period', label: 'Period', type: 'string' }
    ],
    headers: ['Property', 'Supplier', 'Description', 'Amount', 'Period']
  };
}

module.exports = {
  getExpenses,
  getExpensesFilters,
  getExpensesIds,
  getExpensesSelectedTotal,
  insertExpenses,
  deleteExpenses,
  updateExpense,
  bulkMarkPaid,
  getBulkTemplateData
};
