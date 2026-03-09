const joi = require('joi');

const dateString = joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/);
const statusEnum = ['draft', 'pending_approval', 'ready', 'void'];

const fileSchema = joi.object({ file_id: joi.number().required() });

const createSchema = joi.object({
  number: joi.string().max(50).required(),
  number2: joi.string().max(50).allow(null).optional(),
  date: dateString.required(),
  currency_code: joi.string().required(),
  exchange_rate: joi.number().required(),
  account_id: joi.number().required(),
  account2_id: joi.number().required(),
  amount: joi.number().required(),
  description: joi.string().max(255).allow(null).optional(),
  internal_note: joi.string().allow(null).optional(),
  remarks: joi.string().allow(null).optional(),
  tag_ids: joi.array().items(joi.number()).max(4).optional(),
  files: joi.array().items(fileSchema).optional(),
  status: joi.string().valid(...statusEnum).required()
});

const updateSchema = joi.object({
  number: joi.string().max(50).required(),
  number2: joi.string().max(50).allow(null).optional(),
  date: dateString.required(),
  currency_code: joi.string().required(),
  exchange_rate: joi.number().required(),
  account_id: joi.number().required(),
  account2_id: joi.number().required(),
  amount: joi.number().required(),
  description: joi.string().max(255).allow(null).optional(),
  internal_note: joi.string().allow(null).optional(),
  remarks: joi.string().allow(null).optional(),
  tag_ids: joi.array().items(joi.number()).max(4).optional(),
  files: joi.array().items(fileSchema).optional(),
  status: joi.string().valid(...statusEnum).required()
});

const listSchema = joi.object({
  date_from: dateString.optional(),
  date_to: dateString.optional(),
  search: joi.string().max(100).optional(),
  account_id: joi.number().optional(),
  status: joi.string().valid(...statusEnum).optional()
});

const updateStatusSchema = joi.object({
  status: joi.string().valid(...statusEnum).required(),
  void_reason: joi.string().max(255).when('status', { is: 'void', then: joi.required(), otherwise: joi.optional() })
});

module.exports = {
  create_banking_transfer_schema: createSchema,
  update_banking_transfer_schema: updateSchema,
  list_banking_transfer_schema: listSchema,
  update_banking_transfer_status_schema: updateStatusSchema
};
