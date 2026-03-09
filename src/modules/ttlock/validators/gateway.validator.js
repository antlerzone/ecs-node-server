const joi = require('joi');

const gateway_id_schema = joi.string().required().min(1).max(100);
const gateway_name_schema = joi.string().required().min(1).max(100);

const rename_gateway_schema = joi.object({
  gatewayName: gateway_name_schema
});

const params_gateway_id_schema = joi.object({ gatewayId: gateway_id_schema });

module.exports = {
  gateway_id_schema,
  gateway_name_schema,
  rename_gateway_schema,
  params_gateway_id_schema
};
