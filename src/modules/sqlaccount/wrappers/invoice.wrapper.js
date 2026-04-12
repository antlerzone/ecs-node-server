/**
 * SQL Account API: Sales Invoice (Postman: Invoice → /salesinvoice).
 * Aligns with Bukku/Xero naming: list, read, create, update, remove.
 */

const sqlaccountrequest = require('./sqlaccountrequest');
const { salesInvoice: PATH } = require('../lib/postmanPaths');

function docPath(dockey) {
  const d = encodeURIComponent(String(dockey ?? '').trim());
  return `${PATH}/${d}`;
}

async function list(req, params = {}) {
  return sqlaccountrequest({ req, method: 'get', path: PATH, params });
}

async function read(req, dockey) {
  return sqlaccountrequest({ req, method: 'get', path: docPath(dockey) });
}

function toDateOnly(v) {
  const d = v ? new Date(v) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function toMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0.00';
  return n.toFixed(2);
}

function toQty(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '1.00';
  return n.toFixed(2);
}

function buildUniqueDocNo(prefix = 'IV') {
  const now = new Date();
  const ts =
    String(now.getUTCFullYear()) +
    String(now.getUTCMonth() + 1).padStart(2, '0') +
    String(now.getUTCDate()).padStart(2, '0') +
    String(now.getUTCHours()).padStart(2, '0') +
    String(now.getUTCMinutes()).padStart(2, '0') +
    String(now.getUTCSeconds()).padStart(2, '0');
  const rand = Math.floor(Math.random() * 1e6).toString().padStart(6, '0');
  return `${prefix}-${ts}-${rand}`;
}

async function getCustomerProfile(req, customerCode) {
  if (!customerCode) return null;
  const c = encodeURIComponent(String(customerCode).trim());
  if (!c) return null;
  const res = await sqlaccountrequest({ req, method: 'get', path: `/customer/${c}` });
  if (!res.ok) return null;
  const d = res.data;
  const row =
    (Array.isArray(d?.data) && d.data[0]) ||
    (d?.data && typeof d.data === 'object' ? d.data : null) ||
    (d && typeof d === 'object' ? d : null);
  if (!row) return null;
  return row;
}

async function normalizeCreatePayload(req, payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const customerCode = String(p.code || p.contactId || '').trim();
  const customer = await getCustomerProfile(req, customerCode);
  const customerCurrency = String(customer?.currencycode || customer?.CurrencyCode || '').trim();
  const currencyCode = String(p.currencycode || p.currencyCode || customerCurrency || '----').trim();

  // If caller already passes SQL-style document with line dataset, still align header currency
  // with customer currency to avoid SQL validation rejection.
  if (Array.isArray(p.sdsdocdetail) && p.sdsdocdetail.length) {
    return {
      ...p,
      currencycode: currencyCode,
      currencyCode
    };
  }

  // Backward-compatible compact payload used by rentalcollection-invoice:
  // { contactId, accountId, amount, description, date }
  const accountCode = String(p.account || p.accountId || '').trim();
  const amount = toMoney(p.amount);
  const qty = toQty(p.quantity || 1);
  const date = toDateOnly(p.date || p.docdate);
  const description = String(p.description || p.title || 'Invoice item').trim();
  const companyname = String(
    p.companyname ||
    p.CompanyName ||
    customer?.companyname ||
    customer?.CompanyName ||
    customer?.companyname2 ||
    customer?.description ||
    customer?.Description ||
    ''
  ).trim();
  return {
    dockey: Number(p.dockey || 0),
    docno: String(p.docno || '').trim() || buildUniqueDocNo(String(p.docPrefix || 'IV').trim() || 'IV'),
    docnoex: String(p.docnoex || ''),
    docdate: date,
    postdate: date,
    taxdate: date,
    code: customerCode,
    companyname,
    currencycode: currencyCode,
    currencyCode,
    currencyrate: String(p.currencyrate || '1.00'),
    description,
    cancelled: false,
    status: Number.isFinite(Number(p.status)) ? Number(p.status) : 0,
    docamt: amount,
    localdocamt: amount,
    d_amount: amount,
    updatecount: Number.isFinite(Number(p.updatecount)) ? Number(p.updatecount) : 0,
    sdsdocdetail: [{
      dtlkey: 0,
      dockey: 0,
      seq: 1,
      itemcode: String(p.itemcode || ''),
      description,
      qty,
      rate: String(p.rate || '0.00'),
      unitprice: amount,
      deliverydate: date,
      tax: String(p.tax || ''),
      taxrate: String(p.taxrate || '0.00'),
      taxamt: String(p.taxamt || '0.00'),
      localtaxamt: String(p.localtaxamt || '0.00'),
      taxinclusive: !!p.taxinclusive,
      amount,
      localamount: amount,
      taxableamt: amount,
      amountwithtax: amount,
      account: accountCode
    }],
    sdsdocterm: [{
      dockey: 0,
      seq: 1,
      date,
      description: 'Due',
      payment_due: '100%',
      amount
    }]
  };
}

async function create(req, payload) {
  const body = await normalizeCreatePayload(req, payload);
  const line0 = Array.isArray(body.sdsdocdetail) && body.sdsdocdetail[0] ? body.sdsdocdetail[0] : {};
  console.log('[sql/invoice.create] request', JSON.stringify({
    clientId: req?.client?.id || null,
    code: body.code || '',
    companyname: body.companyname || '',
    currencycode: body.currencycode || body.currencyCode || '',
    docdate: body.docdate || '',
    lineAccount: line0.account || '',
    amount: line0.amount || body.docamt || ''
  }));
  const res = await sqlaccountrequest({ req, method: 'post', path: PATH, data: body });
  if (!res.ok) {
    console.warn('[sql/invoice.create] failed', JSON.stringify({
      status: res.status,
      error: res.error
    }));
  }
  return res;
}

async function update(req, dockey, payload) {
  return sqlaccountrequest({ req, method: 'put', path: docPath(dockey), data: payload || {} });
}

async function remove(req, dockey) {
  return sqlaccountrequest({ req, method: 'delete', path: docPath(dockey) });
}

async function listInvoices(req, params = {}) {
  return list(req, params);
}

async function getInvoice(req, invoiceId) {
  return read(req, invoiceId);
}

async function createInvoice(req, payload) {
  return create(req, payload);
}

async function updateInvoice(req, invoiceId, payload) {
  return update(req, invoiceId, payload);
}

module.exports = {
  list,
  read,
  create,
  update,
  remove,
  listInvoices,
  getInvoice,
  createInvoice,
  updateInvoice
};
