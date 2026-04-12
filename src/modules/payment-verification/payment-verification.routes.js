/**
 * Payment Verification API.
 * Operator-scoped (client_id from req.client.id via clientresolver or body).
 */

const express = require('express');
const router = express.Router();
const {
  createInvoiceFromReceipt,
  runMatchingForInvoice,
  syncBankTransactionsFromFinverse,
  listInvoices,
  getInvoiceWithCandidates,
  approve,
  reject
} = require('./payment-verification.service');

function getClientId(req) {
  const fromClient = req.client && req.client.id;
  const fromBody = (req.body && (req.body.client_id || req.body.clientId)) || (req.query && (req.query.client_id || req.query.clientId));
  const id = fromClient || fromBody;
  if (!id) {
    const err = new Error('client_id required');
    err.statusCode = 400;
    throw err;
  }
  return id;
}

/** POST /receipts – upload receipt (receipt_url required; amount/currency/reference_number optional, else from OCR) */
router.post('/receipts', (req, res, next) => {
  const clientId = getClientId(req);
  const payload = req.body || {};
  createInvoiceFromReceipt(clientId, payload)
    .then(data => res.json({ ok: true, data }))
    .catch(err => next(err));
});

/** GET /invoices – list payment invoices (optional ?status=). POST accepted for portal proxy (body.status). */
function handleListInvoices(req, res, next) {
  const clientId = getClientId(req);
  const status = req.query.status || (req.body && req.body.status) || undefined;
  listInvoices(clientId, { status })
    .then(rows => res.json({ ok: true, data: rows }))
    .catch(err => next(err));
}
router.get('/invoices', handleListInvoices);
router.post('/invoices', handleListInvoices);

/** GET /invoices/:id – get invoice with receipt and candidate bank transactions. POST /invoices/get-one with body.id for portal. */
function handleGetInvoice(req, res, next) {
  const clientId = getClientId(req);
  const invoiceId = req.params.id || (req.body && req.body.id);
  if (!invoiceId) return res.status(400).json({ ok: false, message: 'INVOICE_ID_REQUIRED' });
  getInvoiceWithCandidates(clientId, invoiceId)
    .then(data => {
      if (!data) return res.status(404).json({ ok: false, message: 'INVOICE_NOT_FOUND' });
      res.json({ ok: true, data });
    })
    .catch(err => next(err));
}
router.get('/invoices/:id', handleGetInvoice);
router.post('/invoices/get-one', handleGetInvoice);

/** POST /invoices/:id/match – run matching engine for this invoice */
router.post('/invoices/:id/match', (req, res, next) => {
  const clientId = getClientId(req);
  const invoiceId = req.params.id;
  runMatchingForInvoice(clientId, invoiceId)
    .then(data => res.json({ ok: true, data }))
    .catch(err => next(err));
});

/** POST /invoices/:id/approve – manual approve (optional body.bank_transaction_id) */
router.post('/invoices/:id/approve', (req, res, next) => {
  const clientId = getClientId(req);
  const invoiceId = req.params.id;
  approve(clientId, invoiceId, req.body || {})
    .then(data => res.json({ ok: true, data }))
    .catch(err => next(err));
});

/** POST /invoices/:id/reject – manual reject */
router.post('/invoices/:id/reject', (req, res, next) => {
  const clientId = getClientId(req);
  const invoiceId = req.params.id;
  reject(clientId, invoiceId)
    .then(data => res.json({ ok: true, data }))
    .catch(err => next(err));
});

/** POST /sync-bank – sync bank transactions from Finverse (optional body.from_date, to_date) */
router.post('/sync-bank', (req, res, next) => {
  const clientId = getClientId(req);
  const options = req.body || {};
  syncBankTransactionsFromFinverse(clientId, options)
    .then(data => res.json({ ok: true, data }))
    .catch(err => next(err));
});

module.exports = router;
