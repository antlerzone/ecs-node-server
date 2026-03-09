const joi = require('joi');

const meter_id_schema = joi.string().required().min(1).max(100);
const meter_ids_schema = joi.array().items(joi.string().min(1).max(100)).min(1).required();

const add_meter_item_schema = joi.object({
  MeterID: joi.string().required().min(1).max(20),
  MeterModel: joi.number().integer().optional(),
  Name: joi.string().max(100).optional(),
  PriceID: joi.string().required(),
  Note: joi.string().max(500).optional(),
  UserID: joi.alternatives().try(joi.number(), joi.string()).optional(),
  index: joi.alternatives().try(joi.number(), joi.string()).optional()
});

const add_meters_schema = joi.object({
  meters: joi.array().items(add_meter_item_schema).min(1).required()
});

const edit_meter_body_schema = joi.object({
  meterName: joi.string().required().max(100),
  priceId: joi.string().required()
});

const set_relay_schema = joi.object({
  val: joi.number().integer().valid(1, 2).optional()
});

const set_power_gate_schema = joi.object({
  value: joi.alternatives().try(joi.number(), joi.string()).required()
});

const set_ratio_schema = joi.object({
  ratio: joi.alternatives().try(joi.number(), joi.string()).required()
});

const create_pending_topup_schema = joi.object({
  meterId: joi.string().required(),
  amount: joi.alternatives().try(joi.number(), joi.string()).required()
});

const confirm_topup_schema = joi.object({
  meterId: joi.string().required(),
  idx: joi.alternatives().try(joi.number(), joi.string()).required()
});

const usage_records_query_schema = joi.object({
  meterId: joi.string().required(),
  st: joi.string().required(),
  et: joi.string().required(),
  mYMD: joi.number().integer().min(1).max(3).optional()
});

const month_bill_query_schema = joi.object({
  meterIds: joi.array().items(joi.string()).min(1).required(),
  st: joi.string().required(),
  et: joi.string().required(),
  mYMD: joi.number().integer().min(1).max(3).optional()
});

const usage_summary_schema = joi.object({
  meterIds: joi.array().items(joi.string()).min(1).required(),
  start: joi.alternatives().try(joi.date().iso(), joi.string()).required(),
  end: joi.alternatives().try(joi.date().iso(), joi.string()).required()
});

const update_meter_name_rate_schema = joi.object({
  meterId: joi.string().required(),
  oldName: joi.string().allow('').optional(),
  newName: joi.string().allow('').optional(),
  rate: joi.number().min(0).required()
});

const sync_meter_schema = joi.object({
  meterId: joi.string().required()
});

module.exports = {
  meter_id_schema,
  meter_ids_schema,
  add_meters_schema,
  edit_meter_body_schema,
  set_relay_schema,
  set_power_gate_schema,
  set_ratio_schema,
  create_pending_topup_schema,
  confirm_topup_schema,
  usage_records_query_schema,
  month_bill_query_schema,
  usage_summary_schema,
  update_meter_name_rate_schema,
  sync_meter_schema
};
