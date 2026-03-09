const express = require('express');
const router = express.Router();

const validate = require('../../../middleware/validate');
const invoicewrapper = require('../wrappers/invoice.wrapper');
const {
  create_invoice_schema,
  update_invoice_schema,
  list_invoice_schema,
  update_status_schema
} = require('../validators/invoice.validator');

/* create */
router.post(
  '/',
  validate(create_invoice_schema),
  async (req, res) => {
    const result = await invoicewrapper.createinvoice(req, req.body);
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  }
);

/* list */
router.get(
  '/',
  validate(list_invoice_schema, 'query'),
  async (req, res) => {
    const result = await invoicewrapper.listinvoices(req, req.query);
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  }
);

/* read */
router.get('/:id', async (req, res) => {
  const result = await invoicewrapper.readinvoice(req, req.params.id);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

/* update */
router.put(
  '/:id',
  validate(update_invoice_schema),
  async (req, res) => {
    const result = await invoicewrapper.updateinvoice(
      req,
      req.params.id,
      req.body
    );
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  }
);

/* update status */
router.patch(
  '/:id',
  validate(update_status_schema),
  async (req, res) => {
    const result = await invoicewrapper.updateinvoicestatus(
      req,
      req.params.id,
      req.body
    );
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  }
);

/* delete */
router.delete('/:id', async (req, res) => {
  const result = await invoicewrapper.deleteinvoice(req, req.params.id);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

module.exports = router;