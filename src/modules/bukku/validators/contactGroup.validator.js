const joi = require('joi');

const createSchema = joi.object({
  name: joi.string().max(32).required(),
  contact_ids: joi.array().items(joi.number()).optional()
});

const updateSchema = joi.object({
  name: joi.string().max(32).required(),
  contact_ids: joi.array().items(joi.number()).optional()
});

module.exports = {
  create_contact_group_schema: createSchema,
  update_contact_group_schema: updateSchema
};
