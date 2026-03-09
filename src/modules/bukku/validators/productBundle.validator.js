const joi = require('joi');

const bundleItemTypeEnum = ['BUNDLE_ITEM', 'BUNDLE_DISCOUNT'];

const bundleItemSchema = joi.object({
  line: joi.number().optional(),
  product_id: joi.number().allow(null).optional(),
  product_unit_id: joi.number().allow(null).optional(),
  quantity: joi.number().allow(null).optional(),
  type: joi.string().valid(...bundleItemTypeEnum).required(),
  sale_discount_amount: joi.number().allow(null).optional(),
  purchase_discount_amount: joi.number().allow(null).optional()
});

const bundleItemUpdateSchema = bundleItemSchema.keys({
  id: joi.number().optional()
});

const createSchema = joi.object({
  name: joi.string().required(),
  sku: joi.string().allow(null).optional(),
  picture_id: joi.number().allow(null).optional(),
  picture_url: joi.string().allow(null).optional(),
  remarks: joi.string().allow(null).optional(),
  group_ids: joi.array().items(joi.number()).optional(),
  is_selling: joi.boolean().required(),
  sale_description: joi.string().allow(null).optional(),
  is_buying: joi.boolean().required(),
  purchase_description: joi.string().allow(null).optional(),
  items: joi.array().items(bundleItemSchema).min(1).required()
});

const updateSchema = joi.object({
  name: joi.string().required(),
  sku: joi.string().allow(null).optional(),
  picture_id: joi.number().allow(null).optional(),
  picture_url: joi.string().allow(null).optional(),
  remarks: joi.string().allow(null).optional(),
  group_ids: joi.array().items(joi.number()).optional(),
  is_selling: joi.boolean().required(),
  sale_description: joi.string().allow(null).optional(),
  is_buying: joi.boolean().required(),
  purchase_description: joi.string().allow(null).optional(),
  items: joi.array().items(bundleItemUpdateSchema).min(1).required()
});

const archiveSchema = joi.object({
  is_archived: joi.boolean().required()
});

module.exports = {
  create_product_bundle_schema: createSchema,
  update_product_bundle_schema: updateSchema,
  archive_product_bundle_schema: archiveSchema
};
