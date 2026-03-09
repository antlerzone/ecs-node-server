const joi = require('joi');

const listNames = ['countries', 'currencies', 'contacts', 'contact_addresses', 'company_addresses', 'contact_groups', 'classification_code_list', 'products', 'product_list', 'product', 'product_groups', 'accounts', 'terms', 'payment_methods', 'price_levels', 'tag_groups', 'asset_types', 'fields', 'numberings', 'form_designs', 'locations', 'stock_balances', 'tax_codes', 'settings', 'limits', 'users', 'advisors', 'state_list'];

const postSchema = joi.object({
  lists: joi.array().items(joi.string().valid(...listNames)).required(),
  params: joi.array().optional()
});

module.exports = { get_lists_schema: postSchema };
