const joi = require('joi');

const tax_mode_enum = ['inclusive', 'exclusive'];
const status_enum = ['draft', 'pending_approval', 'ready', 'void'];
const email_status_enum = ['UNSENT', 'PENDING', 'SENT', 'BOUNCED', 'OPENED', 'VIEWED'];
const sort_by_enum = ['number', 'date', 'contact_name', 'number2', 'title', 'description', 'amount', 'balance', 'created_at'];
const sort_dir_enum = ['asc', 'desc'];
const myinvois_enum = ['NORMAL', 'VALIDATE', 'EXTERNAL'];

const credit_note_child_item_schema = joi.object({
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

const credit_note_form_item_schema = joi.object({
  id: joi.number().optional(),
  type: joi.string().allow(null, 'bundle', 'subtitle', 'subtotal'),
  account_id: joi.number().when('type', { is: null, then: joi.required(), otherwise: joi.optional() }),
  description: joi.string().required(),
  service_date: joi.date().iso().optional(),
  product_id: joi.number().optional(),
  product_unit_id: joi.number().optional(),
  location_id: joi.number().optional(),
  unit_price: joi.number().precision(4).when('type', { is: null, then: joi.required(), otherwise: joi.optional() }),
  quantity: joi.number().precision(4).when('type', { is: null, then: joi.required(), otherwise: joi.optional() }),
  discount: joi.string().max(14).optional(),
  tax_code_id: joi.number().optional(),
  classification_code: joi.string().optional(),
  children: joi.array().items(credit_note_child_item_schema).optional()
});

const link_item_schema = joi.object({
  id: joi.number().optional(),
  target_transaction_id: joi.number().required(),
  apply_amount: joi.number().required()
});

const email_schema = joi.object({
  to_addresses: joi.array().items(joi.string().email()).min(1).required(),
  cc_addresses: joi.array().items(joi.string().email()).optional(),
  reply_to_address: joi.string().email().optional(),
  subject: joi.string().optional(),
  message: joi.string().optional(),
  attach_pdf: joi.boolean().optional(),
  form_design_id: joi.number().optional()
});

const file_schema = joi.object({ file_id: joi.number().required(), is_shared: joi.boolean().required() });
const field_schema = joi.object({ id: joi.number().required(), value: joi.any().required() });

const create_credit_note_schema = joi.object({
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
  form_items: joi.array().items(credit_note_form_item_schema).min(1).required(),
  link_items: joi.array().items(link_item_schema).optional(),
  status: joi.string().valid('draft', 'pending_approval', 'ready').required(),
  email: email_schema.optional(),
  files: joi.array().items(file_schema).optional(),
  fields: joi.array().items(field_schema).optional(),
  customs_form_no: joi.string().optional(),
  customs_k2_form_no: joi.string().optional(),
  incoterms: joi.string().optional(),
  myinvois_action: joi.string().valid(...myinvois_enum).optional()
});

const update_credit_note_schema = create_credit_note_schema.keys({
  number: joi.string().max(50).required()
});

const list_credit_note_schema = joi.object({
  payment_status: joi.string().valid('PAID', 'OUTSTANDING', 'OVERDUE').optional(),
  date_from: joi.date().iso().optional(),
  date_to: joi.date().iso().optional(),
  search: joi.string().max(100).optional(),
  custom_search: joi.string().max(100).optional(),
  contact_id: joi.number().optional(),
  status: joi.string().valid(...status_enum).optional(),
  email_status: joi.string().valid(...email_status_enum).optional(),
  sort_by: joi.string().valid(...sort_by_enum).optional(),
  sort_dir: joi.string().valid(...sort_dir_enum).optional(),
  page: joi.number().min(1).optional(),
  page_size: joi.number().optional()
});

const update_credit_note_status_schema = joi.object({
  status: joi.string().valid(...status_enum).required(),
  void_reason: joi.string().max(255).when('status', { is: 'void', then: joi.required(), otherwise: joi.optional() })
});

module.exports = {
  create_credit_note_schema,
  update_credit_note_schema,
  list_credit_note_schema,
  update_credit_note_status_schema
};
