const joi = require('joi');

const typeEnum = ['IMAGE', 'VIDEO', 'EXCEL', 'PDF'];

const listSchema = joi.object({
  search: joi.string().max(128).optional(),
  type: joi.string().valid(...typeEnum).optional(),
  is_used: joi.boolean().optional(),
  page: joi.number().optional(),
  page_size: joi.number().min(10).max(100).optional()
});

module.exports = { list_file_schema: listSchema };
