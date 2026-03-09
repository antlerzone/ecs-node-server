const joi = require('joi');

/** Create invoice: AutoCount Invoice Input Model (master + details) */
const createInvoiceSchema = joi.object({
  master: joi.object({
    docNo: joi.string().optional(),
    docNoFormatName: joi.string().allow(null).optional(),
    docDate: joi.string().required(),
    taxDate: joi.string().allow(null).optional(),
    debtorCode: joi.string().required(),
    debtorName: joi.string().required(),
    email: joi.string().email().allow('', null).optional(),
    address: joi.string().allow('', null).optional(),
    creditTerm: joi.string().allow(null).optional(),
    currencyRate: joi.number().optional(),
    inclusiveTax: joi.boolean().optional(),
    paymentMethod: joi.string().allow(null).optional()
  }).required(),
  details: joi.array().items(joi.object({
    productCode: joi.string().required(),
    description: joi.string().allow('').optional(),
    qty: joi.number().required(),
    unit: joi.string().optional(),
    unitPrice: joi.number().required(),
    taxCode: joi.string().allow(null).optional(),
    tariffCode: joi.string().allow(null).optional()
  })).min(1).required(),
  autoFillOption: joi.object().optional(),
  saveApprove: joi.any().optional()
}).unknown(true);

/** docNo only (for get/void/validate/submit) */
const docNoSchema = joi.object({
  docNo: joi.string().required()
});

module.exports = {
  createInvoiceSchema,
  docNoSchema
};
