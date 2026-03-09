const joi = require('joi');

/**
 * Xero Invoices API validation.
 * @see https://developer.xero.com/documentation/api/accounting/invoices
 */

const typeEnum = ['ACCREC', 'ACCPAY'];
const statusEnum = ['DRAFT', 'SUBMITTED', 'AUTHORISED'];
const lineAmountTypesEnum = ['EXCLUSIVE', 'INCLUSIVE', 'NOTAX'];

const contactSchema = joi.object({
  ContactID: joi.string().uuid().optional(),
  Name: joi.string().max(255).optional()
}).min(1);

const lineItemSchema = joi.object({
  Description: joi.string().max(4000).required(),
  Quantity: joi.number().min(0).required(),
  UnitAmount: joi.number().required(),
  AccountCode: joi.string().max(50).required(),
  TaxType: joi.string().max(50).optional(),
  LineAmount: joi.number().optional(),
  LineItemID: joi.string().uuid().optional(),
  ItemCode: joi.string().max(50).optional(),
  TaxAmount: joi.number().optional()
});

const createInvoiceSchema = joi.object({
  Type: joi.string().valid(...typeEnum).required(),
  Contact: contactSchema.required(),
  LineItems: joi.array().items(lineItemSchema).min(1).required(),
  Date: joi.string().isoDate().required(),
  DueDate: joi.string().isoDate().optional(),
  LineAmountTypes: joi.string().valid(...lineAmountTypesEnum).optional(),
  Reference: joi.string().max(255).optional(),
  Status: joi.string().valid(...statusEnum).optional(),
  BrandingThemeID: joi.string().uuid().optional(),
  Url: joi.string().uri().optional(),
  CurrencyCode: joi.string().length(3).optional()
});

const updateInvoiceSchema = createInvoiceSchema.keys({
  InvoiceID: joi.string().uuid().optional()
});

const listQuerySchema = joi.object({
  where: joi.string().max(500).optional(),
  order: joi.string().max(200).optional(),
  ids: joi.string().max(500).optional(),
  invoiceNumbers: joi.string().max(500).optional(),
  contactIDs: joi.string().max(500).optional(),
  statuses: joi.string().max(200).optional(),
  ifModifiedSince: joi.date().iso().optional()
});

module.exports = {
  create_invoice_schema: createInvoiceSchema,
  update_invoice_schema: updateInvoiceSchema,
  list_invoice_schema: listQuerySchema
};
