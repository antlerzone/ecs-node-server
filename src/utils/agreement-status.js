'use strict';

/**
 * agreement.status canonical value is `completed`. Some rows store `complete` (typo) and are
 * excluded from tenant queries that filter on `completed` only.
 */

function normalizeAgreementStatusForStorage(status) {
  if (status == null) return status;
  const s = String(status).trim().toLowerCase();
  if (s === 'complete') return 'completed';
  return typeof status === 'string' ? status.trim() : status;
}

function isAgreementCompletedStatus(status) {
  const s = String(status ?? '').trim().toLowerCase();
  return s === 'completed' || s === 'complete';
}

module.exports = {
  normalizeAgreementStatusForStorage,
  isAgreementCompletedStatus,
};
