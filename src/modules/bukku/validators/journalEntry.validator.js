const joi = require('joi');

const dateString = joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/);
const statusEnum = ['draft', 'pending_approval', 'ready', 'void'];
const sortByEnum = ['number', 'number2', 'date', 'contact_name', 'amount', 'balance', 'title', 'description', 'created_at'];
const sortDirEnum = ['asc', 'desc'];

const journalItemSchema = joi.object({
  line: joi.number().required(),
  account_id: joi.number().required(),
  description: joi.string().optional(),
  debit_amount: joi.number().allow(null).required(),
  credit_amount: joi.number().allow(null).required(),
  tax_code_id: joi.number().allow(null).optional()
});

const journalItemUpdateSchema = journalItemSchema.keys({
  id: joi.number().optional()
});

const fileRefSchema = joi.object({ file_id: joi.number().required() });

const createSchema = joi.object({
  contact_id: joi.number().optional(),
  currency_code: joi.string().required(),
  date: dateString.required(),
  description: joi.string().max(255).optional(),
  exchange_rate: joi.number().required(),
  files: joi.array().items(joi.array().items(fileRefSchema)).optional(),
  internal_note: joi.string().optional(),
  journal_items: joi.array().items(journalItemSchema).min(1).required(),
  number: joi.string().max(50).optional(),
  number2: joi.string().max(50).optional(),
  remarks: joi.string().optional(),
  status: joi.string().valid(...statusEnum).required(),
  tag_ids: joi.array().items(joi.number()).max(4).optional()
});

const updateSchema = joi.object({
  contact_id: joi.number().optional(),
  currency_code: joi.string().required(),
  date: dateString.required(),
  description: joi.string().max(255).optional(),
  exchange_rate: joi.number().required(),
  files: joi.array().items(joi.array().items(fileRefSchema)).optional(),
  internal_note: joi.string().optional(),
  journal_items: joi.array().items(journalItemUpdateSchema).min(1).required(),
  number: joi.string().max(50).required(),
  number2: joi.string().max(50).optional(),
  remarks: joi.string().optional(),
  status: joi.string().valid(...statusEnum).required(),
  tag_ids: joi.array().items(joi.number()).max(4).optional()
});

const listSchema = joi.object({
  date_from: dateString.optional(),
  date_to: dateString.optional(),
  search: joi.string().max(100).optional(),
  status: joi.string().valid(...statusEnum).optional(),
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
  create_journal_entry_schema: createSchema,
  update_journal_entry_schema: updateSchema,
  list_journal_entry_schema: listSchema,
  update_journal_entry_status_schema: updateStatusSchema
};
