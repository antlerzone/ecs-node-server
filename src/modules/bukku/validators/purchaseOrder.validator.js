const joi = require('joi');

const tax_mode_enum = ['inclusive', 'exclusive'];
const status_enum = ['draft', 'pending_approval', 'ready', 'void'];
const email_status_enum = ['UNSENT', 'PENDING', 'SENT', 'BOUNCED', 'OPENED', 'VIEWED'];
const transfer_status_enum = ['ALL', 'OUTSTANDING', 'NOT_TRANSFERRED', 'PARTIAL_TRANSFERRED', 'TRANSFERRED'];
const sort_by_enum = ['number', 'date', 'contact_name', 'number2', 'title', 'description', 'amount', 'created_at'];
const sort_dir_enum = ['asc', 'desc'];

const child_item_schema = joi.object({
  id: joi.number().optional(),
  type: joi.string().valid('bundle_item').optional(),
  account_id: joi.number().required(),
  description: joi.string().required(),
  service_date: joi.date().iso().optional(),
  product_id: joi.number().optional(),
  product_unit_id: joi.number().optional(),
  location_id: joi.number().optional(),
  unit_price: joi.number().precision(4).required(),
  quantity: joi.number().precision(4).required(),
  discount: joi.string().max(14).optional(),
  tax_code_id: joi.number().optional()
});

const form_item_schema = joi.object({
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
  children: joi.array().items(child_item_schema).optional()
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

const create_purchase_order_schema = joi.object({
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
  term_id: joi.number().optional(),
  title: joi.string().max(255).optional(),
  description: joi.string().max(255).optional(),
  remarks: joi.string().optional(),
  tax_mode: joi.string().valid(...tax_mode_enum).required(),
  form_items: joi.array().items(form_item_schema).min(1).required(),
  status: joi.string().valid('draft', 'pending_approval', 'ready').required(),
  email: email_schema.optional(),
  files: joi.array().items(file_schema).optional(),
  fields: joi.array().items(field_schema).optional()
});

const update_purchase_order_schema = create_purchase_order_schema.keys({
  number: joi.string().max(50).required()
});

const list_purchase_order_schema = joi.object({
  search: joi.string().max(100).optional(),
  custom_search: joi.string().max(100).optional(),
  contact_id: joi.number().optional(),
  date_from: joi.date().iso().optional(),
  date_to: joi.date().iso().optional(),
  status: joi.string().valid(...status_enum).optional(),
  email_status: joi.string().valid(...email_status_enum).optional(),
  transfer_status: joi.string().valid(...transfer_status_enum).optional(),
  page: joi.number().min(1).optional(),
  page_size: joi.number().optional(),
  sort_by: joi.string().valid(...sort_by_enum).optional(),
  sort_dir: joi.string().valid(...sort_dir_enum).optional()
});

const update_purchase_order_status_schema = joi.object({
  status: joi.string().valid(...status_enum).required(),
  void_reason: joi.string().max(255).when('status', { is: 'void', then: joi.required(), otherwise: joi.optional() })
});

module.exports = {
  create_purchase_order_schema,
  update_purchase_order_schema,
  list_purchase_order_schema,
  update_purchase_order_status_schema
};
