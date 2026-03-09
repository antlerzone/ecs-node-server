const express = require('express');
const router = express.Router();
const validate = require('../../../middleware/validate');
const invoiceWrapper = require('../wrappers/invoice.wrapper');
const validationWrapper = require('../wrappers/validation.wrapper');
const einvoiceWrapper = require('../wrappers/einvoice.wrapper');
const { createInvoiceSchema, docNoSchema } = require('../validators/invoice.validator');

/* POST create invoice */
router.post(
  '/',
  validate(createInvoiceSchema),
  async (req, res) => {
    const result = await invoiceWrapper.createInvoice(req, req.body);
    if (!result.ok) return res.status(result.status || 400).json(result);
    res.status(result.status === 201 ? 201 : 200).json(result);
  }
);

/* GET invoice by docNo: query ?docNo=xxx */
router.get(
  '/',
  validate(docNoSchema, 'query'),
  async (req, res) => {
    const result = await invoiceWrapper.getInvoice(req, req.query.docNo);
    if (!result.ok) return res.status(result.status || 400).json(result);
    res.json(result);
  }
);

/* POST void invoice: body or query docNo */
router.post(
  '/void',
  async (req, res) => {
    const docNo = req.body?.docNo || req.query?.docNo;
    if (!docNo) return res.status(400).json({ ok: false, error: 'docNo required' });
    const result = await invoiceWrapper.voidInvoice(req, docNo, req.body);
    if (!result.ok) return res.status(result.status || 400).json(result);
    res.status(result.status === 204 ? 204 : 200).json(result.ok ? { ok: true } : result);
  }
);

/* POST validate (e-invoice validation) */
router.post(
  '/validate',
  async (req, res) => {
    const docNo = req.body?.docNo || req.query?.docNo;
    if (!docNo) return res.status(400).json({ ok: false, error: 'docNo required' });
    const result = await validationWrapper.validateInvoice(req, docNo);
    if (!result.ok) return res.status(result.status || 400).json(result);
    res.json(result);
  }
);

/* POST submit e-invoice */
router.post(
  '/e-invoice/submit',
  async (req, res) => {
    const docNo = req.body?.docNo || req.query?.docNo;
    if (!docNo) return res.status(400).json({ ok: false, error: 'docNo required' });
    const result = await einvoiceWrapper.submitEInvoice(req, docNo);
    if (!result.ok) return res.status(result.status || 400).json(result);
    res.json(result);
  }
);

/* POST cancel e-invoice */
router.post(
  '/e-invoice/cancel',
  async (req, res) => {
    const docNo = req.body?.docNo || req.query?.docNo;
    if (!docNo) return res.status(400).json({ ok: false, error: 'docNo required' });
    const result = await einvoiceWrapper.cancelEInvoice(req, docNo, req.body);
    if (!result.ok) return res.status(result.status || 400).json(result);
    res.json(result);
  }
);

/* GET e-invoice status */
router.get(
  '/e-invoice/status',
  validate(docNoSchema, 'query'),
  async (req, res) => {
    const result = await einvoiceWrapper.getEInvoiceStatus(req, req.query.docNo);
    if (!result.ok) return res.status(result.status || 400).json(result);
    res.json(result);
  }
);

module.exports = router;
