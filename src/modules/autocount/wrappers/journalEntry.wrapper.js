/**
 * AutoCount Cloud API – Journal Entry (general journal).
 * @see https://accounting-api.autocountcloud.com/documentation/api-methods/journal-entry/create-journal-entry/
 * POST /{accountBookId}/journalEntry — master (docDate, currencyCode, journalType, description) + details (accNo, dr, cr, description).
 */

const autocountrequest = require('./autocountrequest');
const { getAutoCountCreds } = require('../lib/autocountCreds');

/**
 * Create journal entry. POST /{accountBookId}/journalEntry
 * @param {object} req - Express request (client resolved)
 * @param {object} payload - { master: { docDate, currencyCode?, journalType?, description }, details: [{ accNo, dr, cr, description? }] }
 * @returns {Promise<{ ok: boolean, data?: any, error?: any }>}
 */
async function createJournalEntry(req, payload) {
  const { apiKey, keyId, accountBookId } = await getAutoCountCreds(req);
  return autocountrequest({
    method: 'post',
    accountBookId,
    endpoint: '/journalEntry',
    apiKey,
    keyId,
    data: payload || {}
  });
}

module.exports = {
  createJournalEntry
};
