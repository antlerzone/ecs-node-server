const joi = require('joi');

const dateString = joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/);
const stockLevelEnum = ['all', 'no_stock', 'low_stock'];
const modeEnum = ['sale', 'purchase'];
const typeEnum = ['product', 'bundle'];
const sortByEnum = ['name', 'sku', 'sale_price', 'purchase_price', 'quantity'];
const sortDirEnum = ['asc', 'desc'];

const unitSchema = joi.object({
  label: joi.string().max(8).required(),
  rate: joi.number().required(),
  sale_price: joi.number().optional(),
  purchase_price: joi.number().optional(),
  is_base: joi.boolean().optional(),
  is_sale_default: joi.boolean().optional(),
  is_purchase_default: joi.boolean().optional()
});

const unitUpdateSchema = unitSchema.keys({
  id: joi.number().optional()
});

const salePriceSchema = joi.object({
  price_level_id: joi.number().optional(),
  contact_id: joi.number().optional(),
  date_from: dateString.optional(),
  date_to: dateString.optional(),
  product_unit_id: joi.number().required(),
  minimum_quantity: joi.number().min(0).required(),
  currency_code: joi.string().required(),
  unit_price: joi.number().optional()
});

const purchasePriceSchema = joi.object({
  price_level_id: joi.number().optional(),
  contact_id: joi.number().optional(),
  date_from: dateString.optional(),
  date_to: dateString.optional(),
  product_unit_id: joi.number().required(),
  minimum_quantity: joi.number().min(0).required(),
  currency_code: joi.string().required(),
  unit_price: joi.number().optional()
});

const createSchema = joi.object({
  name: joi.string().max(255).required(),
  sku: joi.string().max(50).optional(),
  classification_code: joi.string().max(3).allow(null).optional(),
  is_selling: joi.boolean().required(),
  sale_description: joi.string().optional(),
  sale_account_id: joi.number().optional(),
  sale_tax_code_id: joi.number().optional(),
  is_buying: joi.boolean().required(),
  purchase_description: joi.string().optional(),
  purchase_account_id: joi.number().optional(),
  purchase_tax_code_id: joi.number().optional(),
  track_inventory: joi.boolean().required(),
  inventory_account_id: joi.number().optional(),
  quantity_low_alert: joi.number().optional(),
  bin_location: joi.string().max(60).optional(),
  remarks: joi.string().optional(),
  units: joi.array().items(unitSchema).min(1).required(),
  group_ids: joi.array().items(joi.number()).optional(),
  sale_prices: joi.array().items(salePriceSchema).optional(),
  purchase_prices: joi.array().items(purchasePriceSchema).optional()
});

const updateSchema = joi.object({
  name: joi.string().max(255).required(),
  sku: joi.string().max(50).optional(),
  classification_code: joi.string().max(3).allow(null).optional(),
  is_selling: joi.boolean().required(),
  sale_description: joi.string().optional(),
  sale_account_id: joi.number().optional(),
  sale_tax_code_id: joi.number().optional(),
  is_buying: joi.boolean().required(),
  purchase_description: joi.string().optional(),
  purchase_account_id: joi.number().optional(),
  purchase_tax_code_id: joi.number().optional(),
  track_inventory: joi.boolean().required(),
  inventory_account_id: joi.number().optional(),
  quantity_low_alert: joi.number().optional(),
  bin_location: joi.string().max(60).optional(),
  remarks: joi.string().optional(),
  units: joi.array().items(unitUpdateSchema).min(1).required(),
  group_ids: joi.array().items(joi.number()).optional(),
  sale_prices: joi.array().items(salePriceSchema).optional(),
  purchase_prices: joi.array().items(purchasePriceSchema).optional()
});

const listSchema = joi.object({
  search: joi.string().max(60).optional(),
  stock_level: joi.string().valid(...stockLevelEnum).optional(),
  mode: joi.string().valid(...modeEnum).optional(),
  type: joi.string().valid(...typeEnum).optional(),
  include_archived: joi.boolean().optional(),
  page: joi.number().min(1).optional(),
  page_size: joi.number().optional(),
  sort_by: joi.string().valid(...sortByEnum).optional(),
  sort_dir: joi.string().valid(...sortDirEnum).optional()
});

const archiveSchema = joi.object({
  is_archived: joi.boolean().required()
});

module.exports = {
  create_product_schema: createSchema,
  update_product_schema: updateSchema,
  list_product_schema: listSchema,
  archive_product_schema: archiveSchema
};
