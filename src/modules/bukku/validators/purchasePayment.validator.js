const joi = require('joi');

const status_enum = ['draft', 'pending_approval', 'ready', 'void'];
const email_status_enum = ['UNSENT', 'PENDING', 'SENT', 'BOUNCED', 'OPENED', 'VIEWED'];
const payment_status_enum = ['paid', 'outstanding'];
const sort_by_enum = ['number', 'date', 'contact_name', 'number2', 'description', 'amount', 'balance', 'created_at'];
const sort_dir_enum = ['asc', 'desc'];

const link_item_schema = joi.object({
  id: joi.number().optional(),
  target_transaction_id: joi.number().required(),
  apply_amount: joi.number().required()
});

const deposit_item_schema = joi.object({
  id: joi.number().optional(),
  payment_method_id: joi.number().optional(),
  account_id: joi.number().required(),
  amount: joi.number().required(),
  number: joi.string().optional(),
  fee_text: joi.string().optional(),
  fee_account_id: joi.number().when('fee_text', { is: joi.exist(), then: joi.required(), otherwise: joi.optional() })
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

const create_purchase_payment_schema = joi.object({
  contact_id: joi.number().required(),
  number: joi.string().max(50).optional(),
  number2: joi.string().max(50).optional(),
  date: joi.date().iso().required(),
  currency_code: joi.string().required(),
  exchange_rate: joi.number().required(),
  amount: joi.number().required(),
  tag_ids: joi.array().items(joi.number()).max(4).optional(),
  description: joi.string().max(255).optional(),
  remarks: joi.string().optional(),
  link_items: joi.array().items(link_item_schema).optional(),
  deposit_items: joi.array().items(deposit_item_schema).min(1).required(),
  status: joi.string().valid(...status_enum).required(),
  email: email_schema.optional(),
  files: joi.array().items(file_schema).optional(),
  fields: joi.array().items(field_schema).optional()
});

const update_purchase_payment_schema = create_purchase_payment_schema.keys({
  number: joi.string().max(50).required()
});

const list_purchase_payment_schema = joi.object({
  search: joi.string().max(100).optional(),
  custom_search: joi.string().max(100).optional(),
  contact_id: joi.number().optional(),
  date_from: joi.date().iso().optional(),
  date_to: joi.date().iso().optional(),
  status: joi.string().valid(...status_enum).optional(),
  payment_status: joi.string().valid(...payment_status_enum).optional(),
  email_status: joi.string().valid(...email_status_enum).optional(),
  page: joi.number().min(1).optional(),
  page_size: joi.number().optional(),
  sort_by: joi.string().valid(...sort_by_enum).optional(),
  sort_dir: joi.string().valid(...sort_dir_enum).optional(),
  account_id: joi.string().optional()
});

const update_purchase_payment_status_schema = joi.object({
  status: joi.string().valid(...status_enum).required(),
  void_reason: joi.string().max(255).when('status', { is: 'void', then: joi.required(), otherwise: joi.optional() })
});

module.exports = {
  create_purchase_payment_schema,
  update_purchase_payment_schema,
  list_purchase_payment_schema,
  update_purchase_payment_status_schema
};
