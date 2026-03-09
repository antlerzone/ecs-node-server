const joi = require('joi');

const createSchema = joi.object({
  name: joi.string().required()
});

const updateSchema = createSchema;

const listSchema = joi.object({
  include_archived: joi.boolean().optional()
});

module.exports = {
  create_tag_group_schema: createSchema,
  update_tag_group_schema: updateSchema,
  list_tag_group_schema: listSchema
};
