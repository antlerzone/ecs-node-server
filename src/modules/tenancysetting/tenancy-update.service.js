/**
 * Thin wrapper so routes always get a callable updateTenancy even if tenancysetting.service
 * is mid-load due to require order / large dependency graph.
 */
async function updateTenancy(clientId, tenancyId, opts) {
  const m = require('./tenancysetting.service');
  const fn = m && m.updateTenancy;
  if (typeof fn !== 'function') {
    throw new Error('UPDATE_TENANCY_EXPORT_MISSING');
  }
  return fn(clientId, tenancyId, opts);
}

module.exports = { updateTenancy };
