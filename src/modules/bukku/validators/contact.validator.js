const joi = require('joi');

const entityTypeEnum = ['MALAYSIAN_COMPANY', 'MALAYSIAN_INDIVIDUAL', 'FOREIGN_COMPANY', 'FOREIGN_INDIVIDUAL', 'EXEMPTED_PERSON'];
const regNoTypeEnum = ['NRIC', 'BRN', 'PASSPORT', 'ARMY'];
const typeEnum = ['customer', 'supplier', 'employee'];
const sortByEnum = ['name', 'receivable', 'payable', 'created_at'];
const sortDirEnum = ['asc', 'desc'];
const statusEnum = ['ALL', 'ACTIVE', 'INACTIVE'];
const contactTypeEnum = ['customer', 'supplier', 'employee'];

const contactPersonSchema = joi.object({
  id: joi.number().allow(null).optional(),
  first_name: joi.string().max(50).allow(null).optional(),
  last_name: joi.string().max(50).allow(null).optional(),
  is_default_billing: joi.boolean().optional(),
  is_default_shipping: joi.boolean().optional()
});

const fieldSchema = joi.object({
  id: joi.number().allow(null).optional(),
  field_id: joi.number().required(),
  value: joi.string().allow(null).optional()
});

const addressSchema = joi.object({
  id: joi.number().optional(),
  name: joi.string().max(50).optional(),
  street: joi.string().max(255).optional(),
  city: joi.string().max(100).optional(),
  state: joi.string().max(50).optional(),
  postcode: joi.string().max(10).optional(),
  country_code: joi.string().optional(),
  is_default_billing: joi.boolean().optional(),
  is_default_shipping: joi.boolean().optional()
});

const fileSchema = joi.object({ file_id: joi.number().required() });

const createSchema = joi.object({
  entity_type: joi.string().valid(...entityTypeEnum).required(),
  legal_name: joi.string().max(100).required(),
  other_name: joi.string().max(100).optional(),
  reg_no_type: joi.string().valid(...regNoTypeEnum).allow(null).optional(),
  reg_no: joi.string().max(30).optional(),
  old_reg_no: joi.string().allow(null).optional(),
  tax_id_no: joi.string().min(11).max(14).allow(null).optional(),
  sst_reg_no: joi.string().allow(null).optional(),
  contact_persons: joi.array().items(contactPersonSchema).optional(),
  group_ids: joi.array().items(joi.number()).max(4).optional(),
  price_level_id: joi.number().optional(),
  email: joi.string().max(255).optional(),
  phone_no: joi.string().max(60).optional(),
  types: joi.array().items(joi.string().valid(...typeEnum)).min(1).required(),
  tag_ids: joi.array().items(joi.number()).max(4).optional(),
  default_currency_code: joi.string().optional(),
  default_term_id: joi.number().optional(),
  default_income_account_id: joi.number().optional(),
  default_expense_account_id: joi.number().optional(),
  fields: joi.array().items(fieldSchema).optional(),
  remarks: joi.string().optional(),
  receive_monthly_statement: joi.boolean().optional(),
  receive_invoice_reminder: joi.boolean().optional(),
  key: joi.string().optional(),
  addresses: joi.array().items(addressSchema).optional(),
  receivable_account_id: joi.number().optional(),
  debtor_credit_limit: joi.number().optional(),
  payable_account_id: joi.number().optional(),
  files: joi.array().items(fileSchema).optional()
});

const updateSchema = createSchema;

const listSchema = joi.object({
  group_id: joi.number().optional(),
  search: joi.string().max(100).optional(),
  page: joi.number().min(1).optional(),
  page_size: joi.number().optional(),
  sort_by: joi.string().valid(...sortByEnum).optional(),
  sort_dir: joi.string().valid(...sortDirEnum).optional(),
  status: joi.string().valid(...statusEnum).allow(null).optional(),
  is_myinvois_ready: joi.boolean().allow(null).optional(),
  type: joi.string().valid(...contactTypeEnum).optional()
});

const archiveSchema = joi.object({
  is_archived: joi.boolean().required()
});

module.exports = {
  create_contact_schema: createSchema,
  update_contact_schema: updateSchema,
  list_contact_schema: listSchema,
  archive_contact_schema: archiveSchema
};
