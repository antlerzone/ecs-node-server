const joi = require('joi');

const add_price_schema = joi.object({
  PriceName: joi.string().required().max(100),
  Price: joi.number().required(),
  priceType: joi.number().integer().optional(),
  Pnote: joi.string().max(500).optional()
});

const delete_price_schema = joi.object({
  id: joi.array().items(joi.alternatives().try(joi.number(), joi.string())).min(1).required()
});

const edit_price_schema = joi.object({
  PriceID: joi.alternatives().try(joi.number(), joi.string()).required(),
  PriceName: joi.string().required().max(100),
  Price: joi.number().required(),
  Pnote: joi.string().max(500).optional(),
  priceType: joi.number().integer().optional()
});

const edit_price_body_schema = joi.object({
  PriceName: joi.string().required().max(100),
  Price: joi.number().required(),
  Pnote: joi.string().max(500).optional(),
  priceType: joi.number().integer().optional()
});

module.exports = { add_price_schema, delete_price_schema, edit_price_schema, edit_price_body_schema };
