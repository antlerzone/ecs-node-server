const joi = require('joi');

const add_user_schema = joi.object({
  uN: joi.string().required().max(100),
  uI: joi.string().required().max(100),
  tel: joi.string().max(50).allow('').optional()
});

const subuser_password_schema = joi.object({
  password: joi.string().required().min(1).max(100)
});

module.exports = { add_user_schema, subuser_password_schema };
