const joi = require('joi');

const createSchema = joi.object({
  code: joi.string().required(),
  name: joi.string().required(),
  street: joi.string().optional(),
  city: joi.string().optional(),
  state: joi.string().optional(),
  postcode: joi.string().optional(),
  country_code: joi.string().optional(),
  remarks: joi.string().optional()
});

const updateSchema = createSchema;

const listSchema = joi.object({
  include_archived: joi.boolean().optional()
});

const archiveSchema = joi.object({
  is_archived: joi.boolean().required()
});

module.exports = {
  create_location_schema: createSchema,
  update_location_schema: updateSchema,
  list_location_schema: listSchema,
  archive_location_schema: archiveSchema
};
