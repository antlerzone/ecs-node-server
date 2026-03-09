const joi = require('joi');

const createSchema = joi.object({
  name: joi.string().required(),
  tag_group_id: joi.number().required()
});

const updateSchema = createSchema;

module.exports = {
  create_tag_schema: createSchema,
  update_tag_schema: updateSchema
};
