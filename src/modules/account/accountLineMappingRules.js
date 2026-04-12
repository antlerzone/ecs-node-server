/**
 * Operator default chart: which Bukku line uses its own account+product vs product-only + shared liability account.
 *
 * When true: store product_id on this template row; GL account_id comes from Platform Collection mapping.
 * Keep in sync with account.uses_platform_collection_gl = 1 (see migrations 0245/0246 operator chart).
 */

const PLATFORM_COLLECTION_ACCOUNT_ID = 'a1b2c3d4-0003-4000-8000-000000000003';

/** Invoice line uses product from this row and account from Platform Collection (see account.uses_platform_collection_gl). */
const INCOME_LINE_PRODUCT_ONLY_TEMPLATE_IDS = new Set([
  'e1b2c3d4-2004-4000-8000-000000000304', // Parking Fees
  'ae94f899-7f34-4aba-b6ee-39b97496e2a3', // Rental Income
  'a1b2c3d4-1001-4000-8000-000000000101', // Topup Aircond
  '94b4e060-3999-4c76-8189-f969615c0a7d', // Other
  '2020b22b-028e-4216-906c-c816dcb33a85' // Forfeit Deposit — cash invoice: DR Deposit / CR Platform Collection (PC + product line)
]);

function isIncomeLineUsesPlatformCollectionAccount(accountTemplateId) {
  return INCOME_LINE_PRODUCT_ONLY_TEMPLATE_IDS.has(accountTemplateId);
}

module.exports = {
  PLATFORM_COLLECTION_ACCOUNT_ID,
  INCOME_LINE_PRODUCT_ONLY_TEMPLATE_IDS,
  isIncomeLineUsesPlatformCollectionAccount
};
