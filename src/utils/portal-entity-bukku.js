/**
 * Portal `portal_account.entity_type` can store product-specific values (e.g. SINGAPORE_INDIVIDUAL after Singpass).
 * Bukku contact API expects MyInvois enum values only — map using the operator company ledger currency
 * (`operatordetail.currency`), which aligns with Malaysia (MYR) vs Singapore (SGD) books.
 */
'use strict';

const BUKKU_MYINVOIS_ENTITY_TYPES = [
  'MALAYSIAN_COMPANY',
  'MALAYSIAN_INDIVIDUAL',
  'FOREIGN_COMPANY',
  'FOREIGN_INDIVIDUAL',
  'EXEMPTED_PERSON',
];

/**
 * @param {string|null|undefined} portalEntityType
 * @param {string|null|undefined} operatorCurrency - e.g. MYR, SGD
 * @returns {string|null} Bukku entity_type, or null to use role default
 */
function mapPortalEntityTypeToBukku(portalEntityType, operatorCurrency) {
  const cur = String(operatorCurrency || '')
    .trim()
    .toUpperCase();
  const pe = String(portalEntityType || '').trim();
  if (!pe) return null;
  if (BUKKU_MYINVOIS_ENTITY_TYPES.includes(pe)) return pe;

  if (pe === 'SINGAPORE_INDIVIDUAL') {
    if (cur === 'MYR') return 'FOREIGN_INDIVIDUAL';
    if (cur === 'SGD') return 'MALAYSIAN_INDIVIDUAL';
    return 'FOREIGN_INDIVIDUAL';
  }

  if (pe === 'MALAYSIAN_INDIVIDUAL') {
    if (cur === 'SGD') return 'FOREIGN_INDIVIDUAL';
    return 'MALAYSIAN_INDIVIDUAL';
  }

  return null;
}

module.exports = {
  mapPortalEntityTypeToBukku,
  BUKKU_MYINVOIS_ENTITY_TYPES,
};
