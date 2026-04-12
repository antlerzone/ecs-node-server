/**
 * Add-ons retired from catalog (no longer sold). Still in DB for historical rows.
 * @param {string | null | undefined} title
 * @returns {boolean}
 */
function isRetiredPricingPlanAddon(title) {
  const t = String(title || '').toLowerCase().trim();
  if (!t) return false;
  return t.includes('hr salary');
}

module.exports = { isRetiredPricingPlanAddon };
