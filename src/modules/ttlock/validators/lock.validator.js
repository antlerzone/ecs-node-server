const joi = require('joi');

const lock_id_schema = joi.string().required().min(1).max(100);
const lock_name_schema = joi.string().required().min(1).max(100);

const add_passcode_schema = joi.object({
  name: joi.string().required().min(1).max(100),
  password: joi.string().required().min(1).max(32),
  startDate: joi.number().integer().min(0).optional(),
  endDate: joi.number().integer().min(0).optional()
});

const change_passcode_schema = joi.object({
  keyboardPwdId: joi.alternatives().try(joi.number(), joi.string()).required(),
  name: joi.string().required().min(1).max(100),
  startDate: joi.number().integer().min(0).optional(),
  endDate: joi.number().integer().min(0).optional()
});

const rename_lock_schema = joi.object({
  lockName: lock_name_schema
});

const params_lock_id_schema = joi.object({ lockId: lock_id_schema });

module.exports = {
  lock_id_schema,
  lock_name_schema,
  add_passcode_schema,
  change_passcode_schema,
  rename_lock_schema,
  params_lock_id_schema
};
