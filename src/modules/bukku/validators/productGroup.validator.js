const joi = require('joi');

const createSchema = joi.object({
  name: joi.string().max(32).required(),
  product_ids: joi.array().items(joi.number()).required()
});

const updateSchema = joi.object({
  name: joi.string().max(32).required(),
  product_ids: joi.array().items(joi.number()).required()
});

module.exports = {
  create_product_group_schema: createSchema,
  update_product_group_schema: updateSchema
};
