/**
 * Expenses API – list bills (UtilityBills) from MySQL for Wix frontend.
 * Requires email for access context; returns items in shape expected by repeaterexpenses.
 */

const express = require('express');
const router = express.Router();
const { getAccessContextByEmail } = require('../access/access.service');
const {
  getExpenses,
  getExpensesFilters,
  getExpensesIds,
  getExpensesSelectedTotal,
  insertExpenses,
  deleteExpenses,
  updateExpense,
  bulkMarkPaid,
  getBulkTemplateData
} = require('./expenses.service');
const { generateBulkTemplateExcel, getClientCurrency } = require('./expenses-template-excel');
const downloadStore = require('../download/download.store');

function getEmail(req) {
  return req.body?.email ?? req.query?.email ?? null;
}

function getPaidAtFromBody(body) {
  return (
    body?.paidAt ??
    body?.paidat ??
    body?.datepickerpayment ??
    body?.paymentDate ??
    body?.date ??
    new Date()
  );
}

function getPaymentMethodFromBody(body) {
  return (
    body?.paymentMethod ??
    body?.paymentmethod ??
    body?.dropdownpaymentmethod ??
    body?.method ??
    'Cash'
  );
}

/**
 * POST /api/expenses/list
 * Body: { email, property?, type?, from?, to?, search?, sort?, page?, pageSize?, limit? }
 * limit: optional, max 2000; when set, one page with up to limit items (for frontend cache).
 * sort: new | old | az | za | amountdesc | amountasc | paid | unpaid
 * Returns: { items, totalPages, currentPage, total }
 */
router.post('/list', async (req, res, next) => {
  try {
    const email = getEmail(req);
    if (!email) {
      return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
    }
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) {
      return res.status(403).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    }

    const opts = {
      property: req.body?.property,
      type: req.body?.type,
      from: req.body?.from,
      to: req.body?.to,
      search: req.body?.search,
      sort: req.body?.sort,
      page: req.body?.page,
      pageSize: req.body?.pageSize,
      limit: req.body?.limit,
      paid: req.body?.paid
    };
    const clientId = ctx.client?.id;
    if (!clientId) {
      return res.status(403).json({ ok: false, reason: 'NO_CLIENT' });
    }
    const result = await getExpenses(clientId, opts);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/expenses/filters
 * Body: { email }
 * Returns: { properties, types, suppliers }
 */
router.post('/filters', async (req, res, next) => {
  try {
    const email = getEmail(req);
    if (!email) {
      return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
    }
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) {
      return res.status(403).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    }
    const clientId = ctx.client?.id;
    if (!clientId) {
      return res.status(403).json({ ok: false, reason: 'NO_CLIENT' });
    }
    const result = await getExpensesFilters(clientId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/expenses/ids
 * Body: same as list (email, property, type, from, to, search, sort). Returns { ids: string[] } (max 5000).
 */
router.post('/ids', async (req, res, next) => {
  try {
    const email = getEmail(req);
    if (!email) {
      return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
    }
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) {
      return res.status(403).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    }
    const clientId = ctx.client?.id;
    if (!clientId) {
      return res.status(403).json({ ok: false, reason: 'NO_CLIENT' });
    }
    const opts = {
      property: req.body?.property,
      type: req.body?.type,
      from: req.body?.from,
      to: req.body?.to,
      search: req.body?.search,
      sort: req.body?.sort
    };
    const result = await getExpensesIds(clientId, opts);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/expenses/selected-total
 * Body: { email, ids: string[] }. Returns { count, totalAmount }.
 */
router.post('/selected-total', async (req, res, next) => {
  try {
    const ctx = await requireCtx(req, res);
    if (!ctx) return;
    const ids = req.body?.ids;
    if (!Array.isArray(ids)) {
      return res.status(400).json({ count: 0, totalAmount: 0 });
    }
    const result = await getExpensesSelectedTotal(ctx.clientId, ids);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

async function requireCtx(req, res) {
  const email = getEmail(req);
  if (!email) {
    res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
    return null;
  }
  const ctx = await getAccessContextByEmail(email);
  if (!ctx.ok) {
    res.status(403).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    return null;
  }
  const clientId = ctx.client?.id;
  if (!clientId) {
    res.status(403).json({ ok: false, reason: 'NO_CLIENT' });
    return null;
  }
  return { clientId };
}

/** POST /api/expenses/insert  Body: { email, records: [{ property, billType, description, amount, period }] } */
router.post('/insert', async (req, res, next) => {
  try {
    const ctx = await requireCtx(req, res);
    if (!ctx) return;
    const records = req.body?.records;
    if (!Array.isArray(records)) {
      return res.status(400).json({ ok: false, reason: 'NO_RECORDS' });
    }
    const result = await insertExpenses(ctx.clientId, records);
    res.json(result);
  } catch (err) {
    const msg = err && err.message ? String(err.message) : '';
    const isFk = /foreign key|ER_NO_REFERENCED_ROW|ER_ROW_IS_REFERENCED/i.test(msg);
    if (isFk) {
      console.error('[expenses/insert] FK or reference error:', msg);
      return res.status(400).json({ ok: false, reason: 'INVALID_PROPERTY_OR_SUPPLIER', message: 'Property or Supplier not found for this client.' });
    }
    console.error('[expenses/insert]', err);
    next(err);
  }
});

/** POST /api/expenses/delete  Body: { email, ids: string[] } — 记录哪個 email 刪除了（console 查 log） */
router.post('/delete', async (req, res, next) => {
  try {
    const email = getEmail(req);
    const ctx = await requireCtx(req, res);
    if (!ctx) return;
    const ids = req.body?.ids;
    if (!Array.isArray(ids)) {
      return res.status(400).json({ ok: false, reason: 'NO_IDS' });
    }
    console.log('[expenses/delete] email:', email || '(none)', 'deleted ids:', ids);
    const result = await deleteExpenses(ctx.clientId, ids);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/expenses/update  Body: { email, id, paid?, paidat?, paymentmethod? } */
router.post('/update', async (req, res, next) => {
  try {
    const ctx = await requireCtx(req, res);
    if (!ctx) return;
    const id = req.body?.id;
    if (!id) {
      return res.status(400).json({ ok: false, reason: 'NO_ID' });
    }
    const result = await updateExpense(ctx.clientId, id, {
      paid: req.body?.paid,
      paidat: getPaidAtFromBody(req.body),
      paymentmethod: getPaymentMethodFromBody(req.body)
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/expenses/bulk-mark-paid  Body: { email, ids: string[], paidAt?, paymentMethod? } */
router.post('/bulk-mark-paid', async (req, res, next) => {
  try {
    const ctx = await requireCtx(req, res);
    if (!ctx) return;
    const ids = req.body?.ids;
    if (!Array.isArray(ids)) {
      return res.status(400).json({ ok: false, reason: 'NO_IDS' });
    }
    const paidAt = getPaidAtFromBody(req.body);
    const paymentMethod = getPaymentMethodFromBody(req.body);
    const result = await bulkMarkPaid(ctx.clientId, ids, paidAt, paymentMethod);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/expenses/bulk-template  Body: { email }  Returns template columns for download */
router.post('/bulk-template', async (req, res, next) => {
  try {
    const ctx = await requireCtx(req, res);
    if (!ctx) return;
    const result = getBulkTemplateData();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/expenses/bulk-template-file  Body: { email }  Returns { filename, data: base64 } for direct download */
router.post('/bulk-template-file', async (req, res, next) => {
  try {
    const ctx = await requireCtx(req, res);
    if (!ctx) return;
    const buffer = await generateBulkTemplateExcel(ctx.clientId);
    const currency = await getClientCurrency(ctx.clientId);
    const filename = `BulkExpensesTemplate_${currency}.xlsx`;
    const data = buffer.toString('base64');
    res.json({ filename, data });
  } catch (err) {
    next(err);
  }
});

/** POST /api/expenses/download-template-url  Body: { email }  Returns { downloadUrl } – frontend wixLocation.to(downloadUrl) */
router.post('/download-template-url', async (req, res, next) => {
  try {
    const ctx = await requireCtx(req, res);
    if (!ctx) return;
    const buffer = await generateBulkTemplateExcel(ctx.clientId);
    const currency = await getClientCurrency(ctx.clientId);
    const filename = `BulkExpensesTemplate_${currency}.xlsx`;
    const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const token = downloadStore.set(buffer, filename, mime);
    const baseUrl = process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get('host')}`;
    res.json({ downloadUrl: `${baseUrl}/api/download/${token}` });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
