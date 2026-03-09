const joi = require('joi');

const typeEnum = ['current_assets', 'non_current_assets', 'other_assets', 'current_liabilities', 'non_current_liabilities', 'equity', 'income', 'other_income', 'cost_of_sales', 'expenses', 'taxation'];
const systemTypeEnum = ['bank_cash', 'accounts_receivable', 'accounts_payable', 'inventory', 'credit_card', 'fixed_assets', 'depreciation', 'my_epf_expense', 'my_socso_expense', 'my_eis_expense', 'my_salary_expense'];
const classificationEnum = ['OPERATING', 'INVESTING', 'FINANCING'];
const categoryEnum = ['assets', 'liabilities', 'equity', 'income', 'expenses'];
const sortByEnum = ['code', 'name', 'balance'];
const sortDirEnum = ['asc', 'desc'];

const createSchema = joi.object({
  name: joi.string().max(255).required(),
  type: joi.string().valid(...typeEnum).required(),
  system_type: joi.string().valid(...systemTypeEnum).optional(),
  parent_id: joi.number().optional(),
  classification: joi.string().valid(...classificationEnum).optional(),
  code: joi.string().max(12).optional(),
  description: joi.string().optional()
});

const updateSchema = joi.object({
  name: joi.string().max(255).required(),
  type: joi.string().valid(...typeEnum).required(),
  system_type: joi.string().valid(...systemTypeEnum).optional(),
  parent_id: joi.number().optional(),
  classification: joi.string().valid(...classificationEnum).optional(),
  code: joi.string().max(12).required(),
  description: joi.string().optional()
});

const listSchema = joi.object({
  search: joi.string().max(100).optional(),
  category: joi.string().valid(...categoryEnum).optional(),
  is_archived: joi.boolean().optional(),
  sort_by: joi.string().valid(...sortByEnum).optional(),
  sort_dir: joi.string().valid(...sortDirEnum).optional()
});

const archiveSchema = joi.object({
  is_archived: joi.boolean().required()
});

module.exports = {
  create_account_schema: createSchema,
  update_account_schema: updateSchema,
  list_account_schema: listSchema,
  archive_account_schema: archiveSchema
};
