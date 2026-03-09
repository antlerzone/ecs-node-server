const joi = require('joi');

/* ================= ENUMS ================= */

const payment_mode_enum = ['cash', 'credit'];
const tax_mode_enum = ['inclusive', 'exclusive'];
const status_enum = ['draft', 'pending_approval', 'ready', 'void'];
const email_status_enum = ['UNSENT', 'PENDING', 'SENT', 'BOUNCED', 'OPENED', 'VIEWED'];
const payment_status_enum = ['PAID', 'OUTSTANDING', 'OVERDUE'];
const sort_by_enum = [
  'number','date','contact_name','number2',
  'title','description','amount','balance','created_at'
];
const sort_dir_enum = ['asc','desc'];
const myinvois_enum = ['NORMAL', 'VALIDATE', 'EXTERNAL'];

/* ================= CHILD ITEM ================= */

const child_item_schema = joi.object({
  id: joi.number().optional(),
  type: joi.string().optional(),
  account_id: joi.number().required(),
  description: joi.string().required(),
  service_date: joi.date().iso().optional(),
  product_id: joi.number().optional(),
  product_unit_id: joi.number().optional(),
  location_id: joi.number().optional(),
  unit_price: joi.number().precision(4).required(),
  quantity: joi.number().precision(4).required(),
  discount: joi.string().max(14).optional(),
  tax_code_id: joi.number().optional(),
  classification_code: joi.string().optional()
});

/* ================= FORM ITEM ================= */

const form_item_schema = joi.object({
  id: joi.number().optional(),
  transfer_item_id: joi.number().optional(),
  type: joi.string().allow(null, 'bundle', 'subtitle', 'subtotal'),
  account_id: joi.number().when('type', {
    is: null,
    then: joi.required(),
    otherwise: joi.optional()
  }),
  description: joi.string().required(),
  service_date: joi.date().iso().optional(),
  product_id: joi.number().optional(),
  product_unit_id: joi.number().optional(),
  location_id: joi.number().optional(),
  unit_price: joi.number().precision(4).when('type', {
    is: null,
    then: joi.required(),
    otherwise: joi.optional()
  }),
  quantity: joi.number().precision(4).when('type', {
    is: null,
    then: joi.required(),
    otherwise: joi.optional()
  }),
  discount: joi.string().max(14).optional(),
  tax_code_id: joi.number().optional(),
  classification_code: joi.string().optional(),
  children: joi.array().items(child_item_schema).optional()
});

/* ================= TERM ITEM ================= */

const term_item_schema = joi.object({
  id: joi.number().optional(),
  term_id: joi.number().optional(),
  date: joi.date().iso().optional(),
  payment_due: joi.string().required(),
  description: joi.string().optional()
});

/* ================= DEPOSIT ITEM ================= */

const deposit_item_schema = joi.object({
  id: joi.number().optional(),
  payment_method_id: joi.number().optional(),
  account_id: joi.number().required(),
  amount: joi.number().required(),
  number: joi.string().optional(),
  fee_text: joi.string().optional(),
  fee_account_id: joi.number().when('fee_text', {
    is: joi.exist(),
    then: joi.required(),
    otherwise: joi.optional()
  })
});

/* ================= EMAIL ================= */

const email_schema = joi.object({
  to_addresses: joi.array().items(joi.string().email()).min(1).required(),
  cc_addresses: joi.array().items(joi.string().email()).optional(),
  reply_to_address: joi.string().email().optional(),
  subject: joi.string().optional(),
  message: joi.string().optional(),
  attach_pdf: joi.boolean().optional(),
  form_design_id: joi.number().optional()
});

/* ================= FILE ================= */

const file_schema = joi.object({
  file_id: joi.number().required(),
  is_shared: joi.boolean().required()
});

/* ================= FIELD ================= */

const field_schema = joi.object({
  id: joi.number().required(),
  value: joi.any().required()
});

/* ================= CREATE INVOICE ================= */

const create_invoice_schema = joi.object({
  payment_mode: joi.string().valid(...payment_mode_enum).required(),
  contact_id: joi.number().required(),
  number: joi.string().max(50).optional(),
  number2: joi.string().max(50).optional(),
  date: joi.date().iso().required(),
  currency_code: joi.string().required(),
  exchange_rate: joi.number().required(),
  billing_party: joi.string().optional(),
  show_shipping: joi.boolean().optional(),
  shipping_party: joi.string().optional(),
  shipping_info: joi.string().max(100).optional(),
  tag_ids: joi.array().items(joi.number()).max(4).optional(),
  title: joi.string().max(255).optional(),
  description: joi.string().max(255).optional(),
  remarks: joi.string().optional(),
  tax_mode: joi.string().valid(...tax_mode_enum).required(),
  form_items: joi.array().items(form_item_schema).min(1).required(),
  term_items: joi.array().items(term_item_schema).when('payment_mode', {
    is: 'credit',
    then: joi.required(),
    otherwise: joi.optional()
  }),
  deposit_items: joi.array().items(deposit_item_schema).when('payment_mode', {
    is: 'cash',
    then: joi.required(),
    otherwise: joi.optional()
  }),
  status: joi.string().valid('draft','pending_approval','ready').required(),
  email: email_schema.optional(),
  files: joi.array().items(file_schema).optional(),
  fields: joi.array().items(field_schema).optional(),
  customs_form_no: joi.string().optional(),
  customs_k2_form_no: joi.string().optional(),
  incoterms: joi.string().optional(),
  myinvois_action: joi.string().valid(...myinvois_enum).optional()
});

/* ================= UPDATE INVOICE ================= */

const update_invoice_schema = create_invoice_schema.keys({
  number: joi.string().max(50).required()
});

/* ================= LIST QUERY ================= */

const list_invoice_schema = joi.object({
  payment_status: joi.string().valid(...payment_status_enum).optional(),
  date_from: joi.date().iso().optional(),
  date_to: joi.date().iso().optional(),
  search: joi.string().max(100).optional(),
  custom_search: joi.string().max(100).optional(),
  contact_id: joi.number().optional(),
  payment_mode: joi.string().valid(...payment_mode_enum).optional(),
  status: joi.string().valid(...status_enum).optional(),
  email_status: joi.string().valid(...email_status_enum).optional(),
  sort_by: joi.string().valid(...sort_by_enum).optional(),
  sort_dir: joi.string().valid(...sort_dir_enum).optional(),
  page: joi.number().min(1).optional(),
  page_size: joi.number().optional()
});

/* ================= STATUS UPDATE ================= */

const update_status_schema = joi.object({
  status: joi.string().valid(...status_enum).required(),
  void_reason: joi.string().max(255).when('status', {
    is: 'void',
    then: joi.required(),
    otherwise: joi.optional()
  })
});

/* ================= EXPORT ================= */

module.exports = {
  create_invoice_schema,
  update_invoice_schema,
  list_invoice_schema,
  update_status_schema
};