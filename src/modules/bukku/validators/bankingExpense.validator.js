const joi = require('joi');

const dateString = joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/);
const statusEnum = ['draft', 'pending_approval', 'ready', 'void'];
const taxModeEnum = ['inclusive', 'exclusive'];
const emailStatusEnum = ['UNSENT', 'PENDING', 'SENT', 'BOUNCED', 'OPENED', 'VIEWED'];
const sortByEnum = ['number', 'number2', 'date', 'contact_name', 'amount', 'description', 'created_at'];
const sortDirEnum = ['asc', 'desc'];

const bankItemSchema = joi.object({
  line: joi.number().optional(),
  account_id: joi.number().optional(),
  description: joi.string().optional(),
  amount: joi.number().optional(),
  tax_code_id: joi.number().allow(null).optional()
});

const bankItemUpdateSchema = bankItemSchema.keys({
  id: joi.number().optional()
});

const depositItemSchema = joi.object({
  payment_method_id: joi.number().allow(null).optional(),
  account_id: joi.number().required(),
  amount: joi.number().required(),
  number: joi.string().optional(),
  fee_text: joi.string().optional(),
  fee_account_id: joi.number().when('fee_text', { is: joi.exist(), then: joi.required(), otherwise: joi.optional() })
});

const depositItemUpdateSchema = depositItemSchema.keys({
  id: joi.number().optional()
});

const fileSchema = joi.object({ file_id: joi.number().required() });

const createSchema = joi.object({
  contact_id: joi.number().optional(),
  billing_party: joi.string().optional(),
  billing_contact_person_id: joi.number().allow(null).optional(),
  billing_contact_person: joi.string().allow(null).optional(),
  number: joi.string().max(50).required(),
  number2: joi.string().max(50).optional(),
  date: dateString.required(),
  currency_code: joi.string().required(),
  exchange_rate: joi.number().required(),
  tax_mode: joi.string().valid(...taxModeEnum).optional(),
  bank_items: joi.array().items(bankItemSchema).min(1).required(),
  rounding_on: joi.boolean().required(),
  description: joi.string().max(255).allow(null).optional(),
  internal_note: joi.string().allow(null).optional(),
  remarks: joi.string().allow(null).optional(),
  tag_ids: joi.array().items(joi.number()).max(4).optional(),
  files: joi.array().items(fileSchema).optional(),
  status: joi.string().valid(...statusEnum).required(),
  deposit_items: joi.array().items(depositItemSchema).min(1).required()
});

const updateSchema = joi.object({
  contact_id: joi.number().optional(),
  billing_party: joi.string().optional(),
  billing_contact_person_id: joi.number().allow(null).optional(),
  billing_contact_person: joi.string().allow(null).optional(),
  number: joi.string().max(50).required(),
  number2: joi.string().max(50).optional(),
  date: dateString.required(),
  currency_code: joi.string().required(),
  exchange_rate: joi.number().required(),
  tax_mode: joi.string().valid(...taxModeEnum).optional(),
  bank_items: joi.array().items(bankItemUpdateSchema).min(1).required(),
  rounding_on: joi.boolean().required(),
  description: joi.string().max(255).allow(null).optional(),
  internal_note: joi.string().allow(null).optional(),
  remarks: joi.string().allow(null).optional(),
  tag_ids: joi.array().items(joi.number()).max(4).optional(),
  files: joi.array().items(fileSchema).optional(),
  status: joi.string().valid(...statusEnum).required(),
  deposit_items: joi.array().items(depositItemUpdateSchema).min(1).required()
});

const listSchema = joi.object({
  date_from: dateString.optional(),
  date_to: dateString.optional(),
  search: joi.string().max(100).optional(),
  contact_id: joi.number().optional(),
  account_id: joi.number().optional(),
  status: joi.string().valid(...statusEnum).optional(),
  email_status: joi.string().valid(...emailStatusEnum).optional(),
  page: joi.number().min(1).optional(),
  page_size: joi.number().optional(),
  sort_by: joi.string().valid(...sortByEnum).optional(),
  sort_dir: joi.string().valid(...sortDirEnum).optional()
});

const updateStatusSchema = joi.object({
  status: joi.string().valid(...statusEnum).required(),
  void_reason: joi.string().max(255).when('status', { is: 'void', then: joi.required(), otherwise: joi.optional() })
});

module.exports = {
  create_banking_expense_schema: createSchema,
  update_banking_expense_schema: updateSchema,
  list_banking_expense_schema: listSchema,
  update_banking_expense_status_schema: updateStatusSchema
};
