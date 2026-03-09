const joi = require('joi');

/**
 * Xero GET /Accounts query params.
 * @see https://developer.xero.com/documentation/api/accounting/accounts
 */
const listSchema = joi.object({
  where: joi.string().max(500).optional(),
  order: joi.string().max(200).optional(),
  ifModifiedSince: joi.date().iso().optional()
});

module.exports = {
  list_account_schema: listSchema
};
